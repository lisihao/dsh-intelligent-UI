import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { OPENUI_VISUAL_SAMPLE } from './visual-sample.mjs'

const SERVICE = 'solarExperience'
const PROVIDER = 'intelligent-experience-canary-fixture'
const MODEL = 'fixture-model'
const LABEL = '智能体验平台验收（本地合成，无付费模型）'
const SOURCE_ROOT = 'solar/intelligent-experience-platform'

function assert(condition, message) { if (!condition) throw new Error(message) }
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`canary requires ${name}`); return value }
function jsonEnv(name) { try { return JSON.parse(required(name)) } catch (error) { throw new Error(`${name} is not valid JSON: ${String(error)}`) } }
function cleanSettings(value) { return { formatVersion: value.formatVersion, revision: value.revision, takeover: value.takeover, openui: value.openui, mcpApps: value.mcpApps } }
function samePreferences(a, b) { return a.takeover === b.takeover && a.openui === b.openui && a.mcpApps === b.mcpApps }
function settingsInput(snapshot, expectedRevision) { return { expectedRevision, takeover: snapshot.takeover, openui: snapshot.openui, mcpApps: snapshot.mcpApps } }
function errorValue(error) { return { name: error?.name ?? 'Error', message: error?.message ?? String(error) } }

async function saveReceipt(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  catch (error) { await import('node:fs/promises').then(({ rm }) => rm(temporary, { force: true })).catch(() => {}); throw error }
}

function assertSyntheticSession(events, sessionId, callIds) {
  const user = events.find(event => event.type === 'user/message' && JSON.stringify(event.data).includes(LABEL))
  assert(user, 'persisted Session is missing the clearly labeled synthetic user message')
  const results = callIds.map(callId => events.find(event => event.type === 'tool/result' && event.data?.message?.toolCallId === callId))
  for (let index = 0; index < callIds.length; index++) assert(results[index], `persisted Session is missing the actual solar_present tool result for call ${callIds[index]}`)
  assert(events.some(event => event.type === 'assistant/message'), 'persisted Session has no assistant response')
  return { sessionId, eventCount: events.length, userSeq: user.seq, toolResultSeqs: results.map(event => event.seq) }
}

async function inspectDurableSession(ctx, sessionId, callIds) {
  const stat = await ctx.sessionPersistence.stat(sessionId)
  assert(stat?.header?.id === sessionId, `Session ${sessionId} is not visible in this profile's persistent Session backend`)
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    const { events } = await handle.read(0)
    return { ...assertSyntheticSession(events, sessionId, callIds), cwd: stat.header.cwd ?? null, eventCount: events.length, sizeBytes: stat.sizeBytes ?? null }
  } finally { await handle.close() }
}

class CanaryAdapter extends LlmAdapter {
  calls = 0
  agentToolRequests = 0
  auxiliaryCalls = 0
  turnIndex = -1
  callsThisTurn = 0
  toolOutputs = [
    { protocol: 'content', label: LABEL, payload: { kind: 'local-synthetic', label: LABEL, note: 'No external model or service was used.' } },
    { protocol: 'openui', label: `${LABEL} · OpenUI`, payload: OPENUI_VISUAL_SAMPLE },
  ]
  beginTurn() { this.turnIndex++; this.callsThisTurn = 0 }
  async *stream(options) {
    options.signal?.throwIfAborted()
    this.calls += 1
    const hasSolarPresent = (options.tools ?? []).some(tool => tool.name === 'solar_present')
    if (!hasSolarPresent) {
      this.auxiliaryCalls += 1
      const text = 'Fixture auxiliary response; no external model was contacted.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.agentToolRequests += 1
    assert(this.turnIndex >= 0 && this.turnIndex < this.toolOutputs.length, `fixture adapter has no queued tool output for turn ${this.turnIndex}`)
    if (this.callsThisTurn++ > 0) {
      const text = '本地合成展示已完成。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const callId = randomUUID()
    const call = { type: 'tool-call', id: callId, name: 'solar_present', arguments: JSON.stringify(this.toolOutputs[this.turnIndex]) }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'block-end', index: 0, block: call }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

async function verifyAgain(ctx, receiptPath) {
  const prior = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert(prior.formatVersion === 1 && prior.initialSettings && prior.agentId && prior.contentCallId && prior.contentArtifactId && prior.openuiCallId && prior.openuiArtifactId, 'canary receipt is incomplete for second-process verification')
  const service = ctx.get(SERVICE)
  assert(service, 'solarExperience service is unavailable during verification restart')
  const settings = cleanSettings(await service.settings())
  assert(samePreferences(settings, prior.initialSettings), 'settings preferences changed after the first canary process')
  const persisted = await inspectDurableSession(ctx, prior.agentId, [prior.contentCallId, prior.openuiCallId])
  const artifacts = await service.artifacts({ sessionId: prior.agentId })
  const contentArtifact = artifacts.find(artifact => artifact.id === prior.contentArtifactId && artifact.source.callId === prior.contentCallId && artifact.protocol === 'content')
  const openuiArtifact = artifacts.find(artifact => artifact.id === prior.openuiArtifactId && artifact.source.callId === prior.openuiCallId && artifact.protocol === 'openui')
  assert(contentArtifact && openuiArtifact, 'content and OpenUI artifacts did not both survive the independent CLI restart')
  assert(contentArtifact.raw?.label === LABEL && contentArtifact.payload?.label === LABEL, 'content artifact raw source/payload changed across restart')
  assert(typeof openuiArtifact.raw === 'string' && openuiArtifact.raw === openuiArtifact.payload && openuiArtifact.raw.includes('TextContent'), 'OpenUI source text did not survive unchanged across restart')
  const widgetState = await service.widgetState({ sessionId: prior.agentId, artifactId: prior.openuiArtifactId })
  assert(widgetState.revision === 1 && widgetState.state.contact?.name?.value === 'Local canary state', 'widget state did not survive the independent CLI restart')
  const updated = { ...prior, stage: 'verified-after-restart', verifiedAt: new Date().toISOString(), restoredSettings: settings, persistedSession: persisted, widgetState, artifactIds: artifacts.map(artifact => artifact.id), checks: { ...(prior.checks ?? {}), secondProcessSessionRead: true, preservedSettings: true, contentArtifactSurvivedRestart: true, openuiArtifactSurvivedRestart: true, widgetStateSurvivedRestart: true } }
  await saveReceipt(receiptPath, updated)
  return updated
}

async function restoreOnly(ctx, receiptPath) {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert(receipt.formatVersion === 1 && receipt.initialSettings, 'restore-only needs the previously saved preference snapshot')
  const service = ctx.get(SERVICE)
  assert(service, 'solarExperience service is unavailable for preference recovery')
  const current = cleanSettings(await service.settings())
  if (samePreferences(current, receipt.initialSettings)) return { ...receipt, recovery: 'already-restored' }
  assert(receipt.settingWriteIntent === true, 'no acknowledged or journaled canary settings write exists; refusing to overwrite preferences')
  const test = receipt.testSettings ?? receipt.testSettingsExpected
  assert(test, 'canary settings write intent lacks its expected revision and values')
  assert(test && current.revision === test.revision && samePreferences(current, test), `settings changed outside this canary; refusing to overwrite revision ${current.revision}`)
  const restored = cleanSettings(await service.saveSettings(settingsInput(receipt.initialSettings, current.revision)))
  assert(samePreferences(restored, receipt.initialSettings), 'preference recovery did not restore the snapshotted values')
  const updated = { ...receipt, restoredSettings: restored, recovery: 'restored-via-CAS' }
  await saveReceipt(receiptPath, updated)
  return updated
}

async function runCanary(ctx, receiptPath) {
  const service = ctx.get(SERVICE)
  assert(service && typeof service.settings === 'function' && typeof service.saveSettings === 'function', 'solarExperience settings service is unavailable')
  const initial = cleanSettings(await service.settings())
  const receipt = { formatVersion: 1, stage: 'settings-snapshotted', createdAt: new Date().toISOString(), label: LABEL, initialSettings: initial, sourceRoot: SOURCE_ROOT, checks: { settingsSnapshotted: true } }
  await saveReceipt(receiptPath, receipt)
  const llm = ctx.get('llm'), agents = ctx.get('agents')
  assert(typeof llm?.registerAdapter === 'function' && typeof agents?.create === 'function', 'keyless AgentLoop services are unavailable')
  const adapter = new CanaryAdapter()
  const disposeAdapter = llm.registerAdapter([PROVIDER], adapter)
  const blockedModelRequests = []
  const disposeGuard = ctx.on('llm/stream', async function* (options, next) {
    if (options.provider !== PROVIDER) { blockedModelRequests.push({ provider: options.provider, model: options.model }); throw new Error(`CANARY_BLOCKED_NON_FIXTURE_MODEL: ${options.provider}/${options.model}`) }
    yield* next()
  }, { global: true })
  let savedOn
  let handle
  let runError
  let result = receipt
  try {
    let settings = initial
    if (!settings.takeover) {
      const expected = { ...initial, revision: initial.revision + 1, takeover: true }
      result = { ...result, stage: 'settings-write-intent', settingWriteIntent: true, testSettingsExpected: expected }
      await saveReceipt(receiptPath, result)
      savedOn = cleanSettings(await service.saveSettings({ expectedRevision: settings.revision, takeover: true, openui: settings.openui, mcpApps: settings.mcpApps }))
      settings = savedOn
      result = { ...result, stage: 'takeover-enabled', testSettings: savedOn, settingWriteAcknowledged: true, checks: { ...result.checks, takeoverEnabledWithCAS: savedOn.revision === initial.revision + 1 } }
      assert(result.checks.takeoverEnabledWithCAS, 'takeover save did not advance the snapshot revision once')
      await saveReceipt(receiptPath, result)
    } else {
      savedOn = settings
      result = { ...result, stage: 'takeover-already-enabled', testSettings: settings, checks: { ...result.checks, takeoverAlreadyEnabled: true } }
      await saveReceipt(receiptPath, result)
    }
    const workspace = required('SOLAR_IEP_CANARY_CWD')
    const sessionId = `iep-canary-${randomUUID()}`
    handle = await agents.create({ sessionId, meta: { cwd: workspace } , agentOptions: { provider: PROVIDER, model: MODEL } })
    assert(handle.agent.id === sessionId, 'AgentRegistry changed the unique canary Session id')
    result = { ...result, stage: 'agent-created', agentId: sessionId, fixtureModelCalls: 0, completedTurns: [] }
    await saveReceipt(receiptPath, result)
    const contentPrompt = `${LABEL}\n請以平台的 solar_present 工具保存一份本地合成文字內容。`
    adapter.beginTurn()
    handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: contentPrompt }] })
    await handle.agent.whenIdle()
    const contentTurnArtifacts = await service.artifacts({ sessionId })
    const contentArtifact = contentTurnArtifacts.find(artifact => artifact.source.kind === 'generated' && artifact.source.sessionId === sessionId && artifact.source.label === LABEL && artifact.protocol === 'content')
    assert(contentArtifact?.source.callId, 'the first real Agent followup did not produce a content solar_present artifact')
    result = { ...result, stage: 'content-turn-complete', fixtureModelCalls: adapter.calls, agentToolRequests: adapter.agentToolRequests, auxiliaryCalls: adapter.auxiliaryCalls, contentCallId: contentArtifact.source.callId, contentArtifactId: contentArtifact.id, artifactIds: contentTurnArtifacts.map(artifact => artifact.id), completedTurns: [{ kind: 'content', status: 'idle' }] }
    await saveReceipt(receiptPath, result)

    const openuiPrompt = `${LABEL}\n請在同一真實會話中使用 solar_present 工具生成並保存 OpenUI 表單。`
    adapter.beginTurn()
    handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: openuiPrompt }] })
    await handle.agent.whenIdle()
    result = { ...result, stage: 'openui-turn-complete', fixtureModelCalls: adapter.calls, agentToolRequests: adapter.agentToolRequests, auxiliaryCalls: adapter.auxiliaryCalls, completedTurns: [{ kind: 'content', status: 'idle' }, { kind: 'openui', status: 'idle' }] }
    await saveReceipt(receiptPath, result)
    assert(adapter.agentToolRequests >= 4, `expected each of two real Agent turns to issue solar_present then finish; agentToolRequests=${adapter.agentToolRequests}; auxiliaryCalls=${adapter.auxiliaryCalls}; totalCalls=${adapter.calls}`)
    assert(blockedModelRequests.length === 0, `non-fixture model route was blocked: ${JSON.stringify(blockedModelRequests)}`)
    const artifacts = await service.artifacts({ sessionId })
    result = { ...result, stage: 'openui-artifacts-inspected', fixtureModelCalls: adapter.calls, agentToolRequests: adapter.agentToolRequests, auxiliaryCalls: adapter.auxiliaryCalls, artifactIds: artifacts.map(artifact => artifact.id), generatedArtifacts: artifacts.filter(artifact => artifact.source.kind === 'generated').map(({ id, protocol, source }) => ({ id, protocol, label: source.label, callId: source.callId })) }
    await saveReceipt(receiptPath, result)
    const openuiArtifact = artifacts.find(artifact => artifact.source.kind === 'generated' && artifact.source.sessionId === sessionId && artifact.source.label === `${LABEL} · OpenUI` && artifact.protocol === 'openui')
    assert(openuiArtifact?.source.callId, `the second real Agent followup did not produce an OpenUI solar_present artifact; agentId=${sessionId}; agentToolRequests=${adapter.agentToolRequests}; auxiliaryCalls=${adapter.auxiliaryCalls}; totalCalls=${adapter.calls}; generated=${JSON.stringify(artifacts.filter(a => a.source.kind === 'generated').map(a => ({ id: a.id, protocol: a.protocol, label: a.source.label, callId: a.source.callId })))}`)
    assert(contentArtifact.raw?.label === LABEL && contentArtifact.payload?.label === LABEL, 'generated content lost its source-preserving payload')
    assert(typeof openuiArtifact.raw === 'string' && openuiArtifact.raw === openuiArtifact.payload && openuiArtifact.raw.includes('TextContent'), 'generated OpenUI artifact did not retain its exact source text')
    const initialWidgetState = await service.widgetState({ sessionId, artifactId: openuiArtifact.id })
    assert(initialWidgetState.revision === 0, 'new OpenUI artifact unexpectedly has prior widget state')
    const savedWidgetState = await service.saveWidgetState({ sessionId, artifactId: openuiArtifact.id, expectedRevision: initialWidgetState.revision, state: { contact: { name: { value: 'Local canary state', componentType: 'Input' } } } })
    assert(savedWidgetState.revision === 1, 'widget state save did not advance its CAS revision')
    result = { ...result, stage: 'agent-session-created', agentId: sessionId, callId: contentArtifact.source.callId, artifactId: contentArtifact.id, contentCallId: contentArtifact.source.callId, contentArtifactId: contentArtifact.id, openuiCallId: openuiArtifact.source.callId, openuiArtifactId: openuiArtifact.id, artifactIds: artifacts.map(artifact => artifact.id), widgetState: savedWidgetState, prompt: [contentPrompt, openuiPrompt], fixtureModelCalls: adapter.calls, agentToolRequests: adapter.agentToolRequests, auxiliaryCalls: adapter.auxiliaryCalls, blockedModelRequests, completedTurns: [{ kind: 'content', status: 'idle' }, { kind: 'openui', status: 'idle' }], checks: { ...result.checks, realAgentLoop: true, actualToolCalls: 2, contentArtifact: true, openuiArtifact: true, openuiRawPreserved: true, widgetStateCAS: true, noNonFixtureModelRoute: true } }
    await saveReceipt(receiptPath, result)
  } catch (error) { runError = error }
  finally {
    if (handle) {
      try { await handle.dispose() } catch (error) { runError ??= error }
    }
    try { await ctx.sessionPersistence.flush() } catch (error) { runError ??= error }
    disposeGuard(); disposeAdapter()
    if (savedOn && !samePreferences(savedOn, initial)) {
      try {
        const current = cleanSettings(await service.settings())
        if (!samePreferences(current, initial)) {
          assert(current.revision === savedOn.revision && samePreferences(current, savedOn), `preferences changed outside this canary; refusing to overwrite revision ${current.revision}`)
          const restored = cleanSettings(await service.saveSettings(settingsInput(initial, current.revision)))
          assert(samePreferences(restored, initial), 'settings restore did not recover the original preference values')
          result = { ...result, restoredSettings: restored, checks: { ...result.checks, settingsRestored: true } }
        } else result = { ...result, restoredSettings: current, checks: { ...result.checks, settingsRestored: true } }
      } catch (error) { runError ??= error }
    } else {
      result = { ...result, restoredSettings: cleanSettings(await service.settings()), checks: { ...result.checks, settingsRestored: true } }
    }
  }
  if (runError) {
    result = { ...result, stage: 'failed-after-session-creation', ok: false, fixtureModelCalls: adapter.calls, agentToolRequests: adapter.agentToolRequests, auxiliaryCalls: adapter.auxiliaryCalls, agentId: result.agentId ?? handle?.agent.id, completedTurns: result.completedTurns ?? [], error: errorValue(runError), checks: { ...result.checks, modelCallsWereFixtureOnly: blockedModelRequests.length === 0 } }
    await saveReceipt(receiptPath, result)
    throw runError
  }
  assert(result.agentId && result.callId && result.artifactId, 'canary finished without durable Agent/tool/artifact identities')
  const session = await inspectDurableSession(ctx, result.agentId, [result.contentCallId, result.openuiCallId])
  result = { ...result, stage: 'run-complete', persistedSession: session, checks: { ...result.checks, actualSessionStoreRead: true, labelsSessionAsTestOnly: session.eventCount > 0 } }
  await saveReceipt(receiptPath, result)
  return result
}

async function launch(ctx) {
  const mode = required('SOLAR_IEP_CANARY_MODE')
  const receiptPath = required('SOLAR_IEP_CANARY_RECEIPT')
  if (mode === 'run') return runCanary(ctx, receiptPath)
  if (mode === 'verify') return verifyAgain(ctx, receiptPath)
  if (mode === 'restore-only') return restoreOnly(ctx, receiptPath)
  throw new Error(`Unsupported canary mode: ${mode}`)
}

export const name = 'intelligent-experience-canary'
export const inject = ['appReady', 'sessionPersistence']

export function apply(ctx) {
  const ready = ctx.get('appReady')
  if (typeof ready?.onReady !== 'function') throw new Error('appReady service is unavailable')
  const exit = ctx.get('appExit')
  if (typeof exit !== 'function') throw new Error('appExit service is unavailable')
  let started = false
  return ready.onReady(() => {
    if (started) return
    started = true
    void launch(ctx).then(async result => {
      await saveReceipt(required('SOLAR_IEP_CANARY_RECEIPT'), { ...result, ok: true, completedAt: new Date().toISOString() })
      exit(0)
    }).catch(async error => {
      const receiptPath = process.env.SOLAR_IEP_CANARY_RECEIPT
      const detail = errorValue(error)
      process.stderr.write(`intelligent-experience canary (${process.env.SOLAR_IEP_CANARY_MODE ?? 'unknown'}): ${detail.name}: ${detail.message}\n`)
      if (receiptPath) {
        try {
          const prior = JSON.parse(await readFile(receiptPath, 'utf8'))
          await saveReceipt(receiptPath, { ...prior, ok: false, failedAt: new Date().toISOString(), error: detail })
        } catch { /* Keep the original diagnostic if the checkpoint itself is unreadable. */ }
      }
      exit(1)
    })
  })
}
