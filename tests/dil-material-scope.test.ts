// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompositionSelectionContext } from '../src/adaptive-ui/scope.js'
import type { CompositionSelection } from '../src/adaptive-ui/planner.js'
import { DilNativeTreeView, DilProgramView, clearDilSnapshotCache } from '../src/dil/view.js'
import type { CompiledDil } from '../src/dil/compiler.js'
import { PresentationThemeContext } from '../src/theme-runtime.js'
import { builtInThemes, themePackageSchema, type ThemePackage } from '../src/theme-contracts.js'
import paperFlow from '../theme/paper-flow.dsh-theme.json' with { type: 'json' }

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type RunnerCallbacks = {
  onSnapshot(value: unknown): void
  onStateChange(value: Record<string, unknown>): void
  onFailure(error: unknown): void
}

const mocks = vi.hoisted(() => ({ createDilRunner: vi.fn() }))
vi.mock('../src/dil/runtime.js', () => ({ createDilRunner: mocks.createDilRunner }))

const compiled = {
  ok: true,
  protocolVersion: 1,
  source: '<box/>',
  sourceLength: 6,
  code: 'inert',
  codeLength: 5,
  constants: {},
  constantCount: 0,
  requiredComponents: [],
  appData: {},
  genuiComponents: [],
  fallbackMarkdown: 'fallback',
  diagnostics: [],
  diagnosticSummary: 'clean',
  stateKeys: [],
  durationMs: 0,
  compiledAt: '2026-11-06T00:00:00.000Z',
} as unknown as CompiledDil

const materialTree = {
  t: 'box',
  c: [
    { t: 'card', c: [{ t: '#text', v: '原始卡片' }] },
    { t: 'button', p: { label: '原始按钮' } },
    { t: 'input', p: { name: 'title', value: '原始输入' } },
    { t: 'checkbox', p: { name: 'enabled', checked: false }, c: [{ t: '#text', v: '原始开关' }] },
    { t: 'radio', p: { name: 'choice', value: 'a', checked: true }, c: [{ t: '#text', v: '原始单选' }] },
    { t: 'slider', p: { name: 'amount', min: 0, max: 10, value: 3 } },
    { t: 'segmented-control', p: { name: 'mode', value: 'a', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] } },
    { t: 'tabs', c: [
      { t: 'tab', p: { value: 'overview', selected: true }, c: [{ t: '#text', v: '概览' }] },
      { t: 'tab-panel', p: { active: true }, c: [{ t: '#text', v: '内容' }] },
    ] },
  ],
}

const empryo = builtInThemes.find(theme => theme.id === 'empryo')!
const paper = themePackageSchema.parse(paperFlow)
const softRelief = builtInThemes.find(theme => theme.id === 'uiverse-soft-relief')!

let callbacks: RunnerCallbacks | undefined
const runner = {
  start: vi.fn(async () => undefined),
  update: vi.fn(),
  trigger: vi.fn(),
  captureState: vi.fn(async () => ({})),
  dispose: vi.fn(),
}

let mounted: Array<{ root: Root, host: HTMLDivElement }> = []

function composition(componentSet: CompositionSelection['componentSet']): CompositionSelection {
  return {
    themeId: softRelief.id,
    surface: 'semantic',
    chart: 'auto',
    componentSet,
    objectEffect: 'none',
    layout: 'auto',
  }
}

function scoped(element: ReactElement, theme: ThemePackage, selection?: CompositionSelection): ReactElement {
  return h(PresentationThemeContext.Provider, { value: theme },
    h(CompositionSelectionContext.Provider, { value: selection }, element))
}

function componentSetNodes(host: HTMLDivElement): Element[] {
  return [...host.querySelectorAll('[data-iexp-component-set]')]
}

async function mount(element: ReactElement): Promise<{ root: Root, host: HTMLDivElement }> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  const item = { root, host }
  mounted.push(item)
  return item
}

async function mountNative(theme: ThemePackage, selection?: CompositionSelection) {
  return mount(scoped(h(DilNativeTreeView, {
    tree: materialTree,
    artifactId: 'material-native',
    sessionId: 'material-session',
    ownedHandlerIds: [],
    ownedFormActionIds: [],
  }), theme, selection))
}

async function mountProgram(theme: ThemePackage, selection?: CompositionSelection) {
  const view = await mount(scoped(h(DilProgramView, {
    source: '<box/>',
    compiled,
    enabled: true,
    artifactId: 'material-program',
    sessionId: 'material-session',
    frameUrl: 'https://runner.invalid/dil-frame.html',
  }), theme, selection))
  expect(callbacks).toBeDefined()
  await act(async () => callbacks!.onSnapshot(materialTree))
  return view
}

beforeEach(() => {
  callbacks = undefined
  mocks.createDilRunner.mockImplementation((options: RunnerCallbacks) => {
    callbacks = options
    return runner
  })
})

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount())
  clearDilSnapshotCache()
  document.body.replaceChildren()
  callbacks = undefined
  vi.clearAllMocks()
})

describe('DIL material scope', () => {
  it.each([
    ['Empryo', empryo],
    ['Paper', paper],
  ])('keeps V1 %s and every native control unstyled by the Uiverse adapter', async (_name, theme) => {
    const view = await mountNative(theme)
    expect(componentSetNodes(view.host)).toHaveLength(0)
    expect(view.host.querySelector('[data-dil-tag="card"]')?.classList.contains('iexp-uiv-card')).toBe(false)
    expect(view.host.querySelector('[data-dil-tag="button"]')?.classList.contains('iexp-uiv-button')).toBe(false)
    expect(view.host.querySelector('[data-dil-tag="input"]')?.classList.contains('iexp-uiv-input')).toBe(false)
    expect(view.host.querySelector('.iexp-dil-toggle-row .iexp-uiv-toggle')).toBeNull()
  })

  it('uses the actual V2 theme componentSet for cards and native controls in DilProgramView', async () => {
    const view = await mountProgram(softRelief)
    const nodes = componentSetNodes(view.host)
    expect(nodes.length).toBeGreaterThanOrEqual(8)
    expect(nodes.every(node => node.getAttribute('data-iexp-component-set') === 'soft-relief')).toBe(true)
    expect(view.host.querySelector('[data-dil-tag="card"]')?.classList.contains('iexp-uiv-card')).toBe(true)
    expect(view.host.querySelector('[data-dil-tag="button"]')?.classList.contains('iexp-uiv-button')).toBe(true)
    expect(view.host.querySelector('[data-dil-tag="input"]')?.classList.contains('iexp-uiv-input')).toBe(true)
    expect(view.host.querySelector('.iexp-dil-toggle-row .iexp-uiv-toggle')).not.toBeNull()
  })

  it('lets an explicit composition componentSet override the selected V2 theme without changing the DIL tree', async () => {
    const view = await mountProgram(softRelief, composition('native'))
    expect(componentSetNodes(view.host)).toHaveLength(0)
    expect(view.host.querySelector('[data-dil-tag="card"]')?.classList.contains('iexp-uiv-card')).toBe(false)
    expect(view.host.querySelector('[data-dil-tag="button"]')?.classList.contains('iexp-uiv-button')).toBe(false)
    expect(view.host.querySelector('[data-dil-tag="input"]')?.classList.contains('iexp-uiv-input')).toBe(false)
    expect(view.host.textContent).toContain('原始卡片')
  })
})
