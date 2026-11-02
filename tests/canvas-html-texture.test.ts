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

function fixture(captureTextRects = false) {
  const content = document.createElement('div')
  content.innerHTML = '<pre><code><span>const value = 42</span></code></pre>'
  dimensions(content)
  const source = document.createElement('canvas')
  document.body.append(content, source)
  const bridge = createCanvasHtmlTextureBridge({ source, content, scope: 'visual-only', sourceRemainsVisible: true, captureTextRects, onError: error => reports.push(error) })
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

function stubTextRanges(frame: HTMLIFrameElement, boxes: (node: Node) => Array<{ left: number, top: number, right: number, bottom: number }>) {
  const doc = frame.contentDocument!
  const factory = () => {
    let selected: Node | undefined
    return {
      selectNodeContents(node: Node) { selected = node },
      getClientRects() { return selected ? boxes(selected) : [] },
    }
  }
  Object.defineProperty(doc, 'createRange', { configurable: true, value: factory })
  vi.spyOn(frame.ownerDocument, 'createRange').mockImplementation(factory as unknown as typeof document.createRange)
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
    if (!contexts.has(this)) contexts.set(this, { drawImage: vi.fn(), clearRect: vi.fn() })
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

  it('leaves the default capture path unchanged and does not measure text', async () => {
    const { bridge } = fixture()
    const pending = bridge.refresh()
    const frame = document.querySelector('iframe')!
    Object.defineProperty(frame.contentDocument!, 'createRange', { configurable: true, value: () => { throw new Error('unexpected text measurement') } })
    loadSnapshotFrame(frame)
    await pending
    expect(bridge.getSnapshot?.()).toBeUndefined()
    expect(reports).toEqual([])
    bridge.dispose()
  })

  it('publishes bounded sandbox geometry with the matching bitmap and no text', async () => {
    const { bridge, source, content } = fixture(true)
    const ctx = source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage: (node: Element, x: number, y: number) => void }
    const observed: Array<{ snapshot: ReturnType<NonNullable<typeof bridge.getSnapshot>>, bitmap: HTMLCanvasElement }> = []
    ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => {
      const snapshot = bridge.getSnapshot?.()
      if (!snapshot) return
      ctx.drawElementImage(content, 0, 0)
      const bitmap = vi.mocked(ctx.drawImage).mock.lastCall![0] as HTMLCanvasElement
      observed.push({ snapshot, bitmap })
    }
    const pending = bridge.refresh()
    const frame = document.querySelector('iframe')!
    stubTextRanges(frame, () => [
      { left: -5, top: 10, right: 25, bottom: 30 },
      { left: 310, top: 150, right: 340, bottom: 180 },
      { left: 400, top: 200, right: 420, bottom: 220 },
    ])
    loadSnapshotFrame(frame)
    await pending
    expect(observed).toHaveLength(1)
    expect(observed[0]!.snapshot).toEqual({ revision: 1, width: 320, height: 160, textRects: [
      { x: 0, y: 10, width: 25, height: 20 },
      { x: 310, y: 150, width: 10, height: 10 },
    ] })
    expect(JSON.stringify(observed[0]!.snapshot)).not.toContain('const value')
    expect(Object.isFrozen(observed[0]!.snapshot)).toBe(true)
    expect(Object.isFrozen(observed[0]!.snapshot!.textRects)).toBe(true)
    expect(Object.isFrozen(observed[0]!.snapshot!.textRects[0])).toBe(true)
    expect(observed[0]!.bitmap.width).toBe(320)
    expect(bridge.getSnapshot?.()).toBe(observed[0]!.snapshot)
    bridge.dispose()
    expect(bridge.getSnapshot?.()).toBeUndefined()
    expect(observed[0]!.bitmap.width).toBe(0)
  })

  it('excludes invisible and transparent text but keeps visible descendants', async () => {
    const { bridge, content } = fixture(true)
    content.innerHTML = '<span style="visibility:hidden">hidden</span><span style="opacity:0">transparent</span><span style="color:transparent">no color</span><div style="visibility:hidden"><span style="visibility:visible">visible</span></div>'
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame)
    await pending
    expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 35, height: 10 }])
    bridge.dispose()
  })

  it('keeps opaque black text instead of treating its blue channel as an alpha channel', async () => {
    const { bridge, content } = fixture(true)
    content.innerHTML = '<span style="color:rgb(0,0,0)">black</span><span style="color:rgba(0,0,0,0)">transparent</span>'
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame)
    await pending
    expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 25, height: 10 }])
    bridge.dispose()
  })

  it('clips a text rectangle to the padding edge of each hidden overflow ancestor', async () => {
    const { bridge, content } = fixture(true)
    content.innerHTML = '<div style="overflow:hidden;border:2px solid black"><span>long clipped text</span></div>'
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    const bounds = function (this: HTMLElement) {
      const box = this.style.overflow === 'hidden' ? { left: 10, top: 8, right: 74, bottom: 48 } : { left: 0, top: 0, right: 320, bottom: 160 }
      return { ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => ({}) } as DOMRect
    }
    for (const doc of [document, frame.contentDocument!]) vi.spyOn(Object.getPrototypeOf(doc.createElement('div')) as HTMLElement, 'getBoundingClientRect').mockImplementation(bounds)
    stubTextRanges(frame, () => [{ left: 0, top: 0, right: 234, bottom: 35 }])
    loadSnapshotFrame(frame)
    await pending
    expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 12, y: 10, width: 60, height: 25 }])
    bridge.dispose()
  })

  it('combines independent horizontal and vertical ancestor clips', async () => {
    const { bridge, content } = fixture(true)
    content.innerHTML = '<div style="overflow-x:hidden;overflow-y:auto"><div style="overflow-y:hidden;overflow-x:auto"><span>nested clipped text</span></div></div>'
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    const bounds = function (this: HTMLElement) {
      const box = this.style.overflowX === 'hidden' ? { left: 10, top: 0, right: 90, bottom: 160 }
        : this.style.overflowY === 'hidden' ? { left: 0, top: 20, right: 320, bottom: 80 }
          : { left: 0, top: 0, right: 320, bottom: 160 }
      return { ...box, x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, toJSON: () => ({}) } as DOMRect
    }
    for (const doc of [document, frame.contentDocument!]) vi.spyOn(Object.getPrototypeOf(doc.createElement('div')) as HTMLElement, 'getBoundingClientRect').mockImplementation(bounds)
    stubTextRanges(frame, () => [{ left: 0, top: 0, right: 200, bottom: 120 }])
    loadSnapshotFrame(frame)
    await pending
    expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 10, y: 20, width: 80, height: 60 }])
    bridge.dispose()
  })

  it.each([
    ['clip-path', 'clip-path:inset(5px)'],
    ['filter', 'filter:blur(2px)'],
    ['mask', 'mask-image:linear-gradient(black,transparent)'],
    ['text shadow', 'text-shadow:18px 8px 0 #000'],
    ['individual rotation', 'rotate:15deg'],
    ['rounded overflow', 'overflow:hidden;border-radius:8px'],
  ])('fails closed for unsupported %s geometry', async (_name, css) => {
    const { bridge, content } = fixture(true)
    content.innerHTML = `<span style="${css}">source text</span>`
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, () => [{ left: 0, top: 0, right: 40, bottom: 10 }])
    loadSnapshotFrame(frame)
    await expect(pending).rejects.toMatchObject({ code: 'unsupported' })
    expect(bridge.getSnapshot?.()).toBeUndefined()
    expect(vi.mocked(domToCanvas)).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it('discards an outdated in-flight bitmap and its text rectangles before notification', async () => {
    const { bridge, source, content } = fixture(true)
    const ctx = source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage: (node: Element, x: number, y: number) => void }
    let finishOld!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const snapshots: Array<ReturnType<NonNullable<typeof bridge.getSnapshot>>> = []
    ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => {
      snapshots.push(bridge.getSnapshot?.())
      ctx.drawElementImage(content, 0, 0)
    }
    const first = bridge.refresh()
    const frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame)
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'))
    content.textContent = 'new value'
    const second = bridge.refresh()
    const obsolete = document.createElement('canvas'); obsolete.width = 320; obsolete.height = 160
    finishOld(obsolete)
    await Promise.all([first, second])
    expect(obsolete.width).toBe(0)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.revision).toBeGreaterThan(1)
    expect(snapshots[0]!.textRects).toEqual([{ x: 0, y: 0, width: 45, height: 10 }])
    expect(vi.mocked(ctx.drawImage)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ctx.drawImage).mock.lastCall![0]).not.toBe(obsolete)
    bridge.dispose()
  })

  it('invalidates a committed text snapshot on mutation while an older capture is in flight, then restores the new one', async () => {
    const { bridge, source, content } = fixture(true)
    const ctx = source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage: (node: Element, x: number, y: number) => void }
    const seen: Array<ReturnType<NonNullable<typeof bridge.getSnapshot>>> = []
    ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => {
      seen.push(bridge.getSnapshot?.())
      ctx.drawElementImage(content, 0, 0)
    }
    const initial = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame)
    await initial
    const previous = vi.mocked(ctx.drawImage).mock.lastCall![0] as HTMLCanvasElement
    let finishOld!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    ;(source as HTMLCanvasElement & { requestPaint: () => void }).requestPaint()
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'))
    content.textContent = 'new value'
    await Promise.resolve() // MutationObserver notification before the old capture can resolve.
    expect(bridge.getSnapshot?.()).toBeUndefined()
    expect(previous.width).toBe(0)
    expect(seen.at(-1)).toBeUndefined()
    expect(vi.mocked(ctx.clearRect)).toHaveBeenCalled()
    const old = document.createElement('canvas'); old.width = 320; old.height = 160
    finishOld(old)
    await vi.waitFor(() => expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 45, height: 10 }]))
    expect(old.width).toBe(0)
    expect(seen).toHaveLength(3)
    expect(seen[1]).toBeUndefined()
    expect(seen[2]?.revision).toBeGreaterThan(seen[0]!.revision)
    bridge.dispose()
  })

  it('clears a text snapshot on synchronous manual refresh and keeps the non-text path unchanged', async () => {
    const text = fixture(true), textSeen: Array<ReturnType<NonNullable<typeof text.bridge.getSnapshot>>> = []
    ;(text.source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => textSeen.push(text.bridge.getSnapshot?.())
    const initialText = text.bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame); await initialText
    text.content.textContent = 'replacement'
    const refreshed = text.bridge.refresh()
    expect(text.bridge.getSnapshot?.()).toBeUndefined()
    expect(textSeen.at(-1)).toBeUndefined()
    await refreshed
    expect(text.bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 55, height: 10 }])
    text.bridge.dispose()

    const ordinary = fixture(), ctx = ordinary.source.getContext('2d') as CanvasRenderingContext2D & { drawElementImage: (node: Element, x: number, y: number) => void }
    let paints = 0
    ;(ordinary.source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => { paints++; ctx.drawElementImage(ordinary.content, 0, 0) }
    const initial = ordinary.bridge.refresh(), ordinaryFrame = document.querySelector('iframe')!
    loadSnapshotFrame(ordinaryFrame); await initial
    const previous = vi.mocked(ctx.drawImage).mock.lastCall![0] as HTMLCanvasElement
    ordinary.content.textContent = 'changed'
    await Promise.resolve()
    expect(previous.width).toBe(320)
    expect(paints).toBe(1)
    expect(vi.mocked(ctx.clearRect)).not.toHaveBeenCalled()
    ordinary.bridge.dispose()
  })

  it('rejects a text snapshot when source and isolated font layouts differ', async () => {
    const { bridge, content } = fixture(true)
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: node.ownerDocument === document ? 200 : 100, bottom: 10 }])
    loadSnapshotFrame(frame)
    await expect(pending).rejects.toMatchObject({ code: 'unsupported', message: 'The visual text layout differs from the original source.' })
    expect(vi.mocked(domToCanvas)).not.toHaveBeenCalled()
    expect(bridge.getSnapshot?.()).toBeUndefined()
    expect(content.textContent).toBe('const value = 42')
    bridge.dispose()
  })

  it('discards a capture when a same-turn mutation precedes its queued observer callback', async () => {
    const { bridge, content } = fixture(true)
    const initial = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame); await initial
    const pending = bridge.refresh()
    content.textContent = 'new value'
    await expect(pending).resolves.toBeUndefined()
    expect(reports).toEqual([])
    expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 45, height: 10 }])
    bridge.dispose()
  })

  it('does not keep the old text snapshot when requestPaint follows a same-turn mutation', async () => {
    const { bridge, source, content } = fixture(true)
    const initial = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: (node.textContent?.length ?? 0) * 5, bottom: 10 }])
    loadSnapshotFrame(frame); await initial
    await new Promise(resolve => setTimeout(resolve, 300))
    let finish!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    content.textContent = 'new value'
    ;(source as HTMLCanvasElement & { requestPaint: () => void }).requestPaint()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(bridge.getSnapshot?.()).toBeUndefined()
    const bitmap = document.createElement('canvas'); bitmap.width = 320; bitmap.height = 160
    finish(bitmap)
    await vi.waitFor(() => expect(bridge.getSnapshot?.()?.textRects).toEqual([{ x: 0, y: 0, width: 45, height: 10 }]))
    bridge.dispose()
  })

  it('checks live text layout again after asynchronous capture before publishing its bitmap', async () => {
    const { bridge } = fixture(true)
    let drift = false, finish!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = bridge.refresh(), frame = document.querySelector('iframe')!
    stubTextRanges(frame, node => [{ left: 0, top: 0, right: drift && node.ownerDocument === document ? 140 : 100, bottom: 10 }])
    loadSnapshotFrame(frame)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    drift = true
    const bitmap = document.createElement('canvas'); bitmap.width = 320; bitmap.height = 160
    finish(bitmap)
    await expect(pending).rejects.toMatchObject({ code: 'unsupported' })
    expect(bitmap.width).toBe(0)
    expect(bridge.getSnapshot?.()).toBeUndefined()
    bridge.dispose()
  })

  it('invalidates text geometry on font loading and detaches the font listeners on disposal', async () => {
    const fonts = new EventTarget(), original = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    try {
      const { bridge, source } = fixture(true)
      const seen: Array<ReturnType<NonNullable<typeof bridge.getSnapshot>>> = []
      ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => seen.push(bridge.getSnapshot?.())
      const initial = bridge.refresh(), frame = document.querySelector('iframe')!
      stubTextRanges(frame, () => [{ left: 0, top: 0, right: 100, bottom: 10 }])
      loadSnapshotFrame(frame); await initial
      fonts.dispatchEvent(new Event('loadingdone'))
      expect(bridge.getSnapshot?.()).toBeUndefined()
      expect(seen.at(-1)).toBeUndefined()
      await vi.waitFor(() => expect(bridge.getSnapshot?.()?.textRects).toHaveLength(1))
      bridge.dispose()
      const calls = vi.mocked(domToCanvas).mock.calls.length
      fonts.dispatchEvent(new Event('loading'))
      await Promise.resolve()
      expect(vi.mocked(domToCanvas)).toHaveBeenCalledTimes(calls)
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('clears the committed geometry on failure and never publishes after disposal', async () => {
    const { bridge, source } = fixture(true)
    const seen: Array<ReturnType<NonNullable<typeof bridge.getSnapshot>>> = []
    ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => seen.push(bridge.getSnapshot?.())
    const initial = bridge.refresh()
    const frame = document.querySelector('iframe')!
    stubTextRanges(frame, () => [{ left: 1, top: 2, right: 21, bottom: 12 }])
    loadSnapshotFrame(frame)
    await initial
    expect(seen[0]?.textRects).toHaveLength(1)
    vi.mocked(domToCanvas).mockRejectedValueOnce(new Error('capture failed'))
    await expect(bridge.refresh()).rejects.toMatchObject({ code: 'capture' })
    expect(seen.at(-1)).toBeUndefined()
    expect(bridge.getSnapshot?.()).toBeUndefined()
    let finish!: (canvas: HTMLCanvasElement) => void
    vi.mocked(domToCanvas).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = bridge.refresh()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const calls = seen.length
    bridge.dispose()
    const discarded = document.createElement('canvas'); discarded.width = 320; discarded.height = 160
    finish(discarded)
    await pending
    expect(discarded.width).toBe(0)
    expect(seen).toHaveLength(calls)
    expect(bridge.getSnapshot?.()).toBeUndefined()
  })

  it('fails closed when a text layout exceeds the rectangle limit', async () => {
    const { bridge, source } = fixture(true)
    const seen: Array<ReturnType<NonNullable<typeof bridge.getSnapshot>>> = []
    ;(source as HTMLCanvasElement & { onpaint?: () => void }).onpaint = () => seen.push(bridge.getSnapshot?.())
    const pending = bridge.refresh()
    const frame = document.querySelector('iframe')!
    stubTextRanges(frame, () => Array.from({ length: 513 }, () => ({ left: 1, top: 2, right: 21, bottom: 12 })))
    loadSnapshotFrame(frame)
    await expect(pending).rejects.toMatchObject({ code: 'too-large' })
    expect(vi.mocked(domToCanvas)).not.toHaveBeenCalled()
    expect(seen).toEqual([undefined])
    expect(bridge.getSnapshot?.()).toBeUndefined()
    bridge.dispose()
  })

  it('bounds text node count and rejects non-finite text geometry', async () => {
    const tooMany = fixture(true)
    tooMany.content.replaceChildren(...Array.from({ length: 513 }, () => document.createTextNode('x')))
    const first = tooMany.bridge.refresh()
    const firstFrame = document.querySelector('iframe')!
    stubTextRanges(firstFrame, () => [{ left: 1, top: 2, right: 21, bottom: 12 }])
    loadSnapshotFrame(firstFrame)
    await expect(first).rejects.toMatchObject({ code: 'too-large', message: 'The visual source has too many text nodes.' })
    expect(tooMany.bridge.getSnapshot?.()).toBeUndefined()
    tooMany.bridge.dispose()

    const invalid = fixture(true)
    const second = invalid.bridge.refresh()
    const secondFrame = document.querySelector('iframe')!
    stubTextRanges(secondFrame, () => [{ left: NaN, top: 0, right: 10, bottom: 10 }])
    loadSnapshotFrame(secondFrame)
    await expect(second).rejects.toMatchObject({ code: 'capture' })
    expect(invalid.bridge.getSnapshot?.()).toBeUndefined()
    invalid.bridge.dispose()
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
