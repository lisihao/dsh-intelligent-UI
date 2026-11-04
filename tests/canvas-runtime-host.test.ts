import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CANVAS_UI_COMPONENTS } from '../src/canvas-catalog.js'
import { CANVAS_UI_LICENSE_TEXT } from '../src/canvas-license.js'
import { CANVAS_RUNTIME_PATH, CANVAS_RUNTIME_REVISION, installCanvasRuntimeHost, verifyCanvasSource, type CanvasRuntimeHostOptions } from '../src/canvas-runtime-host.js'
import { CANVAS_SOURCE_MANIFEST, canvasSourceEntry } from '../src/canvas-source-manifest.js'
import { THREE_LICENSE_TEXT } from '../src/three-license.js'

type Route = { path: string, methods: readonly string[], requestBody: string, fetch: (request: Request) => Promise<Response> }

function harness(options: CanvasRuntimeHostOptions = {}) {
  let route: Route | undefined
  const owned: Array<() => void | Promise<void>> = []
  const unregister = vi.fn(async () => { route = undefined })
  const ctx = {
    connection: { fetch: { register(value: Route) { route = value; owned.push(unregister); return unregister } } },
    effect(create: () => () => void | Promise<void>) { const dispose = create(); owned.push(dispose); return dispose },
  } as unknown as Context
  const dispose = installCanvasRuntimeHost(ctx, options)
  return {
    get route() { return route }, unregister, dispose,
    async disposeOwner() { for (const close of [...owned].reverse()) await close() },
    async get(query: string) {
      return route ? route.fetch(new Request(`http://127.0.0.1${CANVAS_RUNTIME_PATH}?${query}`)) : new Response(null, { status: 404 })
    },
  }
}

const query = (slug: string, attempt?: string) => new URLSearchParams({ slug, revision: CANVAS_RUNTIME_REVISION, ...(attempt === undefined ? {} : { attempt }) }).toString()

describe('Canvas UI runtime host', () => {
  it('maps each catalog entry to exactly one pinned source, plus the three shared files', () => {
    const entries = CANVAS_UI_COMPONENTS.map(component => canvasSourceEntry(component.slug))
    expect(entries).toHaveLength(35)
    expect(entries.every(Boolean)).toBe(true)
    expect(new Set(entries).size).toBe(35)
    expect(Object.keys(CANVAS_SOURCE_MANIFEST)).toHaveLength(38)
    expect(canvasSourceEntry('../asciify')).toBeUndefined()
    for (const metadata of Object.values(CANVAS_SOURCE_MANIFEST)) {
      expect(metadata.size).toBeGreaterThan(0)
      expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('rejects unknown paths and source bytes that do not match both size and SHA-256', () => {
    expect(() => verifyCanvasSource('../../outside', new Uint8Array())).toThrow(/不在固定清单/)
    const entry = canvasSourceEntry('asciify')!
    expect(() => verifyCanvasSource(entry, new Uint8Array())).toThrow(/校验失败/)
    expect(() => verifyCanvasSource(entry, new Uint8Array(CANVAS_SOURCE_MANIFEST[entry]!.size))).toThrow(/校验失败/)
  })

  it('accepts only the exact route, known slug, revision and optional numeric attempt', async () => {
    const buildModule = vi.fn(async () => 'export const ok = true;')
    const host = harness({ buildModule })
    expect(host.route).toMatchObject({ path: CANVAS_RUNTIME_PATH, methods: ['GET'], requestBody: 'buffered' })
    for (const invalid of [
      '', `slug=asciify&revision=wrong`, query('../asciify'), `${query('asciify')}&slug=asciify`,
      `${query('asciify')}&url=https://example.test/x`, query('asciify', '-1'), query('asciify', '1000000'),
    ]) {
      expect((await host.get(invalid)).status).toBe(400)
    }
    expect(buildModule).not.toHaveBeenCalled()
    const response = await host.get(query('asciify', '2'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('export const ok')
    await host.dispose()
    expect((await host.get(query('asciify'))).status).toBe(404)
  })

  it('deduplicates concurrent requests and ignores attempt in the module cache key', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const buildModule = vi.fn(async () => { await gate; return 'export const value = 4;' })
    const host = harness({ buildModule })
    const first = host.get(query('asciify'))
    const second = host.get(query('asciify', '1'))
    await vi.waitFor(() => expect(buildModule).toHaveBeenCalledTimes(1))
    release()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect((await host.get(query('asciify', '2'))).status).toBe(200)
    expect(buildModule).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('limits distinct builds to two and starts queued work when a slot is released', async () => {
    const releases = new Map<string, () => void>()
    const buildModule = vi.fn((entry: string) => new Promise<string>(resolve => {
      releases.set(entry, () => resolve('export const ok = true;'))
    }))
    const host = harness({ buildModule })
    const requests = ['asciify', 'ink-object', 'ripple'].map(slug => host.get(query(slug)))
    await vi.waitFor(() => expect(buildModule).toHaveBeenCalledTimes(2))
    expect(releases.has(canvasSourceEntry('ripple')!)).toBe(false)
    releases.get(canvasSourceEntry('asciify')!)!()
    await vi.waitFor(() => expect(buildModule).toHaveBeenCalledTimes(3))
    releases.get(canvasSourceEntry('ink-object')!)!()
    releases.get(canvasSourceEntry('ripple')!)!()
    expect((await Promise.all(requests)).map(response => response.status)).toEqual([200, 200, 200])
    await host.dispose()
  })

  it('cancels queued builds on disposal without starting them', async () => {
    const buildModule = vi.fn((_entry: string, _load: unknown, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const host = harness({ buildModule })
    const requests = ['asciify', 'ink-object', 'ripple'].map(slug => host.get(query(slug)))
    await vi.waitFor(() => expect(buildModule).toHaveBeenCalledTimes(2))
    await host.dispose()
    expect((await Promise.all(requests)).map(response => response.status)).toEqual([503, 503, 503])
    expect(buildModule).toHaveBeenCalledTimes(2)
  })

  it('surfaces a source-integrity failure and downloads only a pinned official path', async () => {
    const entry = canvasSourceEntry('asciify')!
    const fetchSource = vi.fn(async (_url: string, _signal: AbortSignal) => new Response(new Uint8Array(CANVAS_SOURCE_MANIFEST[entry]!.size)))
    const host = harness({ fetchSource, buildModule: async (path, load) => { await load(path); return 'export const ok = true;' } })
    const response = await host.get(query('asciify'))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('CANVAS_SOURCE_INTEGRITY')
    expect(fetchSource).toHaveBeenCalledTimes(1)
    expect(fetchSource.mock.calls[0]![0]).toBe(`https://raw.githubusercontent.com/DavidHDev/canvas-ui/${CANVAS_RUNTIME_REVISION}/${entry}`)
    await host.dispose()
  })

  it('preserves the integrity and offline errors across the real wasm compiler', async () => {
    const invalid = harness({ fetchSource: async () => new Response('wrong source') })
    const broken = await invalid.get(query('asciify'))
    expect(broken.status).toBe(502)
    expect((await broken.json()).code).toBe('CANVAS_SOURCE_INTEGRITY')
    await invalid.dispose()

    const offline = harness({ fetchSource: async () => { throw new Error('network unavailable') } })
    const unavailable = await offline.get(query('asciify'))
    expect(unavailable.status).toBe(503)
    expect((await unavailable.json()).code).toBe('CANVAS_SOURCE_UNAVAILABLE')
    await offline.dispose()
  })

  it('does not cache a failed build and exposes a useful error before a retry', async () => {
    const buildModule = vi.fn().mockRejectedValueOnce(new Error('compile failed')).mockResolvedValueOnce('export const retried = true;')
    const host = harness({ buildModule })
    const first = await host.get(query('asciify'))
    expect(first.status).toBe(502)
    expect((await first.json()).code).toBe('CANVAS_BUILD_FAILED')
    expect((await host.get(query('asciify', '1'))).status).toBe(200)
    expect(buildModule).toHaveBeenCalledTimes(2)
    await host.dispose()
  })

  it('aborts in-flight downloads and removes the route when its owner is disposed', async () => {
    let started!: (signal: AbortSignal) => void
    const signalReady = new Promise<AbortSignal>(resolve => { started = resolve })
    const fetchSource = vi.fn((_url: string, signal: AbortSignal) => new Promise<Response>((_resolve, reject) => {
      started(signal)
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const host = harness({ fetchSource, buildModule: async (entry, load) => { await load(entry); return 'export const ok = true;' } })
    const request = host.get(query('asciify'))
    const signal = await signalReady
    await host.disposeOwner()
    expect(signal.aborted).toBe(true)
    const response = await request
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('CANVAS_RUNTIME_STOPPED')
    expect((await host.get(query('asciify'))).status).toBe(404)
  })

  it('waits for the real compiler process to stop when its owner is disposed', async () => {
    let started!: (signal: AbortSignal) => void
    const signalReady = new Promise<AbortSignal>(resolve => { started = resolve })
    const host = harness({ fetchSource: (_url, signal) => new Promise<Response>((_resolve, reject) => {
      started(signal)
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    const request = host.get(query('asciify'))
    const signal = await signalReady
    await host.disposeOwner()
    expect(signal.aborted).toBe(true)
    const response = await request
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('CANVAS_RUNTIME_STOPPED')
    expect((await host.get(query('asciify'))).status).toBe(404)
  }, 15_000)

  it.skipIf(process.env.CANVAS_RUNTIME_PROCESS_TESTS !== '1')('reaps a stalled compiler and its service process group', async () => {
    const listProcesses = () => {
      const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`Cannot inspect test processes: ${result.error?.message ?? result.status}`)
      return result.stdout.split('\n').flatMap(line => {
        const fields = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
        return fields ? [{ pid: Number(fields[1]), parent: Number(fields[2]), command: fields[3]! }] : []
      })
    }
    const isGone = (pid: number) => {
      try { process.kill(pid, 0); return false }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error }
    }
    let started!: () => void
    const signalReady = new Promise<void>(resolve => { started = resolve })
    const host = harness({ fetchSource: (_url, signal) => new Promise<Response>((_resolve, reject) => {
      started()
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    const request = host.get(query('asciify'))
    let helper: number | undefined
    let service: number | undefined
    try {
      await signalReady
      const processes = listProcesses()
      const helpers = processes.filter(item => item.parent === process.pid && item.command.includes('canvas-build-worker.'))
      expect(helpers).toHaveLength(1)
      helper = helpers[0]!.pid
      const services = processes.filter(item => item.parent === helper && item.command.includes('/esbuild-wasm/bin/esbuild'))
      expect(services).toHaveLength(1)
      service = services[0]!.pid
      process.kill(helper, 'SIGSTOP')
      const startedAt = Date.now()
      await host.dispose()
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1800)
      expect((await request).status).toBe(503)
      await vi.waitFor(() => { expect(isGone(helper!)).toBe(true); expect(isGone(service!)).toBe(true) }, { timeout: 4_000 })
    } finally {
      if (helper && (!isGone(helper) || (service && !isGone(service)))) {
        try { process.kill(-helper, 'SIGKILL') } catch { /* Already terminated. */ }
      }
      await host.dispose()
    }
  }, 15_000)

  it('waits for an in-flight builder to settle during asynchronous disposal', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const buildModule = vi.fn(async () => { await gate; return 'export const late = true;' })
    const host = harness({ buildModule })
    const request = host.get(query('asciify'))
    await vi.waitFor(() => expect(buildModule).toHaveBeenCalledTimes(1))
    let finished = false
    const disposing = host.dispose().then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    release()
    await disposing
    expect((await request).status).toBe(503)
    expect(host.unregister).toHaveBeenCalledTimes(1)
  })

  it('keeps the parent active without Connection and cleans up a real injected child fiber', async () => {
    const root = new Context()
    let active: Route | undefined
    let started!: (signal: AbortSignal) => void
    const signalReady = new Promise<AbortSignal>(resolve => { started = resolve })
    class ConnectionFixture extends Service {
      constructor(ctx: Context) { super(ctx, 'connection') }
      get fetch() {
        const owner = this.ctx
        return { register(value: Route) { return owner.effect(() => { active = value; return () => { active = undefined } }) } }
      }
    }
    const consumer = await root.plugin({
      name: 'optional-canvas-runtime-fixture',
      apply(ctx) {
        ctx.inject(['connection'], connectionCtx => {
          installCanvasRuntimeHost(connectionCtx, { buildModule: async (_entry, _load, signal) => {
            started(signal)
            await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
            return 'export const unused = true;'
          } })
        })
      },
    })
    expect(active).toBeUndefined()
    const provider = await root.plugin({ name: 'connection-fixture', apply(ctx) { new ConnectionFixture(ctx) } })
    await vi.waitFor(() => expect(active).toBeDefined())
    const request = active!.fetch(new Request(`http://127.0.0.1${CANVAS_RUNTIME_PATH}?${query('asciify')}`))
    const signal = await signalReady
    await consumer.dispose()
    expect(signal.aborted).toBe(true)
    expect(active).toBeUndefined()
    expect((await request).status).toBe(503)
    expect(root.get('connection')).toBeDefined()
    await provider.dispose()
  })
})

const fixtureRoot = process.env.CANVAS_RUNTIME_FIXTURE_ROOT
describe.skipIf(!fixtureRoot)('real local source plus installed wasm/three dependencies', () => {
  it.each([['asciify', 'createAsciify'], ['ink-object', 'createInkObject']])('builds a self-contained %s ESM module', async (slug, createName) => {
    const fetchSource = async (url: string) => {
      const prefix = `/${CANVAS_RUNTIME_REVISION}/`
      const path = new URL(url).pathname.split(prefix)[1]
      if (!path) throw new Error('fixture URL has no fixed revision')
      return new Response(await readFile(join(fixtureRoot!, path)))
    }
    const host = harness({ fetchSource })
    const response = await host.get(query(slug))
    if (response.status !== 200) throw new Error(`build failed: ${response.status} ${await response.text()}`)
    const js = await response.text()
    const temporary = await mkdtemp(join(tmpdir(), 'canvas-module-test-'))
    try {
      const file = join(temporary, `${slug}.mjs`)
      await writeFile(file, js)
      const module = await import(/* @vite-ignore */ pathToFileURL(file).href)
      expect(typeof module[createName]).toBe('function')
      expect(js).toContain(CANVAS_UI_LICENSE_TEXT.replaceAll('*/', '* /'))
      expect(js).toContain(THREE_LICENSE_TEXT.replaceAll('*/', '* /'))
      expect(js).not.toMatch(/^\s*import\s+(?:[^(']|["'])/m)
    } finally {
      await host.dispose()
      await rm(temporary, { recursive: true, force: true })
    }
  }, 60_000)
})
