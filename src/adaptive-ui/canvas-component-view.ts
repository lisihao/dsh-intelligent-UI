import { createElement as h, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { CanvasBlockView } from './canvas-block-view.js'
import {
  CANVAS_COMPONENT_RENDERER_KEY,
  canvasComponentSourceValue,
  parseCanvasComponentInput,
  type CanvasComponentInput,
  type CanvasTrustedObjectAsset,
} from './canvas-component-bindings.js'
import { createCanvasExtendedHtmlEffect, isCanvasExtendedHtmlEffectName } from '../canvas-extended-adapter.js'
import { createCanvasExtendedLiquidEffect } from '../canvas-extended-isolated-liquid.js'
import { createCanvasExtendedObjectEffect, isCanvasExtendedObjectEffectName } from '../canvas-extended-object-adapter.js'
import { CANVAS_HTML_EFFECT_NAMES } from '../canvas-html-names.js'
import { glbSource, inspectGlb, isSafeRaster, readGlbResponse, safeAssetUrl } from '../canvas-object-view.js'
import { acquireCanvasSlot, type CanvasEffectInstance } from '../canvas-runtime-client.js'
import { CanvasRuntimeContext } from '../canvas-runtime-context.js'

const MAX_GLB_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const baseHtml = new Set<string>([...CANVAS_HTML_EFFECT_NAMES, 'bend', 'hex-float', 'particle-scroll'])
const extendedObjects = new Set<string>(['dithered-object', 'particle-object', 'liquid-object'])

export interface CanvasComponentSelection {
  readonly id: string
  readonly rendererKey: string
  readonly input: unknown
}

export interface CanvasComponentViewProps {
  /** The selection must come from the same executable registry ID. */
  readonly selection: CanvasComponentSelection
  /** Actual current source, independently retained by children. */
  readonly value: unknown
  readonly children?: ReactNode
  readonly isStreaming?: boolean
  readonly dark?: boolean
}

const sourceStyle: CSSProperties = { minWidth: 0, overflowWrap: 'anywhere', background: 'var(--iexp-solid-card)', color: 'var(--iexp-text, inherit)' }
const hostStyle: CSSProperties = { minWidth: 0, minHeight: 120, overflow: 'hidden', position: 'relative', background: 'var(--iexp-solid-card)' }
const pairStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 'var(--iexp-space, 1rem)', minWidth: 0 }

function errorText(error: unknown): string { return error instanceof Error && error.message ? error.message : String(error) }

function sameHtmlSource(input: CanvasComponentInput, value: unknown): boolean {
  const actual = canvasComponentSourceValue(value)
  if (input.kind === 'canvas-html') return actual === input.source
  if (input.kind === 'canvas-html-pair') {
    return !!actual && typeof actual === 'object' && !Array.isArray(actual)
      && (actual as Record<string, unknown>).kind === 'canvas-html-pair'
      && (actual as Record<string, unknown>).primary === input.primary
      && (actual as Record<string, unknown>).alternate === input.alternate
  }
  return true
}

/**
 * The only production object resolver. It derives the reference from the
 * actual retained source, verifies downloaded bytes, then creates a local blob.
 * It never consumes a model-supplied blob URL or `verified` flag.
 */
export async function resolveCanvasVerifiedObjectAsset(input: Extract<CanvasComponentInput, { kind: 'canvas-object-ref' }>, actualValue: unknown, signal: AbortSignal): Promise<CanvasTrustedObjectAsset> {
  const source = glbSource(canvasComponentSourceValue(actualValue))
  if (!source || source.reference !== input.sourceRef || (source.kind === 'image' ? 'image' : 'glb') !== input.assetKind) {
    throw new Error('CANVAS_COMPONENT_OBJECT_SOURCE_MISMATCH')
  }
  const mime = source.kind === 'image' ? source.mime : undefined
  const response = await fetch(safeAssetUrl(source.reference, mime), { signal, credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw new Error(`CANVAS_COMPONENT_OBJECT_FETCH_${String(response.status)}`)
  const bytes = await readGlbResponse(response, input.assetKind === 'image' ? MAX_IMAGE_BYTES : MAX_GLB_BYTES)
  if (input.assetKind === 'image') {
    if (source.kind !== 'image' || !isSafeRaster(bytes, source.mime)) throw new Error('CANVAS_COMPONENT_OBJECT_RASTER_INVALID')
  } else if (!inspectGlb(bytes).ok) {
    throw new Error('CANVAS_COMPONENT_OBJECT_GLB_INVALID')
  }
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: input.assetKind === 'image' ? source.kind === 'image' ? source.mime : 'application/octet-stream' : 'model/gltf-binary' }))
  return Object.freeze({ sourceRef: source.reference, objectUrl, assetKind: input.assetKind, verifiedByHost: true })
}

function Fallback({ children, message }: { readonly children?: ReactNode, readonly message: string }): ReactElement {
  return h('div', { 'data-canvas-component-status': 'blocked' }, children, h('p', { role: 'status', 'data-canvas-component-error': true }, message))
}

function ExtendedHtmlProjection({ input, value, children, isStreaming }: { readonly input: Extract<CanvasComponentInput, { kind: 'canvas-html' | 'canvas-html-pair' }>, readonly value: unknown, readonly children?: ReactNode, readonly isStreaming: boolean }): ReactElement {
  const loadEffect = useContext(CanvasRuntimeContext)
  const content = useRef<HTMLDivElement>(null), alternate = useRef<HTMLPreElement>(null), host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'pending' | 'ready' | 'blocked' | 'failed'>('pending')
  const [failure, setFailure] = useState<string>()
  const validSource = sameHtmlSource(input, value)
  useEffect(() => {
    let live = true
    let dispose: (() => void) | undefined
    let disposed = false
    const controller = new AbortController()
    const disposeEffect = () => {
      if (disposed) return
      disposed = true
      try { dispose?.() } catch { /* Retained source must remain mounted. */ }
    }
    const assignEffect = (next: () => void): boolean => {
      if (!live || controller.signal.aborted || disposed) {
        try { next() } catch { /* The source remains readable after a late adapter. */ }
        return false
      }
      dispose = next
      return true
    }
    const fail = (error: unknown) => {
      if (!live || controller.signal.aborted) return
      live = false
      disposeEffect()
      setStatus('failed'); setFailure(errorText(error))
    }
    if (!validSource) { setStatus('blocked'); setFailure('Canvas 组件未装载：选择输入与当前原始来源不一致。'); return () => { live = false; controller.abort() } }
    if (isStreaming) { setStatus('blocked'); setFailure('Canvas 组件未装载：流式内容尚未稳定。'); return () => { live = false; controller.abort() } }
    if (!content.current || !host.current || input.kind === 'canvas-html-pair' && !alternate.current) {
      setStatus('failed'); setFailure('Canvas 组件未装载：原始来源或视觉区域不可用。'); return () => { live = false; controller.abort() }
    }
    setStatus('pending'); setFailure(undefined)
    void (async () => {
      try {
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) throw new Error('CANVAS_COMPONENT_REDUCED_MOTION')
        if (input.component === 'liquid') {
          const effect = await createCanvasExtendedLiquidEffect({ host: host.current!, content: content.current!, signal: controller.signal, onError: fail })
          if (!assignEffect(() => effect.destroy())) return
        } else {
          if (!isCanvasExtendedHtmlEffectName(input.component)) throw new Error('CANVAS_COMPONENT_EXTENDED_HTML_UNKNOWN')
          const factory = await loadEffect(input.component)
          const effect = await createCanvasExtendedHtmlEffect({
            component: input.component,
            host: host.current!,
            content: content.current!,
            ...(input.kind === 'canvas-html-pair' ? { alternateContent: alternate.current! } : {}),
            factory,
            scope: 'visual-only',
            sourceRemainsVisible: true,
            signal: controller.signal,
            onError: fail,
          })
          if (!assignEffect(() => effect.dispose())) return
        }
        if (live && !controller.signal.aborted) setStatus('ready')
      } catch (error) { fail(error) }
    })()
    return () => { live = false; controller.abort(); disposeEffect() }
  }, [input.component, input.kind, input.kind === 'canvas-html-pair' ? input.primary : input.source, input.kind === 'canvas-html-pair' ? input.alternate : '', isStreaming, loadEffect, validSource])

  return h('div', { 'data-canvas-component': `canvas:${input.component}`, 'data-canvas-component-status': status },
    h('div', { style: pairStyle },
      h('div', { ref: content, 'data-canvas-component-source': true, style: sourceStyle }, children),
      input.kind === 'canvas-html-pair' ? h('pre', { ref: alternate, 'data-canvas-component-alternate-source': true, style: { ...sourceStyle, margin: 0, whiteSpace: 'pre-wrap' } }, input.alternate) : null,
      h('div', { ref: host, 'data-canvas-component-effect-host': true, 'aria-hidden': true, style: hostStyle }),
    ),
    failure ? h('p', { role: 'status', 'data-canvas-component-error': true }, `Canvas ${input.component} 效果未装载：${failure}`) : null,
  )
}

function ObjectProjection({ input, value, children, isStreaming }: { readonly input: Extract<CanvasComponentInput, { kind: 'canvas-object-ref' }>, readonly value: unknown, readonly children?: ReactNode, readonly isStreaming: boolean }): ReactElement {
  const loadEffect = useContext(CanvasRuntimeContext)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'pending' | 'ready' | 'blocked' | 'failed'>('pending')
  const [failure, setFailure] = useState<string>()
  useEffect(() => {
    let live = true
    let objectUrl = ''
    let instance: CanvasEffectInstance | undefined
    let extended: { dispose(): void } | undefined
    let release: (() => void) | undefined
    let disposed = false
    const controller = new AbortController()
    const disposeResources = () => {
      if (disposed) return
      disposed = true
      try { extended?.dispose(); instance?.destroy() } finally {
        release?.(); release = undefined
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
      }
    }
    const assignExtended = (next: { dispose(): void }): boolean => {
      if (!live || controller.signal.aborted || disposed) { next.dispose(); return false }
      extended = next
      return true
    }
    const assignInstance = (next: CanvasEffectInstance): boolean => {
      if (!live || controller.signal.aborted || disposed) { next.destroy(); return false }
      instance = next
      return true
    }
    const assignRelease = (next: () => void): boolean => {
      if (!live || controller.signal.aborted || disposed) { next(); return false }
      release = next
      return true
    }
    const fail = (error: unknown) => {
      if (!live || controller.signal.aborted) return
      live = false
      disposeResources()
      setStatus('failed'); setFailure(errorText(error))
    }
    const target = canvas.current
    if (isStreaming) { setStatus('blocked'); setFailure('Canvas 对象未装载：流式内容尚未稳定。'); return () => { live = false; controller.abort() } }
    if (!target) { setStatus('failed'); setFailure('Canvas 对象未装载：视觉画布不可用。'); return () => { live = false; controller.abort() } }
    setStatus('pending'); setFailure(undefined)
    void (async () => {
      try {
        if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) throw new Error('CANVAS_COMPONENT_REDUCED_MOTION')
        const asset = await resolveCanvasVerifiedObjectAsset(input, value, controller.signal)
        objectUrl = asset.objectUrl
        if (!live || controller.signal.aborted) { URL.revokeObjectURL(objectUrl); objectUrl = ''; return }
        const factory = await loadEffect(input.component)
        if (!live || controller.signal.aborted) return
        if (isCanvasExtendedObjectEffectName(input.component)) {
          const effect = await createCanvasExtendedObjectEffect({
            component: input.component,
            canvas: target,
            asset: { sourceRef: asset.sourceRef, objectUrl: asset.objectUrl, kind: asset.assetKind, verified: true },
            factory,
            sourceRemainsVisible: true,
            signal: controller.signal,
            onError: fail,
          })
          if (!assignExtended(effect)) return
          if (live && !controller.signal.aborted) setStatus('ready')
          return
        }
        const slotRelease = acquireCanvasSlot(() => {
          if (!live || controller.signal.aborted) return
          try {
            const created = factory({ canvas: target }, {
              src: asset.objectUrl,
              dracoDecoderPath: '',
              background: '',
              orbit: true,
              zoom: false,
              onLoad: () => { if (live && !controller.signal.aborted) setStatus('ready') },
              onError: (error: unknown) => fail(error),
            }) ?? undefined
            if (!created) throw new Error('CANVAS_COMPONENT_OBJECT_UNAVAILABLE')
            assignInstance(created)
          } catch (error) { fail(error) }
        })
        assignRelease(slotRelease)
      } catch (error) { fail(error) }
    })()
    return () => {
      live = false; controller.abort(); disposeResources()
    }
  }, [input.component, input.sourceRef, input.assetKind, value, isStreaming, loadEffect])
  return h('div', { 'data-canvas-component': `canvas:${input.component}`, 'data-canvas-component-status': status },
    h('div', { style: pairStyle },
      h('div', { 'data-canvas-component-source': true, style: sourceStyle }, children),
      h('canvas', { ref: canvas, 'data-canvas-component-effect-host': true, 'aria-hidden': true, style: { ...hostStyle, width: '100%', height: 280 } }),
    ),
    failure ? h('p', { role: 'status', 'data-canvas-component-error': true }, `Canvas ${input.component} 对象未装载：${failure}`) : null,
  )
}

/**
 * Real Canvas renderer dispatch. Every branch preserves `children` as the
 * readable source; only fixed upstream factories receive a captured texture or
 * a Host-verified local object blob.
 */
export function CanvasComponentView({ selection, value, children, isStreaming = false }: CanvasComponentViewProps): ReactElement {
  if (selection.rendererKey !== CANVAS_COMPONENT_RENDERER_KEY) return h(Fallback, { message: 'Canvas 组件未装载：rendererKey 不匹配。' }, children)
  let input: CanvasComponentInput
  try { input = parseCanvasComponentInput(selection.id, selection.input) }
  catch (error) { return h(Fallback, { message: `Canvas 组件未装载：${errorText(error)}` }, children) }
  if (selection.id !== `canvas:${input.component}`) return h(Fallback, { message: 'Canvas 组件未装载：组件 ID 与输入不匹配。' }, children)
  const actualSource = canvasComponentSourceValue(value)
  if (input.kind === 'canvas-magnify') return h(CanvasBlockView, { presentation: 'canvas-magnify', value: actualSource, isStreaming }, children)
  if (input.kind === 'canvas-html' && baseHtml.has(input.component)) return h(CanvasBlockView, { presentation: `canvas-${input.component}`, value: actualSource, isStreaming }, children)
  if (input.kind === 'canvas-object-ref') return h(ObjectProjection, { input, value, isStreaming }, children)
  return h(ExtendedHtmlProjection, { input, value, isStreaming }, children)
}
