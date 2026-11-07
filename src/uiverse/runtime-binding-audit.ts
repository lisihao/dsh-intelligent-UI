import { createHash } from 'node:crypto'
import { parseFragment } from 'parse5'
import type { Catalog, CatalogItem } from './catalog.js'

export const UIVERSE_RUNTIME_BINDING_AUDIT_FORMAT_VERSION = 1 as const

export type UiverseRuntimeRole = 'button' | 'input' | 'toggle' | 'card' | 'loader' | 'unmapped'
export type UiverseBindingStatus = 'bound' | 'ambiguous' | 'blocked' | 'missing-source'
export type UiverseBindingField = 'label' | 'content' | 'value' | 'checked' | 'action'

export type UiverseBindingBlockerCode =
  | 'source-missing'
  | 'source-hash-mismatch'
  | 'source-parse-failed'
  | 'unsupported-role'
  | 'multiple-roots'
  | 'no-content-slot'
  | 'missing-label'
  | 'ambiguous-label'
  | 'missing-action-slot'
  | 'ambiguous-action'
  | 'missing-value-slot'
  | 'ambiguous-value'
  | 'missing-checked-slot'
  | 'ambiguous-checked'
  | 'script'
  | 'inline-handler'
  | 'external-resource'

export interface UiverseBindingTarget {
  readonly path: string
  readonly tag: string
  readonly attribute?: string
  readonly text?: string
}

export interface UiverseBindingResources {
  readonly inlineStyleBlocks: number
  readonly scriptBlocks: number
  readonly inlineHandlers: number
  readonly externalReferences: readonly string[]
}

export interface UiverseRuntimeBindingEntry {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly role: UiverseRuntimeRole
  readonly status: UiverseBindingStatus
  readonly sourceSha256?: string
  readonly targets: Readonly<Partial<Record<UiverseBindingField, UiverseBindingTarget>>>
  readonly blockers: readonly UiverseBindingBlockerCode[]
  readonly resources: UiverseBindingResources
}

export interface UiverseRuntimeBindingSources {
  readonly html: Readonly<Record<string, string>>
  /** Optional per-component CSS records. */
  readonly css?: Readonly<Record<string, string>>
  /** Optional shared CSS, such as the pinned Tailwind archive. */
  readonly sharedCss?: string
}

export interface UiverseRuntimeBindingAudit {
  readonly formatVersion: typeof UIVERSE_RUNTIME_BINDING_AUDIT_FORMAT_VERSION
  readonly archive: { readonly commit: string; readonly declaredTotal: number; readonly categoryCount: number }
  readonly coverage: {
    readonly catalogItemCount: number
    readonly sourceRecordCount: number
    readonly auditedCount: number
    readonly missingIds: readonly string[]
    readonly extraSourceIds: readonly string[]
    readonly duplicateCatalogIds: readonly string[]
    readonly allIdsRepresented: boolean
  }
  readonly summary: Readonly<Record<UiverseBindingStatus, number>>
  /**
   * References found in the shared utility sheet. They are reported once so a
   * single unrelated utility declaration cannot make every archive item look
   * network-dependent. The runtime strips them before mounting the sheet.
   */
  readonly sharedCssExternalReferences: readonly string[]
  readonly entries: readonly UiverseRuntimeBindingEntry[]
  /** True only when every catalog item has a source and a complete binding. */
  readonly allComplete: boolean
}

type AuditNode = {
  readonly nodeName?: string
  readonly tagName?: string
  readonly value?: string
  readonly attrs?: readonly { readonly name: string; readonly value: string }[]
  readonly childNodes?: readonly AuditNode[]
}

type LocatedElement = { readonly node: AuditNode; readonly path: string; readonly tag: string }

const categoryRoles: Readonly<Record<string, UiverseRuntimeRole>> = {
  buttons: 'button',
  cards: 'card',
  forms: 'input',
  inputs: 'input',
  checkboxes: 'toggle',
  'radio-buttons': 'toggle',
  'toggle-switches': 'toggle',
  loaders: 'loader',
}
const controlTags = new Set(['input', 'textarea', 'select'])
const ignoredContentTags = new Set(['style', 'script', 'link', 'meta', 'title'])

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function attr(node: AuditNode, name: string): string | undefined { return node.attrs?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value }
function tag(node: AuditNode): string { return (node.tagName ?? node.nodeName ?? '').toLowerCase() }
function elementChildren(node: AuditNode): AuditNode[] { return (node.childNodes ?? []).filter(child => !!child.tagName) as AuditNode[] }

function textContent(node: AuditNode): string {
  if (ignoredContentTags.has(tag(node))) return ''
  if (typeof node.value === 'string') return node.value
  return (node.childNodes ?? []).map(textContent).join('')
}

function rawTextContent(node: AuditNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.childNodes ?? []).map(rawTextContent).join('')
}

function locateElements(root: AuditNode): LocatedElement[] {
  const output: LocatedElement[] = []
  const visit = (parent: AuditNode, parentPath: string): void => {
    const counts = new Map<string, number>()
    for (const child of elementChildren(parent)) {
      const childTag = tag(child), index = counts.get(childTag) ?? 0
      counts.set(childTag, index + 1)
      const path = `${parentPath}/${childTag}[${index}]`
      output.push({ node: child, path, tag: childTag })
      visit(child, path)
    }
  }
  visit(root, 'fragment')
  return output
}

function target(element: LocatedElement, attribute?: string, text?: string): UiverseBindingTarget {
  return { path: element.path, tag: element.tag, ...(attribute === undefined ? {} : { attribute }), ...(text === undefined ? {} : { text }) }
}

function uniqueTargets(values: readonly UiverseBindingTarget[]): UiverseBindingTarget[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = `${value.path}\u0000${value.attribute ?? ''}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

function cssExternalReferences(css: string): string[] {
  const references: string[] = []
  // Source attribution comments routinely contain the author page URL. They
  // never load a network resource, so scan only executable CSS after comments
  // are removed. Keep actual @import/url() references visible.
  const executableCss = css.replaceAll(/\/\*[\s\S]*?\*\//gu, '')
  const patterns = [
    /@import\s+(?:url\(\s*)?["']?((?:https?:|\/\/)[^\s"');]+)/giu,
    /url\(\s*["']?((?:https?:|\/\/)[^\s"')]+)/giu,
  ]
  for (const pattern of patterns) for (const match of executableCss.matchAll(pattern)) {
    const reference = match[1]?.trim()
    if (reference) references.push(reference.slice(0, 180))
  }
  return [...new Set(references)]
}

function scanResources(elements: readonly LocatedElement[], css: string): { resources: UiverseBindingResources; blockers: UiverseBindingBlockerCode[] } {
  let scriptBlocks = 0, inlineStyleBlocks = 0, inlineHandlers = 0
  const externalReferences: string[] = []
  const blockers = new Set<UiverseBindingBlockerCode>()
  const addExternal = (value: string | undefined): void => {
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:')) return
    if (/^(?:https?:)?\/\//iu.test(value)) { externalReferences.push(value.slice(0, 180)); blockers.add('external-resource') }
  }
  for (const located of elements) {
    const node = located.node
    if (located.tag === 'script') { scriptBlocks++; blockers.add('script') }
    if (located.tag === 'style') {
      inlineStyleBlocks++
      for (const reference of cssExternalReferences(rawTextContent(node))) { externalReferences.push(reference); blockers.add('external-resource') }
    }
    for (const item of node.attrs ?? []) {
      if (/^on/iu.test(item.name)) { inlineHandlers++; blockers.add('inline-handler') }
      if (['src', 'href', 'action', 'formaction', 'poster'].includes(item.name.toLowerCase())) addExternal(item.value)
      if (item.name.toLowerCase() === 'style') for (const reference of cssExternalReferences(item.value)) { externalReferences.push(reference); blockers.add('external-resource') }
    }
  }
  for (const reference of cssExternalReferences(css)) { externalReferences.push(reference); blockers.add('external-resource') }
  return {
    resources: { inlineStyleBlocks, scriptBlocks, inlineHandlers, externalReferences: [...new Set(externalReferences)] },
    blockers: [...blockers],
  }
}

function roleFor(category: string): UiverseRuntimeRole {
  return categoryRoles[category.trim().toLocaleLowerCase('en-US')] ?? 'unmapped'
}

function labelTargets(elements: readonly LocatedElement[], controls: readonly LocatedElement[], actionControls: readonly LocatedElement[]): UiverseBindingTarget[] {
  const values: UiverseBindingTarget[] = []
  for (const control of [...controls, ...actionControls]) {
    const aria = attr(control.node, 'aria-label')
    const title = attr(control.node, 'title')
    if (aria?.trim()) values.push(target(control, 'aria-label', aria.trim()))
    else if (title?.trim()) values.push(target(control, 'title', title.trim()))
    else if (control.tag === 'button' || control.tag === 'a') {
      const text = textContent(control.node).replace(/\s+/gu, ' ').trim()
      if (text) values.push(target(control, undefined, text))
    }
  }
  for (const label of elements.filter(item => item.tag === 'label')) {
    const text = textContent(label.node).replace(/\s+/gu, ' ').trim()
    if (!text) continue
    const forId = attr(label.node, 'for')
    if (!forId || controls.some(control => attr(control.node, 'id') === forId)) values.push(target(label, forId ? 'for' : undefined, text))
  }
  return uniqueTargets(values)
}

function headingLabelTargets(elements: readonly LocatedElement[]): UiverseBindingTarget[] {
  return uniqueTargets(elements.filter(item => /^h[1-6]$/u.test(item.tag)).flatMap(item => {
    const text = textContent(item.node).replace(/\s+/gu, ' ').trim()
    return text ? [target(item, undefined, text)] : []
  }))
}

function bindingEntry(item: CatalogItem, source: string, css: string | undefined): UiverseRuntimeBindingEntry {
  const blockers = new Set<UiverseBindingBlockerCode>()
  const role = roleFor(item.category)
  const targets: Partial<Record<UiverseBindingField, UiverseBindingTarget>> = {}
  let root: AuditNode
  try {
    root = parseFragment(source) as unknown as AuditNode
  } catch {
    return { id: item.id, title: item.title, category: item.category, role, status: 'blocked', sourceSha256: sha256(source), targets, blockers: ['source-parse-failed'], resources: { inlineStyleBlocks: 0, scriptBlocks: 0, inlineHandlers: 0, externalReferences: [] } }
  }
  const elements = locateElements(root)
  const { resources, blockers: resourceBlockers } = scanResources(elements, css ?? '')
  for (const blocker of resourceBlockers) blockers.add(blocker)
  if (sha256(source) !== item.sha256) blockers.add('source-hash-mismatch')
  // Use the same per-tag path scheme as `locateElements`; a leading `<style>`
  // must not shift the target path for the actual content root.
  const visibleRoots = elements.filter(item => item.path.split('/').length === 2 && !ignoredContentTags.has(item.tag))
  if (visibleRoots.length === 1) targets.content = target(visibleRoots[0]!)
  else if (visibleRoots.length === 0) blockers.add('no-content-slot')
  else blockers.add('multiple-roots')

  if (role === 'unmapped') blockers.add('unsupported-role')
  else {
    const controls = elements.filter(item => controlTags.has(item.tag) && attr(item.node, 'type')?.toLowerCase() !== 'hidden')
    const actions = elements.filter(item => item.tag === 'button' || item.tag === 'a' && attr(item.node, 'role') === 'button' || item.tag === 'input' && ['button', 'submit', 'reset'].includes((attr(item.node, 'type') ?? '').toLowerCase()))
    const labels = labelTargets(elements, controls, actions)
    const cardLabels = labelTargets(elements, [], [])
    const headingLabels = headingLabelTargets(elements)
    if (role === 'button') {
      if (actions.length === 1) targets.action = target(actions[0]!)
      else blockers.add(actions.length ? 'ambiguous-action' : 'missing-action-slot')
      if (labels.length === 1) targets.label = labels[0]
      else blockers.add(labels.length ? 'ambiguous-label' : 'missing-label')
    } else if (role === 'input') {
      if (controls.length === 1) targets.value = target(controls[0]!, controls[0]!.tag === 'input' ? 'value' : undefined)
      else blockers.add(controls.length ? 'ambiguous-value' : 'missing-value-slot')
      if (labels.length === 1) targets.label = labels[0]
      else blockers.add(labels.length ? 'ambiguous-label' : 'missing-label')
    } else if (role === 'toggle') {
      const checks = elements.filter(item => item.tag === 'input' && ['checkbox', 'radio'].includes((attr(item.node, 'type') ?? '').toLowerCase()) || ['switch', 'checkbox', 'radio'].includes(attr(item.node, 'role')?.toLowerCase() ?? ''))
      const toggleLabels = labelTargets(elements, controls, [...actions, ...checks])
      if (checks.length === 1) targets.checked = target(checks[0]!, attr(checks[0]!.node, 'role') ? 'aria-checked' : 'checked')
      else blockers.add(checks.length ? 'ambiguous-checked' : 'missing-checked-slot')
      if (toggleLabels.length === 1) targets.label = toggleLabels[0]
      else blockers.add(toggleLabels.length ? 'ambiguous-label' : 'missing-label')
    } else if (role === 'card') {
      if (cardLabels.length === 1) targets.label = cardLabels[0]
      else if (!cardLabels.length && headingLabels.length === 1) targets.label = headingLabels[0]
      else if (cardLabels.length > 1 || headingLabels.length > 1) blockers.add('ambiguous-label')
    }
  }
  const orderedBlockers = [...blockers].sort()
  const ambiguous = orderedBlockers.some(code => code === 'multiple-roots' || code.startsWith('ambiguous-'))
  const status: UiverseBindingStatus = orderedBlockers.length === 0 ? 'bound' : ambiguous ? 'ambiguous' : 'blocked'
  return { id: item.id, title: item.title, category: item.category, role, status, sourceSha256: sha256(source), targets, blockers: orderedBlockers, resources }
}

export function auditUiverseRuntimeBindings(catalog: Pick<Catalog, 'commit' | 'total' | 'categories' | 'items'>, sources: UiverseRuntimeBindingSources): UiverseRuntimeBindingAudit {
  const entries: UiverseRuntimeBindingEntry[] = []
  const seen = new Set<string>(), duplicateCatalogIds: string[] = [], missingIds: string[] = []
  for (const item of catalog.items) {
    if (seen.has(item.id)) duplicateCatalogIds.push(item.id)
    seen.add(item.id)
    const source = sources.html[item.id]
    if (typeof source !== 'string') {
      missingIds.push(item.id)
      entries.push({ id: item.id, title: item.title, category: item.category, role: roleFor(item.category), status: 'missing-source', targets: {}, blockers: ['source-missing'], resources: { inlineStyleBlocks: 0, scriptBlocks: 0, inlineHandlers: 0, externalReferences: [] } })
    // Shared utility CSS belongs to the renderer rather than an individual
    // source record. Its external URLs are reported separately and stripped
    // at mount time; otherwise one unused declaration would block all 3,802
    // components.
    } else entries.push(bindingEntry(item, source, sources.css?.[item.id]))
  }
  const extraSourceIds = Object.keys(sources.html).filter(id => !seen.has(id)).sort()
  const summary = {
    bound: entries.filter(entry => entry.status === 'bound').length,
    ambiguous: entries.filter(entry => entry.status === 'ambiguous').length,
    blocked: entries.filter(entry => entry.status === 'blocked').length,
    'missing-source': entries.filter(entry => entry.status === 'missing-source').length,
  } as const
  const allIdsRepresented = entries.length === catalog.items.length && duplicateCatalogIds.length === 0 && missingIds.length === 0
  return {
    formatVersion: UIVERSE_RUNTIME_BINDING_AUDIT_FORMAT_VERSION,
    archive: { commit: catalog.commit, declaredTotal: catalog.total, categoryCount: Object.keys(catalog.categories).length },
    coverage: { catalogItemCount: catalog.items.length, sourceRecordCount: Object.keys(sources.html).length, auditedCount: entries.length, missingIds, extraSourceIds, duplicateCatalogIds, allIdsRepresented },
    summary,
    sharedCssExternalReferences: cssExternalReferences(sources.sharedCss ?? ''),
    entries,
    allComplete: allIdsRepresented && extraSourceIds.length === 0 && summary.bound === entries.length,
  }
}
