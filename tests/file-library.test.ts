import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExperienceArtifact, PublishInput } from '../src/contracts.js'
import { isLocalImport, LOCAL_FILE_SCOPE, LOCAL_IMPORT_PROVIDER } from '../src/file-library-contracts.js'
import { ExperienceStore, StoredDataError } from '../src/store.js'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'experience-library-'))
  roots.push(path)
  return path
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function artifact(id: string, sessionId: string, providerId: string, label: string, createdAt: string, kind: ExperienceArtifact['source']['kind'] = 'generated'): ExperienceArtifact {
  return {
    formatVersion: 1, id, createdAt, source: { sessionId, kind, label }, protocol: 'content',
    raw: '\uFEFF原始文本\r\n', payload: { precise: '1.00', unit: 'USD' }, providerId,
  }
}
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006'] as const
async function put(path: string, item: ExperienceArtifact): Promise<string> {
  const dir = join(path, 'artifacts', encodeURIComponent(item.source.sessionId))
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${item.id}.json`)
  await writeFile(file, `${JSON.stringify(item)}\n`)
  return file
}

describe('local file library', () => {
  it('returns an empty library without creating a missing storage root', async () => {
    const path = join(await root(), 'absent')
    expect(await new ExperienceStore(path).localFiles()).toEqual([])
    await expect(readFile(join(path, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recognizes explicit imports and only the exact old importer convention', () => {
    const sample = artifact(ids[0], 'session', LOCAL_IMPORT_PROVIDER, 'data.json', '2026-11-01T00:00:00.000Z')
    expect(isLocalImport(sample)).toBe(true)
    expect(isLocalImport({ ...sample, providerId: 'content', source: { ...sample.source, label: '本地导入：旧文件.md · 原始来源' } })).toBe(true)
    expect(isLocalImport({ ...sample, providerId: 'content', source: { ...sample.source, label: '其他本地导入：文件.md' } })).toBe(false)
    expect(isLocalImport({ ...sample, providerId: 'another-provider', source: { ...sample.source, label: '本地导入：文件.md' } })).toBe(false)
    expect(isLocalImport({ ...sample, source: { ...sample.source, kind: 'tool', label: '本地导入：文件.md' } })).toBe(false)
    expect(isLocalImport({ ...sample, source: { ...sample.source, kind: 'assistant' } })).toBe(false)
  })

  it('finds new and legacy files across canonical scopes, excluding unrelated artifacts and symlinks', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const a = artifact(ids[0], 'session/a', 'content', '本地导入：old.md', '2026-10-31T00:00:00.000Z')
    const b = artifact(ids[1], LOCAL_FILE_SCOPE, LOCAL_IMPORT_PROVIDER, 'new.json', '2026-11-01T00:00:00.000Z')
    const c = artifact(ids[2], 'session 中', 'content', '本地导入：equal.txt', '2026-11-01T00:00:00.000Z')
    const unrelated = artifact(ids[3], 'session/a', 'content', '一般生成内容', '2026-11-02T00:00:00.000Z')
    const tool = artifact(ids[4], 'session/a', LOCAL_IMPORT_PROVIDER, '本地导入：工具', '2026-11-03T00:00:00.000Z', 'tool')
    const storedPaths = await Promise.all([a, b, c, unrelated, tool].map(item => put(path, item)))
    const originals = await Promise.all(storedPaths.map(file => readFile(file)))

    const outside = join(path, 'external')
    await mkdir(outside)
    await writeFile(join(outside, `${ids[5]}.json`), JSON.stringify(artifact(ids[5], 'ignored', LOCAL_IMPORT_PROVIDER, 'outside.md', '2030')))
    await symlink(outside, join(path, 'artifacts', 'ignored'))
    await mkdir(join(path, 'artifacts', 'invalid%2fscope'))
    await writeFile(join(path, 'artifacts', 'invalid%2fscope', 'broken.json'), '{broken')
    await mkdir(join(path, 'artifacts', 'invalid%'))
    await writeFile(join(path, 'artifacts', 'invalid%', 'broken.json'), '{broken')

    expect(await store.localFiles()).toEqual([b, c, a])
    expect(await store.localFiles()).toEqual([b, c, a])
    expect(await Promise.all(storedPaths.map(file => readFile(file)))).toEqual(originals)
    expect(await store.artifacts({ sessionId: 'session/a' })).toEqual([a, unrelated, tool])
  })

  it('persists exact source text and JSON payload across store instances', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const raw = '\uFEFF{\r\n  "text": "汉字", "amount": 1.00\r\n}\r\n'
    const input: PublishInput = {
      source: { sessionId: LOCAL_FILE_SCOPE, kind: 'generated', label: '本地导入：sample.json' },
      protocol: 'content', providerId: LOCAL_IMPORT_PROVIDER, raw, payload: JSON.parse(raw.slice(1)),
    }
    const saved = await store.publish(input)
    const file = join(path, 'artifacts', encodeURIComponent(LOCAL_FILE_SCOPE), `${saved.id}.json`)
    const bytesBefore = await readFile(file)
    const found = await new ExperienceStore(path).localFiles()
    expect(found).toEqual([saved])
    expect(Buffer.from(found[0]!.raw as string, 'utf8')).toEqual(Buffer.from(raw, 'utf8'))
    expect(found[0]!.payload).toEqual(input.payload)
    expect(await readFile(file)).toEqual(bytesBefore)
  })

  it('surfaces malformed and unsupported stored versions without rewriting them', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const dir = join(path, 'artifacts', encodeURIComponent('old-session'))
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'corrupt.json')
    await writeFile(file, '{broken')
    await expect(store.localFiles()).rejects.toBeInstanceOf(StoredDataError)
    await expect(store.localFiles()).rejects.toThrow(/Malformed stored data.*corrupt\.json/)
    expect(await readFile(file, 'utf8')).toBe('{broken')
    const unsupported = '{"formatVersion":99}'
    await writeFile(file, unsupported)
    await expect(store.localFiles()).rejects.toBeInstanceOf(StoredDataError)
    await expect(store.localFiles()).rejects.toThrow(/Unknown format version.*corrupt\.json.*99/)
    expect(await readFile(file, 'utf8')).toBe(unsupported)
  })
})
