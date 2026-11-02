import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { ResearchStore, hashReport, validateResearchAnalysis } from '../src/research-store.js'
import { installResearch, ResearchControl, RESEARCH_TOOL } from '../src/research-host.js'
import type { ResearchAnalysis, ResearchDocument } from '../src/research-contracts.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function store() { const root = await mkdtemp(join(tmpdir(), 'research-backend-')); roots.push(root); return new ResearchStore(root) }
const doc: ResearchDocument = { sessionId: 'session-one', documentId: '../source:one', text: '😀 The value grew 20%. [Report](https://example.test/report)' }
function analysis(text = doc.text): ResearchAnalysis {
  const quote = 'The value grew 20%.'; const start = text.indexOf(quote)
  return { formatVersion: 1, reportHash: hashReport(text), question: 'What changed?', claims: [{ id: 'growth', text: quote, kind: 'observation', anchor: { start, end: start + quote.length, quote }, conditions: ['Reported period'], evidence: [{ id: 'source', relation: 'citation', anchor: { start, end: start + quote.length, quote }, sourceUrl: 'https://example.test/report' }], openQuestions: ['Was the scope constant?'] }] }
}
async function prepare(s: ResearchStore, input = doc) { const state = await s.get(input); return s.prepare({ ...input, expectedRevision: state.revision }) }

test('validates UTF16 exact quotes, hash, unique IDs and report-local noncredential references', () => {
  expect(validateResearchAnalysis(analysis(), doc.text).claims[0]?.anchor.start).toBe(3)
  const invalid = analysis(); invalid.claims[0]!.anchor.start = 2
  expect(() => validateResearchAnalysis(invalid, doc.text)).toThrow('RESEARCH_ANCHOR_MISMATCH')
  const fabricated = analysis(); fabricated.claims[0]!.evidence[0]!.sourceUrl = 'https://example.test/fabricated'
  expect(() => validateResearchAnalysis(fabricated, doc.text)).toThrow('RESEARCH_SOURCE_NOT_IN_REPORT')
  const partial = analysis(); partial.claims[0]!.evidence[0]!.sourceUrl = 'https://example.test'
  expect(() => validateResearchAnalysis(partial, doc.text)).toThrow('RESEARCH_SOURCE_NOT_IN_REPORT')
  const credentialText = doc.text + ' https://name:secret@example.test/report'
  const credential = analysis(credentialText); credential.claims[0]!.evidence[0]!.sourceUrl = 'https://name:secret@example.test/report'
  expect(() => validateResearchAnalysis(credential, credentialText)).toThrow('RESEARCH_SOURCE_NOT_IN_REPORT')
  const codeText = doc.text + ' `https://example.test/code-only`'
  const code = analysis(codeText); code.claims[0]!.evidence[0]!.sourceUrl = 'https://example.test/code-only'
  expect(() => validateResearchAnalysis(code, codeText)).toThrow('RESEARCH_SOURCE_NOT_IN_REPORT')
  const parenthesesText = doc.text + ' [Other](https://example.test/report_(2026))'
  const parentheses = analysis(parenthesesText); parentheses.claims[0]!.evidence[0]!.sourceUrl = 'https://example.test/report_(2026)'
  expect(validateResearchAnalysis(parentheses, parenthesesText).claims[0]?.evidence[0]?.sourceUrl).toBe('https://example.test/report_(2026)')
  const hash = analysis(); hash.reportHash = 'a'.repeat(64)
  expect(() => validateResearchAnalysis(hash, doc.text)).toThrow('RESEARCH_REPORT_HASH_MISMATCH')
  const duplicate = analysis(); duplicate.claims.push(structuredClone(duplicate.claims[0]!))
  expect(() => validateResearchAnalysis(duplicate, doc.text)).toThrow('RESEARCH_DUPLICATE_CLAIM_ID')
})

test('single active request, immutable snapshots, unknown outcomes and restart-safe idempotent receipts', async () => {
  const s = await store(); const result = await prepare(s)
  expect(result.prompt).toContain(JSON.stringify(doc.text)); expect(result.prompt).toContain('Do not research')
  await expect(s.prepare({ ...doc, expectedRevision: result.state.revision })).rejects.toThrow('RESEARCH_REQUEST_ALREADY_EXISTS')
  await expect(s.get({ ...doc, text: doc.text + ' changed' })).rejects.toThrow('RESEARCH_SOURCE_CHANGED_WITH_UNRESOLVED_REQUEST')
  await s.markSubmission({ ...doc, requestId: result.requestId, status: 'unknown', error: 'Transport outcome unavailable' })
  const restarted = new ResearchStore(join(s.root, '..'))
  expect((await restarted.get(doc)).request?.status).toBe('unknown')
  await expect(restarted.prepare({ ...doc, expectedRevision: 2 })).rejects.toThrow('RESEARCH_REQUEST_ALREADY_EXISTS')
  const complete = await restarted.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  expect(complete.request?.status).toBe('complete'); expect(complete.reviews).toEqual({})
  const again = await restarted.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  expect(again.revision).toBe(complete.revision)
  const conflict = analysis(); conflict.question = 'Another question'
  await expect(restarted.submit({ requestId: result.requestId, analysis: conflict }, doc.sessionId)).rejects.toThrow('RESEARCH_RECEIPT_CONFLICT')
  expect((await restarted.markSubmission({ ...doc, requestId: result.requestId, status: 'queued' })).revision).toBe(complete.revision)
  const current = await restarted.get({ ...doc, text: doc.text + ' changed' })
  expect(current.analysis).toBeUndefined(); expect(current.revision).toBe(complete.revision + 1)
  await expect(restarted.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)).rejects.toThrow('RESEARCH_STALE_REPORT')
})

test('CAS rejects stale, malformed and concurrent edits; human marks never originate in analysis', async () => {
  const s = await store(); const result = await prepare(s)
  await s.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  const state = await s.get(doc)
  const input = { ...doc, expectedRevision: state.revision, notes: { growth: 'Check scope' }, reviews: { growth: 'questioned' as const }, questions: ['What is omitted?'] }
  const values = await Promise.allSettled([s.saveNotes(input), s.saveNotes(input)])
  expect(values.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  expect(values.filter(value => value.status === 'rejected')).toHaveLength(1)
  await expect(s.saveNotes({ ...input, expectedRevision: -1 })).rejects.toThrow()
  await expect(s.saveNotes({ ...input, expectedRevision: Number.NaN })).rejects.toThrow()
  await expect(s.saveNotes({ ...input, expectedRevision: state.revision + 1, reviews: { invented: 'confirmed' } })).rejects.toThrow('RESEARCH_UNKNOWN_CLAIM')
  const persisted = await new ResearchStore(join(s.root, '..')).get(doc)
  expect(persisted.reviews).toEqual({ growth: 'questioned' }); expect(persisted.notes).toEqual(input.notes)
})

test('known failed queue permits only an explicit retry, old receipt cannot overwrite', async () => {
  const s = await store(); const old = await prepare(s)
  const failed = await s.markSubmission({ ...doc, requestId: old.requestId, status: 'failed', error: 'Queue rejected' })
  await expect(s.submit({ requestId: old.requestId, analysis: analysis() }, doc.sessionId)).rejects.toThrow('RESEARCH_REQUEST_TRANSITION_INVALID')
  const retry = await s.prepare({ ...doc, expectedRevision: failed.revision })
  expect(retry.requestId).not.toBe(old.requestId)
  await expect(s.submit({ requestId: old.requestId, analysis: analysis() }, doc.sessionId)).rejects.toThrow('RESEARCH_REQUEST_MISMATCH')
})

test('rejects cross-session or missing execution identity and bounds actual UTF8 report size', async () => {
  const s = await store(); const result = await prepare(s)
  for (const session of [undefined, 'other-session']) await expect(s.submit({ requestId: result.requestId, analysis: analysis() }, session)).rejects.toThrow('RESEARCH_SESSION_MISMATCH')
  await expect(s.get({ ...doc, text: '中'.repeat(400000) })).rejects.toThrow('RESEARCH_REPORT_TOO_LARGE')
  await expect(s.get({ ...doc, documentId: '' })).rejects.toThrow()
})

test('malformed persisted state and unknown format fail visibly instead of resetting', async () => {
  const s = await store(); await s.get(doc)
  const [directory] = await readdir(join(s.root, 'documents'))
  const path = join(s.root, 'documents', directory!, 'state.json')
  const initial = await readFile(path, 'utf8')
  await writeFile(path, '{bad')
  await expect(s.get(doc)).rejects.toThrow('RESEARCH_STORED_JSON_INVALID')
  await writeFile(path, JSON.stringify({ ...JSON.parse(initial), formatVersion: 2 }))
  await expect(s.get(doc)).rejects.toThrow('RESEARCH_STORED_VERSION_UNSUPPORTED')
})

function context() { const ctx = new Context(); ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 }); return { ctx, runtime: new ToolRuntime(ctx) } }
test('owner RPC guard covers every method; context disposal removes exactly research registration', async () => {
  const s = await store(); const { ctx, runtime } = context()
  const control = installResearch(ctx, join(s.root, '..'))
  expect(ctx.get('solarResearch')).toBeInstanceOf(ResearchControl); expect(runtime.get(RESEARCH_TOOL)).toBeDefined()
  Object.defineProperty(ctx, 'invocation', { configurable: true, value: { peer: { principal: { kind: 'anonymous' } } } })
  await expect(control.get(doc)).rejects.toThrow('RESEARCH_OWNER_REQUIRED')
  await expect(control.prepare({ ...doc, expectedRevision: 0 })).rejects.toThrow('RESEARCH_OWNER_REQUIRED')
  await expect(control.markSubmission({ ...doc, requestId: '00000000-0000-4000-8000-000000000000', status: 'queued' })).rejects.toThrow('RESEARCH_OWNER_REQUIRED')
  await expect(control.saveNotes({ ...doc, expectedRevision: 0, notes: {}, reviews: {}, questions: [] })).rejects.toThrow('RESEARCH_OWNER_REQUIRED')
  await ctx.fiber.dispose()
  expect(runtime.get(RESEARCH_TOOL)).toBeUndefined(); expect(ctx.get('solarResearch')).toBeUndefined()
})

test('published tool runtime obtains real agent session and logs full result', async () => {
  const s = await store(); const result = await prepare(s); const { ctx, runtime } = context()
  installResearch(ctx, join(s.root, '..'))
  const source = analysis()
  const quoteOnly = { ...source, claims: source.claims.map(claim => ({ ...claim, anchor: { quote: claim.anchor.quote }, evidence: claim.evidence.map(evidence => ({ ...evidence, anchor: { quote: evidence.anchor.quote } })) })) }
  const call = { callId: 'research-submit' as Parameters<typeof runtime.execute>[0]['callId'], name: RESEARCH_TOOL, arguments: { requestId: result.requestId, analysis: quoteOnly }, signal: new AbortController().signal }
  try {
    const missing = await runtime.execute(call)
    expect(missing.isError).toBe(true); expect(JSON.stringify(missing)).toContain('RESEARCH_SESSION_MISMATCH')
    const success = await runtime.execute({ ...call, agent: { session: { id: doc.sessionId } } as Parameters<typeof runtime.execute>[0]['agent'] })
    expect(success.isError).toBe(false); expect(JSON.stringify(success.content)).toContain('The value grew 20%')
    expect((await s.get(doc)).request?.status).toBe('complete')
  } finally { await ctx.fiber.dispose() }
})


test('child-plugin disable/re-enable preserves other registrations and durable human reviews', async () => {
  const s = await store(); const result = await prepare(s)
  await s.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  const saved = await s.get(doc)
  await s.saveNotes({ ...doc, expectedRevision: saved.revision, notes: {}, reviews: { growth: 'confirmed' }, questions: [] })
  const { ctx, runtime } = context()
  const other = defineTool({ name: 'another_plugin_tool', description: 'Unrelated tool', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: async () => null })
  const removeOther = runtime.register(other)
  const target = ctx.plugin({ name: 'research-lifecycle-test', apply(owner: Context) { installResearch(owner, join(s.root, '..')) } })
  await target.await()
  try {
    expect(runtime.get(RESEARCH_TOOL)).toBeDefined()
    await target.dispose()
    expect(runtime.get(RESEARCH_TOOL)).toBeUndefined()
    expect(ctx.get('solarResearch')).toBeUndefined()
    expect(runtime.get('another_plugin_tool')).toBe(other)
    const restored = ctx.plugin({ name: 'research-lifecycle-restored-test', apply(owner: Context) { installResearch(owner, join(s.root, '..')) } })
    await restored.await()
    expect((await ctx.solarResearch.get(doc)).reviews).toEqual({ growth: 'confirmed' })
    await restored.dispose()
  } finally { await target.dispose(); removeOther(); await ctx.fiber.dispose() }
})

test('quote-only CJK and emoji submissions normalize to exact durable UTF16 offsets in long reports', async () => {
  const s = await store()
  const text = '前'.repeat(20000) + '😀综述：增长率为20%。📈'
  const input = { ...doc, text }
  const result = await prepare(s, input)
  expect(result.prompt).toContain('Prefer quote-only anchors')
  const value = { formatVersion: 1, reportHash: hashReport(text), question: '增长情况如何？', claims: [{ id: 'growth', text: '增长率为20%。', kind: 'observation', anchor: { quote: '增长率为20%。' }, conditions: [], evidence: [{ id: 'chart', relation: 'support', anchor: { quote: '📈' } }], openQuestions: [] }] }
  const complete = await s.submit({ requestId: result.requestId, analysis: value }, doc.sessionId)
  expect(complete.analysis?.claims[0]?.anchor).toEqual({ quote: '增长率为20%。', start: 20005, end: 20013 })
  expect(complete.analysis?.claims[0]?.evidence[0]?.anchor).toEqual({ quote: '📈', start: 20013, end: 20015 })
  expect((await new ResearchStore(join(s.root, '..')).get(input)).analysis).toEqual(complete.analysis)
  expect((await s.submit({ requestId: result.requestId, analysis: value }, doc.sessionId)).revision).toBe(complete.revision)
})

test('repeated quotes require supplied exact offsets and wrong supplied offsets never guess', async () => {
  const s = await store(); const input = { ...doc, text: '😀重复。重复。' }; const result = await prepare(s, input)
  const value = { formatVersion: 1, reportHash: hashReport(input.text), question: '如何解读？', claims: [{ id: 'repeat', text: '重复。', kind: 'observation', anchor: { quote: '重复。' }, conditions: [], evidence: [], openQuestions: [] }] }
  await expect(s.submit({ requestId: result.requestId, analysis: value }, doc.sessionId)).rejects.toThrow('RESEARCH_ANCHOR_AMBIGUOUS')
  const claim = value.claims[0]!
  await expect(s.submit({ requestId: result.requestId, analysis: { ...value, claims: [{ ...claim, anchor: { quote: '重复。', start: 3, end: 6 } }] } }, doc.sessionId)).rejects.toThrow('RESEARCH_ANCHOR_MISMATCH')
  await expect(s.submit({ requestId: result.requestId, analysis: { ...value, claims: [{ ...claim, anchor: { quote: '重复。', start: 5 } }] } }, doc.sessionId)).rejects.toThrow('Supply both offsets or neither')
  expect((await s.get(input)).request?.status).toBe('prepared')
  const complete = await s.submit({ requestId: result.requestId, analysis: { ...value, claims: [{ ...claim, anchor: { quote: '重复。', start: 5, end: 8 } }] } }, doc.sessionId)
  expect(complete.analysis?.claims[0]?.anchor).toEqual({ quote: '重复。', start: 5, end: 8 })
})

test('changing reports archives human work immutably and restores it with monotonic CAS revisions', async () => {
  const s = await store(); const result = await prepare(s)
  const complete = await s.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  const human = await s.saveNotes({ ...doc, expectedRevision: complete.revision, notes: { growth: 'Original source needs checking' }, reviews: { growth: 'questioned' }, questions: ['What was excluded?'] })
  const changed = { ...doc, text: doc.text + '\nA different report snapshot.' }
  const fresh = await s.get(changed)
  expect(fresh.revision).toBe(human.revision + 1); expect(fresh.analysis).toBeUndefined()
  await expect(s.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)).rejects.toThrow('RESEARCH_STALE_REPORT')
  expect((await s.get(changed)).revision).toBe(fresh.revision)
  const [directory] = await readdir(join(s.root, 'documents'))
  const archivePath = join(s.root, 'documents', directory!, 'states', hashReport(doc.text), `${human.revision}.json`)
  const immutableBytes = await readFile(archivePath, 'utf8')
  const restored = await new ResearchStore(join(s.root, '..')).get(doc)
  expect(restored.revision).toBe(fresh.revision + 1)
  expect(restored.analysis).toEqual(human.analysis); expect(restored.notes).toEqual(human.notes)
  expect(restored.reviews).toEqual(human.reviews); expect(restored.questions).toEqual(human.questions)
  await expect(s.saveNotes({ ...doc, expectedRevision: human.revision, notes: {}, reviews: {}, questions: [] })).rejects.toThrow('RESEARCH_REVISION_CONFLICT')
  const edited = await s.saveNotes({ ...doc, expectedRevision: restored.revision, notes: { growth: 'Revisited human note' }, reviews: { growth: 'confirmed' }, questions: [] })
  await s.get(changed)
  const revisited = await s.get(doc)
  expect(revisited.notes).toEqual(edited.notes); expect(revisited.reviews).toEqual(edited.reviews)
  expect(revisited.revision).toBe(edited.revision + 2)
  expect(await readFile(archivePath, 'utf8')).toBe(immutableBytes)
})

test('malformed and unknown-version report archives fail without discarding current source state', async () => {
  const s = await store(); const result = await prepare(s)
  const complete = await s.submit({ requestId: result.requestId, analysis: analysis() }, doc.sessionId)
  const changed = { ...doc, text: doc.text + '\nDifferent snapshot.' }
  const fresh = await s.get(changed)
  const [directory] = await readdir(join(s.root, 'documents'))
  const path = join(s.root, 'documents', directory!, 'states', hashReport(doc.text), `${complete.revision}.json`)
  const original = await readFile(path, 'utf8')
  await writeFile(path, '{invalid')
  await expect(s.get(doc)).rejects.toThrow('RESEARCH_STORED_JSON_INVALID')
  expect((await s.get(changed)).revision).toBe(fresh.revision)
  await writeFile(path, JSON.stringify({ ...JSON.parse(original), formatVersion: 2 }))
  await expect(s.get(doc)).rejects.toThrow('RESEARCH_STORED_VERSION_UNSUPPORTED')
  await writeFile(path, JSON.stringify({ ...JSON.parse(original), reviews: { invented: 'confirmed' } }))
  await expect(s.get(doc)).rejects.toThrow('RESEARCH_STORED_DATA_INVALID')
  expect((await s.get(changed)).revision).toBe(fresh.revision)
})
