import { createServer } from 'node:http'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { openuiCssPlugin } from '../build-css.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const acceptanceRoot = resolve(root, '.acceptance/adaptive-ui-browser')
const runtimeDirectory = join(acceptanceRoot, `runtime-${process.pid}`)
const sessionId = 'synthetic-adaptive-browser-session'
const requestedPort = Number.parseInt(process.env.ADAPTIVE_UI_PREVIEW_PORT ?? '0', 10)

await mkdir(runtimeDirectory, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: {
    host: 'src/adaptive-ui/host.ts',
    planner: 'src/adaptive-ui/planner.ts',
  },
  outdir: runtimeDirectory,
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'esm',
})

const { AdaptiveCompositionCoordinator } = await import(pathToFileURL(join(runtimeDirectory, 'host.js')).href)
const { buildCompositionCandidates, validateCompositionChoices } = await import(pathToFileURL(join(runtimeDirectory, 'planner.js')).href)
const elkWorkerSource = await readFile(resolve(root, 'node_modules/elkjs/lib/elk-worker.min.js'), 'utf8')
const browserBundle = await build({
  absWorkingDir: root,
  entryPoints: ['tools/adaptive-ui-preview-fixture.ts'],
  outfile: join(runtimeDirectory, 'fixture.js'),
  bundle: true,
  write: false,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  loader: { '.css': 'text', '.woff2': 'dataurl' },
  define: {
    'process.env.NODE_ENV': '"production"',
    __IEXP_ELK_WORKER_SOURCE__: JSON.stringify(elkWorkerSource),
  },
  plugins: [openuiCssPlugin],
})
const browserScript = browserBundle.outputFiles.find(file => file.path.endsWith('.js'))?.text
if (!browserScript) throw new Error('ADAPTIVE_PREVIEW_BROWSER_BUNDLE_MISSING')

const fixtureDocuments = new Map([
  ['synthetic-task-board-soft', { scenario: 'board-soft', kind: 'markdown' }],
  ['synthetic-task-table-mechanical', { scenario: 'table-mechanical', kind: 'markdown' }],
  ['synthetic-history-visx', { scenario: 'history-visx', kind: 'markdown' }],
  ['synthetic-history-openui', { scenario: 'history-openui', kind: 'markdown' }],
  ['synthetic-live-static', { scenario: 'live-static', kind: 'live-series' }],
  ['synthetic-scope-plain', { scenario: 'scope-plain', kind: 'markdown' }],
])

const scenarioChoices = {
  'board-soft': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'auto', 'component-set': 'soft-relief', layout: 'board' },
  'table-mechanical': { theme: 'uiverse-mechanical-outline', surface: 'semantic', chart: 'auto', 'component-set': 'mechanical-outline', layout: 'table' },
  'history-visx': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'visx', 'component-set': 'soft-relief', layout: 'auto' },
  'history-openui': { theme: 'uiverse-mechanical-outline', surface: 'semantic', chart: 'openui', 'component-set': 'mechanical-outline', layout: 'auto' },
  'live-static': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'auto', 'component-set': 'soft-relief', layout: 'auto', live: 'native' },
  'scope-plain': { theme: 'plain', surface: 'semantic', chart: 'auto', 'component-set': 'native', layout: 'document' },
}

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function asRecord(value, code) {
  if (!isRecord(value)) throw new Error(code)
  return value
}
function safeSchema(bundle) {
  return {
    revision: bundle.revision,
    questionIds: bundle.questions.map(question => question.id).sort(),
    optionCounts: Object.fromEntries(bundle.questions.map(question => [question.id, question.options.length])),
  }
}
function questionShape(questions) {
  return JSON.stringify(questions.map(question => ({ id: question.id, kind: question.kind, options: question.options.map(option => option.id) })))
}
function plannerBundleFromRequest(request) {
  const state = asRecord(request.state, 'SYNTHETIC_REQUEST_STATE_INVALID')
  const source = asRecord(state.source, 'SYNTHETIC_REQUEST_SOURCE_INVALID')
  const composition = asRecord(state.composition, 'SYNTHETIC_REQUEST_COMPOSITION_INVALID')
  const rebuilt = buildCompositionCandidates({
    value: source.value,
    themes: composition.themes,
    selectedThemeId: composition.selectedThemeId,
    styleMode: composition.styleMode,
    capabilities: composition.capabilities,
    isStreaming: composition.isStreaming,
  })
  if (questionShape(rebuilt.questions) !== questionShape(request.questions)) throw new Error('SYNTHETIC_CANDIDATE_SCHEMA_MISMATCH')
  return rebuilt
}

function fixtureForInput(input, endpoint) {
  const record = asRecord(input, 'SYNTHETIC_INPUT_INVALID')
  if (record.sessionId !== sessionId || typeof record.documentId !== 'string') throw new Error('SYNTHETIC_FIXTURE_SCOPE_REQUIRED')
  const fixture = fixtureDocuments.get(record.documentId)
  if (!fixture) throw new Error('SYNTHETIC_DOCUMENT_UNKNOWN')
  if (endpoint === 'composition') {
    if (fixture.kind === 'markdown' && typeof record.value !== 'string') throw new Error('SYNTHETIC_MARKDOWN_REQUIRED')
    if (fixture.kind === 'live-series') {
      const live = asRecord(record.value, 'SYNTHETIC_LIVE_SOURCE_REQUIRED')
      if (live.type !== 'live-series' || live.source !== 'synthetic:local-latency-snapshot' || !Array.isArray(live.points)) throw new Error('SYNTHETIC_LIVE_SOURCE_INVALID')
    }
  }
  return fixture
}

const serverSettings = {
  takeover: true,
  adaptive: { enabled: true, styleMode: 'automatic' },
  theme: { activeId: 'empryo', installed: [] },
}

const operationEvidence = new Map()
let operationCount = 0
class SyntheticJevPort {
  registerFeature(feature) {
    if (feature.id !== 'ui-composition') throw new Error('SYNTHETIC_FEATURE_ID_INVALID')
    return () => undefined
  }
  isFeatureEnabled(featureId) { return featureId === 'ui-composition' }
  judgmentConnectionIdentity() {
    return {
      connectionId: 'synthetic-adaptive-browser-fixture',
      baseUrl: 'http://127.0.0.1/synthetic-jev',
      model: 'synthetic-choice-selector',
      credentialRef: 'synthetic:no-credential',
      timeoutMs: 250,
    }
  }
  async judgeOnce(options) {
    const operationId = `synthetic-operation-${++operationCount}`
    if (options.signal?.aborted) return { kind: 'cancelled', operationId }
    const request = await options.refresh(options.signal ?? new AbortController().signal)
    options.preflight?.(request)
    if (options.signal?.aborted) return { kind: 'cancelled', operationId }
    const state = asRecord(request.state, 'SYNTHETIC_REQUEST_STATE_INVALID')
    const source = asRecord(state.source, 'SYNTHETIC_REQUEST_SOURCE_INVALID')
    const documentId = source.documentId
    const fixture = fixtureDocuments.get(documentId)
    if (!fixture) return { kind: 'not-adopted', operationId, reason: 'SYNTHETIC_DOCUMENT_UNKNOWN' }
    const bundle = plannerBundleFromRequest(request)
    const preferred = scenarioChoices[fixture.scenario]
    const answers = {}
    for (const question of request.questions) {
      const desired = preferred[question.id]
      const option = desired === undefined ? question.options[0]?.id : question.options.find(candidate => candidate.id === desired)?.id
      if (!option) throw new Error(`SYNTHETIC_OPTION_NOT_ALLOWED_${question.id}`)
      answers[question.id] = option
    }
    const selection = validateCompositionChoices(bundle, answers)
    const response = { answers: Object.entries(answers).map(([id, optionId]) => ({ id, kind: 'choice', optionId })) }
    const interpreted = await options.interpret?.(response, options.signal ?? new AbortController().signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId, reason: interpreted.reason }
    const adoption = await options.canAdopt?.(response, options.signal ?? new AbortController().signal)
    if (adoption !== undefined && adoption !== true) return { kind: 'not-adopted', operationId, reason: adoption }
    operationEvidence.set(operationId, { documentId, scenario: fixture.scenario, schema: safeSchema(bundle), selection, observed: false })
    return { kind: 'ok', operationId, attemptId: `synthetic-attempt-${operationCount}`, response }
  }
  async writeReceipt(operationId) {
    const evidence = operationEvidence.get(operationId)
    if (!evidence) throw new Error('SYNTHETIC_RECEIPT_OPERATION_UNKNOWN')
    evidence.observed = true
    process.stdout.write(`ADAPTIVE_UI_EVENT=${JSON.stringify({ type: 'receipt', documentId: evidence.documentId, operationId, schema: evidence.schema, selection: evidence.selection, observed: true, externalModelCalls: 0 })}\n`)
    return { synthetic: true, externalModelCalls: 0 }
  }
}

const syntheticJev = new SyntheticJevPort()
const coordinator = new AdaptiveCompositionCoordinator({
  getSettings: async () => serverSettings,
  getJev: () => syntheticJev,
  now: () => new Date('2026-11-05T00:00:00.000Z'),
})

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(value))
}
async function requestBody(req) {
  let bytes = 0
  const chunks = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 2 * 1024 * 1024) throw new Error('SYNTHETIC_REQUEST_TOO_LARGE')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function html() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Adaptive UI synthetic browser acceptance</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
}

const server = createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    if (req.headers.origin && req.headers.origin !== origin) throw new Error('SYNTHETIC_ORIGIN_REJECTED')
    const path = new URL(req.url ?? '/', origin).pathname
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html())
      return
    }
    if (req.method === 'GET' && path === '/fixture.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(browserScript)
      return
    }
    if (req.method !== 'POST' || !['/api/composition', '/api/compositionCancel', '/api/compositionReceipt'].includes(path)) {
      res.writeHead(404).end()
      return
    }
    const input = await requestBody(req)
    const endpoint = path === '/api/composition' ? 'composition' : path === '/api/compositionCancel' ? 'compositionCancel' : 'compositionReceipt'
    fixtureForInput(input, endpoint)
    if (endpoint === 'composition') {
      const result = await coordinator.compose(input)
      const evidence = result.operationId ? operationEvidence.get(result.operationId) : undefined
      json(res, 200, result, evidence ? {
        'x-adaptive-schema-revision': String(evidence.schema.revision),
        'x-adaptive-schema-questions': evidence.schema.questionIds.join(','),
      } : undefined)
      return
    }
    if (endpoint === 'compositionCancel') return json(res, 200, coordinator.cancel(input))
    return json(res, 200, await coordinator.receipt(input))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    json(res, 400, { error: message })
  }
})

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(Number.isFinite(requestedPort) ? requestedPort : 0, '127.0.0.1', resolveListen)
})
const origin = `http://127.0.0.1:${server.address().port}`
process.stdout.write(`ADAPTIVE_UI_PREVIEW_URL=${origin}\n`)
process.stdout.write('ADAPTIVE_UI_PREVIEW_SYNTHETIC=true externalModelCalls=0\n')

let shuttingDown = false
async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  coordinator.dispose()
  await new Promise(resolveClose => server.close(resolveClose))
  await rm(runtimeDirectory, { recursive: true, force: true })
  process.exit(exitCode)
}
process.once('SIGINT', () => { void shutdown(0) })
process.once('SIGTERM', () => { void shutdown(0) })
