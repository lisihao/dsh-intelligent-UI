// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridgeMocks = vi.hoisted(() => ({
  tuff: [] as Array<{ selection: unknown, hasPort: boolean }>,
  uiverse: [] as Array<{ selection: unknown, hasPort: boolean }>,
  canvas: [] as Array<{ selection: unknown, value: unknown }>,
  bindCanvas: vi.fn(),
}))

vi.mock('../src/tuffui/view.js', async () => {
  const React = await import('react')
  const TuffUiHostActionPortContext = React.createContext<((event: unknown) => void) | undefined>(undefined)
  function TuffUiBlockView({ selection, children }: { selection: unknown, children?: ReactNode }) {
    const port = React.useContext(TuffUiHostActionPortContext)
    const parsed = selection as { readonly actionIds?: readonly string[], readonly input?: { readonly componentId?: string, readonly mountId?: string } }
    bridgeMocks.tuff.push({ selection, hasPort: port !== undefined })
    return React.createElement('button', {
      type: 'button',
      'data-test-tuff': parsed.input?.componentId ?? 'unknown',
      onClick: () => {
        const actionId = parsed.actionIds?.[0]
        if (actionId !== undefined) port?.({ componentId: parsed.input?.componentId, mountId: parsed.input?.mountId, actionId, payload: { value: 'source DOM choice' } })
      },
    }, children)
  }
  return { TuffUiBlockView, TuffUiHostActionPortContext }
})

vi.mock('../src/uiverse/runtime-view.js', async () => {
  const React = await import('react')
  const UiverseHostEventPortContext = React.createContext<((event: unknown) => void) | undefined>(undefined)
  function UiverseBlockView({ selection, children }: { selection: unknown, children?: ReactNode }) {
    const port = React.useContext(UiverseHostEventPortContext)
    const parsed = selection as { readonly input?: { readonly componentId?: string } }
    bridgeMocks.uiverse.push({ selection, hasPort: port !== undefined })
    return React.createElement('button', {
      type: 'button',
      'data-test-uiverse': parsed.input?.componentId ?? 'unknown',
      onClick: () => port?.({ kind: 'field', componentId: parsed.input?.componentId, targetId: 'fixed-field', fieldId: 'fixed-field', value: 'source DOM edit' }),
    }, children)
  }
  return { UiverseBlockView, UiverseHostEventPortContext }
})

vi.mock('../src/adaptive-ui/canvas-component-bindings.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/adaptive-ui/canvas-component-bindings.js')>(),
  bindCanvasComponentSource: bridgeMocks.bindCanvas,
}))

vi.mock('../src/adaptive-ui/canvas-component-view.js', async () => {
  const React = await import('react')
  function CanvasComponentView({ selection, value, children }: { selection: unknown, value: unknown, children?: ReactNode }) {
    bridgeMocks.canvas.push({ selection, value })
    const id = (selection as { readonly id?: string }).id ?? 'unknown'
    return React.createElement('section', { 'data-test-canvas': id }, children)
  }
  return { CanvasComponentView }
})

import { DilLibraryComponent, createDilLibraryRenderer } from '../src/dil/library-view.js'
import { DIL_LIBRARY_COMPONENT_INPUT_SCHEMAS, getDilLibraryComponentInputSchema } from '../src/dil/library-contracts.js'
import { CANVAS_COMPONENT_IDS } from '../src/adaptive-ui/canvas-component-bindings.js'
import type { DilJson } from '../src/dil/protocol.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom intentionally has no Canvas implementation. A null WebGL probe is
// the same retained-source fallback result as an unavailable browser GPU.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)

type LibraryProps = Readonly<{
  id: string
  input: DilJson
  onEvent?: (event: DilJson) => void
  renderMarkdown?: (source: string) => ReactNode
}>

let mounted: Array<{ root: Root, host: HTMLDivElement }> = []

async function mount(props: LibraryProps) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = async (next: LibraryProps): Promise<void> => {
    await act(async () => { root.render(h(DilLibraryComponent, next)) })
  }
  await render(props)
  const item = { root, host }
  mounted.push(item)
  return { ...item, rerender: render }
}

function tuffSelection(index = 0): { readonly id: string, readonly actionIds: readonly string[], readonly input: { readonly protocolVersion: number, readonly mountId: string, readonly componentId: string, readonly binding: { readonly exportName: string, readonly props: Record<string, unknown> } } } {
  return bridgeMocks.tuff[index]!.selection as ReturnType<typeof tuffSelection>
}
function uiverseSelection(index = 0): { readonly id: string, readonly input: { readonly componentId: string, readonly values: Record<string, unknown> } } {
  return bridgeMocks.uiverse[index]!.selection as ReturnType<typeof uiverseSelection>
}

afterEach(async () => {
  for (const item of mounted.splice(0)) await act(async () => item.root.unmount())
  document.body.replaceChildren()
  bridgeMocks.tuff.splice(0)
  bridgeMocks.uiverse.splice(0)
  bridgeMocks.canvas.splice(0)
  bridgeMocks.bindCanvas.mockReset()
  vi.unstubAllGlobals()
})

describe('DIL external library bridge', () => {
  it('returns JSON-only input contracts for all four built-ins and fifteen curated components without Host mount fields', () => {
    expect(Object.keys(DIL_LIBRARY_COMPONENT_INPUT_SCHEMAS)).toHaveLength(19)
    expect(getDilLibraryComponentInputSchema('component:liveline')).toMatchObject({ library: 'liveline' })
    expect(getDilLibraryComponentInputSchema('uiverse:clear-glass:card')).toMatchObject({ library: 'uiverse-curated' })
    expect(getDilLibraryComponentInputSchema('tuffui:data-table')).toMatchObject({ library: 'tuffui' })
    expect(getDilLibraryComponentInputSchema('uiverse:Cards/demo-card')).toMatchObject({ library: 'uiverse' })
    expect(getDilLibraryComponentInputSchema('canvas:liquid')).toBeUndefined()
    expect(JSON.stringify(getDilLibraryComponentInputSchema('tuffui:data-table'))).not.toContain('mountId')
    expect(JSON.stringify(getDilLibraryComponentInputSchema('tuffui:data-table'))).not.toContain('nonce')
  })

  it('wraps a real Tuff binding with a Host-generated stable mount id and emits only after a DOM event', async () => {
    const onEvent = vi.fn()
    const props: LibraryProps = {
      id: 'tuffui:data-table',
      input: { exportName: 'VisualOnly', props: {}, actions: [{ prop: 'onSelect', actionId: 'select-source-row' }] },
      onEvent,
    }
    const view = await mount(props)
    expect(bridgeMocks.tuff).toHaveLength(1)
    const first = tuffSelection()
    expect(first).toMatchObject({
      id: 'tuffui:data-table', actionIds: ['select-source-row'],
      input: { protocolVersion: 1, componentId: 'data-table', binding: { exportName: 'VisualOnly', props: {} } },
    })
    expect(first.input.mountId).toMatch(/^dil-tuff-/u)
    expect(onEvent).not.toHaveBeenCalled()
    await view.rerender(props)
    expect(tuffSelection(1).input.mountId).toBe(first.input.mountId)
    await act(async () => view.host.querySelector<HTMLButtonElement>('[data-test-tuff="data-table"]')!.click())
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenLastCalledWith({ library: 'tuffui', componentId: 'data-table', mountId: first.input.mountId, actionId: 'select-source-row', payload: { value: 'source DOM choice' } })
  })

  it('does not mount a Tuff action binding without the explicit local DIL event port', async () => {
    const view = await mount({ id: 'tuffui:data-table', input: { exportName: 'VisualOnly', props: {}, actions: [{ prop: 'onSelect', actionId: 'select-source-row' }] } })
    expect(view.host.querySelector('[data-dil-library-failure="DIL_TUFF_EVENT_PORT_REQUIRED"]')).not.toBeNull()
    expect(bridgeMocks.tuff).toHaveLength(0)
  })

  it('passes opaque Uiverse source slots unchanged and projects Markdown through the caller renderer', async () => {
    const renderMarkdown = vi.fn((source: string): ReactNode => h('article', { 'data-test-markdown': true }, h('code', null, 'const total = 3'), h('span', { 'data-test-math': true }, source)))
    const markdown = '## 原始结论\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const view = await mount({
      id: 'uiverse:Cards/demo-card',
      input: { values: { mode: 'read-only', projectedTextIds: ['fragment/article[0]#text[0]'] }, content: markdown },
      renderMarkdown,
    })
    expect(uiverseSelection()).toMatchObject({ id: 'uiverse:Cards/demo-card', input: { componentId: 'Cards/demo-card', values: { mode: 'read-only', projectedTextIds: ['fragment/article[0]#text[0]'] } } })
    expect(renderMarkdown).toHaveBeenCalledWith(markdown)
    expect(view.host.querySelector('[data-test-markdown] code')?.textContent).toBe('const total = 3')
    expect(view.host.querySelector('[data-test-math]')?.textContent).toContain('$E=mc^2$')
  })

  it('turns an opaque Uiverse source event into a local DIL event only after a DOM interaction', async () => {
    const onEvent = vi.fn()
    const view = await mount({
      id: 'uiverse:Forms/source-editor',
      input: { values: { mode: 'interactive', fields: { 'fixed-field': { value: 'before' } } } },
      onEvent,
    })
    expect(bridgeMocks.uiverse[0]?.hasPort).toBe(true)
    expect(onEvent).not.toHaveBeenCalled()
    await act(async () => view.host.querySelector<HTMLButtonElement>('[data-test-uiverse="Forms/source-editor"]')!.click())
    expect(onEvent).toHaveBeenCalledWith({ library: 'uiverse', kind: 'field', componentId: 'Forms/source-editor', targetId: 'fixed-field', fieldId: 'fixed-field', value: 'source DOM edit' })
  })

  it('rejects an interactive Uiverse binding when no local DIL event port exists', async () => {
    const view = await mount({ id: 'uiverse:Forms/source-editor', input: { values: { mode: 'interactive', fields: { 'fixed-field': { value: 'before' } } } } })
    expect(view.host.querySelector('[data-dil-library-failure="DIL_UIVERSE_EVENT_PORT_REQUIRED"]')).not.toBeNull()
    expect(bridgeMocks.uiverse).toHaveLength(0)
  })

  it('renders a curated native toggle from actual source props and emits only its real change', async () => {
    const onEvent = vi.fn()
    const view = await mount({ id: 'uiverse:soft-relief:toggle', input: { props: { name: 'notifications', checked: false }, label: '接收通知' }, onEvent })
    const control = view.host.querySelector<HTMLInputElement>('input[name="notifications"]')
    expect(control).not.toBeNull()
    expect(control?.checked).toBe(false)
    expect(onEvent).not.toHaveBeenCalled()
    await act(async () => control!.click())
    expect(onEvent).toHaveBeenCalledWith({ library: 'uiverse-curated', componentId: 'uiverse:soft-relief:toggle', role: 'toggle', value: true })
  })

  it('keeps a disabled curated control source-bound without inventing an event authority', async () => {
    const view = await mount({ id: 'uiverse:mechanical-outline:button', input: { props: { disabled: true }, label: '来源禁用操作' } })
    const button = view.host.querySelector<HTMLButtonElement>('button')
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)
    expect(view.host.querySelector('[data-dil-library-failure]')).toBeNull()
  })

  it('renders a Torph short source value and preserves a historical chart source table', async () => {
    const textView = await mount({ id: 'component:torph', input: { text: '42 位活跃用户' } })
    expect(textView.host.textContent).toContain('42 位活跃用户')
    const chartView = await mount({
      id: 'component:visx-historical',
      input: { plan: { kind: 'line', labels: ['2026-01', '2026-02'], series: [{ name: '实际吞吐', values: [10, 12], originals: ['10', '12'], unit: 'req/s' }], reason: '来源表包含连续月份与同一单位。', icon: 'trending-up' } },
    })
    expect(chartView.host.querySelector('[data-dil-library-source-table]')).not.toBeNull()
    expect(chartView.host.textContent).toContain('2026-02')
    expect(chartView.host.textContent).toContain('12')
  })

  it('uses the shared strict validators for all four built-in library renderers', async () => {
    const skullet = await mount({ id: 'component:skullet', input: { loading: false } })
    expect(skullet.host.querySelector('[data-dil-library-failure]')).not.toBeNull()
    const torph = await mount({ id: 'component:torph', input: { text: '```ts\nconst unsafe = true\n```' } })
    expect(torph.host.querySelector('[data-dil-library-failure]')).not.toBeNull()
    const live = await mount({
      id: 'component:liveline',
      input: { type: 'live-series', source: 'actual feed', unit: 'ms', timeUnit: 'seconds', points: [{ time: 2, value: 20 }, { time: 1, value: 10 }] },
    })
    expect(live.host.querySelector('[data-dil-library-failure]')).not.toBeNull()
    const historical = await mount({
      id: 'component:visx-historical',
      input: { plan: { kind: 'line', labels: ['Jan'], series: [{ name: 'actual', values: [1, 2], unit: 'ms' }], reason: 'actual source', icon: 'trending-up' } },
    })
    expect(historical.host.querySelector('[data-dil-library-failure]')).not.toBeNull()
  })

  it('shows a named, source-preserving failure for an unknown or non-JSON external binding', async () => {
    const unknown = await mount({ id: 'component:not-pinned', input: { original: '保留的来源' } })
    expect(unknown.host.querySelector('[data-dil-library-failure]')?.textContent).toContain('DIL_TREE_COMPONENT_INVALID')
    expect(unknown.host.textContent).toContain('保留的来源')
    const nonJson = await mount({ id: 'component:torph', input: (() => 'not JSON') as unknown as DilJson })
    expect(nonJson.host.querySelector('[data-dil-library-failure]')?.textContent).toContain('DIL_TREE_COMPONENT_INPUT_INVALID')
  })

  it('returns a stable renderer callback for the same trusted Markdown renderer', () => {
    const markdown = (source: string): ReactNode => h('article', null, source)
    expect(createDilLibraryRenderer(markdown)).toBe(createDilLibraryRenderer(markdown))
  })

  it('routes source-bound Canvas text through the actual Canvas consumer and keeps semantic Markdown visible', async () => {
    const source = '实际来源段落。\n\n第二段仍保留。'
    const renderMarkdown = vi.fn((value: string): ReactNode => h('article', { 'data-test-canvas-markdown': true }, value))
    bridgeMocks.bindCanvas.mockReturnValue({ eligible: true, input: { kind: 'canvas-html', component: 'bubble', source }, reasons: ['source:retained-visible-noninteractive-texture'] })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const view = await mount({ id: 'canvas:bubble', input: { source }, renderMarkdown })
    expect(bridgeMocks.bindCanvas).toHaveBeenCalledWith('canvas:bubble', source, expect.objectContaining({ reducedMotion: false }), false)
    expect(bridgeMocks.canvas).toHaveLength(1)
    expect(bridgeMocks.canvas[0]).toMatchObject({
      selection: { id: 'canvas:bubble', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'bubble', source } },
      value: source,
    })
    expect(renderMarkdown).toHaveBeenCalledWith(source)
    expect(view.host.querySelector('[data-test-canvas-markdown]')?.textContent).toBe(source)
  })

  it('keeps paired and object Canvas sources intact while only the Host binder derives internal input', async () => {
    const pair = { kind: 'canvas-html-pair', primary: '第一份实际来源。', alternate: '第二份实际来源。' }
    const object = { url: 'https://assets.example/actual.glb', type: 'glb', mime: 'model/gltf-binary', role: 'source-asset' }
    bridgeMocks.bindCanvas
      .mockReturnValueOnce({ eligible: true, input: { kind: 'canvas-html-pair', component: 'ascii-sweep', primary: pair.primary, alternate: pair.alternate }, reasons: ['source:two-retained-visible-text-panels'] })
      .mockReturnValueOnce({ eligible: true, input: { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: object.url, assetKind: 'glb' }, reasons: ['source:consumer-must-verify-local-blob'] })
    const markdown = vi.fn((value: string): ReactNode => h('article', { 'data-test-canvas-pair': true }, value))
    await mount({ id: 'canvas:ascii-sweep', input: { source: pair }, renderMarkdown: markdown })
    await mount({ id: 'canvas:particle-object', input: { source: object } })
    expect(bridgeMocks.canvas[0]).toMatchObject({ selection: { id: 'canvas:ascii-sweep', input: { kind: 'canvas-html-pair', primary: pair.primary, alternate: pair.alternate } }, value: pair })
    expect(bridgeMocks.canvas[1]).toMatchObject({ selection: { id: 'canvas:particle-object', input: { kind: 'canvas-object-ref', sourceRef: object.url, assetKind: 'glb' } }, value: object })
    expect(JSON.stringify((bridgeMocks.canvas[1]!.selection as { input: unknown }).input)).not.toContain('verified')
    expect(JSON.stringify((bridgeMocks.canvas[1]!.selection as { input: unknown }).input)).not.toContain('objectUrl')
    expect(markdown).toHaveBeenCalledWith(pair.primary)
  })

  it('allows every fixed Canvas catalog ID to enter the same source binder and no Canvas event authority', async () => {
    const source = '同一份实际、非交互来源。\n\n第二段。'
    bridgeMocks.bindCanvas.mockImplementation((id: string) => ({ eligible: true, input: { kind: 'canvas-html', component: id.slice('canvas:'.length), source }, reasons: [] }))
    for (const id of CANVAS_COMPONENT_IDS) await mount({ id, input: { source } })
    expect(CANVAS_COMPONENT_IDS).toHaveLength(35)
    expect(bridgeMocks.bindCanvas).toHaveBeenCalledTimes(35)
    expect(bridgeMocks.canvas.map(item => (item.selection as { id: string }).id).sort()).toEqual([...CANVAS_COMPONENT_IDS].sort())

    const event = vi.fn()
    const rejected = await mount({ id: 'canvas:bubble', input: { source }, onEvent: event })
    expect(rejected.host.querySelector('[data-dil-library-failure="DIL_CANVAS_EVENT_UNSUPPORTED"]')).not.toBeNull()
    expect(event).not.toHaveBeenCalled()
  })

  it('rejects Canvas data that is not exactly an actual source binding and preserves it visibly', async () => {
    const source = { url: 'https://assets.example/actual.glb', type: 'glb' }
    const extra = await mount({ id: 'canvas:particle-object', input: { source, verified: true } })
    expect(extra.host.querySelector('[data-dil-library-failure="DIL_CANVAS_INPUT_INVALID"]')).not.toBeNull()
    expect(extra.host.textContent).toContain('actual.glb')
    bridgeMocks.bindCanvas.mockReturnValue({ eligible: false, reasons: ['capability:webgl-required'] })
    const unavailable = await mount({ id: 'canvas:bubble', input: { source: '保留来源。' } })
    expect(unavailable.host.querySelector('[data-dil-library-failure]')?.textContent).toContain('DIL_CANVAS_SOURCE_INELIGIBLE:capability:webgl-required')
  })
})
