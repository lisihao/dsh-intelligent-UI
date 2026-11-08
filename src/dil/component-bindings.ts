import { DIL_ALLOWED_HANDLERS, DIL_ALLOWED_PROPS, DIL_COMPONENT_CATALOG } from './catalog.js'
import {
  validateDilTree,
  validateDilComponentInput,
  validateDilExternalComponentId,
  type DilIntrinsicTag,
  type DilJson,
  type DilNode,
  type DilSafeProp,
  type DilSafeProps,
} from './protocol.js'

/**
 * A source-bound route into the native DIL component vocabulary.
 *
 * This module deliberately builds a checked snapshot tree rather than DIL
 * source. It never evaluates JavaScript or a model-provided DIL string. The
 * returned tree is the same protocol shape accepted by the native DIL view
 * after the existing opaque Worker has produced a snapshot.
 */
export const DIL_COMPONENT_BINDING_FORMAT_VERSION = 1 as const
export const DIL_NATIVE_TREE_RENDERER_KEY = 'dil-native-tree-v1' as const
export const DIL_COMPONENT_ID_PREFIX = 'dil:' as const

export type DilComponentId = `${typeof DIL_COMPONENT_ID_PREFIX}${DilIntrinsicTag}`
export type DilSourceKind = 'text' | 'markdown' | 'code' | 'table' | 'list' | 'chart' | 'node'

export type DilBindingAuthority = Readonly<{
  /** Handler ids declared by the current, already compiled DIL program. */
  handlerIds?: readonly string[]
  /** Host-owned form actions permitted for the current conversation surface. */
  formActionIds?: readonly string[]
}>

export type DilExplicitNodeSource = Readonly<{
  kind: 'node'
  tag: DilIntrinsicTag
  props?: Readonly<Record<string, unknown>>
  /** Exact source text for a textual child; no Markdown is parsed or rewritten. */
  text?: string
  /** Explicit source-bound child organization. */
  children?: readonly DilExplicitNodeSource[]
}>

export type DilTextSource = Readonly<{
  kind: 'text'
  value: string
  props?: Readonly<Record<string, unknown>>
}>

export type DilMarkdownSource = Readonly<{
  kind: 'markdown'
  source: string
}>

export type DilCodeSource = Readonly<{
  kind: 'code'
  value: string
  language?: string
}>

export type DilTableCell = string | number
export type DilTableSource = Readonly<{
  kind: 'table'
  label?: string
  header: readonly string[]
  rows: readonly (readonly DilTableCell[])[]
}>

export type DilListSource = Readonly<{
  kind: 'list'
  ordered?: boolean
  items: readonly string[]
}>

export type DilChartRow = Readonly<Record<string, string | number>>
export type DilChartSeries = Readonly<{ dataKey: string, type: 'line' | 'bar' }>
export type DilChartSource = Readonly<{
  kind: 'chart'
  data: readonly DilChartRow[]
  categoryKey: string
  /** Required for pie charts and mutually exclusive with series for chart. */
  dataKey?: string
  /** Cartesian charts use one homogeneous series type. */
  series?: readonly DilChartSeries[]
  height?: number
  title?: string
}>

export type DilComponentSource = DilTextSource | DilMarkdownSource | DilCodeSource | DilTableSource | DilListSource | DilChartSource | DilExplicitNodeSource

export type DilComponentBindingInput = Readonly<{
  formatVersion: typeof DIL_COMPONENT_BINDING_FORMAT_VERSION
  componentId: DilComponentId
  source: DilComponentSource
  authority?: DilBindingAuthority
}>

export type DilNativeComponentDefinition = Readonly<{
  id: DilComponentId
  tag: DilIntrinsicTag
  sourceKinds: readonly DilSourceKind[]
  /** Only these components can carry a handler or host-owned submit action. */
  interaction: 'none' | 'local-handler' | 'host-form-action'
}>

export type DilComponentRenderPlan = Readonly<{
  formatVersion: typeof DIL_COMPONENT_BINDING_FORMAT_VERSION
  rendererKey: typeof DIL_NATIVE_TREE_RENDERER_KEY
  componentId: DilComponentId
  tag: DilIntrinsicTag
  sourceKind: DilSourceKind
  /** Safe tree for the existing native DIL tree consumer; no source compiler is involved. */
  tree: DilNode
  requiredHandlerIds: readonly string[]
  requiredFormActionIds: readonly string[]
}>

export type DilComponentEligibility =
  | Readonly<{ eligible: true, plan: DilComponentRenderPlan }>
  | Readonly<{ eligible: false, code: string }>

export class DilComponentBindingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DilComponentBindingError'
  }
}

const MAX_SOURCE_TEXT = 20_000
const MAX_CHILDREN = 128
const MAX_OPTIONS = 64
const MAX_RECORD_FIELDS = 24
const MAX_CHART_ROWS = 100
const MAX_PROP_KEYS = 32
const SAFE_ICON_NAMES = new Set(['alert-triangle', 'arrow-right', 'check', 'chevron-down', 'copy', 'database', 'file-text', 'info', 'link', 'minus', 'plus', 'search', 'settings', 'x'])
const SAFE_TONES = new Set(['default', 'muted', 'accent', 'success', 'warning', 'danger'])
const TEXT_TAGS = new Set<DilIntrinsicTag>(['text', 'title', 'caption', 'bold', 'label', 'badge'])
const CONTENT_TAGS = new Set<DilIntrinsicTag>(['box', 'row', 'column', 'grid', 'grid-item', 'card', 'text', 'title', 'caption', 'bold', 'label', 'badge', 'button', 'table', 'table-row', 'table-cell', 'list', 'list-item', 'form', 'tabs', 'tab', 'tab-panel'])
const CONTROL_TAGS = new Set<DilIntrinsicTag>(['input', 'textarea', 'checkbox', 'radio', 'radio-group', 'select', 'slider', 'segmented-control', 'switch', 'tab', 'component'])
const BOOLEAN_PROPS = new Set(['hidden', 'wrap', 'disabled', 'required', 'checked', 'selected', 'active', 'header', 'ordered', 'showValue', 'tabularNums'])
const HANDLER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u
const FORM_ACTION_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/u

const sourceKinds: Readonly<Record<DilIntrinsicTag, readonly DilSourceKind[]>> = {
  box: ['node'], row: ['node'], column: ['node'], grid: ['node'], 'grid-item': ['node'], card: ['node'], divider: ['node'], spacer: ['node'],
  text: ['text', 'node'], title: ['text', 'node'], caption: ['text', 'node'], bold: ['text', 'node'], label: ['text', 'node'], code: ['code', 'node'], markdown: ['markdown', 'node'], icon: ['node'], badge: ['text', 'node'],
  button: ['node'], input: ['node'], textarea: ['node'], checkbox: ['node'], radio: ['node'], 'radio-group': ['node'], select: ['node'], slider: ['node'], 'segmented-control': ['node'],
  table: ['table', 'node'], 'table-row': ['node'], 'table-cell': ['node'], list: ['list', 'node'], 'list-item': ['node'], progress: ['node'], chart: ['chart', 'node'], 'pie-chart': ['chart', 'node'], image: ['node'], link: ['node'], form: ['node'], tabs: ['node'], tab: ['node'], 'tab-panel': ['node'], switch: ['node'], component: ['node'],
}

function componentId(tag: DilIntrinsicTag): DilComponentId { return `${DIL_COMPONENT_ID_PREFIX}${tag}` }
function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function fail(code: string, message: string): never { throw new DilComponentBindingError(code, message) }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) fail('DIL_BINDING_INPUT_UNKNOWN_FIELD', `${path}.${key} is not a supported source field.`)
}
function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!record(value)) fail('DIL_BINDING_INPUT_INVALID', `${path} must be a JSON object.`)
  return value
}
function boundedString(value: unknown, path: string, allowEmpty = true, max = MAX_SOURCE_TEXT): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.length === 0)) fail('DIL_BINDING_VALUE_INVALID', `${path} must be a bounded string.`)
  return value
}
function finite(value: unknown, path: string, min = -10_000, max = 10_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('DIL_BINDING_VALUE_INVALID', `${path} must be a finite number in range.`)
  return value
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('DIL_BINDING_VALUE_INVALID', `${path} must be boolean.`)
  return value
}
function boundedIdentifier(value: unknown, path: string): string {
  const result = boundedString(value, path, false, 200)
  if (!HANDLER_PATTERN.test(result)) fail('DIL_BINDING_VALUE_INVALID', `${path} must be a bounded identifier.`)
  return result
}
function cloneJson(value: unknown, path: string, ancestors = new WeakSet<object>(), depth = 0): DilJson {
  if (depth > 16) fail('DIL_BINDING_VALUE_INVALID', `${path} exceeds the JSON nesting limit.`)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > MAX_SOURCE_TEXT) fail('DIL_BINDING_VALUE_INVALID', `${path} string is too long.`)
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('DIL_BINDING_VALUE_INVALID', `${path} number must be finite.`)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CHILDREN || ancestors.has(value)) fail('DIL_BINDING_VALUE_INVALID', `${path} array is invalid.`)
    ancestors.add(value)
    try { return value.map((item, index) => cloneJson(item, `${path}[${String(index)}]`, ancestors, depth + 1)) }
    finally { ancestors.delete(value) }
  }
  if (!record(value) || Object.keys(value).length > MAX_PROP_KEYS || ancestors.has(value)) fail('DIL_BINDING_VALUE_INVALID', `${path} must be bounded JSON.`)
  ancestors.add(value)
  try {
    const output: Record<string, DilJson> = Object.create(null) as Record<string, DilJson>
    for (const [key, item] of Object.entries(value)) output[key] = cloneJson(item, `${path}.${key}`, ancestors, depth + 1)
    return output
  } finally { ancestors.delete(value) }
}

function parseAuthority(value: unknown): { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> } {
  if (value === undefined) return { handlers: new Set(), formActions: new Set() }
  const input = requiredRecord(value, 'authority')
  exactKeys(input, ['handlerIds', 'formActionIds'], 'authority')
  const parse = (raw: unknown, path: string, pattern: RegExp): ReadonlySet<string> => {
    if (raw === undefined) return new Set()
    if (!Array.isArray(raw) || raw.length > MAX_OPTIONS) fail('DIL_BINDING_AUTHORITY_INVALID', `${path} must be a bounded array.`)
    const values = new Set<string>()
    for (const [index, item] of raw.entries()) {
      const id = boundedString(item, `${path}[${String(index)}]`, false, 200)
      if (!pattern.test(id) || values.has(id)) fail('DIL_BINDING_AUTHORITY_INVALID', `${path} contains an invalid or duplicate id.`)
      values.add(id)
    }
    return values
  }
  return { handlers: parse(input.handlerIds, 'authority.handlerIds', HANDLER_PATTERN), formActions: parse(input.formActionIds, 'authority.formActionIds', FORM_ACTION_PATTERN) }
}

function handler(value: unknown, tag: DilIntrinsicTag, prop: string, authority: ReadonlySet<string>): DilSafeProp {
  const source = requiredRecord(value, `${tag}.${prop}`)
  exactKeys(source, ['__dilFn'], `${tag}.${prop}`)
  const id = boundedIdentifier(source.__dilFn, `${tag}.${prop}.__dilFn`)
  if (!authority.has(id)) fail('DIL_BINDING_HANDLER_NOT_OWNED', `${tag}.${prop} references a handler not owned by this program.`)
  return { __dilFn: id }
}

function options(value: unknown, path: string): readonly (string | number | Readonly<{ label: string, value: string | number }>)[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OPTIONS) fail('DIL_BINDING_OPTIONS_INVALID', `${path} must be a nonempty bounded array.`)
  return value.map((item, index) => {
    if (typeof item === 'string') return boundedString(item, `${path}[${String(index)}]`, true, 512)
    if (typeof item === 'number') return finite(item, `${path}[${String(index)}]`)
    const entry = requiredRecord(item, `${path}[${String(index)}]`)
    exactKeys(entry, ['label', 'value'], `${path}[${String(index)}]`)
    const label = boundedString(entry.label, `${path}[${String(index)}].label`, true, 512)
    const optionValue = entry.value
    if (typeof optionValue !== 'string' && typeof optionValue !== 'number') fail('DIL_BINDING_OPTIONS_INVALID', `${path}[${String(index)}].value must be text or a finite number.`)
    return { label, value: typeof optionValue === 'number' ? finite(optionValue, `${path}[${String(index)}].value`) : boundedString(optionValue, `${path}[${String(index)}].value`, true, 512) }
  })
}

function chartData(value: unknown, path: string): readonly DilChartRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHART_ROWS) fail('DIL_BINDING_CHART_INVALID', `${path} must have 1 to ${String(MAX_CHART_ROWS)} rows.`)
  return value.map((item, index) => {
    const row = requiredRecord(item, `${path}[${String(index)}]`)
    const entries = Object.entries(row)
    if (entries.length === 0 || entries.length > MAX_RECORD_FIELDS) fail('DIL_BINDING_CHART_INVALID', `${path}[${String(index)}] has an invalid field count.`)
    const output: Record<string, string | number> = Object.create(null) as Record<string, string | number>
    for (const [key, cell] of entries) {
      boundedString(key, `${path}[${String(index)}] key`, false, 80)
      if (typeof cell === 'string') output[key] = boundedString(cell, `${path}[${String(index)}].${key}`, true, 512)
      else if (typeof cell === 'number') output[key] = finite(cell, `${path}[${String(index)}].${key}`)
      else fail('DIL_BINDING_CHART_INVALID', `${path}[${String(index)}].${key} must be text or a finite number.`)
    }
    return output
  })
}

function semanticProps(tag: DilIntrinsicTag, props: DilSafeProps, authority: { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> }): void {
  const has = (key: string) => Object.hasOwn(props, key)
  const value = (key: string) => props[key]
  for (const [key, candidate] of Object.entries(props)) {
    if (BOOLEAN_PROPS.has(key)) bool(candidate, `${tag}.${key}`)
    if (key === 'gap' || key === 'padding' || key === 'size' && tag === 'spacer') finite(candidate, `${tag}.${key}`, 0, 8)
    if (key === 'columns' || key === 'span') finite(candidate, `${tag}.${key}`, 1, 6)
    if (key === 'rows') finite(candidate, `${tag}.${key}`, 1, 12)
    if (key === 'height') finite(candidate, `${tag}.${key}`, tag === 'chart' || tag === 'pie-chart' ? 120 : 1, tag === 'chart' || tag === 'pie-chart' ? 480 : 10_000)
    if (key === 'width') finite(candidate, `${tag}.${key}`, 1, 10_000)
    if (key === 'tone' && (!SAFE_TONES.has(boundedString(candidate, `${tag}.${key}`, false, 32)))) fail('DIL_BINDING_VALUE_INVALID', `${tag}.${key} is unsupported.`)
    if (key === 'align' && !['start', 'center', 'end', 'stretch', 'baseline'].includes(boundedString(candidate, `${tag}.${key}`, false, 32))) fail('DIL_BINDING_VALUE_INVALID', `${tag}.${key} is unsupported.`)
    if (key === 'justify' && !['start', 'center', 'end', 'between', 'around', 'evenly'].includes(boundedString(candidate, `${tag}.${key}`, false, 32))) fail('DIL_BINDING_VALUE_INVALID', `${tag}.${key} is unsupported.`)
  }
  if (tag === 'text' && has('size') && !['xs', 'sm', 'md', 'lg'].includes(boundedString(value('size'), 'text.size', false, 8))) fail('DIL_BINDING_VALUE_INVALID', 'text.size is unsupported.')
  if (tag === 'title') {
    if (has('size') && !['sm', 'md', 'lg', 'xl'].includes(boundedString(value('size'), 'title.size', false, 8))) fail('DIL_BINDING_VALUE_INVALID', 'title.size is unsupported.')
    if (has('level')) finite(value('level'), 'title.level', 1, 4)
  }
  if (tag === 'icon') {
    if (!has('name') || !SAFE_ICON_NAMES.has(boundedString(value('name'), 'icon.name', false, 32))) fail('DIL_BINDING_VALUE_INVALID', 'icon.name must be a supported source icon.')
    if (has('size')) finite(value('size'), 'icon.size', 12, 24)
  }
  if (tag === 'button') {
    if (has('type') && value('type') !== 'button' && value('type') !== 'submit') fail('DIL_BINDING_VALUE_INVALID', 'button.type must be button or submit.')
    if (value('type') !== 'submit' && value('disabled') !== true && !has('onClick')) fail('DIL_BINDING_HANDLER_REQUIRED', 'An enabled button must use an explicitly owned handler.')
  }
  if (tag === 'form') {
    const action = boundedString(value('action'), 'form.action', false, 200)
    if (!FORM_ACTION_PATTERN.test(action) || !authority.formActions.has(action)) fail('DIL_BINDING_ACTION_NOT_OWNED', 'form.action is not an action owned by this host surface.')
  }
  if (tag === 'input' || tag === 'textarea') {
    if (!has('name') || !has('value')) fail('DIL_BINDING_FIELD_REQUIRED', `${tag} requires source-provided name and value.`)
    boundedString(value('name'), `${tag}.name`, false, 200)
    if (typeof value('value') !== 'string' && typeof value('value') !== 'number') fail('DIL_BINDING_VALUE_INVALID', `${tag}.value must be text or a finite number.`)
    if (typeof value('value') === 'number') finite(value('value'), `${tag}.value`)
    if (value('disabled') !== true && !has('onChange') && !has('onInput')) fail('DIL_BINDING_HANDLER_REQUIRED', `${tag} requires an owned change handler when enabled.`)
  }
  if (tag === 'input' && has('type') && !['text', 'number', 'email', 'search', 'date', 'time'].includes(boundedString(value('type'), 'input.type', false, 16))) fail('DIL_BINDING_VALUE_INVALID', 'input.type is unsupported.')
  if (tag === 'checkbox' || tag === 'switch') {
    if (!has('name') || !has('checked')) fail('DIL_BINDING_FIELD_REQUIRED', `${tag} requires source-provided name and checked.`)
    boundedString(value('name'), `${tag}.name`, false, 200); bool(value('checked'), `${tag}.checked`)
    if (value('disabled') !== true && !has('onChange')) fail('DIL_BINDING_HANDLER_REQUIRED', `${tag} requires an owned change handler when enabled.`)
  }
  if (tag === 'radio') {
    if (!has('name') || !has('value') || !has('checked')) fail('DIL_BINDING_FIELD_REQUIRED', 'radio requires source-provided name, value and checked.')
    boundedString(value('name'), 'radio.name', false, 200); bool(value('checked'), 'radio.checked')
    if (typeof value('value') !== 'string' && typeof value('value') !== 'number') fail('DIL_BINDING_VALUE_INVALID', 'radio.value must be text or a finite number.')
    if (value('disabled') !== true && !has('onChange')) fail('DIL_BINDING_HANDLER_REQUIRED', 'radio requires an owned change handler when enabled.')
  }
  if (tag === 'radio-group' || tag === 'select' || tag === 'segmented-control') {
    if (!has('name') || !has('value') || !has('options')) fail('DIL_BINDING_FIELD_REQUIRED', `${tag} requires source-provided name, value and options.`)
    boundedString(value('name'), `${tag}.name`, false, 200); options(value('options'), `${tag}.options`)
    if (typeof value('value') !== 'string' && typeof value('value') !== 'number') fail('DIL_BINDING_VALUE_INVALID', `${tag}.value must be text or a finite number.`)
    if (value('disabled') !== true && !has('onChange')) fail('DIL_BINDING_HANDLER_REQUIRED', `${tag} requires an owned change handler when enabled.`)
  }
  if (tag === 'slider') {
    if (!has('name') || !has('value') || !has('min') || !has('max')) fail('DIL_BINDING_FIELD_REQUIRED', 'slider requires source-provided name, value, min and max.')
    boundedString(value('name'), 'slider.name', false, 200)
    const min = finite(value('min'), 'slider.min'), max = finite(value('max'), 'slider.max'), current = finite(value('value'), 'slider.value')
    if (min > max || current < min || current > max) fail('DIL_BINDING_VALUE_INVALID', 'slider value must be inside its source-provided range.')
    if (has('step')) finite(value('step'), 'slider.step', 0.0001)
    if (value('disabled') !== true && !has('onChange') && !has('onInput')) fail('DIL_BINDING_HANDLER_REQUIRED', 'slider requires an owned update handler when enabled.')
  }
  if (tag === 'progress') {
    if (!has('value') || !has('max')) fail('DIL_BINDING_FIELD_REQUIRED', 'progress requires source-provided value and max.')
    const current = finite(value('value'), 'progress.value', 0), max = finite(value('max'), 'progress.max', 0.0001)
    if (current > max) fail('DIL_BINDING_VALUE_INVALID', 'progress.value exceeds progress.max.')
  }
  if (tag === 'image') {
    if (!has('src') || !has('alt')) fail('DIL_BINDING_FIELD_REQUIRED', 'image requires source-provided src and alt.')
    boundedString(value('src'), 'image.src', false, 512 * 1024); boundedString(value('alt'), 'image.alt', true, 2_000)
  }
  if (tag === 'link') {
    if (!has('href')) fail('DIL_BINDING_FIELD_REQUIRED', 'link requires source-provided href.')
    boundedString(value('href'), 'link.href', false, 2_048)
  }
  if (tag === 'tab') {
    if (!has('value') || !has('selected')) fail('DIL_BINDING_FIELD_REQUIRED', 'tab requires source-provided value and selected.')
    if (typeof value('value') !== 'string' && typeof value('value') !== 'number') fail('DIL_BINDING_VALUE_INVALID', 'tab.value must be text or a finite number.')
    bool(value('selected'), 'tab.selected')
    if (value('disabled') !== true && !has('onClick') && !has('onChange')) fail('DIL_BINDING_HANDLER_REQUIRED', 'An enabled tab requires an owned selection handler.')
  }
  if (tag === 'tab-panel') {
    if (!has('active')) fail('DIL_BINDING_FIELD_REQUIRED', 'tab-panel requires source-provided active state.')
    bool(value('active'), 'tab-panel.active')
  }
  if (tag === 'component') {
    if (!has('id') || !has('input')) fail('DIL_BINDING_FIELD_REQUIRED', 'component requires source-provided id and input.')
    validateDilExternalComponentId(value('id'), 'component.id')
    validateDilComponentInput(value('input'), 'component.input')
  }
  if (tag === 'chart' || tag === 'pie-chart') validateChartProps(tag, props)
}

function validateChartProps(tag: 'chart' | 'pie-chart', props: DilSafeProps): void {
  const data = chartData(props.data, `${tag}.data`)
  const categoryKey = boundedString(props.categoryKey, `${tag}.categoryKey`, false, 80)
  if (!data.every(row => Object.hasOwn(row, categoryKey))) fail('DIL_BINDING_CHART_INVALID', `${tag}.categoryKey must occur in every source row.`)
  if (tag === 'pie-chart') {
    const dataKey = boundedString(props.dataKey, 'pie-chart.dataKey', false, 80)
    if (!data.every(row => typeof row[dataKey] === 'number')) fail('DIL_BINDING_CHART_INVALID', 'pie-chart.dataKey must be numeric in every source row.')
    return
  }
  const hasDataKey = props.dataKey !== undefined, hasSeries = props.series !== undefined
  if (hasDataKey === hasSeries) fail('DIL_BINDING_CHART_INVALID', 'chart needs exactly one source dataKey or source series.')
  const keys = hasDataKey
    ? [boundedString(props.dataKey, 'chart.dataKey', false, 80)]
    : (() => {
        if (!Array.isArray(props.series) || props.series.length === 0 || props.series.length > 4) fail('DIL_BINDING_CHART_INVALID', 'chart.series must contain 1 to 4 entries.')
        const series = props.series.map((entry, index) => {
          const item = requiredRecord(entry, `chart.series[${String(index)}]`)
          exactKeys(item, ['dataKey', 'type'], `chart.series[${String(index)}]`)
          const dataKey = boundedString(item.dataKey, `chart.series[${String(index)}].dataKey`, false, 80)
          if (item.type !== 'line' && item.type !== 'bar') fail('DIL_BINDING_CHART_INVALID', 'chart.series type must be line or bar.')
          return { dataKey, type: item.type }
        })
        if (new Set(series.map(item => item.dataKey)).size !== series.length || new Set(series.map(item => item.type)).size !== 1) fail('DIL_BINDING_CHART_INVALID', 'chart.series must have unique keys and one chart type.')
        return series.map(item => item.dataKey)
      })()
  if (!data.every(row => keys.every(key => typeof row[key] === 'number'))) fail('DIL_BINDING_CHART_INVALID', 'Every requested chart field must be numeric in every source row.')
}

function boundProps(tag: DilIntrinsicTag, raw: unknown, authority: { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> }): DilSafeProps {
  if (raw === undefined) {
    if (tag === 'form' || tag === 'markdown') fail('DIL_BINDING_FIELD_REQUIRED', `${tag} requires explicit source props.`)
    return {}
  }
  const input = requiredRecord(raw, `${tag}.props`)
  const keys = Object.keys(input)
  if (keys.length > MAX_PROP_KEYS) fail('DIL_BINDING_PROPS_INVALID', `${tag}.props has too many fields.`)
  const allowed = DIL_ALLOWED_PROPS.get(tag)
  if (!allowed) fail('DIL_BINDING_TAG_UNKNOWN', `Unknown DIL tag: ${tag}.`)
  const output: Record<string, DilSafeProp> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) fail('DIL_BINDING_PROP_UNSUPPORTED', `${tag}.${key} is not a documented DIL prop.`)
    if (key.startsWith('on')) {
      if (!DIL_ALLOWED_HANDLERS.get(tag)?.has(key)) fail('DIL_BINDING_PROP_UNSUPPORTED', `${tag}.${key} is not a documented DIL handler.`)
      output[key] = handler(value, tag, key, authority.handlers)
    } else if (tag === 'component' && key === 'id') {
      output[key] = validateDilExternalComponentId(value, `${tag}.${key}`)
    } else if (tag === 'component' && key === 'input') {
      output[key] = validateDilComponentInput(value, `${tag}.${key}`)
    } else output[key] = cloneJson(value, `${tag}.${key}`)
  }
  const safe = output as DilSafeProps
  semanticProps(tag, safe, authority)
  return safe
}

function explicitNode(value: unknown, authority: { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> }, path: string): DilNode {
  const input = requiredRecord(value, path)
  exactKeys(input, ['kind', 'tag', 'props', 'text', 'children'], path)
  if (input.kind !== 'node') fail('DIL_BINDING_INPUT_INVALID', `${path}.kind must be node.`)
  const tag = input.tag
  if (typeof tag !== 'string' || !DIL_COMPONENT_CATALOG.some(entry => entry.tag === tag)) fail('DIL_BINDING_TAG_UNKNOWN', `${path}.tag is not a native DIL tag.`)
  const typedTag = tag as DilIntrinsicTag
  const props = boundProps(typedTag, input.props, authority)
  const text = input.text === undefined ? undefined : boundedString(input.text, `${path}.text`)
  if (input.children !== undefined && (!Array.isArray(input.children) || input.children.length > MAX_CHILDREN)) fail('DIL_BINDING_CHILDREN_INVALID', `${path}.children must be a bounded array.`)
  const children = (input.children ?? []).map((child, index) => explicitNode(child, authority, `${path}.children[${String(index)}]`))
  if (text !== undefined) children.push({ t: '#text', v: text })
  if (typedTag === 'markdown' && (children.length > 0 || typeof props.source !== 'string')) fail('DIL_BINDING_MARKDOWN_INVALID', 'markdown must use its exact source prop and no children.')
  if (typedTag === 'component' && children.length > 0) fail('DIL_BINDING_COMPONENT_CHILDREN_UNSUPPORTED', 'component must use its source-bound input prop and no children.')
  if (CONTENT_TAGS.has(typedTag) && children.length === 0 && !(typedTag === 'button' && typeof props.label === 'string') && !(typedTag === 'tab' && props.value !== undefined)) {
    fail('DIL_BINDING_CONTENT_REQUIRED', `${typedTag} requires source-provided content.`)
  }
  validateStructure(typedTag, children, path)
  return { t: typedTag, ...(Object.keys(props).length ? { p: props } : {}), ...(children.length ? { c: children } : {}) }
}

function validateStructure(tag: DilIntrinsicTag, children: readonly DilNode[], path: string): void {
  const tags = children.map(child => child.t)
  if (tag === 'table' && (tags.length === 0 || tags.some(child => child !== 'table-row'))) fail('DIL_BINDING_STRUCTURE_INVALID', `${path} table must contain source-bound table rows.`)
  if (tag === 'table-row' && (tags.length === 0 || tags.some(child => child !== 'table-cell'))) fail('DIL_BINDING_STRUCTURE_INVALID', `${path} table-row must contain source-bound table cells.`)
  if (tag === 'list' && (tags.length === 0 || tags.some(child => child !== 'list-item'))) fail('DIL_BINDING_STRUCTURE_INVALID', `${path} list must contain source-bound list items.`)
  if (tag === 'grid' && (tags.length === 0 || tags.some(child => child !== 'grid-item'))) fail('DIL_BINDING_STRUCTURE_INVALID', `${path} grid must contain source-bound grid items.`)
  if (tag === 'tabs' && (tags.length === 0 || tags.some(child => child !== 'tab' && child !== 'tab-panel'))) fail('DIL_BINDING_STRUCTURE_INVALID', `${path} tabs may contain only source-bound tabs and panels.`)
}

function textTree(tag: DilIntrinsicTag, source: Record<string, unknown>, authority: { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> }): DilNode {
  exactKeys(source, ['kind', 'value', 'props'], 'source')
  const props = boundProps(tag, source.props, authority)
  return { t: tag, ...(Object.keys(props).length ? { p: props } : {}), c: [{ t: '#text', v: boundedString(source.value, 'source.value') }] }
}

function markdownTree(source: Record<string, unknown>): DilNode {
  exactKeys(source, ['kind', 'source'], 'source')
  return { t: 'markdown', p: { source: boundedString(source.source, 'source.source') } }
}

function codeTree(source: Record<string, unknown>): DilNode {
  exactKeys(source, ['kind', 'value', 'language'], 'source')
  const props: DilSafeProps = source.language === undefined ? {} : { language: boundedString(source.language, 'source.language', false, 80) }
  return { t: 'code', ...(Object.keys(props).length ? { p: props } : {}), c: [{ t: '#text', v: boundedString(source.value, 'source.value') }] }
}

function tableTree(source: Record<string, unknown>): DilNode {
  exactKeys(source, ['kind', 'label', 'header', 'rows'], 'source')
  if (!Array.isArray(source.header) || source.header.length === 0 || source.header.length > MAX_RECORD_FIELDS) fail('DIL_BINDING_TABLE_INVALID', 'source.header must be a bounded nonempty array.')
  const header = source.header.map((cell, index) => boundedString(cell, `source.header[${String(index)}]`, true, 512))
  if (!Array.isArray(source.rows) || source.rows.length > MAX_CHART_ROWS) fail('DIL_BINDING_TABLE_INVALID', 'source.rows must be a bounded array.')
  const rows = source.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== header.length) fail('DIL_BINDING_TABLE_INVALID', `source.rows[${String(rowIndex)}] must match the source header width.`)
    return row.map((cell, cellIndex) => {
      if (typeof cell === 'string') return boundedString(cell, `source.rows[${String(rowIndex)}][${String(cellIndex)}]`, true, 512)
      if (typeof cell === 'number') return String(finite(cell, `source.rows[${String(rowIndex)}][${String(cellIndex)}]`))
      fail('DIL_BINDING_TABLE_INVALID', 'Table cells must be source strings or finite numbers.')
    })
  })
  const row = (cells: readonly string[], headerRow: boolean): DilNode => ({ t: 'table-row', c: cells.map(cell => ({ t: 'table-cell', ...(headerRow ? { p: { header: true } } : {}), c: [{ t: '#text', v: cell }] })) })
  return { t: 'table', ...(source.label === undefined ? {} : { p: { label: boundedString(source.label, 'source.label', true, 512) } }), c: [row(header, true), ...rows.map(cells => row(cells, false))] }
}

function listTree(source: Record<string, unknown>): DilNode {
  exactKeys(source, ['kind', 'ordered', 'items'], 'source')
  if (!Array.isArray(source.items) || source.items.length === 0 || source.items.length > MAX_CHILDREN) fail('DIL_BINDING_LIST_INVALID', 'source.items must be a nonempty bounded array.')
  const items = source.items.map((item, index) => boundedString(item, `source.items[${String(index)}]`))
  if (source.ordered !== undefined) bool(source.ordered, 'source.ordered')
  return { t: 'list', ...(source.ordered === undefined ? {} : { p: { ordered: source.ordered as boolean } }), c: items.map(item => ({ t: 'list-item', c: [{ t: '#text', v: item }] })) }
}

function chartTree(tag: 'chart' | 'pie-chart', source: Record<string, unknown>): DilNode {
  exactKeys(source, ['kind', 'data', 'categoryKey', 'dataKey', 'series', 'height', 'title'], 'source')
  const props: Record<string, DilSafeProp> = {
    data: chartData(source.data, 'source.data'),
    categoryKey: boundedString(source.categoryKey, 'source.categoryKey', false, 80),
  }
  if (source.dataKey !== undefined) props.dataKey = boundedString(source.dataKey, 'source.dataKey', false, 80)
  if (source.series !== undefined) props.series = cloneJson(source.series, 'source.series')
  if (source.height !== undefined) props.height = finite(source.height, 'source.height', 120, 480)
  if (source.title !== undefined) props.title = boundedString(source.title, 'source.title', true, 512)
  if (tag === 'pie-chart' && props.series !== undefined) fail('DIL_BINDING_CHART_INVALID', 'pie-chart does not support source series.')
  validateChartProps(tag, props)
  return { t: tag, p: props }
}

function parseInput(value: unknown): { componentId: DilComponentId, tag: DilIntrinsicTag, source: Record<string, unknown>, authority: { handlers: ReadonlySet<string>, formActions: ReadonlySet<string> } } {
  const input = requiredRecord(value, 'input')
  exactKeys(input, ['formatVersion', 'componentId', 'source', 'authority'], 'input')
  if (input.formatVersion !== DIL_COMPONENT_BINDING_FORMAT_VERSION) fail('DIL_BINDING_VERSION_UNSUPPORTED', 'Unsupported DIL component binding format.')
  const id = boundedString(input.componentId, 'input.componentId', false, 128)
  const definition = dilNativeComponentDefinitions.find(entry => entry.id === id)
  if (!definition) fail('DIL_BINDING_COMPONENT_UNKNOWN', 'The component id is not a native DIL component.')
  const source = requiredRecord(input.source, 'input.source')
  const kind = source.kind
  if (typeof kind !== 'string' || !definition.sourceKinds.includes(kind as DilSourceKind)) fail('DIL_BINDING_SOURCE_KIND_UNSUPPORTED', `${definition.id} cannot bind this source kind.`)
  return { componentId: definition.id, tag: definition.tag, source, authority: parseAuthority(input.authority) }
}

/**
 * Bind one existing native component to explicit source values. Callers should
 * pass `plan.tree` to the existing native DIL-tree consumer; this module never
 * invokes a compiler, a Worker, or a model.
 */
export function bindDilNativeComponent(value: unknown): DilComponentRenderPlan {
  const input = parseInput(value)
  let raw: DilNode
  switch (input.source.kind) {
    case 'text': raw = textTree(input.tag, input.source, input.authority); break
    case 'markdown': raw = markdownTree(input.source); break
    case 'code': raw = codeTree(input.source); break
    case 'table': raw = tableTree(input.source); break
    case 'list': raw = listTree(input.source); break
    case 'chart': raw = chartTree(input.tag === 'pie-chart' ? 'pie-chart' : 'chart', input.source); break
    case 'node': {
      raw = explicitNode(input.source, input.authority, 'source')
      if (raw.t !== input.tag) fail('DIL_BINDING_ROOT_TAG_MISMATCH', 'The explicit source tag must equal the selected component id.')
      break
    }
    default: fail('DIL_BINDING_SOURCE_KIND_UNSUPPORTED', 'Unsupported DIL source kind.')
  }
  const tree = validateDilTree(raw)
  const requiredHandlers = new Set<string>(), requiredActions = new Set<string>()
  const visit = (node: DilNode): void => {
    if (node.t === '#text') return
    if (node.t !== '#frag') {
      for (const [key, prop] of Object.entries(node.p ?? {})) {
        if (key.startsWith('on') && record(prop) && typeof prop.__dilFn === 'string') requiredHandlers.add(prop.__dilFn)
        if (node.t === 'form' && key === 'action' && typeof prop === 'string') requiredActions.add(prop)
      }
    }
    for (const child of node.c ?? []) visit(child)
  }
  visit(tree)
  return {
    formatVersion: DIL_COMPONENT_BINDING_FORMAT_VERSION,
    rendererKey: DIL_NATIVE_TREE_RENDERER_KEY,
    componentId: input.componentId,
    tag: input.tag,
    sourceKind: input.source.kind as DilSourceKind,
    tree,
    requiredHandlerIds: [...requiredHandlers].sort(),
    requiredFormActionIds: [...requiredActions].sort(),
  }
}

/** Non-throwing candidate predicate for an executable-component registry. */
export function assessDilNativeComponent(value: unknown): DilComponentEligibility {
  try { return { eligible: true, plan: bindDilNativeComponent(value) } }
  catch (error) {
    const code = error instanceof DilComponentBindingError
      ? error.code
      : error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'DIL_BINDING_INVALID'
    return { eligible: false, code }
  }
}

function interactionFor(tag: DilIntrinsicTag): DilNativeComponentDefinition['interaction'] {
  if (tag === 'form') return 'host-form-action'
  return CONTROL_TAGS.has(tag) || tag === 'button' || tag === 'table-row' ? 'local-handler' : 'none'
}

/** One executable definition per exact native tag, never a metadata-only family entry. */
export const dilNativeComponentDefinitions: readonly DilNativeComponentDefinition[] = DIL_COMPONENT_CATALOG.map(entry => {
  const tag = entry.tag as DilIntrinsicTag
  return Object.freeze({ id: componentId(tag), tag, sourceKinds: Object.freeze([...sourceKinds[tag]]), interaction: interactionFor(tag) })
})

export const dilNativeComponentById = new Map<DilComponentId, DilNativeComponentDefinition>(dilNativeComponentDefinitions.map(definition => [definition.id, definition]))
