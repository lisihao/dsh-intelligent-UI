// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return { ...original, readCanvasHtmlTextureSource: vi.fn(() => ({})) }
})

import { CanvasHtmlTextureError, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'
import { createCanvasParticleScrollBridge } from '../src/canvas-scroll-texture.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

type Paintable = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type Ctx = { drawImage: ReturnType<typeof vi.fn>, drawElementImage?: (element: Element, x: number, y: number) => void }

const contexts = new WeakMap<HTMLCanvasElement, Ctx>()
const gl = { clearColor: vi.fn(), clear: vi.fn(), isContextLost: () => false, COLOR_BUFFER_BIT: 16384 }
let resizeCallback: (() => void) | undefined
let frameCallback: FrameRequestCallback | undefined
let intersectionCallback: IntersectionObserverCallback | undefined
const disconnect = vi.fn()
class ResizeStub {
  constructor(callback: () => void) { resizeCallback = callback }
  observe() {}
  disconnect() { disconnect() }
}
class IntersectionStub {
  constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback }
  observe() {}
  disconnect() {}
}
function rect(x: number, width: number, height: number, y = 0) {
  return { x, y, left: x, right: x + width, top: y, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect
}
function setSize(element: HTMLElement, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(element, key, { configurable: true, value })
}
function fixture() {
  const scroll = document.createElement('div')
  scroll.style.cssText = 'overflow-y:auto;padding:0;background-color:rgb(20,30,40)'
  const content = document.createElement('div')
  content.style.margin = '0'
  content.textContent = 'Original readable source'
  scroll.append(content)
  const output = document.createElement('canvas')
  output.style.pointerEvents = 'none'
  document.body.append(scroll, output)
  setSize(scroll, { clientWidth: 400, clientHeight: 200, scrollHeight: 600, scrollWidth: 400 })
  setSize(output, { clientWidth: 400, clientHeight: 200 })
  scroll.getBoundingClientRect = () => rect(0, 400, 200)
  content.getBoundingClientRect = () => rect(0, 400, 600, -scroll.scrollTop)
  output.getBoundingClientRect = () => rect(440, 400, 200)
  let textureOptions: CanvasHtmlTextureOptions | undefined
  const textureDispose = vi.fn()
  const textureRefresh = vi.fn(async () => { (textureOptions?.source as Paintable).onpaint?.() })
  const makeTexture = vi.fn((options: CanvasHtmlTextureOptions) => {
    textureOptions = options
    const ctx = options.source.getContext('2d') as unknown as Ctx
    ctx.drawElementImage = vi.fn()
    return { refresh: textureRefresh, dispose: textureDispose }
  })
  let source: Paintable | undefined
  let proxy: HTMLElement | undefined
  const destroy = vi.fn()
  const resize = vi.fn()
  const setOptions = vi.fn()
  const factory: CanvasEffectFactory = (elements) => {
    source = elements.source as Paintable
    proxy = elements.content as HTMLElement
    source.onpaint = () => (source!.getContext('2d') as unknown as Ctx).drawElementImage?.(proxy!, 0, 0)
    proxy.addEventListener('scroll', () => source?.requestPaint?.())
    return { destroy, resize, setOptions }
  }
  const onError = vi.fn()
  const create = () => createCanvasParticleScrollBridge({ scroll, content, output, factory, onError, scope: 'visual-only', sourceRemainsVisible: true, createTextureBridge: makeTexture })
  return { scroll, content, output, create, onError, makeTexture, textureDispose, textureRefresh, destroy, resize, setOptions,
    get source() { return source! }, get proxy() { return proxy! }, get textureOptions() { return textureOptions! } }
}

beforeEach(() => {
  resizeCallback = undefined
  frameCallback = undefined
  intersectionCallback = undefined
  disconnect.mockClear()
  gl.clear.mockClear(); gl.clearColor.mockClear()
  vi.stubGlobal('ResizeObserver', ResizeStub)
  vi.stubGlobal('IntersectionObserver', IntersectionStub)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frameCallback = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') return gl as unknown as WebGL2RenderingContext
    if (!contexts.has(this)) contexts.set(this, { drawImage: vi.fn() })
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Particle Scroll source-preserving fallback', () => {
  it('forwards real scrolling and releases owned resources exactly once', async () => {
    const f = fixture()
    const bridge = f.create()
    await bridge.refresh()
    const sourceCtx = f.source.getContext('2d') as unknown as Ctx
    const proxyScroll = vi.fn()
    f.proxy.addEventListener('scroll', proxyScroll)
    f.scroll.scrollTop = 155
    f.scroll.dispatchEvent(new Event('scroll'))
    expect(proxyScroll).toHaveBeenCalledOnce()
    expect(f.proxy.scrollTop).toBe(155)
    expect(sourceCtx.drawImage).toHaveBeenLastCalledWith(f.textureOptions.source, 0, 155, 400, 200, 0, 0, f.source.width, f.source.height)
    expect(f.content.textContent).toBe('Original readable source')
    bridge.setOptions({ point: 0.4 })
    expect(f.setOptions).toHaveBeenCalledWith({ point: 0.4 })
    bridge.dispose(); bridge.dispose()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    f.scroll.dispatchEvent(new Event('scroll'))
    expect(proxyScroll).toHaveBeenCalledOnce()
    await expect(bridge.refresh()).rejects.toMatchObject({ code: 'disposed' })
  })

  it('re-evaluates background and layout when size or theme changes', () => {
    const f = fixture()
    const bridge = f.create()
    f.scroll.style.backgroundColor = 'rgb(35, 45, 55)'
    resizeCallback?.()
    expect(f.proxy.style.backgroundColor).toBe('rgb(35, 45, 55)')
    expect(f.resize).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('stops and reports if the original source is removed', () => {
    const f = fixture()
    const bridge = f.create()
    f.scroll.remove()
    resizeCallback?.()
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'detached' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.content.textContent).toBe('Original readable source')
    bridge.dispose()
    expect(f.destroy).toHaveBeenCalledOnce()
  })

  it('stops the effect before disposing its texture when reduced motion starts', () => {
    const f = fixture()
    const bridge = f.create()
    f.textureOptions.onError(new CanvasHtmlTextureError('reduced-motion', 'Motion reduced'))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.destroy.mock.invocationCallOrder[0]).toBeLessThan(f.textureDispose.mock.invocationCallOrder[0]!)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'reduced-motion' }))
    bridge.dispose()
  })

  it('does not allow the GPU output to cover the original', () => {
    const f = fixture()
    f.output.getBoundingClientRect = () => rect(0, 400, 200)
    expect(f.create).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.makeTexture).not.toHaveBeenCalled()
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('rejects scroll content that would not be captured', () => {
    const f = fixture()
    f.scroll.append('untracked text')
    expect(f.create).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    f.scroll.lastChild?.remove()
    setSize(f.scroll, { scrollHeight: 50_000 })
    expect(f.create).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.makeTexture).not.toHaveBeenCalled()
  })

  it('rejects an offset content element both before and after mounting', () => {
    const f = fixture()
    f.content.getBoundingClientRect = () => rect(0, 400, 600, -40)
    expect(f.create).toThrowError(expect.objectContaining({ code: 'unsupported' }))
    f.content.getBoundingClientRect = () => rect(0, 400, 600, -f.scroll.scrollTop)
    const bridge = f.create()
    f.content.getBoundingClientRect = () => rect(0, 400, 600, -40 - f.scroll.scrollTop)
    resizeCallback?.()
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('stops a visual canvas that moves over the source without a resize', () => {
    const f = fixture()
    const bridge = f.create()
    f.output.getBoundingClientRect = () => rect(0, 400, 200)
    frameCallback?.(0)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('stops if the visual canvas starts intercepting pointer input', () => {
    const f = fixture()
    const bridge = f.create()
    f.output.style.pointerEvents = 'auto'
    frameCallback?.(0)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('suspends offscreen monitoring and rechecks before showing the visual again', () => {
    const f = fixture()
    f.output.style.visibility = 'visible'
    const bridge = f.create()
    const fire = (isIntersecting: boolean) => intersectionCallback?.([{ target: f.output, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    fire(false)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(f.output.style.getPropertyValue('visibility')).toBe('hidden')
    expect(f.output.style.getPropertyPriority('visibility')).toBe('important')
    fire(true)
    expect(f.output.style.visibility).toBe('visible')
    expect(f.onError).not.toHaveBeenCalled()
    fire(false)
    f.output.getBoundingClientRect = () => rect(0, 400, 200)
    fire(true)
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsafe-content' }))
    expect(f.output.style.visibility).toBe('visible')
    bridge.dispose()
  })

  it('rejects refresh when its output is removed during capture', async () => {
    const f = fixture()
    const bridge = f.create()
    f.output.remove()
    await expect(bridge.refresh()).rejects.toMatchObject({ code: 'detached' })
    expect(f.onError).toHaveBeenCalledOnce()
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'detached' }))
    bridge.dispose()
  })

  it('removes the private canvases even if the output context fails to clear', () => {
    const f = fixture()
    const bridge = f.create()
    gl.clear.mockImplementationOnce(() => { throw new Error('context lost while clearing') })
    expect(() => bridge.dispose()).toThrow('context lost while clearing')
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(f.textureDispose).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('cleans up when the upstream factory cannot start', () => {
    const f = fixture()
    expect(() => createCanvasParticleScrollBridge({ scroll: f.scroll, content: f.content, output: f.output, factory: () => null,
      onError: f.onError, scope: 'visual-only', sourceRemainsVisible: true, createTextureBridge: f.makeTexture })).toThrowError(expect.objectContaining({ code: 'unsupported' }))
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
  })
})
