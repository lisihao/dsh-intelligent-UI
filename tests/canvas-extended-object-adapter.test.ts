// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasExtendedObjectEffect } from '../src/canvas-extended-object-adapter.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

let resizeCallback: (() => void) | undefined

class ResizeStub {
  constructor(callback: () => void) { resizeCallback = callback }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  resizeCallback = undefined
  vi.stubGlobal('ResizeObserver', ResizeStub)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function canvas(): HTMLCanvasElement {
  const value = document.createElement('canvas')
  document.body.append(value)
  return value
}

function input(component: 'dithered-object' | 'particle-object' | 'liquid-object', factory: CanvasEffectFactory) {
  return {
    component,
    canvas: canvas(),
    asset: { sourceRef: 'data-source:object-1', objectUrl: 'blob:https://local.example/verified-object', kind: 'glb' as const, verified: true as const },
    factory,
    sourceRemainsVisible: true as const,
    onError: vi.fn(),
    acquireSlot: (activate: () => void) => { activate(); return vi.fn() },
  }
}

describe('extended Canvas UI object adapters', () => {
  it('passes a verified local object URL to the actual pinned factory and cleans it up', async () => {
    const destroy = vi.fn(), resize = vi.fn(), setOptions = vi.fn()
    let loaded: (() => void) | undefined
    const factory: CanvasEffectFactory = vi.fn((_elements, options) => {
      loaded = options?.onLoad as (() => void) | undefined
      return { destroy, resize, setOptions }
    })
    const value = input('particle-object', factory)
    const ready = vi.fn()
    const adapter = await createCanvasExtendedObjectEffect({ ...value, effectOptions: { count: 1200, orbit: false }, onReady: ready })
    expect(factory).toHaveBeenCalledWith({ canvas: value.canvas }, expect.objectContaining({
      src: value.asset.objectUrl,
      dracoDecoderPath: '',
      count: 1200,
      orbit: false,
    }))
    adapter.setOptions({ size: 3 })
    expect(setOptions).toHaveBeenCalledWith({ size: 3 })
    resizeCallback?.()
    expect(resize).toHaveBeenCalled()
    loaded?.()
    expect(ready).toHaveBeenCalledOnce()
    expect(adapter.getSnapshot()).toMatchObject({ component: 'particle-object', loaded: true, updates: 1, resizes: 1, destroyed: false })
    adapter.dispose()
    expect(adapter.getSnapshot()).toMatchObject({ destroyed: true })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects direct remote URLs and callback-shaped options before a factory sees them', async () => {
    const factory = vi.fn()
    const remote = input('dithered-object', factory)
    await expect(createCanvasExtendedObjectEffect({ ...remote, asset: { ...remote.asset, objectUrl: 'https://example.test/model.glb' } })).rejects.toThrow('CANVAS_OBJECT_URL_NOT_LOCAL_BLOB')
    const callback = input('liquid-object', factory)
    await expect(createCanvasExtendedObjectEffect({ ...callback, effectOptions: { onLoad: () => undefined } })).rejects.toThrow('CANVAS_OBJECT_OPTIONS_KEY')
    expect(factory).not.toHaveBeenCalled()
  })
})
