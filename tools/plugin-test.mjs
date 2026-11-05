import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CLI_ROOT = ROOT
const TEMP_ROOT = process.platform === 'darwin' ? '/private/tmp' : tmpdir()
const PACKAGE = ROOT
// Optional exact packed candidate; the source tree still supplies fixture and expected metadata.
const PACKAGE_SPEC = process.env.INTELLIGENT_UI_TEST_PACKAGE_TGZ ? resolve(process.env.INTELLIGENT_UI_TEST_PACKAGE_TGZ) : PACKAGE
const PROBE = join(ROOT, 'tools', 'fixtures', 'intelligent-experience-probe')
const PROFILE = 'solar-intelligent-experience-test'
const TIMEOUT = 120_000
const CREDENTIAL = /(?:^|_)(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|CREDENTIALS?|PRIVATE_KEY|CLIENT_SECRET|OAUTH|BEARER)(?:$|_)/i
const PROVIDER = /^(?:DEEPSEEK|OPENAI|ANTHROPIC|CLAUDE|CODEX)(?:_|$)/i

function scrub(home, dshHome, marker) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') || CREDENTIAL.test(key) || PROVIDER.test(key) || /(?:PROXY|AUTH|CREDENTIAL)/i.test(key)) delete env[key]
  }
  return { ...env, HOME: home, USERPROFILE: home, DSH_HOME: dshHome, XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'), DSH_TELEMETRY_DISABLED: '1', DSH_TOOLS_MODE: 'native', DSH_PERMISSION_MODE: 'workspace-write', SOLAR_PLUGIN_PROBE_MARKER: marker }
}

async function command(executable, args, env, timeout = TIMEOUT) {
  const child = spawn(executable, args, { cwd: CLI_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let stdout = '', stderr = ''
  child.stdout?.on('data', (data) => { stdout = (stdout + data).slice(-128 * 1024) })
  child.stderr?.on('data', (data) => { stderr = (stderr + data).slice(-128 * 1024) })
  let timer
  const result = await new Promise((resolveResult) => {
    timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }, timeout)
    child.once('error', (error) => resolveResult({ status: null, error: String(error) }))
    child.once('close', (status, signal) => resolveResult({ status, signal }))
  }).finally(() => clearTimeout(timer))
  if (result.status !== 0 || result.signal || result.error) throw new Error(`dsh ${args.join(' ')} failed: ${JSON.stringify({ ...result, stdout, stderr })}`)
  return { stdout, stderr }
}

async function file(path, label) {
  try { if (!(await stat(path)).isFile()) throw new Error('not a regular file') }
  catch (error) { throw new Error(`${label} missing at ${path}: ${String(error)}`) }
}

/** Serialized into a scratch-only fixture package; executes built Remote methods through Gateway. */
async function themeProbe(ctx) {
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const input = JSON.parse(await readFile(process.env.SOLAR_THEME_PROBE_INPUT, 'utf8'))
  const phase = process.env.SOLAR_THEME_PROBE_PHASE
  const result = { phase, pid: process.pid, ok: false, checks: {}, externalModelCalls: 0 }
  const peer = new Peer(ctx, { principal: { kind: 'owner' } })
  const observer = new Peer(ctx, { principal: { kind: 'theme-test-observer' } })
  const gateway = ctx.get('typertGateway')
  const rpc = (method, value, caller = peer) => gateway.invoke({ namespace: 'solarExperience', method, args: value === undefined ? {} : { input: value }, peer: caller })
  const flags = value => JSON.stringify([value.takeover, value.openui, value.mcpApps])
  try {
    assert(typeof gateway?.invoke === 'function', 'actual Typert Gateway is unavailable')
    let state = await rpc('settings')
    assert(flags(state) === input.originalFlags, 'theme probe started with changed original settings flags')
    result.checks.ownerRpc = true

    const libraryRaw = '\uFEFF# Local file fixture\r\n\r\n| Group | Count |\r\n| --- | ---: |\r\n| A | 12 |\r\n'
    const localFiles = await rpc('localFiles')
    assert(localFiles.length===1 && localFiles[0].raw===libraryRaw && localFiles[0].payload===libraryRaw, 'real RPC lost the durable library file or exact original')
    const preview = await rpc('insightPreview',{sessionId:'scratch-insight-preview'})
    assert(preview.sessionId==='scratch-insight-preview' && preview.available===false && preview.runs.length===0, 'real preview RPC did not preserve unavailable/session identity')
    let readDenied=0
    for(const [method,value] of [['localFiles',undefined],['insightPreview',{sessionId:'scratch-insight-preview'}]]) {
      try{await rpc(method,value,observer)}catch(error){if(/remote-access\/denied|EXPERIENCE_OWNER_REQUIRED/.test(`${error.code??''} ${error.message}`))readDenied++}
    }
    assert(readDenied===2, 'non-owner could access private library/preview RPC')
    result.checks.libraryAndPreviewRpc = true
    if (phase === 'install-select') {
      assert(state.revision === input.originalRevision, 'theme probe did not begin at the acknowledged original revision')
      let denied
      try { await rpc('installTheme', { expectedRevision: state.revision, theme: input.theme }, observer) } catch (error) { denied = error }
      assert(denied && /remote-access\/denied|EXPERIENCE_OWNER_REQUIRED/.test(`${denied.code ?? ''} ${denied.message}`), 'non-owner import was not denied at the real RPC boundary')
      assert((await rpc('settings')).revision === state.revision, 'denied import changed the settings revision')
      result.checks.nonOwnerRejected = true
      const imported = await rpc('installTheme', { expectedRevision: state.revision, theme: input.theme })
      assert(imported.theme?.installed.some(theme => theme.id === input.theme.id), 'real theme import did not persist the package')
      assert((imported.theme?.activeId ?? 'empryo') === 'empryo', 'import unexpectedly activated the theme')
      assert(JSON.stringify(imported.appearance) === JSON.stringify(state.appearance), 'import changed existing appearance overrides')
      result.checks.importWithoutActivation = true
      let stale
      try { await rpc('saveSettings', { expectedRevision: state.revision, ...input.flags, themeId: input.theme.id }) } catch (error) { stale = error }
      assert(stale && /revision conflict/i.test(stale.message), 'theme selection accepted a stale settings revision')
      result.checks.cas = true
      const direct = await rpc('saveSettings', { expectedRevision: imported.revision, ...input.flags, appearance: { ...input.theme.appearance, backgroundOpacity: 0.37 } })
      assert(direct.appearance.backgroundOpacity === 0.37, 'direct appearance override did not cross the actual RPC boundary')
      const restored = await rpc('saveSettings', { expectedRevision: direct.revision, ...input.flags, appearance: imported.appearance })
      result.checks.directOpacityRpc = true
      state = await rpc('saveSettings', { expectedRevision: restored.revision, ...input.flags, themeId: input.theme.id })
      assert(state.theme?.activeId === input.theme.id, 'real theme selection was not acknowledged')
      assert(JSON.stringify(state.appearance) === JSON.stringify(input.theme.appearance), 'theme selection did not apply its default appearance')
      result.checks.selected = true
    } else if (phase === 'restart-remove') {
      assert(state.theme?.activeId === input.theme.id, 'selected theme did not survive the actual Host process restart')
      assert(state.theme?.installed.some(theme => isDeepStrictEqual(theme, input.theme)), 'imported package changed across restart')
      assert(JSON.stringify(state.appearance) === JSON.stringify(input.theme.appearance), 'selected theme appearance did not survive restart')
      result.checks.restartRestored = true
      let denied
      try { await rpc('removeTheme', { expectedRevision: state.revision, id: input.theme.id }, observer) } catch (error) { denied = error }
      assert(denied && /remote-access\/denied|EXPERIENCE_OWNER_REQUIRED/.test(`${denied.code ?? ''} ${denied.message}`), 'non-owner removal was not denied at the real RPC boundary')
      assert((await rpc('settings')).revision === state.revision, 'denied removal changed the settings revision')
      result.checks.nonOwnerRemoveRejected = true
      state = await rpc('removeTheme', { expectedRevision: state.revision, id: input.theme.id })
      assert(state.theme?.activeId === 'empryo' && state.theme.installed.length === 0, 'active theme removal did not fall back to Empryo')
      assert(JSON.stringify(state.appearance) === JSON.stringify(input.empryoAppearance), 'active removal did not restore Empryo defaults')
      result.checks.removeActiveFallback = true
      const durable = JSON.parse(await readFile(join(process.env.DSH_HOME, 'solar', 'intelligent-experience-platform', 'settings.json'), 'utf8'))
      assert(JSON.stringify(durable) === JSON.stringify(state), 'theme removal acknowledgement was not durable')
      result.checks.durableFallback = true

      // Exercise the new composition RPCs only after the existing theme and
      // artifact assertions have reached their stable post-restart state.
      // This keeps the original settings/revision and artifact checks intact.
      const compositionBase = {
        sessionId: 'scratch-composition-session',
        documentId: 'scratch-composition-document',
        value: '# Deterministic composition fixture\n\nThe renderer must preserve this source.\n',
        styleMode: 'automatic',
        capabilities: { webgl: false, reducedMotion: false },
        isStreaming: false,
      }
      const originalAdaptive = state.adaptive
      const restoredAdaptive = originalAdaptive ?? { enabled: false, styleMode: 'selected' }
      let adaptiveState = state
      let adaptiveChanged = false
      let removeJev
      let featureRegistered = false
      let featureEnabled = true
      let mockRequests = 0
      let mockReceiptWrites = 0
      const hookCalls = { refresh: 0, preflight: 0, interpret: 0, canAdopt: 0 }
      let firstJudgeStartedResolve
      const firstJudgeStarted = new Promise(resolve => { firstJudgeStartedResolve = resolve })
      const preferred = { theme: 'empryo', surface: 'semantic', chart: 'auto', 'component-set': 'native', layout: 'document', 'object-effect': 'none', live: 'native', loading: 'native', 'text-motion': 'none' }

      try {
        const missingStatus = await rpc('compositionStatus')
        assert(missingStatus.attached === false && missingStatus.featureRegistered === false && missingStatus.featureEnabled === false, `missing Jev status was not explicit: ${JSON.stringify(missingStatus)}`)
        result.checks.compositionMissingJev = true

        adaptiveState = await rpc('saveSettings', { expectedRevision: adaptiveState.revision, ...input.flags, takeover: true, adaptive: { enabled: true, styleMode: 'automatic' } })
        state = adaptiveState
        adaptiveChanged = true
        const missingResult = await rpc('composition', { ...compositionBase, documentId: 'scratch-composition-missing-jev', requestId: 'composition-missing-jev' })
        assert(missingResult.status === 'local' && missingResult.reason === 'JEV_UNAVAILABLE', `missing Jev composition did not fall back locally: ${JSON.stringify(missingResult)}`)
        result.checks.compositionMissingJev = true

        const mockPort = {
          registerFeature(feature) {
            assert(feature?.id === 'ui-composition', `unexpected synthetic Jev feature: ${JSON.stringify(feature)}`)
            featureRegistered = true
            return () => { featureRegistered = false }
          },
          isFeatureEnabled(featureId) { return featureId === 'ui-composition' && featureRegistered && featureEnabled },
          judgmentConnectionIdentity() {
            return { connectionId: 'scratch-jev-connection', baseUrl: 'https://fixture.invalid', model: 'fixture-model', credentialRef: 'fixture-credential', timeoutMs: 1000 }
          },
          async judgeOnce(options) {
            mockRequests += 1
            const operationId = `fixture-composition-operation-${mockRequests}`
            const signal = options.signal ?? new AbortController().signal
            const request = await options.refresh(signal)
            hookCalls.refresh += 1
            options.preflight?.(request)
            hookCalls.preflight += 1
            if (mockRequests === 1) {
              firstJudgeStartedResolve()
              await new Promise(resolve => {
                if (signal.aborted) resolve()
                else signal.addEventListener('abort', resolve, { once: true })
              })
              return { kind: 'cancelled', operationId }
            }
            const answers = request.questions.map(question => {
              const desired = preferred[question.id]
              const option = question.options.find(candidate => candidate.id === desired) ?? question.options[0]
              assert(option, `composition question has no allowed option: ${question.id}`)
              return { id: question.id, kind: 'choice', optionId: option.id }
            })
            const response = { answers }
            const interpreted = await options.interpret?.(response, signal)
            hookCalls.interpret += 1
            assert(interpreted?.usable === true, `synthetic Jev interpretation rejected its allowed choices: ${JSON.stringify(interpreted)}`)
            const adoption = await options.canAdopt?.(response, signal)
            hookCalls.canAdopt += 1
            assert(adoption === true, `synthetic Jev adoption was rejected: ${String(adoption)}`)
            return { kind: 'ok', operationId, attemptId: `fixture-composition-attempt-${mockRequests}`, response }
          },
          async writeReceipt(operationId, receipt) {
            mockReceiptWrites += 1
            assert(operationId === 'fixture-composition-operation-2' && receipt?.status === 'observed', `synthetic Jev receipt was malformed: ${JSON.stringify({ operationId, receipt })}`)
            return { accepted: true }
          },
        }
        removeJev = ctx.provide('jev', mockPort)
        const attachedStatus = await (async () => {
          const deadline = Date.now() + 2000
          let current
          do {
            current = await rpc('compositionStatus')
            if (current.attached && current.featureRegistered && current.featureEnabled) return current
            await new Promise(resolve => setTimeout(resolve, 0))
          } while (Date.now() < deadline)
          return current
        })()
        assert(attachedStatus.attached === true && attachedStatus.featureRegistered === true && attachedStatus.featureEnabled === true && attachedStatus.adaptiveEnabled === true, `synthetic Jev did not attach through optional injection: ${JSON.stringify(attachedStatus)}`)
        result.checks.compositionJevAttached = true

        const catalog = await rpc('compositionCatalog')
        assert(catalog.revision === 1 && Array.isArray(catalog.entries) && catalog.entries.some(entry => entry.id === 'theme:empryo') && catalog.entries.some(entry => entry.id === 'surface:arbitrary-html' && entry.availability === 'blocked'), 'composition catalog RPC did not expose the bounded built-in catalog')
        result.checks.compositionCatalog = true

        featureEnabled = false
        const disabledStatus = await rpc('compositionStatus')
        assert(disabledStatus.attached === true && disabledStatus.featureRegistered === true && disabledStatus.featureEnabled === false, `disabled Jev status was not observable: ${JSON.stringify(disabledStatus)}`)
        const disabledResult = await rpc('composition', { ...compositionBase, documentId: 'scratch-composition-disabled-jev', requestId: 'composition-disabled-jev' })
        assert(disabledResult.status === 'local' && disabledResult.reason === 'JEV_FEATURE_DISABLED', `disabled Jev composition did not fall back locally: ${JSON.stringify(disabledResult)}`)
        result.checks.compositionDisabledJev = true
        featureEnabled = true

        let ownerRejected = 0
        for (const [method, value] of [['compositionStatus', undefined], ['compositionCatalog', undefined], ['composition', { ...compositionBase, requestId: 'composition-owner-refusal' }]]) {
          try { await rpc(method, value, observer) } catch (error) {
            if (/remote-access\/denied|EXPERIENCE_OWNER_REQUIRED/.test(`${error.code ?? ''} ${error.message}`)) ownerRejected += 1
          }
        }
        assert(ownerRejected === 3, `non-owner composition RPC access was not refused: ${ownerRejected}/3`)
        result.checks.compositionOwnerRejected = true

        const cancelInput = { ...compositionBase, documentId: 'scratch-composition-cancel', requestId: 'composition-cancel' }
        const pendingCancel = rpc('composition', cancelInput)
        await Promise.race([firstJudgeStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('synthetic Jev did not start the cancellable request')), 2000))])
        const cancelled = await rpc('compositionCancel', { sessionId: cancelInput.sessionId, documentId: cancelInput.documentId, requestId: cancelInput.requestId })
        assert(cancelled.cancelled === true && cancelled.reason === 'COMPOSITION_CANCELLED', `compositionCancel did not acknowledge the matching request: ${JSON.stringify(cancelled)}`)
        const cancelledResult = await Promise.race([pendingCancel, new Promise((_, reject) => setTimeout(() => reject(new Error('cancelled composition did not settle')), 2000))])
        assert(cancelledResult.status === 'stale' && cancelledResult.reason === 'COMPOSITION_CANCELLED', `cancelled composition was replayed or adopted: ${JSON.stringify(cancelledResult)}`)
        result.checks.compositionCancelled = true

        const selectedInput = { ...compositionBase, documentId: 'scratch-composition-selected', requestId: 'composition-selected' }
        const selected = await rpc('composition', selectedInput)
        assert(selected.status === 'selected' && selected.requestId === selectedInput.requestId && selected.selection?.themeId === 'empryo' && selected.selection?.layout === 'document', `selected composition did not preserve deterministic theme/layout choices: ${JSON.stringify(selected)}`)
        assert(hookCalls.refresh === 2 && hookCalls.preflight === 2 && hookCalls.interpret === 1 && hookCalls.canAdopt === 1, `synthetic Jev callbacks were not exercised exactly: ${JSON.stringify(hookCalls)}`)
        assert(mockRequests === 2 && typeof selected.operationId === 'string', `composition request count or operation identity was unexpected: ${JSON.stringify({ mockRequests, selected })}`)
        result.checks.compositionSelected = true

        const receiptInput = { sessionId: selectedInput.sessionId, documentId: selectedInput.documentId, sourceVersion: selected.sourceVersion, operationId: selected.operationId, observed: true }
        const receipt = await rpc('compositionReceipt', receiptInput)
        assert(receipt.status === 'observed' && receipt.operationId === selected.operationId && receipt.sourceVersion === selected.sourceVersion, `compositionReceipt did not acknowledge the selected operation: ${JSON.stringify(receipt)}`)
        result.checks.compositionReceipt = true
        let crossSessionRejected = false
        try { await rpc('compositionReceipt', { ...receiptInput, sessionId: 'scratch-other-session' }) } catch (error) { crossSessionRejected = /COMPOSITION_RECEIPT_BINDING_MISMATCH/.test(`${error.code ?? ''} ${error.message}`) }
        assert(crossSessionRejected, 'compositionReceipt accepted a receipt from another session')
        const repeatedReceipt = await rpc('compositionReceipt', receiptInput)
        assert(repeatedReceipt.status === 'observed' && mockReceiptWrites === 1, `observed composition receipt was replayed to Jev: ${JSON.stringify({ repeatedReceipt, mockReceiptWrites })}`)
        result.checks.compositionReceiptCrossSessionRejected = true
        const cached = await rpc('composition', selectedInput)
        assert(cached.status === 'selected' && cached.operationId === selected.operationId && mockRequests === 2, `cached composition replayed the synthetic Jev request: ${JSON.stringify({ cached, mockRequests })}`)
        result.checks.compositionNoReplay = true
        result.composition = { mockRequests, mockReceiptWrites, hookCalls, selected, cancelled, cancelledResult, catalogRevision: catalog.revision }
      } finally {
        try {
          if (typeof removeJev === 'function') await removeJev()
        } finally {
          if (adaptiveChanged) {
            state = await rpc('saveSettings', { expectedRevision: adaptiveState.revision, ...input.flags, adaptive: restoredAdaptive })
            assert(JSON.stringify(state.adaptive ?? null) === JSON.stringify(restoredAdaptive), `adaptive scratch settings were not restored: ${JSON.stringify(state.adaptive)}`)
            result.checks.compositionSettingsRestored = true
          }
        }
      }
    } else throw new Error(`unknown theme probe phase: ${phase}`)
    assert(flags(state) === input.originalFlags, 'theme RPC changed original takeover/OpenUI/MCP flags')
    result.checks.flagsPreserved = true
    const artifacts = []
    for (const sessionId of input.sessionIds) artifacts.push(...await rpc('artifacts', { sessionId }))
    const digest = createHash('sha256').update(JSON.stringify(artifacts.sort((a, b) => a.id.localeCompare(b.id)))).digest('hex')
    assert(digest === input.artifactDigest, 'theme RPC changed original artifacts, raw values or provenance')
    result.checks.artifactsPreserved = true
    result.settings = state
    result.ok = true
  } catch (error) { result.error = { name: error.name, message: error.message, code: error.code } }
  finally { await observer.dispose(); await peer.dispose() }
  await writeFile(process.env.SOLAR_THEME_PROBE_MARKER, `${JSON.stringify(result, null, 2)}\n`)
  ctx.get('appExit')(result.ok ? 0 : 1)
}

async function artifactFingerprint(root) {
  const result = []
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`, path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path, `${relative}/`)
      else if (entry.isFile()) result.push([relative, createHash('sha256').update(await readFile(path)).digest('hex')])
    }
  }
  await visit(join(root, 'artifacts'))
  return JSON.stringify(result)
}

async function checkThemeRpc({ dshCli, scratch, env, fixture, marker, originalSettings }) {
  const root = join(scratch, 'solar', 'intelligent-experience-platform')
  const beforeArtifacts = await artifactFingerprint(root)
  const probeDir = join(scratch, 'theme-probe-package')
  await mkdir(probeDir)
  // Replace only the scratch fixture package. The shipped plugin stays installed
  // from its built lib; neither source TS nor any installed Desktop profile runs.
  await writeFile(join(probeDir, 'package.json'), JSON.stringify({ ...fixture, peerDependencies: { ...fixture.peerDependencies, '@deepseek-ai/dsh-client-connection': '0.2.1-rc.2' } }))
  await writeFile(join(probeDir, 'cordis.patch.yml'), await readFile(join(PROBE, 'cordis.patch.yml')))
  const code = `import { readFile, writeFile } from 'node:fs/promises'\nimport { join } from 'node:path'\nimport { createHash } from 'node:crypto'\nimport { isDeepStrictEqual } from 'node:util'\nimport { Peer } from '@deepseek-ai/dsh-client-connection'\n${themeProbe.toString()}\nexport const name='intelligent-experience-probe';export const inject=['appReady'];export function apply(ctx){let started=false;return ctx.get('appReady').onReady(()=>{if(started)return;started=true;void themeProbe(ctx).catch(error=>{process.stderr.write(String(error.stack??error));ctx.get('appExit')(1)})})}\n`
  await writeFile(join(probeDir, 'index.mjs'), code)
  const theme = { ...JSON.parse(await readFile(join(PACKAGE, 'theme', 'paper-flow.dsh-theme.json'), 'utf8')), id: 'scratch-theme', name: 'Scratch theme acceptance', appearance: { backgroundColor: '#24262b', translucent: true, backgroundOpacity: 0.43 } }
  const empryo = JSON.parse(await readFile(join(PACKAGE, 'src', 'themes', 'empryo.dsh-theme.json'), 'utf8'))
  const inputPath = join(scratch, 'theme-input.json')
  const flags = { takeover: originalSettings.takeover, openui: originalSettings.openui, mcpApps: originalSettings.mcpApps }
  const input = { theme, flags, originalFlags: JSON.stringify(Object.values(flags)), originalRevision: originalSettings.revision, empryoAppearance: empryo.appearance, sessionIds: [...new Set(marker.artifacts.map(artifact => artifact.source.sessionId))], artifactDigest: createHash('sha256').update(JSON.stringify([...marker.artifacts].sort((a, b) => a.id.localeCompare(b.id)))).digest('hex') }
  await writeFile(inputPath, JSON.stringify(input))
  await command(dshCli, ['plugin', '--profile', PROFILE, 'add', probeDir], env)
  const phases = []
  for (const phase of ['install-select', 'restart-remove']) {
    const markerPath = join(scratch, `theme-${phase}.json`)
    let processError
    try { await command(dshCli, ['--profile', PROFILE], { ...env, SOLAR_THEME_PROBE_INPUT: inputPath, SOLAR_THEME_PROBE_PHASE: phase, SOLAR_THEME_PROBE_MARKER: markerPath }) }
    catch (error) { processError = error }
    let result
    try { result = JSON.parse(await readFile(markerPath, 'utf8')) }
    catch (error) {
      throw Object.assign(new Error(`theme ${phase} produced no readable phase receipt`, { cause: processError ?? error }), { themeEvidence: { ok: false, failedPhase: phase, phases, externalModelCalls: 0 } })
    }
    phases.push(result)
    if (!result.ok || processError) throw Object.assign(new Error(`theme ${phase} failed: ${JSON.stringify(result)}`, { cause: processError }), { themeEvidence: { ok: false, failedPhase: phase, phases, externalModelCalls: 0 } })
    const required = ['ownerRpc', 'libraryAndPreviewRpc', 'flagsPreserved', 'artifactsPreserved', ...(phase === 'install-select' ? ['nonOwnerRejected', 'importWithoutActivation', 'cas', 'directOpacityRpc', 'selected'] : ['restartRestored', 'nonOwnerRemoveRejected', 'removeActiveFallback', 'durableFallback', 'compositionJevAttached', 'compositionMissingJev', 'compositionDisabledJev', 'compositionCatalog', 'compositionOwnerRejected', 'compositionCancelled', 'compositionSelected', 'compositionReceipt', 'compositionReceiptCrossSessionRejected', 'compositionNoReplay', 'compositionSettingsRestored'])]
    if (required.some(check => result.checks[check] !== true)) throw new Error(`theme ${phase} is missing acceptance evidence: ${JSON.stringify(result)}`)
  }
  if (phases[0].pid === phases[1].pid) throw new Error('theme restart acceptance reused one Host process')
  if (await artifactFingerprint(root) !== beforeArtifacts) throw new Error('theme acceptance modified original artifact file bytes')
  return { ok: true, realOwnerRpc: true, hostProcessRestart: true, originalArtifactFilesUnchanged: true, externalModelCalls: 0, phases }
}

async function main() {
  const dshCli = await (async () => {
    for (const candidate of [join(ROOT, 'node_modules', '.bin', 'dsh')]) {
      try { await stat(candidate); return candidate } catch { /* report the missing local dependency below */ }
    }
    throw new Error('published DSH CLI is unavailable in this repository; run pnpm install --ignore-scripts')
  })()
  const plugin = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8'))
  const fixture = JSON.parse(await readFile(join(PROBE, 'package.json'), 'utf8'))
  if (plugin.name !== '@lisihao/dsh-solar-intelligent-experience-platform') throw new Error(`unexpected package name: ${plugin.name}`)
  if (fixture.name !== '@lisihao/dsh-solar-intelligent-experience-probe') throw new Error(`unexpected probe name: ${fixture.name}`)
  await file(join(PACKAGE, 'lib', 'index.js'), 'built plugin entry')
  await file(dshCli, 'published DSH CLI')
  const scratch = await mkdtemp(join(TEMP_ROOT, 'dsh-v4-experience-plugin-test-'))
  const receiptPath = resolve(process.argv[2] ?? join(TEMP_ROOT, `${basename(scratch)}-receipt.json`))
  const env = scrub(join(scratch, 'home'), scratch, join(scratch, 'probe', 'marker.json'))
  const profileDir = join(scratch, 'profiles', PROFILE)
  let failure
  let marker
  let themes
  try {
    try {
      for (const packageDir of [PACKAGE_SPEC, PROBE]) await command(dshCli, ['plugin', '--profile', PROFILE, 'add', packageDir], env)
      const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      const bundles = profile?.dsh?.profile?.bundles
      const expected = [plugin.name, fixture.name]
      if (!Array.isArray(bundles) || expected.some((name) => !bundles.includes(name))) throw new Error(`scratch profile did not enable both built packages: ${JSON.stringify(bundles)}`)
      await command(dshCli, ['--profile', PROFILE], env)
      marker = JSON.parse(await readFile(env.SOLAR_PLUGIN_PROBE_MARKER, 'utf8'))
      if (marker?.ok !== true) throw new Error(`keyless fixture reported failure: ${JSON.stringify(marker)}`)
      const required = ['service', 'settingsOff', 'cas', 'settingsOn', 'toolRegistered', 'canvasDiscovery', 'agentToolExecution', 'artifactRead', 'rawAndProvenance', 'settingsRestored', 'registry', 'durableMarker', 'disposed']
      const missing = required.filter((key) => marker.checks?.[key] !== true)
      if (missing.length) throw new Error(`probe missing checks ${missing.join(', ')}: ${JSON.stringify(marker)}`)
      const root = join(scratch, 'solar', 'intelligent-experience-platform')
      const settings = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))
      if (settings.takeover !== false || settings.revision !== 2) throw new Error(`settings restore was not durable: ${JSON.stringify(settings)}`)
      if (!Array.isArray(marker.artifacts) || marker.artifacts.length < 2 || !marker.artifacts.some((entry) => entry.source?.kind === 'generated') || !marker.artifacts.some((entry) => entry.source?.kind === 'assistant')) throw new Error('probe receipt did not include both generated content and standard assistant artifacts for the actual Agent')
      themes = await checkThemeRpc({ dshCli, scratch, env, fixture, marker, originalSettings: settings })
    } catch (error) { failure = error; themes = error.themeEvidence ?? themes }
  } finally {
    if (!failure) await rm(scratch, { recursive: true, force: true })
  }
  const report = { formatVersion: 1, ok: failure === undefined, profile: PROFILE, marker, themes, scratch: failure ? scratch : undefined, scratchRemoved: failure === undefined, liveModels: 0 }
  await mkdir(join(receiptPath, '..'), { recursive: true })
  await writeFile(receiptPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (failure) {
    failure.message += `\nscratch preserved at ${scratch}\nreceipt written to ${receiptPath}`
    throw failure
  }
  process.stdout.write(JSON.stringify({ ...report, receiptPath }, null, 2) + '\n')
}

main().catch((error) => { process.stderr.write(`intelligent-experience plugin-test: ${error?.stack ?? String(error)}\n`); process.exitCode = 1 })
