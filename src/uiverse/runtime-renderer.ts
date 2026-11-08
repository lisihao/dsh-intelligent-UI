import { evaluateUiverseRuntimeEligibility } from './runtime-eligibility.js'
import { reflectsUiverseRuntimeFieldValue } from './runtime-field-constraints.js'
import { sanitizeUiverseCss } from './runtime-sanitize.js'
import type {
  UiverseRuntimeActionValue,
  UiverseRuntimeComponent,
  UiverseRuntimeFieldValue,
  UiverseRuntimeImageValue,
  UiverseRuntimeMode,
  UiverseRuntimeSelectionValues,
  UiverseRuntimeTarget,
} from './runtime-registry.js'

export const UIVERSE_RUNTIME_MAX_TEXT_LENGTH = 16 * 1024
/** Complex source cards/forms may expose many visible semantic slots. */
export const UIVERSE_RUNTIME_MAX_BINDINGS = 2048

export type UiverseRuntimeEvent =
  | { readonly kind: 'action', readonly componentId: string, readonly targetId: string, readonly actionId: string }
  | { readonly kind: 'field', readonly componentId: string, readonly targetId: string, readonly fieldId: string, readonly value: string }
  | { readonly kind: 'toggle', readonly componentId: string, readonly targetId: string, readonly fieldId: string, readonly checked: boolean }
  | { readonly kind: 'file', readonly componentId: string, readonly targetId: string, readonly fieldId: string, readonly names: readonly string[] }

/** Bounded source-data projection supplied by the host, never model HTML. */
export type UiverseRuntimeValues = UiverseRuntimeSelectionValues

export interface UiverseRuntimeMountOptions {
  readonly component: UiverseRuntimeComponent
  readonly host: HTMLElement
  readonly values?: UiverseRuntimeValues
  /**
   * Replaces one audited content Text node with a native named slot. The Host
   * may then render its already-sanitized Markdown/KaTeX/code DOM as a light
   * DOM child; this runtime never accepts HTML for that projection.
   */
  readonly contentProjection?: { readonly targetId: string, readonly slotName?: string }
  readonly onEvent?: (event: UiverseRuntimeEvent) => void
}

export interface UiverseRuntimeInstance {
  readonly shadowRoot: ShadowRoot
  readonly contentSlotName?: string
  readonly contentProjectionTargetId?: string
  update(values: UiverseRuntimeValues): void
  dispose(): void
}

const forbiddenTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link'])
const urlAttributes = new Set(['src', 'href', 'xlink:href', 'poster', 'action', 'formaction'])
const directActionTypes = new Set(['button', 'submit', 'reset'])
const htmlSemanticAttributes = new Set(['title', 'aria-label', 'aria-description'])
let nextProjectionSlot = 1

function fault(code: string): never { throw new Error(`UIVERSE_RUNTIME_${code}`) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function boundedString(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.length > UIVERSE_RUNTIME_MAX_TEXT_LENGTH) fault(`INPUT_INVALID:${field}`)
  return value
}
function boundedId(value: unknown, field: string): string {
  const text = boundedString(value, field, true)!
  if (!/^[A-Za-z0-9_.:/-]{1,300}$/u.test(text)) fault(`INPUT_INVALID:${field}`)
  return text
}
function normalizeText(value: unknown, allowed: ReadonlySet<string>): ReadonlyMap<string, string> {
  if (value === undefined) return new Map()
  if (!isRecord(value) || Object.keys(value).length > UIVERSE_RUNTIME_MAX_BINDINGS) fault('INPUT_INVALID:text')
  const result = new Map<string, string>()
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id)) fault('INPUT_INVALID:text-target')
    result.set(id, boundedString(raw, `text.${id}`, true)!)
  }
  return result
}
function normalizeFields(value: unknown, allowed: ReadonlySet<string>): ReadonlyMap<string, UiverseRuntimeFieldValue> {
  if (value === undefined) return new Map()
  if (!isRecord(value) || Object.keys(value).length > UIVERSE_RUNTIME_MAX_BINDINGS) fault('INPUT_INVALID:fields')
  const result = new Map<string, UiverseRuntimeFieldValue>()
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id) || !isRecord(raw)) fault('INPUT_INVALID:field-target')
    const next: { value?: string, checked?: boolean, file?: boolean, disabled?: boolean } = {}
    const text = boundedString(raw.value, `fields.${id}.value`)
    if (text !== undefined) next.value = text
    if (raw.checked !== undefined) {
      if (typeof raw.checked !== 'boolean') fault(`INPUT_INVALID:fields.${id}.checked`)
      next.checked = raw.checked
    }
    if (raw.file !== undefined) {
      if (typeof raw.file !== 'boolean') fault(`INPUT_INVALID:fields.${id}.file`)
      next.file = raw.file
    }
    if (raw.disabled !== undefined) {
      if (typeof raw.disabled !== 'boolean') fault(`INPUT_INVALID:fields.${id}.disabled`)
      next.disabled = raw.disabled
    }
    result.set(id, next)
  }
  return result
}
function normalizeActions(value: unknown, allowed: ReadonlySet<string>): ReadonlyMap<string, UiverseRuntimeActionValue> {
  if (value === undefined) return new Map()
  if (!isRecord(value) || Object.keys(value).length > UIVERSE_RUNTIME_MAX_BINDINGS) fault('INPUT_INVALID:actions')
  const result = new Map<string, UiverseRuntimeActionValue>()
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id) || !isRecord(raw)) fault('INPUT_INVALID:action-target')
    const actionId = boundedId(raw.actionId, `actions.${id}.actionId`)
    if (raw.disabled !== undefined && typeof raw.disabled !== 'boolean') fault(`INPUT_INVALID:actions.${id}.disabled`)
    result.set(id, { actionId, ...(raw.disabled === undefined ? {} : { disabled: raw.disabled }) })
  }
  return result
}
function normalizeImages(value: unknown, allowed: ReadonlySet<string>): ReadonlyMap<string, UiverseRuntimeImageValue> {
  if (value === undefined) return new Map()
  if (!isRecord(value) || Object.keys(value).length > UIVERSE_RUNTIME_MAX_BINDINGS) fault('INPUT_INVALID:images')
  const result = new Map<string, UiverseRuntimeImageValue>()
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id) || !isRecord(raw)) fault('INPUT_INVALID:image-target')
    const src = boundedString(raw.src, `images.${id}.src`, true)!
    if (src.length > 512 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(src)) fault(`INPUT_INVALID:images.${id}.src`)
    const alt = boundedString(raw.alt, `images.${id}.alt`)
    result.set(id, { src, ...(alt === undefined ? {} : { alt }) })
  }
  return result
}
function normalizeProjectedText(value: unknown, allowed: ReadonlySet<string>): ReadonlySet<string> {
  if (value === undefined) return new Set()
  if (!Array.isArray(value) || value.length > UIVERSE_RUNTIME_MAX_BINDINGS || value.some(item => typeof item !== 'string' || !allowed.has(item))) fault('INPUT_INVALID:projected-text')
  return new Set(value)
}

type NormalizedValues = {
  readonly mode: UiverseRuntimeMode
  readonly text: ReadonlyMap<string, string>
  readonly projectedTextIds: ReadonlySet<string>
  readonly fields: ReadonlyMap<string, UiverseRuntimeFieldValue>
  readonly actions: ReadonlyMap<string, UiverseRuntimeActionValue>
  readonly images: ReadonlyMap<string, UiverseRuntimeImageValue>
}

function normalizeValues(values: UiverseRuntimeValues, component: UiverseRuntimeComponent): NormalizedValues {
  if (!isRecord(values as unknown)) fault('INPUT_INVALID:root')
  const mode: UiverseRuntimeMode = values.mode ?? (component.inputSchema.actionIds.length ? 'interactive' : 'read-only')
  if (mode !== 'interactive' && mode !== 'read-only') fault('INPUT_INVALID:mode')
  const allowedText = new Set(component.targets.filter(target => target.kind === 'text' || target.kind === 'placeholder' || target.kind === 'css-content' || target.kind === 'attribute').map(target => target.id))
  const allowedProjectedText = new Set(component.targets.filter(target => target.kind === 'text' && target.semanticRole === 'content').map(target => target.id))
  const allowedFields = new Set(component.targets.filter(target => target.kind === 'value' || target.kind === 'checked' || target.kind === 'file').map(target => target.id))
  const allowedActions = new Set(component.targets.filter(target => target.kind === 'action').map(target => target.id))
  const allowedImages = new Set(component.targets.filter(target => target.kind === 'image').map(target => target.id))
  const normalized = { mode, text: normalizeText(values.text, allowedText), projectedTextIds: normalizeProjectedText(values.projectedTextIds, allowedProjectedText), fields: normalizeFields(values.fields, allowedFields), actions: normalizeActions(values.actions, allowedActions), images: normalizeImages(values.images, allowedImages) }
  const eligibility = evaluateUiverseRuntimeEligibility(component, {
    mode,
    text: Object.fromEntries(normalized.text),
    projectedTextIds: [...normalized.projectedTextIds],
    fields: Object.fromEntries(normalized.fields),
    actions: Object.fromEntries(normalized.actions),
    images: Object.fromEntries(normalized.images),
  })
  if (!eligibility.eligible) {
    const invalidField = eligibility.reasons.find(reason => reason.startsWith('field-value-invalid:'))
    if (invalidField) fault(`FIELD_VALUE_INVALID:${invalidField.slice('field-value-invalid:'.length)}`)
    fault(`BINDINGS_INCOMPLETE:${[...eligibility.reasons, ...eligibility.missing].join(',')}`)
  }
  return normalized
}

function isPermittedUrl(value: string): boolean {
  return value.startsWith('#') || value.startsWith('data:')
}

function sanitizeTree(root: DocumentFragment): void {
  const visit = (node: Element): void => {
    const tag = node.localName.toLowerCase()
    if (forbiddenTags.has(tag)) { node.remove(); return }
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (/^on/iu.test(name) || ['srcdoc', 'target', 'autofocus'].includes(name)) { node.removeAttribute(attribute.name); continue }
      if (urlAttributes.has(name) && !isPermittedUrl(attribute.value)) { node.removeAttribute(attribute.name); continue }
      if (name === 'style') node.setAttribute(attribute.name, sanitizeUiverseCss(attribute.value))
    }
    if (tag === 'style') node.textContent = sanitizeUiverseCss(node.textContent ?? '')
    for (const child of [...node.children]) visit(child)
  }
  for (const child of [...root.children]) visit(child)
}

function createSourceFragment(document: Document, source: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = source
  sanitizeTree(template.content)
  return template.content
}

function segment(path: string): { readonly tag: string, readonly index: number }[] | undefined {
  const chunks = path.split('/').slice(1)
  const parsed = chunks.map(value => /^([A-Za-z][A-Za-z0-9-]*)\[(\d+)\]$/u.exec(value)).map(match => match ? { tag: match[1]!.toLowerCase(), index: Number(match[2]) } : undefined)
  return parsed.some(value => value === undefined) ? undefined : parsed as { readonly tag: string, readonly index: number }[]
}

function findTarget(root: HTMLElement, target: UiverseRuntimeTarget): Element | undefined {
  let parent: ParentNode = root
  for (const current of segment(target.path) ?? []) {
    const children = [...parent.children].filter(child => child.localName.toLowerCase() === current.tag)
    const found = children[current.index]
    if (!(found instanceof Element)) return undefined
    parent = found
  }
  return parent instanceof Element ? parent : undefined
}

function findTextTarget(root: HTMLElement, target: UiverseRuntimeTarget): Text | undefined {
  if (target.kind !== 'text' || target.textIndex === undefined) return undefined
  const element = findTarget(root, target)
  if (!element) return undefined
  const text = [...element.childNodes].filter(node => node.nodeType === 3)
  const candidate = text[target.textIndex]
  return candidate instanceof Text ? candidate : undefined
}

function setDisabled(element: Element, disabled: boolean): void {
  if ('disabled' in element) (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled = disabled
  element.toggleAttribute('aria-disabled', disabled)
}

function elementActionable(element: Element): boolean {
  if (element instanceof HTMLButtonElement) return true
  if (element instanceof HTMLInputElement) return directActionTypes.has(element.type.toLowerCase())
  return element instanceof HTMLAnchorElement && element.getAttribute('role')?.toLowerCase() === 'button'
}

function cssString(value: string): string {
  return `"${value.replace(/["\\\u0000-\u001f\u007f]/gu, character => `\\${character.codePointAt(0)!.toString(16)} `)}"`
}
/** Fixed source descriptors, never model input, decide which attributes may change. */
function validateAttributeDescriptors(component: UiverseRuntimeComponent): void {
  for (const target of component.targets.filter(candidate => candidate.kind === 'attribute')) {
    const descriptors = Number(target.cssAttribute !== undefined) + Number(target.htmlAttribute !== undefined)
    if (descriptors !== 1) fault(`ATTRIBUTE_DESCRIPTOR_INVALID:${target.id}`)
    if (target.htmlAttribute && !htmlSemanticAttributes.has(target.htmlAttribute.attribute)) fault(`HTML_ATTRIBUTE_UNSUPPORTED:${target.id}`)
  }
  for (const target of component.targets.filter(candidate => candidate.kind === 'value')) {
    const constraint = target.fieldConstraint
    if (!constraint || constraint.element !== target.tag || constraint.element === 'select' && !Array.isArray(constraint.options) || constraint.element === 'input' && typeof constraint.inputType !== 'string') fault(`FIELD_CONSTRAINT_INVALID:${target.id}`)
  }
}
/** Per-mount ownership receipt for CSS text written by this runtime. */
type LastAppliedCss = WeakMap<Element, string>

function applyCssBindings(root: HTMLElement, component: UiverseRuntimeComponent, values: NormalizedValues, lastAppliedCss: LastAppliedCss): void {
  const byStyle = new Map<string, { readonly element: Element, readonly css: string, readonly targets: UiverseRuntimeTarget[] }>()
  for (const target of component.targets.filter(candidate => candidate.kind === 'css-content')) {
    if (!target.cssContent) fault(`CSS_BINDING_METADATA_MISSING:${target.id}`)
    const element = findTarget(root, target)
    if (!element || element.localName.toLowerCase() !== 'style') fault(`CSS_SOURCE_TARGET_MISSING:${target.id}`)
    const existing = byStyle.get(target.path)
    if (existing) existing.targets.push(target)
    else byStyle.set(target.path, { element, css: target.cssContent.css, targets: [target] })
  }
  for (const group of byStyle.values()) {
    // The immutable source range plan always rebases from sanitized archive
    // CSS. On later updates the DOM must still contain exactly our own prior
    // output; any other mutation is a named fail-closed boundary.
    const expectedCurrent = lastAppliedCss.get(group.element) ?? group.css
    if (group.element.textContent !== expectedCurrent) fault('CSS_SOURCE_MISMATCH')
    let css = group.css
    for (const target of [...group.targets].sort((left, right) => right.cssContent!.start - left.cssContent!.start)) {
      const binding = target.cssContent!, value = values.text.get(target.id)
      if (value === undefined || css.slice(binding.start, binding.end) !== binding.expected) fault(`CSS_RANGE_MISMATCH:${target.id}`)
      css = css.slice(0, binding.start) + cssString(value) + css.slice(binding.end)
    }
    group.element.textContent = css
    lastAppliedCss.set(group.element, css)
  }
  for (const target of component.targets.filter(candidate => candidate.kind === 'attribute')) {
    const value = values.text.get(target.id)
    if (target.htmlAttribute) {
      if (value === undefined) fault(`HTML_ATTRIBUTE_BINDING_MISSING:${target.id}`)
      const element = findTarget(root, target)
      if (!element) fault(`HTML_ATTRIBUTE_TARGET_MISSING:${target.id}`)
      element.setAttribute(target.htmlAttribute.attribute, value)
      continue
    }
    const binding = target.cssAttribute
    if (!binding || value === undefined) fault(`CSS_ATTRIBUTE_BINDING_MISSING:${target.id}`)
    let matched: Element[]
    try { matched = [...root.querySelectorAll(binding.selector)] } catch { fault(`CSS_ATTRIBUTE_SELECTOR_INVALID:${target.id}`) }
    if (!matched.length) fault(`CSS_ATTRIBUTE_TARGET_MISSING:${target.id}`)
    for (const element of matched) element.setAttribute(binding.attribute, value)
  }
}

/**
 * Options without an explicit value derive it from their label. Those labels
 * are valid text-binding targets, so freeze each native option value while
 * the fixed source tree is detached before any label can be rebound.
 */
function freezeSelectOptionValues(root: HTMLElement, component: UiverseRuntimeComponent): void {
  for (const target of component.targets.filter(candidate => candidate.kind === 'value' && candidate.fieldConstraint?.element === 'select')) {
    const element = findTarget(root, target)
    if (!(element instanceof HTMLSelectElement)) fault(`SELECT_TARGET_INVALID:${target.id}`)
    const actual = [...element.options].map(option => option.value)
    const expected = target.fieldConstraint!.options
    if (!expected || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fault(`SELECT_OPTIONS_CONSTRAINT_MISMATCH:${target.id}`)
    for (const option of element.options) option.setAttribute('value', option.value)
  }
}

function applyValues(root: HTMLElement, component: UiverseRuntimeComponent, values: NormalizedValues, lastAppliedCss: LastAppliedCss): void {
  applyCssBindings(root, component, values, lastAppliedCss)
  for (const target of component.targets.filter(target => target.kind === 'text')) {
    if (values.projectedTextIds.has(target.id)) continue
    const text = findTextTarget(root, target), value = values.text.get(target.id)
    if (!text) fault(`SOURCE_TARGET_MISSING:${target.id}`)
    if (value !== undefined) text.data = value
  }
  for (const target of component.targets) {
    if (target.kind === 'css-content' || target.kind === 'attribute') continue
    const element = findTarget(root, target)
    if (!element) fault(`SOURCE_TARGET_MISSING:${target.id}`)
    if (target.kind === 'value') {
      const field = values.fields.get(target.id)
      if (field?.value !== undefined) {
        const constraint = target.fieldConstraint
        if (!constraint || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) fault(`FIELD_TARGET_INVALID:${target.id}`)
        element.value = field.value
        if (!reflectsUiverseRuntimeFieldValue(target, element.value, field.value)) fault(`FIELD_VALUE_NOT_REFLECTED:${target.id}`)
      }
      if (field?.disabled !== undefined || values.mode === 'read-only') setDisabled(element, values.mode === 'read-only' || field?.disabled === true)
    } else if (target.kind === 'checked') {
      const field = values.fields.get(target.id)
      if (field?.checked !== undefined && element instanceof HTMLInputElement) element.checked = field.checked
      if (field?.disabled !== undefined || values.mode === 'read-only') setDisabled(element, values.mode === 'read-only' || field?.disabled === true)
    } else if (target.kind === 'file') {
      const field = values.fields.get(target.id)
      // File values are browser/user-owned and cannot be assigned by a model
      // or by JavaScript. The explicit `file:true` binding only authorizes the
      // real native picker/event path.
      if (field?.disabled !== undefined || values.mode === 'read-only') setDisabled(element, values.mode === 'read-only' || field?.disabled === true)
    } else if (target.kind === 'action') {
      const action = values.actions.get(target.id)
      if (action?.disabled !== undefined || values.mode === 'read-only') setDisabled(element, values.mode === 'read-only' || action?.disabled === true)
    } else if (target.kind === 'placeholder') {
      const value = values.text.get(target.id)
      if (value !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.placeholder = value
    } else if (target.kind === 'image') {
      const image = values.images.get(target.id)
      if (image && element instanceof HTMLImageElement) {
        element.src = image.src
        // The fixed source may carry an author-provided description. An image
        // binding without an explicit alt is intentionally decorative, not
        // permission to preserve that source description.
        element.alt = image.alt ?? ''
      }
    }
  }
}

function contentProjectionTarget(component: UiverseRuntimeComponent, requested: string | undefined): UiverseRuntimeTarget | undefined {
  if (requested === undefined) return undefined
  const target = component.targets.find(candidate => candidate.id === requested)
  if (!target || target.kind !== 'text' || target.semanticRole !== 'content') fault('CONTENT_PROJECTION_TARGET_INVALID')
  return target
}

function projectionSlotName(value: string | undefined): string {
  if (value !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value)) fault('CONTENT_PROJECTION_SLOT_INVALID')
  return value ?? `uiverse-content-${String(nextProjectionSlot++)}`
}

function valuesWithProjection(values: UiverseRuntimeValues | undefined, target: UiverseRuntimeTarget | undefined): UiverseRuntimeValues {
  if (!target) return values ?? {}
  return { ...(values ?? {}), projectedTextIds: [...new Set([...(values?.projectedTextIds ?? []), target.id])] }
}

/**
 * Mount one immutable archive component into an isolated Shadow DOM. It never
 * runs source scripts, loads remote assets, evaluates model text, or executes
 * host actions. User gestures are returned as small named events only.
 */
export function mountUiverseRuntime(options: UiverseRuntimeMountOptions): UiverseRuntimeInstance {
  const { component, host, onEvent } = options
  if (component.availability === 'blocked' || !component.selectableWhenBound || !component.source) fault('COMPONENT_UNAVAILABLE')
  if (host.shadowRoot) fault('HOST_ALREADY_MOUNTED')
  validateAttributeDescriptors(component)
  // Validate every semantic slot before inserting the source. If the caller
  // cannot bind a product name, price, label, input, or image, its author demo
  // never enters the DOM even for one frame.
  const projectionTarget = contentProjectionTarget(component, options.contentProjection?.targetId)
  const contentSlotName = projectionTarget ? projectionSlotName(options.contentProjection?.slotName) : undefined
  let current = normalizeValues(valuesWithProjection(options.values, projectionTarget), component)
  const lastAppliedCss: LastAppliedCss = new WeakMap()
  const document = host.ownerDocument
  const shell = document.createElement('div')
  shell.setAttribute('data-uiverse-runtime-component', component.id)
  shell.setAttribute('data-uiverse-runtime-availability', component.availability)
  shell.style.cssText = 'box-sizing:border-box;display:block;max-width:100%;min-width:0;overflow:hidden;'
  shell.append(createSourceFragment(document, component.source))
  freezeSelectOptionValues(shell, component)

  if (projectionTarget && contentSlotName) {
    const text = findTextTarget(shell, projectionTarget)
    if (!text) fault('CONTENT_PROJECTION_SOURCE_SLOT_MISSING')
    const slot = document.createElement('slot')
    slot.name = contentSlotName
    slot.setAttribute('data-uiverse-content-projection', projectionTarget.id)
    text.replaceWith(slot)
  }
  // All fixed source values, including native field reflection, are checked
  // while detached. A browser clamp/default can never make an author demo
  // source visible for a frame inside the Host ShadowRoot.
  applyValues(shell, component, current, lastAppliedCss)
  const shadowRoot = host.attachShadow({ mode: 'open' })
  const commonStyle = document.createElement('style')
  commonStyle.textContent = ':host{display:block;min-width:0;max-width:100%}*,*::before,*::after{box-sizing:border-box;max-width:100%}@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'
  shadowRoot.append(commonStyle)
  if (component.sharedCss) {
    const sharedStyle = document.createElement('style')
    sharedStyle.setAttribute('data-uiverse-runtime-shared-css', '')
    sharedStyle.textContent = sanitizeUiverseCss(component.sharedCss)
    shadowRoot.append(sharedStyle)
  }
  shadowRoot.append(shell)
  const cleanups: Array<() => void> = []
  if (component.availability === 'interactive') {
    for (const target of component.targets.filter(target => target.kind === 'action')) {
      const element = findTarget(shell, target)
      if (!element || !elementActionable(element)) continue
      const listener = (event: Event): void => {
        event.preventDefault()
        const action = current.actions.get(target.id)
        if (!action || action.disabled || current.mode === 'read-only' || element.getAttribute('aria-disabled') === 'true') return
        onEvent?.({ kind: 'action', componentId: component.id, targetId: target.id, actionId: action.actionId })
      }
      element.addEventListener('click', listener)
      cleanups.push(() => element.removeEventListener('click', listener))
    }
    for (const target of component.targets.filter(target => target.kind === 'value' || target.kind === 'checked' || target.kind === 'file')) {
      const element = findTarget(shell, target)
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue
      const listener = (): void => {
        if (target.kind === 'checked' && element instanceof HTMLInputElement) onEvent?.({ kind: 'toggle', componentId: component.id, targetId: target.id, fieldId: target.id, checked: element.checked })
        else if (target.kind === 'file' && element instanceof HTMLInputElement) onEvent?.({ kind: 'file', componentId: component.id, targetId: target.id, fieldId: target.id, names: [...(element.files ?? [])].map(file => file.name).slice(0, UIVERSE_RUNTIME_MAX_BINDINGS) })
        else onEvent?.({ kind: 'field', componentId: component.id, targetId: target.id, fieldId: target.id, value: element.value })
      }
      element.addEventListener('input', listener)
      element.addEventListener('change', listener)
      cleanups.push(() => { element.removeEventListener('input', listener); element.removeEventListener('change', listener) })
    }
    for (const form of [...shell.querySelectorAll('form')]) {
      const listener = (event: Event): void => event.preventDefault()
      form.addEventListener('submit', listener)
      cleanups.push(() => form.removeEventListener('submit', listener))
    }
  }
  let disposed = false
  return {
    shadowRoot,
    ...(contentSlotName === undefined ? {} : { contentSlotName }),
    ...(projectionTarget === undefined ? {} : { contentProjectionTargetId: projectionTarget.id }),
    update(next: UiverseRuntimeValues): void {
      if (disposed) fault('DISPOSED')
      const nextValues = normalizeValues(valuesWithProjection(next, projectionTarget), component)
      applyValues(shell, component, nextValues, lastAppliedCss)
      current = nextValues
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const cleanup of cleanups.splice(0)) cleanup()
      shadowRoot.replaceChildren()
    },
  }
}
