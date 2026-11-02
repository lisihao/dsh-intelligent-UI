import {
  CanvasHtmlTextureError,
  createCanvasHtmlTextureBridge,
  readCanvasHtmlTextureSource,
  type CanvasHtmlTextureBridge,
  type CanvasHtmlTextureOptions,
} from './canvas-html-texture.js'
import { acquireCanvasSlot, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { isCanvasHtmlEffectName, type CanvasHtmlEffectName } from './canvas-html-names.js'

/** Only these pinned upstream factories have been checked for shared DOM changes. */
export type { CanvasHtmlEffectName } from './canvas-html-names.js'

export interface CanvasHtmlEffectOptions {
  readonly component: CanvasHtmlEffectName
  /** A dedicated visual region; the original content must be elsewhere. */
  readonly host: HTMLElement
  readonly content: HTMLElement
  readonly factory: CanvasEffectFactory
  readonly scope: 'visual-only'
  readonly sourceRemainsVisible: true
  /** Pointer input is limited to the dedicated visual copy, never the source. */
  readonly pointer?: boolean
  readonly effectOptions?: Record<string, unknown>
  readonly signal?: AbortSignal
  readonly onError: (error: CanvasHtmlTextureError) => void
  readonly createTextureBridge?: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
  readonly acquireSlot?: typeof acquireCanvasSlot
}

export interface CanvasHtmlEffectAdapter {
  refresh(): Promise<void>
  resize(): void
  setOptions(options: Record<string, unknown>): void
  /** Ripple accepts CSS-pixel coordinates. */
  splash(x: number, y: number, strength?: number): void
  /** Frost accepts normalized coordinates between 0 and 1. */
  melt(x: number, y: number): void
  /** Trigger the Glitch factory's immediate burst. */
  burst(): void
  dispose(): void
}

type PaintCanvas = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type PaintContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }
type EffectInstance = CanvasEffectInstance & { splash?: (x: number, y: number, strength?: number) => void, melt?: (x: number, y: number) => void, burst?: () => void }
const STARTUP_CAPTURE_TIMEOUT_MS = 10_000
const SLOT_WAIT_TIMEOUT_MS = 15_000
interface Runtime {
  readonly generation: number
  readonly output: HTMLCanvasElement
  readonly backdrop: HTMLCanvasElement
  readonly capture: PaintCanvas
  readonly source: PaintCanvas
  readonly proxy: HTMLElement
  readonly captureContext: PaintContext
  readonly sourceContext: PaintContext
  texture?: CanvasHtmlTextureBridge
  effect?: EffectInstance | null
  resize?: ResizeObserver
  pendingCapture?: Promise<void>
  startupTimer?: number
  bitmap: boolean
}

function fault(code: CanvasHtmlTextureError['code'], message: string): never {
  throw new CanvasHtmlTextureError(code, message)
}

function checkPlacement(host: HTMLElement, content: HTMLElement, stage?: HTMLElement, layers: readonly Element[] = []): void {
  const doc = host.ownerDocument
  if (!host.isConnected || !content.isConnected || content.ownerDocument !== doc || !doc.defaultView || !doc.body?.isConnected) {
    fault('detached', 'The source and visual region must remain in the same document.')
  }
  if (host === content || host.contains(content) || content.contains(host)) fault('unsafe-content', 'The visual region must be separate from the original source.')
  const h = host.getBoundingClientRect(), c = content.getBoundingClientRect()
  if (h.width <= 0 || h.height <= 0 || c.width <= 0 || c.height <= 0) fault('detached', 'The source and visual region must be visible.')
  if (h.left < c.right && h.right > c.left && h.top < c.bottom && h.bottom > c.top) fault('unsafe-content', 'The visual effect must not cover the original source.')
  if (Math.abs(h.width - c.width) > 2 || Math.abs(h.height - c.height) > 2) fault('unsupported', 'The visual region must match the source size.')
  for (const visual of stage ? [stage, ...layers] : []) {
    const rect = visual.getBoundingClientRect()
    if (![rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || rect.left < h.left - 2 || rect.top < h.top - 2
      || rect.right > h.right + 2 || rect.bottom > h.bottom + 2
      || (rect.left < c.right && rect.right > c.left && rect.top < c.bottom && rect.bottom > c.top)) {
      fault('unsafe-content', 'The visual effect must remain inside its own region and not cover the original source.')
    }
  }
}

/**
 * Mount an optional visual copy using a verified, already-loaded factory. The
 * actual source is never passed to the upstream factory: its DOM and listeners
 * are untouched. This is an opt-in decorative projection, not readable data.
 */
export function createCanvasHtmlEffectAdapter(options: CanvasHtmlEffectOptions): Promise<CanvasHtmlEffectAdapter> {
  const { host, content, component, onError } = options
  if (options.scope !== 'visual-only' || options.sourceRemainsVisible !== true) return Promise.reject(new CanvasHtmlTextureError('unsafe-content', 'The original source must remain visible.'))
  if (!isCanvasHtmlEffectName(component)) return Promise.reject(new CanvasHtmlTextureError('unsupported', 'This visual effect has not been verified.'))
  if (options.signal?.aborted) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was cancelled.'))
  let view: Window & typeof globalThis
  try {
    checkPlacement(host, content)
    if ([...host.childNodes].some(node => node.nodeType === 1 || (node.nodeType === 3 && !!node.textContent?.trim()))) {
      fault('unsafe-content', 'The visual region must be dedicated to this effect.')
    }
    readCanvasHtmlTextureSource(content)
    view = host.ownerDocument.defaultView!
    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) fault('reduced-motion', 'Animation is disabled by the system preference.')
    if (typeof view.IntersectionObserver !== 'function' || typeof view.ResizeObserver !== 'function' || typeof view.requestAnimationFrame !== 'function') {
      fault('unsupported', 'The browser cannot monitor this visual effect.')
    }
  } catch (error) { return Promise.reject(error) }
  const doc = host.ownerDocument
  const win = view
  return new Promise((resolve, reject) => {
    const stage = doc.createElement('div')
    stage.setAttribute('aria-hidden', 'true')
    stage.style.cssText = `position:relative;display:none;width:100%;height:100%;overflow:hidden;pointer-events:${options.pointer ? 'auto' : 'none'}`
    let runtime: Runtime | undefined
    let ticket: (() => void) | undefined
    let slotTimer: number | undefined
    let intersection: IntersectionObserver | undefined
    let visibilityObserver: MutationObserver | undefined
    let geometryFrame: number | undefined
    let generation = 0
    let alive = true, settled = false
    let lastFailure: CanvasHtmlTextureError | undefined
    let contentVisible = false, hostVisible = false
    const effectOptions = { ...options.effectOptions }
    const checkCurrentPlacement = () => checkPlacement(host, content, stage, runtime ? [runtime.backdrop, runtime.output] : [])

    const stopRuntime = () => {
      generation++
      const current = runtime
      runtime = undefined
      const release = ticket
      ticket = undefined
      let drained: Promise<void> | undefined
      if (slotTimer !== undefined) win.clearTimeout(slotTimer)
      slotTimer = undefined
      const failures: unknown[] = []
      if (current) {
        if (current.startupTimer !== undefined) win.clearTimeout(current.startupTimer)
        current.resize?.disconnect()
        try { current.effect?.destroy() } catch (error) { failures.push(error) }
        current.source.onpaint = null; current.capture.onpaint = null
        try { current.texture?.dispose() } catch (error) { failures.push(error) }
        try { drained = current.texture?.whenDisposed?.() } catch (error) { failures.push(error) }
        delete current.sourceContext.drawElementImage
        delete current.source.requestPaint
        try {
          const gl = current.output.getContext('webgl2')
          if (gl && !gl.isContextLost()) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.getExtension('WEBGL_lose_context')?.loseContext() }
        } catch (error) { failures.push(error) }
        try { current.source.width = current.source.height = 0; current.capture.width = current.capture.height = 0; current.backdrop.width = current.backdrop.height = 0 } catch (error) { failures.push(error) }
        current.source.remove(); current.capture.remove(); current.output.remove(); current.backdrop.remove()
      }
      // A disposed texture keeps its quota while an asynchronous capture drains.
      // Hold the GPU ticket until then so the next effect cannot race that quota.
      if (release && drained) void drained.then(release, release)
      else try { release?.() } catch (error) { failures.push(error) }
      if (failures.length) throw new AggregateError(failures, 'Canvas visual resources could not all be released.')
    }
    const clean = () => {
      if (!alive) return
      alive = false
      options.signal?.removeEventListener('abort', abort)
      doc.removeEventListener('visibilitychange', visibility)
      stage.removeEventListener('pointerdown', pointerDown)
      intersection?.disconnect()
      visibilityObserver?.disconnect()
      if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
      geometryFrame = undefined
      try { stopRuntime() } finally { stage.remove() }
    }
    function report(error: unknown) {
      if (!alive) return
      let normalized = error instanceof CanvasHtmlTextureError ? error
        : new CanvasHtmlTextureError('capture', 'Unable to run this visual effect.', { cause: error })
      try { clean() } catch (cleanupError) { normalized = new CanvasHtmlTextureError('capture', 'Unable to release the visual effect.', { cause: new AggregateError([normalized, cleanupError]) }) }
      lastFailure = normalized
      if (!settled) { settled = true; reject(normalized) } else onError(normalized)
    }
    function abort() { report(new CanvasHtmlTextureError('disposed', 'The visual effect was cancelled.')) }
    function activeRun(current: Runtime) { return alive && runtime === current && current.generation === generation }
    const captureNow = (current: Runtime): Promise<void> => {
      if (!activeRun(current) || !current.texture) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was closed.'))
      if (!current.pendingCapture) current.pendingCapture = current.texture.refresh().then(() => {
        if (!activeRun(current)) throw lastFailure ?? new CanvasHtmlTextureError(alive ? 'unsupported' : 'disposed', alive ? 'The visual effect is not currently visible.' : 'The visual effect was closed.')
      }).finally(() => { current.pendingCapture = undefined })
      return current.pendingCapture
    }
    function pointerDown(event: PointerEvent) {
      const current = runtime
      if (component !== 'ripple' || !current?.effect?.splash || !activeRun(current)) return
      const rect = current.output.getBoundingClientRect()
      current.effect.splash(event.clientX - rect.left, event.clientY - rect.top, 1)
    }
    const adapter: CanvasHtmlEffectAdapter = {
      refresh() {
        if (!runtime) return Promise.reject(new CanvasHtmlTextureError(alive ? 'unsupported' : 'disposed', alive ? 'The visual effect is not currently visible.' : 'The visual effect was closed.'))
        return captureNow(runtime)
      },
      resize() { if (runtime) runtime.effect?.resize?.() },
      setOptions(next) { Object.assign(effectOptions, next); runtime?.effect?.setOptions?.(next) },
      splash(x, y, strength) { if (component === 'ripple' && Number.isFinite(x) && Number.isFinite(y)) runtime?.effect?.splash?.(x, y, strength) },
      melt(x, y) { if (component === 'frost' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1) runtime?.effect?.melt?.(x, y) },
      burst() { if (component === 'glitch') runtime?.effect?.burst?.() },
      dispose: clean,
    }
    function hostIsVisible() {
      let opacity = 1
      for (let node: HTMLElement | null = host; node; node = node.parentElement) {
        const style = win.getComputedStyle(node), value = Number(style.opacity || 1)
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
          || style.contentVisibility === 'hidden' || !Number.isFinite(value)) return false
        opacity *= value
      }
      return opacity >= 0.5
    }
    function watchVisibility() {
      if (!visibilityObserver) return
      visibilityObserver.disconnect()
      const nodes = new Set<HTMLElement>()
      for (const root of [host, content]) for (let node: HTMLElement | null = root; node; node = node.parentElement) nodes.add(node)
      for (const node of nodes) visibilityObserver.observe(node, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'] })
    }
    const monitor = () => {
      geometryFrame = undefined
      if (!alive) return
      if (!hostIsVisible()) { visibility(); return }
      try { checkCurrentPlacement(); geometryFrame = win.requestAnimationFrame(monitor) } catch (error) { report(error) }
    }
    function visibility() {
      if (!alive) return
      if (!host.isConnected || !content.isConnected) { report(new CanvasHtmlTextureError('detached', 'The source or visual region was removed.')); return }
      if (!contentVisible || !hostVisible || doc.visibilityState !== 'visible' || !hostIsVisible()) {
        stage.style.display = 'none'
        if (geometryFrame !== undefined) win.cancelAnimationFrame(geometryFrame)
        geometryFrame = undefined
        try { stopRuntime() } catch (error) { report(error) }
        return
      }
      try {
        checkPlacement(host, content)
        stage.style.display = 'block'
        checkCurrentPlacement()
        if (geometryFrame === undefined) geometryFrame = win.requestAnimationFrame(monitor)
        if (!ticket && !runtime) {
          const currentGeneration = ++generation
          ticket = (options.acquireSlot ?? acquireCanvasSlot)(() => queueMicrotask(() => {
            if (slotTimer !== undefined) win.clearTimeout(slotTimer)
            slotTimer = undefined
            void start(currentGeneration)
          }))
          slotTimer = win.setTimeout(() => {
            if (alive && currentGeneration === generation && !runtime) report(new CanvasHtmlTextureError('busy', 'Visual resources are busy; try again shortly.'))
          }, SLOT_WAIT_TIMEOUT_MS)
        }
      } catch (error) { report(error) }
    }
    async function start(currentGeneration: number) {
      if (!alive || currentGeneration !== generation) return
      try {
        checkCurrentPlacement()
        readCanvasHtmlTextureSource(content)
        const capture = doc.createElement('canvas') as PaintCanvas
        const source = doc.createElement('canvas') as PaintCanvas
        const proxy = doc.createElement('div')
        const output = doc.createElement('canvas')
        const backdrop = doc.createElement('canvas')
        source.append(proxy)
        capture.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
        source.style.cssText = `position:fixed;left:-10000px;top:0;width:${host.clientWidth}px;height:${host.clientHeight}px;pointer-events:none`
        output.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none'
        backdrop.style.cssText = output.style.cssText
        let captureContext: PaintContext, sourceContext: PaintContext, backdropContext: CanvasRenderingContext2D
        try {
          doc.body.append(capture, source)
          stage.append(backdrop, output)
          checkPlacement(host, content, stage, [backdrop, output])
          const captured = capture.getContext('2d') as PaintContext | null
          const source2d = source.getContext('2d') as PaintContext | null
          const backdrop2d = backdrop.getContext('2d')
          if (!captured || !source2d || !backdrop2d) fault('unsupported', 'The browser cannot create this visual texture.')
          captureContext = captured; sourceContext = source2d; backdropContext = backdrop2d
        } catch (error) {
          capture.remove(); source.remove(); output.remove(); backdrop.remove()
          throw error
        }
        const current: Runtime = { generation: currentGeneration, output, backdrop, capture, source, proxy, captureContext, sourceContext, bitmap: false }
        runtime = current
        Object.defineProperties(proxy, {
          clientWidth: { configurable: true, get: () => content.clientWidth },
          clientHeight: { configurable: true, get: () => content.clientHeight },
        })
        Object.defineProperty(sourceContext, 'drawElementImage', { configurable: true, value: (node: Element, x: number, y: number) => {
          if (!activeRun(current) || node !== proxy) fault('unsafe-content', 'The visual source does not match this texture.')
          if (current.bitmap) sourceContext.drawImage(capture, x, y, source.width, source.height)
        } })
        Object.defineProperty(source, 'requestPaint', { configurable: true, value: () => {
          if (!activeRun(current)) return
          if (current.bitmap) source.onpaint?.()
          else void captureNow(current).catch(error => { if (activeRun(current)) report(error) })
        } })
        current.texture = (options.createTextureBridge ?? createCanvasHtmlTextureBridge)({ source: capture, content, scope: 'visual-only', sourceRemainsVisible: true, onError: error => { if (activeRun(current)) report(error) } })
        capture.onpaint = () => {
          if (!activeRun(current)) return
          try {
            checkCurrentPlacement()
            const rect = content.getBoundingClientRect()
            capture.width = backdrop.width = Math.ceil(rect.width); capture.height = backdrop.height = Math.ceil(rect.height)
            captureContext.drawElementImage?.(content, 0, 0)
            backdropContext.drawImage(capture, 0, 0)
            current.bitmap = true
            source.onpaint?.()
          } catch (error) { report(error) }
        }
        current.effect = options.factory({ source, content: proxy, output }, effectOptions) as EffectInstance | null
        if (!current.effect) fault('unsupported', 'The visual effect could not start on this device.')
        current.resize = new win.ResizeObserver(() => {
          if (!activeRun(current)) return
          try {
            checkCurrentPlacement()
            source.style.width = `${host.clientWidth}px`; source.style.height = `${host.clientHeight}px`
            current.effect?.resize?.()
          } catch (error) { report(error) }
        })
        current.resize.observe(host); current.resize.observe(content)
        current.startupTimer = win.setTimeout(() => {
          if (activeRun(current)) report(new CanvasHtmlTextureError('capture', 'The visual texture took too long to start.'))
        }, STARTUP_CAPTURE_TIMEOUT_MS)
        try { await captureNow(current) } finally {
          if (current.startupTimer !== undefined) win.clearTimeout(current.startupTimer)
          current.startupTimer = undefined
        }
        if (!activeRun(current)) return
        if (!settled) { settled = true; resolve(adapter) }
      } catch (error) { if (alive && currentGeneration === generation) report(error) }
    }
    try {
      options.signal?.addEventListener('abort', abort, { once: true })
      doc.addEventListener('visibilitychange', visibility)
      if (options.pointer && component === 'ripple') stage.addEventListener('pointerdown', pointerDown, { passive: true })
      host.append(stage)
      intersection = new win.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.target === content) contentVisible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
          if (entry.target === host) hostVisible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
        }
        visibility()
      })
      intersection.observe(content); intersection.observe(host)
      visibilityObserver = new win.MutationObserver(() => { watchVisibility(); visibility() })
      watchVisibility()
    } catch (error) { report(error) }
  })
}
