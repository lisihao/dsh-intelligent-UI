import { canvasIsolatedFrameDocument } from './canvas-isolated-frame.js'
import { CanvasHtmlTextureError, createCanvasHtmlTextureBridge, readCanvasHtmlTextureSource } from './canvas-html-texture.js'
import { acquireCanvasSlot, canvasEffectUrl } from './canvas-runtime-client.js'

type IsolatedSlug = 'bend' | 'hex-float'
type PaintSource = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type PaintContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }

export interface CanvasIsolatedOptions {
  /** A separate, plugin-owned visual area; it must not contain the original. */
  host: HTMLElement
  /** The original, visible, non-interactive visual source remains untouched. */
  content: HTMLElement
  slug: IsolatedSlug
  signal?: AbortSignal
  onError(error: Error): void
}

export interface CanvasIsolatedEffect { destroy(): void }

const MAX_MODULE_BYTES = 8 * 1024 * 1024
const SLOT_TIMEOUT_MS = 15_000
const FRAME_TIMEOUT_MS = 5_000
const MODULE_TIMEOUT_MS = 30_000
const DESTROY_GRACE_MS = 250

function assertSeparate(source: Element, visual: Element): void {
  const a = source.getBoundingClientRect(), b = visual.getBoundingClientRect()
  const valid = (rect: DOMRect) => [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
  if (!valid(a) || !valid(b)) throw new Error('CANVAS_ISOLATED_HIDDEN: 来源或效果区域不可见。')
  if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
    throw new Error('CANVAS_ISOLATED_OVERLAP: 效果不能遮挡原始内容。')
  }
}

async function readModule(slug: IsolatedSlug, signal: AbortSignal): Promise<string> {
  // The application host constructs this route and verifies pinned upstream
  // source hashes; neither the URL nor the module is supplied by the caller.
  const response = await fetch(canvasEffectUrl(slug, 0), { signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  // ai-design-check-ignore-next-line locale-aware-case -- HTTP media types are ASCII protocol identifiers.
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (!response.ok || contentType !== 'text/javascript') {
    throw new Error('CANVAS_ISOLATED_MODULE: 固定效果模块不可用。')
  }
  const length = response.headers.get('content-length')
  if (length && /^\d+$/u.test(length) && Number(length) > MAX_MODULE_BYTES) throw new Error('CANVAS_ISOLATED_MODULE_SIZE')
  if (!response.body) throw new Error('CANVAS_ISOLATED_MODULE_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > MAX_MODULE_BYTES) { await reader.cancel(); throw new Error('CANVAS_ISOLATED_MODULE_SIZE') }
      chunks.push(result.value)
    }
  } finally { reader.releaseLock() }
  if (!total) throw new Error('CANVAS_ISOLATED_MODULE_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/**
 * A visual-only iframe runner for Bend and Hex Float. The fixed module runs in
 * an opaque-origin document, never in the caller's JS realm. Source HTML and
 * interactive controls are not forwarded; only an inert bitmap is transferred.
 * A frame can navigate itself even with connect-src 'none'; only the host's
 * fixed, integrity-checked module is trusted to receive the bitmap.
 * The consumer must keep the original visible and remain mounted until destroy.
 */
export function createCanvasIsolatedEffect(options: CanvasIsolatedOptions): Promise<CanvasIsolatedEffect> {
  const { host, content, slug, signal, onError } = options
  if (slug !== 'bend' && slug !== 'hex-float') return Promise.reject(new Error('CANVAS_ISOLATED_SLUG'))
  if (signal?.aborted) return Promise.reject(new Error('CANVAS_ISOLATED_ABORTED'))
  if (!host.isConnected || host.ownerDocument !== content.ownerDocument || host === content || host.contains(content) || content.contains(host)) {
    return Promise.reject(new Error('CANVAS_ISOLATED_HOST: 效果区域必须与原文分开。'))
  }
  const doc = host.ownerDocument
  const view = doc.defaultView
  if (!view || !doc.body || typeof view.matchMedia !== 'function' || typeof view.createImageBitmap !== 'function' || typeof view.MessageChannel !== 'function'
    || typeof view.URL.createObjectURL !== 'function' || typeof view.URL.revokeObjectURL !== 'function'
    || typeof view.requestAnimationFrame !== 'function' || typeof view.cancelAnimationFrame !== 'function'
    || typeof view.IntersectionObserver !== 'function' || typeof view.MutationObserver !== 'function' || host.getRootNode() !== doc) {
    return Promise.reject(new Error('CANVAS_ISOLATED_UNAVAILABLE: 此环境无法安全运行该效果。'))
  }
  const win = view
  const hostSize = host.getBoundingClientRect()
  if (!Number.isFinite(hostSize.width) || !Number.isFinite(hostSize.height) || hostSize.width <= 0 || hostSize.height <= 0) {
    return Promise.reject(new Error('CANVAS_ISOLATED_HOST_SIZE: 效果区域尚未显示。'))
  }
  let size: ReturnType<typeof readCanvasHtmlTextureSource>
  try { size = readCanvasHtmlTextureSource(content); assertSeparate(content, host) } catch (error) { return Promise.reject(error) }
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.reject(new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.'))
  }

  return new Promise((resolve, reject) => {
    const lifetime = new AbortController()
    const frame = doc.createElement('iframe')
    const source = doc.createElement('canvas') as PaintSource
    const random = win.crypto.getRandomValues(new Uint8Array(16))
    const nonce = Array.from(random, value => value.toString(16).padStart(2, '0')).join('')
    const frameUrl = win.URL.createObjectURL(new win.Blob([canvasIsolatedFrameDocument(nonce)], { type: 'text/html' }))
    let bridge: ReturnType<typeof createCanvasHtmlTextureBridge> | undefined
    let port: MessagePort | undefined
    let releaseSlot: (() => void) | undefined
    let timer: number | undefined
    let geometryFrame: number | undefined
    let intersection: IntersectionObserver | undefined
    let ancestorObserver: MutationObserver | undefined
    let settled = false
    let alive = true
    let revision = 0
    let ready = false
    let started = false
    let bootstrapReceived = false
    let loadEvents = 0
    let frameUrlRevoked = false
    let contentInView = false
    let frameInView = false
    let shown = false

    const revokeFrameUrl = () => {
      if (!frameUrlRevoked) { frameUrlRevoked = true; win.URL.revokeObjectURL(frameUrl) }
    }
    const frameIsOurs = () => frame.isConnected && frame.getAttribute('src') === frameUrl && !frame.hasAttribute('srcdoc')

    const removeFrame = () => {
      port?.close(); port = undefined; frame.remove()
      releaseSlot?.(); releaseSlot = undefined
    }
    const close = (): Error | undefined => {
      if (!alive) return undefined
      alive = false
      lifetime.abort()
      if (timer !== undefined) win.clearTimeout(timer)
      if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
      geometryFrame = undefined
      intersection?.disconnect()
      ancestorObserver?.disconnect()
      signal?.removeEventListener('abort', abort)
      win.removeEventListener('message', onBootstrap)
      win.removeEventListener('resize', updateVisibility)
      doc.removeEventListener('visibilitychange', updateVisibility)
      doc.removeEventListener('transitionend', updateVisibility, true)
      doc.removeEventListener('animationend', updateVisibility, true)
      frame.onload = null; frame.onerror = null
      revokeFrameUrl()
      source.onpaint = null
      let cleanupError: Error | undefined
      try { bridge?.dispose() } catch (error) { cleanupError = error instanceof Error ? error : new Error(String(error)) }
      source.remove()
      frame.style.display = 'none'
      // Give the child one chance to release its WebGL objects explicitly;
      // remove the entire realm even if a blocked page cannot acknowledge it.
      if (port && started && frame.isConnected) {
        try { port.postMessage({ type: 'destroy' }) } catch { /* the frame may already be gone */ }
        win.setTimeout(removeFrame, DESTROY_GRACE_MS)
      } else removeFrame()
      return cleanupError
    }
    const fail = (error: unknown) => {
      if (!alive) return
      let failure = error instanceof Error ? error : new Error(String(error))
      const cleanupError = close()
      if (cleanupError) failure = new AggregateError([failure, cleanupError], 'Canvas UI could not release all isolated resources.')
      if (!settled) { settled = true; reject(failure) } else onError(failure)
    }
    function abort() { fail(new Error('CANVAS_ISOLATED_ABORTED')) }
    function hostIsVisible() {
      let opacity = 1
      for (let node: HTMLElement | null = host; node; node = node.parentElement) {
        const style = win.getComputedStyle(node)
        const alpha = Number(style.opacity || 1)
        if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true'
          || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden' || !Number.isFinite(alpha)) return false
        opacity *= alpha
      }
      return opacity >= 0.5
    }
    function suspend() {
      shown = false
      frame.style.visibility = 'hidden'
      if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
      geometryFrame = undefined
    }
    function watchAncestors() {
      if (!ancestorObserver) return
      ancestorObserver.disconnect()
      const ancestors = new Set<HTMLElement>()
      for (const root of [host, content]) for (let node: HTMLElement | null = root; node; node = node.parentElement) ancestors.add(node)
      for (const node of ancestors) ancestorObserver.observe(node, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'] })
    }
    function checkGeometry() {
      geometryFrame = undefined
      if (!alive) return
      if (!host.isConnected || !content.isConnected || !frame.isConnected) { fail(new Error('CANVAS_ISOLATED_DETACHED')); return }
      if (!contentInView || !frameInView || doc.visibilityState !== 'visible' || !hostIsVisible()) { suspend(); return }
      try { assertSeparate(content, host); assertSeparate(content, frame) } catch (error) { fail(error); return }
      if (!shown) {
        shown = true
        frame.style.visibility = 'visible'
        if (settled) source.requestPaint?.()
      }
      geometryFrame = win.requestAnimationFrame(checkGeometry)
    }
    function updateVisibility() {
      if (!alive) return
      if (!host.isConnected || !content.isConnected || !frame.isConnected) { fail(new Error('CANVAS_ISOLATED_DETACHED')); return }
      if (!contentInView || !frameInView || doc.visibilityState !== 'visible' || !hostIsVisible()) { suspend(); return }
      if (geometryFrame === undefined) checkGeometry()
    }
    signal?.addEventListener('abort', abort, { once: true })
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.title = '视觉效果'
    frame.tabIndex = -1
    frame.style.cssText = 'display:block;border:0;width:100%;height:100%;visibility:hidden;pointer-events:none'
    frame.src = frameUrl
    source.width = size.width; source.height = size.height
    source.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
    try {
      doc.body.append(source)
      bridge = createCanvasHtmlTextureBridge({ source, content, scope: 'visual-only', sourceRemainsVisible: true, onError: fail })
      const context = source.getContext('2d') as PaintContext | null
      if (!context) throw new Error('CANVAS_ISOLATED_CONTEXT')
      source.onpaint = () => {
        if (!alive || !port || (!shown && settled)) return
        try {
          const current = readCanvasHtmlTextureSource(content)
          if (source.width !== current.width) source.width = current.width
          if (source.height !== current.height) source.height = current.height
          context.clearRect(0, 0, source.width, source.height)
          context.drawElementImage?.(content, 0, 0)
          const captured = ++revision
          void win.createImageBitmap(source).then(bitmap => {
            if (!alive || !port || captured !== revision) { bitmap.close(); return }
            port.postMessage({ type: 'bitmap', bitmap, revision: captured }, [bitmap])
          }).catch(fail)
        } catch (error) { fail(error) }
      }
    } catch (error) { fail(error); return }

    function onBootstrap(event: MessageEvent) {
      if (!alive || bootstrapReceived || event.source !== frame.contentWindow || event.origin !== 'null'
        || event.data?.type !== 'canvas-isolated-bootstrap' || event.data?.nonce !== nonce || event.ports.length !== 1) return
      if (!frameIsOurs()) { fail(new Error('CANVAS_ISOLATED_NAVIGATED')); return }
      bootstrapReceived = true
      win.removeEventListener('message', onBootstrap)
      revokeFrameUrl()
      const framePort = event.ports[0]!
      port = framePort
      framePort.onmessage = message => {
        const value = message.data as { type?: unknown, error?: unknown } | null
        if (value?.type === 'destroyed') { removeFrame(); return }
        if (!alive) return
        if (value?.type === 'paint') source.requestPaint?.()
        else if (value?.type === 'ready') ready = true
        else if (value?.type === 'drawn' && ready && !settled) {
          settled = true
          if (timer !== undefined) win.clearTimeout(timer)
          resolve({ destroy() { const error = close(); if (error) onError(error) } })
        } else if (value?.type === 'error') fail(new Error(`CANVAS_ISOLATED_EFFECT: ${String(value.error)}`))
      }
      if (timer !== undefined) win.clearTimeout(timer)
      timer = win.setTimeout(() => fail(new Error('CANVAS_ISOLATED_TIMEOUT: 效果模块启动超时。')), MODULE_TIMEOUT_MS)
      void readModule(slug, lifetime.signal).then(module => {
        if (!alive) return
        if (!frameIsOurs() || !port) { fail(new Error('CANVAS_ISOLATED_NAVIGATED')); return }
        const background = win.getComputedStyle(content).backgroundColor
        port.postMessage({ type: 'canvas-isolated-start', factory: slug === 'bend' ? 'createBend' : 'createHexFloat', module, background })
        started = true
      }).catch(fail)
    }
    win.addEventListener('message', onBootstrap)
    frame.onerror = () => fail(new Error('CANVAS_ISOLATED_FRAME: 无法打开隔离页面。'))
    frame.onload = () => {
      if (!alive) return
      if (++loadEvents > 1 || !frameIsOurs()) fail(new Error('CANVAS_ISOLATED_NAVIGATED'))
    }
    timer = win.setTimeout(() => fail(new Error('CANVAS_ISOLATED_BUSY: 当前视觉效果较多，请稍后重试。')), SLOT_TIMEOUT_MS)
    releaseSlot = acquireCanvasSlot(() => queueMicrotask(() => {
      if (!alive) return
      if (timer !== undefined) win.clearTimeout(timer)
      try {
        host.append(frame)
        intersection = new win.IntersectionObserver(entries => {
          for (const entry of entries) {
            const inView = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
            if (entry.target === content) contentInView = inView
            else if (entry.target === frame) frameInView = inView
          }
          updateVisibility()
        })
        ancestorObserver = new win.MutationObserver(() => { watchAncestors(); updateVisibility() })
        watchAncestors()
        doc.addEventListener('visibilitychange', updateVisibility)
        doc.addEventListener('transitionend', updateVisibility, true)
        doc.addEventListener('animationend', updateVisibility, true)
        win.addEventListener('resize', updateVisibility)
        intersection.observe(content)
        intersection.observe(frame)
        if (!alive) return
        timer = win.setTimeout(() => fail(new Error('CANVAS_ISOLATED_CSP: 当前页面无法启动隔离效果。')), FRAME_TIMEOUT_MS)
      } catch (error) { fail(error) }
    }))
    if (signal?.aborted) abort()
  })
}
