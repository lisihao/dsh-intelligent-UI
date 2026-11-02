// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return { ...original, readCanvasHtmlTextureSource: vi.fn(() => ({})) }
})
vi.mock('../src/canvas-text-mask-proxy.js', () => ({
  createCanvasTextMaskProxy: vi.fn(({ stage }: { stage: HTMLElement }) => {
    const frame = document.createElement('div'), root = frame.attachShadow({ mode: 'closed' }), content = document.createElement('div')
    root.append(content); stage.append(frame)
    let populated = false
    return {
      content,
      update: vi.fn(snapshot => {
        const changed = !!snapshot || populated
        populated = !!snapshot
        content.textContent = snapshot ? 'M'.repeat(snapshot.textRects.length) : ''
        return changed
      }),
      resize: vi.fn(() => populated),
      dispose: vi.fn(() => { content.replaceChildren(); frame.remove() }),
    }
  }),
}))

import { CanvasHtmlTextureError, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions, type CanvasHtmlTextureSnapshot } from '../src/canvas-html-texture.js'
import { createCanvasHtmlEffectAdapter, type CanvasHtmlEffectName } from '../src/canvas-html-effect-adapter.js'
import { createCanvasTextMaskProxy } from '../src/canvas-text-mask-proxy.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

type Paint = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type Ctx = {
  drawImage: ReturnType<typeof vi.fn>, drawElementImage?: (element: Element, x: number, y: number) => void
  fillStyle: string, clearRect: ReturnType<typeof vi.fn>, fillRect: ReturnType<typeof vi.fn>, getImageData: () => { data: Uint8ClampedArray }
}
const contexts = new WeakMap<HTMLCanvasElement, Ctx>()
function contextStub(): Ctx {
  let fillStyle = 'rgb(0, 0, 0)'
  const css = document.createElement('div').style
  return {
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
    get fillStyle() { return fillStyle },
    set fillStyle(value: string) {
      css.color = ''
      css.color = value
      if (css.color) fillStyle = css.color
    },
    getImageData() {
      const parts = fillStyle.match(/^rgba?\(([^)]+)\)$/)?.[1]?.split(',').map(value => Number(value.trim()))
      if (!parts || parts.length < 3) throw new Error('Unsupported color in canvas test stub')
      return { data: new Uint8ClampedArray([parts[0]!, parts[1]!, parts[2]!, Math.round((parts[3] ?? 1) * 255)]) }
    },
  }
}
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
  content.textContent = component === 'magnify' ? '' : 'Original source'
  if (component === 'asciify') content.style.backgroundColor = 'rgb(32, 37, 45)'
  document.body.append(content, host)
  content.getBoundingClientRect = () => rect(0, 0)
  host.getBoundingClientRect = () => rect(440, 0)
  setSize(content, 400, 240); setSize(host, 400, 240)
  let textureOptions: CanvasHtmlTextureOptions | undefined
  let textureSnapshot: CanvasHtmlTextureSnapshot | undefined = { revision: 1, width: 400, height: 240, textRects: [{ x: 10, y: 20, width: 40, height: 18 }] }
  const textureDispose = vi.fn()
  const textureRefresh = vi.fn(async () => { (textureOptions?.source as Paint).onpaint?.() })
  const createTexture = vi.fn<(options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge>((options) => {
    textureOptions = options
    const ctx = options.source.getContext('2d') as unknown as Ctx
    ctx.drawElementImage = vi.fn()
    return { refresh: textureRefresh, dispose: textureDispose, ...(options.captureTextRects ? { getSnapshot: () => textureSnapshot } : {}) }
  })
  const destroy = vi.fn(), resize = vi.fn(), setOptions = vi.fn(), splash = vi.fn(), melt = vi.fn(), burst = vi.fn(), proxyPointer = vi.fn()
  const factory: CanvasEffectFactory = vi.fn(elements => {
    const source = elements.source as Paint, proxy = elements.content as HTMLElement
    if (component === 'magnify' || component === 'clouds') proxy.addEventListener('pointermove', proxyPointer)
    source.onpaint = () => (source.getContext('2d') as unknown as Ctx).drawElementImage?.(proxy, 0, 0)
    source.requestPaint?.()
    return { destroy, resize, setOptions, splash, melt, burst } as unknown as ReturnType<CanvasEffectFactory>
  })
  const release = vi.fn()
  const acquireSlot = vi.fn((activate: () => void) => { activate(); return release })
  const onError = vi.fn()
  const create = (signal?: AbortSignal, effectOptions?: Record<string, unknown>) => createCanvasHtmlEffectAdapter({ component, content, host, factory, onError, signal, effectOptions, pointer: true, scope: 'visual-only', sourceRemainsVisible: true, ...(component === 'magnify' ? { contentRole: 'decoration' as const } : {}), createTextureBridge: createTexture, acquireSlot })
  const visible = (yes: boolean) => intersectionCallback?.([host, content].map(target => ({ target, isIntersecting: yes, intersectionRect: rect(0, 0, yes ? 400 : 0, yes ? 240 : 0) } as unknown as IntersectionObserverEntry)))
  return { content, host, create, visible, factory, destroy, resize, setOptions, splash, melt, burst, proxyPointer, release, acquireSlot, createTexture, textureDispose, textureRefresh, onError,
    setSnapshot(value: CanvasHtmlTextureSnapshot | undefined) { textureSnapshot = value },
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
    if (!contexts.has(this)) contexts.set(this, contextStub())
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
})
afterEach(() => { document.body.replaceChildren(); document.body.removeAttribute('style'); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('visual-only single-source Canvas effects', () => {
  it('uses same-revision text rectangles in an isolated Asciify proxy', async () => {
    const f = fixture('asciify'), before = f.content.outerHTML, pending = f.create()
    f.visible(true)
    const effect = await pending
    const mask = vi.mocked(createCanvasTextMaskProxy).mock.results.at(-1)!.value
    const proxy = vi.mocked(f.factory).mock.calls[0]![0].content as HTMLElement
    expect(f.textureOptions.captureTextRects).toBe(true)
    expect(proxy).toBe(mask.content)
    expect((proxy.getRootNode() as ShadowRoot).mode).toBe('closed')
    expect(proxy.textContent).toBe('M')
    expect(proxy.textContent).not.toContain('Original source')
    expect(proxy.style.backgroundColor).toBe('rgb(32, 37, 45)')
    expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ background: 'auto', glow: 0, aberration: 0 })
    expect(mask.update).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }))
    expect(f.resize).toHaveBeenCalled()

    const next = { revision: 2, width: 400, height: 240, textRects: [{ x: 12, y: 25, width: 80, height: 20 }] }
    f.setSnapshot(next); f.resize.mockClear()
    await effect.refresh()
    expect(mask.update).toHaveBeenLastCalledWith(next)
    expect(f.resize).toHaveBeenCalled()
    f.resize.mockClear(); effect.resize()
    expect(mask.resize).toHaveBeenCalled()
    expect(f.resize).toHaveBeenCalled()
    vi.mocked(mask.resize).mockClear(); f.resize.mockClear(); resizeCallback?.()
    expect(mask.resize).toHaveBeenCalledOnce()
    expect(f.resize).toHaveBeenCalled()
    expect(f.content.outerHTML).toBe(before)

    effect.dispose(); effect.dispose()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(mask.dispose).toHaveBeenCalledOnce()
    expect(f.destroy.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(mask.dispose).mock.invocationCallOrder[0]!)
    expect(vi.mocked(mask.dispose).mock.invocationCallOrder[0]).toBeLessThan(f.textureDispose.mock.invocationCallOrder[0]!)
    expect(f.host.children).toHaveLength(0)
    expect(f.content.outerHTML).toBe(before)
  })

  it('clears the Asciify mask when the texture is invalidated, then updates on a new capture', async () => {
    const f = fixture('asciify'), pending = f.create(); f.visible(true)
    const effect = await pending
    const mask = vi.mocked(createCanvasTextMaskProxy).mock.results.at(-1)!.value
    const source = vi.mocked(f.factory).mock.calls[0]![0].source as Paint
    const sourceContext = source.getContext('2d') as unknown as Ctx
    const notifySource = vi.fn(source.onpaint!)
    source.onpaint = notifySource
    sourceContext.clearRect.mockClear(); sourceContext.drawImage.mockClear(); gl.clear.mockClear(); gl.clearColor.mockClear()
    f.setSnapshot(undefined); f.resize.mockClear()
    ;(f.textureOptions.source as Paint).onpaint?.()
    expect(mask.update).toHaveBeenLastCalledWith(undefined)
    expect(mask.content.textContent).toBe('')
    expect(f.resize).toHaveBeenCalled()
    expect(sourceContext.clearRect).toHaveBeenCalledWith(0, 0, source.width, source.height)
    expect(sourceContext.drawImage).not.toHaveBeenCalled()
    expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0)
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT)
    expect(notifySource).toHaveBeenCalledOnce()
    f.setSnapshot({ revision: 2, width: 400, height: 240, textRects: [{ x: 1, y: 2, width: 3, height: 4 }] })
    await effect.refresh()
    expect(mask.content.textContent).toBe('M')
    expect(f.content.textContent).toBe('Original source')
    effect.dispose()
  })

  it('requires Asciify texture metadata, a captured bitmap and a refreshable factory', async () => {
    const noGetter = fixture('asciify')
    noGetter.createTexture.mockImplementationOnce(options => {
      const ctx = options.source.getContext('2d') as unknown as Ctx
      ctx.drawElementImage = vi.fn()
      return { refresh: async () => {}, dispose: noGetter.textureDispose }
    })
    const first = noGetter.create(); noGetter.visible(true)
    await expect(first).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('text geometry') })
    expect(noGetter.factory).not.toHaveBeenCalled()
    expect(noGetter.textureDispose).toHaveBeenCalledOnce()
    expect(noGetter.host.children).toHaveLength(0)

    const noBitmap = fixture('asciify'); noBitmap.setSnapshot(undefined)
    const second = noBitmap.create(); noBitmap.visible(true)
    await expect(second).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('unavailable') })
    expect(noBitmap.destroy).toHaveBeenCalledOnce()
    expect(noBitmap.host.children).toHaveLength(0)

    const noResize = fixture('asciify')
    vi.mocked(noResize.factory).mockReturnValueOnce({ destroy: noResize.destroy } as unknown as ReturnType<CanvasEffectFactory>)
    const third = noResize.create(); noResize.visible(true)
    await expect(third).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('refresh') })
    expect(noResize.destroy).toHaveBeenCalledOnce()
    expect(noResize.host.children).toHaveLength(0)
  })

  it('rejects Asciify when a solid opaque background cannot be determined', async () => {
    const translucent = fixture('asciify'); translucent.content.style.backgroundColor = 'rgba(32, 37, 45, 0.5)'
    await expect(translucent.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('translucent') })
    expect(translucent.factory).not.toHaveBeenCalled()
    const gradient = fixture('asciify'); gradient.content.style.backgroundImage = 'linear-gradient(red, blue)'
    await expect(gradient.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('gradient') })
    const unknown = fixture('asciify'); unknown.content.style.backgroundColor = 'transparent'
    await expect(unknown.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('solid') })
    const opacity = fixture('asciify'); document.body.style.opacity = '0.8'
    await expect(opacity.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('translucent') })
    document.body.style.opacity = ''
  })

  it('requires an opaque root background that covers the full Asciify texture', async () => {
    for (const clip of ['content-box', 'padding-box']) {
      const f = fixture('asciify')
      f.content.style.backgroundClip = clip
      f.content.style.padding = '24px'
      f.content.style.border = '12px solid transparent'
      await expect(f.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('whole source') })
      expect(f.factory).not.toHaveBeenCalled()
    }
    const rounded = fixture('asciify'); rounded.content.style.borderRadius = '16px'
    await expect(rounded.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('rounded') })
    const masked = fixture('asciify'); masked.content.style.clipPath = 'circle(50%)'
    await expect(masked.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('clipped') })
    const inset = fixture('asciify'); inset.content.style.boxShadow = 'inset 0 0 12px red'
    await expect(inset.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('inset') })
    const inherited = fixture('asciify'); inherited.content.style.backgroundColor = 'transparent'; document.body.style.backgroundColor = 'rgb(32, 37, 45)'
    await expect(inherited.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('source itself') })
    document.body.style.backgroundColor = ''
  })

  it('rejects multiple text backings but allows non-text decoration and matching colors', async () => {
    const mixed = fixture('asciify'), other = document.createElement('span')
    other.textContent = 'other text'; other.style.backgroundColor = 'rgb(250, 250, 250)'; mixed.content.append(other)
    await expect(mixed.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('multiple text') })
    const gradient = fixture('asciify'), gradientText = document.createElement('span')
    gradientText.textContent = 'gradient text'; gradientText.style.backgroundImage = 'linear-gradient(red, blue)'; gradient.content.append(gradientText)
    await expect(gradient.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('text background') })
    const safe = fixture('asciify'), matching = document.createElement('span'), decoration = document.createElement('div')
    matching.textContent = 'matching text'; matching.style.backgroundColor = 'rgba(32, 37, 45, 0.5)'
    decoration.style.backgroundImage = 'linear-gradient(red, blue)'
    safe.content.append(matching, decoration)
    const pending = safe.create(); safe.visible(true)
    const effect = await pending
    expect(safe.factory).toHaveBeenCalledOnce()
    effect.dispose()
  })

  it('stops Asciify if a theme change narrows the background clip', async () => {
    const f = fixture('asciify'), pending = f.create(); f.visible(true)
    const effect = await pending
    f.content.style.backgroundClip = 'content-box'
    f.content.style.padding = '12px'
    await vi.waitFor(() => expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported', message: expect.stringContaining('whole source') })))
    expect(f.content.textContent).toBe('Original source')
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    effect.dispose()
  })

  it('updates the Asciify proxy for theme changes and stops if the background becomes ambiguous', async () => {
    const f = fixture('asciify'), pending = f.create(); f.visible(true)
    const effect = await pending
    const mask = vi.mocked(createCanvasTextMaskProxy).mock.results.at(-1)!.value
    f.resize.mockClear()
    f.content.style.backgroundColor = 'rgb(80, 100, 120)'
    await vi.waitFor(() => expect(mask.content.style.backgroundColor).toBe('rgb(80, 100, 120)'))
    expect(f.resize).toHaveBeenCalled()
    f.content.style.backgroundColor = 'rgba(80, 100, 120, 0.5)'
    await vi.waitFor(() => expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported' })))
    expect(f.content.textContent).toBe('Original source')
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(mask.dispose).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    effect.dispose()
  })

  it('tracks CSS-only Asciify background changes and rejects a mismatched capture size', async () => {
    const f = fixture('asciify')
    let color = 'rgb(32, 37, 45)'
    const getStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const computed = getStyle(element, pseudo)
      if (element !== f.content) return computed
      return new Proxy(computed, { get(target, property) {
        if (property === 'backgroundColor') return color
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    const pending = f.create(); f.visible(true)
    const effect = await pending
    const mask = vi.mocked(createCanvasTextMaskProxy).mock.results.at(-1)!.value
    const clock = vi.spyOn(window.performance, 'now').mockReturnValue(10_000)
    color = 'rgb(90, 100, 110)'; f.resize.mockClear(); frameCallback?.(10_000)
    expect(mask.content.style.backgroundColor).toBe('rgb(90, 100, 110)')
    expect(f.resize).toHaveBeenCalled()
    f.setSnapshot({ revision: 2, width: 399, height: 240, textRects: [] })
    await expect(effect.refresh()).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('changed size') })
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'capture' }))
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(mask.dispose).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    clock.mockRestore(); effect.dispose()
  })

  it('cleans an Asciify mask if cancellation occurs during capture', async () => {
    const f = fixture('asciify'), controller = new AbortController()
    let resolveCapture!: () => void
    f.createTexture.mockImplementationOnce(options => {
      const ctx = options.source.getContext('2d') as unknown as Ctx
      ctx.drawElementImage = vi.fn()
      return { refresh: () => new Promise<void>(resolve => { resolveCapture = resolve }), getSnapshot: () => undefined, dispose: f.textureDispose }
    })
    const pending = f.create(controller.signal); f.visible(true)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledOnce())
    const mask = vi.mocked(createCanvasTextMaskProxy).mock.results.at(-1)!.value
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'disposed' })
    resolveCapture(); await Promise.resolve()
    expect(mask.dispose).toHaveBeenCalledOnce()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.textureDispose).toHaveBeenCalledOnce()
    expect(f.host.children).toHaveLength(0)
    expect(f.content.textContent).toBe('Original source')
  })

  it('uses the actual source background and isolates Clouds pointer input', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds')
    f.content.style.backgroundColor = 'rgb(32, 37, 45)'
    const original = f.content.outerHTML, capture = vi.fn()
    document.addEventListener('pointermove', capture, true)
    try {
      const pending = f.create(); f.visible(true)
      const effect = await pending
      expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ color: [32 / 255, 37 / 255, 45 / 255] })
      const proxy = vi.mocked(f.factory).mock.calls[0]![0].content as HTMLElement
      expect((proxy.getRootNode() as ShadowRoot).mode).toBe('closed')
      const stage = f.host.firstElementChild!
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 120, bubbles: true, composed: true }))
      expect(f.proxyPointer).toHaveBeenCalledOnce()
      expect(capture).toHaveBeenCalledOnce()
      effect.dispose(); effect.dispose()
      f.content.style.backgroundImage = 'linear-gradient(red, blue)'
      expect(() => effect.setOptions({ color: 'auto' })).not.toThrow()
      f.content.style.backgroundImage = ''
      expect(f.content.outerHTML).toBe(original)
      expect(f.host.children).toHaveLength(0)
      expect(f.destroy).toHaveBeenCalledOnce()
    } finally { document.removeEventListener('pointermove', capture, true) }
  })

  it('does not change Clouds background-clip handling', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds')
    f.content.style.backgroundColor = 'rgba(32, 37, 45, 0.5)'
    f.content.style.backgroundClip = 'content-box'
    f.content.style.padding = '20px'
    const pending = f.create(); f.visible(true)
    const effect = await pending
    expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ color: [32 / 255, 37 / 255, 45 / 255] })
    effect.dispose()
  })

  it('follows upstream first non-transparent source ancestry and updates theme changes', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds')
    document.body.style.backgroundColor = 'rgb(20, 40, 60)'
    const pending = f.create(); f.visible(true)
    const effect = await pending
    expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ color: [20 / 255, 40 / 255, 60 / 255] })
    f.content.style.backgroundColor = 'rgba(100, 150, 200, 0.5)'
    await vi.waitFor(() => expect(f.setOptions).toHaveBeenCalledWith({ color: [100 / 255, 150 / 255, 200 / 255] }))
    f.content.style.backgroundColor = 'transparent'
    document.body.style.backgroundColor = 'rgb(80, 100, 120)'
    await vi.waitFor(() => expect(f.setOptions).toHaveBeenCalledWith({ color: [80 / 255, 100 / 255, 120 / 255] }))
    expect(f.content.style.opacity).toBe('')
    effect.dispose()
  })

  it('retains explicit Clouds color until auto is requested again, including remounts', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds'); f.content.style.backgroundColor = 'rgb(32, 37, 45)'
    const pending = f.create(); f.visible(true)
    const effect = await pending
    const chosen = [0.1, 0.2, 0.3]
    effect.setOptions({ color: chosen }); chosen[0] = 1
    f.setOptions.mockClear()
    f.content.style.backgroundColor = 'rgb(60, 80, 100)'
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(f.setOptions).not.toHaveBeenCalled()
    f.visible(false); f.visible(true)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledTimes(2))
    expect(vi.mocked(f.factory).mock.calls[1]![1]).toMatchObject({ color: [0.1, 0.2, 0.3] })
    effect.setOptions({ color: 'auto' })
    expect(f.setOptions).toHaveBeenCalledWith({ color: [60 / 255, 80 / 255, 100 / 255] })
    f.setOptions.mockClear()
    expect(() => effect.setOptions({ color: [1, 2, 3] })).toThrow('three RGB values')
    expect(() => effect.setOptions({ color: new Array(3) })).toThrow('three RGB values')
    expect(f.setOptions).not.toHaveBeenCalled()
    effect.dispose()
  })

  it('re-resolves an automatic Clouds background after leaving and re-entering view', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds'); f.content.style.backgroundColor = 'rgb(32, 37, 45)'
    const pending = f.create(); f.visible(true)
    const effect = await pending
    f.visible(false)
    f.content.style.backgroundColor = 'rgb(81, 82, 83)'
    f.visible(true)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledTimes(2))
    expect(vi.mocked(f.factory).mock.calls[1]![1]).toMatchObject({ color: [81 / 255, 82 / 255, 83 / 255] })
    effect.dispose()
    expect(f.destroy).toHaveBeenCalledTimes(2)
  })

  it('updates Clouds auto color when CSSOM changes without a DOM mutation', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('clouds')
    let resolvedColor = 'rgb(32, 37, 45)'
    const getStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = getStyle(element, pseudo)
      if (element !== f.content) return style
      return new Proxy(style, { get(target, property) {
        if (property === 'backgroundColor') return resolvedColor
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    const pending = f.create(); f.visible(true)
    const effect = await pending
    try {
      resolvedColor = 'rgb(90, 100, 110)'
      const clock = vi.spyOn(window.performance, 'now').mockReturnValue(10_000)
      frameCallback?.(10_000)
      expect(f.setOptions).toHaveBeenCalledWith({ color: [90 / 255, 100 / 255, 110 / 255] })
      f.setOptions.mockClear(); resolvedColor = 'rgb(120, 130, 140)'
      clock.mockReturnValue(10_249); frameCallback?.(10_249)
      expect(f.setOptions).not.toHaveBeenCalled()
      clock.mockReturnValue(10_250); frameCallback?.(10_250)
      expect(f.setOptions).toHaveBeenCalledWith({ color: [120 / 255, 130 / 255, 140 / 255] })
    } finally { effect.dispose() }
  })

  it('requires an explicit Clouds color when auto cannot reliably determine a background', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const transparent = fixture('clouds')
    await expect(transparent.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('provide an explicit color') })
    const gradient = fixture('clouds'); gradient.content.style.backgroundImage = 'linear-gradient(red, blue)'
    await expect(gradient.create()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('gradient') })
    const pending = gradient.create(undefined, { color: [0.2, 0.3, 0.4] }); gradient.visible(true)
    const effect = await pending
    expect(vi.mocked(gradient.factory).mock.calls[0]![1]).toMatchObject({ color: [0.2, 0.3, 0.4] })
    effect.dispose()
  })

  it('stops Clouds if an auto background becomes ambiguous and honors reduced motion', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const reduced = fixture('clouds')
    vi.mocked(window.matchMedia).mockReturnValueOnce({ matches: true } as MediaQueryList)
    await expect(reduced.create()).rejects.toMatchObject({ code: 'reduced-motion' })
    const f = fixture('clouds'); f.content.style.backgroundColor = 'rgb(32, 37, 45)'
    const pending = f.create(); f.visible(true)
    const effect = await pending
    f.content.style.backgroundImage = 'linear-gradient(red, blue)'
    await vi.waitFor(() => expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported' })))
    expect(f.content.textContent).toBe('Original source')
    expect(f.host.children).toHaveLength(0)
    expect(f.destroy).toHaveBeenCalledOnce()
    effect.dispose()
  })

  it('isolates Magnify proxy events from document capture and removes the relay on dispose', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const capture = vi.fn()
    document.addEventListener('pointermove', capture, true)
    const f = fixture('magnify'), before = f.content.outerHTML, pending = f.create()
    try {
      f.visible(true)
      const effect = await pending
      const stage = f.host.firstElementChild!
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 120, bubbles: true, composed: true }))
      expect(f.proxyPointer).toHaveBeenCalledOnce()
      expect(f.proxyPointer.mock.calls[0]![0]).toMatchObject({ clientX: 500, clientY: 120 })
      expect(capture).toHaveBeenCalledOnce()
      expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ scrollZoom: false, size: 67, zoom: 1.3, crosshair: false, aberration: 0, haze: 0, readout: false })
      expect(() => effect.setOptions({ scrollZoom: true })).toThrow('Scroll zoom is unavailable')
      expect(f.setOptions).not.toHaveBeenCalled()
      effect.dispose()
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: 510, clientY: 130 }))
      expect(f.proxyPointer).toHaveBeenCalledOnce()
      expect(f.content.outerHTML).toBe(before)
    } finally { document.removeEventListener('pointermove', capture, true) }
  })

  it('resizes the default Magnify lens with its visual region while respecting an explicit size', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const f = fixture('magnify'), pending = f.create()
    f.visible(true)
    const effect = await pending
    f.content.getBoundingClientRect = () => rect(0, 0, 300, 120)
    f.host.getBoundingClientRect = () => rect(440, 0, 300, 120)
    setSize(f.content, 300, 120); setSize(f.host, 300, 120)
    resizeCallback?.()
    expect(f.setOptions).toHaveBeenCalledWith({ size: 33 })
    effect.setOptions({ size: 20 }); f.setOptions.mockClear()
    f.content.getBoundingClientRect = () => rect(0, 0, 300, 160)
    f.host.getBoundingClientRect = () => rect(440, 0, 300, 160)
    setSize(f.content, 300, 160); setSize(f.host, 300, 160)
    resizeCallback?.()
    expect(f.setOptions).not.toHaveBeenCalled()
    effect.setOptions({ size: undefined })
    expect(f.setOptions).toHaveBeenCalledWith({ size: 44 })
    effect.dispose()
  })

  it('rejects Magnify scroll zoom before initializing its global wheel listener', async () => {
    const f = fixture('magnify')
    await expect(f.create(undefined, { scrollZoom: true })).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.factory).not.toHaveBeenCalled()
  })

  it('requires the caller to explicitly identify Magnify content as decoration', async () => {
    const f = fixture('magnify')
    await expect(createCanvasHtmlEffectAdapter({ component: 'magnify', content: f.content, host: f.host, factory: f.factory, onError: f.onError, scope: 'visual-only', sourceRemainsVisible: true })).rejects.toMatchObject({ code: 'unsupported' })
    expect(f.factory).not.toHaveBeenCalled()
  })

  it('refuses to magnify text and stops if its source later gains text', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const rejected = fixture('magnify')
    rejected.content.textContent = 'Revenue: 24%'
    await expect(rejected.create()).rejects.toMatchObject({ code: 'unsupported' })
    expect(rejected.factory).not.toHaveBeenCalled()

    const live = fixture('magnify'), pending = live.create()
    live.visible(true)
    const effect = await pending
    live.content.textContent = 'Revenue: 24%'
    await expect(effect.refresh()).rejects.toMatchObject({ code: 'unsupported' })
    expect(live.content.textContent).toBe('Revenue: 24%')
    expect(live.host.children).toHaveLength(0)
    expect(live.destroy).toHaveBeenCalledOnce()
  })
  it.each(['grid', 'displacement', 'glitch', 'blaze', 'particle-reveal', 'canvas', 'vhs', 'decrypt-reveal'] as const)('keeps the source separate and disposes the %s visual', async component => {
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
