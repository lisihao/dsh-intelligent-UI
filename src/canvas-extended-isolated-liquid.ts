import { canvasExtendedLiquidFrameUrl } from './canvas-extended-liquid-host.js'
import { CanvasHtmlTextureError, createCanvasHtmlTextureBridge, readCanvasHtmlTextureSource, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from './canvas-html-texture.js'
import { acquireCanvasSlot, canvasEffectUrl } from './canvas-runtime-client.js'

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type PaintCanvas = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type PaintContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }

export interface CanvasExtendedLiquidOptions {
  /** A dedicated visual region, separate from the original retained source. */
  readonly host: HTMLElement
  /** The original visible, noninteractive visual source. It remains outside the iframe. */
  readonly content: HTMLElement
  readonly effectOptions?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  readonly onError: (error: Error) => void
  /** Test seam. Production loads only the fixed, host-integrity-checked route. */
  readonly fetchModule?: (url: string, signal: AbortSignal) => Promise<Response>
  readonly createTextureBridge?: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
  readonly acquireSlot?: typeof acquireCanvasSlot
  /** Test seam: bounded frame metrics from the fixed child document. */
  readonly onFrame?: (metrics: CanvasExtendedLiquidFrameMetrics) => void
  /** Test seam: observes the actual parent-side bitmap immediately before transfer. */
  readonly onSourceBitmap?: (metrics: CanvasExtendedLiquidTextureMetrics) => void
  /** Test seam: records bounded parent/child protocol transitions. */
  readonly onProtocol?: (event: 'paint' | 'mounted' | 'ready' | 'bitmap' | 'drawn' | 'frame' | 'error') => void
}

export interface CanvasExtendedLiquidTextureMetrics {
  readonly pixels: number
  readonly alpha: number
  readonly nonTransparent: number
  readonly nonWhite: number
}

export interface CanvasExtendedLiquidFrameMetrics {
  readonly revision: number
  readonly bitmapDraws: number
  readonly animationFrames: number
  readonly textureUploads: number
  readonly contentTextureUploads: number
  readonly drawCalls: number
  readonly source: CanvasExtendedLiquidTextureMetrics
  readonly output: CanvasExtendedLiquidTextureMetrics
  readonly displayOutput: CanvasExtendedLiquidTextureMetrics
  readonly hidden: boolean
  readonly sourceViewport: readonly [number, number]
  readonly outputViewport: readonly [number, number]
  readonly glError: number
}

export interface CanvasExtendedLiquidEffect {
  refresh(): Promise<void>
  resize(): void
  setOptions(options: Readonly<Record<string, unknown>>): void
  /** Protocol acknowledgements from the fixed iframe, not inferred visual quality. */
  getSnapshot(): Readonly<{ mounted: boolean, bitmaps: number, updates: number, resizes: number, destroyed: boolean }>
  destroy(): void
}

const MAX_MODULE_BYTES = 8 * 1024 * 1024
const SLOT_TIMEOUT_MS = 15_000
const FRAME_TIMEOUT_MS = 5_000
const MODULE_TIMEOUT_MS = 30_000
const DESTROY_GRACE_MS = 250
const MAX_BITMAP_BYTES = 10 * 1024 * 1024
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'src', 'dracoDecoderPath'])

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined
}

function stats(value: unknown): CanvasExtendedLiquidTextureMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const pixels = integer(record.pixels, 4_194_304)
  const alpha = integer(record.alpha, 4_294_967_295)
  const nonTransparent = integer(record.nonTransparent, 4_194_304)
  const nonWhite = integer(record.nonWhite, 4_194_304)
  if (pixels === undefined || alpha === undefined || nonTransparent === undefined || nonWhite === undefined
    || nonTransparent > pixels || nonWhite > pixels) return undefined
  return Object.freeze({ pixels, alpha, nonTransparent, nonWhite })
}

function canvasStats(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): CanvasExtendedLiquidTextureMetrics {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let alpha = 0, nonTransparent = 0, nonWhite = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index + 3]!
    alpha += value
    if (value) nonTransparent++
    if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonWhite++
  }
  return Object.freeze({ pixels: pixels.length / 4, alpha, nonTransparent, nonWhite })
}

function bitmapSourceBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  try {
    const view = canvas.ownerDocument.defaultView
    if (!view) return Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_BITMAP'))
    const dataUrl = canvas.toDataURL('image/png')
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl)
    if (!match || match[1]!.length > Math.ceil(MAX_BITMAP_BYTES / 3) * 4) return Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_BITMAP_SIZE'))
    const encoded = view.atob(match[1]!)
    const bytes = new Uint8Array(encoded.length)
    for (let index = 0; index < encoded.length; index++) bytes[index] = encoded.charCodeAt(index)
    const blob = new Blob([bytes], { type: 'image/png' })
    return blob.size > MAX_BITMAP_BYTES ? Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_BITMAP_SIZE')) : Promise.resolve(blob)
  } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('CANVAS_EXTENDED_LIQUID_BITMAP')) }
}

function viewport(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const width = integer(value[0], 16_384), height = integer(value[1], 16_384)
  return width === undefined || height === undefined || width < 1 || height < 1 ? undefined : Object.freeze([width, height] as const)
}

function frameMetrics(value: unknown): CanvasExtendedLiquidFrameMetrics | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const revision = integer(record.revision)
  const bitmapDraws = integer(record.bitmapDraws, 1_024)
  const animationFrames = integer(record.animationFrames, 65_536)
  const textureUploads = integer(record.textureUploads, 65_536)
  const contentTextureUploads = integer(record.contentTextureUploads, 65_536)
  const drawCalls = integer(record.drawCalls, 1_048_576)
  const source = stats(record.source), output = stats(record.output), displayOutput = stats(record.displayOutput)
  const sourceViewport = viewport(record.sourceViewport), outputViewport = viewport(record.outputViewport)
  const glError = integer(record.glError, 65_535)
  if (revision === undefined || bitmapDraws === undefined || animationFrames === undefined || textureUploads === undefined || contentTextureUploads === undefined || drawCalls === undefined || !source || !output || !displayOutput || typeof record.hidden !== 'boolean' || !sourceViewport || !outputViewport || glError === undefined) return undefined
  return Object.freeze({ revision, bitmapDraws, animationFrames, textureUploads, contentTextureUploads, drawCalls, source, output, displayOutput, hidden: record.hidden, sourceViewport, outputViewport, glError })
}

function json(value: unknown, depth = 0): Json {
  if (depth > 5) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_DEPTH')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_FINITE')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_STRING')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_ARRAY')
    return value.map(item => json(item, depth + 1))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_JSON')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_JSON')
  const entries = Object.entries(value)
  if (entries.length > 64) throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_FIELDS')
  const output: Record<string, Json> = {}
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key) || BLOCKED_KEYS.has(key) || key.startsWith('on')) {
      throw new Error('CANVAS_EXTENDED_LIQUID_OPTIONS_KEY')
    }
    output[key] = json(item, depth + 1)
  }
  return output
}

function effectOptions(value: Readonly<Record<string, unknown>> | undefined): Record<string, Json> {
  return value === undefined ? {} : json(value) as Record<string, Json>
}

function assertSeparate(source: HTMLElement, visual: HTMLElement): void {
  if (!source.isConnected || !visual.isConnected || source.ownerDocument !== visual.ownerDocument || visual.contains(source) || source.contains(visual)) {
    throw new Error('CANVAS_EXTENDED_LIQUID_HOST')
  }
  const left = source.getBoundingClientRect(), right = visual.getBoundingClientRect()
  const valid = (rect: DOMRect) => [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0
  if (!valid(left) || !valid(right)) throw new Error('CANVAS_EXTENDED_LIQUID_HIDDEN')
  if (left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom) {
    throw new Error('CANVAS_EXTENDED_LIQUID_OVERLAP')
  }
}

async function readFixedLiquidModule(fetchModule: (url: string, signal: AbortSignal) => Promise<Response>, signal: AbortSignal): Promise<string> {
  const response = await fetchModule(canvasEffectUrl('liquid', 0), signal)
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (!response.ok || type !== 'text/javascript') throw new Error('CANVAS_EXTENDED_LIQUID_MODULE')
  const length = response.headers.get('content-length')
  if (length && /^\d+$/u.test(length) && Number(length) > MAX_MODULE_BYTES) throw new Error('CANVAS_EXTENDED_LIQUID_MODULE_SIZE')
  if (!response.body) throw new Error('CANVAS_EXTENDED_LIQUID_MODULE_EMPTY')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > MAX_MODULE_BYTES) { await reader.cancel(); throw new Error('CANVAS_EXTENDED_LIQUID_MODULE_SIZE') }
      chunks.push(result.value)
    }
  } finally { reader.releaseLock() }
  if (!total) throw new Error('CANVAS_EXTENDED_LIQUID_MODULE_EMPTY')
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/**
 * Runs the fixed Liquid factory in an opaque-origin iframe. Its upstream
 * window-level pointer listeners are consequently private to the visual copy.
 * Only a bitmap of an already retained source crosses into that frame.
 */
export function createCanvasExtendedLiquidEffect(options: CanvasExtendedLiquidOptions): Promise<CanvasExtendedLiquidEffect> {
  const { host, content, signal, onError } = options
  if (signal?.aborted) return Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_ABORTED'))
  let safeOptions: Record<string, Json>
  try {
    safeOptions = effectOptions(options.effectOptions)
    assertSeparate(content, host)
    readCanvasHtmlTextureSource(content)
  } catch (error) { return Promise.reject(error) }
  const doc = host.ownerDocument, win = doc.defaultView
  if (!win || !doc.body || typeof win.matchMedia !== 'function' || typeof win.createImageBitmap !== 'function' || typeof win.MessageChannel !== 'function'
    || typeof win.IntersectionObserver !== 'function' || typeof win.ResizeObserver !== 'function'
    || typeof win.crypto?.getRandomValues !== 'function' || host.getRootNode() !== doc) {
    return Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_UNAVAILABLE'))
  }
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return Promise.reject(new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.'))
  }
  const view: Window & typeof globalThis = win

  return new Promise((resolve, reject) => {
    const lifetime = new AbortController()
    const frame = doc.createElement('iframe')
    const source = doc.createElement('canvas') as PaintCanvas
    const bytes = view.crypto.getRandomValues(new Uint8Array(16))
    const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
    const frameUrl = canvasExtendedLiquidFrameUrl(nonce)
    const moduleLoader = options.fetchModule ?? ((url: string, requestSignal: AbortSignal) => fetch(url, { signal: requestSignal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }))
    const makeTexture = options.createTextureBridge ?? createCanvasHtmlTextureBridge
    let bridge: CanvasHtmlTextureBridge | undefined
    let port: MessagePort | undefined
    let release: (() => void) | undefined
    let observer: ResizeObserver | undefined
    let timer: number | undefined
    let revision = 0
    let started = false
    let ready = false
    let settled = false
    let alive = true
    let mounted = false
    let bitmaps = 0
    let updates = 0
    let resizes = 0
    let destroyed = false

    const frameIsOurs = () => frame.isConnected && frame.getAttribute('src') === frameUrl && !frame.hasAttribute('srcdoc')
    const remove = () => {
      port?.close(); port = undefined
      frame.remove()
      release?.(); release = undefined
    }
    const close = (): Error | undefined => {
      if (!alive) return undefined
      alive = false
      destroyed = true
      lifetime.abort()
      if (timer !== undefined) view.clearTimeout(timer)
      timer = undefined
      signal?.removeEventListener('abort', abort)
      view.removeEventListener('message', bootstrap)
      observer?.disconnect()
      frame.onload = null; frame.onerror = null
      source.onpaint = null
      let cleanup: Error | undefined
      try { bridge?.dispose() } catch (error) { cleanup = error instanceof Error ? error : new Error(String(error)) }
      source.remove()
      if (port && started && frame.isConnected) {
        try { port.postMessage({ type: 'destroy' }) } catch { /* The opaque frame may already be gone. */ }
        view.setTimeout(remove, DESTROY_GRACE_MS)
      } else remove()
      return cleanup
    }
    const fail = (error: unknown) => {
      if (!alive) return
      let failure = error instanceof Error ? error : new Error(String(error))
      const cleanup = close()
      if (cleanup) failure = new AggregateError([failure, cleanup], 'Canvas Liquid resources could not all be released.')
      if (!settled) { settled = true; reject(failure) } else onError(failure)
    }
    function abort() { fail(new Error('CANVAS_EXTENDED_LIQUID_ABORTED')) }
    const sendBitmap = () => {
      if (!alive || !port) return
      try {
        const current = readCanvasHtmlTextureSource(content)
        if (source.width !== current.width) source.width = current.width
        if (source.height !== current.height) source.height = current.height
        const context = source.getContext('2d') as PaintContext | null
        if (!context) throw new Error('CANVAS_EXTENDED_LIQUID_CONTEXT')
        context.clearRect(0, 0, source.width, source.height)
        context.drawElementImage?.(content, 0, 0)
        if (options.onSourceBitmap) options.onSourceBitmap(canvasStats(context, source))
        const captured = ++revision
        void bitmapSourceBlob(source).then(blob => view.createImageBitmap(blob)).then(bitmap => {
          if (!alive || !port || captured !== revision) { bitmap.close(); return }
          options.onProtocol?.('bitmap')
          port.postMessage({ type: 'bitmap', bitmap, revision: captured }, [bitmap])
        }).catch(error => { options.onProtocol?.('error'); fail(error) })
      } catch (error) { fail(error) }
    }
    const adapter: CanvasExtendedLiquidEffect = {
      refresh() {
        if (!alive || !bridge) return Promise.reject(new Error('CANVAS_EXTENDED_LIQUID_DISPOSED'))
        return bridge.refresh()
      },
      resize() { if (alive) port?.postMessage({ type: 'resize' }) },
      setOptions(next) { if (alive) port?.postMessage({ type: 'options', options: effectOptions(next) }) },
      getSnapshot() { return Object.freeze({ mounted, bitmaps, updates, resizes, destroyed }) },
      destroy() { const error = close(); if (error) onError(error) },
    }
    function bootstrap(event: MessageEvent) {
      if (!alive || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'canvas-extended-liquid-bootstrap'
        || event.data?.nonce !== nonce || event.ports.length !== 1) return
      if (!frameIsOurs()) { fail(new Error('CANVAS_EXTENDED_LIQUID_NAVIGATED')); return }
      view.removeEventListener('message', bootstrap)
      port = event.ports[0]!
      port.onmessage = message => {
        const value = message.data as { type?: unknown, error?: unknown } | null
        if (value?.type === 'destroyed') { remove(); return }
        if (!alive) return
        if (value?.type === 'paint') { options.onProtocol?.('paint'); source.requestPaint?.() }
        else if (value?.type === 'mounted') { options.onProtocol?.('mounted'); mounted = true }
        else if (value?.type === 'ready') { options.onProtocol?.('ready'); ready = true }
        else if (value?.type === 'drawn' && ready && !settled) {
          options.onProtocol?.('drawn')
          bitmaps++
          settled = true
          if (timer !== undefined) view.clearTimeout(timer)
          timer = undefined
          resolve(adapter)
          if (options.onFrame) view.setTimeout(() => {
            if (alive && port) port.postMessage({ type: 'inspect' })
          }, 0)
        } else if (value?.type === 'drawn') { options.onProtocol?.('drawn'); bitmaps++ }
        else if (value?.type === 'updated') updates++
        else if (value?.type === 'resized') resizes++
        else if (value?.type === 'frame') {
          const metrics = frameMetrics(value)
          if (!metrics || metrics.revision > revision) fail(new Error('CANVAS_EXTENDED_LIQUID_FRAME_METRICS'))
          else { options.onProtocol?.('frame'); options.onFrame?.(metrics) }
        } else if (value?.type === 'frame-error') { options.onProtocol?.('error'); fail(new Error(`CANVAS_EXTENDED_LIQUID_FRAME: ${String(value.error)}`)) }
        else if (value?.type === 'error') { options.onProtocol?.('error'); fail(new Error(`CANVAS_EXTENDED_LIQUID_EFFECT: ${String(value.error)}`)) }
      }
      if (timer !== undefined) view.clearTimeout(timer)
      timer = view.setTimeout(() => fail(new Error('CANVAS_EXTENDED_LIQUID_MODULE_TIMEOUT')), MODULE_TIMEOUT_MS)
      void readFixedLiquidModule(moduleLoader, lifetime.signal).then(module => {
        if (!alive || !port || !frameIsOurs()) { fail(new Error('CANVAS_EXTENDED_LIQUID_NAVIGATED')); return }
        port.postMessage({ type: 'canvas-extended-liquid-start', factory: 'createLiquid', module, options: safeOptions, inspect: Boolean(options.onFrame) })
        started = true
      }).catch(fail)
    }
    try {
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.title = 'Liquid visual effect'
      frame.tabIndex = -1
      frame.style.cssText = 'display:block;border:0;width:100%;height:100%;pointer-events:auto'
      // A frame can execute while detached in Chromium. Listen before assigning
      // src so its one-shot MessagePort bootstrap cannot be lost.
      view.addEventListener('message', bootstrap)
      frame.onload = () => { if (!frameIsOurs()) fail(new Error('CANVAS_EXTENDED_LIQUID_NAVIGATED')) }
      frame.onerror = () => fail(new Error('CANVAS_EXTENDED_LIQUID_FRAME'))
      frame.src = frameUrl
      source.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
      doc.body.append(source)
      bridge = makeTexture({ source, content, scope: 'visual-only', sourceRemainsVisible: true, onError: fail })
      const context = source.getContext('2d') as PaintContext | null
      if (!context) throw new Error('CANVAS_EXTENDED_LIQUID_CONTEXT')
      source.onpaint = sendBitmap
      signal?.addEventListener('abort', abort, { once: true })
      release = (options.acquireSlot ?? acquireCanvasSlot)(() => queueMicrotask(() => {
        if (!alive) return
        try {
          assertSeparate(content, host)
          host.append(frame)
          observer = new view.ResizeObserver(() => {
            if (!alive) return
            try { assertSeparate(content, host); port?.postMessage({ type: 'resize' }) } catch (error) { fail(error) }
          })
          observer.observe(host); observer.observe(content)
          if (timer !== undefined) view.clearTimeout(timer)
          timer = view.setTimeout(() => fail(new Error('CANVAS_EXTENDED_LIQUID_FRAME_TIMEOUT')), FRAME_TIMEOUT_MS)
        } catch (error) { fail(error) }
      }))
      timer = view.setTimeout(() => fail(new Error('CANVAS_EXTENDED_LIQUID_BUSY')), SLOT_TIMEOUT_MS)
    } catch (error) { fail(error) }
  })
}
