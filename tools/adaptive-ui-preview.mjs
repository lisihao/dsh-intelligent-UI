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
    themeContracts: 'src/theme-contracts.ts',
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
const { builtInThemes } = await import(pathToFileURL(join(runtimeDirectory, 'themeContracts.js')).href)
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
  ['synthetic-strategy-flow', { scenario: 'strategy-flow', kind: 'graph' }],
  ['synthetic-comparison-records', { scenario: 'comparison-records', kind: 'records' }],
  ['synthetic-cited-report-index', { scenario: 'cited-report-index', kind: 'markdown' }],
  ['synthetic-mixed-block-layout', { scenario: 'mixed-block-layout', kind: 'markdown', blockLayout: true }],
  ['synthetic-source-organization-grid', {
    scenario: 'source-organization-grid', kind: 'markdown', blockLayout: true,
    organizationPresentation: 'source-list-grid', organizationTheme: 'uiverse-clear-glass', organizationComponentSet: 'clear-glass',
  }],
  ['synthetic-source-organization-label-table', {
    scenario: 'source-organization-label-table', kind: 'markdown', blockLayout: true,
    organizationPresentation: 'source-label-table', organizationTheme: 'uiverse-mechanical-outline', organizationComponentSet: 'mechanical-outline',
  }],
])

const scenarioChoices = {
  'board-soft': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'auto', 'component-set': 'soft-relief', layout: 'board' },
  'table-mechanical': { theme: 'uiverse-mechanical-outline', surface: 'semantic', chart: 'auto', 'component-set': 'mechanical-outline', layout: 'table' },
  'history-visx': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'visx', 'component-set': 'soft-relief', layout: 'auto' },
  'history-openui': { theme: 'uiverse-mechanical-outline', surface: 'semantic', chart: 'openui', 'component-set': 'mechanical-outline', layout: 'auto' },
  'live-static': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'auto', 'component-set': 'soft-relief', layout: 'auto', live: 'native' },
  'scope-plain': { theme: 'plain', surface: 'semantic', chart: 'auto', 'component-set': 'native', layout: 'document' },
  'strategy-flow': { theme: 'uiverse-soft-relief', surface: 'semantic', chart: 'auto', 'component-set': 'soft-relief', layout: 'flow' },
  'comparison-records': { theme: 'uiverse-clear-glass', surface: 'semantic', chart: 'auto', 'component-set': 'clear-glass', layout: 'records' },
  'cited-report-index': { theme: 'uiverse-mechanical-outline', surface: 'semantic', chart: 'auto', 'component-set': 'mechanical-outline', layout: 'heading-index' },
}

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function asRecord(value, code) {
  if (!isRecord(value)) throw new Error(code)
  return value
}
function safeSchema(bundle, questions) {
  return {
    revision: bundle.revision,
    questionIds: questions.map(question => question.id).sort(),
    optionCounts: Object.fromEntries(questions.map(question => [question.id, question.options.length])),
    optionIds: Object.fromEntries(questions.map(question => [question.id, question.options.map(option => option.id)])),
  }
}
function questionShape(questions) {
  return JSON.stringify(questions.map(question => ({ id: question.id, kind: question.kind, options: question.options.map(option => option.id) })))
}
function isBlockReference(value) {
  return isRecord(value) && typeof value.id === 'string' && Array.isArray(value.path) && value.path.every(item => Number.isInteger(item) && item >= 0)
}
function blockBindings(bundle) {
  const blocks = isRecord(bundle?.blockLayout) && Array.isArray(bundle.blockLayout.blocks) ? bundle.blockLayout.blocks : []
  if (!blocks.length || !blocks.every(binding => isRecord(binding) && isBlockReference(binding.reference) && Array.isArray(binding.questionIds))) throw new Error('SYNTHETIC_BLOCK_CANDIDATE_BINDINGS_INVALID')
  return blocks
}
function blockReferences(bundle) {
  return blockBindings(bundle).map(binding => binding.reference)
}
function sourceRole(value, kind) {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  const text = encoded.toLowerCase()
  // The compiler's source kind outranks incidental words in a prose heading.
  if (kind === 'prose') return 'prose'
  if (kind === 'code' || /(?:```|code|snippet|代码|const\s+|function\s+)/.test(text)) return 'code'
  if (kind === 'ordered-list' || kind === 'flow') return 'flow'
  if (kind === 'prose' && !/(?:flow|arrow|sequence|relationship|流程|关系|箭头|arrow-chain|->|→)/.test(text)) return 'prose'
  if (/(?:task|board|status|任务|状态|validated-task)/.test(text)) return 'board'
  if (/(?:flow|arrow|sequence|relationship|流程|关系|箭头|arrow-chain|->|→)/.test(text)) return 'flow'
  if (/(?:chart|histor|numeric|line|visx|table|历史|数值|延迟|chart-plan)/.test(text)) return 'chart'
  if (/(?:prose|paragraph|document|text|ordinary|普通|说明|正文)/.test(text)) return 'prose'
  return undefined
}
function questionField(question) {
  const prompt = isRecord(question.prompt) ? question.prompt : undefined
  if (typeof prompt?.field === 'string') return prompt.field
  if (question.id.endsWith(':presentation')) return 'presentation'
  return ['theme', 'surface', 'chart', 'component-set', 'layout', 'object-effect', 'live', 'loading', 'text-motion'].includes(question.id) ? question.id : undefined
}
function blockBindingForQuestion(question, bundle) {
  const binding = blockBindings(bundle).find(item => item.questionIds.includes(question.id))
  return binding?.reference
}
function requiredOption(question, desired, context) {
  const selected = Array.isArray(question.options) ? question.options.find(option => option.id === desired || option.id === `${questionField(question)}:${desired}`)?.id : undefined
  if (!selected) throw new Error(`SYNTHETIC_REQUIRED_OPTION_MISSING_${context}_${desired}`)
  return selected
}
function presentationForRole(role) {
  if (role === 'chart') return 'chart-visx'
  if (role === 'board') return 'board'
  if (role === 'flow') return 'flow'
  if (role === 'code') return 'disclosure'
  if (role === 'prose') return 'cards'
  return 'reading'
}
function blockSourceValue(source, block) {
  return typeof source.value === 'string' && block.start !== undefined && block.end !== undefined ? source.value.slice(block.start, block.end) : block
}
function blockRole(source, block) {
  return sourceRole(blockSourceValue(source, block), block.kind)
}
function mixedAnswers(request, bundle) {
  const blocks = blockReferences(bundle)
  if (blocks.length < 3) throw new Error('SYNTHETIC_BLOCK_CANDIDATES_MISSING')
  const byRole = new Map()
  const state = asRecord(request.state, 'SYNTHETIC_REQUEST_STATE_INVALID')
  const source = asRecord(state.source, 'SYNTHETIC_REQUEST_SOURCE_INVALID')
  for (const block of [...blocks].sort((left, right) => JSON.stringify(left.path).localeCompare(JSON.stringify(right.path)))) {
    const role = blockRole(source, block)
    if (role && !byRole.has(role)) byRole.set(role, block)
  }
  for (const role of ['chart', 'board', 'flow']) if (!byRole.has(role)) throw new Error(`SYNTHETIC_BLOCK_ROLE_MISSING_${role}`)
  const answers = { ...bundle.defaultAnswers }
  const seenRoles = new Set()
  for (const question of request.questions) {
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error('SYNTHETIC_DECISIONS_REQUIRES_TWO_CHOICES')
    const field = questionField(question)
    const block = blockBindingForQuestion(question, bundle)
    const promptRole = sourceRole({ id: question.id, prompt: question.prompt, options: question.options })
    const role = block ? blockRole(source, block) ?? promptRole : promptRole
    const desired = block
      ? field === 'presentation' ? presentationForRole(role) : field === 'component-set' ? 'soft-relief' : undefined
      : field === 'theme' ? 'uiverse-soft-relief'
        : field === 'surface' ? 'semantic'
          : field === 'component-set' ? 'soft-relief'
            : field === 'layout' ? 'document'
              : field === 'inspection' ? 'none'
                : undefined
    if (desired === undefined) throw new Error(`SYNTHETIC_UNEXPECTED_DECISION_QUESTION_${question.id}`)
    answers[question.id] = requiredOption(question, desired, `${role ?? 'root'}_${field}`)
    if (role) seenRoles.add(role)
  }
  if (!request.questions.some(question => blockBindingForQuestion(question, bundle) && questionField(question) === 'presentation')) throw new Error('SYNTHETIC_BLOCK_QUESTIONS_MISSING')
  if (!['chart', 'board', 'flow'].every(role => seenRoles.has(role))) throw new Error('SYNTHETIC_BLOCK_QUESTION_ROLE_MISSING')
  return answers
}
function organizationFixture(fixture) {
  if (typeof fixture?.organizationPresentation !== 'string'
    || typeof fixture.organizationTheme !== 'string'
    || typeof fixture.organizationComponentSet !== 'string') return undefined
  return {
    presentation: fixture.organizationPresentation,
    theme: fixture.organizationTheme,
    componentSet: fixture.organizationComponentSet,
  }
}
function organizationAnswers(request, bundle, fixture) {
  const organization = organizationFixture(fixture)
  if (!organization) throw new Error('SYNTHETIC_ORGANIZATION_FIXTURE_INVALID')
  const answers = { ...bundle.defaultAnswers }
  let organizationPresentationQuestions = 0
  for (const question of request.questions) {
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error('SYNTHETIC_DECISIONS_REQUIRES_TWO_CHOICES')
    const field = questionField(question)
    const block = blockBindingForQuestion(question, bundle)
    let desired
    if (block) {
      if (field === 'presentation') {
        const hasOrganizationPresentation = question.options.some(option => option.id === organization.presentation)
        desired = hasOrganizationPresentation ? organization.presentation : 'reading'
        if (hasOrganizationPresentation) organizationPresentationQuestions++
      } else if (field === 'component-set') {
        desired = organization.componentSet
      }
    } else if (field === 'theme') {
      desired = organization.theme
    } else if (field === 'surface') {
      desired = 'semantic'
    } else if (field === 'layout') {
      desired = 'document'
    } else if (field === 'inspection') {
      desired = 'none'
    }
    if (desired === undefined) throw new Error(`SYNTHETIC_UNEXPECTED_ORGANIZATION_QUESTION_${question.id}`)
    answers[question.id] = requiredOption(question, desired, `organization_${field ?? 'unknown'}`)
  }
  if (organizationPresentationQuestions !== 1) throw new Error(`SYNTHETIC_ORGANIZATION_PRESENTATION_COUNT_${organizationPresentationQuestions}`)
  return answers
}
function validateOrganizationSelection(request, bundle, selection, fixture) {
  const organization = organizationFixture(fixture)
  if (!organization) throw new Error('SYNTHETIC_ORGANIZATION_FIXTURE_INVALID')
  const selectedBlocks = selection.blockLayout?.blocks ?? []
  const candidates = blockReferences(bundle)
  const candidateById = new Map(candidates.map(block => [block.id, block]))
  if (selection.blockLayout?.version !== 1 || selection.blockLayout.inspection !== 'none' || selectedBlocks.length !== candidates.length) throw new Error('SYNTHETIC_ORGANIZATION_SELECTION_INVALID')
  const organizationBlocks = []
  const selectedIds = new Set()
  for (const block of selectedBlocks) {
    const candidate = candidateById.get(block.id)
    if (!candidate || JSON.stringify(candidate.path) !== JSON.stringify(block.path) || candidate.start !== block.start || candidate.end !== block.end || candidate.kind !== block.kind) throw new Error(`SYNTHETIC_ORGANIZATION_REFERENCE_INVALID_${block.id}`)
    if (!Array.isArray(block.evidence) || block.evidence.length === 0) throw new Error(`SYNTHETIC_ORGANIZATION_EVIDENCE_MISSING_${block.id}`)
    if (selectedIds.has(block.id)) throw new Error(`SYNTHETIC_ORGANIZATION_SELECTION_DUPLICATE_${block.id}`)
    selectedIds.add(block.id)
    if (block.presentation === organization.presentation) organizationBlocks.push(block)
  }
  if (selection.themeId !== organization.theme) throw new Error(`SYNTHETIC_ORGANIZATION_THEME_INVALID_${selection.themeId ?? 'missing'}`)
  if (organizationBlocks.length !== 1) throw new Error(`SYNTHETIC_ORGANIZATION_SELECTED_PRESENTATION_COUNT_${organizationBlocks.length}`)
  const organizationBlock = organizationBlocks[0]
  if (organizationBlock.selection?.componentSet !== organization.componentSet) throw new Error(`SYNTHETIC_ORGANIZATION_COMPONENT_SET_INVALID_${organizationBlock.selection?.componentSet ?? 'missing'}`)
  if (organizationBlock.selection?.themeId !== organization.theme) throw new Error(`SYNTHETIC_ORGANIZATION_BLOCK_THEME_INVALID_${organizationBlock.selection?.themeId ?? 'missing'}`)
  if (!organizationBlock.evidence.includes('source:unordered-list')) throw new Error('SYNTHETIC_ORGANIZATION_SOURCE_EVIDENCE_MISSING')
  const presentationQuestions = request.questions.filter(question => {
    const block = blockBindingForQuestion(question, bundle)
    return block && questionField(question) === 'presentation' && question.options.some(option => option.id === organization.presentation)
  })
  if (presentationQuestions.length !== 1) throw new Error(`SYNTHETIC_ORGANIZATION_OPTION_COUNT_${presentationQuestions.length}`)
}
function plannerBundleFromRequest(request) {
  const state = asRecord(request.state, 'SYNTHETIC_REQUEST_STATE_INVALID')
  const source = asRecord(state.source, 'SYNTHETIC_REQUEST_SOURCE_INVALID')
  const composition = asRecord(state.composition, 'SYNTHETIC_REQUEST_COMPOSITION_INVALID')
  const fixture = fixtureDocuments.get(source.documentId)
  const experimentalProjection = fixture?.blockLayout === true
  if (experimentalProjection && composition.inputFormat !== 'block-design-context@2') throw new Error('SYNTHETIC_BLOCK_CONTEXT_FORMAT_INVALID')
  if (experimentalProjection && composition.styleMode !== blockLayoutServerSettings.adaptive.styleMode) throw new Error('SYNTHETIC_BLOCK_CONTEXT_STYLE_MODE_INVALID')
  const rebuilt = buildCompositionCandidates({
    value: source.value,
    // The experimental projection intentionally excludes the current theme
    // catalog. This local oracle uses the exact fixed server catalog only to
    // rebuild and compare the real request questions; it never returns it to
    // the synthetic decision endpoint.
    themes: experimentalProjection ? builtInThemes : composition.themes,
    selectedThemeId: experimentalProjection ? blockLayoutServerSettings.theme.activeId : composition.selectedThemeId,
    styleMode: experimentalProjection ? blockLayoutServerSettings.adaptive.styleMode : composition.styleMode,
    capabilities: composition.capabilities,
    isStreaming: composition.isStreaming,
    ...(fixture?.blockLayout === true ? { blockLayout: true } : {}),
  })
  if (questionShape(rebuilt.questions.filter(question => question.options.length > 1)) !== questionShape(request.questions)) throw new Error('SYNTHETIC_CANDIDATE_SCHEMA_MISMATCH')
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
    if (fixture.kind === 'graph') {
      const graph = asRecord(record.value, 'SYNTHETIC_GRAPH_SOURCE_REQUIRED')
      if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('SYNTHETIC_GRAPH_SOURCE_INVALID')
    }
    if (fixture.kind === 'records' && !Array.isArray(record.value)) throw new Error('SYNTHETIC_RECORDS_SOURCE_REQUIRED')
  }
  return fixture
}

const legacyServerSettings = {
  takeover: true,
  adaptive: { enabled: true, styleMode: 'automatic' },
  theme: { activeId: 'empryo', installed: [] },
}
const blockLayoutServerSettings = {
  ...legacyServerSettings,
  adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true },
}

const operationEvidence = new Map()
const decisionCallsByDocument = new Map()
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
    if (fixture.blockLayout === true && (decisionCallsByDocument.get(documentId) ?? 0) > 0) throw new Error('SYNTHETIC_BLOCK_DECISION_CALL_DUPLICATE')
    const preferred = scenarioChoices[fixture.scenario]
    const answers = fixture.blockLayout === true
      ? organizationFixture(fixture) ? organizationAnswers(request, bundle, fixture) : mixedAnswers(request, bundle)
      : { ...bundle.defaultAnswers }
    for (const question of request.questions) {
      if (question.options.length < 2) throw new Error('SYNTHETIC_DECISIONS_REQUIRES_TWO_CHOICES')
      const desired = fixture.blockLayout === true ? answers[question.id] : preferred[question.id]
      const option = desired === undefined ? question.options[0]?.id : question.options.find(candidate => candidate.id === desired)?.id
      if (!option) throw new Error(`SYNTHETIC_OPTION_NOT_ALLOWED_${question.id}`)
      answers[question.id] = option
    }
    const selection = validateCompositionChoices(bundle, answers)
    if (fixture.blockLayout === true && organizationFixture(fixture)) {
      validateOrganizationSelection(request, bundle, selection, fixture)
      decisionCallsByDocument.set(documentId, (decisionCallsByDocument.get(documentId) ?? 0) + 1)
    } else if (fixture.blockLayout === true) {
      const selectedBlocks = selection.blockLayout?.blocks ?? []
      const candidates = blockReferences(bundle)
      const candidateById = new Map(candidates.map(block => [block.id, block]))
      if (request.questions.some(question => question.options.some(option => option.id === 'auto' || option.id.endsWith(':auto')))) throw new Error('SYNTHETIC_BLOCK_LAYOUT_AUTO_OPTION_FORBIDDEN')
      if (selection.blockLayout?.version !== 1 || selection.blockLayout.inspection !== 'none' || selectedBlocks.length !== candidates.length) throw new Error('SYNTHETIC_BLOCK_LAYOUT_SELECTION_INVALID')
      const selectedIds = new Set()
      for (const block of selectedBlocks) {
        const candidate = candidateById.get(block.id)
        if (!candidate || JSON.stringify(candidate.path) !== JSON.stringify(block.path) || candidate.start !== block.start || candidate.end !== block.end || candidate.kind !== block.kind) throw new Error(`SYNTHETIC_BLOCK_REFERENCE_INVALID_${block.id}`)
        if (!Array.isArray(block.evidence) || block.evidence.length === 0) throw new Error(`SYNTHETIC_BLOCK_EVIDENCE_MISSING_${block.id}`)
        if (selectedIds.has(block.id)) throw new Error(`SYNTHETIC_BLOCK_SELECTION_DUPLICATE_${block.id}`)
        selectedIds.add(block.id)
        const role = blockRole(source, candidate)
        if (!role) throw new Error(`SYNTHETIC_BLOCK_ROLE_UNKNOWN_${block.id}`)
        const expectedPresentation = presentationForRole(role)
        if (block.presentation !== expectedPresentation) throw new Error(`SYNTHETIC_BLOCK_PRESENTATION_INVALID_${block.id}_${role}_${block.presentation ?? 'missing'}`)
        const presentationQuestion = request.questions.find(question => question.id === `${candidate.id}:presentation`)
        if (!presentationQuestion || !presentationQuestion.options.some(option => option.id === expectedPresentation)) throw new Error(`SYNTHETIC_BLOCK_PRESENTATION_OPTION_MISSING_${block.id}_${expectedPresentation}`)
        if (role === 'chart' && (block.selection.chart !== 'visx' || block.selection.layout !== 'table')) throw new Error(`SYNTHETIC_BLOCK_CHART_SELECTION_INVALID_${block.id}`)
        if (role === 'board' && block.selection.layout !== 'board') throw new Error(`SYNTHETIC_BLOCK_BOARD_SELECTION_INVALID_${block.id}`)
        if (role === 'flow' && block.selection.layout !== 'flow') throw new Error(`SYNTHETIC_BLOCK_FLOW_SELECTION_INVALID_${block.id}`)
      }
      if (!selectedBlocks.some(block => block.selection.chart === 'visx')) throw new Error('SYNTHETIC_BLOCK_CHART_NOT_SELECTED')
      if (!selectedBlocks.some(block => block.selection.layout === 'board')) throw new Error('SYNTHETIC_BLOCK_BOARD_NOT_SELECTED')
      if (!selectedBlocks.some(block => block.selection.layout === 'flow')) throw new Error('SYNTHETIC_BLOCK_FLOW_NOT_SELECTED')
      decisionCallsByDocument.set(documentId, (decisionCallsByDocument.get(documentId) ?? 0) + 1)
    }
    const response = { answers: request.questions.map(question => ({ id: question.id, kind: 'choice', optionId: answers[question.id] })) }
    const interpreted = await options.interpret?.(response, options.signal ?? new AbortController().signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId, reason: interpreted.reason }
    const adoption = await options.canAdopt?.(response, options.signal ?? new AbortController().signal)
    if (adoption !== undefined && adoption !== true) return { kind: 'not-adopted', operationId, reason: adoption }
    operationEvidence.set(operationId, { documentId, scenario: fixture.scenario, schema: safeSchema(bundle, request.questions), selection, observed: false, decisionCalls: fixture.blockLayout === true ? 1 : undefined })
    return { kind: 'ok', operationId, attemptId: `synthetic-attempt-${operationCount}`, response }
  }
  async writeReceipt(operationId) {
    const evidence = operationEvidence.get(operationId)
    if (!evidence) throw new Error('SYNTHETIC_RECEIPT_OPERATION_UNKNOWN')
    evidence.observed = true
    process.stdout.write(`ADAPTIVE_UI_EVENT=${JSON.stringify({ type: 'receipt', documentId: evidence.documentId, operationId, schema: evidence.schema, selection: evidence.selection, decisionCalls: evidence.decisionCalls, observed: true, externalModelCalls: 0 })}\n`)
    return { synthetic: true, externalModelCalls: 0 }
  }
}

const syntheticJev = new SyntheticJevPort()
const legacyCoordinator = new AdaptiveCompositionCoordinator({
  getSettings: async () => legacyServerSettings,
  getJev: () => syntheticJev,
  now: () => new Date('2026-11-05T00:00:00.000Z'),
})
const blockLayoutCoordinator = new AdaptiveCompositionCoordinator({
  getSettings: async () => blockLayoutServerSettings,
  getJev: () => syntheticJev,
  now: () => new Date('2026-11-05T00:00:00.000Z'),
})
function coordinatorFor(fixture) { return fixture.blockLayout === true ? blockLayoutCoordinator : legacyCoordinator }

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
    const fixture = fixtureForInput(input, endpoint)
    const coordinator = coordinatorFor(fixture)
    if (endpoint === 'composition') {
      const result = await coordinator.compose(input)
      const evidence = result.operationId ? operationEvidence.get(result.operationId) : undefined
      json(res, 200, result, evidence ? {
        'x-adaptive-schema-revision': String(evidence.schema.revision),
        'x-adaptive-schema-questions': evidence.schema.questionIds.join(','),
        'x-adaptive-schema-options': JSON.stringify(evidence.schema.optionIds),
      } : undefined)
      return
    }
    if (endpoint === 'compositionCancel') return json(res, 200, coordinator.cancel(input))
    const receipt = await coordinator.receipt(input)
    const evidence = operationEvidence.get(receipt.operationId)
    return json(res, 200, receipt, evidence?.decisionCalls === undefined ? undefined : { 'x-adaptive-decision-calls': String(evidence.decisionCalls) })
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
  legacyCoordinator.dispose()
  blockLayoutCoordinator.dispose()
  await new Promise(resolveClose => server.close(resolveClose))
  await rm(runtimeDirectory, { recursive: true, force: true })
  process.exit(exitCode)
}
process.once('SIGINT', () => { void shutdown(0) })
process.once('SIGTERM', () => { void shutdown(0) })
