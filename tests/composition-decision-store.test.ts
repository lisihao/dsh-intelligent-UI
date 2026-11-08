import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdaptiveCompositionSettings, ComposeInput, CompositionResult, JevCompositionPort, JevJudgeOnceOptions, JevJudgeOnceResult } from '../src/adaptive-ui/contracts.js'
import { DECISION_STORE_FORMAT_VERSION, PersistedDecisionStore, RESTORED_DECISION_REASON } from '../src/adaptive-ui/decision-store.js'
import { AdaptiveCompositionCoordinator, decisionKey } from '../src/adaptive-ui/host.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function file(): string { const dir = mkdtempSync(join(tmpdir(), 'iexp-decisions-')); dirs.push(dir); return join(dir, 'composition-decisions.json') }
const key = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`
function selected(sourceVersion = 'sha256:source', extra: Partial<CompositionResult> = {}): Omit<CompositionResult, 'requestId'> {
  return { status: 'selected', reason: 'JEV_COMPONENT_SELECTION_ADOPTED', sourceVersion, operationId: 'operation-1', selection: { themeId: 'empryo', surface: 'semantic', chart: 'auto', componentSet: 'native', objectEffect: 'none', layout: 'document' }, ...extra } as Omit<CompositionResult, 'requestId'>
}

class Port implements JevCompositionPort {
  calls = 0
  enabled = true
  mode: 'ok' | 'failed' = 'ok'
  connection = { connectionId: 'luna-openai', baseUrl: 'https://decisions.invalid/v1', model: 'test', credentialRef: 'REF_ONLY', timeoutMs: 1000 }
  registerFeature(): () => void { return () => undefined }
  isFeatureEnabled(): boolean { return this.enabled }
  judgmentConnectionIdentity() { return { ...this.connection } }
  onFeatureStateChange(): () => void { return () => undefined }
  async writeReceipt(): Promise<unknown> { return {} }
  async judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult> {
    this.calls += 1
    const operationId = `operation-${this.calls}`
    const signal = options.signal ?? new AbortController().signal
    const request = await options.refresh(signal)
    if (this.mode === 'failed') return { kind: 'failed', operationId, failure: { code: 'NETWORK', message: 'ignored' } }
    const response = { answers: request.questions.map(question => ({ id: question.id, kind: 'choice' as const, optionId: question.options[0]!.id })) }
    const interpreted = await options.interpret?.(response, signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId, reason: interpreted.reason }
    return { kind: 'ok', operationId, attemptId: `attempt-${this.calls}`, response }
  }
}

const saved = (activeId = 'empryo'): AdaptiveCompositionSettings => ({ takeover: true, adaptive: { enabled: true, styleMode: 'automatic' }, theme: { activeId, installed: [] } })
const request = (): ComposeInput => ({
  sessionId: 'session-1', documentId: 'document-1', requestId: 'request-1', styleMode: 'automatic', capabilities: { webgl: true, reducedMotion: false },
  value: '## 本周调用趋势\n\n| 日期 | 调用量（次） |\n| --- | ---: |\n| 2026-10-27 | 1,082 |\n| 2026-10-28 | 1,447 |\n| 2026-10-29 | 1,273 |',
})
/** One Host lifetime: a fresh coordinator over the same decision file, disposed at the end. */
async function lifetime(path: string, port: Port, settings = saved()) {
  const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings, getJev: () => port, decisions: PersistedDecisionStore.open(path, { writeDelayMs: 0 }) })
  try { return await coordinator.compose(request()) } finally { coordinator.dispose() }
}

describe('persisted composition decisions', () => {
  it('reuses an adopted decision after a restart without asking Jev or sending a receipt', async () => {
    const path = file(), port = new Port()
    const first = await lifetime(path, port)
    expect(first.status).toBe('selected')
    expect(port.calls).toBeGreaterThan(0)
    const calls = port.calls
    const second = await lifetime(path, port)
    expect(port.calls).toBe(calls)
    expect(second).toMatchObject({ status: 'selected', reason: RESTORED_DECISION_REASON, sourceVersion: first.sourceVersion, selection: first.selection })
    expect(second.operationId).toBeUndefined()
  })

  it('asks Jev again when the theme or the Jev connection changes, and never restores while Jev is off', async () => {
    const path = file(), port = new Port()
    await lifetime(path, port)
    let calls = port.calls
    await lifetime(path, port, saved('ascii'))
    expect(port.calls).toBeGreaterThan(calls); calls = port.calls
    port.connection = { ...port.connection, model: 'other' }
    await lifetime(path, port)
    expect(port.calls).toBeGreaterThan(calls); calls = port.calls
    port.enabled = false
    const off = await lifetime(path, port)
    expect(off.status).toBe('local')
    expect(port.calls).toBe(calls)
  })

  it('does not keep a failed decision, so the next lifetime retries', async () => {
    const path = file(), port = new Port()
    port.mode = 'failed'
    expect((await lifetime(path, port)).status).toBe('failed')
    const calls = port.calls
    port.mode = 'ok'
    expect((await lifetime(path, port)).status).toBe('selected')
    expect(port.calls).toBeGreaterThan(calls)
  })

  it('changes the saved key when the offered choices change', () => {
    const bundle = { revision: 1, identity: { id: 'a' }, questions: [{ id: 'q', options: [{ id: 'x' }, { id: 'y' }] }], defaultAnswers: { q: 'x' } } as unknown as Parameters<typeof decisionKey>[1]
    const same = decisionKey('sha256:f', bundle)
    expect(decisionKey('sha256:f', bundle)).toBe(same)
    expect(decisionKey('sha256:f', { ...bundle, questions: [{ id: 'q', options: [{ id: 'x' }, { id: 'z' }] }] } as unknown as typeof bundle)).not.toBe(same)
    expect(decisionKey('sha256:f', { ...bundle, revision: 2 } as unknown as typeof bundle)).not.toBe(same)
    expect(decisionKey('sha256:g', bundle)).not.toBe(same)
  })

  it('stores only selected results, without operation ids, and checks the source version on read', () => {
    const path = file()
    const store = PersistedDecisionStore.open(path, { writeDelayMs: 0 })
    store.put(key(1), selected())
    store.put(key(2), { status: 'failed', reason: 'JEV_FAILURE', sourceVersion: 'sha256:source' } as Omit<CompositionResult, 'requestId'>)
    store.flush()
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    expect(raw.formatVersion).toBe(DECISION_STORE_FORMAT_VERSION)
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0].result.operationId).toBeUndefined()
    const reopened = PersistedDecisionStore.open(path)
    expect(reopened.get(key(1), 'sha256:source')).toMatchObject({ status: 'selected', reason: RESTORED_DECISION_REASON })
    expect(reopened.get(key(1), 'sha256:other')).toBeUndefined()
    expect(reopened.get(key(2), 'sha256:source')).toBeUndefined()
  })

  it('evicts the oldest decisions to stay within both the entry and byte budgets', () => {
    const byCount = PersistedDecisionStore.open(file(), { maxEntries: 2, writeDelayMs: 0 })
    for (const n of [1, 2, 3]) byCount.put(key(n), selected())
    expect(byCount.get(key(1), 'sha256:source')).toBeUndefined()
    expect(byCount.get(key(3), 'sha256:source')).toBeDefined()
    const one = JSON.stringify({ key: key(1), savedAt: new Date().toISOString(), result: { ...selected(), operationId: undefined } }).length
    const byBytes = PersistedDecisionStore.open(file(), { maxBytes: one * 2 + 10, writeDelayMs: 0 })
    for (const n of [1, 2, 3]) byBytes.put(key(n), selected())
    expect(byBytes.size).toBe(2)
    expect(byBytes.get(key(1), 'sha256:source')).toBeUndefined()
  })

  it('writes atomically through a private temporary file and never on a read', () => {
    const path = file()
    const store = PersistedDecisionStore.open(path, { writeDelayMs: 0 })
    store.put(key(1), selected()); store.flush()
    expect(readdirSync(join(path, '..')).filter(name => name.endsWith('.tmp'))).toEqual([])
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const before = readFileSync(path, 'utf8')
    const reopened = PersistedDecisionStore.open(path, { writeDelayMs: 0 })
    reopened.get(key(1), 'sha256:source'); reopened.flush()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('leaves a newer format untouched and keeps decisions in memory only', () => {
    const path = file(), warn = vi.fn()
    writeFileSync(path, JSON.stringify({ formatVersion: 99, entries: [] }))
    const store = PersistedDecisionStore.open(path, { warn, writeDelayMs: 0 })
    expect(store.persisting).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/COMPOSITION_DECISIONS_FORMAT_UNKNOWN/))
    store.put(key(1), selected()); store.flush()
    expect(JSON.parse(readFileSync(path, 'utf8')).formatVersion).toBe(99)
  })

  it('moves an unreadable file aside, skips invalid entries, and keeps working', () => {
    const path = file(), warn = vi.fn()
    writeFileSync(path, '{not json')
    const store = PersistedDecisionStore.open(path, { warn, writeDelayMs: 0 })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/COMPOSITION_DECISIONS_INVALID_JSON/))
    expect(readdirSync(join(path, '..')).some(name => name.includes('.invalid-'))).toBe(true)
    store.put(key(1), selected()); store.flush()
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    raw.entries.push({ key: 'not-a-key', savedAt: 'x', result: selected() }, { key: key(2), savedAt: 'x', result: { ...selected(), status: 'failed' } })
    writeFileSync(path, JSON.stringify(raw))
    const reopened = PersistedDecisionStore.open(path)
    expect(reopened.size).toBe(1)
  })
})
