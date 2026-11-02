// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('modern-screenshot', () => ({
  createContext: vi.fn(async (node: Node, options: { width: number, height: number }) => ({ node, options })),
  destroyContext: vi.fn(),
  domToCanvas: vi.fn(async ({ options }: { options: { width: number, height: number } }) => {
    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    return canvas
  }),
}))

import { domToCanvas } from 'modern-screenshot'
import { CanvasHtmlTextureError, createCanvasHtmlTextureBridge, readCanvasHtmlTextureSource } from '../src/canvas-html-texture.js'

const dimensions = (element: Element, width = 320, height = 160) => {
  element.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect
}

const computed = (element: Element, pseudo?: string | null) => {
  const style = (element as HTMLElement).style
  return {
    position: style.position || 'static', transform: style.transform || 'none',
    overflowX: style.overflowX || 'visible', overflowY: style.overflowY || 'visible',
    display: style.display || 'block', visibility: style.visibility || 'visible', opacity: style.opacity || '1',
    content: pseudo ? 'none' : 'normal', length: style.length,
    item: (index: number) => style.item(index),
    getPropertyValue: (name: string) => style.getPropertyValue(name),
  } as CSSStyleDeclaration
}

let reducedMotion = false
let motionListener: ((event: MediaQueryListEvent) => void) | undefined
const contexts = new WeakMap<HTMLCanvasElement, object>()
const reports: CanvasHtmlTextureError[] = []
class ResizeStub {
  observe() {}
  disconnect() {}
}

function fixture() {
  const content = document.createElement('div')
  content.innerHTML = '<pre><code><span>const value = 42</span></code></pre>'
  dimensions(content)
  const source = document.createElement('canvas')
  document.body.append(content, source)
  const bridge = createCanvasHtmlTextureBridge({ source, content, scope: 'visual-only', sourceRemainsVisible: true, onError: error => reports.push(error) })
  return { source, content, bridge }
}

function framedFixture() {
  const parent = document.createElement('div')
  const outer = document.createElement('iframe')
  parent.append(outer)
  document.body.append(parent)
  const doc = outer.contentDocument!
  const win = outer.contentWindow!
  Object.defineProperty(win, 'getComputedStyle', { configurable: true, value: computed })
  Object.defineProperty(win, 'matchMedia', { configurable: true, value: window.matchMedia })
  Object.defineProperty(win, 'ResizeObserver', { configurable: true, value: ResizeStub })
  const content = doc.createElement('div')
  content.textContent = 'Visible source'
  dimensions(content)
  const source = doc.createElement('canvas')
  const context = { drawImage: vi.fn(), clearRect: vi.fn() }
  Object.defineProperty(source, 'getContext', { configurable: true, value: () => context })
  doc.body.append(content, source)
  return { parent, outer, doc, win, content, source, context }
}

function loadSnapshotFrame(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument!
  const meta = doc.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', frame.srcdoc.match(/content="([^"]+)"/u)![1]!)
  doc.head.append(meta)
  frame.dispatchEvent(new Event('load'))
}

beforeEach(() => {
  reducedMotion = false
  motionListener = undefined
  reports.length = 0
  vi.spyOn(window, 'getComputedStyle').mockImplementation(computed)
  vi.stubGlobal('ResizeObserver', ResizeStub)
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    get matches() { return reducedMotion }, media: '', onchange: null,
    addEventListener: (_: string, listener: EventListenerOrEventListenerObject) => { motionListener = listener as (event: MediaQueryListEvent) => void },
    removeEventListener: () => { motionListener = undefined },
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }) as MediaQueryList)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, { drawImage: vi.fn() })
    return contexts.get(this) as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('visual-only canvas HTML texture', () => {
  it('reads simple source text without changing or retaining original HTML nodes', () => {
    const content = document.createElement('pre')
    content.innerHTML = '<code><span>42 &amp; x</span></code>'
    document.body.append(content)
    dimensions(content)
    const snapshot = readCanvasHtmlTextureSource(content)
    expect(snapshot.width).toBe(320)
    expect(snapshot.height).toBe(160)
    expect(JSON.stringify(snapshot.tree)).toContain('42 & x')
    expect(content.textContent).toBe('42 & x')
  })

  it('refuses interactive/media and resource-bearing visual subtrees', () => {
    const root = document.createElement('div')
    document.body.append(root)
    dimensions(root)
    for (const child of [document.createElement('button'), document.createElement('img'), document.createElement('a')]) {
      root.replaceChildren(child)
      expect(() => readCanvasHtmlTextureSource(root)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    }
    const decorated = document.createElement('span')
    decorated.style.backgroundImage = 'url(https://example.invalid/image.png)'
    root.replaceChildren(decorated)
    expect(() => readCanvasHtmlTextureSource(root)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })

  it('rejects large and detached input before installing any adapter', () => {
    const content = document.createElement('div')
    dimensions(content, 2500, 200)
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'detached' }))
    document.body.append(content)
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'too-large' }))
  })

  it('rejects a source hidden by itself or an ancestor', () => {
    const parent = document.createElement('div'), child = document.createElement('p')
    parent.append(child)
    document.body.append(parent)
    dimensions(child)
    for (const configure of [
      () => { child.hidden = true },
      () => { parent.style.display = 'none' },
      () => { parent.style.visibility = 'hidden' },
      () => { parent.style.opacity = '0.4' },
      () => { parent.setAttribute('aria-hidden', 'true') },
      () => { parent.setAttribute('inert', '') },
    ]) {
      configure()
      expect(() => readCanvasHtmlTextureSource(child)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
      child.hidden = false
      parent.style.cssText = ''
      parent.removeAttribute('aria-hidden')
      parent.removeAttribute('inert')
    }
  })

  it('checks the embedding frame and its parent document ancestors', () => {
    const { parent, outer, content } = framedFixture()
    expect(readCanvasHtmlTextureSource(content).width).toBe(320)
    for (const configure of [
      () => { outer.style.opacity = '0' },
      () => { outer.setAttribute('aria-hidden', 'true') },
      () => { parent.style.display = 'none' },
    ]) {
      configure()
      expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
      outer.style.cssText = ''
      outer.removeAttribute('aria-hidden')
      parent.style.cssText = ''
    }
  })

  it('walks more than one same-origin embedding frame', () => {
    const first = framedFixture()
    const inner = first.doc.createElement('iframe')
    first.doc.body.append(inner)
    const doc = inner.contentDocument!, win = inner.contentWindow!
    Object.defineProperty(win, 'getComputedStyle', { configurable: true, value: computed })
    const content = doc.createElement('div')
    doc.body.append(content)
    dimensions(content)
    expect(readCanvasHtmlTextureSource(content).width).toBe(320)
    first.outer.style.opacity = '0'
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    first.outer.style.opacity = '1'
    inner.setAttribute('aria-hidden', 'true')
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })

  it('refuses an embedding frame whose origin or parent cannot be verified', () => {
    const { win, content } = framedFixture()
    Object.defineProperty(win, 'frameElement', { configurable: true, get: () => null })
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    Object.defineProperty(win, 'frameElement', { configurable: true, get: () => { throw new DOMException('Cross-origin', 'SecurityError') } })
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })

  it('rejects a source behind an unverified shadow boundary', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const content = document.createElement('p')
    host.attachShadow({ mode: 'open' }).append(content)
    dimensions(content)
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })

  it('rejects a source whose composed visibility depends on a slot', () => {
    const host = document.createElement('div'), content = document.createElement('p')
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).append(document.createElement('slot'))
    host.append(content)
    dimensions(content)
    expect(content.assignedSlot).not.toBeNull()
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })

  it('bounds the source tree and text before allocating a canvas or iframe', () => {
    const content = document.createElement('div')
    document.body.append(content)
    dimensions(content)
    content.textContent = 'a'.repeat(16_385)
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'too-large' }))
    content.replaceChildren(...Array.from({ length: 128 }, () => document.createElement('span')))
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'too-large' }))
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('never replaces an already present native capture API', () => {
    const content = document.createElement('div'), source = document.createElement('canvas')
    dimensions(content)
    document.body.append(content, source)
    const context = source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage?: () => void }
    const nativeDraw = () => {}
    context.drawElementImage = nativeDraw
    expect(() => createCanvasHtmlTextureBridge({ source, content, scope: 'visual-only', sourceRemainsVisible: true, onError: () => {} })).toThrowError(expect.objectContaining({ code: 'unsupported' }))
    expect(context.drawElementImage).toBe(nativeDraw)
    expect('requestPaint' in source).toBe(false)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('does not create a sandbox when reduced motion is already enabled', () => {
    reducedMotion = true
    expect(() => fixture()).toThrowError(expect.objectContaining({ code: 'reduced-motion' }))
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('only changes its own canvas/context and restores both on dispose', () => {
    const { source, content, bridge } = fixture()
    const ctx = source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage?: unknown }
    expect(typeof (source as HTMLCanvasElement & { requestPaint?: unknown }).requestPaint).toBe('function')
    expect(typeof ctx.drawElementImage).toBe('function')
    expect('requestPaint' in HTMLCanvasElement.prototype).toBe(false)
    bridge.dispose()
    expect('requestPaint' in source).toBe(false)
    expect('drawElementImage' in ctx).toBe(false)
    expect(content.isConnected).toBe(true)
  })

  it('closes and releases an in-flight sandbox when disposed before it loads', async () => {
    const { bridge } = fixture()
    const pending = bridge.refresh()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    bridge.dispose()
    await pending
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    const second = fixture()
    second.bridge.dispose()
  })

  it('limits active adapters and resumes capacity after disposal', () => {
    const first = fixture(), second = fixture()
    expect(() => fixture()).toThrowError(expect.objectContaining({ code: 'busy' }))
    first.bridge.dispose()
    const third = fixture()
    second.bridge.dispose()
    third.bridge.dispose()
  })

  it('signals disposal only after an in-flight capture releases its capacity', async () => {
    let finish!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = fixture(), second = fixture()
    const pending = first.bridge.refresh()
    loadSnapshotFrame(document.querySelector('iframe')!)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    let drained = false
    const disposed = first.bridge.whenDisposed!().then(() => { drained = true })
    first.bridge.dispose()
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(() => fixture()).toThrowError(expect.objectContaining({ code: 'busy' }))
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160
    finish(canvas)
    await pending; await disposed
    expect(drained).toBe(true)
    const third = fixture()
    second.bridge.dispose(); third.bridge.dispose()
  })

  it('stops and restores its canvas when reduced motion becomes active', () => {
    const { source, bridge } = fixture()
    reducedMotion = true
    motionListener?.({} as MediaQueryListEvent)
    expect(reports[0]?.code).toBe('reduced-motion')
    expect('requestPaint' in source).toBe(false)
    bridge.dispose()
  })

  it('limits automatic capture frequency and cancels scheduled work on disposal', async () => {
    vi.useFakeTimers()
    const { source, bridge } = fixture()
    const request = (source as HTMLCanvasElement & { requestPaint: () => void }).requestPaint
    request()
    const frame = document.querySelector('iframe')!
    loadSnapshotFrame(frame)
    await vi.advanceTimersByTimeAsync(0)
    expect(domToCanvas).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 25; i++) request()
    await vi.advanceTimersByTimeAsync(249)
    expect(domToCanvas).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(domToCanvas).toHaveBeenCalledTimes(2)
    request()
    await bridge.refresh()
    expect(domToCanvas).toHaveBeenCalledTimes(3)
    request()
    bridge.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(domToCanvas).toHaveBeenCalledTimes(3)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('observes frame visibility, reparenting, restoration, and disconnects on disposal', async () => {
    const { outer, parent, doc, content, source, context } = framedFixture()
    const wrapper = doc.createElement('section')
    content.before(wrapper)
    wrapper.append(content)
    const bridge = createCanvasHtmlTextureBridge({ source, content, scope: 'visual-only', sourceRemainsVisible: true, onError: error => reports.push(error) })
    const first = bridge.refresh()
    loadSnapshotFrame(doc.querySelector('iframe')!)
    await first
    expect(domToCanvas).toHaveBeenCalledTimes(1)
    outer.style.opacity = '0'
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(reports.at(-1)?.code).toBe('unsafe-content')
    expect(context.clearRect).toHaveBeenCalled()
    outer.style.opacity = '1'
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(domToCanvas).toHaveBeenCalledTimes(2)
    const hidden = doc.createElement('div')
    hidden.style.display = 'none'
    doc.body.append(hidden)
    const clears = context.clearRect.mock.calls.length
    hidden.append(wrapper)
    await Promise.resolve()
    expect(context.clearRect.mock.calls.length).toBeGreaterThan(clears)
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(reports.at(-1)?.code).toBe('unsafe-content')
    hidden.style.display = 'block'
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(domToCanvas).toHaveBeenCalledTimes(3)
    bridge.dispose()
    hidden.style.display = 'none'
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(domToCanvas).toHaveBeenCalledTimes(3)
    expect(parent.isConnected).toBe(true)
  })
})
