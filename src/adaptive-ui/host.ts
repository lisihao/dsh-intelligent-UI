import { createHash } from 'node:crypto'
import { builtInThemes, type ThemePackage } from '../theme-contracts.js'
import { buildCompositionCandidates, validateCompositionChoices } from './planner.js'
import {
  ADAPTIVE_COMPOSITION_FEATURE_ID,
  ADAPTIVE_COMPOSITION_FORMAT_VERSION,
  ADAPTIVE_COMPOSITION_INPUT_VERSION,
  type AdaptiveCompositionCoordinatorOptions,
  type AdaptiveCompositionSettings,
  type ComposeInput,
  type CompositionCancelInput,
  type CompositionCancelResult,
  type CompositionReceiptInput,
  type CompositionReceiptResult,
  type CompositionResult,
  type CompositionSelection,
  type CompositionStatus,
  type JevChoiceAnswer,
  type JevCompositionPort,
  type JevJudgeOnceResult,
  type JevJson,
  type JevQuestion,
  type JevResponse,
  composeInputSchema,
  compositionCancelInputSchema,
  compositionCancelResultSchema,
  compositionReceiptInputSchema,
  compositionReceiptResultSchema,
  compositionResultSchema,
  compositionSelectionSchema,
  compositionStatusSchema,
} from './contracts.js'

const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024
const DEFAULT_MAX_CACHE_ENTRIES = 32

type CandidateBundle = ReturnType<typeof buildCompositionCandidates>
type CandidateQuestion = CandidateBundle['questions'][number]

type Snapshot = {
  settings: AdaptiveCompositionSettings
  themes: readonly ThemePackage[]
  selectedThemeId: string
  styleMode: 'selected' | 'automatic'
  enabled: boolean
  fingerprint: string
}

type DocumentState = {
  generation: number
  sourceVersion: string
  operation?: SharedOperation
}

type Waiter = {
  id: number
  requestId?: string
  cancelled: boolean
  cancelledResult: Promise<Omit<CompositionResult, 'requestId'>>
  resolveCancelled: (result: Omit<CompositionResult, 'requestId'>) => void
}

type SharedOperation = {
  key: string
  state: DocumentState
  generation: number
  sourceVersion: string
  controller: AbortController
  input: ComposeInput
  waiters: Map<number, Waiter>
  promise?: Promise<Omit<CompositionResult, 'requestId'>>
  fingerprint?: string
  aborted: boolean
  settled: boolean
  abortReason?: string
}

type ActiveRequest = SharedOperation & {
  fingerprint: string
  snapshot: Snapshot
  bundle: CandidateBundle
  localSelection: CompositionSelection
  port: JevCompositionPort
  connection: ReturnType<JevCompositionPort['judgmentConnectionIdentity']>
}

type OperationRecord = {
  sessionId: string
  documentId: string
  sourceVersion: string
  operationId: string
  port: JevCompositionPort
  receiptState: 'ready' | 'writing' | 'observed' | 'failed'
  receiptAt?: string
  receiptPromise?: Promise<CompositionReceiptResult>
}

class NamedError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'NamedError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Canonical JSON for source/version hashes and exact ledger reconstruction. */
function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NamedError('COMPOSITION_JSON_INVALID')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    return `{${entries.join(',')}}`
  }
  throw new NamedError('COMPOSITION_JSON_INVALID')
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function cloneJson<T>(value: unknown): T {
  return JSON.parse(stableJson(value)) as T
}

function reasonFrom(error: unknown, fallback: string): string {
  if (error instanceof NamedError) return error.code
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,99}$/.test(error.message)) return error.message
  return fallback
}

function safeServiceCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(value) ? value : fallback
}

function documentKey(sessionId: string, documentId: string): string {
  return `${sessionId}\u0000${documentId}`
}

function resultForRequest(result: Omit<CompositionResult, 'requestId'>, requestId?: string): CompositionResult {
  return compositionResultSchema.parse({ ...result, ...(requestId === undefined ? {} : { requestId }) })
}

function isChoiceQuestion(question: CandidateQuestion): question is CandidateQuestion & { kind: 'choice' } {
  return question.kind === 'choice'
}

/**
 * Coordinates only source-bound, finite choice questions. It owns no Cordis
 * context, Session records, Jev configuration, credential, or persistent file.
 */
export class AdaptiveCompositionCoordinator {
  private readonly maxSourceBytes: number
  private readonly maxCacheEntries: number
  private readonly documents = new Map<string, DocumentState>()
  private readonly inFlight = new Map<string, SharedOperation>()
  private readonly cache = new Map<string, Omit<CompositionResult, 'requestId'>>()
  private readonly operations = new Map<string, OperationRecord>()
  private nextWaiterId = 0
  private port?: JevCompositionPort
  private registration?: () => void
  private featureListener?: () => void
  private attachError?: string
  private disposed = false

  constructor(private readonly options: AdaptiveCompositionCoordinatorOptions) {
    this.maxSourceBytes = normalizeLimit(options.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES)
    this.maxCacheEntries = normalizeLimit(options.maxCacheEntries, DEFAULT_MAX_CACHE_ENTRIES)
  }

  /**
   * Binds the optional public Jev service for this Host lifetime. The returned
   * disposer is safe for `ctx.effect`; it only detaches this exact service.
   */
  attachJev(port: JevCompositionPort): () => void {
    if (this.disposed) return () => undefined
    if (this.port === port) return () => { if (this.port === port) this.detachJev('JEV_SERVICE_DETACHED') }

    // The first optional attachment must not invalidate the compose request
    // that discovered it. A replacement, unlike an initial attachment, does
    // invalidate active requests because their service identity changed.
    if (this.port !== undefined || this.registration !== undefined) this.detachJev('JEV_SERVICE_CHANGED')
    let unregister: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    try {
      unregister = port.registerFeature({
        id: ADAPTIVE_COMPOSITION_FEATURE_ID,
        name: '智能 UI 编排',
        description: '根据对话内容，从现有风格、组件与合法布局中选择呈现方案。',
        settingsDescription: '使用当前判断连接，可能产生 API 费用；只改变呈现，不执行内容中的任务。',
      })
      if (port.onFeatureStateChange) {
        unsubscribe = port.onFeatureStateChange(features => {
          if (features[ADAPTIVE_COMPOSITION_FEATURE_ID] !== true) this.abortAll('JEV_FEATURE_DISABLED')
        })
      }
      this.port = port
      this.registration = unregister
      this.featureListener = unsubscribe
      this.attachError = undefined
    } catch (error) {
      try { unsubscribe?.() } catch { /* A failed optional subscription has no active model operation. */ }
      try { unregister?.() } catch { /* Do not retain a partially registered consumer. */ }
      this.port = undefined
      this.registration = undefined
      this.featureListener = undefined
      this.attachError = reasonFrom(error, 'JEV_FEATURE_REGISTRATION_FAILED')
    }

    return () => { if (this.port === port) this.detachJev('JEV_SERVICE_DETACHED') }
  }

  async status(): Promise<CompositionStatus> {
    let settings: AdaptiveCompositionSettings | undefined
    let reason = this.disposed ? 'COMPOSITION_COORDINATOR_DISPOSED' : this.attachError
    try { settings = await this.options.getSettings() }
    catch { reason ??= 'COMPOSITION_SETTINGS_UNAVAILABLE' }
    const port = this.resolvePort()
    let featureEnabled = false
    if (port) {
      try { featureEnabled = port.isFeatureEnabled(ADAPTIVE_COMPOSITION_FEATURE_ID) }
      catch { reason ??= 'JEV_FEATURE_STATE_UNAVAILABLE' }
    }
    return compositionStatusSchema.parse({
      disposed: this.disposed,
      attached: this.port !== undefined,
      featureRegistered: this.registration !== undefined,
      featureEnabled,
      takeover: settings?.takeover === true,
      adaptiveEnabled: settings?.adaptive?.enabled === true,
      activeDocuments: [...this.documents.values()].filter(state => state.operation !== undefined && !state.operation.controller.signal.aborted).length,
      cachedResults: this.cache.size,
      ...(reason === undefined ? {} : { reason }),
    })
  }

  async compose(raw: ComposeInput): Promise<CompositionResult> {
    const input = composeInputSchema.parse(raw)
    const sourceVersion = this.sourceVersion(input)
    const key = documentKey(input.sessionId, input.documentId)
    const { operation, created } = this.beginDocument(key, sourceVersion, input)
    const waiter = this.addWaiter(operation, input.requestId)
    if (created) {
      operation.promise = this.execute(operation).catch(error => this.base('failed', reasonFrom(error, 'COMPOSITION_EXECUTION_FAILED'), operation.sourceVersion)).finally(() => this.finishOperation(operation))
    }
    try {
      const result = await Promise.race([operation.promise!, waiter.cancelledResult])
      return resultForRequest(result, input.requestId)
    } finally {
      this.removeWaiter(operation, waiter)
    }
  }

  private async execute(operation: SharedOperation): Promise<Omit<CompositionResult, 'requestId'>> {
    const { input, sourceVersion } = operation
    if (this.disposed) return this.base('stale', 'COMPOSITION_COORDINATOR_DISPOSED', sourceVersion)

    let sourceJson: string
    try { sourceJson = stableJson(input.value) }
    catch (error) { return this.base('failed', reasonFrom(error, 'COMPOSITION_JSON_INVALID'), sourceVersion) }
    if (new TextEncoder().encode(sourceJson).byteLength > this.maxSourceBytes) return this.base('local', 'COMPOSITION_SOURCE_TOO_LARGE', sourceVersion)

    let snapshot: Snapshot
    try { snapshot = await this.snapshot() }
    catch (error) { return this.base('failed', reasonFrom(error, 'COMPOSITION_SETTINGS_UNAVAILABLE'), sourceVersion) }
    if (!this.isCurrent(operation)) return this.base('stale', this.currentAbortReason(operation), sourceVersion)

    let bundle: CandidateBundle
    let localSelection: CompositionSelection
    try {
      bundle = buildCompositionCandidates({ value: input.value, themes: snapshot.themes, selectedThemeId: snapshot.selectedThemeId, styleMode: snapshot.styleMode, capabilities: input.capabilities, isStreaming: input.isStreaming })
      localSelection = this.defaultSelection(bundle)
    } catch (error) {
      return this.base('failed', reasonFrom(error, 'COMPOSITION_CANDIDATES_INVALID'), sourceVersion)
    }

    if (!snapshot.enabled) return this.base('local', 'ADAPTIVE_COMPOSITION_DISABLED', sourceVersion, localSelection)
    if (input.isStreaming === true) return this.base('local', 'COMPOSITION_STREAMING_SOURCE', sourceVersion, localSelection)

    const port = this.resolvePort()
    if (!port) return this.base('local', this.attachError ?? 'JEV_UNAVAILABLE', sourceVersion, localSelection)
    if (!this.featureEnabled(port)) return this.base('local', 'JEV_FEATURE_DISABLED', sourceVersion, localSelection)

    let connection: ReturnType<JevCompositionPort['judgmentConnectionIdentity']>
    try { connection = port.judgmentConnectionIdentity() }
    catch { return this.base('local', 'JEV_CONNECTION_UNAVAILABLE', sourceVersion, localSelection) }

    const fingerprint = `sha256:${digest({
      formatVersion: ADAPTIVE_COMPOSITION_FORMAT_VERSION,
      sourceVersion,
      snapshot: snapshot.fingerprint,
      capabilities: input.capabilities,
      isStreaming: false,
      connection,
    })}`
    operation.fingerprint = fingerprint
    const cached = this.cache.get(fingerprint)
    if (cached) return cached
    if (!this.isCurrent(operation)) return this.base('stale', this.currentAbortReason(operation), sourceVersion)

    this.inFlight.set(fingerprint, operation)
    const active: ActiveRequest = Object.assign(operation, { fingerprint, snapshot, bundle, localSelection, port, connection })
    const result = await this.runDecision(active)
    if (result.status !== 'stale') this.putCache(fingerprint, result)
    return result
  }

  /** Cancels only the current matching browser request; a stale cleanup is a no-op. */
  cancel(raw: CompositionCancelInput): CompositionCancelResult {
    const input = compositionCancelInputSchema.parse(raw)
    const key = documentKey(input.sessionId, input.documentId)
    const state = this.documents.get(key)
    if (!state) return compositionCancelResultSchema.parse({ cancelled: false, reason: 'COMPOSITION_NOT_ACTIVE' })
    const operation = state.operation
    if (!operation || operation.controller.signal.aborted || operation.settled) {
      return compositionCancelResultSchema.parse({ cancelled: false, reason: 'COMPOSITION_NOT_ACTIVE', sourceVersion: state.sourceVersion })
    }
    if (input.requestId !== undefined) {
      const waiters = [...operation.waiters.values()].filter(waiter => waiter.requestId === input.requestId)
      if (!waiters.length) return compositionCancelResultSchema.parse({ cancelled: false, reason: 'COMPOSITION_CANCEL_IDENTITY_MISMATCH', sourceVersion: state.sourceVersion })
      for (const waiter of waiters) this.cancelWaiter(operation, waiter, 'COMPOSITION_CANCELLED')
    } else {
      if (input.sourceVersion !== state.sourceVersion) return compositionCancelResultSchema.parse({ cancelled: false, reason: 'COMPOSITION_CANCEL_IDENTITY_MISMATCH', sourceVersion: state.sourceVersion })
      for (const waiter of [...operation.waiters.values()]) this.cancelWaiter(operation, waiter, 'COMPOSITION_CANCELLED')
    }
    if (operation.aborted) this.dropInactiveDocument(operation.state, operation.key)
    return compositionCancelResultSchema.parse({ cancelled: true, reason: 'COMPOSITION_CANCELLED', sourceVersion: state.sourceVersion, ...(input.requestId === undefined ? {} : { requestId: input.requestId }) })
  }

  /** Writes an observed receipt only for the exact server-issued selected result. */
  async writeReceipt(raw: CompositionReceiptInput): Promise<CompositionReceiptResult> {
    const input = compositionReceiptInputSchema.parse(raw)
    const record = this.operations.get(input.operationId)
    if (!record) throw new NamedError('COMPOSITION_RECEIPT_UNKNOWN_OPERATION')
    if (record.sessionId !== input.sessionId || record.documentId !== input.documentId || record.sourceVersion !== input.sourceVersion) {
      throw new NamedError('COMPOSITION_RECEIPT_BINDING_MISMATCH')
    }
    if (record.receiptState === 'observed') {
      return compositionReceiptResultSchema.parse({ status: 'observed', operationId: record.operationId, sourceVersion: record.sourceVersion })
    }
    if (record.receiptState === 'failed') throw new NamedError('COMPOSITION_RECEIPT_UNCONFIRMED')
    if (record.receiptPromise) return await record.receiptPromise

    record.receiptState = 'writing'
    record.receiptAt ??= (this.options.now?.() ?? new Date()).toISOString()
    const receipt = compositionReceiptResultSchema.parse({ status: 'observed', operationId: record.operationId, sourceVersion: record.sourceVersion })
    const write = record.port.writeReceipt(record.operationId, {
      id: `adaptive-ui-observed-${digest({ operationId: record.operationId, sourceVersion: record.sourceVersion })}`,
      status: 'observed',
      reason: 'Renderer acknowledged the source-bound composition.',
      at: record.receiptAt,
    }).then(() => {
      record.receiptState = 'observed'
      return receipt
    }).catch(error => {
      record.receiptState = 'failed'
      throw new NamedError(reasonFrom(error, 'COMPOSITION_RECEIPT_NOT_SAVED'))
    }).finally(() => { record.receiptPromise = undefined })
    record.receiptPromise = write
    return await write
  }

  /** Alias for a thin RPC layer that names the operation `compositionReceipt`. */
  async receipt(input: CompositionReceiptInput): Promise<CompositionReceiptResult> {
    return await this.writeReceipt(input)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abortAll('COMPOSITION_COORDINATOR_DISPOSED')
    this.detachJev('COMPOSITION_COORDINATOR_DISPOSED')
    this.cache.clear()
    this.operations.clear()
  }

  private sourceVersion(input: ComposeInput): string {
    return `sha256:${digest({
      formatVersion: ADAPTIVE_COMPOSITION_FORMAT_VERSION,
      sessionId: input.sessionId,
      documentId: input.documentId,
      value: input.value,
      capabilities: input.capabilities,
      isStreaming: input.isStreaming === true,
    })}`
  }

  private beginDocument(key: string, sourceVersion: string, input: ComposeInput): { operation: SharedOperation, created: boolean } {
    let state = this.documents.get(key)
    if (!state) {
      state = { generation: 1, sourceVersion }
      this.documents.set(key, state)
    } else if (state.sourceVersion !== sourceVersion) {
      if (state.operation) this.abortOperation(state.operation, 'COMPOSITION_SOURCE_CHANGED')
      state.generation += 1
      state.sourceVersion = sourceVersion
      state.operation = undefined
    }
    const existing = state.operation
    if (existing && !existing.aborted && !existing.settled && !existing.controller.signal.aborted) return { operation: existing, created: false }
    const operation: SharedOperation = {
      key, state, generation: state.generation, sourceVersion, input, controller: new AbortController(),
      waiters: new Map(), aborted: false, settled: false,
    }
    state.operation = operation
    return { operation, created: true }
  }

  private addWaiter(operation: SharedOperation, requestId?: string): Waiter {
    let resolveCancelled!: (result: Omit<CompositionResult, 'requestId'>) => void
    const waiter: Waiter = {
      id: ++this.nextWaiterId,
      requestId,
      cancelled: false,
      cancelledResult: new Promise(resolve => { resolveCancelled = resolve }),
      resolveCancelled,
    }
    operation.waiters.set(waiter.id, waiter)
    return waiter
  }

  private removeWaiter(operation: SharedOperation, waiter: Waiter): void {
    if (!operation.waiters.delete(waiter.id) || operation.settled || operation.aborted) return
    if (!operation.waiters.size) this.abortOperation(operation, 'COMPOSITION_CANCELLED')
  }

  private cancelWaiter(operation: SharedOperation, waiter: Waiter, reason: string): void {
    if (waiter.cancelled) return
    waiter.cancelled = true
    operation.waiters.delete(waiter.id)
    waiter.resolveCancelled(this.base('stale', reason, operation.sourceVersion))
    if (!operation.waiters.size) this.abortOperation(operation, reason)
  }

  private finishOperation(operation: SharedOperation): void {
    operation.settled = true
    if (operation.fingerprint && this.inFlight.get(operation.fingerprint) === operation) this.inFlight.delete(operation.fingerprint)
    if (operation.state.operation === operation) {
      operation.state.operation = undefined
      this.documents.delete(operation.key)
    }
  }

  private dropInactiveDocument(state: DocumentState, key: string): void {
    if (state.operation === undefined && this.documents.get(key) === state) this.documents.delete(key)
  }

  private async snapshot(): Promise<Snapshot> {
    const settings = await this.options.getSettings()
    const themes = this.normalizeThemes(this.options.getThemes === undefined
      ? [...builtInThemes, ...(settings.theme?.installed ?? [])]
      : await this.options.getThemes(settings))
    const selectedThemeId = settings.theme?.activeId ?? 'empryo'
    if (!themes.some(theme => theme.id === selectedThemeId)) throw new NamedError('COMPOSITION_SELECTED_THEME_MISSING')
    const styleMode = settings.adaptive?.styleMode ?? 'selected'
    if (styleMode !== 'selected' && styleMode !== 'automatic') throw new NamedError('COMPOSITION_STYLE_MODE_INVALID')
    const enabled = settings.takeover === true && settings.adaptive?.enabled === true
    return {
      settings,
      themes,
      selectedThemeId,
      styleMode,
      enabled,
      fingerprint: `sha256:${digest({
        takeover: settings.takeover === true,
        adaptive: { enabled: settings.adaptive?.enabled === true, styleMode },
        selectedThemeId,
        themes,
      })}`,
    }
  }

  private normalizeThemes(themes: readonly ThemePackage[]): readonly ThemePackage[] {
    const ids = new Set<string>()
    for (const theme of themes) {
      if (!theme || typeof theme.id !== 'string' || !theme.id) throw new NamedError('COMPOSITION_THEME_CATALOG_INVALID')
      if (ids.has(theme.id)) throw new NamedError('COMPOSITION_THEME_CATALOG_DUPLICATE')
      ids.add(theme.id)
    }
    return [...themes].sort((left, right) => left.id.localeCompare(right.id))
  }

  private defaultSelection(bundle: CandidateBundle): CompositionSelection {
    const answers = (bundle as CandidateBundle & { defaultAnswers?: Readonly<Record<string, string>> }).defaultAnswers
    if (!answers) throw new NamedError('COMPOSITION_DEFAULT_CHOICES_MISSING')
    return compositionSelectionSchema.parse(validateCompositionChoices(bundle, answers))
  }

  private async runDecision(active: ActiveRequest): Promise<Omit<CompositionResult, 'requestId'>> {
    const request = this.jevRequest(active)
    const exactRequest = stableJson(request)
    let selected: CompositionSelection | undefined
    let selectionReason: string | undefined
    let outcome: JevJudgeOnceResult
    try {
      outcome = await active.port.judgeOnce({
        featureId: ADAPTIVE_COMPOSITION_FEATURE_ID,
        link: { sessionId: active.input.sessionId, inputVersion: `${ADAPTIVE_COMPOSITION_INPUT_VERSION}:${active.fingerprint}` },
        connection: active.connection,
        signal: active.controller.signal,
        refresh: signal => {
          this.assertFresh(active, signal)
          return request
        },
        preflight: candidate => {
          if (stableJson(candidate) !== exactRequest) throw new NamedError('COMPOSITION_REQUEST_MUTATED')
          this.assertFresh(active, active.controller.signal)
        },
        interpret: (response, signal) => {
          try {
            this.assertFresh(active, signal)
            selected = compositionSelectionSchema.parse(validateCompositionChoices(active.bundle, this.choiceAnswers(active.bundle, response)))
            return { usable: true }
          } catch (error) {
            selectionReason = reasonFrom(error, 'COMPOSITION_SELECTION_INVALID')
            return { usable: false, reason: selectionReason }
          }
        },
        canAdopt: async (_response, signal) => await this.canAdopt(active, signal),
      })
    } catch (error) {
      const current = await this.currentReason(active)
      if (current) return this.base('stale', current, active.sourceVersion, active.localSelection)
      return this.base('failed', reasonFrom(error, 'JEV_JUDGE_FAILED'), active.sourceVersion, active.localSelection)
    }

    const current = await this.currentReason(active)
    if (current) return this.base('stale', current, active.sourceVersion, active.localSelection, operationId(outcome))
    if (outcome.kind === 'ok') {
      if (!selected) return this.base('local', selectionReason ?? 'COMPOSITION_SELECTION_INVALID', active.sourceVersion, active.localSelection, outcome.operationId)
      const result = this.base('selected', 'JEV_SELECTION_ADOPTED', active.sourceVersion, selected, outcome.operationId)
      this.recordOperation(active, outcome.operationId)
      return result
    }
    if (outcome.kind === 'failed') {
      return this.base('failed', `JEV_${safeServiceCode(outcome.failure.code, 'FAILURE')}`, active.sourceVersion, active.localSelection, outcome.operationId)
    }
    if (outcome.kind === 'cancelled') {
      return this.base('local', 'JEV_CANCELLED', active.sourceVersion, active.localSelection, outcome.operationId)
    }
    return this.base('local', safeServiceCode(outcome.reason, 'JEV_NOT_ADOPTED'), active.sourceVersion, active.localSelection, outcome.operationId)
  }

  private jevRequest(active: ActiveRequest): { state: JevJson, questions: readonly JevQuestion[] } {
    const questions = cloneJson<readonly JevQuestion[]>(active.bundle.questions)
    const state = cloneJson<JevJson>({
      formatVersion: ADAPTIVE_COMPOSITION_FORMAT_VERSION,
      kind: 'adaptive-ui-composition',
      source: {
        sessionId: active.input.sessionId,
        documentId: active.input.documentId,
        sourceVersion: active.sourceVersion,
        inputVersion: `${ADAPTIVE_COMPOSITION_INPUT_VERSION}:${active.fingerprint}`,
        value: active.input.value,
      },
      composition: {
        selectedThemeId: active.snapshot.selectedThemeId,
        styleMode: active.snapshot.styleMode,
        capabilities: active.input.capabilities,
        isStreaming: active.input.isStreaming === true,
        themes: active.snapshot.themes,
        candidateBundle: active.bundle,
      },
    })
    return { state, questions }
  }

  private choiceAnswers(bundle: CandidateBundle, response: JevResponse): Readonly<Record<string, string>> {
    if (!response || !Array.isArray(response.answers)) throw new NamedError('COMPOSITION_RESPONSE_INVALID')
    const questions = bundle.questions
    if (!questions.every(isChoiceQuestion)) throw new NamedError('COMPOSITION_QUESTION_INVALID')
    if (response.answers.length !== questions.length) throw new NamedError('COMPOSITION_ANSWER_COUNT_INVALID')
    const expected = new Set(questions.map(question => question.id))
    const answers: Record<string, string> = Object.create(null) as Record<string, string>
    for (const answer of response.answers) {
      if (!isChoiceAnswer(answer) || !expected.has(answer.id) || Object.hasOwn(answers, answer.id)) {
        throw new NamedError('COMPOSITION_ANSWER_INVALID')
      }
      answers[answer.id] = answer.optionId
    }
    if (Object.keys(answers).length !== expected.size) throw new NamedError('COMPOSITION_ANSWER_INCOMPLETE')
    return answers
  }

  private async canAdopt(active: ActiveRequest, signal: AbortSignal): Promise<true | string> {
    if (signal.aborted) return this.currentAbortReason(active)
    const sync = this.currentReasonSync(active)
    if (sync) return sync
    let snapshot: Snapshot
    try { snapshot = await this.snapshot() }
    catch { return 'COMPOSITION_SETTINGS_UNAVAILABLE' }
    if (signal.aborted) return this.currentAbortReason(active)
    if (snapshot.fingerprint !== active.snapshot.fingerprint) return 'COMPOSITION_SETTINGS_CHANGED'
    return this.currentReasonSync(active) ?? true
  }

  private async currentReason(active: ActiveRequest): Promise<string | undefined> {
    const sync = this.currentReasonSync(active)
    if (sync) return sync
    let snapshot: Snapshot
    try { snapshot = await this.snapshot() }
    catch { return 'COMPOSITION_SETTINGS_UNAVAILABLE' }
    if (snapshot.fingerprint !== active.snapshot.fingerprint) return 'COMPOSITION_SETTINGS_CHANGED'
    return this.currentReasonSync(active)
  }

  private currentReasonSync(active: ActiveRequest): string | undefined {
    if (this.disposed) return 'COMPOSITION_COORDINATOR_DISPOSED'
    if (!this.isCurrent(active)) return this.currentAbortReason(active)
    if (this.port !== active.port || this.registration === undefined) return 'JEV_SERVICE_CHANGED'
    if (!this.featureEnabled(active.port)) return 'JEV_FEATURE_DISABLED'
    // The request is linked to this exact saved nonsecret route identity. A
    // changed endpoint/model/credential reference must never adopt an old
    // response, even when source and UI settings are otherwise unchanged.
    try {
      if (stableJson(active.port.judgmentConnectionIdentity()) !== stableJson(active.connection)) return 'JEV_CONNECTION_CHANGED'
    } catch { return 'JEV_CONNECTION_UNAVAILABLE' }
    return undefined
  }

  private assertFresh(active: ActiveRequest, signal: AbortSignal): void {
    if (signal.aborted) throw new NamedError(this.currentAbortReason(active))
    const reason = this.currentReasonSync(active)
    if (reason) throw new NamedError(reason)
  }

  private resolvePort(): JevCompositionPort | undefined {
    if (this.disposed) return undefined
    if (this.port) return this.port
    let port: JevCompositionPort | undefined
    try { port = this.options.getJev?.() }
    catch { this.attachError = 'JEV_UNAVAILABLE'; return undefined }
    if (port) this.attachJev(port)
    return this.port
  }

  private featureEnabled(port: JevCompositionPort): boolean {
    try { return port.isFeatureEnabled(ADAPTIVE_COMPOSITION_FEATURE_ID) }
    catch { return false }
  }

  private recordOperation(active: ActiveRequest, operationId: string): void {
    const record: OperationRecord = {
      sessionId: active.input.sessionId,
      documentId: active.input.documentId,
      sourceVersion: active.sourceVersion,
      operationId,
      port: active.port,
      receiptState: 'ready',
    }
    this.operations.set(operationId, record)
    while (this.operations.size > this.maxCacheEntries) {
      const oldest = this.operations.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.operations.delete(oldest)
    }
  }

  private putCache(fingerprint: string, result: Omit<CompositionResult, 'requestId'>): void {
    this.cache.delete(fingerprint)
    this.cache.set(fingerprint, result)
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  private base(status: CompositionResult['status'], reason: string, sourceVersion: string, selection?: CompositionSelection, operationId?: string): Omit<CompositionResult, 'requestId'> {
    return compositionResultSchema.parse({ status, reason, sourceVersion, ...(selection === undefined ? {} : { selection }), ...(operationId === undefined ? {} : { operationId }) })
  }

  private isCurrent(operation: SharedOperation): boolean {
    const current = this.documents.get(operation.key)
    return current === operation.state && current.operation === operation && current.generation === operation.generation
      && current.sourceVersion === operation.sourceVersion && !operation.aborted && !operation.controller.signal.aborted
  }

  private currentAbortReason(operation: SharedOperation): string {
    const reason = operation.controller.signal.reason
    if (typeof reason === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(reason)) return reason
    return operation.abortReason ?? 'COMPOSITION_STALE'
  }

  private abortOperation(operation: SharedOperation, reason: string): void {
    if (operation.aborted || operation.settled) return
    operation.aborted = true
    operation.abortReason = reason
    if (!operation.controller.signal.aborted) operation.controller.abort(reason)
    for (const waiter of operation.waiters.values()) {
      waiter.cancelled = true
      waiter.resolveCancelled(this.base('stale', reason, operation.sourceVersion))
    }
    operation.waiters.clear()
    if (operation.fingerprint && this.inFlight.get(operation.fingerprint) === operation) this.inFlight.delete(operation.fingerprint)
    if (operation.state.operation === operation) operation.state.operation = undefined
  }

  private abortAll(reason: string): void {
    for (const [key, state] of this.documents) {
      if (state.operation) this.abortOperation(state.operation, reason)
      this.documents.delete(key)
    }
  }

  private detachJev(reason: string): void {
    this.abortAll(reason)
    this.featureListener?.()
    this.featureListener = undefined
    this.registration?.()
    this.registration = undefined
    this.port = undefined
  }
}

function operationId(result: JevJudgeOnceResult): string | undefined {
  return 'operationId' in result ? result.operationId : undefined
}

function isChoiceAnswer(value: unknown): value is JevChoiceAnswer {
  return isRecord(value) && value.kind === 'choice' && typeof value.id === 'string' && typeof value.optionId === 'string'
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('COMPOSITION_LIMIT_INVALID')
  return value
}
