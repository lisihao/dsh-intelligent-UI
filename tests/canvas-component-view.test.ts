// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  html: vi.fn(),
  liquid: vi.fn(),
  object: vi.fn(),
  block: vi.fn(),
  glbSource: vi.fn(),
  safeAssetUrl: vi.fn(),
  read: vi.fn(),
  inspect: vi.fn(),
  raster: vi.fn(),
  acquireSlot: vi.fn(),
}))

vi.mock('../src/canvas-extended-adapter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/canvas-extended-adapter.js')>(),
  createCanvasExtendedHtmlEffect: mocks.html,
}))
vi.mock('../src/canvas-extended-isolated-liquid.js', () => ({ createCanvasExtendedLiquidEffect: mocks.liquid }))
vi.mock('../src/canvas-extended-object-adapter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/canvas-extended-object-adapter.js')>(),
  createCanvasExtendedObjectEffect: mocks.object,
}))
vi.mock('../src/adaptive-ui/canvas-block-view.js', () => ({
  CanvasBlockView: (props: { presentation: string, children?: ReactNode }) => { mocks.block(props); return h('div', { 'data-base-canvas-view': props.presentation }, props.children) },
}))
vi.mock('../src/canvas-object-view.js', () => ({
  glbSource: mocks.glbSource,
  safeAssetUrl: mocks.safeAssetUrl,
  readGlbResponse: mocks.read,
  inspectGlb: mocks.inspect,
  isSafeRaster: mocks.raster,
}))
vi.mock('../src/canvas-runtime-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/canvas-runtime-client.js')>(),
  acquireCanvasSlot: mocks.acquireSlot,
}))

import { CanvasRuntimeContext } from '../src/canvas-runtime-context.js'
import { CanvasComponentView, resolveCanvasVerifiedObjectAsset } from '../src/adaptive-ui/canvas-component-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(next => { resolve = next }), resolve }
}

async function mount(node: ReturnType<typeof h>, load = vi.fn(async () => vi.fn(() => ({ destroy: vi.fn() })))) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(CanvasRuntimeContext.Provider, { value: load }, node))
    await Promise.resolve(); await Promise.resolve()
  })
  return { host, load }
}

beforeEach(() => {
  mocks.html.mockResolvedValue({ dispose: vi.fn() })
  mocks.liquid.mockResolvedValue({ destroy: vi.fn() })
  mocks.object.mockResolvedValue({ dispose: vi.fn() })
  mocks.glbSource.mockReturnValue({ field: 'url', reference: 'https://assets.example/model.glb' })
  mocks.safeAssetUrl.mockReturnValue('https://assets.example/model.glb')
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]))
  mocks.inspect.mockReturnValue({ ok: true })
  mocks.raster.mockReturnValue(true)
  mocks.acquireSlot.mockImplementation((activate: () => void) => { activate(); return vi.fn() })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:https://dsh.invalid/verified'), revokeObjectURL: vi.fn() })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove(); root = undefined; host = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals(); vi.clearAllMocks()
})

describe('CanvasComponentView', () => {
  it('mounts the fixed extended HTML adapter beside the retained actual source', async () => {
    const source = 'Actual source paragraph.\n\nAnother actual paragraph.'
    const { host: mounted, load } = await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:bubble', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'bubble', source } },
      value: source,
    }, h('p', null, 'Actual readable source')))
    expect(load).toHaveBeenCalledWith('bubble')
    expect(mocks.html).toHaveBeenCalledWith(expect.objectContaining({ component: 'bubble', scope: 'visual-only', sourceRemainsVisible: true }))
    const options = mocks.html.mock.calls[0]![0] as { host: HTMLElement, content: HTMLElement }
    expect(options.host).not.toBe(options.content)
    expect(mounted.textContent).toContain('Actual readable source')
  })

  it('uses the fixed opaque Liquid consumer instead of a model factory or URL', async () => {
    const source = 'Actual source paragraph.\n\nAnother actual paragraph.'
    await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:liquid', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'liquid', source } },
      value: source,
    }, h('p', null, 'Retained source')))
    expect(mocks.liquid).toHaveBeenCalledOnce()
    const options = mocks.liquid.mock.calls[0]![0] as { host: HTMLElement, content: HTMLElement }
    expect(options.host).not.toBe(options.content)
  })

  it('routes standard components to the existing source-preserving CanvasBlockView', async () => {
    const source = 'Actual source paragraph.\n\nAnother actual paragraph.'
    await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:ripple', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'ripple', source } },
      value: source,
    }, h('p', null, 'Retained source')))
    expect(mocks.block).toHaveBeenCalledWith(expect.objectContaining({ presentation: 'canvas-ripple', value: source }))
  })

  it('passes the actual value out of the Host source-block envelope to the native Canvas consumer', async () => {
    const source = 'Actual source paragraph.\n\nAnother actual paragraph.'
    const envelope = { id: 'block-4', reference: { id: 'block-4', path: [0], kind: 'paragraph' }, value: source, recipes: [] }
    await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:ripple', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'ripple', source } },
      value: envelope,
    }, h('p', null, 'Retained source')))
    expect(mocks.block).toHaveBeenCalledWith(expect.objectContaining({ presentation: 'canvas-ripple', value: source }))
  })

  it('verifies the actual current object source before an extended object adapter receives a local blob', async () => {
    const input = { kind: 'canvas-object-ref' as const, component: 'particle-object' as const, sourceRef: 'https://assets.example/model.glb', assetKind: 'glb' as const }
    const asset = await resolveCanvasVerifiedObjectAsset(input, { url: 'https://assets.example/model.glb', type: 'glb' }, new AbortController().signal)
    expect(mocks.safeAssetUrl).toHaveBeenCalledWith('https://assets.example/model.glb', undefined)
    expect(mocks.read).toHaveBeenCalled()
    expect(mocks.inspect).toHaveBeenCalled()
    expect(asset).toEqual({ sourceRef: input.sourceRef, objectUrl: 'blob:https://dsh.invalid/verified', assetKind: 'glb', verifiedByHost: true })

    await expect(resolveCanvasVerifiedObjectAsset({ ...input, sourceRef: 'blob:https://dsh.invalid/forged' }, { url: 'https://assets.example/model.glb', type: 'glb' }, new AbortController().signal)).rejects.toThrow('CANVAS_COMPONENT_OBJECT_SOURCE_MISMATCH')
    expect(mocks.safeAssetUrl).toHaveBeenCalledTimes(1)
  })

  it('mounts an extended object factory only after the Host resolver produced a verified local blob', async () => {
    const input = { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: 'https://assets.example/model.glb', assetKind: 'glb' }
    const { host: mounted, load } = await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:particle-object', rendererKey: 'canvas-component', input },
      value: { url: input.sourceRef, type: 'glb' },
    }, h('p', null, 'Retained object source')))
    expect(load).toHaveBeenCalledWith('particle-object')
    expect(mocks.object).toHaveBeenCalledWith(expect.objectContaining({
      component: 'particle-object',
      sourceRemainsVisible: true,
      asset: { sourceRef: input.sourceRef, objectUrl: 'blob:https://dsh.invalid/verified', kind: 'glb', verified: true },
    }))
    expect(mounted.textContent).toContain('Retained object source')
  })

  it('destroys a synchronously failed core object instance and releases its slot after the factory returns', async () => {
    const destroy = vi.fn(), release = vi.fn()
    mocks.acquireSlot.mockImplementation((activate: () => void) => { activate(); return release })
    const factory = vi.fn((_elements: unknown, options: { onError?: (error: Error) => void }) => {
      options.onError?.(new Error('synchronous upstream failure'))
      return { destroy }
    })
    const input = { kind: 'canvas-object-ref', component: 'ink-object', sourceRef: 'https://assets.example/model.glb', assetKind: 'glb' }
    const { host: mounted } = await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:ink-object', rendererKey: 'canvas-component', input },
      value: { url: input.sourceRef, type: 'glb' },
    }, h('p', null, 'Retained source survives failure')), vi.fn(async () => factory))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(destroy).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    expect(mounted.textContent).toContain('Retained source survives failure')
    expect(mounted.querySelector('[data-canvas-component-error]')?.textContent).toContain('synchronous upstream failure')
  })

  it('disposes a late extended HTML adapter after unmount instead of retaining it', async () => {
    const late = deferred<{ dispose(): void }>(), dispose = vi.fn()
    mocks.html.mockReturnValue(late.promise)
    const source = 'Actual source paragraph.\n\nAnother actual paragraph.'
    await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:bubble', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'bubble', source } },
      value: source,
    }, h('p', null, 'Retained source')))
    expect(mocks.html).toHaveBeenCalledOnce()
    await act(async () => root?.unmount())
    late.resolve({ dispose })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disposes a late extended object adapter and revokes its already-created blob after unmount', async () => {
    const late = deferred<{ dispose(): void }>(), dispose = vi.fn()
    mocks.object.mockReturnValue(late.promise)
    const input = { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: 'https://assets.example/model.glb', assetKind: 'glb' }
    await mount(h(CanvasComponentView, {
      selection: { id: 'canvas:particle-object', rendererKey: 'canvas-component', input },
      value: { url: input.sourceRef, type: 'glb' },
    }, h('p', null, 'Retained object source')))
    await vi.waitFor(() => expect(mocks.object).toHaveBeenCalledOnce())
    await act(async () => root?.unmount())
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    late.resolve({ dispose })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(dispose).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })

  it('rejects a model self-certified blob field before it can trigger a fetch or factory', async () => {
    const { host: mounted } = await mount(h(CanvasComponentView, {
      selection: {
        id: 'canvas:particle-object', rendererKey: 'canvas-component',
        input: { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: 'https://assets.example/model.glb', assetKind: 'glb', verified: true, objectUrl: 'blob:https://dsh.invalid/forged' },
      },
      value: { url: 'https://assets.example/model.glb', type: 'glb' },
    }, h('p', null, 'Retained source')))
    expect(mounted.querySelector('[data-canvas-component-status="blocked"]')?.textContent).toContain('CANVAS_COMPONENT_INPUT_INVALID')
    expect(mocks.object).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
