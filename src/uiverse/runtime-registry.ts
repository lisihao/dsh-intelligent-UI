import { parseFragment } from 'parse5'
import postcss from 'postcss'
import type { Catalog, CatalogItem } from './catalog.js'
import {
  auditUiverseRuntimeBindings,
  type UiverseBindingBlockerCode,
  type UiverseRuntimeBindingAudit,
  type UiverseRuntimeBindingEntry,
} from './runtime-binding-audit.js'
import { evaluateUiverseRuntimeEligibility } from './runtime-eligibility.js'
import { sanitizeUiverseCss } from './runtime-sanitize.js'
export { evaluateUiverseRuntimeEligibility } from './runtime-eligibility.js'

/**
 * Immutable component records consumed by the browser-only renderer. A model
 * may select an ID and bounded values, but it never supplies HTML, CSS, a DOM
 * selector, or executable code.
 */
export const UIVERSE_RUNTIME_REGISTRY_FORMAT_VERSION = 1 as const
/** Opaque executable-registry namespace; the original archive ID follows it unchanged. */
export const UIVERSE_RUNTIME_COMPONENT_PREFIX = 'uiverse:' as const

export type UiverseRuntimeAvailability = 'interactive' | 'static' | 'blocked'
export type UiverseRuntimeCapability = 'decoration' | 'content' | 'action' | 'field' | 'toggle' | 'status'
export type UiverseRuntimeTargetKind = 'text' | 'action' | 'value' | 'checked' | 'file' | 'placeholder' | 'image' | 'css-content' | 'attribute'
export type UiverseRuntimeMode = 'interactive' | 'read-only'
/** The only HTML attributes whose source text may be rebound by this runtime. */
export type UiverseRuntimeHtmlSemanticAttribute = 'title' | 'aria-label' | 'aria-description'

/** Immutable fixed-source constraints for a writable native control. */
export interface UiverseRuntimeFieldConstraint {
  readonly element: 'input' | 'textarea' | 'select'
  /** Source `type` for inputs; unknown HTML types remain explicit. */
  readonly inputType?: string
  /** Actual option `.value` tokens, not option display markup. */
  readonly options?: readonly string[]
  /** Effective native bound/step strings when they constrain assignment. */
  readonly min?: string
  readonly max?: string
  readonly step?: string
}

export interface UiverseRuntimeTarget {
  readonly id: string
  readonly path: string
  readonly tag: string
  readonly kind: UiverseRuntimeTargetKind
  /** Index among direct source Text children, when kind is `text`. */
  readonly textIndex?: number
  /** Only a host-owned content target may be replaced by a native slot. */
  readonly semanticRole?: 'content' | 'label'
  /** Fixed sanitized stylesheet range for a semantic CSS content declaration. */
  readonly cssContent?: Readonly<{ css: string, start: number, end: number, expected: string }>
  /** Fixed source CSS selector/attribute pair for `content:attr(data-...)`. */
  readonly cssAttribute?: Readonly<{ selector: string, attribute: string }>
  /** Fixed source element/attribute pair for semantic HTML text. */
  readonly htmlAttribute?: Readonly<{ attribute: UiverseRuntimeHtmlSemanticAttribute }>
  /** Fixed native field constraint when kind is `value`. */
  readonly fieldConstraint?: Readonly<UiverseRuntimeFieldConstraint>
}

export interface UiverseRuntimeInputSchema {
  /** Semantic source data required for an explicitly read-only mount. */
  readonly requiredReadOnly: readonly string[]
  /** Adds host-owned action IDs required for an interactive mount. */
  readonly requiredInteractive: readonly string[]
  /** Stable source paths accepted in `text`; values never become markup. */
  readonly textIds: readonly string[]
  readonly fieldIds: readonly string[]
  /** Public fixed metadata for legal Host/model field values; no HTML/CSS. */
  readonly fieldConstraints?: Readonly<Record<string, UiverseRuntimeFieldConstraint>>
  readonly actionIds: readonly string[]
  readonly imageIds: readonly string[]
}

export interface UiverseRuntimeFieldValue { readonly value?: string, readonly checked?: boolean, readonly file?: boolean, readonly disabled?: boolean }
export interface UiverseRuntimeActionValue { readonly actionId: string, readonly disabled?: boolean }
export interface UiverseRuntimeImageValue { readonly src: string, readonly alt?: string }
/** Checked source-data projection; absence never falls back to author demo content. */
export interface UiverseRuntimeSelectionValues {
  readonly mode?: UiverseRuntimeMode
  readonly text?: Readonly<Record<string, string>>
  /** Trusted Host-owned Markdown/KaTeX/code projection, never model HTML. */
  readonly projectedTextIds?: readonly string[]
  readonly fields?: Readonly<Record<string, UiverseRuntimeFieldValue>>
  readonly actions?: Readonly<Record<string, UiverseRuntimeActionValue>>
  readonly images?: Readonly<Record<string, UiverseRuntimeImageValue>>
}
export interface UiverseRuntimeEligibility {
  readonly eligible: boolean
  readonly mode: UiverseRuntimeMode
  readonly missing: readonly string[]
  readonly reasons: readonly string[]
}

/**
 * Machine-readable observations from pinned source CSS/markup. They describe
 * declarations, not calculated pixels or a subjective aesthetic score.
 */
export interface UiverseRuntimeVisualCharacteristics {
  readonly basis: 'source-declared-css-and-markup'
  readonly rootTags: readonly string[]
  readonly elementCount: number
  readonly declared: Readonly<{
    shadows: boolean
    rounded: boolean
    borders: boolean
    gradients: boolean
    transparency: boolean
    blur: boolean
    transform3d: boolean
    motion: boolean
    keyframes: boolean
    pseudoElements: boolean
    layouts: readonly string[]
  }>
  /** First-seen fixed CSS color tokens, capped to keep Jev payloads bounded. */
  readonly colorTokens: readonly string[]
}

export interface UiverseRuntimeComponent {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly sourceSha256: string
  readonly source: string | undefined
  readonly sharedCss: string | undefined
  readonly availability: UiverseRuntimeAvailability
  /** It enters a Jev decision only after the required binding map is complete. */
  readonly selectableWhenBound: boolean
  readonly capabilities: readonly UiverseRuntimeCapability[]
  readonly visualCharacteristics: UiverseRuntimeVisualCharacteristics
  readonly inputSchema: UiverseRuntimeInputSchema
  readonly targets: readonly UiverseRuntimeTarget[]
  readonly blockers: readonly UiverseBindingBlockerCode[]
  readonly notes: readonly string[]
}

export interface UiverseRuntimeRegistry {
  readonly formatVersion: typeof UIVERSE_RUNTIME_REGISTRY_FORMAT_VERSION
  readonly archive: UiverseRuntimeBindingAudit['archive']
  readonly audit: UiverseRuntimeBindingAudit
  readonly components: readonly UiverseRuntimeComponent[]
  readonly summary: Readonly<Record<UiverseRuntimeAvailability, number>>
}

export interface UiverseRuntimeRegistrySources {
  readonly html: Readonly<Record<string, string>>
  readonly sharedCss?: string
  readonly css?: Readonly<Record<string, string>>
}

type AuditCatalog = Pick<Catalog, 'commit' | 'total' | 'categories' | 'items'>
type ParseNode = {
  readonly nodeName?: string
  readonly tagName?: string
  readonly value?: string
  readonly attrs?: readonly { readonly name: string; readonly value: string }[]
  readonly childNodes?: readonly ParseNode[]
}
type LocatedElement = { readonly path: string, readonly tag: string, readonly node: ParseNode }

const ignoredTextTags = new Set(['style', 'script', 'template', 'svg', 'path', 'defs', 'title', 'meta', 'link'])
const controls = new Set(['input', 'textarea', 'select'])
const rendererRemovedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link'])
const semanticHtmlAttributes = ['title', 'aria-label', 'aria-description'] as const satisfies readonly UiverseRuntimeHtmlSemanticAttribute[]

function tag(node: ParseNode): string { return (node.tagName ?? node.nodeName ?? '').toLowerCase() }
function children(node: ParseNode): ParseNode[] { return (node.childNodes ?? []).filter(child => !!child.tagName) as ParseNode[] }
function attr(node: ParseNode, name: string): string | undefined { return node.attrs?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value }
function normalizedText(value: string | undefined): string { return (value ?? '').replace(/\s+/gu, ' ').trim() }

function locateElements(root: ParseNode): LocatedElement[] {
  const output: LocatedElement[] = []
  const visit = (parent: ParseNode, parentPath: string): void => {
    const counts = new Map<string, number>()
    for (const child of children(parent)) {
      const childTag = tag(child), index = counts.get(childTag) ?? 0
      counts.set(childTag, index + 1)
      const path = `${parentPath}/${childTag}[${index}]`
      output.push({ path, tag: childTag, node: child })
      visit(child, path)
    }
  }
  visit(root, 'fragment')
  return output
}

function directText(node: ParseNode): string {
  return (node.childNodes ?? []).filter(child => child.nodeName === '#text' && typeof child.value === 'string').map(child => child.value).join('').replace(/\s+/gu, ' ').trim()
}

/**
 * A source text slot is usable only when it is unique and is not inside an
 * SVG/style/script subtree. This preserves the source tree rather than adding
 * a synthetic label beside it.
 */
function uniqueTextSlot(elements: readonly LocatedElement[]): LocatedElement | undefined {
  const candidates = elements.filter(element => !ignoredTextTags.has(element.tag) && !!directText(element.node))
  const leaves = candidates.filter(candidate => !candidates.some(other => other !== candidate && other.path.startsWith(candidate.path + '/')))
  return leaves.length === 1 ? leaves[0] : undefined
}

function trimmedAttribute(element: LocatedElement, name: string): string | undefined {
  const value = attr(element.node, name)?.trim()
  return value ? value : undefined
}

function selectOptionValues(element: LocatedElement): readonly string[] {
  const values: string[] = []
  const visit = (node: ParseNode): void => {
    for (const child of node.childNodes ?? []) {
      if (tag(child) === 'option') values.push(attr(child, 'value') ?? normalizedText(rawText(child)))
      visit(child)
    }
  }
  visit(element.node)
  return values
}

function fieldConstraintFor(element: LocatedElement, inputType: string): UiverseRuntimeFieldConstraint {
  if (element.tag === 'select') return { element: 'select', options: selectOptionValues(element) }
  if (element.tag === 'textarea') return { element: 'textarea' }
  const type = inputType || 'text'
  const min = trimmedAttribute(element, 'min'), max = trimmedAttribute(element, 'max'), step = trimmedAttribute(element, 'step')
  // Native ranges clamp to defaults when these attributes are absent. Record
  // their effective values so a caller can bind without relying on a demo
  // default or discovering the bounds by trial in the browser.
  if (type === 'range') return { element: 'input', inputType: type, min: min ?? '0', max: max ?? '100', step: step ?? '1' }
  return { element: 'input', inputType: type, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }) }
}

function interactiveTargets(elements: readonly LocatedElement[]): UiverseRuntimeTarget[] {
  const result: UiverseRuntimeTarget[] = []
  for (const element of elements) {
    const type = (attr(element.node, 'type') ?? '').toLowerCase()
    if (element.tag === 'button' || element.tag === 'a' && attr(element.node, 'role')?.toLowerCase() === 'button' || element.tag === 'input' && ['button', 'submit', 'reset'].includes(type)) {
      result.push({ id: element.path, path: element.path, tag: element.tag, kind: 'action' })
      continue
    }
    if (!controls.has(element.tag) || type === 'hidden') continue
    if (element.tag === 'input' && type === 'file') result.push({ id: element.path, path: element.path, tag: element.tag, kind: 'file' })
    else if (element.tag === 'input' && ['checkbox', 'radio'].includes(type)) result.push({ id: element.path, path: element.path, tag: element.tag, kind: 'checked' })
    else result.push({ id: element.path, path: element.path, tag: element.tag, kind: 'value', fieldConstraint: fieldConstraintFor(element, type) })
  }
  return result
}

function semanticTextHidden(element: LocatedElement): boolean {
  if (['style', 'script', 'template', 'path', 'defs', 'title', 'meta', 'link'].includes(element.tag) || element.node.attrs?.some(attribute => attribute.name.toLowerCase() === 'hidden' || attribute.name.toLowerCase() === 'aria-hidden' && attribute.value === 'true' || attribute.name.toLowerCase() === 'role' && attribute.value.toLowerCase() === 'presentation')) return true
  return element.path.split('/').some(segment => /^(?:style|script|template)\[/u.test(segment))
}

/** Mirrors the fixed renderer's tag-removal boundary before creating a path target. */
function removedByRenderer(element: LocatedElement): boolean {
  return element.path.split('/').some(segment => rendererRemovedTags.has(segment.slice(0, segment.indexOf('['))))
}

function semanticHtmlAttributeTargets(elements: readonly LocatedElement[]): UiverseRuntimeTarget[] {
  const targets: UiverseRuntimeTarget[] = []
  for (const element of elements) {
    if (removedByRenderer(element)) continue
    for (const attribute of semanticHtmlAttributes) {
      if (!attr(element.node, attribute)?.trim()) continue
      targets.push({
        id: `${element.path}@html-attribute[${attribute}]`, path: element.path, tag: element.tag, kind: 'attribute',
        htmlAttribute: { attribute },
      })
    }
  }
  return targets
}

/**
 * List every direct visible text node, not just a convenient single card title.
 * Each path becomes a required binding so original author examples cannot leak
 * into a conversation as product names, prices, notifications, or progress.
 */
function allSemanticTextTargets(root: ParseNode, elements: readonly LocatedElement[]): UiverseRuntimeTarget[] {
  const byPath = new Map(elements.map(element => [element.path, element]))
  const roleForTextPath = (path: string): 'content' | 'label' => {
    let current = path
    while (current !== 'fragment') {
      const element = byPath.get(current)
      if (element && ['button', 'a', 'label', 'option', 'summary'].includes(element.tag)) return 'label'
      current = current.slice(0, current.lastIndexOf('/')) || 'fragment'
    }
    return 'content'
  }
  const targets: UiverseRuntimeTarget[] = []
  const visit = (parent: ParseNode, path: string, hidden: boolean, inSvg: boolean, svgText: boolean): void => {
    let textIndex = 0, elementIndex = 0
    const elementChildren = children(parent)
    for (const child of parent.childNodes ?? []) {
      if (child.nodeName === '#text') {
        const index = textIndex++
        if (!hidden && (!inSvg || svgText) && normalizedText(child.value)) targets.push({ id: `${path}#text[${index}]`, path, tag: tag(parent) || 'fragment', kind: 'text', textIndex: index, semanticRole: roleForTextPath(path) })
        continue
      }
      if (!child.tagName) continue
      const childTag = tag(child), prior = elementChildren.slice(0, elementIndex++).filter(item => tag(item) === childTag).length
      const childPath = `${path}/${childTag}[${prior}]`, element = byPath.get(childPath)
      const nextInSvg = inSvg || childTag === 'svg'
      const nextSvgText = nextInSvg && (svgText || childTag === 'text' || childTag === 'tspan')
      visit(child, childPath, hidden || !!element && semanticTextHidden(element), nextInSvg, nextSvgText)
    }
  }
  visit(root, 'fragment', false, false, false)
  return targets
}

function allRuntimeTargets(source: string): UiverseRuntimeTarget[] {
  const parsed = parseFragment(source) as unknown as ParseNode
  const elements = locateElements(parsed)
  const targets = allSemanticTextTargets(parsed, elements)
  for (const target of interactiveTargets(elements)) targets.push(target)
  for (const target of semanticHtmlAttributeTargets(elements)) targets.push(target)
  for (const element of elements) {
    if (semanticTextHidden(element)) continue
    if (element.tag === 'input' || element.tag === 'textarea') {
      if (attr(element.node, 'placeholder')?.trim()) targets.push({ id: `${element.path}@placeholder`, path: element.path, tag: element.tag, kind: 'placeholder' })
    }
    if (element.tag === 'img' && (attr(element.node, 'src')?.trim() || attr(element.node, 'alt')?.trim())) targets.push({ id: `${element.path}@image`, path: element.path, tag: element.tag, kind: 'image' })
  }
  for (const target of semanticCssTargets(elements)) targets.push(target)
  return targets
}

function semanticCssValue(value: string): boolean {
  const withoutFunctions = value.replaceAll(/(?:attr|counter|counters|url)\([^)]*\)/giu, '')
  return /[\p{L}\p{N}]/u.test(withoutFunctions)
}
function cssValueRange(css: string, declaration: { readonly value: string, readonly source?: { readonly start?: { readonly offset?: number }, readonly end?: { readonly offset?: number } } }): { readonly start: number, readonly end: number, readonly expected: string } | undefined {
  const start = declaration.source?.start?.offset, end = declaration.source?.end?.offset
  if (!Number.isInteger(start) || !Number.isInteger(end) || start! < 0 || end! <= start! || end! > css.length) return undefined
  const startOffset = start as number, endOffset = end as number
  const declarationText = css.slice(startOffset, endOffset), local = declarationText.indexOf(declaration.value)
  if (local < 0) return undefined
  return { start: startOffset + local, end: startOffset + local + declaration.value.length, expected: declaration.value }
}
function staticAttributeSelector(selector: string): string | undefined {
  const stripped = selector.replaceAll(/::[A-Za-z-]+(?:\([^)]*\))?/gu, '').trim()
  if (!stripped || /:[A-Za-z-]/u.test(stripped)) return undefined
  return stripped
}
/**
 * CSS `content` text is part of a component's visible source just like HTML
 * text. Use PostCSS only while building the fixed archive plan; the browser
 * receives fixed sanitized declaration ranges and never parses model CSS.
 */
function semanticCssTarget(style: LocatedElement, css: string, value: string, range: { readonly start: number, readonly end: number, readonly expected: string }, selector: string | undefined, index: number): UiverseRuntimeTarget | undefined {
  const normalized = value.trim()
  if (!normalized || ['none', 'normal', 'open-quote', 'close-quote', 'no-open-quote', 'no-close-quote'].includes(normalized.toLowerCase())) return undefined
  const exactAttribute = /^attr\(\s*([A-Za-z_][A-Za-z0-9_:-]*)\s*\)$/u.exec(normalized)
  const staticSelector = selector === undefined ? undefined : staticAttributeSelector(selector)
  if (exactAttribute && staticSelector) return { id: `${style.path}#css-attr[${String(index)}]`, path: style.path, tag: 'style', kind: 'attribute', cssAttribute: { selector: staticSelector, attribute: exactAttribute[1]! } }
  // A dynamic pseudo-selector cannot be safely queried at mount. Bind the
  // entire fixed declaration instead so its original data-* value cannot leak.
  if (!exactAttribute && !semanticCssValue(normalized)) return undefined
  return { id: `${style.path}#css-content[${String(index)}]`, path: style.path, tag: 'style', kind: 'css-content', cssContent: { css, ...range } }
}
function fallbackCssTargets(style: LocatedElement, css: string): UiverseRuntimeTarget[] {
  const output: UiverseRuntimeTarget[] = []
  const declaration = /(?:^|[;{\}])\s*content\s*:\s*([^;\}\n]+)(?=;|\}|$)/gimu
  let match: RegExpExecArray | null, index = 0
  while ((match = declaration.exec(css))) {
    const raw = match[1]!, value = raw.trim(), valueStart = match.index + match[0].lastIndexOf(raw) + raw.indexOf(value)
    const open = css.lastIndexOf('{', match.index), before = open < 0 ? '' : css.slice(Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', Math.max(0, open - 1))) + 1, open).trim()
    const target = semanticCssTarget(style, css, value, { start: valueStart, end: valueStart + value.length, expected: value }, before || undefined, index++)
    if (target) output.push(target)
  }
  return output
}
function semanticCssTargets(elements: readonly LocatedElement[]): UiverseRuntimeTarget[] {
  const output: UiverseRuntimeTarget[] = []
  for (const style of elements.filter(element => element.tag === 'style')) {
    const css = sanitizeUiverseCss(rawText(style.node))
    try {
      const root = postcss.parse(css)
      let index = 0
      root.walkDecls('content', declaration => {
        const range = cssValueRange(css, declaration)
        if (!range) throw new Error(`UIVERSE_RUNTIME_CSS_RANGE_UNRESOLVED:${style.path}`)
        const selector = declaration.parent?.type === 'rule' ? (declaration.parent as { selector?: string }).selector : undefined
        const target = semanticCssTarget(style, css, declaration.value, range, selector, index++)
        if (target) output.push(target)
      })
    } catch {
      // Community CSS occasionally has a malformed unrelated declaration. A
      // fixed, range-checked fallback still handles every visible content
      // declaration; if its range later diverges the renderer fails closed.
      output.push(...fallbackCssTargets(style, css))
    }
  }
  return output
}

function completeSourcePlan(item: CatalogItem, source: string): { capabilities: UiverseRuntimeCapability[], targets: UiverseRuntimeTarget[], inputSchema: UiverseRuntimeInputSchema, adaptationNotes: readonly string[] } {
  const targets = allRuntimeTargets(source)
  const capabilities = new Set<UiverseRuntimeCapability>(['decoration'])
  if (targets.some(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'image' || target.kind === 'css-content' || target.kind === 'attribute')) capabilities.add('content')
  if (targets.some(target => target.kind === 'action')) capabilities.add('action')
  if (targets.some(target => target.kind === 'value' || target.kind === 'file' || target.kind === 'placeholder')) capabilities.add('field')
  if (targets.some(target => target.kind === 'checked')) capabilities.add('toggle')
  if (item.category.toLocaleLowerCase('en-US') === 'loaders' && targets.some(target => target.kind === 'text')) capabilities.add('status')
  const textIds = targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map(target => target.id)
  const fieldIds = targets.filter(target => target.kind === 'value' || target.kind === 'checked' || target.kind === 'file').map(target => target.id)
  const fieldConstraints = Object.fromEntries(targets.filter(target => target.kind === 'value' && target.fieldConstraint !== undefined).map(target => [target.id, target.fieldConstraint!]))
  const actionIds = targets.filter(target => target.kind === 'action').map(target => target.id)
  const imageIds = targets.filter(target => target.kind === 'image').map(target => target.id)
  const cssContentCount = targets.filter(target => target.kind === 'css-content').length
  const cssAttributeCount = targets.filter(target => target.cssAttribute !== undefined).length
  const htmlAttributeCount = targets.filter(target => target.htmlAttribute !== undefined).length
  const svgTextCount = targets.filter(target => target.kind === 'text' && /\/svg\[/u.test(target.path)).length
  return {
    capabilities: [...capabilities].sort(), targets,
    inputSchema: {
      requiredReadOnly: [...textIds, ...fieldIds, ...imageIds],
      requiredInteractive: [...textIds, ...fieldIds, ...imageIds, ...actionIds],
      textIds, fieldIds, fieldConstraints, actionIds, imageIds,
    },
    adaptationNotes: [
      ...(cssContentCount ? [`css-content-rebound:${String(cssContentCount)}; fixed declaration text differs from source`] : []),
      ...(cssAttributeCount ? [`css-attribute-rebound:${String(cssAttributeCount)}; fixed attr() source attributes differ from source`] : []),
      ...(htmlAttributeCount ? [`html-semantic-attribute-rebound:${String(htmlAttributeCount)}; fixed title/aria source attributes differ from source`] : []),
      ...(svgTextCount ? [`svg-text-rebound:${String(svgTextCount)}; fixed SVG text differs from source`] : []),
    ],
  }
}

function rawText(node: ParseNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.childNodes ?? []).map(rawText).join('')
}
function sourceDeclaredVisualCharacteristics(source: string): UiverseRuntimeVisualCharacteristics {
  const parsed = parseFragment(source) as unknown as ParseNode
  const elements = locateElements(parsed)
  const css = elements.filter(element => element.tag === 'style').map(element => rawText(element.node)).join('\n') + '\n' + elements.flatMap(element => element.node.attrs?.filter(attribute => attribute.name.toLowerCase() === 'style').map(attribute => attribute.value) ?? []).join('\n')
  const executableCss = sanitizeUiverseCss(css).replaceAll(/\/\*[\s\S]*?\*\//gu, '')
  const colors: string[] = []
  for (const match of executableCss.matchAll(/(?:#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[A-Za-z0-9_-]+\))/giu)) {
    const token = match[0]!
    if (!colors.includes(token)) colors.push(token)
    if (colors.length === 16) break
  }
  const layoutPatterns: readonly (readonly [RegExp, string])[] = [
    [/display\s*:\s*(?:inline-)?flex\b/iu, 'flex'],
    [/display\s*:\s*(?:inline-)?grid\b/iu, 'grid'],
    [/position\s*:\s*(?:absolute|fixed|sticky)\b/iu, 'positioned'],
  ]
  const layouts = layoutPatterns.flatMap(([pattern, name]) => pattern.test(executableCss) ? [name] : [])
  const roots = elements.filter(element => element.path.split('/').length === 2).map(element => element.tag)
  return {
    basis: 'source-declared-css-and-markup', rootTags: [...new Set(roots)], elementCount: elements.length,
    declared: {
      shadows: /box-shadow\s*:/iu.test(executableCss),
      rounded: /border(?:-[A-Za-z-]+)?-radius\s*:/iu.test(executableCss),
      borders: /(?:^|[;{\s])(?:border(?!-radius)|outline)\s*:/imu.test(executableCss),
      gradients: /(?:linear|radial|conic)-gradient\s*\(/iu.test(executableCss),
      transparency: /(?:opacity\s*:\s*(?:0?\.\d+|0\b)|rgba\([^)]*\/\s*(?:0?\.\d+|0\b)|hsla\([^)]*\/\s*(?:0?\.\d+|0\b))/iu.test(executableCss),
      blur: /(?:blur\s*\(|backdrop-filter\s*:)/iu.test(executableCss),
      transform3d: /(?:perspective\s*:|translateZ\s*\(|rotate[XYZ]\s*\(|scale3d\s*\(|matrix3d\s*\(|transform-style\s*:\s*preserve-3d)/iu.test(executableCss),
      motion: /(?:animation|transition)\s*:/iu.test(executableCss),
      keyframes: /@keyframes\b/iu.test(executableCss),
      pseudoElements: /::(?:before|after)\b/iu.test(executableCss),
      layouts,
    },
    colorTokens: colors,
  }
}

function addTarget(output: UiverseRuntimeTarget[], target: UiverseRuntimeTarget | undefined): void {
  if (!target || output.some(item => item.id === target.id && item.kind === target.kind)) return
  output.push(target)
}

function targetFromAudit(id: string, kind: UiverseRuntimeTargetKind, entry: UiverseRuntimeBindingEntry, field: 'label' | 'content' | 'value' | 'checked' | 'action'): UiverseRuntimeTarget | undefined {
  const target = entry.targets[field]
  return target ? { id, path: target.path, tag: target.tag, kind } : undefined
}

function categoryCapabilities(item: CatalogItem, entry: UiverseRuntimeBindingEntry, source: string): { capabilities: UiverseRuntimeCapability[], targets: UiverseRuntimeTarget[], inputSchema: UiverseRuntimeInputSchema } {
  const category = item.category.toLocaleLowerCase('en-US')
  const parsed = parseFragment(source) as unknown as ParseNode
  const elements = locateElements(parsed)
  const controlsForSource = interactiveTargets(elements)
  const text = uniqueTextSlot(elements)
  const targets: UiverseRuntimeTarget[] = []
  const capabilities = new Set<UiverseRuntimeCapability>(['decoration'])

  if (category === 'buttons') {
    const actions = controlsForSource.filter(target => target.kind === 'action')
    for (const action of actions) addTarget(targets, action)
    addTarget(targets, targetFromAudit('label', 'text', entry, 'label'))
    if (actions.length) capabilities.add('action')
  } else if (category === 'inputs' || category === 'forms') {
    for (const target of controlsForSource.filter(target => target.kind === 'value' || target.kind === 'checked')) addTarget(targets, target)
    for (const target of controlsForSource.filter(target => target.kind === 'action')) addTarget(targets, target)
    addTarget(targets, targetFromAudit('label', 'text', entry, 'label'))
    if (targets.some(target => target.kind === 'value')) capabilities.add('field')
    if (targets.some(target => target.kind === 'checked')) capabilities.add('toggle')
    if (targets.some(target => target.kind === 'action')) capabilities.add('action')
  } else if (category === 'checkboxes' || category === 'radio-buttons' || category === 'toggle-switches') {
    for (const target of controlsForSource.filter(target => target.kind === 'checked')) addTarget(targets, target)
    addTarget(targets, targetFromAudit('label', 'text', entry, 'label'))
    if (targets.some(target => target.kind === 'checked')) capabilities.add('toggle')
  } else if (category === 'cards' || category === 'notifications' || category === 'tooltips') {
    if (text) {
      addTarget(targets, { id: 'content', path: text.path, tag: text.tag, kind: 'text' })
      capabilities.add('content')
    }
  } else if (category === 'loaders') {
    if (text) {
      addTarget(targets, { id: 'label', path: text.path, tag: text.tag, kind: 'text' })
      capabilities.add('status')
    }
  }

  const fieldIds = targets.filter(target => target.kind === 'value' || target.kind === 'checked').map(target => target.id)
  const actionIds = targets.filter(target => target.kind === 'action').map(target => target.id)
  const textIds = targets.filter(target => target.kind === 'text').map(target => target.id)
  return { capabilities: [...capabilities].sort(), targets, inputSchema: {
    requiredReadOnly: [...textIds, ...fieldIds], requiredInteractive: [...textIds, ...fieldIds, ...actionIds],
    textIds, fieldIds, fieldConstraints: Object.fromEntries(targets.filter(target => target.kind === 'value' && target.fieldConstraint !== undefined).map(target => [target.id, target.fieldConstraint!])), actionIds, imageIds: [],
  } }
}

function sourceSafetyNotes(entry: UiverseRuntimeBindingEntry): readonly string[] {
  const notes: string[] = []
  if (entry.blockers.includes('script')) notes.push(`scripts-stripped:${String(entry.resources.scriptBlocks)}; dynamic author behavior is unavailable`)
  if (entry.blockers.includes('inline-handler')) notes.push(`inline-handlers-stripped:${String(entry.resources.inlineHandlers)}; host action mapping is required`)
  if (entry.blockers.includes('external-resource')) notes.push(`external-resources-stripped:${String(entry.resources.externalReferences.length)}; visual fidelity may differ`)
  if (entry.blockers.includes('source-hash-mismatch')) notes.push('source-hash-mismatch')
  return notes
}

function availability(entry: UiverseRuntimeBindingEntry, source: string | undefined, capabilities: readonly UiverseRuntimeCapability[]): UiverseRuntimeAvailability {
  if (!source || entry.blockers.includes('source-hash-mismatch')) return 'blocked'
  const sourceNeedsStripping = entry.blockers.some(blocker => blocker === 'script' || blocker === 'inline-handler' || blocker === 'external-resource')
  return !sourceNeedsStripping && capabilities.some(capability => capability !== 'decoration') ? 'interactive' : 'static'
}

/**
 * Builds all 3,802 addressable runtime contracts from the pinned archive.
 * Uncertain controls remain static candidates with named limitations; they are
 * not silently dropped and are never presented as fully interactive.
 */
export function createUiverseRuntimeRegistry(catalog: AuditCatalog, sources: UiverseRuntimeRegistrySources): UiverseRuntimeRegistry {
  const audit = auditUiverseRuntimeBindings(catalog, sources)
  const auditById = new Map(audit.entries.map(entry => [entry.id, entry]))
  const components: UiverseRuntimeComponent[] = catalog.items.map(item => {
    const source = sources.html[item.id]
    const auditEntry = auditById.get(item.id)
    if (!auditEntry || source === undefined) {
      return {
        id: item.id, title: item.title, category: item.category, sourceSha256: item.sha256, source: undefined, sharedCss: undefined,
        availability: 'blocked' as const, selectableWhenBound: false, capabilities: [] as const,
        inputSchema: { requiredReadOnly: [], requiredInteractive: [], textIds: [], fieldIds: [], fieldConstraints: {}, actionIds: [], imageIds: [] }, targets: [] as const,
        visualCharacteristics: { basis: 'source-declared-css-and-markup' as const, rootTags: [], elementCount: 0, declared: { shadows: false, rounded: false, borders: false, gradients: false, transparency: false, blur: false, transform3d: false, motion: false, keyframes: false, pseudoElements: false, layouts: [] }, colorTokens: [] },
        blockers: auditEntry?.blockers ?? ['source-missing' as const], notes: ['source-unavailable'],
      }
    }
    const plan = completeSourcePlan(item, source)
    const state = availability(auditEntry, source, plan.capabilities)
    const notes = [...sourceSafetyNotes(auditEntry), ...plan.adaptationNotes, ...(item.framework !== 'css' && audit.sharedCssExternalReferences.length ? [`shared-utility-external-resources-stripped:${String(audit.sharedCssExternalReferences.length)}; visual fidelity may differ`] : [])]
    return {
      id: item.id,
      title: item.title,
      category: item.category,
      sourceSha256: item.sha256,
      source,
      sharedCss: sources.sharedCss,
      availability: state,
      selectableWhenBound: state !== 'blocked',
      capabilities: plan.capabilities,
      visualCharacteristics: sourceDeclaredVisualCharacteristics(source),
      inputSchema: plan.inputSchema,
      targets: plan.targets,
      blockers: auditEntry.blockers,
      notes,
    }
  })
  const summary = {
    interactive: components.filter(component => component.availability === 'interactive').length,
    static: components.filter(component => component.availability === 'static').length,
    blocked: components.filter(component => component.availability === 'blocked').length,
  } as const
  return { formatVersion: UIVERSE_RUNTIME_REGISTRY_FORMAT_VERSION, archive: audit.archive, audit, components, summary }
}

export function getUiverseRuntimeComponent(registry: UiverseRuntimeRegistry, id: string): UiverseRuntimeComponent {
  if (typeof id !== 'string' || id.length < 1 || id.length > 400) throw new Error('UIVERSE_RUNTIME_COMPONENT_ID_INVALID')
  const component = registry.components.find(candidate => candidate.id === id)
  if (!component) throw new Error('UIVERSE_RUNTIME_COMPONENT_UNKNOWN')
  return component
}

export function uiverseRuntimeQualifiedId(componentId: string): string {
  if (typeof componentId !== 'string' || componentId.length < 1 || componentId.length > 400) throw new Error('UIVERSE_RUNTIME_COMPONENT_ID_INVALID')
  return `${UIVERSE_RUNTIME_COMPONENT_PREFIX}${componentId}`
}

export function originalUiverseRuntimeComponentId(qualifiedId: string): string {
  if (typeof qualifiedId !== 'string' || !qualifiedId.startsWith(UIVERSE_RUNTIME_COMPONENT_PREFIX)) throw new Error('UIVERSE_RUNTIME_COMPONENT_QUALIFIED_ID_INVALID')
  const id = qualifiedId.slice(UIVERSE_RUNTIME_COMPONENT_PREFIX.length)
  if (!id || id.length > 400) throw new Error('UIVERSE_RUNTIME_COMPONENT_QUALIFIED_ID_INVALID')
  return id
}

export interface UiverseRuntimeCandidate extends Pick<UiverseRuntimeComponent, 'id' | 'title' | 'category' | 'availability' | 'capabilities' | 'visualCharacteristics' | 'inputSchema' | 'notes' | 'selectableWhenBound'> {
  readonly qualifiedId: string
  readonly eligibility: UiverseRuntimeEligibility
}

/** Compact data supplied to Jev candidate generation; raw source stays local. */
export function listUiverseRuntimeCandidates(registry: UiverseRuntimeRegistry, capability?: UiverseRuntimeCapability, valuesById: Readonly<Record<string, UiverseRuntimeSelectionValues>> = {}): readonly UiverseRuntimeCandidate[] {
  return registry.components.filter(component => component.selectableWhenBound && (capability === undefined || component.capabilities.includes(capability))).map(component => ({
    id: component.id, qualifiedId: uiverseRuntimeQualifiedId(component.id), title: component.title, category: component.category, availability: component.availability,
    capabilities: component.capabilities, visualCharacteristics: component.visualCharacteristics, inputSchema: component.inputSchema, notes: component.notes, selectableWhenBound: component.selectableWhenBound,
    eligibility: evaluateUiverseRuntimeEligibility(component, valuesById[component.id] ?? {}),
  }))
}
