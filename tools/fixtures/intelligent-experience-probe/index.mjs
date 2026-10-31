import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
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
    assert(available.includes('solar_present'), 'the actual Agent request did not receive solar_present')
    const call = { type: 'tool-call', id: randomUUID(), name: 'solar_present', arguments: JSON.stringify({
      protocol: 'content', payload: { fixture: true, source: 'AgentLoop' }, label: 'Keyless DSH fixture output',
    }) }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'block-end', index: 0, block: call }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
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
  const checks = { service: false, settingsOff: false, cas: false, settingsOn: false, toolRegistered: false, agentToolExecution: false, artifactRead: false, rawAndProvenance: false, settingsRestored: false, registry: false, durableMarker: false, disposed: false }
  let caught
  let evidenceArtifacts = []
  try {
    const service = ctx.get(serviceName)
    assert(service && typeof service.settings === 'function' && typeof service.saveSettings === 'function', 'solarExperience settings service is unavailable')
    assert(typeof service.artifacts === 'function' && typeof service.publish === 'function', 'solarExperience artifact service is incomplete')
    checks.service = true

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
    checks.disposed = true
  } catch (error) { caught = errorValue(error) }

  const value = { formatVersion: 1, pid: process.pid, ok: caught === undefined, checks, artifacts: evidenceArtifacts, ...(caught ? { error: caught } : {}) }
  await marker(value)
  const exit = ctx.get('appExit')
  assert(typeof exit === 'function', 'appExit service is unavailable after marker write')
  exit(caught === undefined ? 0 : 1)
}

export const name = 'intelligent-experience-probe'
export const inject = ['appReady']

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
