import {
  CanvasHtmlTextureError,
  createCanvasHtmlTextureBridge,
  readCanvasHtmlTextureSource,
  type CanvasHtmlTextureBridge,
  type CanvasHtmlTextureOptions,
} from './canvas-html-texture.js'
import type { CanvasEffectFactory, CanvasEffectInstance } from './canvas-runtime-client.js'

/**
 * A source-preserving fallback for Particle Scroll where HTML-in-Canvas is absent.
 * The real scrollable content remains visible and interactive; the GPU canvas is
 * a separate, pointer-transparent visual. Only simple, non-interactive HTML can
 * be snapshotted, and the existing texture bridge enforces its size and resource
 * limits. This does not load or redistribute a Canvas UI component.
 */
export interface CanvasParticleScrollOptions {
  readonly scroll: HTMLElement
  readonly content: HTMLElement
  readonly output: HTMLCanvasElement
  readonly factory: CanvasEffectFactory
  readonly sourceRemainsVisible: true
  readonly scope: 'visual-only'
  readonly onError: (error: CanvasHtmlTextureError) => void
  readonly effectOptions?: Record<string, unknown>
  /** Inject the scoped bridge so the plugin owns its resources. */
  readonly createTextureBridge?: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
}

export interface CanvasParticleScrollBridge {
  refresh(): Promise<void>
  resize(): void
  setOptions(options: Record<string, unknown>): void
  dispose(): void
}

type PaintableCanvas = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type ElementImageContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }

function fail(code: CanvasHtmlTextureError['code'], message: string): never {
  throw new CanvasHtmlTextureError(code, message)
}

/** Position can change without a resize; never allow the copy to cover its source. */
function validatePlacement(scroll: HTMLElement, content: HTMLElement, output: HTMLCanvasElement): void {
  const win = scroll.ownerDocument.defaultView
  if (!win || !scroll.isConnected || !content.isConnected || !output.isConnected) {
    fail('detached', 'The scroll source and visual canvas must remain attached.')
  }
  if (win.getComputedStyle(output).pointerEvents !== 'none') fail('unsafe-content', 'The visual canvas must not intercept the original source.')
  const sourceRect = scroll.getBoundingClientRect()
  const contentRect = content.getBoundingClientRect()
  const outputRect = output.getBoundingClientRect()
  const expectedLeft = sourceRect.left + scroll.clientLeft - scroll.scrollLeft
  const expectedTop = sourceRect.top + scroll.clientTop - scroll.scrollTop
  if (Math.abs(contentRect.left - expectedLeft) > 2 || Math.abs(contentRect.top - expectedTop) > 2) {
    fail('unsupported', 'The captured content is offset from the original scroll viewport.')
  }
  if (sourceRect.left < outputRect.right && sourceRect.right > outputRect.left
    && sourceRect.top < outputRect.bottom && sourceRect.bottom > outputRect.top) {
    fail('unsafe-content', 'The visual canvas must not cover the original source.')
  }
}

/** This narrow geometry makes pixel-to-scroll mapping deterministic. */
function validateGeometry(scroll: HTMLElement, content: HTMLElement, output: HTMLCanvasElement): void {
  const doc = scroll.ownerDocument
  const win = doc.defaultView
  if (!win || !doc.body?.isConnected || !scroll.isConnected || !content.isConnected || !output.isConnected
    || content.ownerDocument !== doc || output.ownerDocument !== doc) {
    fail('detached', 'The scroll source and visual canvas must remain attached to the same document.')
  }
  if (content.parentElement !== scroll || scroll.children.length !== 1 || scroll.contains(output)) {
    fail('unsafe-content', 'The scroll source must have one content element and a separate visual canvas.')
  }
  if ([...scroll.childNodes].some(node => node.nodeType === 3 && !!node.textContent?.trim())) {
    fail('unsafe-content', 'All visible source text must be inside the captured content element.')
  }
  const scrollStyle = win.getComputedStyle(scroll)
  const contentStyle = win.getComputedStyle(content)
  if ([scrollStyle.paddingTop, scrollStyle.paddingRight, scrollStyle.paddingBottom, scrollStyle.paddingLeft,
    contentStyle.marginTop, contentStyle.marginRight, contentStyle.marginBottom, contentStyle.marginLeft]
    .some(value => Number.parseFloat(value) !== 0)) {
    fail('unsafe-content', 'The scroll source requires zero padding and zero outer content margins.')
  }
  if (!['auto', 'scroll'].includes(scrollStyle.overflowY) || scroll.scrollHeight <= scroll.clientHeight
    || scroll.scrollWidth > scroll.clientWidth + 1 || scroll.clientWidth < 1 || scroll.clientHeight < 1) {
    fail('unsupported', 'The original source must be vertically scrollable without horizontal overflow.')
  }
  const contentRect = content.getBoundingClientRect()
  if (scroll.scrollHeight > Math.ceil(contentRect.height) + 2) {
    fail('unsafe-content', 'The scroll source contains content outside the captured element.')
  }
  validatePlacement(scroll, content, output)
  if (Math.abs(output.clientWidth - scroll.clientWidth) > 2 || Math.abs(output.clientHeight - scroll.clientHeight) > 2
    || Math.abs(contentRect.width - scroll.clientWidth) > 1) {
    fail('unsupported', 'The visual canvas must match the source viewport size.')
  }
}

export function createCanvasParticleScrollBridge(options: CanvasParticleScrollOptions): CanvasParticleScrollBridge {
  const { scroll, content, output, factory, onError } = options
  if (options.scope !== 'visual-only' || options.sourceRemainsVisible !== true) {
    fail('unsafe-content', 'The original scroll source must remain visible.')
  }
  validateGeometry(scroll, content, output)
  readCanvasHtmlTextureSource(content)
  const doc = scroll.ownerDocument
  const win = doc.defaultView!
  if (typeof win.requestAnimationFrame !== 'function' || typeof win.cancelAnimationFrame !== 'function' || typeof win.IntersectionObserver !== 'function') {
    fail('unsupported', 'The browser cannot monitor the visual canvas position.')
  }
  const capture = doc.createElement('canvas') as PaintableCanvas
  const source = doc.createElement('canvas') as PaintableCanvas
  const proxy = doc.createElement('div')
  capture.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
  source.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
  source.append(proxy)
  doc.body.append(capture, source)
  const captureCtx = capture.getContext('2d') as ElementImageContext | null
  const sourceCtx = source.getContext('2d') as ElementImageContext | null
  if (!captureCtx || !sourceCtx) {
    capture.remove(); source.remove()
    fail('unsupported', 'The browser cannot create the visual texture.')
  }
  let live = true
  let bitmap = false
  let effect: CanvasEffectInstance | null = null
  let texture: CanvasHtmlTextureBridge | undefined
  let resizeObserver: ResizeObserver | undefined
  let intersectionObserver: IntersectionObserver | undefined
  let geometryFrame: number | undefined
  let lastFailure: CanvasHtmlTextureError | undefined
  let sourceVisible = true, outputVisible = true
  let concealed: { value: string, priority: string } | undefined
  let pending: Promise<void> | undefined
  const setSourceSize = () => {
    source.style.width = `${output.clientWidth}px`
    source.style.height = `${output.clientHeight}px`
    let background = 'transparent'
    for (let element: HTMLElement | null = scroll; element; element = element.parentElement) {
      const candidate = win.getComputedStyle(element).backgroundColor
      if (candidate && candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') { background = candidate; break }
    }
    proxy.style.backgroundColor = background
  }
  const cleanup = () => {
    if (!live) return
    live = false
    scroll.removeEventListener('scroll', onScroll)
    doc.removeEventListener('visibilitychange', onVisibility)
    resizeObserver?.disconnect()
    intersectionObserver?.disconnect()
    if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
    geometryFrame = undefined
    try { effect?.destroy() } finally {
      effect = null
      capture.onpaint = null
      source.onpaint = null
      try { texture?.dispose() } finally {
        delete sourceCtx.drawElementImage
        delete source.requestPaint
        try {
          const gl = output.getContext('webgl2')
          if (gl && !gl.isContextLost()) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
        } finally {
          capture.width = capture.height = 0
          source.width = source.height = 0
          capture.remove(); source.remove()
          revealOutput()
        }
      }
    }
  }
  const report = (error: unknown) => {
    if (!live) return
    const normalized = error instanceof CanvasHtmlTextureError ? error
      : new CanvasHtmlTextureError('capture', 'Unable to update this visual scroll effect.', { cause: error })
    lastFailure = normalized
    try { cleanup() } finally { onError(normalized) }
  }
  const checkGeometry = () => {
    geometryFrame = undefined
    if (!live) return
    try {
      validatePlacement(scroll, content, output)
      geometryFrame = win.requestAnimationFrame(checkGeometry)
    } catch (error) { report(error) }
  }
  function concealOutput() {
    if (concealed) return
    concealed = { value: output.style.getPropertyValue('visibility'), priority: output.style.getPropertyPriority('visibility') }
    output.style.setProperty('visibility', 'hidden', 'important')
  }
  function revealOutput() {
    if (!concealed) return
    if (output.style.getPropertyValue('visibility') === 'hidden' && output.style.getPropertyPriority('visibility') === 'important') {
      if (concealed.value) output.style.setProperty('visibility', concealed.value, concealed.priority)
      else output.style.removeProperty('visibility')
    }
    concealed = undefined
  }
  function updateMonitoring() {
    if (!live) return
    if (doc.visibilityState === 'hidden' || !sourceVisible || !outputVisible) {
      if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
      geometryFrame = undefined
      concealOutput()
      return
    }
    try {
      validateGeometry(scroll, content, output)
      revealOutput()
      if (geometryFrame === undefined) geometryFrame = win.requestAnimationFrame(checkGeometry)
    } catch (error) { report(error) }
  }
  function onVisibility() { updateMonitoring() }
  const scheduleCapture = () => {
    if (!live || bitmap || pending || !texture) return
    pending = texture.refresh().catch(error => { report(error) }).finally(() => { pending = undefined })
  }
  const draw = (node: Element, x: number, y: number) => {
    if (!live || node !== proxy) fail('unsafe-content', 'The visual scroll source does not match this texture.')
    if (bitmap) sourceCtx.drawImage(capture, 0, scroll.scrollTop, scroll.clientWidth, scroll.clientHeight,
      x, y, source.width, source.height)
  }
  function onScroll() {
    if (!live) return
    try { validateGeometry(scroll, content, output); proxy.dispatchEvent(new win.Event('scroll')) } catch (error) { report(error) }
  }
  try {
    Object.defineProperties(proxy, {
      scrollTop: { configurable: true, get: () => scroll.scrollTop },
      scrollHeight: { configurable: true, get: () => scroll.scrollHeight },
      clientWidth: { configurable: true, get: () => scroll.clientWidth },
      clientHeight: { configurable: true, get: () => scroll.clientHeight },
    })
    Object.defineProperty(sourceCtx, 'drawElementImage', { configurable: true, value: draw })
    Object.defineProperty(source, 'requestPaint', { configurable: true, value: () => {
      if (!live) return
      if (bitmap) source.onpaint?.()
      else scheduleCapture()
    } })
    texture = (options.createTextureBridge ?? createCanvasHtmlTextureBridge)({
      source: capture, content, scope: 'visual-only', sourceRemainsVisible: true,
      onError: report,
    })
    capture.onpaint = () => {
      if (!live) return
      try {
        validateGeometry(scroll, content, output)
        setSourceSize()
        const rect = content.getBoundingClientRect()
        capture.width = Math.ceil(rect.width); capture.height = Math.ceil(rect.height)
        captureCtx.drawElementImage?.(content, 0, 0)
        bitmap = true
        source.onpaint?.()
      } catch (error) { report(error) }
    }
    setSourceSize()
    scroll.addEventListener('scroll', onScroll, { passive: true })
    effect = factory({ source, content: proxy, output }, options.effectOptions)
    if (!effect) fail('unsupported', 'The Particle Scroll effect could not start on this device.')
    resizeObserver = new win.ResizeObserver(() => {
      if (!live) return
      try { validateGeometry(scroll, content, output); setSourceSize(); effect?.resize?.() } catch (error) { report(error) }
    })
    resizeObserver.observe(scroll); resizeObserver.observe(content); resizeObserver.observe(output)
    intersectionObserver = new win.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === scroll) sourceVisible = entry.isIntersecting
        if (entry.target === output) outputVisible = entry.isIntersecting
      }
      updateMonitoring()
    })
    intersectionObserver.observe(scroll); intersectionObserver.observe(output)
    doc.addEventListener('visibilitychange', onVisibility)
    updateMonitoring()
    scheduleCapture()
  } catch (error) {
    cleanup()
    throw error
  }
  return {
    refresh() {
      if (!live || !texture) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual scroll effect was closed.'))
      return texture.refresh().then(() => {
        if (!live) throw lastFailure ?? new CanvasHtmlTextureError('disposed', 'The visual scroll effect was closed.')
      })
    },
    resize() {
      if (!live) return
      try { validateGeometry(scroll, content, output); setSourceSize(); effect?.resize?.() } catch (error) { report(error) }
    },
    setOptions(next) { if (live) effect?.setOptions?.(next) },
    dispose: cleanup,
  }
}
