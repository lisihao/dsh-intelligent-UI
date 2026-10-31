import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ExperienceStore, RevisionConflictError } from '../src/store.js'
import { ExperienceControl } from '../src/control.js'
import type { McpHost } from '../src/mcp-host.js'
import { RPC_REMOTE } from '../src/remote.js'
import { builtInThemes, MAX_THEME_BYTES, themePackageSchema, type ThemePackage } from '../src/theme-contracts.js'
import { DEFAULT_THEME_SOURCE, DEFAULT_THEME_REPOSITORY, themeCatalogSchema, themeSourceDirectory, themeSourceSchema } from '../src/theme-source.js'
import { downloadSourceTheme, listSourceThemes } from '../src/theme-download.js'

const roots: string[] = [], servers: Server[] = []
const flags = { takeover: true, openui: false, mcpApps: false }
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const custom = (): ThemePackage => ({ ...structuredClone(builtInThemes[1]!), id: 'local-library', name: 'Local library' })
const file = 'local-library.dsh-theme.json'
const catalogFor = (theme: ThemePackage, bytes = JSON.stringify(theme)) => ({ formatVersion: 1, themes: [{ id: theme.id, name: theme.name, version: theme.version, file, sha256: hash(bytes) }] })
type Reply = { body: string | Buffer; status?: number; chunked?: boolean }
async function httpLibrary(theme = custom()) {
  const bytes = JSON.stringify(theme)
  const replies = new Map<string, Reply>([['/themes/index.json', { body: JSON.stringify(catalogFor(theme, bytes)) }], [`/themes/${file}`, { body: bytes }]])
  const requests: string[] = []
  let beforeReply: ((path: string) => Promise<void>) | undefined
  const server = createServer((req, res) => {
    const path = req.url ?? ''; requests.push(path)
    void (async () => {
      await beforeReply?.(path)
      const reply = replies.get(path) ?? { status: 404, body: '{}' }
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...(reply.chunked ? {} : { 'content-length': Buffer.byteLength(reply.body) }) })
      if (reply.chunked) res.write(reply.body)
      res.end(reply.chunked ? undefined : reply.body)
    })().catch(error => res.destroy(error))
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address')
  return { source: `http://127.0.0.1:${address.port}/themes/`, replies, requests, delay: (handler: typeof beforeReply) => { beforeReply = handler } }
}
async function fixture(source: string) {
  const path = await mkdtemp(join(tmpdir(), 'experience-theme-source-')); roots.push(path)
  const store = new ExperienceStore(path)
  const state = await store.saveSettings({ expectedRevision: 0, ...flags, themeSource: source, themeId: 'plain', appearance: { backgroundColor: '#344556', translucent: true } })
  return { path, store, state, bytes: () => readFile(join(path, 'settings.json'), 'utf8') }
}
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('independent theme source', () => {
  it('ships an independently hosted catalog whose exact bytes hash and package match the built-in', async () => {
    expect(DEFAULT_THEME_SOURCE).toBe('https://raw.githubusercontent.com/lisihao/dsh-intelligent-UI/main/theme/')
    expect(themeSourceDirectory(DEFAULT_THEME_REPOSITORY)).toBe(DEFAULT_THEME_SOURCE)
    const catalog = themeCatalogSchema.parse(JSON.parse(await readFile(new URL('../theme/index.json', import.meta.url), 'utf8')))
    expect(catalog.themes.length).toBeGreaterThan(0)
    for (const entry of catalog.themes) {
      const bytes = await readFile(new URL(`../theme/${entry.file}`, import.meta.url))
      expect(hash(bytes)).toBe(entry.sha256)
      const theme = themePackageSchema.parse(JSON.parse(bytes.toString('utf8')))
      expect(theme).toEqual(builtInThemes.find(value => value.id === entry.id))
      expect(theme).toMatchObject({ id: entry.id, name: entry.name, version: entry.version })
    }
    for (const source of ['file:///tmp/theme/', 'https://user:secret@example.test/themes/', 'https://example.test/themes/?token=x', 'https://example.test/themes/#section']) expect(themeSourceSchema.safeParse(source).success).toBe(false)
  })

  it('persists a configured source across restart and older callers, then imports from real HTTP without activating or changing other settings', async () => {
    const library = await httpLibrary(), f = await fixture(library.source)
    const oldCaller = await f.store.saveSettings({ expectedRevision: f.state.revision, ...flags })
    expect(oldCaller.themeSource).toBe(library.source)
    const restarted = new ExperienceStore(f.path)
    expect(await restarted.settings()).toEqual(oldCaller)
    expect(await listSourceThemes(restarted)).toEqual({ ...catalogFor(custom()), source: library.source })
    const imported = await downloadSourceTheme(restarted, { expectedRevision: oldCaller.revision, source: library.source, id: custom().id })
    expect(imported).toEqual({ ...oldCaller, revision: oldCaller.revision + 1, theme: { activeId: 'plain', installed: [custom()] } })
    expect(await new ExperienceStore(f.path).settings()).toEqual(imported)
    const before = await f.bytes()
    expect(await downloadSourceTheme(restarted, { expectedRevision: imported.revision, source: library.source, id: custom().id })).toEqual(imported)
    expect(await f.bytes()).toBe(before)
    expect(library.requests.filter(path => path === `/themes/${file}`)).toHaveLength(2)
  })

  it('accepts the byte-identical published built-in as a no-op without rewriting settings', async () => {
    const builtIn = builtInThemes[0]!, library = await httpLibrary(builtIn), f = await fixture(library.source)
    const published = await readFile(new URL('../theme/empryo.dsh-theme.json', import.meta.url))
    library.replies.set('/themes/index.json', { body: JSON.stringify(catalogFor(builtIn, published.toString('utf8'))) })
    library.replies.set(`/themes/${file}`, { body: published })
    const before = await f.bytes(), seen: number[] = []
    f.store.subscribe(state => seen.push(state.revision))
    expect(await downloadSourceTheme(f.store, { expectedRevision: f.state.revision, source: library.source, id: builtIn.id })).toEqual(f.state)
    expect(await f.bytes()).toBe(before)
    expect(seen).toEqual([])
  })

  it.each([
    ['HTTP error', 'http', /HTTP 503/],
    ['catalog JSON', 'catalog-json', /有效 JSON/],
    ['catalog path escape', 'path', /目录格式无效/],
    ['file checksum', 'hash', /校验值不一致/],
    ['manifest identity', 'identity', /名称、版本或标识不一致/],
    ['file JSON', 'file-json', /有效 JSON/],
    ['declared file size', 'size-header', /大小限制/],
    ['streamed file size', 'size-stream', /大小限制/],
  ])('rejects %s and leaves durable settings unchanged', async (_label, failure, message) => {
    const theme = custom(), library = await httpLibrary(theme), f = await fixture(library.source)
    if (failure === 'http') library.replies.set('/themes/index.json', { body: '{}', status: 503 })
    if (failure === 'catalog-json') library.replies.set('/themes/index.json', { body: '<html>login required</html>' })
    if (failure === 'path') library.replies.set('/themes/index.json', { body: JSON.stringify({ formatVersion: 1, themes: [{ ...catalogFor(theme).themes[0], file: '../outside.dsh-theme.json' }] }) })
    if (failure === 'hash') library.replies.set(`/themes/${file}`, { body: JSON.stringify({ ...theme, name: 'Changed after catalog' }) })
    if (failure === 'identity') library.replies.set('/themes/index.json', { body: JSON.stringify({ formatVersion: 1, themes: [{ ...catalogFor(theme).themes[0], version: '99.0.0' }] }) })
    if (failure === 'file-json') library.replies.set(`/themes/${file}`, { body: '<html>not JSON</html>' })
    if (failure === 'size-header' || failure === 'size-stream') library.replies.set(`/themes/${file}`, { body: ' '.repeat(MAX_THEME_BYTES + 1), chunked: failure === 'size-stream' })
    const before = await f.bytes(), seen: number[] = []
    f.store.subscribe(state => seen.push(state.revision))
    await expect(downloadSourceTheme(f.store, { expectedRevision: f.state.revision, source: library.source, id: theme.id })).rejects.toThrow(message)
    expect(await f.bytes()).toBe(before)
    expect(await new ExperienceStore(f.path).settings()).toEqual(f.state)
    expect(seen).toEqual([])
    if (failure === 'path') expect(library.requests).toEqual(['/themes/index.json'])
  })

  it('rejects a stale revision or changed source before downloading', async () => {
    const library = await httpLibrary(), f = await fixture(library.source)
    await expect(downloadSourceTheme(f.store, { expectedRevision: 0, source: library.source, id: custom().id })).rejects.toBeInstanceOf(RevisionConflictError)
    await expect(downloadSourceTheme(f.store, { expectedRevision: f.state.revision, source: `${library.source}other/`, id: custom().id })).rejects.toThrow('主题来源已变化')
    expect(library.requests).toEqual([])
    expect(await f.store.settings()).toEqual(f.state)
  })

  it.each([false, true])('rejects an in-flight source change before %s built-in/import acknowledgement', async builtIn => {
    const theme = builtIn ? builtInThemes[0]! : custom(), library = await httpLibrary(theme), f = await fixture(library.source)
    let started!: () => void, release!: () => void
    const requested = new Promise<void>(resolve => { started = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    library.delay(async path => { if (path.endsWith(file)) { started(); await gate } })
    const download = downloadSourceTheme(f.store, { expectedRevision: f.state.revision, source: library.source, id: theme.id })
    // Attach the rejection assertion before releasing the network response.
    const rejected = expect(download).rejects.toBeInstanceOf(RevisionConflictError)
    try {
      await requested
      const changed = await f.store.saveSettings({ expectedRevision: f.state.revision, ...flags, themeSource: `${library.source}replacement/` })
      const before = await f.bytes()
      release(); await rejected
      expect(await f.bytes()).toBe(before)
      expect(await f.store.settings()).toEqual(changed)
      expect(changed.theme?.installed).toEqual([])
    } finally { release() }
  })

  it('rejects both new Remote methods for non-owners before any network or durable mutation', async () => {
    const library = await httpLibrary(), f = await fixture(library.source), ctx = new Context()
    const control = new ExperienceControl(ctx, f.store, {} as McpHost), before = await f.bytes()
    try {
      Object.defineProperty(ctx, 'invocation', { configurable: true, value: { peer: { principal: { kind: 'api' } } } })
      await expect(control.themeCatalog()).rejects.toThrow('EXPERIENCE_OWNER_REQUIRED')
      await expect(control.downloadTheme({ expectedRevision: f.state.revision, source: library.source, id: custom().id })).rejects.toThrow('EXPERIENCE_OWNER_REQUIRED')
      expect(library.requests).toEqual([])
      expect(await f.bytes()).toBe(before)
      for (const name of ['themeCatalog', 'downloadTheme']) expect(RPC_REMOTE.descriptors!.find(value => value.method === name)?.result.mode).toBe('strict')
      expect(RPC_REMOTE.descriptors!.find(value => value.method === 'downloadTheme')?.parameters[0]?.codec.mode).toBe('strict')
    } finally { await ctx.fiber.dispose() }
  })
})
