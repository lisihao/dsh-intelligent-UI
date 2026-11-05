// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveCompositionCoordinator } from '../src/adaptive-ui/host.js'
import { buildCompositionCandidates } from '../src/adaptive-ui/planner.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { JevCompositionPort, JevJudgeOnceOptions, JevRequest, JevJudgeOnceResult } from '../src/adaptive-ui/contracts.js'
import { ContentView } from '../src/presentation.js'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { builtInThemes, themePackageSchema } from '../src/theme-contracts.js'
import linen from '../src/themes/linen-example.dsh-theme.json' with { type: 'json' }
import cobalt from '../theme/unslop-cobalt.dsh-theme.json' with { type: 'json' }
import paper from '../theme/paper-flow.dsh-theme.json' with { type: 'json' }
import { themePreferences } from '../src/theme-runtime.js'
import { conversationScenarios, type ConversationScenario } from './fixtures/adaptive-conversation-scenarios.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const settings = { ...initialSettings(), takeover: true, adaptive: { enabled: true, styleMode: 'automatic' as const } }
const mounts: { root: Root; host: HTMLDivElement; coordinator: AdaptiveCompositionCoordinator }[] = []

/** Explicit oracle-selected answers test wiring; they are not real model judgments. */
class ScenarioJev implements JevCompositionPort {
  requests: JevRequest[] = []
  receipts: string[] = []
  constructor(private readonly choices: Record<string, string>) {}
  registerFeature() { return () => undefined }
  isFeatureEnabled() { return true }
  judgmentConnectionIdentity() { return { connectionId: 'synthetic-scenario', baseUrl: 'https://synthetic.invalid', model: 'fixture-selector', credentialRef: 'NO_CREDENTIAL', timeoutMs: 1000 } }
  async writeReceipt(operationId: string) { this.receipts.push(operationId) }
  async judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult> {
    const signal = options.signal ?? new AbortController().signal
    const request = await options.refresh(signal)
    options.preflight?.(request)
    this.requests.push(request)
    const state = request.state as unknown as { composition: { candidateBundle: { defaultAnswers: Record<string, string> } } }
    const response = { answers: request.questions.map(question => ({
      id: question.id, kind: 'choice' as const, optionId: this.choices[question.id] ?? state.composition.candidateBundle.defaultAnswers[question.id]!,
    })) }
    const interpreted = await options.interpret?.(response, signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId: 'fixture-op', reason: interpreted.reason }
    const adopt = await options.canAdopt?.(response, signal)
    if (adopt !== undefined && adopt !== true) return { kind: 'not-adopted', operationId: 'fixture-op', reason: adopt }
    return { kind: 'ok', operationId: 'fixture-op', attemptId: 'fixture-attempt', response }
  }
}

beforeEach(() => {
  themePreferences.reset()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => kind === '2d' ? { font: '', measureText: (value: string) => ({ width: value.length * 7 }) } as CanvasRenderingContext2D : null)
})
afterEach(async () => {
  for (const { root, host, coordinator } of mounts.splice(0)) {
    await act(async () => root.unmount())
    coordinator.dispose()
    host.remove()
  }
  themePreferences.reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mountScenario(scenario: ConversationScenario, wrapped: boolean, runtimeSettings: ExperienceSettings = settings) {
  const port = new ScenarioJev(scenario.choices)
  const coordinator = new AdaptiveCompositionCoordinator({ getSettings: async () => runtimeSettings, getJev: () => port })
  const api: CompositionApi = { composition: input => coordinator.compose(input), compositionReceipt: input => coordinator.receipt(input), compositionCancel: async input => coordinator.cancel(input) }
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host)
  mounts.push({ host, root, coordinator })
  const wrap = (value: unknown) => wrapped ? [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] : value
  const render = async (value: unknown) => {
    await act(async () => root.render(h(CompositionRuntimeContext.Provider, { value: { api, settings: runtimeSettings, sessionId: 'synthetic-conversation' } }, h(ContentView, { value: wrap(value), sessionId: 'synthetic-conversation', documentId: scenario.id }))))
  }
  await render(scenario.value)
  await act(async () => { await vi.waitFor(() => expect(port.receipts).toEqual(['fixture-op'])) })
  return { host, port, render, coordinator, source: wrap(scenario.value) }
}

describe.each(conversationScenarios)('conversation scenario: $title', scenario => {
  it.each([false, true])('selects and mounts validated choices through the real coordinator (tool wrapper: %s)', async wrapped => {
    const candidate = buildCompositionCandidates({ value: scenario.value, themes: builtInThemes, selectedThemeId: 'empryo', styleMode: 'automatic', capabilities: { webgl: false, reducedMotion: true } })
    for (const [questionId, prohibited] of Object.entries(scenario.forbiddenOptions)) {
      const options = candidate.questions.find(question => question.id === questionId)?.options.map(option => option.id) ?? []
      for (const option of prohibited) expect(options, `${scenario.id}: illegal option ${questionId}/${option}`).not.toContain(option)
    }
    const originalSource = JSON.stringify(scenario.value)
    const { host, port, source } = await mountScenario(scenario, wrapped)
    expect(host.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()
    expect(host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe(scenario.choices.theme)
    expect(host.querySelector(scenario.requiredSelector), scenario.id).not.toBeNull()
    for (const text of scenario.requiredText) expect(host.textContent, scenario.id).toContain(text)
    for (const selector of scenario.forbiddenSelectors) expect(host.querySelector(selector), `${scenario.id}: fabricated view ${selector}`).toBeNull()
    expect(port.requests).toHaveLength(1)
    expect(port.requests[0]?.state).toMatchObject({ source: { sessionId: 'synthetic-conversation', documentId: scenario.id, value: source } })
    // Original source is not rewritten by a layout choice or mount receipt.
    expect(JSON.stringify(scenario.value)).toBe(originalSource)
    if (scenario.id === 'historical-gap') {
      expect(host.querySelectorAll('path.visx-linepath')).toHaveLength(2)
      expect(host.querySelectorAll('.iexp-historical-chart circle')).toHaveLength(4)
      const original = host.querySelector('.iexp-full-table table')!
      expect(original.textContent).toContain('2026-10-05—')
      expect(original.querySelectorAll('tbody tr')).toHaveLength(5)
      const xs = [...host.querySelectorAll('.iexp-historical-chart circle')].map(point => Number(point.getAttribute('cx')))
      expect((xs[2]! - xs[1]!) / (xs[1]! - xs[0]!)).toBeCloseTo(7, 4)
    }
    if (scenario.id === 'task-board') {
      expect(host.querySelectorAll('.iexp-task')).toHaveLength(3)
      expect(host.querySelector('[data-iexp-component-set="mechanical-outline"]')).not.toBeNull()
    }
  })
  if (scenario.nextValue !== undefined) it('binds the exact next data tick without another model decision', async () => {
    const { host, port, render } = await mountScenario(scenario, true)
    await render(scenario.nextValue)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.textContent).toContain(scenario.nextText)
    expect(port.requests).toHaveLength(1)
    expect(port.receipts).toHaveLength(1)
    if (scenario.id === 'live-exact-snapshot') expect(host.querySelector('table')?.textContent).toContain('3000 milliseconds')
  })
})


describe('installed theme packages participate in conversation decisions', () => {
  const imported = [linen, cobalt, paper].map(theme => themePackageSchema.parse(theme))
  it.each(imported)('applies the installed $id theme in the real source-owned view', async theme => {
    const scenario: ConversationScenario = { ...conversationScenarios[0]!, id: `imported-${theme.id}`, choices: { theme: theme.id, surface: 'semantic', layout: 'document' } }
    const runtimeSettings = { ...settings, theme: { activeId: 'empryo', installed: imported } }
    const { host, port } = await mountScenario(scenario, false, runtimeSettings)
    const options = port.requests[0]!.questions.find(question => question.id === 'theme')!.options.map(option => option.id)
    expect(options).toEqual(expect.arrayContaining([...builtInThemes.filter(theme => theme.id !== 'ascii-gpu'), ...imported].map(theme => theme.id)))
    const scope = host.querySelector<HTMLElement>('[data-iexp-composition-status="selected"]')!
    expect(scope.getAttribute('data-iexp-adaptive-theme')).toBe(theme.id)
    expect(scope.style.getPropertyValue('--iexp-card-radius')).toBe(`${theme.tokens.cardRadius}px`)
    for (const text of scenario.requiredText) expect(host.textContent).toContain(text)
    // Selecting an output-local imported theme does not mutate the manual/global theme.
    expect(themePreferences.getSnapshot().id).toBe('empryo')
    expect(runtimeSettings.theme.activeId).toBe('empryo')
  })
})
