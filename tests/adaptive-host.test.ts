import { builtInThemes } from '../src/theme-contracts.js'
import { describe, expect, it, vi } from 'vitest'
import {
  type AdaptiveCompositionSettings,
  type ComposeInput,
  type JevCompositionPort,
  type JevJudgeOnceOptions,
  type JevJudgeOnceResult,
  type JevRequest,
  type JevResponse,
} from '../src/adaptive-ui/contracts.js'
import { AdaptiveCompositionCoordinator } from '../src/adaptive-ui/host.js'
import { buildCompositionCandidates } from '../src/adaptive-ui/planner.js'
import { createSourceBlockComponentRegistry } from '../src/adaptive-ui/source-block-components.js'
import { compileBlockLayout } from '../src/adaptive-ui/block-compiler.js'
import { outlineBlockLayout } from '../src/adaptive-ui/block-outline.js'

type Deferred<T> = { promise: Promise<T>, resolve: (value: T) => void }
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(next => { resolve = next }), resolve }
}

function settings(styleMode: 'selected' | 'automatic' = 'automatic', enabled = true): AdaptiveCompositionSettings {
  return { takeover: true, adaptive: { enabled, styleMode }, theme: { activeId: 'empryo', installed: [] } }
}

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    sessionId: 'session-1', documentId: 'document-1', requestId: 'request-1',
    value: '## 本周调用趋势\n\n| 日期 | 调用量（次） |\n| --- | ---: |\n| 2026-10-27 | 1,082 |\n| 2026-10-28 | 1,447 |\n| 2026-10-29 | 1,273 |',
    styleMode: 'automatic', capabilities: { webgl: true, reducedMotion: false }, ...overrides,
  }
}

function fieldBindingsFor(referenceId: string, questionIds: readonly string[]): Readonly<Record<string, string>> {
  const prefix = `${referenceId}:`
  const bindings: Record<string, string> = {}
  for (const questionId of questionIds) {
    if (!questionId.startsWith(prefix)) continue
    const field = questionId.slice(prefix.length)
    if (!field) continue
    bindings[field.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = questionId
  }
  return bindings
}

function countExactString(value: unknown, target: string): number {
  if (value === target) return 1
  if (Array.isArray(value)) return value.reduce((count, item) => count + countExactString(item, target), 0)
  if (value && typeof value === 'object') return Object.values(value).reduce((count, item) => count + countExactString(item, target), 0)
  return 0
}

function withoutOpaqueInputVersion(request: JevRequest): unknown {
  const copy = JSON.parse(JSON.stringify(request)) as { state: { source: { inputVersion?: unknown } } }
  delete copy.state.source.inputVersion
  return copy
}

function waitForAbort(gate: Promise<void>, signal: AbortSignal | undefined): Promise<'gate' | 'aborted'> {
  if (!signal) return gate.then(() => 'gate')
  if (signal.aborted) return Promise.resolve('aborted')
  return Promise.race([
    gate.then(() => 'gate' as const),
    new Promise<'aborted'>(resolve => signal.addEventListener('abort', () => resolve('aborted'), { once: true })),
  ])
}

class FakeJev implements JevCompositionPort {
  enabled = true
  calls = 0
  writes = 0
  requests: JevRequest[] = []
  gate?: Deferred<void>
  gates: Deferred<void>[] = []
  mode: 'ok' | 'failed' | 'cancelled' | 'not-adopted' = 'ok'
  answerFor?: (request: JevRequest) => JevResponse
  writeError?: Error
  connection = { connectionId: 'luna-openai', baseUrl: 'https://decisions.invalid/v1', model: 'test', credentialRef: 'REF_ONLY', timeoutMs: 1000 }
  private readonly listeners = new Set<(features: Readonly<Record<string, boolean>>) => void>()

  registerFeature(): () => void { return () => undefined }
  isFeatureEnabled(): boolean { return this.enabled }
  judgmentConnectionIdentity() { return { ...this.connection } }
  onFeatureStateChange(listener: (features: Readonly<Record<string, boolean>>) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  setEnabled(enabled: boolean): void { this.enabled = enabled; for (const listener of this.listeners) listener({ 'ui-composition': enabled }) }
  async writeReceipt(): Promise<unknown> { this.writes += 1; if (this.writeError) throw this.writeError; return {} }

  async judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult> {
    this.calls += 1
    const operationId = `operation-${this.calls}`
    const signal = options.signal
    const request = await options.refresh(signal ?? new AbortController().signal)
    options.preflight?.(request)
    for (const question of request.questions) expect(question.options.length).toBeGreaterThanOrEqual(2)
    this.requests.push(request)
    const gate = this.gates.shift() ?? this.gate
    if (gate && await waitForAbort(gate.promise, signal) === 'aborted') return { kind: 'cancelled', operationId }
    if (signal?.aborted) return { kind: 'cancelled', operationId }
    if (this.mode === 'failed') return { kind: 'failed', operationId, failure: { code: 'NETWORK', message: 'provider detail is intentionally ignored' } }
    if (this.mode === 'cancelled') return { kind: 'cancelled', operationId }
    if (this.mode === 'not-adopted') return { kind: 'not-adopted', operationId, reason: 'JEV_DECLINED' }
    const response = this.answerFor?.(request) ?? { answers: request.questions.map(question => ({ id: question.id, kind: 'choice' as const, optionId: question.options[0]!.id })) }
    const interpreted = await options.interpret?.(response, signal ?? new AbortController().signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId, reason: interpreted.reason }
    const adoption = await options.canAdopt?.(response, signal ?? new AbortController().signal)
    if (adoption !== undefined && adoption !== true) return { kind: 'not-adopted', operationId, reason: adoption }
    return { kind: 'ok', operationId, attemptId: `attempt-${this.calls}`, response }
  }
}

async function waitForCalls(port: FakeJev, calls: number): Promise<void> { await vi.waitFor(() => expect(port.calls).toBe(calls)) }

describe('AdaptiveCompositionCoordinator', () => {
  it('projects a versioned experimental block context without duplicating candidates or source', async () => {
    const saved = {...settings(), adaptive:{enabled:true,styleMode:'automatic' as const,blockLayout:true}}
    const port = new FakeJev()
    port.answerFor = request => ({answers:request.questions.map(question=>({id:question.id,kind:'choice' as const,optionId:question.id.endsWith(':component-set')?'clear-glass':question.options[0]!.id}))})
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    const source = '# Source\n\nOrdinary prose.\n\n```js\nconst answer = 42\n```\n\nEND-OF-EXACT-SOURCE'
    const result = await coordinator.compose(input({value:source}))
    expect(result.status).toBe('selected')
    expect(result.selection?.blockLayout?.blocks.every(block=>block.selection.componentSet==='clear-glass')).toBe(true)
    const request = port.requests[0]!
    const state = request.state as {
      source: { value: unknown },
      composition: Record<string, unknown> & {
        inputFormat: string,
        blockLayout: { version: number, blocks: Array<{ reference: { id: string }, questionIds: string[], fieldBindings: Readonly<Record<string, string>> }> },
      },
    }
    expect(state.composition.designRubric).toMatchObject({criteria:expect.arrayContaining(['content fit','readability','scannability'])})
    for (const question of request.questions) {
      expect(question.prompt).toMatchObject({designRubricRef:'composition.designRubric'})
      expect(question.prompt).not.toHaveProperty('designRubric')
    }
    expect(state.source.value).toBe(source)
    expect(countExactString(request.state, source)).toBe(1)
    expect(state.composition).toMatchObject({
      inputFormat: 'block-design-context@5',
      styleMode: 'automatic',
      capabilities: { webgl: true, reducedMotion: false },
      isStreaming: false,
      blockLayout: { version: 1 },
    })
    for (const key of ['selectedThemeId', 'lockedThemeId', 'themes', 'candidateBundle', 'catalog', 'identity', 'questions', 'defaultAnswers']) {
      expect(state.composition).not.toHaveProperty(key)
    }
    const built = buildCompositionCandidates({
      value: source,
      themes: builtInThemes,
      selectedThemeId: 'empryo',
      styleMode: 'automatic',
      capabilities: { webgl: true, reducedMotion: false },
      blockLayout: true,
    })
    expect(built.blockLayout).toBeDefined()
    const program = built.blockLayout!
    expect(state.composition.blockLayout.blocks).toEqual(program.blocks.map(binding => ({
      reference: binding.reference,
      questionIds: binding.questionIds,
      fieldBindings: fieldBindingsFor(binding.reference.id, binding.questionIds),
    })))
    expect((state.composition.blockLayout as unknown as { outline: unknown }).outline).toEqual(outlineBlockLayout(source, compileBlockLayout(source)))
    expect(request.questions).toEqual(built.questions.filter(question => question.options.length >= 2))
    expect(state.composition).not.toHaveProperty('sharedOptionGuidance')
    coordinator.dispose()
  })

  it('exposes an experimental selected theme only as a manual lock', async () => {
    const automaticName = {...builtInThemes.find(theme=>theme.id==='ascii')!,id:'auto'}
    const saved = {...settings('selected'),adaptive:{enabled:true,styleMode:'selected' as const,blockLayout:true},theme:{activeId:'auto',installed:[automaticName]}}
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    const result = await coordinator.compose(input({value:'| Item | Value (USD) |\n| --- | ---: |\n| A | 4 |\n| B | 6 |'}))
    expect(result.status).toBe('selected')
    const state = port.requests[0]!.state as {composition:Record<string,unknown>}
    expect(state.composition).toMatchObject({inputFormat:'block-design-context@5',styleMode:'selected',lockedThemeId:'auto'})
    expect(state.composition).not.toHaveProperty('selectedThemeId')
    expect(state.composition).not.toHaveProperty('themes')
    expect(state.composition).not.toHaveProperty('candidateBundle')
    expect(port.requests[0]!.questions.map(question=>question.id)).not.toContain('theme')
    coordinator.dispose()
  })

  it('sends every frame option with its complete description, and the outline in all three requests', async () => {
    const source = '# A\n\nFirst prose.\n\n| Day | Calls |\n| --- | ---: |\n| Mon | 2 |\n| Tue | 3 |\n\n## B\n\nSecond prose.'
    for (const styleMode of ['automatic', 'selected'] as const) {
      const saved = {...settings(styleMode), adaptive:{enabled:true,styleMode,blockLayout:true}}
      const port = new FakeJev()
      const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port,getExecutableComponents:()=>createSourceBlockComponentRegistry()})
      const result = await coordinator.compose(input({value:source,styleMode}))
      expect(result.status).toBe('selected')
      expect(port.requests).toHaveLength(3)
      const frame = port.requests[0]!
      const built = buildCompositionCandidates({value:source,themes:builtInThemes,selectedThemeId:'empryo',styleMode,capabilities:{webgl:true,reducedMotion:false},blockLayout:true})
      const byId = new Map(built.questions.map(question => [question.id, question]))
      for (const question of frame.questions) expect(question).toEqual(byId.get(question.id))
      const materials = frame.questions.filter(question => question.id.endsWith(':component-set'))
      expect(materials.length).toBe(styleMode === 'automatic' ? 3 : 0)
      for (const later of [frame, ...port.requests.slice(1)]) expect(JSON.stringify(later)).not.toMatch(/sharedOptionGuidance|guidanceRef/)
      const expectedOutline = outlineBlockLayout(source, compileBlockLayout(source))
      expect((frame.state as {composition:{blockLayout:{outline:unknown}}}).composition.blockLayout.outline).toEqual(expectedOutline)
      expect(expectedOutline.sections.map(section => section.title)).toEqual(['A', 'B'])
      for (const later of port.requests.slice(1)) {
        expect((later.state as {input:{inputFormat:string,outline:unknown}}).input).toMatchObject({inputFormat:'source-block-component-context@1',outline:expectedOutline})
      }
      coordinator.dispose()
    }
  })

  it('keeps automatic experimental requests comparable across active theme swaps and input order', async () => {
    const empryo = builtInThemes.find(theme => theme.id === 'empryo')
    const plain = builtInThemes.find(theme => theme.id === 'plain')
    expect(empryo).toBeDefined()
    expect(plain).toBeDefined()
    if (!empryo || !plain) throw new Error('Expected built-in comparison themes.')
    const source = '# Stable source\n\n| Day | Calls |\n| --- | ---: |\n| Mon | 2 |\n| Tue | 3 |'
    const capture = async (activeId: string, themes: readonly typeof empryo[]) => {
      const port = new FakeJev()
      const saved: AdaptiveCompositionSettings = {
        takeover: true,
        adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true },
        theme: { activeId, installed: [] },
      }
      const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => saved, getThemes: async () => themes, getJev: () => port })
      expect((await coordinator.compose(input({ value: source, requestId: `${activeId}-${themes[0]!.id}` }))).status).toBe('selected')
      coordinator.dispose()
      return port.requests[0]!
    }
    const canonical = await capture('empryo', [empryo, plain])
    const reversed = await capture('plain', [plain, empryo])
    const canonicalInputVersion = (canonical.state as { source: { inputVersion: string } }).source.inputVersion
    const reversedInputVersion = (reversed.state as { source: { inputVersion: string } }).source.inputVersion
    expect(canonicalInputVersion).not.toBe(reversedInputVersion)
    expect(withoutOpaqueInputVersion(canonical)).toEqual(withoutOpaqueInputVersion(reversed))
  })

  it('still invalidates an automatic experimental decision when saved active theme changes', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    let saved: AdaptiveCompositionSettings = {
      takeover: true,
      adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true },
      theme: { activeId: 'empryo', installed: [] },
    }
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    const pending = coordinator.compose(input())
    await waitForCalls(port, 1)
    saved = {...saved,theme:{...saved.theme!,activeId:'plain'}}
    gate.resolve()
    await expect(pending).resolves.toMatchObject({status:'stale',reason:'COMPOSITION_SETTINGS_CHANGED'})
    coordinator.dispose()
  })

  it('gates the block compiler with the saved experiment switch and batches its choices', async () => {
    const port = new FakeJev()
    let saved: AdaptiveCompositionSettings = settings()
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    const source = input({value:'# Source report\n\nSource prose stays intact.\n\n| Year | Count |\n| --- | ---: |\n| 2024 | 12 |\n| 2025 | 18 |\n\nCollect -> Verify -> Render'})
    const legacy = await coordinator.compose(source)
    expect(legacy.status).toBe('selected')
    expect(legacy.selection?.blockLayout).toBeUndefined()
    expect(port.calls).toBe(1)
    saved = {...saved, adaptive:{...saved.adaptive!,blockLayout:true}}
    const compiled = await coordinator.compose({...source,requestId:'compiled'})
    expect(compiled.status).toBe('selected')
    expect(compiled.selection?.blockLayout).toMatchObject({version:1,inspection:'none'})
    expect(compiled.selection?.blockLayout?.blocks.length).toBeGreaterThan(1)
    expect(port.calls).toBe(2) // One call for the whole block program, not per block.
    expect(new Set(port.requests[1]!.questions.map(q=>q.id)).size).toBe(port.requests[1]!.questions.length)
    saved = {...saved, adaptive:{...saved.adaptive!,blockLayout:false}}
    const restored = await coordinator.compose({...source,requestId:'legacy-again'})
    expect(restored.selection?.blockLayout).toBeUndefined()
    coordinator.dispose()
  })

  it('does not let a caller activate the saved experimental setting', async () => {
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>settings(),getJev:()=>port})
    await expect(coordinator.compose({...input(),blockLayout:true} as never)).rejects.toThrow()
    expect(port.calls).toBe(0)
    coordinator.dispose()
  })

  it('refuses an in-flight compiled plan after the saved experiment is disabled', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    let saved: AdaptiveCompositionSettings = {...settings(),adaptive:{enabled:true,styleMode:'automatic',blockLayout:true}}
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    const pending = coordinator.compose(input())
    await waitForCalls(port,1)
    saved = {...saved,adaptive:{...saved.adaptive!,blockLayout:false}}
    gate.resolve()
    const result = await pending
    expect(result.status).not.toBe('selected')
    expect(result.reason).toBe('COMPOSITION_SETTINGS_CHANGED')
    expect(port.calls).toBe(1)
    coordinator.dispose()
  })

  it('does not invalidate a selected composition just because the shortcut changes', async () => {
    const port = new FakeJev()
    let saved: AdaptiveCompositionSettings = {...settings(),adaptive:{enabled:true,styleMode:'automatic',blockLayout:true}}
    const coordinator = new AdaptiveCompositionCoordinator({getSettings:async()=>saved,getJev:()=>port})
    expect((await coordinator.compose(input())).status).toBe('selected')
    saved = {...saved,adaptive:{...saved.adaptive!,blockLayoutShortcut:'Alt+Meta+KeyK'}}
    expect((await coordinator.compose({...input(),requestId:'shortcut-only'})).status).toBe('selected')
    expect(port.calls).toBe(1)
    coordinator.dispose()
  })

  it('keeps a deterministic local presentation when Jev is missing or its scoped feature is disabled', async () => {
    const missing = new AdaptiveCompositionCoordinator({ getSettings: async () => settings() })
    expect(await missing.compose(input())).toMatchObject({ status: 'local', reason: 'JEV_UNAVAILABLE', selection: { themeId: 'empryo' } })

    const disabledPort = new FakeJev()
    disabledPort.enabled = false
    const disabled = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => disabledPort })
    expect(await disabled.compose(input())).toMatchObject({ status: 'local', reason: 'JEV_FEATURE_DISABLED' })
    expect(disabledPort.calls).toBe(0)
  })

  it('uses saved style settings rather than a caller hint and accepts a valid non-default chart choice', async () => {
    const port = new FakeJev()
    port.answerFor = request => ({ answers: request.questions.map(question => ({
      id: question.id, kind: 'choice' as const,
      optionId: question.id === 'theme' ? 'empryo' : question.id === 'surface' ? 'semantic' : question.id === 'chart' ? 'openui' : question.options[0]!.id,
    })) })
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings('selected'), getJev: () => port })
    const result = await coordinator.compose(input({ styleMode: 'automatic' }))
    expect(result).toMatchObject({ status: 'selected', selection: { themeId: 'empryo', surface: 'semantic', chart: 'openui' } })
    expect(port.requests[0]?.state).toMatchObject({ composition: { styleMode: 'selected' } })

    const automaticPort = new FakeJev()
    automaticPort.answerFor = request => ({ answers: request.questions.map(question => ({
      id: question.id, kind: 'choice' as const,
      optionId: question.id === 'theme' ? 'plain' : question.id === 'surface' ? 'semantic' : question.id === 'chart' ? 'openui' : question.options[0]!.id,
    })) })
    const automatic = new AdaptiveCompositionCoordinator({ getSettings: async () => settings('automatic'), getJev: () => automaticPort })
    expect(await automatic.compose(input({ styleMode: 'selected' }))).toMatchObject({ status: 'selected', selection: { themeId: 'plain', chart: 'openui' } })
    expect(automaticPort.requests[0]?.state).toMatchObject({ composition: { styleMode: 'automatic' } })
  })

  it('sends only real choices while preserving the full singleton candidate bundle', async () => {
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const result = await coordinator.compose(input({ value: 'A short document without chart data.' }))
    expect(result).toMatchObject({ status: 'selected', selection: { chart: 'auto', layout: 'auto' } })
    expect(port.requests[0]?.questions.map(question => question.id)).toEqual(expect.arrayContaining(['theme', 'surface', 'component-set']))
    expect(port.requests[0]?.questions.map(question => question.id)).not.toEqual(expect.arrayContaining(['chart', 'layout']))
    const state = port.requests[0]?.state as { composition: { selectedThemeId: string, styleMode: string, themes: readonly unknown[], candidateBundle: { questions: readonly { id: string, options: readonly { id: string }[] }[], defaultAnswers: Readonly<Record<string, string>> }, inputFormat?: string } }
    expect(state.composition).toMatchObject({selectedThemeId:'empryo',styleMode:'automatic',themes:expect.any(Array)})
    expect(state.composition.inputFormat).toBeUndefined()
    expect(state.composition.candidateBundle.questions.find(question => question.id === 'chart')?.options.map(option => option.id)).toEqual(['auto'])
    expect(state.composition.candidateBundle.defaultAnswers.chart).toBe('auto')
  })

  it('keeps the selected theme locally when that theme is a singleton choice', async () => {
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings('selected'), getJev: () => port })
    const result = await coordinator.compose(input({ value: 'A short document without chart data.' }))
    expect(result).toMatchObject({ status: 'selected', selection: { themeId: 'empryo' } })
    expect(port.requests[0]?.questions.map(question => question.id)).not.toContain('theme')
    const state = port.requests[0]?.state as { composition: { candidateBundle: { questions: readonly { id: string, options: readonly { id: string }[] }[] } } }
    expect(state.composition.candidateBundle.questions.find(question => question.id === 'theme')?.options.map(option => option.id)).toEqual(['empryo'])
  })

  it.each(['not-a-question', 'chart'])('rejects an answer outside the actual Jev question set (%s)', async extraId => {
    const port = new FakeJev()
    port.answerFor = request => ({ answers: request.questions.map((question, index) => index === 0
      ? { id: extraId, kind: 'choice' as const, optionId: 'auto' }
      : { id: question.id, kind: 'choice' as const, optionId: question.options[0]!.id }) })
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const result = await coordinator.compose(input({ value: 'A short document without chart data.' }))
    expect(result).toMatchObject({ status: 'local', reason: 'COMPOSITION_ANSWER_INVALID' })
    expect(port.calls).toBe(1)
  })

  it('rejects a missing answer from the authoritative Jev question set', async () => {
    const port = new FakeJev()
    port.answerFor = request => ({ answers: request.questions.slice(1).map(question => ({
      id: question.id, kind: 'choice' as const, optionId: question.options[0]!.id,
    })) })
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const result = await coordinator.compose(input({ value: 'A short document without chart data.' }))
    expect(result).toMatchObject({ status: 'local', reason: 'COMPOSITION_ANSWER_COUNT_INVALID' })
    expect(port.calls).toBe(1)
  })

  it('keeps a no-choice source local without calling Jev', async () => {
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const result = await coordinator.compose(input({ value: 'streaming source', isStreaming: true }))
    expect(result).toMatchObject({ status: 'local', reason: 'COMPOSITION_STREAMING_SOURCE' })
    expect(port.calls).toBe(0)
  })

  it('coalesces an exact request and records complete deterministic source/candidate state', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const first = coordinator.compose(input({ requestId: 'request-a' }))
    await waitForCalls(port, 1)
    const second = coordinator.compose(input({ requestId: 'request-b' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(port.calls).toBe(1)
    gate.resolve()
    const [left, right] = await Promise.all([first, second])
    expect(left).toMatchObject({ status: 'selected', requestId: 'request-a' })
    expect(right).toMatchObject({ status: 'selected', requestId: 'request-b' })
    expect(port.requests[0]).toMatchObject({
      state: {
        formatVersion: 1,
        source: { sessionId: 'session-1', documentId: 'document-1', value: input().value, inputVersion: expect.stringMatching(/^adaptive-ui-composition@1:sha256:/) },
        composition: { candidateBundle: { revision: 1 }, themes: expect.any(Array) },
      },
    })
    expect(port.requests[0]?.questions.length).toBeGreaterThan(0)
  })

  it('withdraws one same-fingerprint waiter without aborting the still-mounted view', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const first = coordinator.compose(input({ requestId: 'view-a' }))
    await waitForCalls(port, 1)
    const second = coordinator.compose(input({ requestId: 'view-b' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(port.calls).toBe(1)
    expect(coordinator.cancel({ sessionId: 'session-1', documentId: 'document-1', requestId: 'view-b' })).toMatchObject({ cancelled: true })
    await expect(second).resolves.toMatchObject({ status: 'stale', reason: 'COMPOSITION_CANCELLED', requestId: 'view-b' })
    expect((await coordinator.status()).activeDocuments).toBe(1)
    gate.resolve()
    await expect(first).resolves.toMatchObject({ status: 'selected', requestId: 'view-a' })
    expect((await coordinator.status()).activeDocuments).toBe(0)
  })

  it('aborts a shared operation only after its final waiter leaves', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const first = coordinator.compose(input({ requestId: 'view-a' }))
    await waitForCalls(port, 1)
    const second = coordinator.compose(input({ requestId: 'view-b' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    coordinator.cancel({ sessionId: 'session-1', documentId: 'document-1', requestId: 'view-a' })
    coordinator.cancel({ sessionId: 'session-1', documentId: 'document-1', requestId: 'view-b' })
    await expect(first).resolves.toMatchObject({ status: 'stale', reason: 'COMPOSITION_CANCELLED' })
    await expect(second).resolves.toMatchObject({ status: 'stale', reason: 'COMPOSITION_CANCELLED' })
    await vi.waitFor(async () => expect((await coordinator.status()).activeDocuments).toBe(0))
    expect(port.calls).toBe(1)
  })

  it('does not let an old cleanup cancel a newer document request', async () => {
    const port = new FakeJev(), firstGate = deferred<void>(), secondGate = deferred<void>()
    port.gates.push(firstGate, secondGate)
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const old = coordinator.compose(input({ requestId: 'old-request', value: { value: 1 } }))
    await waitForCalls(port, 1)
    const fresh = coordinator.compose(input({ requestId: 'fresh-request', value: { value: 2 } }))
    await waitForCalls(port, 2)
    expect(coordinator.cancel({ sessionId: 'session-1', documentId: 'document-1', requestId: 'old-request' })).toMatchObject({ cancelled: false, reason: 'COMPOSITION_CANCEL_IDENTITY_MISMATCH' })
    secondGate.resolve()
    expect((await fresh).status).toBe('selected')
    expect((await old).status).toBe('stale')
  })

  it('cancels during settings preparation before any Jev attempt can start', async () => {
    const port = new FakeJev(), settingsGate = deferred<AdaptiveCompositionSettings>()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => await settingsGate.promise, getJev: () => port })
    const pending = coordinator.compose(input({ requestId: 'preflight-cancel' }))
    expect(coordinator.cancel({ sessionId: 'session-1', documentId: 'document-1', requestId: 'preflight-cancel' })).toMatchObject({ cancelled: true, reason: 'COMPOSITION_CANCELLED' })
    settingsGate.resolve(settings())
    await expect(pending).resolves.toMatchObject({ status: 'stale', reason: 'COMPOSITION_CANCELLED' })
    expect(port.calls).toBe(0)
  })

  it('rejects a decision when relevant saved settings changed while it awaited Jev', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    let current = settings('automatic')
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => current, getJev: () => port })
    const pending = coordinator.compose(input())
    await waitForCalls(port, 1)
    current = settings('selected')
    gate.resolve()
    await expect(pending).resolves.toMatchObject({ status: 'stale', reason: 'COMPOSITION_SETTINGS_CHANGED' })
  })

  it('rejects an in-flight response when the saved Jev connection identity changed', async () => {
    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const pending = coordinator.compose(input())
    await waitForCalls(port, 1)
    port.connection = { ...port.connection, model: 'replacement-route' }
    gate.resolve()
    const result = await pending
    expect(result).toMatchObject({ status: 'stale', reason: 'JEV_CONNECTION_CHANGED' })
    await expect(coordinator.writeReceipt({ sessionId: 'session-1', documentId: 'document-1', sourceVersion: result.sourceVersion, operationId: 'operation-1', observed: true })).rejects.toMatchObject({ message: 'COMPOSITION_RECEIPT_UNKNOWN_OPERATION' })
  })

  it('returns a logged Jev failure without automatically replaying the attempt', async () => {
    const port = new FakeJev()
    port.mode = 'failed'
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const first = await coordinator.compose(input())
    const second = await coordinator.compose(input({ requestId: 'new-client-request' }))
    expect(first).toMatchObject({ status: 'failed', reason: 'JEV_NETWORK', operationId: 'operation-1' })
    expect(second).toMatchObject({ status: 'failed', operationId: 'operation-1', requestId: 'new-client-request' })
    expect(port.calls).toBe(1)
    expect((await coordinator.status()).activeDocuments).toBe(0)
  })

  it('keeps the deterministic selection for non-ok and cancels after a disabling event', async () => {
    const nonOkPort = new FakeJev()
    nonOkPort.mode = 'not-adopted'
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => nonOkPort })
    expect(await coordinator.compose(input())).toMatchObject({ status: 'local', reason: 'JEV_DECLINED', selection: expect.any(Object) })

    const port = new FakeJev(), gate = deferred<void>()
    port.gate = gate
    const active = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const pending = active.compose(input())
    await waitForCalls(port, 1)
    port.setEnabled(false)
    await expect(pending).resolves.toMatchObject({ status: 'stale', reason: 'JEV_FEATURE_DISABLED' })
  })

  it('binds renderer receipts to a selected result and surfaces receipt failure without replaying Jev', async () => {
    const port = new FakeJev()
    port.writeError = new Error('ledger unavailable')
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    const selected = await coordinator.compose(input())
    expect(selected).toMatchObject({ status: 'selected', operationId: 'operation-1' })
    await expect(coordinator.writeReceipt({ sessionId: 'other-session', documentId: 'document-1', sourceVersion: selected.sourceVersion, operationId: selected.operationId!, observed: true })).rejects.toMatchObject({ message: 'COMPOSITION_RECEIPT_BINDING_MISMATCH' })
    await expect(coordinator.writeReceipt({ sessionId: 'session-1', documentId: 'document-1', sourceVersion: selected.sourceVersion, operationId: selected.operationId!, observed: true })).rejects.toMatchObject({ message: 'COMPOSITION_RECEIPT_NOT_SAVED' })
    await expect(coordinator.writeReceipt({ sessionId: 'session-1', documentId: 'document-1', sourceVersion: selected.sourceVersion, operationId: selected.operationId!, observed: true })).rejects.toMatchObject({ message: 'COMPOSITION_RECEIPT_UNCONFIRMED' })
    expect(port.writes).toBe(1)
    await coordinator.compose(input({ requestId: 'later-render' }))
    expect(port.calls).toBe(1)
  })

  it('does not send an over-budget source to Jev', async () => {
    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port, maxSourceBytes: 20 })
    expect(await coordinator.compose(input({ value: 'a source that exceeds twenty bytes' }))).toMatchObject({ status: 'local', reason: 'COMPOSITION_SOURCE_TOO_LARGE' })
    expect(port.calls).toBe(0)
  })

  it('releases disabled/cache paths and evicts settled document state', async () => {
    const disabledPort = new FakeJev()
    disabledPort.enabled = false
    const disabled = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => disabledPort, maxCacheEntries: 2 })
    for (let index = 0; index < 5; index += 1) await disabled.compose(input({ documentId: `disabled-${index}`, requestId: `disabled-${index}` }))
    expect((await disabled.status()).activeDocuments).toBe(0)
    expect((disabled as unknown as { documents: Map<string, unknown> }).documents.size).toBe(0)

    const port = new FakeJev()
    const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => settings(), getJev: () => port })
    await coordinator.compose(input({ requestId: 'cache-first' }))
    await coordinator.compose(input({ requestId: 'cache-second' }))
    expect(port.calls).toBe(1)
    expect((await coordinator.status()).activeDocuments).toBe(0)
  })
})
