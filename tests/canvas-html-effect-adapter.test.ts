// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return { ...original, readCanvasHtmlTextureSource: vi.fn(() => ({})) }
})

import { CanvasHtmlTextureError, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'
import { createCanvasHtmlEffectAdapter, type CanvasHtmlEffectName } from '../src/canvas-html-effect-adapter.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

type Paint = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type Ctx = { drawImage: ReturnType<typeof vi.fn>, drawElementImage?: (element: Element, x: number, y: number) => void }
const contexts = new WeakMap<HTMLCanvasElement, Ctx>()
const gl = { clearColor: vi.fn(), clear: vi.fn(), isContextLost: () => false, getExtension: () => null, COLOR_BUFFER_BIT: 16384 }
let intersectionCallback: ((entries: IntersectionObserverEntry[]) => void) | undefined
let resizeCallback: (() => void) | undefined
let frameCallback: FrameRequestCallback | undefined
const disconnectIO = vi.fn(), disconnectRO = vi.fn(), cancelRAF = vi.fn()
class IntersectionStub {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) { intersectionCallback = callback }
  observe() {}
  disconnect() { disconnectIO() }
}
class ResizeStub {
  constructor(callback: () => void) { resizeCallback = callback }
  observe() {}
  disconnect() { disconnectRO() }
}
function rect(x: number, y: number, width = 400, height = 240) {
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect
}
function setSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperties(element, { clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height } })
}
function fixture(component: CanvasHtmlEffectName = 'ripple') {
  const content = document.createElement('div'), host = document.createElement('div')
  content.textContent = 'Original source'
  document.body.append(content, host)
  content.getBoundingClientRect = () => rect(0, 0)
  host.getBoundingClientRect = () => rect(440, 0)
  setSize(content, 400, 240); setSize(host, 400, 240)
  let textureOptions: CanvasHtmlTextureOptions | undefined
  const textureDispose = vi.fn()
  const textureRefresh = vi.fn(async () => { (textureOptions?.source as Paint).onpaint?.() })
  const createTexture = vi.fn<(options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge>((options) => {
    textureOptions = options
    const ctx = options.source.getContext('2d') as unknown as Ctx
    ctx.drawElementImage = vi.fn()
    return { refresh: textureRefresh, dispose: textureDispose }
  })
  const destroy = vi.fn(), resize = vi.fn(), setOptions = vi.fn(), splash = vi.fn(), melt = vi.fn(), burst = vi.fn()
  const factory: CanvasEffectFactory = vi.fn(elements => {
    const source = elements.source as Paint, proxy = elements.content as HTMLElement
    source.onpaint = () => (source.getContext('2d') as unknown as Ctx).drawElementImage?.(proxy, 0, 0)
    source.requestPaint?.()
    return { destroy, resize, setOptions, splash, melt, burst } as unknown as ReturnType<CanvasEffectFactory>
  })
  const release = vi.fn()
  const acquireSlot = vi.fn((activate: () => void) => { activate(); return release })
  const onError = vi.fn()
  const create = (signal?: AbortSignal) => createCanvasHtmlEffectAdapter({ component, content, host, factory, onError, signal, pointer: true, scope: 'visual-only', sourceRemainsVisible: true, createTextureBridge: createTexture, acquireSlot })
  const visible = (yes: boolean) => intersectionCallback?.([host, content].map(target => ({ target, isIntersecting: yes, intersectionRect: rect(0, 0, yes ? 400 : 0, yes ? 240 : 0) } as unknown as IntersectionObserverEntry)))
  return { content, host, create, visible, factory, destroy, resize, setOptions, splash, melt, burst, release, acquireSlot, createTexture, textureDispose, textureRefresh, onError,
    get textureOptions() { return textureOptions! } }
}

beforeEach(() => {
  intersectionCallback = undefined; resizeCallback = undefined; frameCallback = undefined
  disconnectIO.mockClear(); disconnectRO.mockClear(); cancelRAF.mockClear()
  vi.stubGlobal('IntersectionObserver', IntersectionStub)
  vi.stubGlobal('ResizeObserver', ResizeStub)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frameCallback = callback; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancelRAF)
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false } as MediaQueryList))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.getBoundingClientRect() ?? rect(0, 0)
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') return gl as unknown as WebGL2RenderingContext
    if (!contexts.has(this)) contexts.set(this, { drawImage: vi.fn() })
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('visual-only single-source Canvas effects', () => {
  it.each(['grid', 'displacement', 'glitch'] as const)('keeps the source separate and disposes the %s visual', async component => {
    const f = fixture(component), before = f.content.outerHTML, pending = f.create()
    f.visible(true)
    const effect = await pending
    expect(f.content.outerHTML).toBe(before)
    expect(vi.mocked(f.factory).mock.calls[0]![0].content).not.toBe(f.content)
    if (component === 'glitch') { effect.burst(); expect(f.burst).toHaveBeenCalledOnce() }
    effect.dispose(); effect.dispose()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    expect(f.content.outerHTML).toBe(before)
  })
  it('starts only in view, keeps the source untouched and disposes exactly once', async () => {
    const f = fixture()
    const before = f.content.outerHTML
    const pending = f.create()
    expect(f.factory).not.toHaveBeenCalled()
    f.visible(true)
    const effect = await pending
    expect(f.content.outerHTML).toBe(before)
    expect(f.factory).toHaveBeenCalledOnce()
    const elements = vi.mocked(f.factory).mock.calls[0]![0]
    expect(elements.content).not.toBe(f.content)
    expect((elements.source as Element).contains(elements.content as Node)).toBe(true)
    expect(f.host.querySelector('[aria-hidden="true"]')).toBeTruthy()
    effect.splash(40, 50, 0.8)
    expect(f.splash).toHaveBeenCalledWith(40, 50, 0.8)
    effect.dispose(); effect.dispose()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    expect(f.content.outerHTML).toBe(before)
  })

  it('releases the slot and effect offscreen, then recreates them with the latest options', async () => {
    const f = fixture('frost'), pending = f.create()
    f.visible(true)
    const effect = await pending
    f.visible(false)
    expect(f.destroy).toHaveBeenCalledTimes(1)
    expect(f.textureDispose).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(1)
    effect.setOptions({ opacity: 0.3 })
    f.visible(true)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledTimes(2))
    expect(vi.mocked(f.factory).mock.calls[1]![1]).toMatchObject({ opacity: 0.3 })
    effect.melt(0.3, 0.6); effect.melt(1.1, 0.6)
    expect(f.melt).toHaveBeenCalledOnce()
    expect(f.melt).toHaveBeenCalledWith(0.3, 0.6)
    effect.dispose()
    expect(f.release).toHaveBeenCalledTimes(2)
  })

  it('holds the GPU ticket until an in-flight texture has released its quota', async () => {
    const f = fixture()
    let drain!: () => void
    const drained = new Promise<void>(resolve => { drain = resolve })
    const original = f.createTexture.getMockImplementation()!
    f.createTexture.mockImplementationOnce(options => ({ ...original(options), whenDisposed: () => drained }))
    const pending = f.create()
    f.visible(true)
    const effect = await pending
    f.visible(false)
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.release).not.toHaveBeenCalled()
    drain(); await drained; await Promise.resolve()
    expect(f.release).toHaveBeenCalledOnce()
    effect.dispose()
  })

  it('cancels before entering the viewport without using a GPU slot', async () => {
    const f = fixture(), controller = new AbortController()
    const pending = f.create(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'disposed' })
    expect(f.acquireSlot).not.toHaveBeenCalled()
    expect(f.host.children).toHaveLength(0)
    expect(f.content.textContent).toBe('Original source')
  })

  it('stops before disposing the bridge on reduced motion', async () => {
    const f = fixture(), pending = f.create()
    f.visible(true)
    const effect = await pending
    f.textureOptions.onError(new CanvasHtmlTextureError('reduced-motion', 'Motion reduced'))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.destroy.mock.invocationCallOrder[0]).toBeLessThan(f.textureDispose.mock.invocationCallOrder[0]!)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'reduced-motion' }))
    effect.dispose()
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('stops and reports when movement would cover the original', async () => {
    const f = fixture(), pending = f.create()
    f.visible(true)
    const effect = await pending
    f.host.getBoundingClientRect = () => rect(0, 0)
    frameCallback?.(0)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    effect.dispose()
  })

  it('stops if the stage or its actual canvas is moved outside the host', async () => {
    for (const selector of ['div', 'canvas']) {
      const f = fixture(), pending = f.create()
      f.visible(true)
      const effect = await pending
      const visual = f.host.querySelector(selector) as HTMLElement
      visual.getBoundingClientRect = () => rect(0, 0)
      frameCallback?.(0)
      expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsafe-content' }))
      expect(f.host.children).toHaveLength(0)
      effect.dispose(); f.host.remove(); f.content.remove()
    }
  })

  it('removes private canvases when creating a canvas context throws', async () => {
    const f = fixture()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('context error') })
    const pending = f.create()
    f.visible(true)
    await expect(pending).rejects.toMatchObject({ code: 'capture' })
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('rejects refresh if its source and visual region start overlapping during capture', async () => {
    const f = fixture(), pending = f.create()
    f.visible(true)
    const effect = await pending
    f.host.getBoundingClientRect = () => rect(0, 0)
    await expect(effect.refresh()).rejects.toMatchObject({ code: 'unsafe-content' })
    expect(f.onError).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    effect.dispose()
  })

  it('times out a queued GPU slot and releases its waiting ticket', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.acquireSlot.mockImplementation(() => f.release)
    const pending = f.create()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'busy' })
    f.visible(true)
    await vi.advanceTimersByTimeAsync(15_001)
    await rejected
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.factory).not.toHaveBeenCalled()
    expect(f.host.children).toHaveLength(0)
    vi.useRealTimers()
  })

  it('rejects and cleans when the verified upstream factory cannot start', async () => {
    const f = fixture()
    vi.mocked(f.factory).mockReturnValue(null)
    const pending = f.create()
    f.visible(true)
    await expect(pending).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
  })

  it('ignores a late capture after leaving view and starts a fresh runtime on return', async () => {
    const f = fixture()
    let rejectOld!: (error: Error) => void
    f.createTexture.mockImplementationOnce(() => ({
      refresh: () => new Promise<void>((_resolve, reject) => { rejectOld = reject }),
      dispose: () => { rejectOld(new Error('cancelled capture')) },
    }))
    const pending = f.create()
    f.visible(true)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce())
    f.visible(false)
    f.visible(true)
    const effect = await pending
    expect(f.factory).toHaveBeenCalledTimes(2)
    expect(f.onError).not.toHaveBeenCalled()
    effect.dispose()
    expect(f.release).toHaveBeenCalledTimes(2)
  })

  it('times out a hung initial capture and releases every owned resource', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.createTexture.mockImplementation(() => ({ refresh: () => new Promise<void>(() => {}), dispose: f.textureDispose }))
    const pending = f.create()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('too long') })
    f.visible(true)
    await vi.advanceTimersByTimeAsync(10_001)
    await rejected
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    vi.useRealTimers()
  })

})
