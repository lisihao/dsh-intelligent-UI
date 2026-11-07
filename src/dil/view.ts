import { Fragment, createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { BarChart, IconWrapper, LineChart, PieChart } from '@openuidev/react-ui'

import { useCompositionSelection } from '../adaptive-ui/scope.js'
import { MarkdownCodeBlock } from '../markdown-code.js'
import { ThemeButton, ThemeCard, ThemeInput, ThemeToggle, themeComponentSet } from '../theme-components.js'
import { usePresentationTheme } from '../theme-runtime.js'
import type { CompiledDil } from './compiler.js'
import type { DilIntrinsicTag, DilJson } from './protocol.js'
import { validateDilComponentInput, validateDilExternalComponentId, validateDilTree } from './protocol.js'
import { createDilRunner } from './runtime.js'
import { DIL_ALLOWED_HANDLERS, DIL_ALLOWED_PROPS, supportedDILTags } from './catalog.js'

export type DilTextNode = Readonly<{ t: '#text', v: string }>
export type DilFragmentNode = Readonly<{ t: '#frag', c: readonly DilTreeNode[] }>
export type DilElementNode = Readonly<{ t: DilIntrinsicTag, p?: Readonly<Record<string, unknown>>, c?: readonly DilTreeNode[] }>
export type DilTreeNode = DilTextNode | DilFragmentNode | DilElementNode

export type DilSubmitInput = Readonly<{
  state: Readonly<Record<string, unknown>>
  fields: Readonly<Record<string, unknown>>
}>

export type DilFallbackContext = Readonly<{
  source: string
  compiled: CompiledDil
  reason?: string
}>

/**
 * Host-owned external component bridge. The callback owns exact catalog ID and
 * input-schema validation; it returns a named unavailable view for an unknown
 * foreign ID instead of asking DIL to guess a renderer.
 */
export type DilExternalComponentRenderer = (id: string, input: DilJson, onEvent?: (event: DilJson) => void) => ReactNode

export type DilProgramViewProps = Readonly<{
  source: string
  compiled: CompiledDil
  enabled: boolean
  artifactId: string
  sessionId: string
  frameUrl?: string
  initialState?: Readonly<Record<string, unknown>>
  onStateChange?: (state: Record<string, unknown>) => void
  onSubmit?: (action: string, input: DilSubmitInput) => void | Promise<void>
  /** Receives the validated native tree emitted by one local DIL run. */
  onSnapshot?: (tree: DilTreeNode) => void
  /** Receives real compilation, runtime, or renderer failures outside render. */
  onRuntimeFailure?: (reason: string) => void
  /** Host-owned Markdown renderer; the native view never imports presentation. */
  renderMarkdown?: (source: string) => ReactNode
  /** Host-owned external library bridge; DIL never resolves foreign components itself. */
  renderComponent?: DilExternalComponentRenderer
  renderFallback?: ReactNode | ((context: DilFallbackContext) => ReactNode)
}>

/** A direct, already-snapshot DIL handler port. It never reaches a Worker. */
export type DilNativeTreeHandlerPort = (handlerId: string, args: readonly unknown[]) => void | Promise<void>
export type DilNativeTreeSubmitInput = Readonly<{ fields: Readonly<Record<string, unknown>> }>
export type DilNativeTreeSubmitPort = (action: string, input: DilNativeTreeSubmitInput) => void | Promise<void>

/**
 * Native-tree entry point for trusted internal adapters.
 *
 * `tree` still crosses the same JSON/protocol boundary as a Worker snapshot:
 * it is first cloned by `validateDilTree`, then checked against the actual
 * native renderer by `assertNativeTree`. No compiler, sandbox, Worker, or
 * source-string evaluation is involved in this component.
 */
export type DilNativeTreeViewProps = Readonly<{
  tree: unknown
  artifactId: string
  sessionId: string
  ownedHandlerIds: readonly string[]
  ownedFormActionIds: readonly string[]
  onHandler?: DilNativeTreeHandlerPort
  onSubmit?: DilNativeTreeSubmitPort
  renderMarkdown?: (source: string) => ReactNode
  renderComponent?: DilExternalComponentRenderer
  /** Caller-owned readable source retained when the tree or its ports are invalid. */
  children?: ReactNode
}>

type DilRunner = ReturnType<typeof createDilRunner>
type Props = Readonly<Record<string, unknown>>
type ChartRow = Record<string, string | number>
type CartesianChartKind = 'line' | 'bar'
type CartesianChartSpec = Readonly<{ categoryKey: string, dataKeys: readonly string[], kind: CartesianChartKind }>
type DilComponentSet = ReturnType<typeof themeComponentSet>

const MAX_NATIVE_DEPTH = 48
const MAX_NATIVE_NODES = 512
const MAX_TEXT_LENGTH = 20_000
const MAX_IMAGE_DATA_URL_LENGTH = 512 * 1024
const SAFE_TONES = new Set(['default', 'muted', 'accent', 'success', 'warning', 'danger'])
const SAFE_ICON_NAMES = new Set(['alert-triangle', 'arrow-right', 'check', 'chevron-down', 'copy', 'database', 'file-text', 'info', 'link', 'minus', 'plus', 'search', 'settings', 'x'])
const NUMERIC_PROPS = new Set(['columns', 'span', 'rows', 'min', 'max', 'step', 'height', 'width', 'padding', 'gap'])
const BOOLEAN_PROPS = new Set(['hidden', 'wrap', 'disabled', 'required', 'checked', 'selected', 'active', 'header', 'ordered', 'showValue', 'tabularNums'])
const TEXT_SIZES = new Set(['xs', 'sm', 'md', 'lg'])
const TITLE_SIZES = new Set(['sm', 'md', 'lg', 'xl'])

class DilNativeViewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DilNativeViewError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stateRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new DilNativeViewError('DIL_STATE_INVALID', '运行器状态不是对象。')
  return { ...value }
}

function handlerId(value: unknown): string | undefined {
  if (!record(value) || typeof value.__dilFn !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(value.__dilFn)) return undefined
  return value.__dilFn
}

function finite(value: unknown, fallback: number, min = -10_000, max = 10_000): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : fallback
}

function boolean(value: unknown): boolean {
  return value === true
}

function safeLinkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function safeImageDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URL_LENGTH) return undefined
  return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value) ? value : undefined
}

function plainValue(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (depth > 6) return false
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => plainValue(item, depth + 1))
  if (!record(value) || Object.keys(value).length > 64) return false
  return Object.values(value).every(item => plainValue(item, depth + 1))
}

function validateOptionList(value: unknown): void {
  if (!Array.isArray(value) || value.length > 64) throw new DilNativeViewError('DIL_OPTIONS_INVALID', '选项必须是有限的 JSON 数组。')
  for (const option of value) {
    if (typeof option === 'string' || typeof option === 'number') continue
    if (!record(option) || typeof option.label !== 'string' || option.label.length > 512 || (typeof option.value !== 'string' && (typeof option.value !== 'number' || !Number.isFinite(option.value)))) {
      throw new DilNativeViewError('DIL_OPTION_INVALID', '选项必须具有文本标签和可原样回传的原始值。')
    }
  }
}

function validateChartData(value: unknown): asserts value is ChartRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new DilNativeViewError('DIL_CHART_DATA_INVALID', '图表数据必须是 1 至 100 行有限记录。')
  }
  for (const row of value) {
    if (!record(row)) throw new DilNativeViewError('DIL_CHART_DATA_INVALID', '图表数据行必须是记录。')
    const entries = Object.entries(row)
    if (entries.length === 0 || entries.length > 24 || entries.some(([key, cell]) => key.length === 0 || key.length > 80 || (typeof cell !== 'string' && (typeof cell !== 'number' || !Number.isFinite(cell))) || (typeof cell === 'string' && cell.length > 512))) {
      throw new DilNativeViewError('DIL_CHART_DATA_INVALID', '图表数据行只能包含有限的文本或数字字段。')
    }
  }
}

function validateProp(tag: string, key: string, value: unknown): void {
  const allowed = DIL_ALLOWED_PROPS.get(tag)
  if (!allowed?.has(key)) throw new DilNativeViewError('DIL_PROP_UNSUPPORTED', '组件 “' + tag + '” 不支持属性 “' + key + '”。')
  if (key.startsWith('on')) {
    if (!DIL_ALLOWED_HANDLERS.get(tag)?.has(key) || !handlerId(value)) throw new DilNativeViewError('DIL_HANDLER_INVALID', '组件 “' + tag + '” 的 “' + key + '” 必须是有效处理器引用。')
    return
  }
  if (key === 'href') {
    if (!safeLinkUrl(value)) throw new DilNativeViewError('DIL_URL_UNSAFE', '组件 “' + tag + '” 的链接 URL 不安全或不可用。')
    return
  }
  if (key === 'src') {
    if (!safeImageDataUrl(value)) throw new DilNativeViewError('DIL_IMAGE_UNSAFE', '组件 “' + tag + '” 的图片必须是受限 data: URL。')
    return
  }
  if (key === 'value') {
    if ((tag === 'slider' || tag === 'progress') && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 value 必须是有限数字。')
    }
    if (['input', 'textarea', 'radio', 'radio-group', 'select', 'segmented-control'].includes(tag) && (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 value 必须是字符串或有限数字。')
    }
  }
  if (tag === 'form' && key === 'action' && (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(value))) {
    throw new DilNativeViewError('DIL_ACTION_INVALID', 'form.action 必须是受限的提交标识。')
  }
  if (tag === 'markdown' && key === 'source' && typeof value !== 'string') {
    throw new DilNativeViewError('DIL_MARKDOWN_SOURCE_INVALID', 'markdown.source 必须是字符串。')
  }
  if (tag === 'component' && key === 'id') {
    try { validateDilExternalComponentId(value, 'component.id') }
    catch (error) { throw new DilNativeViewError('DIL_COMPONENT_ID_INVALID', error instanceof Error ? error.message : String(error)) }
    return
  }
  if (tag === 'component' && key === 'input') {
    try { validateDilComponentInput(value, 'component.input') }
    catch (error) { throw new DilNativeViewError('DIL_COMPONENT_INPUT_INVALID', error instanceof Error ? error.message : String(error)) }
    return
  }
  if (tag === 'button' && key === 'type' && value !== 'button' && value !== 'submit') {
    throw new DilNativeViewError('DIL_PROP_INVALID', 'button.type 仅支持 button 或 submit。')
  }
  if (key === 'options') return validateOptionList(value)
  if (key === 'data') return validateChartData(value)
  if (key === 'series') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 4 || !value.every(item => record(item) && Object.keys(item).length === 2 && Object.keys(item).every(entry => entry === 'dataKey' || entry === 'type') && typeof item.dataKey === 'string' && item.dataKey.length > 0 && item.dataKey.length <= 80 && (item.type === 'line' || item.type === 'bar'))) {
      throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', '图表序列必须是 1 至 4 个 { dataKey, type: "line" | "bar" } 记录。')
    }
    return
  }
  if (['categoryKey', 'dataKey'].includes(key) && (typeof value !== 'string' || value.length === 0 || value.length > 80)) {
    throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 “' + key + '” 必须是非空字段名。')
  }
  if (key === 'size') {
    if ((tag === 'icon' || tag === 'spacer') && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 size 必须是有限数字。')
    }
    if (tag === 'text' && (typeof value !== 'string' || !TEXT_SIZES.has(value))) {
      throw new DilNativeViewError('DIL_PROP_INVALID', 'text.size 仅支持 xs、sm、md 或 lg。')
    }
    if (tag === 'title' && (typeof value !== 'string' || !TITLE_SIZES.has(value))) {
      throw new DilNativeViewError('DIL_PROP_INVALID', 'title.size 仅支持 sm、md、lg 或 xl。')
    }
  }
  if (NUMERIC_PROPS.has(key) && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 “' + key + '” 必须是有限数字。')
  if (BOOLEAN_PROPS.has(key) && value !== undefined && typeof value !== 'boolean') throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 “' + key + '” 必须是布尔值。')
  if (['name', 'label', 'placeholder', 'type', 'variant', 'tone', 'align', 'justify', 'for', 'language', 'title', 'action', 'value'].includes(key) && value !== undefined && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 “' + key + '” 不是支持的原始值。')
  }
  if (!plainValue(value)) throw new DilNativeViewError('DIL_PROP_INVALID', '组件 “' + tag + '” 的 “' + key + '” 不是受限 JSON。')
}

function validateElementProps(tag: string, props: Props): void {
  if (tag === 'form') {
    if (props.action === undefined) throw new DilNativeViewError('DIL_ACTION_REQUIRED', 'form 必须声明 action。')
    if (props.onSubmit !== undefined) throw new DilNativeViewError('DIL_SUBMIT_HANDLER_UNSUPPORTED', 'form 不支持 onSubmit；提交由 host action 处理。')
  }
  if (tag === 'button' && props.type === 'submit' && props.onClick !== undefined) {
    throw new DilNativeViewError('DIL_SUBMIT_HANDLER_UNSUPPORTED', 'submit 按钮不支持 onClick；提交由 form action 处理。')
  }
  if (tag === 'markdown' && typeof props.source !== 'string') {
    throw new DilNativeViewError('DIL_MARKDOWN_SOURCE_INVALID', 'markdown 必须声明字符串 source。')
  }
  if (tag === 'component') {
    if (typeof props.id !== 'string' || !Object.hasOwn(props, 'input')) throw new DilNativeViewError('DIL_COMPONENT_REQUIRED', 'component 必须声明 id 与 input。')
    try {
      validateDilExternalComponentId(props.id, 'component.id')
      validateDilComponentInput(props.input, 'component.input')
    } catch (error) {
      throw new DilNativeViewError('DIL_COMPONENT_INVALID', error instanceof Error ? error.message : String(error))
    }
  }
}

function cartesianChartSpec(props: Props): CartesianChartSpec {
  const hasDataKey = props.dataKey !== undefined
  const hasSeries = props.series !== undefined
  if (hasDataKey === hasSeries) throw new DilNativeViewError('DIL_CHART_SELECTION_INVALID', 'chart 必须恰好声明 dataKey 或 series。')
  const categoryKey = text(props.categoryKey, 'label')
  if (hasDataKey) return { categoryKey, dataKeys: [text(props.dataKey)], kind: 'bar' }
  if (!Array.isArray(props.series) || props.series.length === 0) throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', 'chart.series 必须包含至少一个序列。')
  const first = props.series[0]
  if (!record(first) || (first.type !== 'line' && first.type !== 'bar')) throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', 'chart.series 必须声明 line 或 bar 类型。')
  const kind = first.type
  const dataKeys = props.series.map(item => {
    if (!record(item) || item.type !== kind || typeof item.dataKey !== 'string') {
      if (record(item) && (item.type === 'line' || item.type === 'bar')) throw new DilNativeViewError('DIL_CHART_MIXED_TYPE', 'chart.series 不可混用 line 与 bar。')
      throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', 'chart.series 包含无效序列。')
    }
    return item.dataKey
  })
  if (new Set(dataKeys).size !== dataKeys.length) throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', 'chart.series 不能重复 dataKey。')
  return { categoryKey, dataKeys, kind }
}

function pieChartDataKey(props: Props): string {
  if (props.dataKey === undefined) throw new DilNativeViewError('DIL_CHART_SELECTION_INVALID', 'pie-chart 必须声明 dataKey。')
  return text(props.dataKey)
}

function validateChartProps(tag: string, props: Props): void {
  const data = props.data
  validateChartData(data)
  const categoryKey = tag === 'pie-chart' ? text(props.categoryKey, 'label') : cartesianChartSpec(props).categoryKey
  if (!data.every(row => categoryKey in row)) throw new DilNativeViewError('DIL_CHART_CATEGORY_INVALID', '图表分类字段不在每一行数据中。')
  const requestedKeys = tag === 'pie-chart' ? [pieChartDataKey(props)] : cartesianChartSpec(props).dataKeys
  if (!requestedKeys.length || requestedKeys.some(key => !key || !data.every(row => typeof row[key] === 'number'))) {
    throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', '图表需要每行都有的数值序列。')
  }
}

function projectChartData(data: readonly ChartRow[], categoryKey: string, dataKeys: readonly string[]): ChartRow[] {
  return data.map(row => {
    const category = row[categoryKey]
    if (category === undefined) throw new DilNativeViewError('DIL_CHART_CATEGORY_INVALID', '图表分类字段不在每一行数据中。')
    const projected: ChartRow = { [categoryKey]: category }
    for (const dataKey of dataKeys) {
      const value = row[dataKey]
      if (typeof value !== 'number') throw new DilNativeViewError('DIL_CHART_SERIES_INVALID', '图表需要每行都有的数值序列。')
      projected[dataKey] = value
    }
    return projected
  })
}

function assertNativeTree(value: unknown): DilTreeNode {
  let count = 0
  const walk = (node: unknown, depth: number): DilTreeNode => {
    count++
    if (count > MAX_NATIVE_NODES) throw new DilNativeViewError('DIL_TREE_LIMIT', 'DIL 树节点超过本地显示上限。')
    if (depth > MAX_NATIVE_DEPTH || !record(node) || typeof node.t !== 'string') throw new DilNativeViewError('DIL_TREE_INVALID', 'DIL 树结构无效。')
    if (node.t === '#text') {
      if (typeof node.v !== 'string' || node.v.length > MAX_TEXT_LENGTH) throw new DilNativeViewError('DIL_TEXT_INVALID', 'DIL 文本无效。')
      return { t: '#text', v: node.v }
    }
    const children = node.c === undefined ? [] : node.c
    if (!Array.isArray(children)) throw new DilNativeViewError('DIL_CHILDREN_INVALID', 'DIL 子节点必须是数组。')
    if (node.t === '#frag') return { t: '#frag', c: children.map(child => walk(child, depth + 1)) }
    if (!supportedDILTags.has(node.t)) throw new DilNativeViewError('DIL_TAG_UNSUPPORTED', '不支持 DIL 组件 “' + node.t + '”。')
    const props = node.p === undefined ? {} : node.p
    if (!record(props)) throw new DilNativeViewError('DIL_PROPS_INVALID', '组件 “' + node.t + '” 的属性无效。')
    for (const [key, prop] of Object.entries(props)) validateProp(node.t, key, prop)
    validateElementProps(node.t, props)
    if (node.t === 'markdown' && children.length) throw new DilNativeViewError('DIL_MARKDOWN_CHILDREN_UNSUPPORTED', 'markdown 不能包含子节点。')
    if (node.t === 'component' && children.length) throw new DilNativeViewError('DIL_COMPONENT_CHILDREN_UNSUPPORTED', 'component 不能包含子节点。')
    if (node.t === 'chart' || node.t === 'pie-chart') validateChartProps(node.t, props)
    return { t: node.t as DilIntrinsicTag, p: { ...props }, c: children.map(child => walk(child, depth + 1)) }
  }
  return walk(value, 0)
}

function treeUsesMarkdown(node: DilTreeNode | undefined): boolean {
  if (!node) return false
  if (node.t === '#text') return false
  if (node.t === 'markdown') return true
  return (node.c ?? []).some(child => treeUsesMarkdown(child))
}

function treeUsesExternalComponent(node: DilTreeNode | undefined): boolean {
  if (!node) return false
  if (node.t === '#text') return false
  if (node.t === 'component') return true
  return (node.c ?? []).some(child => treeUsesExternalComponent(child))
}

function childText(nodes: readonly DilTreeNode[] | undefined): string {
  return (nodes ?? []).map(node => node.t === '#text' ? node.v : childText(node.c)).join('')
}

function normalizedOptions(value: unknown): Array<{ label: string, value: string | number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap(option => {
    if (typeof option === 'string' || typeof option === 'number') return [{ label: String(option), value: option }]
    return record(option) && typeof option.label === 'string' && (typeof option.value === 'string' || typeof option.value === 'number')
      ? [{ label: option.label, value: option.value }]
      : []
  })
}

function inputValue(event: { currentTarget: HTMLInputElement }): string | number {
  const { currentTarget } = event
  return currentTarget.type === 'number' && Number.isFinite(currentTarget.valueAsNumber) ? currentTarget.valueAsNumber : currentTarget.value
}

function fieldsFrom(form: HTMLFormElement): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const element of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[name], textarea[name], select[name]')) {
    if (element.disabled || !element.name) continue
    if (element instanceof HTMLInputElement && element.type === 'radio' && !element.checked) continue
    const value = element instanceof HTMLInputElement && element.type === 'checkbox'
      ? element.checked
      : element instanceof HTMLInputElement && element.type === 'number' && Number.isFinite(element.valueAsNumber)
        ? element.valueAsNumber
        : element.value
    const previous = fields[element.name]
    fields[element.name] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value]
  }
  return fields
}

function fallbackMarkdown(compiled: CompiledDil, source: string): string {
  const candidate = (compiled as unknown as { fallbackMarkdown?: unknown }).fallbackMarkdown
  return typeof candidate === 'string' && candidate.trim() ? candidate : source
}

function compilerDiagnosticText(compiled: CompiledDil): string | undefined {
  if (!compiled.diagnostics.length) return undefined
  const details = compiled.diagnostics.map(item => JSON.stringify(item)).join('\n')
  return [compiled.diagnosticSummary, details].filter(part => part.length > 0).join('\n') || undefined
}

function fallbackView(source: string, compiled: CompiledDil, reason: string | undefined, renderFallback: DilProgramViewProps['renderFallback']): ReactNode {
  const context = { source, compiled, ...(reason ? { reason } : {}) }
  if (typeof renderFallback === 'function') return renderFallback(context)
  if (renderFallback !== undefined) return renderFallback
  return h('section', { className: 'iexp-dil-fallback', 'data-dil-fallback': true },
    reason && h('p', { role: 'alert' }, 'DIL 原生视图不可用：' + reason),
    h('details', { open: true }, h('summary', null, '查看可读原始内容'), h('pre', null, fallbackMarkdown(compiled, source))),
    h('details', { open: true }, h('summary', null, '查看完整 DIL 源码'), h('pre', null, source)),
  )
}

type RenderContext = Readonly<{
  componentSet: DilComponentSet
  trigger: (handler: unknown, args: readonly unknown[]) => void
  submit: (action: unknown, form: HTMLFormElement) => void
  reportFailure?: (error: unknown) => void
  renderMarkdown?: (source: string) => ReactNode
  renderComponent?: DilExternalComponentRenderer
}>

function tone(props: Props): string | undefined {
  const candidate = text(props.tone)
  return SAFE_TONES.has(candidate) ? candidate : undefined
}

function spacing(value: unknown, fallback = 0): CSSProperties {
  const unit = finite(value, fallback, 0, 8)
  return unit ? { gap: 'calc(' + String(unit) + ' * 4px)' } : {}
}

function layoutStyle(props: Props): CSSProperties {
  const align = text(props.align)
  const justify = text(props.justify)
  const style: CSSProperties = {
    ...spacing(props.gap),
    ...(props.padding === undefined ? {} : { padding: 'calc(' + String(finite(props.padding, 0, 0, 8)) + ' * 4px)' }),
  }
  if (['start', 'center', 'end', 'stretch', 'baseline'].includes(align)) style.alignItems = align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : align
  if (['start', 'center', 'end', 'between', 'around', 'evenly'].includes(justify)) style.justifyContent = justify === 'start' ? 'flex-start' : justify === 'end' ? 'flex-end' : justify === 'between' ? 'space-between' : justify === 'around' ? 'space-around' : justify === 'evenly' ? 'space-evenly' : justify
  if (boolean(props.wrap)) style.flexWrap = 'wrap'
  return style
}

function textStyle(props: Props): CSSProperties {
  const weight = text(props.weight)
  const align = text(props.align)
  return {
    ...(weight === 'medium' ? { fontWeight: 500 } : weight === 'semibold' ? { fontWeight: 600 } : weight === 'bold' ? { fontWeight: 700 } : {}),
    ...(align === 'start' ? { textAlign: 'start' } : align === 'center' ? { textAlign: 'center' } : align === 'end' ? { textAlign: 'end' } : {}),
    ...(boolean(props.tabularNums) ? { fontVariantNumeric: 'tabular-nums' } : {}),
  }
}

function renderedChildren(node: DilElementNode, context: RenderContext, key: string): ReactNode[] {
  return (node.c ?? []).map((child, index) => renderNode(child, context, key + '-' + String(index)))
}

function buttonProps(props: Props, context: RenderContext) {
  const handler = props.onClick
  return {
    type: props.type === 'submit' ? 'submit' as const : 'button' as const,
    disabled: boolean(props.disabled),
    onClick: () => context.trigger(handler, []),
  }
}

function renderChart(node: DilElementNode, key: string, context: RenderContext, pie = false): ReactElement {
  const props = node.p ?? {}
  const data = Array.isArray(props.data) ? props.data as ChartRow[] : []
  const height = finite(props.height, 220, 120, 480)
  const chart = pie
    ? (() => {
        const categoryKey = text(props.categoryKey, 'label')
        const dataKey = pieChartDataKey(props)
        return h(PieChart, { data: projectChartData(data, categoryKey, [dataKey]), categoryKey, dataKey, height, width: '100%', variant: 'donut', legend: true, isAnimationActive: false } as never)
      })()
    : (() => {
        const spec = cartesianChartSpec(props)
        const projected = projectChartData(data, spec.categoryKey, spec.dataKeys)
        return spec.kind === 'line'
          ? h(LineChart, { data: projected, categoryKey: spec.categoryKey, height, width: '100%', grid: true, legend: spec.dataKeys.length > 1, showDots: projected.length <= 40, isAnimationActive: false } as never)
          : h(BarChart, { data: projected, categoryKey: spec.categoryKey, height, width: '100%', grid: true, legend: spec.dataKeys.length > 1, orientation: 'horizontal', isAnimationActive: false } as never)
      })()
  return h(ThemeCard, { key, componentSet: context.componentSet, as: 'figure', renderRole: 'chart', className: 'iexp-dil-chart', hidden: boolean(props.hidden) || undefined, 'data-dil-tag': node.t },
    text(props.title) && h('figcaption', null, text(props.title)),
    h('div', { className: 'iexp-dil-chart-plot' }, chart))
}

function renderNode(node: DilTreeNode, context: RenderContext, key: string): ReactNode {
  if (node.t === '#text') return node.v
  if (node.t === '#frag') return h(Fragment, { key }, ...(node.c ?? []).map((child, index) => renderNode(child, context, key + '-' + String(index))))
  const props = node.p ?? {}
  const children = renderedChildren(node, context, key)
  const common = { key, 'data-dil-tag': node.t, hidden: boolean(props.hidden) || undefined }
  const inline = layoutStyle(props)

  switch (node.t) {
    case 'box':
    case 'column':
    case 'row':
      return h('div', { ...common, className: 'iexp-dil-box iexp-dil-' + node.t, style: inline }, ...children)
    case 'grid':
      return h('div', { ...common, className: 'iexp-dil-grid', style: { ...spacing(props.gap, 3), '--iexp-dil-columns': String(finite(props.columns, 2, 1, 6)) } as CSSProperties }, ...children)
    case 'grid-item':
      return h('div', { ...common, className: 'iexp-dil-grid-item', style: { gridColumn: 'span ' + String(finite(props.span, 1, 1, 6)) } }, ...children)
    case 'card':
      return h(ThemeCard, { ...common, componentSet: context.componentSet, as: 'article', renderRole: 'content', className: 'iexp-dil-card', style: inline }, text(props.title) && h('h3', null, text(props.title)), ...children)
    case 'divider':
      return h('hr', { ...common, className: 'iexp-dil-divider' })
    case 'spacer':
      return h('div', { ...common, className: 'iexp-dil-spacer', style: { blockSize: 'calc(' + String(finite(props.size, 2, 0, 8)) + ' * 4px)' } })
    case 'text':
      return h('p', { ...common, className: 'iexp-dil-text is-' + text(props.size, 'md') + (tone(props) ? ' is-' + tone(props) : ''), style: textStyle(props) }, ...children)
    case 'title': {
      const level = Math.round(finite(props.level, 2, 1, 4))
      return h('h' + String(level), { ...common, className: 'iexp-dil-title is-' + text(props.size, 'md') + (tone(props) ? ' is-' + tone(props) : ''), style: textStyle(props) }, ...children)
    }
    case 'caption':
      return h('span', { ...common, className: 'iexp-dil-caption' + (tone(props) ? ' is-' + tone(props) : ''), style: textStyle(props) }, ...children)
    case 'bold':
      return h('strong', common, ...children)
    case 'label':
      return h('label', common, ...children)
    case 'code':
      return h('div', { ...common, className: 'iexp-dil-code' }, h(MarkdownCodeBlock, { code: childText(node.c), language: text(props.language) || undefined }))
    case 'markdown': {
      const markdownSource = props.source
      if (typeof markdownSource !== 'string' || !context.renderMarkdown) {
        return h('section', { ...common, className: 'iexp-dil-fallback' },
          h('p', { role: 'alert' }, 'DIL Markdown 组件不可用：宿主没有 Markdown 渲染器。'),
          typeof markdownSource === 'string' && h('pre', null, markdownSource))
      }
      return h('section', { ...common, className: 'iexp-dil-markdown' }, context.renderMarkdown(markdownSource))
    }
    case 'component': {
      const renderer = context.renderComponent
      if (typeof props.id !== 'string' || !Object.hasOwn(props, 'input') || !renderer) {
        return h('section', { ...common, className: 'iexp-dil-fallback' }, h('p', { role: 'alert' }, 'DIL 外部组件不可用：宿主没有已授权的组件渲染器。'))
      }
      let id: string, input: DilJson
      try {
        id = validateDilExternalComponentId(props.id, 'component.id')
        input = validateDilComponentInput(props.input, 'component.input')
      } catch (error) {
        return h('section', { ...common, className: 'iexp-dil-fallback' }, h('p', { role: 'alert' }, 'DIL 外部组件不可用：' + (error instanceof Error ? error.message : String(error))))
      }
      const onChange = props.onChange
      const onEvent = onChange === undefined
        ? undefined
        : (event: DilJson) => {
            // Component events can only enter the existing local DIL handler
            // route. They never invoke a host action or a model directly.
            try { context.trigger(onChange, [validateDilComponentInput(event, 'component.event')]) }
            catch (error) { context.reportFailure?.(error) }
          }
      try {
        return h('section', { ...common, className: 'iexp-dil-component' }, renderer(id, input, onEvent))
      } catch (error) {
        return h('section', { ...common, className: 'iexp-dil-fallback' }, h('p', { role: 'alert' }, 'DIL 外部组件不可用：' + (error instanceof Error ? error.message : String(error))))
      }
    }
    case 'icon': {
      const name = text(props.name)
      return SAFE_ICON_NAMES.has(name)
        ? h('span', { ...common, className: 'iexp-dil-icon' + (tone(props) ? ' is-' + tone(props) : ''), 'aria-label': text(props.label) || undefined }, h(IconWrapper, { name: name as never, size: finite(props.size, 16, 12, 24) }))
        : h('span', { ...common, className: 'iexp-dil-diagnostic', role: 'note' }, '不支持的图标')
    }
    case 'badge':
      return h('span', { ...common, className: 'iexp-dil-badge' + (tone(props) ? ' is-' + tone(props) : '') }, ...children)
    case 'button':
      return h(ThemeButton, { ...common, componentSet: context.componentSet, ...buttonProps(props, context), className: 'iexp-dil-button' + (text(props.variant) ? ' is-' + text(props.variant) : '') }, children.length ? children : text(props.label))
    case 'input':
      return h(ThemeInput, {
        ...common, componentSet: context.componentSet, className: 'iexp-dil-input', name: text(props.name) || undefined,
        type: ['text', 'number', 'email', 'search', 'date', 'time'].includes(text(props.type, 'text')) ? text(props.type, 'text') : 'text',
        value: props.value === undefined ? '' : String(props.value),
        placeholder: text(props.placeholder), disabled: boolean(props.disabled), required: boolean(props.required),
        onChange: (event: { currentTarget: HTMLInputElement }) => context.trigger(props.onChange, [inputValue(event)]),
        onInput: (event: { currentTarget: HTMLInputElement }) => context.trigger(props.onInput, [inputValue(event)]),
        onBlur: () => context.trigger(props.onBlur, []),
      })
    case 'textarea':
      return h('textarea', {
        ...common, className: 'iexp-dil-textarea', name: text(props.name) || undefined, value: props.value === undefined ? '' : String(props.value),
        placeholder: text(props.placeholder), rows: finite(props.rows, 3, 1, 12), disabled: boolean(props.disabled), required: boolean(props.required),
        onChange: (event: { currentTarget: HTMLTextAreaElement }) => context.trigger(props.onChange, [event.currentTarget.value]),
        onInput: (event: { currentTarget: HTMLTextAreaElement }) => context.trigger(props.onInput, [event.currentTarget.value]),
        onBlur: () => context.trigger(props.onBlur, []),
      })
    case 'checkbox':
    case 'switch':
      return h('label', { ...common, className: 'iexp-dil-toggle-row is-' + node.t },
        h(ThemeToggle, { componentSet: context.componentSet, name: text(props.name) || undefined, checked: boolean(props.checked), disabled: boolean(props.disabled), onChange: (event: { currentTarget: HTMLInputElement }) => context.trigger(props.onChange, [event.currentTarget.checked]) }),
        ...children)
    case 'radio':
      return h('label', { ...common, className: 'iexp-dil-radio' },
        h(ThemeInput, { componentSet: context.componentSet, type: 'radio', name: text(props.name) || undefined, value: String(props.value ?? ''), checked: boolean(props.checked), disabled: boolean(props.disabled), onChange: (event: { currentTarget: HTMLInputElement }) => { if (event.currentTarget.checked) context.trigger(props.onChange, [props.value]) } }),
        ...children)
    case 'radio-group': {
      const options = normalizedOptions(props.options)
      return h('fieldset', { ...common, className: 'iexp-dil-radio-group', disabled: boolean(props.disabled) },
        ...options.map(option => h('label', { key: String(option.value), className: 'iexp-dil-radio' },
          h(ThemeInput, { componentSet: context.componentSet, type: 'radio', name: text(props.name) || undefined, value: String(option.value), checked: Object.is(props.value, option.value), onChange: (event: { currentTarget: HTMLInputElement }) => { if (event.currentTarget.checked) context.trigger(props.onChange, [option.value]) } }),
          option.label)),
        ...children)
    }
    case 'select': {
      const options = normalizedOptions(props.options)
      return h('select', {
        ...common, className: 'iexp-dil-select', name: text(props.name) || undefined, value: String(props.value ?? ''), disabled: boolean(props.disabled), required: boolean(props.required),
        onChange: (event: { currentTarget: HTMLSelectElement }) => context.trigger(props.onChange, [options.find(option => String(option.value) === event.currentTarget.value)?.value ?? event.currentTarget.value]),
      }, ...options.map(option => h('option', { key: String(option.value), value: String(option.value) }, option.label)))
    }
    case 'slider':
      return h(ThemeInput, {
        ...common, componentSet: context.componentSet, className: 'iexp-dil-slider', type: 'range', name: text(props.name) || undefined,
        min: finite(props.min, 0, -10_000, 10_000), max: finite(props.max, 100, -10_000, 10_000), step: finite(props.step, 1, 0.0001, 10_000), value: finite(props.value, finite(props.min, 0), -10_000, 10_000),
        disabled: boolean(props.disabled),
        onChange: (event: { currentTarget: HTMLInputElement }) => context.trigger(props.onChange, [Number(event.currentTarget.value)]),
        onInput: (event: { currentTarget: HTMLInputElement }) => context.trigger(props.onInput, [Number(event.currentTarget.value)]),
      })
    case 'segmented-control': {
      const options = normalizedOptions(props.options)
      return h('div', { ...common, className: 'iexp-dil-segmented', role: 'group' },
        ...options.map(option => h(ThemeButton, { key: String(option.value), componentSet: context.componentSet, type: 'button', disabled: boolean(props.disabled), 'aria-pressed': Object.is(props.value, option.value), onClick: () => context.trigger(props.onChange, [option.value]) }, option.label)))
    }
    case 'table':
      return h('div', { ...common, className: 'iexp-dil-table-wrap', 'aria-label': text(props.label) || undefined }, h('table', { className: 'iexp-dil-table' }, h('tbody', null, ...children)))
    case 'table-row':
      return h('tr', { ...common, className: 'iexp-dil-table-row', onClick: () => context.trigger(props.onClick, []) }, ...children)
    case 'table-cell':
      return boolean(props.header)
        ? h('th', { ...common, scope: 'col', className: 'iexp-dil-table-cell', style: { textAlign: props.align === 'end' ? 'end' : undefined } }, ...children)
        : h('td', { ...common, className: 'iexp-dil-table-cell', style: { textAlign: props.align === 'end' ? 'end' : undefined } }, ...children)
    case 'list':
      return boolean(props.ordered) ? h('ol', { ...common, className: 'iexp-dil-list' }, ...children) : h('ul', { ...common, className: 'iexp-dil-list' }, ...children)
    case 'list-item':
      return h('li', { ...common, className: 'iexp-dil-list-item' }, ...children)
    case 'progress': {
      const max = finite(props.max, 100, 1, 10_000)
      const value = Math.min(max, Math.max(0, finite(props.value, 0, 0, max)))
      return h('div', { ...common, className: 'iexp-dil-progress' },
        text(props.label) && h('span', null, text(props.label)),
        h('progress', { value, max, 'aria-label': text(props.label) || undefined }),
        boolean(props.showValue) && h('output', null, String(Math.round(value / max * 100)) + '%'))
    }
    case 'chart':
      return renderChart(node, key, context)
    case 'pie-chart':
      return renderChart(node, key, context, true)
    case 'image':
      return h('img', { ...common, className: 'iexp-dil-image', src: safeImageDataUrl(props.src), alt: text(props.alt), width: finite(props.width, 0, 0, 2_000) || undefined, height: finite(props.height, 0, 0, 2_000) || undefined })
    case 'link':
      return h('a', { ...common, className: 'iexp-dil-link', href: safeLinkUrl(props.href), target: '_blank', rel: 'noreferrer noopener' }, children.length ? children : text(props.label))
    case 'form':
      return h('form', {
        ...common, className: 'iexp-dil-form',
        onSubmit: (event: { preventDefault(): void, currentTarget: HTMLFormElement }) => {
          event.preventDefault()
          context.submit(props.action, event.currentTarget)
        },
      }, ...children)
    case 'tabs':
      return h('div', { ...common, className: 'iexp-dil-tabs', role: 'tablist' }, ...children)
    case 'tab':
      return h(ThemeButton, { ...common, componentSet: context.componentSet, type: 'button', role: 'tab', disabled: boolean(props.disabled), 'aria-selected': boolean(props.selected), onClick: () => context.trigger(props.onChange ?? props.onClick, [props.value]) }, ...children)
    case 'tab-panel':
      return h('section', { ...common, className: 'iexp-dil-tab-panel', role: 'tabpanel', hidden: props.active === false || boolean(props.hidden) || undefined }, ...children)
    default:
      return null
  }
}

type NativeTreePorts = Readonly<{
  handlers: ReadonlySet<string>
  formActions: ReadonlySet<string>
  requiresHandlerPort: boolean
  requiresSubmitPort: boolean
}>

function ownedIds(value: unknown, label: string, pattern: RegExp): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length > 128) throw new DilNativeViewError('DIL_NATIVE_TREE_PORTS_INVALID', `${label} 必须是有限数组。`)
  const ids = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item) || ids.has(item)) {
      throw new DilNativeViewError('DIL_NATIVE_TREE_PORTS_INVALID', `${label} 包含无效或重复标识。`)
    }
    ids.add(item)
  }
  return ids
}

function nativeTreePorts(tree: DilTreeNode, ownedHandlerIds: unknown, ownedFormActionIds: unknown, onHandler: unknown, onSubmit: unknown): NativeTreePorts {
  const handlers = ownedIds(ownedHandlerIds, 'ownedHandlerIds', /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u)
  const formActions = ownedIds(ownedFormActionIds, 'ownedFormActionIds', /^[A-Za-z0-9_.:-]{1,200}$/u)
  let requiresHandlerPort = false
  let requiresSubmitPort = false
  const visit = (node: DilTreeNode): void => {
    if (node.t === '#text') return
    if (node.t !== '#frag') {
      const props = node.p ?? {}
      for (const [key, value] of Object.entries(props)) {
        if (!key.startsWith('on')) continue
        const id = handlerId(value)
        if (!id || !handlers.has(id)) throw new DilNativeViewError('DIL_NATIVE_TREE_HANDLER_NOT_OWNED', `DIL 处理器 “${id ?? 'unknown'}” 未被当前视图授权。`)
        requiresHandlerPort = true
      }
      if (node.t === 'form') {
        const action = text(props.action)
        if (!action || !formActions.has(action)) throw new DilNativeViewError('DIL_NATIVE_TREE_ACTION_NOT_OWNED', `form.action “${action || 'unknown'}” 未被当前视图授权。`)
        requiresSubmitPort = true
      }
    }
    for (const child of node.c ?? []) visit(child)
  }
  visit(tree)
  if (requiresHandlerPort && typeof onHandler !== 'function') throw new DilNativeViewError('DIL_NATIVE_TREE_HANDLER_PORT_UNAVAILABLE', 'DIL 树包含事件处理器，但当前没有已授权的 onHandler 端口。')
  if (requiresSubmitPort && typeof onSubmit !== 'function') throw new DilNativeViewError('DIL_NATIVE_TREE_SUBMIT_PORT_UNAVAILABLE', 'DIL 树包含 form 提交，但当前没有已授权的 onSubmit 端口。')
  return { handlers, formActions, requiresHandlerPort, requiresSubmitPort }
}

function nativeTreeFallback(children: ReactNode, reason: string): ReactElement {
  return h('div', { className: 'iexp-dil-fallback', 'data-dil-fallback': true },
    h('p', { role: 'alert' }, 'DIL 原生树不可用：' + reason),
    children === undefined ? h('p', null, '原始内容不可用。') : children,
  )
}

/**
 * Render a source-bound native DIL tree without running a DIL program.
 *
 * A tree update is validated in the local React render path and immediately
 * replaces the prior tree. All ports are checked before the tree mounts, and
 * neither handler nor form port is invoked until a DOM event actually occurs.
 */
export function DilNativeTreeView({ tree: rawTree, artifactId, sessionId, ownedHandlerIds, ownedFormActionIds, onHandler, onSubmit, renderMarkdown, renderComponent, children }: DilNativeTreeViewProps): ReactElement {
  const composition = useCompositionSelection()
  const theme = usePresentationTheme()
  const componentSet = composition?.componentSet ?? themeComponentSet(theme)
  const [eventFailure, setEventFailure] = useState<Readonly<{ tree: unknown, message: string }>>()
  const submitting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  let tree: DilTreeNode | undefined
  let ports: NativeTreePorts | undefined
  let validationFailure: string | undefined
  try {
    const protocolTree = validateDilTree(rawTree) as DilTreeNode
    const nativeTree = assertNativeTree(protocolTree)
    if (treeUsesMarkdown(nativeTree) && !renderMarkdown) throw new DilNativeViewError('DIL_MARKDOWN_RENDERER_UNAVAILABLE', 'DIL Markdown 组件需要宿主 Markdown 渲染器。')
    if (treeUsesExternalComponent(nativeTree) && !renderComponent) throw new DilNativeViewError('DIL_COMPONENT_RENDERER_UNAVAILABLE', 'DIL 外部组件需要宿主组件渲染器。')
    ports = nativeTreePorts(nativeTree, ownedHandlerIds, ownedFormActionIds, onHandler, onSubmit)
    tree = nativeTree
  } catch (error) {
    validationFailure = error instanceof Error ? error.message : String(error)
  }
  const runtimeFailure = eventFailure !== undefined && eventFailure.tree === rawTree ? eventFailure.message : undefined
  const failure = validationFailure ?? runtimeFailure
  const failForCurrentTree = (error: unknown): void => {
    if (mounted.current) setEventFailure({ tree: rawTree, message: error instanceof Error ? error.message : String(error) })
  }
  const context: RenderContext = {
    componentSet,
    renderMarkdown,
    renderComponent,
    reportFailure: failForCurrentTree,
    trigger(handler, args) {
      // Native renderers attach DOM listeners for supported event slots even
      // when a particular source tree omits that optional handler. Omission is
      // inert; an explicit but unowned handler is a visible failure.
      if (handler === undefined) return
      const id = handlerId(handler)
      if (!id || !ports?.handlers.has(id)) {
        failForCurrentTree(new DilNativeViewError('DIL_NATIVE_TREE_HANDLER_NOT_OWNED', 'DIL 处理器未被当前视图授权。'))
        return
      }
      const port = onHandler
      if (!port) {
        failForCurrentTree(new DilNativeViewError('DIL_NATIVE_TREE_HANDLER_PORT_UNAVAILABLE', '当前没有已授权的 onHandler 端口。'))
        return
      }
      try {
        void Promise.resolve(port(id, [...args])).catch(failForCurrentTree)
      } catch (error) { failForCurrentTree(error) }
    },
    submit(actionValue, form) {
      const action = text(actionValue)
      if (!action || !ports?.formActions.has(action)) {
        failForCurrentTree(new DilNativeViewError('DIL_NATIVE_TREE_ACTION_NOT_OWNED', 'form.action 未被当前视图授权。'))
        return
      }
      const port = onSubmit
      if (!port) {
        failForCurrentTree(new DilNativeViewError('DIL_NATIVE_TREE_SUBMIT_PORT_UNAVAILABLE', '当前没有已授权的 onSubmit 端口。'))
        return
      }
      if (submitting.current) return
      submitting.current = true
      try {
        const fields = fieldsFrom(form)
        void Promise.resolve(port(action, { fields })).catch(failForCurrentTree).finally(() => { submitting.current = false })
      } catch (error) {
        submitting.current = false
        failForCurrentTree(error)
      }
    },
  }

  return h('section', { className: 'dsh-experience iexp-dil', 'data-dil-enabled': 'true', 'data-dil-artifact-id': artifactId, 'data-dil-session-id': sessionId },
    failure
      ? nativeTreeFallback(children, failure)
      : tree
        ? h('div', { className: 'iexp-dil-native-tree', 'data-dil-native-tree': true }, renderNode(tree, context, 'root'))
        : nativeTreeFallback(children, '没有可用的 DIL 原生树。'))
}

export function DilProgramView({ source, compiled, enabled, artifactId, sessionId, frameUrl, initialState = {}, onStateChange, onSubmit, onSnapshot, onRuntimeFailure, renderMarkdown, renderComponent, renderFallback }: DilProgramViewProps): ReactElement {
  const composition = useCompositionSelection()
  const theme = usePresentationTheme()
  const componentSet = composition?.componentSet ?? themeComponentSet(theme)
  const sandboxHost = useRef<HTMLDivElement>(null)
  const runner = useRef<DilRunner>()
  const runnerReady = useRef<DilRunner>()
  const startedWith = useRef<CompiledDil>()
  const latestCompiled = useRef(compiled)
  const stateRef = useRef<Record<string, unknown>>({ ...initialState })
  const onStateChangeRef = useRef(onStateChange)
  const onSubmitRef = useRef(onSubmit)
  const onSnapshotRef = useRef(onSnapshot)
  const onRuntimeFailureRef = useRef(onRuntimeFailure)
  const reportedFailureRef = useRef<string>()
  const renderMarkdownRef = useRef(renderMarkdown)
  const renderComponentRef = useRef(renderComponent)
  const submitInFlight = useRef(false)
  onStateChangeRef.current = onStateChange
  onSubmitRef.current = onSubmit
  onSnapshotRef.current = onSnapshot
  onRuntimeFailureRef.current = onRuntimeFailure
  renderMarkdownRef.current = renderMarkdown
  renderComponentRef.current = renderComponent
  latestCompiled.current = compiled

  const [tree, setTree] = useState<DilTreeNode>()
  const [state, setState] = useState<Record<string, unknown>>({ ...initialState })
  const [failure, setFailure] = useState<string>()

  const compilationFailure = compiled.ok ? undefined : 'DIL 编译未通过，未执行界面程序。' + (compiled.diagnosticSummary ? ' ' + compiled.diagnosticSummary : '')
  const markdownFailure = treeUsesMarkdown(tree) && !renderMarkdown ? 'DIL Markdown 组件需要宿主 Markdown 渲染器。' : undefined
  const componentFailure = treeUsesExternalComponent(tree) && !renderComponent ? 'DIL 外部组件需要宿主组件渲染器。' : undefined
  const runtimeFailure = enabled ? failure ?? componentFailure ?? markdownFailure ?? compilationFailure : undefined

  useEffect(() => {
    if (!runtimeFailure) {
      reportedFailureRef.current = undefined
      return
    }
    if (reportedFailureRef.current === runtimeFailure) return
    reportedFailureRef.current = runtimeFailure
    onRuntimeFailureRef.current?.(runtimeFailure)
  }, [runtimeFailure])

  const receiveState = (next: Record<string, unknown>): void => {
    try {
      const safe = stateRecord(next)
      stateRef.current = safe
      setState(safe)
      onStateChangeRef.current?.(safe)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (!enabled) {
      runner.current?.dispose()
      runner.current = undefined
      runnerReady.current = undefined
      startedWith.current = undefined
      setTree(undefined)
      setFailure(undefined)
      return
    }
    if (!compiled.ok) {
      runnerReady.current = undefined
      startedWith.current = undefined
      setTree(undefined)
      setFailure(undefined)
      return
    }
    const configuredFrameUrl = typeof frameUrl === 'string' && frameUrl.trim() ? frameUrl : undefined
    if (!configuredFrameUrl) {
      setTree(undefined)
      setFailure('DIL 运行器地址不可用。')
      return
    }
    const container = sandboxHost.current
    if (!container) return
    let active = true
    const initial = stateRecord(initialState)
    stateRef.current = initial
    setState(initial)
    onStateChangeRef.current?.(initial)
    setTree(undefined)
    setFailure(undefined)
    const instance = createDilRunner({
      container,
      frameUrl: configuredFrameUrl,
      initialState: initial,
      onSnapshot: (snapshot: unknown) => {
        if (!active) return
        try {
          const validated = validateDilTree(snapshot) as DilTreeNode
          const nativeTree = assertNativeTree(validated)
          if (treeUsesMarkdown(nativeTree) && !renderMarkdownRef.current) {
            throw new DilNativeViewError('DIL_MARKDOWN_RENDERER_UNAVAILABLE', 'DIL Markdown 组件需要宿主 Markdown 渲染器。')
          }
          if (treeUsesExternalComponent(nativeTree) && !renderComponentRef.current) {
            throw new DilNativeViewError('DIL_COMPONENT_RENDERER_UNAVAILABLE', 'DIL 外部组件需要宿主组件渲染器。')
          }
          onSnapshotRef.current?.(nativeTree)
          setTree(nativeTree)
          setFailure(undefined)
        } catch (error) {
          setTree(undefined)
          setFailure(error instanceof Error ? error.message : String(error))
        }
      },
      onStateChange: (next: Record<string, unknown>) => {
        if (active) receiveState(next)
      },
      onFailure: (error: unknown) => {
        if (active) setFailure(error instanceof Error ? error.message : String(error))
      },
    })
    runner.current = instance
    runnerReady.current = undefined
    startedWith.current = undefined
    void instance.start(compiled).then(() => {
      if (!active || runner.current !== instance) return
      runnerReady.current = instance
      const latest = latestCompiled.current
      if (!latest.ok) return
      try {
        if (latest !== compiled) instance.update(latest)
        startedWith.current = latest
      } catch (error) {
        if (active && runner.current === instance) setFailure(error instanceof Error ? error.message : String(error))
      }
    }).catch(error => {
      if (active && runner.current === instance) {
        runnerReady.current = undefined
        setFailure(error instanceof Error ? error.message : String(error))
      }
    })
    return () => {
      active = false
      if (runner.current === instance) {
        runner.current = undefined
        runnerReady.current = undefined
        startedWith.current = undefined
      }
      instance.dispose()
    }
  // A compatible compiled value updates through the separate effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, artifactId, sessionId, frameUrl, compiled.ok])

  useEffect(() => {
    const instance = runner.current
    if (!enabled || !compiled.ok || !instance || runnerReady.current !== instance || startedWith.current === compiled) return
    try {
      instance.update(compiled)
      startedWith.current = compiled
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [compiled, enabled])

  const context: RenderContext = {
    componentSet,
    renderMarkdown: renderMarkdownRef.current,
    renderComponent: renderComponentRef.current,
    reportFailure(error) { setFailure(error instanceof Error ? error.message : String(error)) },
    trigger(handler, args) {
      const id = handlerId(handler)
      if (!id) return
      try {
        runner.current?.trigger(id, [...args])
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error))
      }
    },
    submit(actionValue, form) {
      const action = text(actionValue)
      if (!action) {
        setFailure('form.action 不可用，未提交当前界面。')
        return
      }
      if (submitInFlight.current) return
      const instance = runner.current
      if (!instance) {
        setFailure('DIL 运行器不可用，未提交当前界面。')
        return
      }
      const submit = onSubmitRef.current
      if (!submit) {
        setFailure('当前 DIL 视图没有可用的提交接口，未提交当前界面。')
        return
      }
      submitInFlight.current = true
      void (async () => {
        try {
          const next = stateRecord(await instance.captureState())
          stateRef.current = next
          // Flush runner snapshots that arrived while captureState was in flight
          // before reading controlled DOM fields for the host action.
          flushSync(() => setState(next))
          onStateChangeRef.current?.(next)
          const fields = fieldsFrom(form)
          await submit(action, { state: { ...next }, fields })
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
        } finally {
          submitInFlight.current = false
        }
      })()
    },
  }

  const diagnostics = compiled.ok ? compilerDiagnosticText(compiled) : undefined
  const fallback = !enabled || compilationFailure !== undefined || markdownFailure !== undefined || componentFailure !== undefined || failure !== undefined
  return h('section', { className: 'dsh-experience iexp-dil', 'data-dil-enabled': String(enabled), 'data-dil-artifact-id': artifactId, 'data-dil-session-id': sessionId },
    h('div', { ref: sandboxHost, className: 'iexp-dil-runner-host', 'aria-hidden': true }),
    fallback
      ? fallbackView(source, compiled, failure ?? componentFailure ?? markdownFailure ?? compilationFailure, renderFallback)
      : tree
        ? h('div', { className: 'iexp-dil-native-tree', 'data-dil-native-tree': true }, renderNode(tree, context, 'root'))
        : h('p', { className: 'iexp-dil-pending', role: 'status' }, '正在准备本地 DIL 视图…'),
    diagnostics && h('details', { className: 'iexp-dil-diagnostics' }, h('summary', null, '界面程序诊断'), h('pre', null, diagnostics)),
    state && h('output', { className: 'iexp-dil-state-marker', 'aria-hidden': true }, ''),
  )
}
