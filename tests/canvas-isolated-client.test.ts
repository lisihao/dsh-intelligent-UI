// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return {
    ...actual,
    createCanvasHtmlTextureBridge: vi.fn(({ source }: { source: HTMLCanvasElement }) => {
      Object.defineProperty(source, 'requestPaint', { configurable: true, value: vi.fn() })
      return { refresh: vi.fn(), dispose: vi.fn() }
    }),
  }
})

import { createCanvasIsolatedEffect } from '../src/canvas-isolated-client.js'
import { CANVAS_ISOLATED_FRAME_CSP, canvasIsolatedFrameDocument } from '../src/canvas-isolated-frame.js'
import { acquireCanvasSlot } from '../src/canvas-runtime-client.js'

class ChannelStub { port1 = { close: vi.fn(), postMessage: vi.fn(), onmessage: null }; port2 = {} }
let reduced = false
let geometryCheck: FrameRequestCallback | undefined
let pageVisible = true
let intersection: IntersectionStub | undefined

class IntersectionStub {
  disconnect = vi.fn()
  observe = vi.fn()
  constructor(private callback: IntersectionObserverCallback) { intersection = this }
  emit(target: Element, visible: boolean) {
    const entry = { target, isIntersecting: visible, intersectionRect: { width: visible ? 100 : 0, height: visible ? 100 : 0 } }
    this.callback([entry as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function bootstrap(frame: HTMLIFrameElement) {
  const channel = new ChannelStub()
  window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { type: 'canvas-isolated-bootstrap', nonce: '01'.repeat(16) }, ports: [channel.port1 as unknown as MessagePort] }))
  return channel
}

function fixture() {
  const host = document.createElement('section')
  const content = document.createElement('div')
  content.textContent = 'Original visual source'
  host.getBoundingClientRect = () => ({ x: 340, y: 0, left: 340, top: 0, right: 660, bottom: 160, width: 320, height: 160, toJSON: () => ({}) }) as DOMRect
  content.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 160, width: 320, height: 160, toJSON: () => ({}) }) as DOMRect
  document.body.append(host, content)
  return { host, content, slug: 'bend' as const, onError: vi.fn() }
}

beforeEach(() => {
  reduced = false
  geometryCheck = undefined
  intersection = undefined
  pageVisible = true
  class URLStub extends URL {
    static createObjectURL = vi.fn(() => 'blob:http://localhost/fixed-document')
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', URLStub)
  vi.stubGlobal('MessageChannel', ChannelStub)
  vi.stubGlobal('createImageBitmap', vi.fn())
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { geometryCheck = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('IntersectionObserver', IntersectionStub)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => pageVisible ? 'visible' : 'hidden')
  vi.spyOn(window.crypto, 'getRandomValues').mockImplementation((value: any) => { value.fill(1); return value })
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: reduced }) as MediaQueryList)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = (element as HTMLElement).style
    return {
      position: style.position || 'static', transform: style.transform || 'none',
      overflowX: style.overflowX || 'visible', overflowY: style.overflowY || 'visible',
      display: style.display || 'block', visibility: style.visibility || 'visible', opacity: style.opacity || '1',
      content: pseudo ? 'none' : 'normal', length: style.length,
      item: (index: number) => style.item(index),
      getPropertyValue: (name: string) => style.getPropertyValue(name),
    } as CSSStyleDeclaration
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLIFrameElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 340, y: 0, left: 340, top: 0, right: 660, bottom: 160, width: 320, height: 160, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isolated Canvas UI effects', () => {
  it('has a fixed local opaque-frame document and denies network and user HTML in its bootstrap', () => {
    const html = canvasIsolatedFrameDocument('01'.repeat(16))
    expect(CANVAS_ISOLATED_FRAME_CSP).toContain("connect-src 'none'")
    expect(CANVAS_ISOLATED_FRAME_CSP).toContain("frame-src 'none'")
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|eval\(/u)
    expect(html).toContain("channel.port2")
    expect(html).toContain('value.bitmap instanceof ImageBitmap')
    expect(() => canvasIsolatedFrameDocument('</script>')).toThrow('CANVAS_ISOLATED_NONCE')
  })

  it('rejects interactive source and detached or overlapping hosts without opening a frame', async () => {
    const source = fixture()
    const button = document.createElement('button'); button.textContent = 'Do not clone'
    source.content.append(button)
    await expect(createCanvasIsolatedEffect(source)).rejects.toMatchObject({ code: 'unsafe-content' })
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    button.remove()
    source.content.append(source.host)
    await expect(createCanvasIsolatedEffect(source)).rejects.toThrow('CANVAS_ISOLATED_HOST')
    source.host.remove()
    await expect(createCanvasIsolatedEffect(source)).rejects.toThrow('CANVAS_ISOLATED_HOST')
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('does not open a frame or fetch a module when motion is reduced', async () => {
    reduced = true
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(createCanvasIsolatedEffect(fixture())).rejects.toMatchObject({ code: 'reduced-motion' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })

  it('times out a saturated GPU queue, releases resources, and permits a later retry', async () => {
    vi.useFakeTimers()
    const releaseFirst = acquireCanvasSlot(() => {})
    const releaseSecond = acquireCanvasSlot(() => {})
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_BUSY')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(source.content.textContent).toBe('Original visual source')
    releaseFirst(); releaseSecond()
    const controller = new AbortController()
    const retried = createCanvasIsolatedEffect({ ...source, signal: controller.signal })
    const retryRejected = expect(retried).rejects.toThrow('CANVAS_ISOLATED_ABORTED')
    controller.abort(); await retryRejected
    vi.useRealTimers()
  })

  it('refuses an effect region that covers the original content', async () => {
    const source = fixture()
    source.host.getBoundingClientRect = source.content.getBoundingClientRect
    await expect(createCanvasIsolatedEffect(source)).rejects.toThrow('CANVAS_ISOLATED_OVERLAP')
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })

  it('stops and removes an effect area moved over the original', async () => {
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_OVERLAP')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    intersection!.emit(source.content, true); intersection!.emit(frame, true)
    frame.getBoundingClientRect = source.content.getBoundingClientRect
    geometryCheck?.(0)
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('stops when its own effect frame is removed', async () => {
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_DETACHED')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    intersection!.emit(source.content, true); intersection!.emit(frame, true)
    frame.remove()
    geometryCheck?.(0)
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('hides and pauses geometry work outside the viewport or in a hidden page, then validates before showing', async () => {
    const source = fixture(), controller = new AbortController()
    const pending = createCanvasIsolatedEffect({ ...source, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_ABORTED')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    expect(frame.style.pointerEvents).toBe('none')
    expect(frame.style.visibility).toBe('hidden')
    expect(geometryCheck).toBeUndefined()
    intersection!.emit(source.content, true); intersection!.emit(frame, true)
    expect(frame.style.visibility).toBe('visible')
    expect(geometryCheck).toBeDefined()
    intersection!.emit(source.content, false)
    expect(frame.style.visibility).toBe('hidden')
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
    const oldCheck = geometryCheck
    const count = vi.mocked(window.requestAnimationFrame).mock.calls.length
    oldCheck?.(0)
    expect(vi.mocked(window.requestAnimationFrame)).toHaveBeenCalledTimes(count)
    intersection!.emit(source.content, true)
    expect(frame.style.visibility).toBe('visible')
    pageVisible = false; document.dispatchEvent(new Event('visibilitychange'))
    expect(frame.style.visibility).toBe('hidden')
    pageVisible = true; document.dispatchEvent(new Event('visibilitychange'))
    expect(frame.style.visibility).toBe('visible')
    const watcher = intersection!
    controller.abort(); await rejected
    expect(watcher.disconnect).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })

  it('checks for overlap before restoring a hidden effect', async () => {
    const source = fixture(), controller = new AbortController()
    const pending = createCanvasIsolatedEffect({ ...source, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_OVERLAP')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    intersection!.emit(source.content, true); intersection!.emit(frame, true)
    intersection!.emit(source.content, false)
    frame.getBoundingClientRect = source.content.getBoundingClientRect
    intersection!.emit(source.content, true)
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })

  it('disconnects visibility observers and listeners when an effect is destroyed twice', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('export {}', { headers: { 'content-type': 'text/javascript' } }))
    vi.stubGlobal('fetch', fetcher)
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    intersection!.emit(source.content, true); intersection!.emit(frame, true)
    const watcher = intersection!, channel = bootstrap(frame)
    await vi.waitFor(() => expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'canvas-isolated-start' })))
    const deliver = channel.port1.onmessage as unknown as (message: { data: { type: string } }) => void
    deliver({ data: { type: 'ready' } }); deliver({ data: { type: 'drawn' } })
    const effect = await pending
    effect.destroy(); effect.destroy()
    expect(watcher.disconnect).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('transitionend', expect.any(Function), true)
    expect(removeListener).toHaveBeenCalledWith('animationend', expect.any(Function), true)
    expect(channel.port1.postMessage.mock.calls.filter(([message]: any[]) => message.type === 'destroy')).toHaveLength(1)
    deliver({ data: { type: 'destroyed' } })
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })

  it('uses a fixed same-origin URL and cleans up after a failed module load', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetcher)
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    const rejected = expect(pending).rejects.toThrow('offline')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe('blob:http://localhost/fixed-document')
    expect(fetcher).not.toHaveBeenCalled()
    bootstrap(frame)
    await rejected
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/intelligent-ui-canvas-effect\?slug=bend&revision=/u), expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }))
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fixed-document')
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('aborts an in-flight load and removes the frame without changing the source', async () => {
    let requestSignal: AbortSignal | undefined
    const fetcher = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      requestSignal = init.signal as AbortSignal
      requestSignal.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const source = fixture(), controller = new AbortController()
    const pending = createCanvasIsolatedEffect({ ...source, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_ABORTED')
    await Promise.resolve()
    bootstrap(document.querySelector('iframe')!)
    expect(requestSignal).toBeDefined()
    controller.abort()
    await rejected
    expect(requestSignal?.aborted).toBe(true)
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('rejects an oversized factory response before starting any code', async () => {
    const body = new Uint8Array(8 * 1024 * 1024 + 1)
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/javascript' } }))
    vi.stubGlobal('fetch', fetcher)
    const pending = createCanvasIsolatedEffect(fixture())
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_MODULE_SIZE')
    await Promise.resolve()
    bootstrap(document.querySelector('iframe')!)
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })

  it('does not fetch or transfer content when an iframe is redirected before bootstrap', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const source = fixture()
    const pending = createCanvasIsolatedEffect(source)
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_NAVIGATED')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    frame.setAttribute('src', 'https://example.invalid/redirected')
    bootstrap(frame)
    await rejected
    expect(fetcher).not.toHaveBeenCalled()
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
    expect(source.content.textContent).toBe('Original visual source')
  })

  it('ignores a forged bootstrap that lacks the frame nonce', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const source = fixture(), controller = new AbortController()
    const pending = createCanvasIsolatedEffect({ ...source, signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('CANVAS_ISOLATED_ABORTED')
    await Promise.resolve()
    const frame = document.querySelector('iframe')!
    const channel = new ChannelStub()
    window.dispatchEvent(new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { type: 'canvas-isolated-bootstrap', nonce: '00'.repeat(16) }, ports: [channel.port1 as unknown as MessagePort] }))
    expect(fetcher).not.toHaveBeenCalled()
    expect(channel.port1.postMessage).not.toHaveBeenCalled()
    controller.abort()
    await rejected
    expect(document.querySelectorAll('iframe,canvas')).toHaveLength(0)
  })
})
