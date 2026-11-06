import {
  CanvasHtmlTextureError,
  createCanvasHtmlTextureBridge,
  readCanvasHtmlTextureSource,
  type CanvasHtmlTextureBridge,
  type CanvasHtmlTextureOptions,
} from './canvas-html-texture.js'
import { createCanvasPointerRelay } from './canvas-pointer-relay.js'
import { acquireCanvasSlot, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'

/**
 * Canvas UI factories that use an HTML texture but were not part of the
 * original single-source adapter. The source is pinned by canvas-source-
 * manifest.ts; this list only describes the adapter path, never a model
 * supplied script or an arbitrary Canvas UI registry entry.
 */
export const CANVAS_EXTENDED_HTML_EFFECT_NAMES = [
  'ascii-sweep', 'bubble', 'cloth', 'droplets', 'flame-wrap', 'force-field',
  'glass', 'glyph-rain', 'laser', 'liquid', 'peel', 'retro-dither',
] as const

export type CanvasExtendedHtmlEffectName = typeof CANVAS_EXTENDED_HTML_EFFECT_NAMES[number]

/** Liquid installs global window pointer listeners, so it has a dedicated opaque-frame runner. */
export const CANVAS_EXTENDED_ISOLATED_EFFECT_NAMES = ['liquid'] as const

export type CanvasExtendedAvailability = 'runnable' | 'isolated-runner'

export interface CanvasExtendedHtmlEffectDescriptor {
  readonly component: CanvasExtendedHtmlEffectName
  readonly availability: CanvasExtendedAvailability
  readonly sourceRequirement: 'one-visible-source' | 'two-visible-sources'
  readonly reason: string
}

export const CANVAS_EXTENDED_HTML_EFFECTS: readonly CanvasExtendedHtmlEffectDescriptor[] = Object.freeze(
  CANVAS_EXTENDED_HTML_EFFECT_NAMES.map(component => Object.freeze({
    component,
    availability: (CANVAS_EXTENDED_ISOLATED_EFFECT_NAMES as readonly string[]).includes(component) ? 'isolated-runner' : 'runnable',
    sourceRequirement: component === 'ascii-sweep' ? 'two-visible-sources' : 'one-visible-source',
    reason: component === 'liquid'
      ? 'The pinned upstream factory listens on window and is rendered through the fixed opaque-frame runner.'
      : component === 'ascii-sweep'
        ? 'The pinned upstream factory requires two independently retained source panels.'
        : 'The pinned upstream factory receives a private texture proxy while the supplied original source remains visible.',
  })),
)

export function isCanvasExtendedHtmlEffectName(value: string): value is CanvasExtendedHtmlEffectName {
  return (CANVAS_EXTENDED_HTML_EFFECT_NAMES as readonly string[]).includes(value)
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type PaintCanvas = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type PaintContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }
type ExtendedInstance = CanvasEffectInstance & {
  sweep?: (to: 0 | 1, options?: { angle?: number }) => void
  impact?: (x: number, y: number) => void
  capture?: () => void
  current?: () => 0 | 1
}

export interface CanvasExtendedHtmlEffectOptions {
  readonly component: CanvasExtendedHtmlEffectName
  /** A dedicated visual region, separate from every retained source region. */
  readonly host: HTMLElement
  /** The first original source. It remains readable and is never given to the upstream factory. */
  readonly content: HTMLElement
  /** Required only by ASCII Sweep; it too stays visible outside this adapter. */
  readonly alternateContent?: HTMLElement
  readonly factory: CanvasEffectFactory
  readonly scope: 'visual-only'
  readonly sourceRemainsVisible: true
  /** Input is confined to the visual copy. It never reaches the original source. */
  readonly pointer?: boolean
  readonly effectOptions?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  readonly onError: (error: CanvasHtmlTextureError) => void
  readonly createTextureBridge?: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
  readonly acquireSlot?: typeof acquireCanvasSlot
}

export interface CanvasExtendedHtmlEffectAdapter {
  refresh(): Promise<void>
  resize(): void
  setOptions(options: Readonly<Record<string, unknown>>): void
  /** Available only for ASCII Sweep and forwarded to its real upstream instance. */
  sweep(to: 0 | 1, options?: { readonly angle?: number }): void
  /** Available only for Force Field and forwarded to its real upstream instance. */
  impact(x: number, y: number): void
  /** Runtime facts observed by this adapter; they do not infer pixel quality. */
  getSnapshot(): Readonly<{ component: CanvasExtendedHtmlEffectName, sourcePanels: number, captures: number, updates: number, resizes: number, destroyed: boolean }>
  dispose(): void
}

type PrivateSource = {
  readonly original: HTMLElement
  readonly capture: PaintCanvas
  readonly source: PaintCanvas
  readonly proxy: HTMLElement
  readonly captureContext: PaintContext
  readonly sourceContext: PaintContext
  readonly texture: CanvasHtmlTextureBridge
  bitmap: boolean
  captures: number
  pending?: Promise<void>
}

const SLOT_WAIT_TIMEOUT_MS = 15_000
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'src', 'dracoDecoderPath'])

function fail(code: CanvasHtmlTextureError['code'], message: string): never {
  throw new CanvasHtmlTextureError(code, message)
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Do not pass callbacks, DOM objects or unlimited configuration to upstream factories. */
function boundedJson(value: unknown, depth = 0): Json {
  if (depth > 5) fail('unsupported', 'Canvas effect options are nested too deeply.')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('unsupported', 'Canvas effect options must contain finite numbers.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 1024) fail('unsupported', 'Canvas effect option text is too long.')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 32) fail('unsupported', 'Canvas effect option arrays are too large.')
    return value.map(item => boundedJson(item, depth + 1))
  }
  if (!isPlainRecord(value)) fail('unsupported', 'Canvas effect options must be JSON data.')
  const entries = Object.entries(value)
  if (entries.length > 64) fail('unsupported', 'Canvas effect options contain too many fields.')
  const result: Record<string, Json> = {}
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key) || BLOCKED_KEYS.has(key) || key.startsWith('on')) {
      fail('unsupported', 'Canvas effect option names are not allowed.')
    }
    result[key] = boundedJson(item, depth + 1)
  }
  return result
}

function normalizeOptions(value: Readonly<Record<string, unknown>> | undefined): Record<string, Json> {
  return value === undefined ? {} : boundedJson(value) as Record<string, Json>
}

function rectOf(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect()
  if (![rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    fail('detached', 'The retained source and visual region must be visible.')
  }
  return rect
}

function assertSeparate(host: HTMLElement, content: HTMLElement, alternate?: HTMLElement, ownedStage?: HTMLElement): void {
  const doc = host.ownerDocument
  if (!host.isConnected || !content.isConnected || content.ownerDocument !== doc || !doc.body?.isConnected) {
    fail('detached', 'The retained source and visual region must remain in one attached document.')
  }
  if (host === content || host.contains(content) || content.contains(host)) {
    fail('unsafe-content', 'The visual region must be separate from the original source.')
  }
  const hostRect = rectOf(host), sourceRect = rectOf(content)
  if (Math.abs(hostRect.width - sourceRect.width) > 2 || Math.abs(hostRect.height - sourceRect.height) > 2) {
    fail('unsupported', 'The visual region must match the retained source size.')
  }
  if (alternate) {
    if (!alternate.isConnected || alternate.ownerDocument !== doc || alternate === content || alternate.contains(content) || content.contains(alternate)
      || host === alternate || host.contains(alternate) || alternate.contains(host)) {
      fail('unsafe-content', 'ASCII Sweep requires two separate retained source panels and a separate visual region.')
    }
    const alternateRect = rectOf(alternate)
    if (Math.abs(sourceRect.width - alternateRect.width) > 2 || Math.abs(sourceRect.height - alternateRect.height) > 2) {
      fail('unsupported', 'ASCII Sweep source panels must have matching dimensions.')
    }
  }
  if ([...host.childNodes].some(node => node !== ownedStage && (node.nodeType === 1 || (node.nodeType === 3 && !!node.textContent?.trim())))) {
    fail('unsafe-content', 'The visual region must be dedicated to one Canvas effect.')
  }
}

function currentBackground(content: HTMLElement): string {
  const view = content.ownerDocument.defaultView
  if (!view) return ''
  const value = view.getComputedStyle(content).backgroundColor
  return value && value !== 'transparent' ? value : ''
}

function makePrivateProxy(source: PaintCanvas, content: HTMLElement): HTMLElement {
  const doc = source.ownerDocument
  const holder = doc.createElement('div')
  const root = holder.attachShadow({ mode: 'closed' })
  const proxy = doc.createElement('div')
  const background = currentBackground(content)
  proxy.style.cssText = `display:block;box-sizing:border-box;width:100%;height:100%;overflow:hidden;pointer-events:auto${background ? `;background:${background}` : ''}`
  Object.defineProperties(proxy, {
    clientWidth: { configurable: true, get: () => content.clientWidth },
    clientHeight: { configurable: true, get: () => content.clientHeight },
  })
  root.append(proxy)
  source.append(holder)
  return proxy
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  try { canvas.width = canvas.height = 0 } catch { /* The retained source remains visible. */ }
}

function clearWebGl(canvas: HTMLCanvasElement): void {
  try {
    const gl = canvas.getContext('webgl2')
    if (gl && !gl.isContextLost()) {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch { /* Resource cleanup continues below. */ }
}

function createPrivateSource(
  original: HTMLElement,
  output: HTMLCanvasElement,
  onFailure: (error: unknown) => void,
  createTextureBridge: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge,
  onBitmap?: (state: PrivateSource, rect: DOMRect) => void,
): PrivateSource {
  const doc = original.ownerDocument
  const capture = doc.createElement('canvas') as PaintCanvas
  const source = doc.createElement('canvas') as PaintCanvas
  const proxy = makePrivateProxy(source, original)
  capture.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
  source.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.max(1, original.clientWidth)}px;height:${Math.max(1, original.clientHeight)}px;pointer-events:none`
  doc.body!.append(capture, source)
  const captureContext = capture.getContext('2d') as PaintContext | null
  const sourceContext = source.getContext('2d') as PaintContext | null
  if (!captureContext || !sourceContext) {
    capture.remove(); source.remove()
    fail('unsupported', 'The browser cannot create a Canvas texture source.')
  }
  let runtime: PrivateSource | undefined
  Object.defineProperty(sourceContext, 'drawElementImage', {
    configurable: true,
    value: (node: Element, x: number, y: number) => {
      if (!runtime || node !== runtime.proxy) fail('unsafe-content', 'The Canvas factory attempted to capture an unowned source.')
      if (runtime.bitmap) runtime.sourceContext.drawImage(runtime.capture, x, y, runtime.source.width, runtime.source.height)
    },
  })
  let texture: CanvasHtmlTextureBridge
  try {
    texture = createTextureBridge({
      source: capture,
      content: original,
      scope: 'visual-only',
      sourceRemainsVisible: true,
      onError: onFailure,
    })
  } catch (error) {
    try { delete sourceContext.drawElementImage } catch { /* Nothing else is owned yet. */ }
    capture.remove(); source.remove()
    throw error
  }
  const sourceValue = source as PaintCanvas
  const state: PrivateSource = { original, capture, source: sourceValue, proxy, captureContext, sourceContext, texture, bitmap: false, captures: 0 }
  runtime = state
  Object.defineProperty(sourceValue, 'requestPaint', {
    configurable: true,
    value: () => {
      if (state.bitmap) state.source.onpaint?.()
      else void refreshPrivateSource(state).catch(onFailure)
    },
  })
  capture.onpaint = () => {
    try {
      const rect = rectOf(original)
      capture.width = Math.ceil(rect.width); capture.height = Math.ceil(rect.height)
      state.captureContext.drawElementImage?.(original, 0, 0)
      state.bitmap = true
      state.captures++
      onBitmap?.(state, rect)
      state.source.onpaint?.()
    } catch (error) { onFailure(error) }
  }
  return state
}

function refreshPrivateSource(state: PrivateSource): Promise<void> {
  if (!state.pending) {
    state.pending = state.texture.refresh().finally(() => { state.pending = undefined })
  }
  return state.pending
}

function disposePrivateSource(state: PrivateSource): void {
  state.capture.onpaint = null
  state.source.onpaint = null
  try { state.texture.dispose() } finally {
    try { delete state.sourceContext.drawElementImage } catch { /* Best effort only. */ }
    try { delete state.source.requestPaint } catch { /* Best effort only. */ }
    clearCanvas(state.capture); clearCanvas(state.source)
    state.capture.remove(); state.source.remove()
  }
}

function restoreAfterTextures(release: (() => void) | undefined, waits: readonly Promise<void>[]): void {
  if (release && waits.length) void Promise.allSettled(waits).then(release, release)
  else release?.()
}

function nameOf(component: CanvasExtendedHtmlEffectName): string {
  return `Canvas ${component}`
}

/**
 * Run a pinned Canvas UI factory only on texture proxies. The supplied source
 * is independently retained outside the visual region, and no source DOM or
 * input listener is handed to the upstream implementation.
 */
export function createCanvasExtendedHtmlEffect(options: CanvasExtendedHtmlEffectOptions): Promise<CanvasExtendedHtmlEffectAdapter> {
  const { component, host, content } = options
  if (!isCanvasExtendedHtmlEffectName(component)) return Promise.reject(new CanvasHtmlTextureError('unsupported', 'This Canvas effect is not in the fixed adapter registry.'))
  if ((CANVAS_EXTENDED_ISOLATED_EFFECT_NAMES as readonly string[]).includes(component)) {
    return Promise.reject(new CanvasHtmlTextureError('unsupported', 'CANVAS_EXTENDED_USE_ISOLATED_RUNNER: Liquid is rendered by the fixed opaque-frame runner.'))
  }
  if (options.scope !== 'visual-only' || options.sourceRemainsVisible !== true) {
    return Promise.reject(new CanvasHtmlTextureError('unsafe-content', 'The original source must remain visible.'))
  }
  if (options.signal?.aborted) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was cancelled.'))
  let sanitized: Record<string, Json>
  try {
    sanitized = normalizeOptions(options.effectOptions)
    const alternate = component === 'ascii-sweep' ? options.alternateContent : undefined
    if (component === 'ascii-sweep' && !alternate) fail('unsupported', 'ASCII Sweep requires a second retained source panel.')
    assertSeparate(host, content, alternate)
    readCanvasHtmlTextureSource(content)
    if (alternate) readCanvasHtmlTextureSource(alternate)
    const view = host.ownerDocument.defaultView
    if (!view || typeof view.ResizeObserver !== 'function' || typeof view.matchMedia !== 'function') fail('unsupported', 'The browser cannot monitor this visual effect.')
    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) fail('reduced-motion', 'Animation is disabled by the system preference.')
  } catch (error) { return Promise.reject(error) }

  const doc = host.ownerDocument
  const win = doc.defaultView!
  return new Promise((resolve, reject) => {
    const stage = doc.createElement('div')
    stage.setAttribute('aria-hidden', 'true')
    stage.style.cssText = `position:relative;display:block;width:100%;height:100%;overflow:hidden;pointer-events:${options.pointer === false ? 'none' : 'auto'}`
    const backdrop = doc.createElement('canvas')
    const output = doc.createElement('canvas')
    backdrop.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none'
    output.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none'
    stage.append(backdrop, output)
    let sources: PrivateSource[] = []
    let effect: ExtendedInstance | null = null
    let release: (() => void) | undefined
    let resize: ResizeObserver | undefined
    let pointerRelay: (() => void) | undefined
    let timer: number | undefined
    let live = true
    let settled = false
    let updates = 0
    let resizes = 0
    let destroyed = false
    let capturedAtDispose = 0
    const sourcePanelCount = component === 'ascii-sweep' ? 2 : 1

    const cleanup = () => {
      if (!live) return
      live = false
      destroyed = true
      if (timer !== undefined) win.clearTimeout(timer)
      timer = undefined
      options.signal?.removeEventListener('abort', abort)
      win.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener?.('change', onMotion)
      resize?.disconnect()
      try { pointerRelay?.() } catch { /* Release all resources even when a listener is stale. */ }
      try { effect?.destroy() } catch { /* The original source remains available. */ }
      effect = null
      const retired = sources.splice(0)
      capturedAtDispose = retired.reduce((total, source) => total + source.captures, capturedAtDispose)
      const drains = retired.map(source => source.texture.whenDisposed?.()).filter((value): value is Promise<void> => !!value)
      for (const source of retired) {
        try { disposePrivateSource(source) } catch { /* Continue cleanup. */ }
      }
      clearWebGl(output); clearCanvas(output); clearCanvas(backdrop)
      backdrop.remove(); output.remove(); stage.remove()
      restoreAfterTextures(release, drains)
      release = undefined
    }
    const report = (error: unknown) => {
      if (!live) return
      const normalized = error instanceof CanvasHtmlTextureError
        ? error
        : new CanvasHtmlTextureError('capture', `${nameOf(component)} could not run.`, { cause: error })
      cleanup()
      if (!settled) { settled = true; reject(normalized) }
      else options.onError(normalized)
    }
    function abort() { report(new CanvasHtmlTextureError('disposed', 'The visual effect was cancelled.')) }
    function onMotion() {
      if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) report(new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.'))
    }
    const resizeNow = () => {
      if (!live || !effect) return
      try {
        assertSeparate(host, content, component === 'ascii-sweep' ? options.alternateContent : undefined, stage)
        for (const source of sources) {
          source.source.style.width = `${Math.max(1, content.clientWidth)}px`
          source.source.style.height = `${Math.max(1, content.clientHeight)}px`
        }
        effect.resize?.()
        resizes++
        for (const source of sources) void refreshPrivateSource(source).catch(report)
      } catch (error) { report(error) }
    }
    const adapter: CanvasExtendedHtmlEffectAdapter = {
      refresh() {
        if (!live) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was closed.'))
        return Promise.all(sources.map(refreshPrivateSource)).then(() => undefined)
      },
      resize: resizeNow,
      setOptions(next) {
        const normalized = normalizeOptions(next)
        if (effect?.setOptions) { effect.setOptions(normalized); updates++ }
      },
      sweep(to, sweepOptions) {
        if (component !== 'ascii-sweep') return
        effect?.sweep?.(to === 1 ? 1 : 0, sweepOptions && Number.isFinite(sweepOptions.angle) ? { angle: sweepOptions.angle } : undefined)
      },
      impact(x, y) {
        if (component !== 'force-field' || !Number.isFinite(x) || !Number.isFinite(y)) return
        effect?.impact?.(x, y)
      },
      getSnapshot() {
        const captures = sources.length ? sources.reduce((total, source) => total + source.captures, 0) : capturedAtDispose
        return Object.freeze({ component, sourcePanels: sourcePanelCount, captures, updates, resizes, destroyed })
      },
      dispose: cleanup,
    }
    const begin = async () => {
      if (!live) return
      try {
        assertSeparate(host, content, component === 'ascii-sweep' ? options.alternateContent : undefined, stage)
        const primary = createPrivateSource(content, output, report, options.createTextureBridge ?? createCanvasHtmlTextureBridge, (state, rect) => {
          if (component === 'ascii-sweep' || !live) return
          backdrop.width = Math.ceil(rect.width); backdrop.height = Math.ceil(rect.height)
          backdrop.getContext('2d')?.drawImage(state.capture, 0, 0)
        })
        sources.push(primary)
        if (component === 'ascii-sweep') {
          const alternate = options.alternateContent!
          const secondary = createPrivateSource(alternate, output, report, options.createTextureBridge ?? createCanvasHtmlTextureBridge)
          sources.push(secondary)
        }
        if (!live) return
        effect = component === 'ascii-sweep'
          ? options.factory({ slots: [{ source: primary.source, content: primary.proxy }, { source: sources[1]!.source, content: sources[1]!.proxy }], output }, sanitized) as ExtendedInstance | null
          : options.factory({ source: primary.source, content: primary.proxy, output, ...(component === 'peel' ? { under: backdrop } : {}) }, sanitized) as ExtendedInstance | null
        if (!effect) fail('unsupported', `${nameOf(component)} could not start on this device.`)
        if (options.pointer !== false) {
          pointerRelay = createCanvasPointerRelay({ stage, getProxy: () => primary.proxy })
        }
        resize = new win.ResizeObserver(resizeNow)
        resize.observe(host); resize.observe(content)
        if (options.alternateContent) resize.observe(options.alternateContent)
        await Promise.all(sources.map(refreshPrivateSource))
        if (!live) return
        if (timer !== undefined) win.clearTimeout(timer)
        timer = undefined
        if (!settled) { settled = true; resolve(adapter) }
      } catch (error) { report(error) }
    }
    try {
      host.append(stage)
      options.signal?.addEventListener('abort', abort, { once: true })
      win.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', onMotion)
      release = (options.acquireSlot ?? acquireCanvasSlot)(() => queueMicrotask(() => { void begin() }))
      timer = win.setTimeout(() => {
        if (live && !effect) report(new CanvasHtmlTextureError('busy', 'Canvas visual resources are busy; try again shortly.'))
      }, SLOT_WAIT_TIMEOUT_MS)
    } catch (error) { report(error) }
  })
}
