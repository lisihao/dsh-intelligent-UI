import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { classifyCanvasAutoDomain } from './canvas-auto-plan-domain.js'
import {
  findCanvasComponent,
  type CanvasBrowserCapability,
  type CanvasRenderer,
} from './canvas-catalog.js'

/** These are declarations made by a registered runtime adapter, not catalog claims. */
export type EffectAssetKind = 'glb' | 'gltf' | 'svg' | 'image'
export type EffectDomain = 'technical-insight' | 'coding' | 'project-management' | 'quantitative' | 'general'
export type EffectSurface = 'visual' | 'reading' | 'data' | 'interactive'
export type EffectThemeStyle = 'auto' | 'ink' | 'ascii' | 'glass' | 'particle' | 'dither' | 'none'
export type EffectFidelity = 'exact' | 'readable' | 'visual-only'

export interface EffectAsset {
  readonly kind: EffectAssetKind
  readonly sourceRef: string
  /** Caller has actually resolved the asset and verified its type. A URL alone is not proof. */
  readonly resolved: boolean
  /** In structured source, the own-property path whose value is the exact sourceRef. */
  readonly sourcePath?: readonly (string | number)[]
}

export interface EffectProvider {
  readonly id: string
  readonly component: string
  readonly renderer: CanvasRenderer
  readonly inputs: readonly (EffectAssetKind | 'html')[]
  /** Only surfaces verified by this actual implementation; visual is the default. */
  readonly safeScopes?: readonly EffectSurface[]
  readonly readableFallback?: boolean
  readonly preservesDataGeometry?: boolean
  readonly preservesInteraction?: boolean
  /** Native is the default. A snapshot must be verified by the adapter, never inferred. */
  readonly htmlRendering?: {
    readonly mode: 'native' | 'snapshot'
    readonly verified: boolean
    readonly fidelity: EffectFidelity
  }
}

export type EffectTarget =
  | { readonly kind: 'asset' }
  | {
      readonly kind: 'html'
      readonly scope: EffectSurface
      /** Exact content excerpt already present in source; not generated copy. */
      readonly sourceText: string
      readonly alternateText?: string
      readonly scrollable?: boolean
      readonly sensitive?: boolean
    }

export interface EffectPlannerInput {
  readonly source: unknown
  readonly target: EffectTarget
  readonly assets: readonly EffectAsset[]
  /** Supply only providers registered and executable in the current host. */
  readonly providers: readonly EffectProvider[]
  readonly capabilities: Partial<Record<CanvasBrowserCapability, boolean>>
  readonly domain?: EffectDomain
  readonly theme?: { readonly id: string, readonly style?: EffectThemeStyle }
  readonly streaming?: boolean
  readonly reducedMotion?: boolean
}

export type EffectAttemptCode = 'invalid-provider' | 'input-unsupported' | 'scope-unverified'
  | 'readable-fallback-unverified' | 'data-geometry-unverified' | 'interaction-unverified'
  | 'native-unverified' | 'native-fidelity-insufficient' | 'snapshot-unverified' | 'snapshot-fidelity-insufficient' | 'missing-capability'
  | 'alternate-source-required' | 'scrollable-source-required'

export interface EffectAttempt {
  readonly component: string
  readonly renderer: CanvasRenderer
  readonly code: EffectAttemptCode
  readonly missingCapabilities?: readonly CanvasBrowserCapability[]
}

export type EffectPlan = {
  readonly status: 'selected'
  readonly providerId: string
  readonly component: string
  readonly renderer: CanvasRenderer
  readonly input: EffectAssetKind | 'html'
  readonly sourceRef?: string
  readonly domain: EffectDomain
  readonly domainBasis: string
  readonly reason: string
  readonly htmlRendering?: { readonly mode: 'native' | 'snapshot', readonly fidelity: EffectFidelity }
  readonly readableFallbackRequired: boolean
} | {
  readonly status: 'fallback'
  readonly code: 'empty-source' | 'streaming' | 'reduced-motion' | 'theme-disabled'
    | 'unanchored-target' | 'sensitive-surface' | 'no-compatible-asset'
    | 'asset-not-in-source' | 'no-registered-provider' | 'no-runnable-provider'
  readonly domain: EffectDomain
  readonly domainBasis: string
  readonly reason: string
  readonly attempts: readonly EffectAttempt[]
}

interface NodeLike {
  type?: string
  value?: string
  url?: string
  identifier?: string
  children?: NodeLike[]
}

const markdown = unified().use(remarkParse).use(remarkGfm)
const mediaKeys = new Set(['src', 'url', 'uri', 'href', 'path', 'reference', 'file'])

/** Walk only the actual supplied data. Cycles are tolerated; no network access is involved. */
function walkSource(source: unknown, test: (value: unknown, key?: string) => boolean): boolean {
  const pending: Array<{ value: unknown, key?: string }> = [{ value: source }]
  const seen = new Set<object>()
  while (pending.length) {
    const item = pending.pop()!
    if (test(item.value, item.key)) return true
    if (!item.value || typeof item.value !== 'object' || seen.has(item.value)) continue
    seen.add(item.value)
    for (const key of Object.keys(item.value)) {
      pending.push({ value: (item.value as Record<string, unknown>)[key], key })
    }
  }
  return false
}

function sourceContains(source: unknown, excerpt: string): boolean {
  return excerpt.trim().length > 0 && walkSource(source, value => typeof value === 'string' && value.includes(excerpt))
}

function ownPathValue(source: unknown, path: readonly (string | number)[]): unknown {
  let value = source
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined
    value = (value as Record<string | number, unknown>)[key]
  }
  return value
}

function markdownContainsMedia(source: string, asset: EffectAsset): boolean {
  const tree = markdown.parse(source) as NodeLike
  const definitions = new Map<string, string>()
  const nodes: NodeLike[] = []
  const pending = [tree]
  while (pending.length) {
    const node = pending.pop()!
    nodes.push(node)
    if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url)
    if (node.children) pending.push(...node.children)
  }
  return nodes.some(node => {
    const isImage = node.type === 'image' || node.type === 'imageReference'
    const isLink = node.type === 'link' || node.type === 'linkReference'
    // Images can be rendered directly. Model and SVG files may also be explicit links.
    if (!isImage && !(isLink && asset.kind !== 'image')) return false
    const ref = node.url ?? (node.identifier ? definitions.get(node.identifier.toLowerCase()) : undefined)
    return ref === asset.sourceRef
  })
}

function assetAnchored(source: unknown, asset: EffectAsset): boolean {
  if (!asset.sourceRef.trim()) return false
  if (asset.sourcePath) return ownPathValue(source, asset.sourcePath) === asset.sourceRef
  if (typeof source === 'string') return markdownContainsMedia(source, asset)
  return walkSource(source, (value, key) => typeof value === 'string' && value === asset.sourceRef && !!key && mediaKeys.has(key.toLowerCase()))
}

function nodeText(node: NodeLike): string {
  return node.value ?? node.children?.map(nodeText).join('') ?? ''
}

/** Require actual headers and rows; a keyword in prose is not enough. */
function markdownTableEvidence(source: string): 'market-series' | 'tasks' | undefined {
  if (!source.includes('|')) return undefined
  const pending = [markdown.parse(source) as NodeLike]
  let tasks = false
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'table' && node.children && node.children.length > 1) {
      const headers = (node.children[0]?.children ?? []).map(cell => nodeText(cell).trim().toLowerCase())
      const date = headers.findIndex(header => /^(date|time|timestamp|日期|时间)$/u.test(header))
      const close = headers.findIndex(header => /^(close|nav|收盘|收盘价|净值)$/u.test(header))
      const task = headers.findIndex(header => /^(task|issue|ticket|任务|事项|工单)$/u.test(header))
      const status = headers.findIndex(header => /^(status|state|状态)$/u.test(header))
      for (const row of node.children.slice(1)) {
        const cells = (row.children ?? []).map(cell => nodeText(cell).trim())
        if (date >= 0 && close >= 0
          && /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:\b|$)/u.test(cells[date] ?? '')
          && /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u.test(cells[close] ?? '')) return 'market-series'
        if (task >= 0 && status >= 0 && cells[task] && cells[status]) tasks = true
      }
    }
    if (node.children) pending.push(...node.children)
  }
  return tasks ? 'tasks' : undefined
}

function classifyDomain(source: unknown, explicit?: EffectDomain): { domain: EffectDomain, basis: string } {
  if (explicit) return { domain: explicit, basis: 'explicit' }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, 'domain')
    if (descriptor && 'value' in descriptor && descriptor.value !== undefined && descriptor.value !== null) {
      const declaration = classifyCanvasAutoDomain({ domain: descriptor.value })
      return declaration.status === 'identified'
        ? { domain: declaration.domain, basis: 'source:explicit' }
        : { domain: 'general', basis: 'source:invalid-domain' }
    }
  }
  // Recognize a complete report before using a local table or code snippet as
  // the domain of the entire document. The decision only orders providers.
  const hasReport = walkSource(source, value => {
    if (typeof value !== 'string' || !value.includes('#') || !/https?:\/\//iu.test(value)) return false
    const decision = classifyCanvasAutoDomain(value)
    return decision.status === 'identified' && decision.domain === 'technical-insight'
  })
  if (hasReport) return { domain: 'technical-insight', basis: 'source:report' }
  let tableEvidence: 'market-series' | 'tasks' | undefined
  walkSource(source, value => {
    if (typeof value !== 'string') return false
    const evidence = markdownTableEvidence(value)
    if (evidence === 'market-series') { tableEvidence = evidence; return true }
    if (evidence === 'tasks') tableEvidence = evidence
    return false
  })
  const hasMarketRecord = walkSource(source, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const row = value as Record<string, unknown>
    const hasTime = ['date', 'time', 'timestamp', '日期', '时间'].some(key => typeof row[key] === 'string' || typeof row[key] === 'number')
    const hasNumber = ['close', 'nav', '收盘', '净值'].some(key => typeof row[key] === 'number' && Number.isFinite(row[key]))
    return hasTime && hasNumber
  })
  if (hasMarketRecord || tableEvidence === 'market-series') return { domain: 'quantitative', basis: 'source:market-series' }
  const hasTask = walkSource(source, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const row = value as Record<string, unknown>
    return ['status', 'state', '状态'].some(key => typeof row[key] === 'string')
      && ['task', 'taskTitle', 'issue', '任务', '工单'].some(key => typeof row[key] === 'string')
  })
  if (hasTask || tableEvidence === 'tasks') return { domain: 'project-management', basis: 'source:tasks' }
  const hasCode = walkSource(source, value => {
    if (typeof value !== 'string' || !/(?:^|\n)\s*(```|~~~)[^\n]*\n[\s\S]*?\n\s*\1/mu.test(value)) return false
    const decision = classifyCanvasAutoDomain(value)
    return decision.status === 'identified' && decision.domain === 'coding'
  })
  if (hasCode) return { domain: 'coding', basis: 'source:code' }
  return { domain: 'general', basis: 'source:general' }
}

const preferredObjects: Record<EffectDomain, readonly string[]> = {
  'technical-insight': ['ink-object', 'particle-object', 'dithered-object'],
  coding: ['ascii-object', 'dithered-object', 'glass-object'],
  'project-management': ['glass-object', 'particle-object', 'ink-object'],
  quantitative: ['dithered-object', 'particle-object', 'ink-object'],
  general: ['ink-object', 'glass-object', 'particle-object'],
}
const preferredHtml: Record<EffectDomain, readonly string[]> = {
  'technical-insight': ['asciify', 'magnify', 'glass', 'retro-dither'],
  coding: ['asciify', 'decrypt-reveal', 'grid', 'retro-dither'],
  'project-management': ['glass', 'magnify', 'grid', 'particle-reveal'],
  quantitative: ['magnify', 'grid', 'glass', 'retro-dither'],
  general: ['glass', 'magnify', 'asciify', 'retro-dither'],
}
const styleObjects: Partial<Record<EffectThemeStyle, readonly string[]>> = {
  ink: ['ink-object'], ascii: ['ascii-object'], glass: ['glass-object', 'liquid-object'],
  particle: ['particle-object'], dither: ['dithered-object'],
}
const styleHtml: Partial<Record<EffectThemeStyle, readonly string[]>> = {
  ink: ['canvas'], ascii: ['asciify', 'ascii-sweep', 'decrypt-reveal', 'glyph-rain'],
  glass: ['glass', 'bubble', 'frost'], particle: ['particle-reveal', 'particle-scroll'], dither: ['retro-dither'],
}

function rankedProviders(input: EffectPlannerInput, domain: EffectDomain): EffectProvider[] {
  const style = input.theme?.style ?? 'auto'
  const preferred = input.target.kind === 'asset'
    ? [...(styleObjects[style] ?? []), ...preferredObjects[domain]]
    : [...(styleHtml[style] ?? []), ...preferredHtml[domain]]
  return input.providers.map((provider, index) => ({ provider, index, rank: preferred.indexOf(provider.component) }))
    .sort((a, b) => (a.rank < 0 ? 1000 : a.rank) - (b.rank < 0 ? 1000 : b.rank) || a.index - b.index)
    .map(item => item.provider)
}

/** Plan only. A selected provider still has to be executed by the host with the original content. */
export function planCanvasEffect(input: EffectPlannerInput): EffectPlan {
  // These cases always keep the original. Avoid expensive whole-document
  // inference while content streams or effects are disabled.
  const skipped = input.streaming ? 'source:streaming' : input.reducedMotion ? 'source:reduced-motion' : input.theme?.style === 'none' ? 'source:theme-disabled' : undefined
  const classification = skipped && !input.domain
    ? { domain: 'general' as const, basis: skipped }
    : classifyDomain(input.source, input.domain)
  const domain = classification.domain
  const domainBasis = classification.basis
  const fallback = (code: Extract<EffectPlan, { status: 'fallback' }>['code'], reason: string, attempts: readonly EffectAttempt[] = []): EffectPlan =>
    ({ status: 'fallback', code, domain, domainBasis, reason, attempts })
  if (input.source === undefined || input.source === null || (typeof input.source === 'string' && !input.source.trim())) return fallback('empty-source', 'No source content was supplied.')
  if (input.streaming) return fallback('streaming', 'The source is still changing; keep the original content until it is complete.')
  if (input.reducedMotion) return fallback('reduced-motion', 'The provider has not declared a verified reduced-motion mode.')
  if (input.theme?.style === 'none') return fallback('theme-disabled', 'The selected theme disables effects.')
  if (input.target.kind === 'html') {
    if (input.target.sensitive) return fallback('sensitive-surface', 'Sensitive content is kept in its original presentation.')
    if (!sourceContains(input.source, input.target.sourceText)) return fallback('unanchored-target', 'The target text is not present in the source.')
  }
  const resolved = input.assets.filter(asset => asset.resolved && asset.sourceRef.trim())
  const anchored = input.target.kind === 'asset' ? resolved.filter(asset => assetAnchored(input.source, asset)) : []
  if (input.target.kind === 'asset' && !resolved.length) return fallback('no-compatible-asset', 'No resolved, type-verified source asset was provided.')
  if (input.target.kind === 'asset' && !anchored.length) return fallback('asset-not-in-source', 'The resolved asset is not referenced by the actual source.')
  if (!input.providers.length) return fallback('no-registered-provider', 'The component catalog contains metadata only; no executable provider is registered.')

  const attempts: EffectAttempt[] = []
  for (const provider of rankedProviders(input, domain)) {
    const attempt = (code: EffectAttemptCode, missingCapabilities?: readonly CanvasBrowserCapability[]) => {
      attempts.push({ component: provider.component, renderer: provider.renderer, code, ...(missingCapabilities ? { missingCapabilities } : {}) })
    }
    const component = findCanvasComponent(provider.component)
    if (!provider.id.trim() || !component || !['webgl', 'webgpu'].includes(provider.renderer)
      || component.kind !== (input.target.kind === 'asset' ? 'object' : 'html')) { attempt('invalid-provider'); continue }
    const asset = input.target.kind === 'asset'
      ? anchored.find(item => provider.inputs.includes(item.kind) && component.inputs.includes(item.kind))
      : undefined
    if (input.target.kind === 'asset' && !asset) { attempt('input-unsupported'); continue }
    if (input.target.kind === 'html' && !provider.inputs.includes('html')) { attempt('input-unsupported'); continue }
    if (input.target.kind === 'html') {
      const scope = input.target.scope
      if (scope !== 'visual' && !provider.safeScopes?.includes(scope)) { attempt('scope-unverified'); continue }
      if (scope !== 'visual' && !provider.readableFallback) { attempt('readable-fallback-unverified'); continue }
      if (scope === 'data' && !provider.preservesDataGeometry) { attempt('data-geometry-unverified'); continue }
      if (scope === 'interactive' && !provider.preservesInteraction) { attempt('interaction-unverified'); continue }
      if ((provider.component === 'ascii-sweep' || provider.component === 'peel')
        && (!input.target.alternateText || input.target.alternateText === input.target.sourceText || !sourceContains(input.source, input.target.alternateText))) {
        attempt('alternate-source-required'); continue
      }
      if ((provider.component === 'laser' || provider.component === 'particle-scroll') && !input.target.scrollable) {
        attempt('scrollable-source-required'); continue
      }
      if (provider.htmlRendering?.mode === 'native') {
        if (!provider.htmlRendering.verified) { attempt('native-unverified'); continue }
        if ((scope !== 'visual' && provider.htmlRendering.fidelity === 'visual-only')
          || (scope === 'data' && provider.htmlRendering.fidelity !== 'exact')) { attempt('native-fidelity-insufficient'); continue }
      }
      if (provider.htmlRendering?.mode === 'snapshot') {
        if (!provider.htmlRendering.verified) { attempt('snapshot-unverified'); continue }
        if ((scope !== 'visual' && provider.htmlRendering.fidelity === 'visual-only')
          || (scope === 'data' && provider.htmlRendering.fidelity !== 'exact')) { attempt('snapshot-fidelity-insufficient'); continue }
      }
    }
    const usingSnapshot = input.target.kind === 'html' && provider.htmlRendering?.mode === 'snapshot'
    const missing = component.requiredCapabilities[provider.renderer].filter(capability =>
      !(usingSnapshot && capability === 'html-in-canvas') && input.capabilities[capability] !== true)
    if (missing.length) { attempt('missing-capability', missing); continue }
    const htmlRendering = input.target.kind === 'html'
      ? { mode: provider.htmlRendering?.mode ?? 'native', fidelity: provider.htmlRendering?.fidelity ?? (provider.readableFallback ? 'readable' : 'visual-only') } as const
      : undefined
    const requiresReadable = input.target.kind === 'html' && input.target.scope !== 'visual'
    return {
      status: 'selected', providerId: provider.id, component: component.slug, renderer: provider.renderer,
      input: asset?.kind ?? 'html', ...(asset ? { sourceRef: asset.sourceRef } : {}), domain, domainBasis,
      reason: `Registered provider supports the anchored ${input.target.kind === 'asset' ? 'asset' : input.target.scope} source and observed browser capabilities; domain basis: ${domainBasis}; theme style: ${input.theme?.style ?? 'auto'}${htmlRendering ? `; HTML route: ${htmlRendering.mode} (${htmlRendering.fidelity})` : ''}.`,
      ...(htmlRendering ? { htmlRendering } : {}), readableFallbackRequired: requiresReadable,
    }
  }
  return fallback('no-runnable-provider', 'No registered provider is compatible with the source, surface and observed browser capabilities.', attempts)
}
