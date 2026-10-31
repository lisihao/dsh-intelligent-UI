import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactLimitError, ArtifactNotFoundError, ArtifactTooLargeError, ExperienceStore, RevisionConflictError, WidgetStateRevisionConflictError, WidgetStateTooLargeError } from '../src/store.js'
import { appearanceSchema, defaultAppearance, type PublishInput } from '../src/contracts.js'

const roots: string[] = []
async function root() { const path = await mkdtemp(join(tmpdir(), 'experience-store-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

const record = (sessionId: string, label = 'fixture'): PublishInput => ({
  source: { sessionId, kind: 'tool', label, callId: 'call-1' }, protocol: 'content', raw: { exact: ['source', 1] },
  payload: { rendered: true }, providerId: 'fixture-provider',
})

describe('ExperienceStore', () => {
  it('starts with defaults, persists revisioned settings and restores them in a new instance', async () => {
    const path = await root(), first = new ExperienceStore(path)
    expect(await first.settings()).toMatchObject({ revision: 0, takeover: false })
    const saved = await first.saveSettings({ expectedRevision: 0, takeover: true, openui: false, mcpApps: true })
    expect(saved.revision).toBe(1)
    await expect(first.saveSettings({ expectedRevision: 0, takeover: false, openui: true, mcpApps: false })).rejects.toBeInstanceOf(RevisionConflictError)
    expect(await new ExperienceStore(path).settings()).toEqual(saved)
  })

  it('reads legacy version-one settings and interprets omitted appearance with defaults without rewriting the file', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const legacy = { formatVersion: 1, revision: 7, takeover: true, openui: false, mcpApps: true }
    const text = JSON.stringify(legacy)
    await writeFile(join(path, 'settings.json'), text)
    const loaded = await store.settings()
    expect(loaded).toEqual(legacy)
    expect(loaded.appearance ?? defaultAppearance()).toEqual({ backgroundColor: '#24262b', translucent: true })
    expect(await readFile(join(path, 'settings.json'), 'utf8')).toBe(text)
    expect((await new ExperienceStore(await root()).settings()).appearance).toEqual(defaultAppearance())
  })

  it('roundtrips appearance through durable settings and preserves it when an older caller omits it', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const appearance = { backgroundColor: '#A1b2C3', translucent: false }
    const saved = await store.saveSettings({ expectedRevision: 0, takeover: false, openui: true, mcpApps: false, appearance })
    expect(saved).toMatchObject({ revision: 1, appearance })
    expect(await new ExperienceStore(path).settings()).toEqual(saved)
    const fromLegacyCaller = await store.saveSettings({ expectedRevision: 1, takeover: true, openui: false, mcpApps: true })
    expect(fromLegacyCaller).toMatchObject({ revision: 2, appearance, takeover: true, openui: false, mcpApps: true })
    expect(JSON.parse(await readFile(join(path, 'settings.json'), 'utf8'))).toEqual(fromLegacyCaller)
    await expect(store.saveSettings({ expectedRevision: 1, takeover: false, openui: true, mcpApps: false, appearance: defaultAppearance() })).rejects.toBeInstanceOf(RevisionConflictError)
    expect(await new ExperienceStore(path).settings()).toEqual(fromLegacyCaller)
  })

  it('rejects malformed appearance at both the save and stored-file boundaries', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const flags = { takeover: false, openui: true, mcpApps: false }
    for (const backgroundColor of ['#abc', '#12345678', 'red', '#12345g', 'url(https://example.com)']) {
      expect(() => store.saveSettings({ expectedRevision: 0, ...flags, appearance: { backgroundColor, translucent: true } })).toThrow()
      await writeFile(join(path, 'settings.json'), JSON.stringify({ formatVersion: 1, revision: 0, ...flags, appearance: { backgroundColor, translucent: true } }))
      await expect(store.settings()).rejects.toThrow(/Invalid stored data.*settings\.json/)
    }
    expect(appearanceSchema.safeParse({ ...defaultAppearance(), opacity: 0.5 }).success).toBe(false)
    expect(appearanceSchema.safeParse({ backgroundColor: '#24262b', translucent: 'true' }).success).toBe(false)
  })

  it('serializes competing compare-and-save operations so only one expected revision wins', async () => {
    const store = new ExperienceStore(await root())
    const results = await Promise.allSettled([
      store.saveSettings({ expectedRevision: 0, takeover: true, openui: true, mcpApps: false }),
      store.saveSettings({ expectedRevision: 0, takeover: false, openui: false, mcpApps: true }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof RevisionConflictError)).toHaveLength(1)
  })

  it('notifies current subscribers only after a successful durable save', async () => {
    const store = new ExperienceStore(await root()), seen: number[] = []
    const unsubscribe = store.subscribe((settings) => seen.push(settings.revision))
    await store.saveSettings({ expectedRevision: 0, takeover: true, openui: true, mcpApps: false })
    unsubscribe()
    await store.saveSettings({ expectedRevision: 1, takeover: false, openui: true, mcpApps: false })
    expect(seen).toEqual([1])
  })

  it('persists untouched source and keeps session reads isolated', async () => {
    const path = await root(), store = new ExperienceStore(path), input = record('s/one')
    const saved = await store.publish(input)
    expect(saved.raw).toEqual(input.raw)
    expect(await new ExperienceStore(path).artifacts({ sessionId: 'elsewhere' })).toEqual([])
    const session = await store.artifacts({ sessionId: 's/one' })
    expect(session).toEqual([saved])
    expect(session[0]?.source).toEqual(input.source)
  })

  it('rejects oversized records without truncating their source', async () => {
    const store = new ExperienceStore(await root(), { maxArtifactBytes: 100 })
    await expect(store.publish({ ...record('large'), raw: { original: 'x'.repeat(500) } })).rejects.toBeInstanceOf(ArtifactTooLargeError)
    expect(await store.artifacts({ sessionId: 'large' })).toEqual([])
  })

  it('rejects additions beyond the per-session file bound instead of dropping older source', async () => {
    const store = new ExperienceStore(await root(), { maxArtifactsPerSession: 1 })
    const first = await store.publish(record('bounded', 'first'))
    await expect(store.publish(record('bounded', 'second'))).rejects.toBeInstanceOf(ArtifactLimitError)
    expect(await store.artifacts({ sessionId: 'bounded' })).toEqual([first])
  })

  it('reports malformed and unknown version files by name', async () => {
    const path = await root(), store = new ExperienceStore(path)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'settings.json'), '{broken')
    await expect(store.settings()).rejects.toThrow(/Malformed stored data/)
    await writeFile(join(path, 'settings.json'), JSON.stringify({ formatVersion: 99 }))
    await expect(store.settings()).rejects.toThrow(/Unknown format version.*99/)
  })

  it('stores widget state per artifact, restores it, and compare-and-saves one revision at a time', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const first = await store.publish(record('session-a'))
    const second = await store.publish(record('session-a', 'second'))
    expect(await store.widgetState({ sessionId: 'session-a', artifactId: first.id })).toEqual({ formatVersion: 1, revision: 0, state: {} })
    const saved = await store.saveWidgetState({ sessionId: 'session-a', artifactId: first.id, expectedRevision: 0, state: { selected: 'overview', expanded: true } })
    expect(saved).toEqual({ formatVersion: 1, revision: 1, state: { selected: 'overview', expanded: true } })
    await expect(store.saveWidgetState({ sessionId: 'session-a', artifactId: first.id, expectedRevision: 0, state: { stale: true } })).rejects.toBeInstanceOf(WidgetStateRevisionConflictError)
    expect(await new ExperienceStore(path).widgetState({ sessionId: 'session-a', artifactId: first.id })).toEqual(saved)
    expect(await store.widgetState({ sessionId: 'session-a', artifactId: second.id })).toEqual({ formatVersion: 1, revision: 0, state: {} })
  })

  it('rejects cross-session widget state reads and writes even when the artifact id is valid', async () => {
    const store = new ExperienceStore(await root())
    const artifact = await store.publish(record('owner-session'))
    await expect(store.widgetState({ sessionId: 'other-session', artifactId: artifact.id })).rejects.toBeInstanceOf(ArtifactNotFoundError)
    await expect(store.saveWidgetState({ sessionId: 'other-session', artifactId: artifact.id, expectedRevision: 0, state: { x: 1 } })).rejects.toBeInstanceOf(ArtifactNotFoundError)
  })

  it('serializes concurrent widget state CAS writes and enforces a byte bound without truncating state', async () => {
    const path = await root(), store = new ExperienceStore(path)
    const artifact = await store.publish(record('bounded-state'))
    const concurrent = await Promise.allSettled([
      store.saveWidgetState({ sessionId: 'bounded-state', artifactId: artifact.id, expectedRevision: 0, state: { a: 1 } }),
      store.saveWidgetState({ sessionId: 'bounded-state', artifactId: artifact.id, expectedRevision: 0, state: { b: 2 } }),
    ])
    expect(concurrent.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter((item) => item.status === 'rejected' && item.reason instanceof WidgetStateRevisionConflictError)).toHaveLength(1)
    const limited = new ExperienceStore(path, { maxArtifactBytes: 300 })
    await expect(limited.saveWidgetState({ sessionId: 'bounded-state', artifactId: artifact.id, expectedRevision: 1, state: { value: 'x'.repeat(500) } })).rejects.toBeInstanceOf(WidgetStateTooLargeError)
    expect((await store.widgetState({ sessionId: 'bounded-state', artifactId: artifact.id })).revision).toBe(1)
  })
})
