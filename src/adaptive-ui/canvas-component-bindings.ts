import { CANVAS_UI_COMPONENTS, type CanvasComponent } from '../canvas-catalog.js'
import { CANVAS_HTML_EFFECT_NAMES } from '../canvas-html-names.js'
import { glbSource } from '../canvas-object-source.js'
import {
  ExecutableComponentRegistry,
  type ExecutableComponentContext,
  type ExecutableComponentDefinition,
  type ExecutableJson,
} from './executable-registry.js'
import { canvasBlockCandidates } from './canvas-block-recipes.js'

export const CANVAS_COMPONENT_RENDERER_KEY = 'canvas-component' as const
export const CANVAS_COMPONENT_IDS = Object.freeze(CANVAS_UI_COMPONENTS.map(component => `canvas:${component.slug}`))

type CanvasSlug = typeof CANVAS_UI_COMPONENTS[number]['slug']
type CanvasObjectSlug = 'ascii-object' | 'dithered-object' | 'glass-object' | 'ink-object' | 'liquid-object' | 'particle-object'
type CanvasHtmlSlug = Exclude<CanvasSlug, CanvasObjectSlug | 'ascii-sweep' | 'magnify'>

/** Only a Host-owned resolver can create this value. It is never DIL/JSON input. */
export interface CanvasTrustedObjectAsset {
  readonly sourceRef: string
  readonly objectUrl: string
  readonly assetKind: 'glb' | 'image'
  readonly verifiedByHost: true
}

export type CanvasComponentInput =
  | Readonly<{ kind: 'canvas-html', component: CanvasHtmlSlug, source: string }>
  | Readonly<{ kind: 'canvas-html-pair', component: 'ascii-sweep', primary: string, alternate: string }>
  | Readonly<{ kind: 'canvas-magnify', component: 'magnify', source: ExecutableJson }>
  | Readonly<{ kind: 'canvas-object-ref', component: CanvasObjectSlug, sourceRef: string, assetKind: 'glb' | 'image' }>

export interface CanvasComponentInputContract {
  readonly componentId: string
  readonly rendererKey: typeof CANVAS_COMPONENT_RENDERER_KEY
  readonly sourceRetention: 'required'
  /** The only model/DIL authoring input: use the actual current source block. */
  readonly authorInputShape: Readonly<Record<string, ExecutableJson>>
  /** Host-derived renderer data, validated again by CanvasComponentView. */
  readonly internalInputShape: Readonly<Record<string, ExecutableJson>>
  readonly requirements: readonly string[]
}

export interface CanvasSourceCapabilities {
  readonly webgl: boolean
  readonly reducedMotion: boolean
}

export type CanvasSourceBinding =
  | Readonly<{ eligible: true, input: CanvasComponentInput, reasons: readonly string[] }>
  | Readonly<{ eligible: false, reasons: readonly string[] }>

export class CanvasComponentBindingError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'CanvasComponentBindingError'
  }
}

const extendedObjectSlugs = ['dithered-object', 'particle-object', 'liquid-object'] as const
const extendedHtmlSlugs = ['ascii-sweep', 'bubble', 'cloth', 'droplets', 'flame-wrap', 'force-field', 'glass', 'glyph-rain', 'laser', 'liquid', 'peel', 'retro-dither'] as const
const objectSlugs = new Set<string>(['ascii-object', ...extendedObjectSlugs, 'glass-object', 'ink-object'])
const baseHtmlSlugs = new Set<string>([...CANVAS_HTML_EFFECT_NAMES, 'bend', 'hex-float', 'particle-scroll'])
const extendedHtmlSlugSet = new Set<string>(extendedHtmlSlugs)
const printable = /^[^\u0000-\u001f\u007f]{1,2048}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(), expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/** Match compiler-owned source blocks while refusing lookalike arbitrary records. */
export function canvasComponentSourceValue(value: unknown): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, 'value')) return value
  const compiledBlock = typeof value.id === 'string' && typeof value.kind === 'string' && Array.isArray(value.path)
    && Array.isArray(value.evidence) && typeof value.passive === 'boolean'
  if (compiledBlock) return value.value
  // Host decision state carries this exact envelope. It is intentionally
  // recognized without adding a passive/material tag to the model state.
  const reference = value.reference
  const hostEnvelope = typeof value.id === 'string' && isRecord(reference)
    && reference.id === value.id && typeof reference.kind === 'string'
    && Array.isArray(reference.path) && reference.path.every(part => Number.isSafeInteger(part) && part >= 0)
    && Array.isArray(value.recipes)
  return hostEnvelope ? value.value : value
}

function componentFromId(id: string): CanvasComponent | undefined {
  if (typeof id !== 'string' || !id.startsWith('canvas:')) return undefined
  return CANVAS_UI_COMPONENTS.find(component => component.slug === id.slice('canvas:'.length))
}

function blockedReasons(context: ExecutableComponentContext): readonly string[] {
  const reasons: string[] = []
  if (context.capabilities.webgl !== true) reasons.push('capability:webgl-required')
  if (context.capabilities.reducedMotion === true) reasons.push('capability:reduced-motion')
  if (context.isStreaming === true) reasons.push('source:streaming')
  return Object.freeze(reasons)
}

function safeText(value: unknown, context: ExecutableComponentContext): { readonly source: string, readonly candidateIds: ReadonlySet<string>, readonly evidence: readonly string[] } | undefined {
  const source = canvasComponentSourceValue(value)
  if (typeof source !== 'string') return undefined
  const candidates = canvasBlockCandidates(source, context.capabilities, context.isStreaming === true)
  if (!candidates.length) return undefined
  return Object.freeze({
    source,
    candidateIds: new Set(candidates.map(candidate => candidate.id)),
    evidence: Object.freeze([...new Set(candidates.flatMap(candidate => candidate.evidence))]),
  })
}

function objectInput(slug: CanvasObjectSlug, context: ExecutableComponentContext): CanvasComponentInput | undefined {
  const source = glbSource(canvasComponentSourceValue(context.source))
  if (!source || !printable.test(source.reference)) return undefined
  return Object.freeze({ kind: 'canvas-object-ref', component: slug, sourceRef: source.reference, assetKind: source.kind === 'image' ? 'image' : 'glb' })
}

function pairInput(value: unknown, context: ExecutableComponentContext): CanvasComponentInput | undefined {
  const source = canvasComponentSourceValue(value)
  if (!isRecord(source) || !sameKeys(source, ['alternate', 'kind', 'primary']) || source.kind !== 'canvas-html-pair'
    || typeof source.primary !== 'string' || typeof source.alternate !== 'string') return undefined
  if (!safeText(source.primary, context) || !safeText(source.alternate, context)) return undefined
  return Object.freeze({ kind: 'canvas-html-pair', component: 'ascii-sweep', primary: source.primary, alternate: source.alternate })
}

function magnifyInput(value: unknown, context: ExecutableComponentContext): CanvasComponentInput | undefined {
  if (!canvasBlockCandidates(value, context.capabilities, context.isStreaming === true).some(candidate => candidate.id === 'canvas-magnify')) return undefined
  const source = canvasComponentSourceValue(value)
  return isRecord(source) ? Object.freeze({ kind: 'canvas-magnify', component: 'magnify', source: source as ExecutableJson }) : undefined
}

function htmlInput(value: unknown, slug: CanvasHtmlSlug, context: ExecutableComponentContext): CanvasComponentInput | undefined {
  const text = safeText(value, context)
  if (!text) return undefined
  if (baseHtmlSlugs.has(slug) && !text.candidateIds.has(`canvas-${slug}`)) return undefined
  return Object.freeze({ kind: 'canvas-html', component: slug, source: text.source })
}

function inputFor(component: CanvasComponent, context: ExecutableComponentContext): CanvasComponentInput | undefined {
  if (objectSlugs.has(component.slug)) return objectInput(component.slug as CanvasObjectSlug, context)
  if (component.slug === 'ascii-sweep') return pairInput(context.source, context)
  if (component.slug === 'magnify') return magnifyInput(context.source, context)
  return htmlInput(context.source, component.slug as CanvasHtmlSlug, context)
}

/**
 * Shared pure source binding for registry and DIL. It accepts only the actual
 * block value, never model-generated HTML, JavaScript, verified flags or blobs.
 */
export function bindCanvasComponentSource(componentId: string, source: unknown, capabilities: CanvasSourceCapabilities, isStreaming = false): CanvasSourceBinding {
  const component = componentFromId(componentId)
  if (!component) return Object.freeze({ eligible: false as const, reasons: Object.freeze(['component:unknown']) })
  const context: ExecutableComponentContext = { source, capabilities, isStreaming }
  const blocked = blockedReasons(context)
  if (blocked.length) return Object.freeze({ eligible: false as const, reasons: blocked })
  const input = inputFor(component, context)
  if (!input) return Object.freeze({ eligible: false as const, reasons: requirements(component) })
  return Object.freeze({ eligible: true as const, input, reasons: requirements(component) })
}

function validObjectReference(value: Record<string, unknown>, slug: CanvasObjectSlug): CanvasComponentInput | undefined {
  if (!sameKeys(value, ['assetKind', 'component', 'kind', 'sourceRef']) || value.kind !== 'canvas-object-ref' || value.component !== slug
    || typeof value.sourceRef !== 'string' || !printable.test(value.sourceRef) || (value.assetKind !== 'glb' && value.assetKind !== 'image')) return undefined
  return Object.freeze({ kind: 'canvas-object-ref', component: slug, sourceRef: value.sourceRef, assetKind: value.assetKind })
}

/** Strictly validates DIL/host bridge data before the Canvas view may mount it. */
export function parseCanvasComponentInput(componentId: string, value: unknown): CanvasComponentInput {
  const component = componentFromId(componentId)
  if (!component || !isRecord(value)) throw new CanvasComponentBindingError('CANVAS_COMPONENT_INPUT_INVALID')
  if (objectSlugs.has(component.slug)) {
    const input = validObjectReference(value, component.slug as CanvasObjectSlug)
    if (!input) throw new CanvasComponentBindingError('CANVAS_COMPONENT_INPUT_INVALID')
    return input
  }
  if (component.slug === 'ascii-sweep') {
    if (!sameKeys(value, ['alternate', 'component', 'kind', 'primary']) || value.kind !== 'canvas-html-pair' || value.component !== 'ascii-sweep'
      || typeof value.primary !== 'string' || typeof value.alternate !== 'string') throw new CanvasComponentBindingError('CANVAS_COMPONENT_INPUT_INVALID')
    return Object.freeze({ kind: 'canvas-html-pair', component: 'ascii-sweep', primary: value.primary, alternate: value.alternate })
  }
  if (component.slug === 'magnify') {
    if (!sameKeys(value, ['component', 'kind', 'source']) || value.kind !== 'canvas-magnify' || value.component !== 'magnify') throw new CanvasComponentBindingError('CANVAS_COMPONENT_INPUT_INVALID')
    return Object.freeze({ kind: 'canvas-magnify', component: 'magnify', source: value.source as ExecutableJson })
  }
  if (!sameKeys(value, ['component', 'kind', 'source']) || value.kind !== 'canvas-html' || value.component !== component.slug || typeof value.source !== 'string') {
    throw new CanvasComponentBindingError('CANVAS_COMPONENT_INPUT_INVALID')
  }
  return Object.freeze({ kind: 'canvas-html', component: component.slug as CanvasHtmlSlug, source: value.source })
}

export function isCanvasComponentInput(componentId: string, value: unknown): value is CanvasComponentInput {
  try { parseCanvasComponentInput(componentId, value); return true } catch { return false }
}

function requirements(component: CanvasComponent): readonly string[] {
  if (objectSlugs.has(component.slug)) return Object.freeze(['capability:webgl-required', 'source:actual-object-record', 'source:consumer-must-verify-local-blob', 'source:retained-visible'])
  if (component.slug === 'ascii-sweep') return Object.freeze(['capability:webgl-required', 'source:two-retained-visible-text-panels'])
  if (component.slug === 'magnify') return Object.freeze(['capability:webgl-required', 'source:strict-decorative-color', 'source:retained-visible'])
  return Object.freeze(['capability:webgl-required', 'source:retained-visible-noninteractive-texture'])
}

function suitability(component: CanvasComponent): string {
  if (objectSlugs.has(component.slug)) return `Use Canvas ${component.name} only for an actual declared GLB or raster source; the consumer fetches, validates, and creates a local blob before mounting.`
  if (component.slug === 'ascii-sweep') return 'Use Canvas ASCII Sweep only when two independently retained, source-backed text panels are available.'
  if (component.slug === 'magnify') return 'Use Canvas Magnify only for an explicit decorative color source with no text content.'
  if (extendedHtmlSlugSet.has(component.slug)) return `Use Canvas ${component.name} as a visual-only fixed-factory texture projection beside the retained source.`
  if (baseHtmlSlugs.has(component.slug)) return `Use Canvas ${component.name} through its existing source-preserving Canvas consumer.`
  return `Use Canvas ${component.name} only through its fixed executable adapter.`
}

function definition(component: CanvasComponent): ExecutableComponentDefinition {
  const id = `canvas:${component.slug}`
  return {
    id,
    family: 'canvas',
    title: `Canvas ${component.name}`,
    suitability: suitability(component),
    rendererKey: CANVAS_COMPONENT_RENDERER_KEY,
    inputSchema: { parse: value => parseCanvasComponentInput(id, value) },
    bind: context => {
      const bound = bindCanvasComponentSource(id, context.source, context.capabilities, context.isStreaming === true)
      return bound.eligible
        ? { eligible: true as const, input: bound.input, reasons: bound.reasons }
        : { eligible: false as const, reasons: bound.reasons }
    },
  }
}

/** Register all 35 pinned Canvas IDs. Each definition has an actual consumer route. */
export function registerCanvasComponents(registry: ExecutableComponentRegistry): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const component of CANVAS_UI_COMPONENTS) disposers.push(registry.register(definition(component)))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function contractFor(component: CanvasComponent): CanvasComponentInputContract {
  const id = `canvas:${component.slug}`
  if (objectSlugs.has(component.slug)) return Object.freeze({
    componentId: id,
    rendererKey: CANVAS_COMPONENT_RENDERER_KEY,
    sourceRetention: 'required',
    authorInputShape: { source: 'actual-current-object-source' },
    internalInputShape: { kind: 'canvas-object-ref', component: component.slug, sourceRef: 'actual-source-reference', assetKind: ['glb', 'image'] },
    requirements: requirements(component),
  })
  if (component.slug === 'ascii-sweep') return Object.freeze({
    componentId: id,
    rendererKey: CANVAS_COMPONENT_RENDERER_KEY,
    sourceRetention: 'required',
    authorInputShape: { source: 'actual-current-two-panel-source' },
    internalInputShape: { kind: 'canvas-html-pair', component: 'ascii-sweep', primary: 'source-backed-noninteractive-markdown', alternate: 'source-backed-noninteractive-markdown' },
    requirements: requirements(component),
  })
  if (component.slug === 'magnify') return Object.freeze({
    componentId: id,
    rendererKey: CANVAS_COMPONENT_RENDERER_KEY,
    sourceRetention: 'required',
    authorInputShape: { source: 'actual-current-decorative-color-source' },
    internalInputShape: { kind: 'canvas-magnify', component: 'magnify', source: { role: 'decorative', color: 'css-color-or-rgb' } },
    requirements: requirements(component),
  })
  return Object.freeze({
    componentId: id,
    rendererKey: CANVAS_COMPONENT_RENDERER_KEY,
    sourceRetention: 'required',
    authorInputShape: { source: 'actual-current-noninteractive-markdown' },
    internalInputShape: { kind: 'canvas-html', component: component.slug, source: 'source-backed-noninteractive-markdown' },
    requirements: requirements(component),
  })
}

/** JSON-safe bridge contract for Solar UI catalog and DIL source authoring. */
export function getCanvasComponentInputContract(componentId: string): CanvasComponentInputContract | undefined {
  const component = componentFromId(componentId)
  return component ? contractFor(component) : undefined
}
