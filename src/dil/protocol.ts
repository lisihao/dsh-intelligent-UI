/** Browser-safe contract shared by Host compilation, persistence, and the runner. */
export const DIL_PROTOCOL_VERSION = 1 as const
export const MAX_DIL_TREE_DEPTH = 32
export const MAX_DIL_TREE_NODES = 2_000
export const MAX_DIL_TREE_BYTES = 1024 * 1024
/** The generic external-component bridge has a smaller data boundary than a complete DIL tree. */
export const MAX_DIL_COMPONENT_INPUT_BYTES = 128 * 1024

export type DilJson = null | boolean | number | string | readonly DilJson[] | { readonly [key: string]: DilJson }
export type DilJsonRecord = { readonly [key: string]: DilJson }

/** Validated reference compiler payload; code remains inert data at this boundary. */
export interface CompiledDil {
  readonly ok: boolean
  readonly protocolVersion: typeof DIL_PROTOCOL_VERSION
  readonly source: string
  readonly sourceLength: number
  /** Only the opaque-origin reference Worker can evaluate this program. */
  readonly code: string
  readonly codeLength: number
  readonly constants: DilJsonRecord
  readonly constantCount: number
  readonly requiredComponents: readonly string[]
  readonly appData: DilJsonRecord
  readonly genuiComponents: readonly DilJsonRecord[]
  readonly stateKeys: readonly string[]
  readonly fallbackMarkdown: string
  readonly diagnostics: readonly DilJsonRecord[]
  readonly diagnosticSummary: string
  readonly durationMs: number
  readonly compiledAt: string
}

export const DIL_INTRINSIC_TAGS = [
  'box', 'row', 'column', 'grid', 'grid-item', 'card', 'divider', 'spacer',
  'text', 'title', 'caption', 'bold', 'label', 'code', 'markdown', 'icon', 'badge',
  'component',
  'button', 'input', 'textarea', 'checkbox', 'radio', 'radio-group', 'select',
  'slider', 'segmented-control', 'table', 'table-row', 'table-cell', 'list',
  'list-item', 'progress', 'chart', 'pie-chart', 'image', 'link', 'form',
  'tabs', 'tab', 'tab-panel', 'switch',
] as const
export type DilIntrinsicTag = typeof DIL_INTRINSIC_TAGS[number]
export interface DilHandlerRef { readonly __dilFn: string }
export type DilSafeProp = DilJson | DilHandlerRef
export type DilSafeProps = { readonly [key: string]: DilSafeProp }
export interface DilTextNode { readonly t: '#text'; readonly v: string }
export interface DilFragmentNode { readonly t: '#frag'; readonly c?: readonly DilNode[] }
export interface DilElementNode { readonly t: DilIntrinsicTag; readonly p?: DilSafeProps; readonly c?: readonly DilNode[] }
export type DilNode = DilTextNode | DilFragmentNode | DilElementNode

export type DilProtocolErrorCode =
  | 'DIL_COMPILED_INVALID' | 'DIL_COMPILED_VERSION_UNSUPPORTED'
  | 'DIL_TREE_INVALID_ROOT' | 'DIL_TREE_CYCLE' | 'DIL_TREE_DEPTH_EXCEEDED'
  | 'DIL_TREE_NODE_LIMIT_EXCEEDED' | 'DIL_TREE_SIZE_EXCEEDED'
  | 'DIL_TREE_UNSAFE_TAG' | 'DIL_TREE_UNSUPPORTED_TAG' | 'DIL_TREE_INVALID_NODE'
  | 'DIL_TREE_INVALID_PROPS' | 'DIL_TREE_UNSAFE_PROP' | 'DIL_TREE_UNSAFE_STYLE'
  | 'DIL_TREE_UNSAFE_URL' | 'DIL_TREE_INVALID_HANDLER'
  | 'DIL_TREE_COMPONENT_INVALID' | 'DIL_TREE_COMPONENT_INPUT_INVALID' | 'DIL_TREE_COMPONENT_INPUT_LIMIT_EXCEEDED'

export class DilProtocolError extends Error {
  readonly code: DilProtocolErrorCode
  constructor(code: DilProtocolErrorCode, message: string) { super(message); this.name = 'DilProtocolError'; this.code = code }
}

const tags = new Set<string>(DIL_INTRINSIC_TAGS)
const unsafeTags = new Set(['script', 'iframe', 'html', 'head', 'body', 'style', 'object', 'embed', 'template', 'svg', 'math'])
const unsafeProps = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'dangerouslySetInnerHTML', 'document', 'window', 'constructor', 'prototype', '__proto__'])
const eventProps = new Set(['onClick', 'onChange', 'onInput', 'onBlur', 'onFocus', 'onKeyDown', 'onKeyUp', 'onSubmit'])
const MAX_DIL_LINK_URL_LENGTH = 2_048
const MAX_DIL_IMAGE_DATA_URL_LENGTH = 512 * 1024
const encoder = new TextEncoder()
const componentProps = new Set(['id', 'input', 'onChange', 'hidden'])
export const DIL_CURATED_UIVERSE_COMPONENT_IDS = Object.freeze([
  ...['soft-relief', 'clear-glass', 'mechanical-outline'].flatMap(set => ['button', 'input', 'toggle', 'card', 'loader'].map(role => `uiverse:${set}:${role}`)),
])
export const DIL_LIBRARY_COMPONENT_IDS = Object.freeze(['component:skullet', 'component:torph', 'component:liveline', 'component:visx-historical'])
const curatedUiverseComponentIds = new Set(DIL_CURATED_UIVERSE_COMPONENT_IDS)
const libraryComponentIds = new Set(DIL_LIBRARY_COMPONENT_IDS)

function fail(code: DilProtocolErrorCode, message: string): never { throw new DilProtocolError(code, message) }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function cloneJson(value: unknown, code: DilProtocolErrorCode, ancestors = new WeakSet<object>(), depth = 0): DilJson {
  if (depth > 64) fail(code, 'JSON nesting exceeds the boundary limit.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(code, 'JSON numbers must be finite.'); return value }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail(code, 'JSON contains a cycle.')
    ancestors.add(value); try { return value.map(item => cloneJson(item, code, ancestors, depth + 1)) } finally { ancestors.delete(value) }
  }
  if (!isRecord(value)) fail(code, 'Value is not JSON-compatible.')
  if (ancestors.has(value)) fail(code, 'JSON contains a cycle.')
  ancestors.add(value)
  try {
    const output = Object.create(null) as Record<string, DilJson>
    for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item, code, ancestors, depth + 1)
    return output
  } finally { ancestors.delete(value) }
}
function compiledRecord(value: unknown, field: string): DilJsonRecord {
  const cloned = cloneJson(value, 'DIL_COMPILED_INVALID')
  if (!isRecord(cloned)) fail('DIL_COMPILED_INVALID', `${field} must be an object.`)
  return cloned as DilJsonRecord
}
function compiledRecords(value: unknown, field: string): readonly DilJsonRecord[] {
  if (!Array.isArray(value)) fail('DIL_COMPILED_INVALID', `${field} must be an array.`)
  return value.map((item, index) => compiledRecord(item, `${field}[${String(index)}]`))
}
function compiledString(value: unknown, field: string): string {
  if (typeof value !== 'string') fail('DIL_COMPILED_INVALID', `${field} must be a string.`)
  return value
}
function compiledNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('DIL_COMPILED_INVALID', `${field} must be finite.`)
  return value
}
function compiledStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail('DIL_COMPILED_INVALID', `${field} must be an array of strings.`)
  return [...value] as string[]
}

/** Validate persisted/RPC compiler data without importing the Host-only compiler. */
export function validateCompiledDil(value: unknown): CompiledDil {
  if (!isRecord(value)) fail('DIL_COMPILED_INVALID', 'Compiled DIL payload must be an object.')
  if (value.protocolVersion !== DIL_PROTOCOL_VERSION) {
    if (typeof value.protocolVersion === 'number') fail('DIL_COMPILED_VERSION_UNSUPPORTED', `DIL protocol ${String(value.protocolVersion)} is unsupported.`)
    fail('DIL_COMPILED_INVALID', 'Compiled DIL payload has no valid protocol version.')
  }
  const source = compiledString(value.source, 'source'), sourceLength = compiledNumber(value.sourceLength, 'sourceLength')
  const code = compiledString(value.code, 'code'), codeLength = compiledNumber(value.codeLength, 'codeLength')
  const constants = compiledRecord(value.constants, 'constants'), constantCount = compiledNumber(value.constantCount, 'constantCount')
  const appData = compiledRecord(value.appData, 'appData'), requiredComponents = compiledStrings(value.requiredComponents, 'requiredComponents')
  const genuiComponents = compiledRecords(value.genuiComponents, 'genuiComponents'), stateKeys = compiledStrings(value.stateKeys, 'stateKeys')
  const fallbackMarkdown = compiledString(value.fallbackMarkdown, 'fallbackMarkdown'), diagnostics = compiledRecords(value.diagnostics, 'diagnostics')
  const diagnosticSummary = compiledString(value.diagnosticSummary, 'diagnosticSummary'), durationMs = compiledNumber(value.durationMs, 'durationMs')
  const compiledAt = compiledString(value.compiledAt, 'compiledAt')
  if (typeof value.ok !== 'boolean') fail('DIL_COMPILED_INVALID', 'ok must be boolean.')
  if (!Number.isInteger(sourceLength) || sourceLength !== source.length || !Number.isInteger(codeLength) || codeLength !== code.length) fail('DIL_COMPILED_INVALID', 'Source/code lengths do not match metadata.')
  if (!code.length || !Number.isInteger(constantCount) || constantCount !== Object.keys(constants).length) fail('DIL_COMPILED_INVALID', 'Code or constant metadata is invalid.')
  return { ok: value.ok, protocolVersion: DIL_PROTOCOL_VERSION, source, sourceLength, code, codeLength, constants, constantCount, requiredComponents, appData, genuiComponents, stateKeys, fallbackMarkdown, diagnostics, diagnosticSummary, durationMs, compiledAt }
}

function isHandler(value: unknown): value is DilHandlerRef {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.__dilFn === 'string'
}
function handler(value: unknown, path: string): DilHandlerRef {
  if (!isHandler(value) || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value.__dilFn)) fail('DIL_TREE_INVALID_HANDLER', `${path} must be exactly {__dilFn:string}.`)
  return { __dilFn: value.__dilFn }
}
function styleHasUrl(value: DilJson): boolean {
  if (typeof value === 'string') return /url\s*\(/iu.test(value)
  if (Array.isArray(value)) return value.some(styleHasUrl)
  return value !== null && typeof value === 'object' && Object.values(value).some(styleHasUrl)
}
function validateLinkHref(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length > MAX_DIL_LINK_URL_LENGTH) fail('DIL_TREE_UNSAFE_URL', `${path} must be a bounded http(s) URL.`)
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('DIL_TREE_UNSAFE_URL', `${path} uses a blocked URL scheme.`)
  } catch (error) {
    if (error instanceof DilProtocolError) throw error
    fail('DIL_TREE_UNSAFE_URL', `${path} must be a valid http(s) URL.`)
  }
}
function validateImageSource(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length > MAX_DIL_IMAGE_DATA_URL_LENGTH || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    fail('DIL_TREE_UNSAFE_URL', `${path} must be a bounded raster image data URL.`)
  }
}
function validateFormAction(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(value)) {
    fail('DIL_TREE_INVALID_PROPS', `${path} must be a bounded submit action identifier.`)
  }
}
/**
 * The generic bridge recognizes only opaque, fixed library namespaces. Exact
 * catalog membership and per-component input schemas are deliberately owned
 * by the host renderer, not by DIL.
 */
export function validateDilExternalComponentId(value: unknown, path = 'component.id'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 180) fail('DIL_TREE_COMPONENT_INVALID', `${path} must be a bounded external component id.`)
  const separator = value.indexOf(':')
  const namespace = separator > 0 ? value.slice(0, separator) : ''
  const local = separator > 0 ? value.slice(separator + 1) : ''
  const valid = libraryComponentIds.has(value)
    || curatedUiverseComponentIds.has(value)
    || (namespace === 'tuffui'
      ? /^[a-z][a-z0-9-]{0,95}$/u.test(local)
      : namespace === 'canvas'
        ? /^[a-z][a-z0-9-]{0,95}$/u.test(local)
        : namespace === 'uiverse'
          ? /^[A-Za-z][A-Za-z0-9_.\/-]{0,159}$/u.test(local) && !local.includes('..') && !local.startsWith('/') && !local.endsWith('/')
          : false)
  if (!valid || value === 'dil:component') fail('DIL_TREE_COMPONENT_INVALID', `${path} must use a fixed supported library namespace.`)
  return value
}

/**
 * Clone source-bound component data while keeping it inert JSON. The generic
 * bridge does not interpret JSON names or values: code, URLs, image src values,
 * action labels, handler-looking examples, and component-shaped documents may
 * all be legitimate data for a fixed host schema. Functions, non-finite values,
 * cyclic/non-plain objects, depth, and byte size are rejected by cloneJson.
 */
export function validateDilComponentInput(value: unknown, path = 'component.input'): DilJson {
  const input = cloneJson(value, 'DIL_TREE_COMPONENT_INPUT_INVALID')
  if (encoder.encode(JSON.stringify(input)).byteLength > MAX_DIL_COMPONENT_INPUT_BYTES) {
    fail('DIL_TREE_COMPONENT_INPUT_LIMIT_EXCEEDED', `${path} exceeds ${String(MAX_DIL_COMPONENT_INPUT_BYTES)} bytes.`)
  }
  return input
}
function validateProps(value: unknown, tag: DilIntrinsicTag, path: string, ancestors: WeakSet<object>): DilSafeProps | undefined {
  if (value === undefined) {
    if (tag === 'form') fail('DIL_TREE_INVALID_PROPS', `${path}.action is required for a host-owned form submit.`)
    if (tag === 'markdown') fail('DIL_TREE_INVALID_PROPS', `${path}.source must be a string.`)
    if (tag === 'component') fail('DIL_TREE_COMPONENT_INVALID', `${path}.id and ${path}.input are required.`)
    return undefined
  }
  if (!isRecord(value)) fail('DIL_TREE_INVALID_PROPS', `${path} must be an object.`)
  if (ancestors.has(value)) fail('DIL_TREE_CYCLE', `${path} contains a cycle.`)
  ancestors.add(value)
  try {
    const output: Record<string, DilSafeProp> = {}
    for (const [key, raw] of Object.entries(value)) {
      if (unsafeProps.has(key)) fail('DIL_TREE_UNSAFE_PROP', `${path}.${key} is not allowed.`)
      if (tag === 'component' && !componentProps.has(key)) fail('DIL_TREE_COMPONENT_INVALID', `${path}.${key} is not supported by component.`)
      if (key.startsWith('on')) { if (!eventProps.has(key)) fail('DIL_TREE_UNSAFE_PROP', `${path}.${key} is not supported.`); output[key] = handler(raw, `${path}.${key}`); continue }
      if (isHandler(raw)) fail('DIL_TREE_INVALID_HANDLER', `${path}.${key} may not carry a handler.`)
      const cloned = tag === 'component' && key === 'input'
        ? validateDilComponentInput(raw, `${path}.${key}`)
        : cloneJson(raw, 'DIL_TREE_INVALID_PROPS', ancestors)
      if (key === 'style' && (typeof raw === 'string' || styleHasUrl(cloned))) fail('DIL_TREE_UNSAFE_STYLE', `${path}.style may not contain CSS strings or URLs.`)
      if (tag === 'link' && key === 'href') validateLinkHref(raw, `${path}.${key}`)
      if (tag === 'image' && key === 'src') validateImageSource(raw, `${path}.${key}`)
      if (tag === 'form' && key === 'action') validateFormAction(raw, `${path}.${key}`)
      output[key] = cloned
    }
    if (tag === 'form') {
      if (!Object.hasOwn(output, 'action')) fail('DIL_TREE_INVALID_PROPS', `${path}.action is required for a host-owned form submit.`)
      if (Object.hasOwn(output, 'onSubmit')) fail('DIL_TREE_UNSAFE_PROP', `${path}.onSubmit is not supported by the host-action-only form adapter.`)
    }
    if (tag === 'button' && output.type === 'submit' && Object.hasOwn(output, 'onClick')) {
      fail('DIL_TREE_UNSAFE_PROP', `${path}.onClick is not supported on submit buttons.`)
    }
    if (tag === 'markdown' && typeof output.source !== 'string') fail('DIL_TREE_INVALID_PROPS', `${path}.source must be a string.`)
    if (tag === 'component') {
      if (!Object.hasOwn(output, 'id') || !Object.hasOwn(output, 'input')) fail('DIL_TREE_COMPONENT_INVALID', `${path}.id and ${path}.input are required.`)
      validateDilExternalComponentId(output.id, `${path}.id`)
      validateDilComponentInput(output.input, `${path}.input`)
      if (Object.hasOwn(output, 'onChange') && !isHandler(output.onChange)) fail('DIL_TREE_INVALID_HANDLER', `${path}.onChange must be a handler reference.`)
    }
    return output
  } finally { ancestors.delete(value) }
}

/** Validate, bound and clone one reference snapshot before any host adapter sees it. */
export function validateDilTree(value: unknown): DilNode {
  if (!isRecord(value)) fail('DIL_TREE_INVALID_ROOT', 'DIL tree root must be an object node.')
  let count = 0
  const ancestors = new WeakSet<object>()
  const visit = (node: unknown, depth: number, path: string): DilNode => {
    if (depth > MAX_DIL_TREE_DEPTH) fail('DIL_TREE_DEPTH_EXCEEDED', `${path} exceeds depth ${String(MAX_DIL_TREE_DEPTH)}.`)
    if (!isRecord(node)) fail('DIL_TREE_INVALID_NODE', `${path} must be an object node.`)
    if (ancestors.has(node)) fail('DIL_TREE_CYCLE', `${path} contains a tree cycle.`)
    if (++count > MAX_DIL_TREE_NODES) fail('DIL_TREE_NODE_LIMIT_EXCEEDED', `DIL tree exceeds ${String(MAX_DIL_TREE_NODES)} nodes.`)
    ancestors.add(node)
    try {
      if (node.t === '#text') {
        if (node.p !== undefined || node.c !== undefined || typeof node.v !== 'string') fail('DIL_TREE_INVALID_NODE', `${path} has an invalid text shape.`)
        return { t: '#text', v: node.v }
      }
      if (node.c !== undefined && !Array.isArray(node.c)) fail('DIL_TREE_INVALID_NODE', `${path}.c must be an array.`)
      const children = (node.c as unknown[] | undefined)?.map((child, index) => visit(child, depth + 1, `${path}.c[${String(index)}]`))
      if (node.t === '#frag') {
        if (node.p !== undefined || node.v !== undefined) fail('DIL_TREE_INVALID_NODE', `${path} fragment has props or value.`)
        return children?.length ? { t: '#frag', c: children } : { t: '#frag' }
      }
      if (typeof node.t !== 'string') fail('DIL_TREE_INVALID_NODE', `${path}.t must be a string.`)
      if (node.v !== undefined) fail('DIL_TREE_INVALID_NODE', `${path} element has v.`)
      if ((node.t === 'markdown' || node.t === 'component') && children?.length) fail('DIL_TREE_INVALID_NODE', `${path} ${node.t} may not have children.`)
      if (unsafeTags.has(node.t.toLowerCase())) fail('DIL_TREE_UNSAFE_TAG', `${path}.t "${node.t}" is forbidden.`)
      if (!tags.has(node.t)) fail('DIL_TREE_UNSUPPORTED_TAG', `${path}.t "${node.t}" is not implemented.`)
      const safeProps = validateProps(node.p, node.t as DilIntrinsicTag, `${path}.p`, ancestors)
      return { t: node.t as DilIntrinsicTag, ...(safeProps && Object.keys(safeProps).length ? { p: safeProps } : {}), ...(children?.length ? { c: children } : {}) }
    } finally { ancestors.delete(node) }
  }
  const tree = visit(value, 0, '$')
  const serialized = JSON.stringify(tree)
  if (encoder.encode(serialized).byteLength > MAX_DIL_TREE_BYTES) fail('DIL_TREE_SIZE_EXCEEDED', `DIL tree exceeds ${String(MAX_DIL_TREE_BYTES)} serialized bytes.`)
  return tree
}
