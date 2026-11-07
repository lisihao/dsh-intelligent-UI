import { acquireCanvasSlot, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'

/** These pinned Canvas UI factories accept one verified object or raster source. */
export const CANVAS_EXTENDED_OBJECT_EFFECT_NAMES = ['dithered-object', 'particle-object', 'liquid-object'] as const
export type CanvasExtendedObjectEffectName = typeof CANVAS_EXTENDED_OBJECT_EFFECT_NAMES[number]

export interface CanvasExtendedObjectAsset {
  /** Exact source reference retained by the surrounding source renderer. */
  readonly sourceRef: string
  /** A local object URL created only after the host has validated the source bytes. */
  readonly objectUrl: string
  readonly kind: 'glb' | 'image'
  /** The caller confirms the existing bounded GLB/raster validator accepted the bytes. */
  readonly verified: true
}

export interface CanvasExtendedObjectEffectOptions {
  readonly component: CanvasExtendedObjectEffectName
  readonly canvas: HTMLCanvasElement
  readonly asset: CanvasExtendedObjectAsset
  readonly factory: CanvasEffectFactory
  /** The original asset/source record remains visible outside the derived view. */
  readonly sourceRemainsVisible: true
  readonly effectOptions?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  /** Observes the fixed upstream factory's successful asset load. */
  readonly onReady?: () => void
  readonly onError: (error: Error) => void
  readonly acquireSlot?: typeof acquireCanvasSlot
}

export interface CanvasExtendedObjectEffectAdapter {
  resize(): void
  setOptions(options: Readonly<Record<string, unknown>>): void
  getSnapshot(): Readonly<{ component: CanvasExtendedObjectEffectName, loaded: boolean, updates: number, resizes: number, destroyed: boolean }>
  dispose(): void
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'src', 'dracoDecoderPath', 'onLoad', 'onError'])
const SLOT_WAIT_TIMEOUT_MS = 15_000

export function isCanvasExtendedObjectEffectName(value: string): value is CanvasExtendedObjectEffectName {
  return (CANVAS_EXTENDED_OBJECT_EFFECT_NAMES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function json(value: unknown, depth = 0): Json {
  if (depth > 5) throw new Error('CANVAS_OBJECT_OPTIONS_DEPTH')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CANVAS_OBJECT_OPTIONS_FINITE')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 1024) throw new Error('CANVAS_OBJECT_OPTIONS_STRING')
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error('CANVAS_OBJECT_OPTIONS_ARRAY')
    return value.map(item => json(item, depth + 1))
  }
  if (!isRecord(value)) throw new Error('CANVAS_OBJECT_OPTIONS_JSON')
  const entries = Object.entries(value)
  if (entries.length > 64) throw new Error('CANVAS_OBJECT_OPTIONS_FIELDS')
  const output: Record<string, Json> = {}
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key) || BLOCKED_KEYS.has(key) || key.startsWith('on')) {
      throw new Error('CANVAS_OBJECT_OPTIONS_KEY')
    }
    output[key] = json(item, depth + 1)
  }
  return output
}

function options(value: Readonly<Record<string, unknown>> | undefined): Record<string, Json> {
  return value === undefined ? {} : json(value) as Record<string, Json>
}

function assertAsset(asset: CanvasExtendedObjectAsset): void {
  if (asset.verified !== true || !asset.sourceRef.trim()) throw new Error('CANVAS_OBJECT_SOURCE_UNVERIFIED')
  let url: URL
  try { url = new URL(asset.objectUrl) } catch { throw new Error('CANVAS_OBJECT_URL_INVALID') }
  // The existing source validator creates this local URL after it has rejected
  // external resources and unsupported GLB decoders. Never pass http(s) on to
  // an upstream Three loader, which would create a second unconstrained fetch.
  if (url.protocol !== 'blob:') throw new Error('CANVAS_OBJECT_URL_NOT_LOCAL_BLOB')
}

/**
 * Dispatch one of the missing pinned object factories with only an already
 * validated local blob URL. The adapter does not claim to validate model bytes
 * itself; it deliberately composes with the existing GLB/raster validation
 * boundary before an upstream Three.js loader receives anything.
 */
export function createCanvasExtendedObjectEffect(optionsInput: CanvasExtendedObjectEffectOptions): Promise<CanvasExtendedObjectEffectAdapter> {
  const { component, canvas, asset, factory } = optionsInput
  if (!isCanvasExtendedObjectEffectName(component)) return Promise.reject(new Error('CANVAS_OBJECT_COMPONENT_UNKNOWN'))
  if (optionsInput.sourceRemainsVisible !== true) return Promise.reject(new Error('CANVAS_OBJECT_SOURCE_REQUIRED'))
  if (optionsInput.signal?.aborted) return Promise.reject(new Error('CANVAS_OBJECT_CANCELLED'))
  try {
    assertAsset(asset)
    options(optionsInput.effectOptions)
    if (!canvas.isConnected || !canvas.ownerDocument.defaultView || !canvas.ownerDocument.body?.isConnected) throw new Error('CANVAS_OBJECT_DETACHED')
    if (canvas.ownerDocument.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches) throw new Error('CANVAS_OBJECT_REDUCED_MOTION')
  } catch (error) { return Promise.reject(error) }

  const doc = canvas.ownerDocument
  const win = doc.defaultView!
  return new Promise((resolve, reject) => {
    let instance: CanvasEffectInstance | null = null
    let observer: ResizeObserver | undefined
    let release: (() => void) | undefined
    let timer: number | undefined
    let live = true
    let settled = false
    let loaded = false
    let updates = 0
    let resizes = 0
    let destroyed = false

    const cleanup = () => {
      if (!live) return
      live = false
      destroyed = true
      if (timer !== undefined) win.clearTimeout(timer)
      timer = undefined
      optionsInput.signal?.removeEventListener('abort', abort)
      win.matchMedia?.('(prefers-reduced-motion: reduce)').removeEventListener?.('change', onMotion)
      observer?.disconnect()
      try { instance?.destroy() } catch { /* The retained source is outside this canvas. */ }
      instance = null
      release?.(); release = undefined
    }
    const report = (error: unknown) => {
      if (!live) return
      const normalized = error instanceof Error ? error : new Error(String(error))
      cleanup()
      if (!settled) { settled = true; reject(normalized) }
      else optionsInput.onError(normalized)
    }
    function abort() { report(new Error('CANVAS_OBJECT_CANCELLED')) }
    function onMotion() {
      if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) report(new Error('CANVAS_OBJECT_REDUCED_MOTION'))
    }
    const adapter: CanvasExtendedObjectEffectAdapter = {
      resize() { if (live && instance?.resize) { instance.resize(); resizes++ } },
      setOptions(next) { if (live && instance?.setOptions) { instance.setOptions(options(next)); updates++ } },
      getSnapshot() { return Object.freeze({ component, loaded, updates, resizes, destroyed }) },
      dispose: cleanup,
    }
    const start = () => {
      if (!live) return
      try {
        const configured = {
          ...options(optionsInput.effectOptions),
          src: asset.objectUrl,
          // A verified GLB has already rejected Draco; this prevents a factory
          // from ever resolving its upstream default decoder URL.
          dracoDecoderPath: '',
          onLoad: () => {
            if (!live) return
            loaded = true
            optionsInput.onReady?.()
          },
          onError: (error: unknown) => report(error instanceof Error ? error : new Error('CANVAS_OBJECT_UPSTREAM_ERROR')),
        }
        instance = factory({ canvas }, configured)
        if (!instance) throw new Error('CANVAS_OBJECT_UNAVAILABLE')
        observer = new win.ResizeObserver(() => {
          if (instance?.resize) { instance.resize(); resizes++ }
        })
        observer.observe(canvas)
        if (timer !== undefined) win.clearTimeout(timer)
        timer = undefined
        if (!settled) { settled = true; resolve(adapter) }
      } catch (error) { report(error) }
    }
    try {
      optionsInput.signal?.addEventListener('abort', abort, { once: true })
      win.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', onMotion)
      release = (optionsInput.acquireSlot ?? acquireCanvasSlot)(() => queueMicrotask(start))
      timer = win.setTimeout(() => {
        if (live && !instance) report(new Error('CANVAS_OBJECT_BUSY'))
      }, SLOT_WAIT_TIMEOUT_MS)
    } catch (error) { report(error) }
  })
}
