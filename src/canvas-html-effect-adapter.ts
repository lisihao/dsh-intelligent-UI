import {
  CanvasHtmlTextureError,
  createCanvasHtmlTextureBridge,
  readCanvasHtmlTextureSource,
  type CanvasHtmlTextureBridge,
  type CanvasHtmlTextureOptions,
} from './canvas-html-texture.js'
import { acquireCanvasSlot, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { isCanvasHtmlEffectName, type CanvasHtmlEffectName } from './canvas-html-names.js'
import { createCanvasPointerRelay } from './canvas-pointer-relay.js'
import { createCanvasTextMaskProxy, type CanvasTextMaskProxy } from './canvas-text-mask-proxy.js'

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
  /** Magnify requires the caller to identify this as decoration, not data. */
  readonly contentRole?: 'decoration'
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
const CLOUDS_COLOR_REFRESH_MS = 250
type Rgb = [number, number, number]
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
  maskProxy?: CanvasTextMaskProxy
  effect?: EffectInstance | null
  resize?: ResizeObserver
  pendingCapture?: Promise<void>
  pointerRelay?: () => void
  startupTimer?: number
  bitmap: boolean
}

function fault(code: CanvasHtmlTextureError['code'], message: string): never {
  throw new CanvasHtmlTextureError(code, message)
}

function explicitCloudsColor(value: unknown): Rgb {
  if (!Array.isArray(value) || value.length !== 3 || [value[0], value[1], value[2]].some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1)) {
    fault('unsupported', 'Clouds color must be auto or three RGB values between 0 and 1.')
  }
  return [value[0], value[1], value[2]]
}

/** Match the upstream first non-transparent background rule on the real source. */
function createCloudsColorReader(content: HTMLElement, win: Window & typeof globalThis): () => Rgb {
  let context: CanvasRenderingContext2D | null | undefined
  return () => {
    try {
      if (context === undefined) {
        const probe = content.ownerDocument.createElement('canvas')
        probe.width = probe.height = 1
        context = probe.getContext('2d', { willReadFrequently: true })
      }
      if (!context) fault('unsupported', 'Clouds cannot determine the source background; provide an explicit color.')
      for (let node: HTMLElement | null = content; node; node = node.parentElement) {
        const style = win.getComputedStyle(node)
        if (style.backgroundImage && style.backgroundImage !== 'none') {
          fault('unsupported', 'Clouds cannot infer a background from an image or gradient; provide an explicit color.')
        }
        const value = style.backgroundColor
        if (!value || value === 'transparent') continue
        // Canvas keeps its previous fillStyle when a CSS color is unsupported.
        // Two sentinels distinguish an accepted color from that silent failure.
        context.fillStyle = '#010203'; context.fillStyle = value
        const first = context.fillStyle
        context.fillStyle = '#fefdfc'; context.fillStyle = value
        if (first !== context.fillStyle) fault('unsupported', 'Clouds cannot parse the source background; provide an explicit color.')
        context.clearRect(0, 0, 1, 1); context.fillRect(0, 0, 1, 1)
        const rgba = context.getImageData(0, 0, 1, 1).data
        if (rgba[3] !== 0) return [rgba[0]! / 255, rgba[1]! / 255, rgba[2]! / 255]
      }
      fault('unsupported', 'Clouds cannot determine a background; provide an explicit color.')
    } catch (error) {
      if (error instanceof CanvasHtmlTextureError) throw error
      throw new CanvasHtmlTextureError('unsupported', 'Clouds cannot determine the source background; provide an explicit color.', { cause: error })
    }
  }
}

/** Asciify has one global backing luminance; ambiguous composites fail closed. */
function createAsciifyBackgroundReader(content: HTMLElement, win: Window & typeof globalThis): () => string {
  let context: CanvasRenderingContext2D | null | undefined
  return () => {
    try {
      if (context === undefined) {
        const probe = content.ownerDocument.createElement('canvas')
        probe.width = probe.height = 1
        context = probe.getContext('2d', { willReadFrequently: true })
      }
      if (!context) fault('unsupported', 'Asciify cannot determine a solid source background.')
      const styles = new Map<HTMLElement, CSSStyleDeclaration>()
      const computedStyle = (element: HTMLElement) => {
        let computed = styles.get(element)
        if (!computed) { computed = win.getComputedStyle(element); styles.set(element, computed) }
        return computed
      }
      const rgbaOf = (value: string): readonly [number, number, number, number] => {
        if (!value || value === 'transparent') return [0, 0, 0, 0]
        context!.fillStyle = '#010203'; context!.fillStyle = value
        const first = context!.fillStyle
        context!.fillStyle = '#fefdfc'; context!.fillStyle = value
        if (first !== context!.fillStyle) fault('unsupported', 'Asciify cannot parse the source background.')
        context!.clearRect(0, 0, 1, 1); context!.fillRect(0, 0, 1, 1)
        const rgba = context!.getImageData(0, 0, 1, 1).data
        return [rgba[0]!, rgba[1]!, rgba[2]!, rgba[3]!]
      }
      for (let node: HTMLElement | null = content; node; node = node.parentElement) {
        const computed = computedStyle(node), opacity = Number(computed.opacity || 1)
        if (!Number.isFinite(opacity) || opacity !== 1
          || (computed.filter && computed.filter !== 'none')
          || (computed.mixBlendMode && computed.mixBlendMode !== 'normal')) {
          fault('unsupported', 'Asciify cannot infer a translucent or blended source background.')
        }
      }
      const root = computedStyle(content)
      if (root.backgroundImage && root.backgroundImage !== 'none') {
        fault('unsupported', 'Asciify cannot infer a background from an image or gradient.')
      }
      const clip = root.getPropertyValue('background-clip').trim().toLowerCase()
      if (clip && clip !== 'border-box') fault('unsupported', 'Asciify requires a background covering the whole source.')
      const zeroRadius = (value: string) => !value || value.split(/[\s/]+/u).filter(Boolean).every(part => /^[-+]?(?:0+(?:\.0*)?|\.0+)(?:px|%)?$/iu.test(part))
      if (['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']
        .some(property => !zeroRadius(root.getPropertyValue(property).trim()))) {
        fault('unsupported', 'Asciify cannot infer a rounded source background.')
      }
      for (const [property, allowed] of [
        ['clip-path', 'none'], ['clip', 'auto'], ['mask-image', 'none'], ['-webkit-mask-image', 'none'],
      ] as const) {
        const value = root.getPropertyValue(property).trim().toLowerCase()
        if (value && value !== allowed) fault('unsupported', 'Asciify cannot infer a clipped source background.')
      }
      if (/\binset\b/iu.test(root.getPropertyValue('box-shadow'))) fault('unsupported', 'Asciify cannot infer an inset-shadowed source background.')
      const background = rgbaOf(root.backgroundColor)
      if (background[3] === 0) fault('unsupported', 'Asciify requires a solid background on the source itself.')
      if (background[3] !== 255) fault('unsupported', 'Asciify cannot infer a translucent source background.')

      // A child with text can introduce another backing color even though the
      // root is opaque. Non-text decoration remains valid foreground imagery.
      const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      const checked = new Set<HTMLElement>()
      let node: Node | null, textNodes = 0
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue
        if (++textNodes > 512) fault('too-large', 'Asciify cannot inspect this many text nodes.')
        const parent = node.parentElement
        if (!parent || ['hidden', 'collapse'].includes(computedStyle(parent).visibility)) continue
        const branch: HTMLElement[] = []
        let hidden = false
        for (let element: HTMLElement | null = parent; element && element !== content; element = element.parentElement) {
          const style = computedStyle(element)
          if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity || 1) === 0) { hidden = true; break }
          branch.push(element)
        }
        if (hidden) continue
        for (const element of branch) {
          if (checked.has(element)) continue
          checked.add(element)
          const style = computedStyle(element)
          if (style.backgroundImage && style.backgroundImage !== 'none') fault('unsupported', 'Asciify cannot infer a text background from an image or gradient.')
          const layer = rgbaOf(style.backgroundColor)
          if (layer[3] && layer.slice(0, 3).some((value, index) => value !== background[index])) {
            fault('unsupported', 'Asciify cannot infer multiple text background colors.')
          }
        }
      }
      return `rgb(${background[0]}, ${background[1]}, ${background[2]})`
    } catch (error) {
      if (error instanceof CanvasHtmlTextureError) throw error
      throw new CanvasHtmlTextureError('unsupported', 'Asciify cannot determine a solid source background.', { cause: error })
    }
  }
}

function checkEffectContent(component: CanvasHtmlEffectName, content: HTMLElement): void {
  // A refracted lens can make digits look like different values. This adapter
  // only permits Magnify on text-free decorative content, never report data.
  if (component === 'magnify' && /\S/u.test(content.textContent ?? '')) {
    fault('unsupported', 'Magnify requires text-free decorative content.')
  }
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
  if (component === 'magnify' && options.contentRole !== 'decoration') {
    return Promise.reject(new CanvasHtmlTextureError('unsupported', 'Magnify requires explicitly declared decorative content.'))
  }
  if (component === 'magnify' && options.effectOptions?.scrollZoom !== undefined && options.effectOptions.scrollZoom !== false) {
    return Promise.reject(new CanvasHtmlTextureError('unsupported', 'Scroll zoom is unavailable in the isolated visual effect.'))
  }
  if (options.signal?.aborted) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was cancelled.'))
  let view: Window & typeof globalThis
  let readCloudsColor: (() => Rgb) | undefined
  let initialCloudsColor: Rgb | undefined
  let readAsciifyBackground: (() => string) | undefined
  let initialAsciifyBackground: string | undefined
  const requestedCloudsColor = options.effectOptions?.color
  const initiallyAutoClouds = component === 'clouds' && (requestedCloudsColor === undefined || requestedCloudsColor === 'auto')
  try {
    checkPlacement(host, content)
    if ([...host.childNodes].some(node => node.nodeType === 1 || (node.nodeType === 3 && !!node.textContent?.trim()))) {
      fault('unsafe-content', 'The visual region must be dedicated to this effect.')
    }
    readCanvasHtmlTextureSource(content)
    checkEffectContent(component, content)
    view = host.ownerDocument.defaultView!
    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) fault('reduced-motion', 'Animation is disabled by the system preference.')
    if (component === 'clouds') {
      readCloudsColor = createCloudsColorReader(content, view)
      initialCloudsColor = initiallyAutoClouds ? readCloudsColor() : explicitCloudsColor(requestedCloudsColor)
    }
    if (component === 'asciify') {
      readAsciifyBackground = createAsciifyBackgroundReader(content, view)
      initialAsciifyBackground = readAsciifyBackground()
    }
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
    let autoCloudsColor = initiallyAutoClouds
    let lastCloudsColorCheck = 0
    let asciifyBackground = initialAsciifyBackground
    let lastAsciifyBackgroundCheck = 0
    let autoMagnifySize = component === 'magnify' && options.effectOptions?.size === undefined
    const magnifySize = () => {
      const rect = host.getBoundingClientRect()
      return Math.max(1, Math.min(72, Math.floor(Math.min(rect.width, rect.height) * 0.28)))
    }
    const effectOptions: Record<string, unknown> = {
      ...(component === 'magnify' ? { zoom: 1.3, hud: 0.45, crosshair: false, ticks: false, brackets: false, dot: false, aberration: 0, haze: 0, readout: false } : {}),
      ...(component === 'asciify' ? { background: 'auto', glow: 0, aberration: 0 } : {}),
      ...options.effectOptions,
      ...(component === 'magnify' ? { scrollZoom: false } : {}),
      ...(component === 'clouds' ? { color: initialCloudsColor } : {}),
    }
    if (autoMagnifySize) effectOptions.size = magnifySize()
    const checkCurrentPlacement = () => checkPlacement(host, content, stage, runtime ? [runtime.backdrop, runtime.output] : [])
    const syncCloudsColor = (force = false) => {
      if (component !== 'clouds' || !autoCloudsColor) return
      const now = win.performance.now()
      if (!force && now - lastCloudsColorCheck < CLOUDS_COLOR_REFRESH_MS) return
      const color = readCloudsColor!()
      lastCloudsColorCheck = now
      const previous = effectOptions.color as Rgb
      if (previous?.every((value, index) => value === color[index])) return
      effectOptions.color = color
      runtime?.effect?.setOptions?.({ color })
      if (runtime) checkCurrentPlacement()
    }
    const syncAsciifyBackground = (force = false) => {
      if (component !== 'asciify') return
      const now = win.performance.now()
      if (!force && now - lastAsciifyBackgroundCheck < CLOUDS_COLOR_REFRESH_MS) return
      const background = readAsciifyBackground!()
      lastAsciifyBackgroundCheck = now
      if (background === asciifyBackground) return
      asciifyBackground = background
      if (runtime?.maskProxy) {
        runtime.proxy.style.backgroundColor = background
        runtime.effect?.resize?.()
      }
    }

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
        try { current.pointerRelay?.() } catch (error) { failures.push(error) }
        try { current.effect?.destroy() } catch (error) { failures.push(error) }
        try { current.maskProxy?.dispose() } catch (error) { failures.push(error) }
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
      resize() {
        const current = runtime
        if (!current) return
        if (component !== 'asciify') { current.effect?.resize?.(); return }
        try {
          checkCurrentPlacement()
          syncAsciifyBackground(true)
          current.maskProxy?.resize()
          current.effect?.resize?.()
        } catch (error) { report(error); throw lastFailure ?? error }
      },
      setOptions(next) {
        if (component === 'clouds' && !alive) return
        const update = { ...next }
        if (component === 'magnify' && update.scrollZoom !== undefined && update.scrollZoom !== false) {
          throw new CanvasHtmlTextureError('unsupported', 'Scroll zoom is unavailable in the isolated visual effect.')
        }
        if (component === 'magnify' && Object.hasOwn(update, 'size')) {
          autoMagnifySize = update.size === undefined
          if (autoMagnifySize) update.size = magnifySize()
        }
        if (component === 'clouds' && Object.hasOwn(update, 'color')) {
          const useAuto = update.color === undefined || update.color === 'auto'
          const color = useAuto ? readCloudsColor!() : explicitCloudsColor(update.color)
          autoCloudsColor = useAuto
          lastCloudsColorCheck = win.performance.now()
          update.color = color
        }
        Object.assign(effectOptions, update); runtime?.effect?.setOptions?.(update)
        if (runtime && component === 'clouds') {
          try { checkCurrentPlacement() } catch (error) { report(error); throw error }
        }
      },
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
      const attributes = ['class', 'style', 'hidden', 'inert', 'aria-hidden']
      if (component === 'clouds' || component === 'asciify') attributes.push('data-theme', 'data-color-mode')
      for (const node of nodes) visibilityObserver.observe(node, { childList: true, attributes: true, attributeFilter: attributes })
    }
    const monitor = () => {
      geometryFrame = undefined
      if (!alive) return
      if (!hostIsVisible()) { visibility(); return }
      try { checkCurrentPlacement(); syncCloudsColor(); syncAsciifyBackground(); geometryFrame = win.requestAnimationFrame(monitor) } catch (error) { report(error) }
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
        syncCloudsColor(true)
        syncAsciifyBackground(true)
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
        checkEffectContent(component, content)
        const capture = doc.createElement('canvas') as PaintCanvas
        const source = doc.createElement('canvas') as PaintCanvas
        const output = doc.createElement('canvas')
        const backdrop = doc.createElement('canvas')
        let proxy: HTMLElement | undefined
        let maskProxy: CanvasTextMaskProxy | undefined
        if (component !== 'asciify') {
          proxy = doc.createElement('div')
          if (component === 'magnify' || component === 'clouds') {
            // Non-composed synthetic pointer events remain inside this private
            // root and cannot reach other plugins' document/window capture listeners.
            const privateProxyHost = doc.createElement('div')
            privateProxyHost.attachShadow({ mode: 'closed' }).append(proxy)
            source.append(privateProxyHost)
          } else source.append(proxy)
        }
        capture.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
        source.style.cssText = `position:fixed;left:-10000px;top:0;width:${host.clientWidth}px;height:${host.clientHeight}px;pointer-events:none`
        output.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none'
        backdrop.style.cssText = output.style.cssText
        let captureContext: PaintContext, sourceContext: PaintContext, backdropContext: CanvasRenderingContext2D
        try {
          doc.body.append(capture, source)
          stage.append(backdrop, output)
          checkPlacement(host, content, stage, [backdrop, output])
          if (component === 'asciify') {
            maskProxy = createCanvasTextMaskProxy({ stage, output })
            proxy = maskProxy.content
            proxy.style.backgroundColor = asciifyBackground!
          }
          const captured = capture.getContext('2d') as PaintContext | null
          const source2d = source.getContext('2d') as PaintContext | null
          const backdrop2d = backdrop.getContext('2d')
          if (!captured || !source2d || !backdrop2d) fault('unsupported', 'The browser cannot create this visual texture.')
          captureContext = captured; sourceContext = source2d; backdropContext = backdrop2d
        } catch (error) {
          maskProxy?.dispose()
          capture.remove(); source.remove(); output.remove(); backdrop.remove()
          throw error
        }
        if (!proxy) fault('capture', 'The visual effect proxy could not be created.')
        const current: Runtime = { generation: currentGeneration, output, backdrop, capture, source, proxy, maskProxy, captureContext, sourceContext, bitmap: false }
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
        const texture = (options.createTextureBridge ?? createCanvasHtmlTextureBridge)({ source: capture, content, scope: 'visual-only', sourceRemainsVisible: true, ...(component === 'asciify' ? { captureTextRects: true } : {}), onError: error => { if (activeRun(current)) report(error) } })
        if (!activeRun(current)) { texture.dispose(); return }
        current.texture = texture
        if (component === 'asciify' && typeof texture.getSnapshot !== 'function') {
          fault('unsupported', 'Asciify requires matching text geometry from the visual texture.')
        }
        capture.onpaint = () => {
          if (!activeRun(current)) return
          try {
            checkCurrentPlacement()
            checkEffectContent(component, content)
            const rect = content.getBoundingClientRect()
            if (component === 'asciify') {
              syncAsciifyBackground(true)
              const snapshot = current.texture?.getSnapshot?.()
              if (!snapshot) {
                const changed = current.maskProxy!.update(undefined)
                current.bitmap = false
                captureContext.clearRect(0, 0, capture.width, capture.height)
                backdropContext.clearRect(0, 0, backdrop.width, backdrop.height)
                sourceContext.clearRect(0, 0, source.width, source.height)
                const gl = output.getContext('webgl2')
                if (gl && !gl.isContextLost()) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
                source.onpaint?.()
                if (changed && activeRun(current)) current.effect?.resize?.()
                return
              }
              if (snapshot.width !== Math.ceil(rect.width) || snapshot.height !== Math.ceil(rect.height)) {
                fault('capture', 'The Asciify source changed size during capture.')
              }
              if (!current.maskProxy!.update(snapshot)) fault('capture', 'The Asciify text geometry is out of date.')
            }
            capture.width = backdrop.width = Math.ceil(rect.width); capture.height = backdrop.height = Math.ceil(rect.height)
            captureContext.drawElementImage?.(content, 0, 0)
            backdropContext.drawImage(capture, 0, 0)
            current.bitmap = true
            source.onpaint?.()
            if (component === 'asciify' && activeRun(current)) current.effect?.resize?.()
          } catch (error) { report(error) }
        }
        const effect = options.factory({ source, content: proxy, output }, effectOptions) as EffectInstance | null
        if (!activeRun(current)) { effect?.destroy(); return }
        current.effect = effect
        if (!effect) fault('unsupported', 'The visual effect could not start on this device.')
        if (component === 'asciify' && typeof effect.resize !== 'function') {
          fault('unsupported', 'Asciify cannot refresh its text mask on this device.')
        }
        if (component === 'asciify' && current.bitmap) effect.resize?.()
        if ((component === 'magnify' || component === 'clouds') && options.pointer) {
          try { current.pointerRelay = createCanvasPointerRelay({ stage, getProxy: () => activeRun(current) ? current.proxy : undefined }) }
          catch (error) { throw new CanvasHtmlTextureError('unsupported', 'The browser cannot isolate pointer input for this effect.', { cause: error }) }
        }
        current.resize = new win.ResizeObserver(() => {
          if (!activeRun(current)) return
          try {
            checkCurrentPlacement()
            source.style.width = `${host.clientWidth}px`; source.style.height = `${host.clientHeight}px`
            if (autoMagnifySize) {
              const size = magnifySize()
              if (size !== effectOptions.size) { effectOptions.size = size; current.effect?.setOptions?.({ size }) }
            }
            if (component === 'asciify') { syncAsciifyBackground(true); current.maskProxy?.resize() }
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
        if (component === 'asciify' && !current.bitmap) fault('capture', 'The Asciify visual texture is unavailable.')
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
