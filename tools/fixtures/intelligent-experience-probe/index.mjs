import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'

const serviceName = 'solarExperience'
const runtimeName = 'intelligent-experience-platform'
const fixtureProvider = 'intelligent-experience-fixture'
const fixtureModel = 'fixture-model'

class ProbeAdapter extends LlmAdapter {
  calls = 0
  async *stream(options) {
    options.signal?.throwIfAborted()
    this.calls += 1
    if (this.calls > 1) {
      const text = 'Fixture tool result received.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const available = options.tools?.map((tool) => tool.name) ?? []
    for (const name of ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview', 'solar_ui_canvas_search']) assert(available.includes(name), `actual Agent request lacks ${name}`)
    assert(available.includes('solar_present'), 'the actual Agent request did not receive solar_present')
    const call = { type: 'tool-call', id: randomUUID(), name: 'solar_present', arguments: JSON.stringify({
      protocol: 'content', payload: { fixture: true, source: 'AgentLoop' }, label: 'Keyless DSH fixture output',
    }) }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'block-end', index: 0, block: call }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** Deterministic in-process adapter: exercises the normal AgentLoop, with zero external calls. */
class ResearchProbeAdapter extends LlmAdapter {
  calls = 0
  submission
  async *stream(options) {
    options.signal?.throwIfAborted()
    this.calls += 1
    if (this.calls === 1) {
      assert(this.submission, 'research fixture was not prepared before AgentLoop execution')
      assert(options.tools?.some(tool => tool.name === 'solar_research_submit'), 'actual research Agent request lacks solar_research_submit')
      const call = { type: 'tool-call', id: randomUUID(), name: 'solar_research_submit', arguments: JSON.stringify(this.submission) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = 'Fictional research fixture organized; claims await human review.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function assert(ok, message) { if (!ok) throw new Error(message) }
function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`probe requires ${name}`)
  return value
}
async function marker(value) {
  const path = env('SOLAR_PLUGIN_PROBE_MARKER')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
function errorValue(error) { return { name: error?.name ?? 'Error', message: error?.message ?? String(error) } }

async function waitForArtifacts(service, sessionId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let artifacts = []
  do {
    artifacts = await service.artifacts({ sessionId })
    const generated = artifacts.some(record => record.source.kind === 'generated')
    const readableAssistant = artifacts.some(record => record.source.kind === 'assistant' && typeof record.payload === 'string' && record.payload.includes('Fixture tool result received.'))
    if (generated && readableAssistant) return artifacts
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for persisted generated and readable assistant artifacts for Agent ${sessionId}; last observed ${JSON.stringify(artifacts.map(({ id, source, payload }) => ({ id, source, payloadType: typeof payload })))}`)
}

async function probe(ctx) {
  const checks = { service: false, settingsOff: false, cas: false, settingsOn: false, toolRegistered: false, agentToolExecution: false, artifactRead: false, rawAndProvenance: false, settingsRestored: false, registry: false, durableMarker: false, disposed: false, researchService: false, researchAgentExecution: false, researchSourceBinding: false, researchHumanReview: false, researchDisposal: false }
  let caught
  let evidenceArtifacts = []
  try {
    const service = ctx.get(serviceName)
    assert(service && typeof service.settings === 'function' && typeof service.saveSettings === 'function', 'solarExperience settings service is unavailable')
    assert(typeof service.artifacts === 'function' && typeof service.publish === 'function', 'solarExperience artifact service is incomplete')
    checks.service = true

    const libraryRaw = '\uFEFF# Local file fixture\r\n\r\n| Group | Count |\r\n| --- | ---: |\r\n| A | 12 |\r\n'
    const imported = await service.publish({source:{sessionId:'library:intelligent-ui:files',kind:'generated',label:'本地导入：scratch.md'},protocol:'content',providerId:'local-import',raw:libraryRaw,payload:libraryRaw})
    const localFiles = await service.localFiles()
    assert(localFiles.some(file=>file.id===imported.id && file.raw===libraryRaw && file.payload===libraryRaw), 'global file library did not read its unchanged imported source')
    const missingInsight = await service.insightPreview({sessionId:'scratch-insight-preview'})
    assert(missingInsight.formatVersion===1 && missingInsight.sessionId==='scratch-insight-preview' && missingInsight.available===false && missingInsight.runs.length===0, 'optional Insight peers must produce an explicit unavailable snapshot')
    checks.localFiles = true
    checks.insightReadonlyUnavailable = true

    const insightSession='scratch-insight-preview'
    const task={kind:'insight',runId:'readonly-run',title:'Scratch existing analysis',status:'running',updatedAt:1793664000000,outputs:[],stages:[{key:'analysis',label:'Analysis',status:'completed',outputs:[{label:'Report',text:libraryRaw}]},{key:'pptx',label:'Deck pending',status:'pending',outputs:[]}]}
    const readCalls=[]
    const removeReadPeer=ctx.provide('solarConversationTasks',{status:async input=>{readCalls.push(input);return {formatVersion:1,sessionId:input.sessionId,tasks:[task]}}})
    try {
      const preview=await service.insightPreview({sessionId:insightSession})
      assert(readCalls.length===1 && readCalls[0].sessionId===insightSession, 'preview did not read the exact current session once')
      assert(preview.available && preview.runs.length===1 && preview.runs[0].outputs[0].text===libraryRaw, 'built preview lost the existing analysis source')
      assert(/^preview:[a-f0-9]{64}$/.test(preview.runs[0].outputs[0].documentId) && JSON.stringify(preview.runs[0].raw)===JSON.stringify(task), 'built preview lost stable identity or complete pending-stage provenance')
      checks.insightReadonlyRead=true
    } finally { await removeReadPeer() }

    let state = await service.settings()
    assert(state.revision === 0 && state.takeover === false, `expected initial off settings revision 0; got ${JSON.stringify(state)}`)
    checks.settingsOff = true
    const enabled = await service.saveSettings({ expectedRevision: state.revision, takeover: true, openui: true, mcpApps: false })
    checks.cas = enabled.revision === state.revision + 1
    assert(checks.cas, 'settings save did not increment the revision')
    state = await service.settings()
    assert(state.takeover === true && state.revision === enabled.revision, 'settings-on state was not acknowledged')
    checks.settingsOn = true
    const tools = ctx.get('tools')
    assert(tools?.schemas().some((schema) => schema.name === 'solar_present'), 'solar_present is absent from the actual tool catalog')
    assert(typeof tools.get('solar_present')?.execute === 'function', 'solar_present has no registered execution handler')
    checks.toolRegistered = true

    const componentNames = ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview', 'solar_ui_canvas_search']
    const skills = ctx.get('skills')
    const componentService = ctx.get('solarUiComponents')
    assert(componentService, 'integrated component service absent')
    const summary = (await skills.list()).find(item => item.name === 'uiverse-components')
    assert(summary?.invocation.modelInvocable === true && summary.invocation.userInvocable === false, 'integrated silent skill policy is wrong')
    const executeComponent = async (name, arguments_) => {
      const result = await tools.execute({ callId: randomUUID(), name, arguments: arguments_, signal: new AbortController().signal })
      assert(!result.isError, `${name} failed: ${JSON.stringify(result)}`)
      return JSON.parse(result.content.find(block => block.type === 'text').text)
    }
    const loadedSkill = await tools.execute({ callId: randomUUID(), name: 'skill', arguments: { name: 'uiverse-components' }, signal: new AbortController().signal })
    assert(!loadedSkill.isError && JSON.stringify(loadedSkill.content).includes('solar_ui_search') && JSON.stringify(loadedSkill.content).includes('solar_ui_canvas_search'), 'official loader cannot read integrated component skill')
    const canvas = await executeComponent('solar_ui_canvas_search', { query: 'ink object' })
    assert(canvas.scope === 'metadata-only' && canvas.items.some(item => item.slug === 'ink-object'), 'Canvas UI discovery did not return the upstream Ink Object reference')
    checks.canvasDiscovery = true
    const page = await executeComponent('solar_ui_search', { category: 'Buttons', limit: 1 })
    assert(page.archiveTotal === 3802 && page.categories.length === 11, 'integrated archive inventory differs')
    const source = await executeComponent('solar_ui_source', { id: page.items[0].id })
    assert(createHash('sha256').update(source.source).digest('hex') === page.items[0].sha256, 'integrated source fingerprint differs')
    const preview = await executeComponent('solar_ui_preview', { id: page.items[0].id, reducedMotion: true })
    assert(preview.document.includes('sandbox=""') && preview.html.includes("default-src 'none'"), 'integrated isolated preview unavailable')
    const componentStatus = await componentService.toolStatus()
    assert(componentStatus.tools.every(row => row.registered), 'integrated registry observation differs')
    checks.integratedUiverse = true
    checks.componentSkillLoaded = true
    checks.componentSourcePreserved = true
    checks.componentPreview = true

    const llm = ctx.get('llm')
    const agents = ctx.get('agents')
    assert(typeof llm?.registerAdapter === 'function' && typeof agents?.create === 'function', 'keyless AgentLoop fixture services are unavailable')
    const adapter = new ProbeAdapter()
    const disposeAdapter = llm.registerAdapter([fixtureProvider], adapter)
    const handle = await agents.create({ sessionId: `fixture-experience-${randomUUID()}`, agentOptions: { provider: fixtureProvider, model: fixtureModel } })
    const agentId = handle.agent.id
    try {
      handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Render the deterministic fixture output.' }] })
      await handle.agent.whenIdle()
      assert(adapter.calls >= 2, `expected a tool-call request and AgentLoop completion; got ${adapter.calls} model calls`)
      checks.agentToolExecution = true
      const artifacts = await waitForArtifacts(service, agentId)
      evidenceArtifacts = artifacts
      assert(artifacts.length >= 1, `expected generated content artifact under actual Agent id ${agentId}; got ${artifacts.length}`)
      const artifact = artifacts.find((record) => record.source.kind === 'generated')
      assert(artifact, 'the real solar_present execution did not persist a generated-content artifact')
      assert(artifact.source.sessionId === agentId && artifact.source.kind === 'generated', 'artifact provenance did not retain the actual Agent identity and generated kind')
      assert(artifact.raw && artifact.payload?.fixture === true, 'artifact lost raw source or fixture payload')
      const assistantArtifacts = artifacts.filter((record) => record.source.kind === 'assistant')
      assert(assistantArtifacts.length > 0, 'the readable assistant response was not persisted before the capture deadline')
      assert(assistantArtifacts.some((record) => record.payload.includes('Fixture tool result received.')), 'the final readable fixture assistant response was not captured')
      assert(assistantArtifacts.every((record) => typeof record.payload === 'string'), 'assistant capture payload must be readable Markdown, never serialized message metadata')
      assert(assistantArtifacts.every((record) => record.raw?.role === 'assistant'), 'assistant source message was not retained intact in raw')
      assert(!assistantArtifacts.some((record) => Array.isArray(record.raw?.content) && record.raw.content.length > 0 && record.raw.content.every((block) => block?.type === 'tool-call')), 'tool-call-only assistant messages must not create duplicate assistant cards')
      checks.artifactRead = true
      checks.rawAndProvenance = true
      checks.assistantPayloadReadable = true
    } finally {
      await handle.dispose()
      disposeAdapter()
    }
    const research = ctx.get('solarResearch')
    assert(research && ['get', 'prepare', 'markSubmission', 'saveNotes'].every(method => typeof research[method] === 'function'), 'solarResearch service is unavailable or incomplete')
    assert(typeof tools.get('solar_research_submit')?.execute === 'function', 'solar_research_submit is absent from the host tool registry')
    checks.researchService = true
    const researchProvider = `${fixtureProvider}-research`
    const researchAdapter = new ResearchProbeAdapter()
    const disposeResearchAdapter = llm.registerAdapter([researchProvider], researchAdapter)
    const researchHandle = await agents.create({ sessionId: `fixture-research-${randomUUID()}`, agentOptions: { provider: researchProvider, model: fixtureModel } })
    const otherResearchHandle = await agents.create({ sessionId: `fixture-research-other-${randomUUID()}`, agentOptions: { provider: researchProvider, model: fixtureModel } })
    try {
      const text = '虚构验收样例：😀\n观测值为20%。\n[虚构来源](https://example.test/fixture-research)\n'
      const document = { sessionId: researchHandle.agent.id, documentId: 'fictional-research-report', text }
      const initial = await research.get(document)
      const prepared = await research.prepare({ ...document, expectedRevision: initial.revision })
      const reportHash = createHash('sha256').update(text).digest('hex')
      const analysis = { formatVersion: 1, reportHash, question: '虚构样例报告了什么？', claims: [{
        id: 'fixture-observation', text: '虚构样例中的观测值为20%。', kind: 'observation', anchor: { quote: '观测值为20%。' }, conditions: ['仅用于确定性验收，不代表真实数据'],
        evidence: [{ id: 'fixture-citation', relation: 'citation', anchor: { quote: '虚构来源' }, sourceUrl: 'https://example.test/fixture-research', note: '报告内虚构引用，未抓取或验证来源内容' }], openQuestions: ['真实来源是否支持该数值？'],
      }] }
      const submission = { requestId: prepared.requestId, analysis }
      const rejected = async (arguments_, agent, expected) => {
        const before = await research.get(document)
        const result = await tools.execute({ callId: randomUUID(), name: 'solar_research_submit', arguments: arguments_, ...(agent ? { agent } : {}), signal: new AbortController().signal })
        assert(result.isError && JSON.stringify(result).includes(expected), `research boundary expected ${expected}: ${JSON.stringify(result)}`)
        const after = await research.get(document)
        assert(after.revision === before.revision && after.request?.status === before.request?.status && !after.analysis, 'rejected research attempt changed the prepared request')
      }
      await rejected({ ...submission, requestId: randomUUID() }, researchHandle.agent, 'RESEARCH_SESSION_MISMATCH')
      await rejected(submission, undefined, 'RESEARCH_SESSION_MISMATCH')
      await rejected(submission, otherResearchHandle.agent, 'RESEARCH_SESSION_MISMATCH')
      await rejected({ ...submission, analysis: { ...analysis, reportHash: '0'.repeat(64) } }, researchHandle.agent, 'RESEARCH_REPORT_HASH_MISMATCH')
      researchAdapter.submission = submission
      await research.markSubmission({ ...document, requestId: prepared.requestId, status: 'queued' })
      researchHandle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prepared.prompt }] })
      await researchHandle.agent.whenIdle()
      // Native title generation may also use this local adapter. Count durable business events,
      // not unrelated provider calls, to prove exactly one research result submission.
      const researchEvents = researchHandle.agent.session.ownEvents()
      const researchCalls = researchEvents.filter(event => event.type === 'tool/call' && event.data.name === 'solar_research_submit')
      const researchCompletion = researchEvents.some(event => event.type === 'assistant/message' && JSON.stringify(event.data.message).includes('Fictional research fixture organized'))
      assert(researchAdapter.calls >= 2 && researchCalls.length === 1 && researchCompletion, 'research AgentLoop did not record exactly one tool submission and a normal assistant completion')
      const complete = await research.get(document)
      assert(complete.request?.status === 'complete' && complete.analysis, 'actual research Agent tool did not persist a completed analysis')
      checks.researchAgentExecution = true
      const claimAnchor = complete.analysis.claims[0]?.anchor
      const evidenceAnchor = complete.analysis.claims[0]?.evidence[0]?.anchor
      assert(complete.reportHash === reportHash && complete.analysis.reportHash === reportHash, 'research analysis lost its exact report fingerprint')
      for (const anchor of [claimAnchor, evidenceAnchor]) assert(anchor && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && text.slice(anchor.start, anchor.end) === anchor.quote, 'quote-only research submission did not normalize to exact UTF16 source anchors')
      assert(claimAnchor.start === text.indexOf('观测值为20%。') && evidenceAnchor.start === text.indexOf('虚构来源'), 'normalized research anchors point to the wrong source passage')
      assert(complete.analysis.claims[0].evidence[0].sourceUrl === 'https://example.test/fixture-research', 'research citation lost its report-local source URL')
      checks.researchSourceBinding = true
      assert(Object.keys(complete.reviews).length === 0 && Object.keys(complete.notes).length === 0, 'the model fabricated human review or notes')
      const reviewed = await research.saveNotes({ ...document, expectedRevision: complete.revision, notes: { 'fixture-observation': '人工验收笔记：来源仍待核查。' }, reviews: { 'fixture-observation': 'questioned' }, questions: ['需要什么原始证据？'] })
      assert(reviewed.revision === complete.revision + 1 && reviewed.reviews['fixture-observation'] === 'questioned', 'owner human review did not persist with CAS')
      let staleRejected = false
      try { await research.saveNotes({ ...document, expectedRevision: complete.revision, notes: {}, reviews: {}, questions: [] }) } catch (error) { staleRejected = String(error).includes('RESEARCH_REVISION_CONFLICT') }
      assert(staleRejected && (await research.get(document)).reviews['fixture-observation'] === 'questioned', 'stale owner review overwrote the saved human review')
      checks.researchHumanReview = true
    } finally {
      await researchHandle.dispose()
      await otherResearchHandle.dispose()
      disposeResearchAdapter()
    }
    const restored = await service.saveSettings({ expectedRevision: state.revision, takeover: false, openui: true, mcpApps: false })
    state = await service.settings()
    assert(state.takeover === false && state.revision === restored.revision, 'settings did not restore to off')
    checks.settingsRestored = true

    checks.artifactRead = true
    const registry = service.registry
    assert(registry && typeof registry.select === 'function' && typeof registry.providersFor === 'function', 'internal provider registry is unavailable')
    checks.registry = true

    // Persist only the service-generated settings state and evidence summary.
    // No fabricated Agent, tool execution, or source identity is written.
    const root = join(env('DSH_HOME'), 'solar', 'intelligent-experience-platform')
    const stored = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))
    assert(stored.takeover === false && stored.revision === state.revision, 'on-disk settings differ from acknowledged settings')
    checks.durableMarker = true

    const runtimes = [...ctx.registry.values()].filter((runtime) => runtime.name === runtimeName)
    assert(runtimes.length === 1 && runtimes[0].fibers.length === 1, `platform runtime owner is not unique: ${JSON.stringify([...ctx.registry.values()].map((runtime) => ({ name: runtime.name, fibers: runtime.fibers.length })))}`)
    await [...runtimes[0].fibers][0].dispose()
    assert(ctx.get(serviceName) === undefined, 'solarExperience service remained after dispose')
    assert(tools.get('solar_present') === undefined, 'solar_present remained registered after dispose')
    for (const name of componentNames) assert(tools.get(name) === undefined, `${name} survived main-plugin disposal`)
    assert(!await skills.get('uiverse-components') && !ctx.get('solarUiComponents'), 'component skill/service survived main-plugin disposal')
    assert(tools.get('skill'), 'main-plugin disposal removed official skill loader')
    assert(ctx.get('solarResearch') === undefined, 'solarResearch service remained after main-plugin disposal')
    assert(tools.get('solar_research_submit') === undefined, 'solar_research_submit remained after main-plugin disposal')
    assert(typeof ctx.get('agents')?.create === 'function' && typeof ctx.get('llm')?.registerAdapter === 'function', 'main-plugin disposal removed unrelated host Agent/LLM services')
    checks.researchDisposal = true

    checks.disposed = true
  } catch (error) { caught = errorValue(error) }

  const value = { formatVersion: 1, pid: process.pid, ok: caught === undefined, checks, artifacts: evidenceArtifacts, ...(caught ? { error: caught } : {}) }
  await marker(value)
  const exit = ctx.get('appExit')
  assert(typeof exit === 'function', 'appExit service is unavailable after marker write')
  exit(caught === undefined ? 0 : 1)
}

export const name = 'intelligent-experience-probe'
// App readiness does not imply that this async plugin service has activated.
export const inject = ['appReady', 'solarExperience']

export function apply(ctx) {
  const appReady = ctx.get('appReady')
  if (typeof appReady?.onReady !== 'function') throw new Error('appReady service is unavailable')
  let started = false
  return appReady.onReady(() => {
    if (started) return
    started = true
    void probe(ctx).catch(async (error) => {
      const detail = errorValue(error)
      process.stderr.write(`intelligent-experience probe: ${detail.name}: ${detail.message}\n`)
      await marker({ formatVersion: 1, pid: process.pid, ok: false, checks: {}, error: detail })
      ctx.get('appExit')?.(1)
    })
  })
}
