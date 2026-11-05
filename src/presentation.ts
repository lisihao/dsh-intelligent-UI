import {normalizeCompositionSource} from './adaptive-ui/source-contracts.js'
import { AdaptiveCompositionView, CompositionRuntimeContext } from './adaptive-ui/view.js'
import { CompositionSelectionContext, ExperimentalBlockDispatchContext, useCompositionSelection, useExperimentalBlockDispatch } from './adaptive-ui/scope.js'
import { HistoricalChart, LiveSeriesView, recognizeLiveSeries, AdaptiveLoading, AdaptiveText } from './adaptive-ui/components.js'
import { isAsciiTheme, isGpuAsciiTheme } from './theme-contracts.js'
import { AsciiChart, supportsAsciiChart } from './ascii-chart.js'
import { analyzeExecutionFlow } from './execution-flow.js'
import { ExecutionFlowView } from './execution-flow-view.js'
import { DenseLinePlot, requiresDenseLinePlot } from './dense-line-plot.js'
import { CanvasObjectView, glbSource } from './canvas-object-view.js'
import { markdownIllustrations } from './markdown-illustrations.js'
import { ChartViewport, ChartDataTable, PagedTableBody } from './chart-viewport.js'
import { TableViewport } from './table-viewport.js'
import { analyzeResearchDocument } from './research-content.js'
import { UiverseRenderScope } from './uiverse-render.js'
import { ThemeButton, ThemeCard } from './theme-components.js'
import { Component, Fragment, createElement as h, useCallback, useContext, useEffect, useRef, useState, useMemo, useId, useSyncExternalStore, type ReactElement, type ReactNode, type ComponentProps } from 'react'
import { Renderer, type LibraryExtension, type ActionEvent } from '@openuidev/react-lang'
import { ThemeProvider, MarkDownRenderer, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, LineChart, BarChart, IconWrapper } from '@openuidev/react-ui'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import { widgetStateSchema, saveWidgetStateSchema, type ExperienceArtifact, type WidgetStateApi, type SaveWidgetStateInput } from './contracts.js'
import type { CompositionSelection } from './adaptive-ui/contracts.js'
import { styles } from './style.js'
import { appearancePreferences, appearanceTokens } from './appearance.js'
import { themePreferences, usePresentationTheme } from './theme-runtime.js'
import { McpAppView } from './mcp-view.js'
import type { CallToolResult } from '@modelcontextprotocol/client'
import remarkGfm from 'remark-gfm'
import { planContentSections } from './content-sections.js'
import { continuousSectionsPlugin, planReadingTable } from './continuous-view.js'
import { PaperChartDeck } from './paper-chart-deck.js'
import { ComparisonPlot, isCompactComparison } from './comparison-view.js'
import { FlowView, type FlowViewPlan } from './flow-view.js'
import { analyzeGraph, analyzeTaskRecords, analyzeTaskTable, analyzeMasterDetail, parseMarkdownLayouts, type FlowPlan } from './content-layout.js'
import { BoardView, MasterDetailView, HeadingIndex, headingAnchor } from './layout-views.js'
import { analyzeTableCharts, parseMarkdownTables, rowsFromRecords, selectIcon, type AutoChartPlan } from './content-analysis.js'

/** Host theme stays read-only; content contrast follows the user-selected surface color. */
export class ExperienceTheme {
  private mode: 'light' | 'dark' = 'light'
  private listeners = new Set<() => void>()
  getSnapshot = () => this.mode
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(mode: 'light' | 'dark') { if (mode !== this.mode) { this.mode = mode; this.listeners.forEach(listener => listener()) } }
}
export const experienceTheme = new ExperienceTheme()
function useSelectedTheme() { return usePresentationTheme() }
function useExperienceTheme() { const appearance = useSyncExternalStore(appearancePreferences.subscribe, appearancePreferences.getSnapshot, appearancePreferences.getSnapshot); const theme = useSelectedTheme(); return useMemo(() => appearanceTokens(appearance, theme).colorScheme, [appearance, theme]) }

export type DisplayMode = 'visual' | 'raw' | 'compare'
/** One transient display preference per conversation, shared by every output surface. */
export class DisplayModes {
  private modes = new Map<string, DisplayMode>()
  private listeners = new Set<() => void>()
  get = (sessionId: string): DisplayMode => this.modes.get(sessionId) ?? 'visual'
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(sessionId: string, mode: DisplayMode) { if (mode !== this.get(sessionId)) { this.modes.set(sessionId, mode); this.listeners.forEach(listener => listener()) } }
  clear() { this.modes.clear(); this.listeners.forEach(listener => listener()) }
}
export const displayModes = new DisplayModes()
export function useDisplayMode(sessionId: string): DisplayMode { return useSyncExternalStore(displayModes.subscribe, () => displayModes.get(sessionId), () => 'visual') }
export function DisplayModeControl({ sessionId }: { sessionId: string }): ReactElement {
  const mode = useDisplayMode(sessionId)
  return h('label', { className: 'dsh-experience iexp-mode-control', style: styles.modeControl, title: '统一切换本会话的智能体验输出' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'panels-top-left', size: 15 })), h('span', { className: 'iexp-mode-caption' }, '显示'), h('select', { 'aria-label': '输出显示方式', value: mode, style: styles.button, onChange: (event: { currentTarget: HTMLSelectElement }) => displayModes.set(sessionId, event.currentTarget.value as DisplayMode) }, h('option', { value: 'visual' }, '展示'), h('option', { value: 'raw' }, '原文'), h('option', { value: 'compare' }, '对照')))
}
export function OutputView({ sessionId, raw, mode: override, children }: { sessionId: string, raw: unknown, mode?: DisplayMode, children?: ReactNode }): ReactElement {
  const shared = useDisplayMode(sessionId); const mode = override ?? shared; const theme = useExperienceTheme(); const runtime = useContext(CompositionRuntimeContext)
  return h('div', { style: mode === 'compare' ? styles.compare : undefined }, h('div', { hidden: mode === 'raw', style: { minWidth: 0 } }, h(CompositionRuntimeContext.Provider, {value:{...runtime,sessionId,suspended:runtime.suspended || mode==='raw'}}, children)), mode !== 'visual' && h('div', { className: 'dsh-experience iexp-content iexp-raw-output', 'data-experience-theme': theme }, h('strong', null, '原始内容'), h('pre', { style: styles.raw }, rawText(raw))))
}

/** Extend the maintained OpenUI library; registrations are independently disposable. */
export class OpenUiWidgets {
  private entries = new Map<string, LibraryExtension>()
  private listeners = new Set<() => void>()
  private library = openuiLibrary
  getSnapshot = () => this.library
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  register(id: string, extension: LibraryExtension): () => void {
    if (!id || this.entries.has(id)) throw new Error(`OpenUI widget registration already exists: ${id}`)
    const entries = new Map(this.entries); entries.set(id, extension)
    const next = this.build(entries)
    this.entries = entries; this.library = next; this.listeners.forEach(listener => listener())
    return () => { if (!this.entries.has(id)) return; const remaining = new Map(this.entries); remaining.delete(id); const updated = this.build(remaining); this.entries = remaining; this.library = updated; this.listeners.forEach(listener => listener()) }
  }
  private build(entries: Map<string, LibraryExtension>): typeof openuiLibrary {
    let next: typeof openuiLibrary = openuiLibrary
    for (const extension of entries.values()) next = next.extend(extension)
    return next
  }
}
export const openUiWidgets = new OpenUiWidgets()

export function rawText(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

class ChartBoundary extends Component<{ children?: ReactNode, fallback?: ReactNode }, { error?: string }> {
  state: { error?: string } = {}
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) } }
  render() { return this.state.error ? h('div', null, h('p', { role: 'alert' }, `内容无法显示，原始数据仍可查看：${this.state.error}`), this.props.fallback) : this.props.children }
}
function SafeAutoChart({ plan }: { plan: AutoChartPlan }): ReactElement { return h(ChartBoundary, { key: JSON.stringify(plan) }, h(AutoChart, { plan })) }

function ChartSource({ plan }: { plan: AutoChartPlan }): ReactElement { return plan.labels.length > 100 ? h(ChartDataTable, { plan }) : h('details', { className: 'iexp-disclosure' }, h('summary', null, h(IconWrapper, { name: 'table-2', size: 15 }), '图表所用原始数据'), h(ChartDataTable, { plan, inline: true })) }

/** Charts are derived locally; the unmodified table remains the accessible data source. */
export function AutoChart({ plan }: { plan: AutoChartPlan }): ReactElement {
  const theme = useExperienceTheme(), selectedTheme = useSelectedTheme(), composition = useCompositionSelection(), experimentalBlockDispatch = useExperimentalBlockDispatch()
  const colors = appearanceTokens(appearancePreferences.getSnapshot(), selectedTheme).variables
  const palette = (theme === 'dark' ? selectedTheme.tokens.paletteDark : selectedTheme.tokens.paletteLight).map((_, index) => colors[`--iexp-series-${index + 1}`]!)
  const compact = selectedTheme.tokens.comparison === 'organic' && isCompactComparison(plan)
  const plot = (view: AutoChartPlan) => {
    const explicitExperimentalChart = experimentalBlockDispatch && composition?.chart !== undefined && composition.chart !== 'auto'
    if ((composition?.chart === 'ascii' || !explicitExperimentalChart && composition?.chart !== 'openui' && composition?.chart !== 'visx' && isAsciiTheme(selectedTheme) && !isGpuAsciiTheme(selectedTheme)) && supportsAsciiChart(plan)) return h(AsciiChart, {plan:view, scalePlan:plan})
    let categoryKey = 'category'
    while (view.series.some(series => series.name === categoryKey)) categoryKey = `_${categoryKey}`
    const horizontal = view.kind === 'bar'
    const data = view.labels.map((label, i) => Object.fromEntries([[categoryKey, horizontal && view.series.length === 1 ? `${label} · ${view.series[0]!.originals?.[i] ?? `${view.series[0]!.values[i]}${view.series[0]!.unit}`}` : label], ...view.series.map(series => [series.name, series.values[i]!])]))
    const chartProps = { data, categoryKey, height: horizontal ? Math.max(230, view.labels.length * (30 + view.series.length * 26) + 56 + (view.series.length > 1 ? 50 : 0)) : 280, width: '100%', showYAxis: true, legend: view.series.length > 1, grid: true, isAnimationActive: false, customPalette: palette.slice(0, view.series.length), ...(horizontal ? { xAxisLabel: view.series[0]?.unit || '数值' } : { yAxisLabel: view.series[0]?.unit || '数值' }) }
    if (composition?.chart === 'visx') return h(HistoricalChart, {plan:view,palette})
    if ((composition?.chart === 'dense' && view.kind === 'line') || requiresDenseLinePlot(plan)) return h(DenseLinePlot, { plan: view, palette })
    return (composition?.chart === 'compact' ? isCompactComparison(view) : composition?.chart === 'openui' ? false : compact) ? h(ComparisonPlot, { plan: view }) : view.kind === 'line' ? h(LineChart, { ...chartProps, variant: 'linear', showDots: view.labels.length <= 80, crosshair: true, highlight: true }) : h(BarChart, { ...chartProps, orientation: 'horizontal', internalLine: false, barRadius: 3, density: 'compact' })
  }
  const title = plan.title ?? (plan.kind === 'line' ? '时间趋势' : '数值比较')
  const notes = plan.notes ?? []
  const caveat = [notes.some(note => /近似|不是精确/.test(note)) && '含近似值', notes.some(note => /合计行/.test(note)) && '合计未参与比较', notes.some(note => /未纳入/.test(note)) && '含排除项', notes.some(note => /未使用列/.test(note)) && '仅展示选取列', notes.some(note => /未经审计|未审计|unaudited/i.test(note)) && '未经审计'].filter(Boolean).join(' · ')
  return h(ThemeCard, { renderRole: 'chart', as: 'figure', className: `iexp-chart-card${compact ? ' iexp-chart-comparison' : ''}`, 'aria-label': `自动生成的${title}`, 'data-auto-chart': plan.kind },
    h('figcaption', { className: 'iexp-card-head' }, h('span', { className: 'iexp-card-title' }, h('span', { 'aria-hidden': true, className: 'iexp-card-icon' }, h(IconWrapper, { name: plan.icon, size: 17 })), h('strong', null, title)), h('span', { className: 'iexp-card-basis' }, plan.basis || plan.series[0]?.unit || '原表数值')),
    h('div', { className: 'iexp-chart-plot' }, h(ChartViewport, { key: JSON.stringify([plan.labels, plan.kind]), plan, children: plot })),
    h('div', { className: 'iexp-card-foot' }, caveat && h('p', { className: 'iexp-chart-caveat' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'info', size: 14 })), caveat),
      selectedTheme.tokens.composition === 'continuous' ? h('div', { className: 'iexp-chart-notes' }, h('p', null, plan.reason), !!notes.length && h('ul', null, ...notes.map((note, i) => h('li', { key: i }, note)))) : h('details', { className: 'iexp-disclosure' }, h('summary', null, h(IconWrapper, { name: 'list-filter', size: 15 }), `口径与选取说明${notes.length ? `（${notes.length}）` : ''}`), h('p', null, plan.reason), !!notes.length && h('ul', null, ...notes.map((note, i) => h('li', { key: i }, note)))), selectedTheme.tokens.composition !== 'continuous' && h(ChartSource, { plan })))
}

function SourceTable({ plans, children, supplemented = false }: { plans: AutoChartPlan[], children?: ReactNode, supplemented?: boolean }): ReactElement {
  const table = h(TableViewport, {className:'iexp-source-table',label:'原始数据表格'}, h(Table, {containerStyle:{overflow:'visible'}}, children))
  return plans.length || supplemented ? h('details', { className: 'iexp-full-table' }, h('summary', null, h(IconWrapper, { name: 'database', size: 16 }), '完整原表', h('span', null, '保留全部行列与原文口径')), table) : table
}
function headingText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(headingText).join('')
  if (value && typeof value === 'object' && 'props' in value) return headingText((value.props as { children?: ReactNode }).children)
  return ''
}
function flowPlan(plan: FlowPlan): FlowViewPlan {
  return { title: '原文步骤', nodes: plan.steps.map((step, i) => ({ id: `step-${i}`, label: step.text })), edges: plan.steps.slice(1).map((_step, i) => ({ source: `step-${i}`, target: `step-${i + 1}` })), sourceText: plan.original, reason: plan.sourceKind === 'ordered-list' ? '按原文明确的流程上下文与步骤顺序绘制，未推断额外的依赖或因果关系。' : '连线直接来自原文箭头，节点文字完整保留。' }
}
function SafeFlow({ plan }: { plan: FlowPlan }): ReactElement {
  return h(ChartBoundary, { key: plan.original, fallback: h('pre', { style: styles.raw }, plan.original) }, h(FlowView, { plan: flowPlan(plan) }))
}
type BlockLayoutPlan = NonNullable<CompositionSelection['blockLayout']>
type BlockComposition = BlockLayoutPlan['blocks'][number]
type BlockSelection = BlockComposition['selection']
const EMPTY_COMPOSITION_PATH: readonly number[] = []

function sameCompositionPath(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}
function blocksAtPath(program: CompositionSelection | undefined, path: readonly number[]): readonly BlockComposition[] {
  return program?.blockLayout?.blocks.filter(block => sameCompositionPath(block.path, path)) ?? []
}
/** A block targets one compiler-reconstructed source node, never a sliced Markdown fragment. */
function markdownBlockAt(program: CompositionSelection | undefined, path: readonly number[], start?: number, end?: number): BlockComposition | undefined {
  if (start === undefined || end === undefined) return undefined
  const matches = blocksAtPath(program, path).filter(block => block.start !== undefined && block.end !== undefined && block.start <= start && block.end >= end)
  return matches.length === 1 ? matches[0] : undefined
}
function structuredBlockAt(program: CompositionSelection | undefined, path: readonly number[]): BlockComposition | undefined {
  const matches = blocksAtPath(program, path).filter(block => block.start === undefined && block.end === undefined)
  return matches.length === 1 ? matches[0] : undefined
}
function scopedSelection(selection: BlockSelection | undefined, content: ReactNode): ReactNode {
  return selection ? h(ExperimentalBlockDispatchContext.Provider, { value: true }, h(CompositionSelectionContext.Provider, { value: selection }, content)) : content
}
/** Global reading aids do not turn off a source-bound table, board, chart, or flow choice. */
function localLayout(selection: { layout: CompositionSelection['layout'] } | undefined, preserveGlobalReadingAids = false): CompositionSelection['layout'] {
  const layout = selection?.layout ?? 'auto'
  return preserveGlobalReadingAids && (layout === 'continuous' || layout === 'heading-index' || layout === 'research') ? 'auto' : layout
}
function allowsSemanticCharts(selection: { layout: CompositionSelection['layout'], surface?: CompositionSelection['surface'] } | undefined, preserveGlobalReadingAids = false): boolean {
  if (selection?.surface === 'source') return false
  return !['document', 'table', 'records'].includes(localLayout(selection, preserveGlobalReadingAids))
}
function allowsSemanticFlows(selection: { layout: CompositionSelection['layout'], surface?: CompositionSelection['surface'] } | undefined, preserveGlobalReadingAids = false): boolean {
  if (selection?.surface === 'source') return false
  const layout = localLayout(selection, preserveGlobalReadingAids)
  return layout === 'auto' || layout === 'flow'
}
const layoutLabels: Record<CompositionSelection['layout'], string> = {
  auto: '保留原文结构', board: '任务看板', records: '记录详情', flow: '步骤或关系图', table: '完整表格',
  research: '研究阅读', document: '文档阅读', 'heading-index': '章节索引', continuous: '连续阅读',
}
const chartLabels: Record<CompositionSelection['chart'], string> = {
  auto: '自动图表', openui: 'OpenUI 图表', compact: '紧凑比较图', dense: '密集趋势图', ascii: 'ASCII 图表', visx: 'Visx 图表',
}
const componentLabels: Readonly<Record<string, string>> = {
  native: '原生组件', 'soft-relief': '柔和浮雕组件', 'clear-glass': '清透玻璃组件', 'mechanical-outline': '机械描边组件',
}
const objectEffectLabels: Readonly<Record<string, string>> = {
  'ink-object': '墨绘对象效果', 'ascii-object': 'ASCII 对象效果', 'glass-object': '玻璃对象效果',
}
const blockKindLabels: Readonly<Record<string, string>> = {
  prose: '正文', paragraph: '段落', 'markdown-paragraph': '段落', table: '表格', 'markdown-table': '表格',
  code: '代码块', 'ordered-list': '有序列表', list: '列表', flow: '步骤或关系', structured: '结构化内容',
  'structured-array': '结构化列表', 'structured-record': '结构化记录', scalar: '文本值',
}
const evidenceLabels: Readonly<Record<string, string>> = {
  'source:markdown': '来源是当前 Markdown 原文',
  'source:table': '来源是完整 Markdown 表格',
  'source:flow:arrow-chain': '原文包含明确的箭头步骤',
  'source:flow:ordered-list': '原文包含明确的有序步骤',
  'source:list': '来源是列表',
  'source:ordered-list': '来源是有序列表',
  'source:illustration': '来源包含可验证的插图',
  'source:code': '来源是代码块',
  'source:structured': '来源是结构化内容',
  'source:passive-markdown': '来源保持普通 Markdown 阅读',
  'markdown-paragraph': '来源是 Markdown 段落',
  'markdown-table': '来源是完整 Markdown 表格',
  'ordered-list': '来源是有序列表',
  'arrow-chain': '原文包含明确的箭头步骤',
  'explicit-flow': '原文包含明确的步骤或关系',
  'numeric-table': '表格包含可比较的数值列',
  'task-table': '表格包含明确的任务和状态字段',
  'task-records': '结构化记录包含明确的任务和状态字段',
  'record-list': '结构化记录可保持完整详情',
  'validated-chart-plan': '表格已通过图表结构核验',
  'historical-time-series': '时间序列已通过趋势图结构核验',
  'validated-task-status-records': '任务和状态字段已通过结构核验',
  'validated-explicit-graph-or-flow': '原文关系或步骤已通过结构核验',
  'source-bound-ordered-list-flow': '有序步骤已与当前原文逐项对应',
}
function readableEvidence(value: string): string {
  const key = value.trim().toLowerCase().replace(/[ _]+/g, '-')
  if (evidenceLabels[key]) return evidenceLabels[key]
  if (key.startsWith('node:')) return '来源节点类型已与当前原文核验'
  if (key.startsWith('range:')) return '来源范围已与当前原文核验'
  if (key.startsWith('contains:')) return '内容结构已与当前原文核验'
  if (key.startsWith('source:')) return '来源类型已与当前原文核验'
  return '该内容块已通过与当前原文结构相符的本地核验'
}
function readableSourceScope(block: BlockComposition, path: readonly number[]): string {
  const kind = blockKindLabels[block.kind] ?? '内容块'
  return path.length ? `第 ${path.map(index => index + 1).join('.')} 个内容块中的${kind}` : `当前文档中的${kind}`
}
function readableChoice(selection: BlockSelection): string {
  const parts = [layoutLabels[selection.layout], chartLabels[selection.chart], componentLabels[selection.componentSet] ?? '已选组件样式']
  if (selection.objectEffect !== 'auto' && selection.objectEffect !== 'none') parts.push(objectEffectLabels[selection.objectEffect] ?? '已选对象效果')
  return parts.join('；')
}
/** Source evidence is local verification metadata, not a model-authored explanation. */
function BlockLayoutBasis({ program, path }: { program: CompositionSelection | undefined, path: readonly number[] }): ReactElement | null {
  const blocks = blocksAtPath(program, path)
  if (!blocks.length) return null
  return h('details', { className: 'iexp-disclosure', 'data-iexp-block-layout-basis': 'true' },
    h('summary', null, '内容块布局依据'),
    h('p', null, '展示已选方式与本地核验的适用条件，不代表模型返回的文字理由。'),
    h('ul', null, ...blocks.map(block => {
      const evidence = [...new Set(block.evidence.map(readableEvidence))]
      const evidenceList = h('ul', null, ...evidence.map((item, index) => h('li', { key: index }, `本地核验：${item}`)))
      return h('li', { key: block.id },
        h('strong', null, `${blockKindLabels[block.kind] ?? '内容块'}：${readableChoice(block.selection)}`),
        h('div', null, `来源位置：${readableSourceScope(block, path)}`),
        evidenceList,
      )
    })),
  )
}
function MarkdownContent({ text, isStreaming, path, program }: { text: string, isStreaming: boolean, path: readonly number[], program: CompositionSelection | undefined }): ReactElement {
  const composition = program
  const tables = useMemo(() => isStreaming ? [] : analyzeResearchDocument(text).tables, [text, isStreaming])
  const layout = useMemo(() => isStreaming ? { flows: [] } : parseMarkdownLayouts(text), [text, isStreaming])
  const selectedTheme = useSelectedTheme()
  const colorScheme = useExperienceTheme()
  const illustrations = useMemo(() => isStreaming ? [] : markdownIllustrations(text), [text, isStreaming])
  const experimentalProgram = !!composition?.blockLayout
  const rootLayout = composition?.layout ?? 'auto'
  const globalReadingAids = experimentalProgram && (rootLayout === 'continuous' || rootLayout === 'heading-index' || rootLayout === 'research')
  const semanticFallback = !composition || rootLayout === 'auto' || experimentalProgram && rootLayout === 'research'
  const headingIndexEligible = !composition || rootLayout === 'auto' || rootLayout === 'heading-index' || experimentalProgram && rootLayout === 'research'
  const sections = useMemo(() => !isStreaming && (rootLayout === 'continuous' || semanticFallback && selectedTheme.tokens.composition === 'continuous') ? planContentSections(text) : undefined, [text, isStreaming, selectedTheme.tokens.composition, rootLayout, semanticFallback])
  const prefix = useId().replaceAll(':', '')
  // Stable renderer types retain native disclosures and nested layout state during polling.
  const markdownOptions = useMemo<ComponentProps<typeof MarkDownRenderer>['options']>(() => {
    const headings = Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [`h${level}`, ({ children, node }: { children?: ReactNode, node?: { position?: { start: { offset?: number }, end?: { offset?: number } } } }) => {
      const start = node?.position?.start.offset, end = node?.position?.end?.offset, block = markdownBlockAt(program, path, start, end), icon = selectIcon(headingText(children))
      const heading = h(`h${level}`, { 'data-iexp-source-start': start, 'data-iexp-source-end': (node as { position?: { end?: { offset?: number } } } | undefined)?.position?.end?.offset, id: start === undefined ? undefined : headingAnchor(prefix, start), tabIndex: -1, style: styles.semanticHeading }, icon !== 'file-text' && h('span', { 'aria-hidden': true, style: styles.headingIcon }, h(IconWrapper, { name: icon, size: 20 })), h('span', null, children))
      const output = headingIndexEligible && !sections && start !== undefined && start === layout.outline?.entries[0]?.start ? h(Fragment, null, h(HeadingIndex, { plan: layout.outline, prefix }), heading) : heading
      return scopedSelection(block?.selection, output)
    }]))
    return { remarkPlugins: [remarkGfm, ...(sections ? [continuousSectionsPlugin(sections, layout.flows.map(flow => flow.start), tables.filter(table => table.plans.length > 1).map(table => table.start))] : [])], components: {
      ...headings,
      tbody: ({ children }) => h(PagedTableBody, { children }),
      p: ({ children, node }) => {
        const start = node?.position?.start.offset, end = node?.position?.end.offset, block = markdownBlockAt(program, path, start, end), effective = block?.selection ?? composition
        const flow = allowsSemanticFlows(effective, !block && globalReadingAids) && layout.flows.find(plan => plan.sourceKind === 'arrow-chain' && plan.start === start)
        if (flow) return scopedSelection(block?.selection, h(SafeFlow, { plan: flow }))
        const illustration = effective?.surface === 'source' ? undefined : illustrations.find(item => item.start === node?.position?.start.offset)
        if (illustration) {
          // Keep ordinary Markdown images as rendered by the host. Its URL filter
          // removes data: image sources, so use the byte-validated blob for those.
          const record = { type: illustration.mime, role: 'illustration', url: illustration.url, alt: illustration.alt, title: illustration.title }
          const source = glbSource(record)
          if (source) return scopedSelection(block?.selection, h('div', { 'data-iexp-source-start': start, 'data-iexp-source-end': end }, h(CanvasObjectView, { value: record, source, dark: colorScheme === 'dark', originalView: /^data:/i.test(illustration.url) ? undefined : h('div', { className: 'iexp-markdown-illustration-original' }, children) })))
        }
        return scopedSelection(block?.selection, h('p', { 'data-iexp-source-start': start, 'data-iexp-source-end': end }, children))
      },
      a: ({ children, node, href, ...props }) => h('a', { ...props, href, 'data-iexp-source-start': node?.position?.start.offset, 'data-iexp-source-end': node?.position?.end.offset }, children),
      td: ({ children, node, align }) => h(TableCell, { align: align === 'center' || align === 'right' ? align : 'left' }, h('span', { 'data-iexp-source-start': node?.position?.start.offset, 'data-iexp-source-end': node?.position?.end.offset }, children)),
      th: ({ children, node, align }) => h(TableHead, { align: align === 'center' || align === 'right' ? align : 'left' }, h('span', { 'data-iexp-source-start': node?.position?.start.offset, 'data-iexp-source-end': node?.position?.end.offset }, children)),
      ol: ({ children, node, start }) => {
        const sourceStart = node?.position?.start.offset, sourceEnd = node?.position?.end.offset, block = markdownBlockAt(program, path, sourceStart, sourceEnd), effective = block?.selection ?? composition
        const flow = allowsSemanticFlows(effective, !block && globalReadingAids) && layout.flows.find(plan => plan.sourceKind === 'ordered-list' && plan.start === sourceStart)
        return scopedSelection(block?.selection, flow ? h(SafeFlow, { plan: flow }) : h('ol', { start }, children))
      },
      table: ({ children, node }) => {
        const sourceStart = node?.position?.start.offset, sourceEnd = node?.position?.end.offset, block = markdownBlockAt(program, path, sourceStart, sourceEnd), effective = block?.selection ?? composition, layoutChoice = localLayout(effective, !block && globalReadingAids)
        if (effective?.surface === 'source') return scopedSelection(block?.selection, h('div', { className: 'iexp-table-group', 'data-iexp-source-start': sourceStart, 'data-iexp-source-end': sourceEnd }, h(SourceTable, { plans: [] }, children)))
        const table = tables.find(table => table.start === sourceStart), plans = allowsSemanticCharts(effective, !block && globalReadingAids) ? table?.plans ?? [] : []
        const board = table && (layoutChoice === 'auto' || layoutChoice === 'board') ? analyzeTaskTable(table.headers, table.rows) : undefined
        const detail = (layoutChoice === 'records' || sections && layoutChoice === 'auto') && !board && !plans.length && table ? planReadingTable(table.headers, table.rows) : undefined
        return scopedSelection(block?.selection, h('div', { className: 'iexp-table-group', 'data-iexp-source-start': sourceStart, 'data-iexp-source-end': sourceEnd }, board ? h(BoardView, { plan: board }) : detail ? h(MasterDetailView, { plan: detail }) : plans.length > 0 && (sections ? h(PaperChartDeck, { plans, Chart: SafeAutoChart }) : h('div', { className: 'iexp-chart-grid' }, ...plans.map((plan, i) => h(SafeAutoChart, { key: i, plan })))), h(SourceTable, { plans, supplemented: !!board || !!detail }, children)))
      },
    } }
  }, [layout, prefix, tables, sections, illustrations, colorScheme, composition, program, path, rootLayout, globalReadingAids, headingIndexEligible])
  return h('div', { className: `iexp-document${sections ? ' iexp-continuous' : ''}`, 'data-content-layout': sections ? 'continuous' : undefined }, h(BlockLayoutBasis, { program, path }), sections && layout.outline && h(HeadingIndex, { plan: layout.outline, prefix }), h(MarkDownRenderer, { textMarkdown: text, options: markdownOptions }))
}
function StructuredContent({ value, isStreaming, dark }: { value: unknown, isStreaming: boolean, dark: boolean }): ReactElement {
  const composition = useCompositionSelection(), layout = composition?.layout ?? 'auto'
  if (composition?.surface === 'source') return h('pre', { style: styles.raw }, rawText(value))
  const live = !isStreaming && recognizeLiveSeries(value)
  if (live) return h(LiveSeriesView, {source:live,dark,animate:composition?.live!=='native'})
  const record=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined
  if(record?.type==='live-series'&&!live)return h('section',null,h('p',{role:'alert'},'实时序列的格式、数值或时间顺序不符合要求，已保留原始记录。'),h('pre',{style:styles.raw},rawText(value)))
  if(record && (record.type==='status-update'||record.type==='metric-update') && typeof record.label==='string' && record.editable!==true) {
    const current=record.value??record.current,previous=record.previous??record.previousValue
    if((typeof current==='string'||typeof current==='number')&&(typeof previous==='string'||typeof previous==='number')) {
      const text=String(current)+(typeof record.unit==='string'?' '+record.unit:'')
      return h('section',{'data-iexp-update':record.type},h('strong',null,record.label),h('p',null,h(AdaptiveText,{text,motion:composition?.textMotion!=='none'})),h('details',null,h('summary',null,'原始更新记录'),h('pre',{style:styles.raw},rawText(value))))
    }
  }
  if(record?.loading===true && typeof (record.surface??record.knownSurface)==='string' && (record.visibleContent??record.hasVisibleContent)===false) return h('section',null,record.error?h('p',{role:'alert'},'内容加载失败，请查看原始状态。'):record.empty===true?h('p',{role:'status'},'没有可展示的数据。'):composition?.loading==='native'?h('p',{role:'status'},'正在加载内容…'):h(AdaptiveLoading,{loading:true,error:typeof record.error==='string'?record.error:undefined,empty:record.empty===true,label:typeof record.label==='string'?record.label:'正在加载内容…'}),h('details',null,h('summary',null,'原始加载状态'),h('pre',{style:styles.raw},rawText(value))))
  const execution = isStreaming ? { status: 'unrecognized' as const } : analyzeExecutionFlow(value)
  if (execution.status === 'valid' && (layout === 'auto' || layout === 'flow')) return h(ChartBoundary, { fallback: h('pre', { style: styles.raw }, rawText(value)) }, h(ExecutionFlowView, { plan: execution.plan, sourceText: rawText(value) }))
  if (execution.status === 'invalid') return h('div', null, h('p', { role: 'alert' }, `执行流程数据无法显示：${execution.error.message}`), h('pre', { style: styles.raw }, rawText(value)))
  const model = !isStreaming && glbSource(value)
  if (model) return h('div', null, h(CanvasObjectView, { value, source: model, dark }), h('details', {className:'iexp-disclosure'}, h('summary',null,'原始模型记录'), h('pre', { style: styles.raw }, rawText(value))))
  const graph = isStreaming ? { status: 'unrecognized' as const } : analyzeGraph(value)
  if (graph.status === 'invalid') return h('div', null, h('p', { role: 'alert' }, '关系图数据不完整或格式不受支持，请查看原始内容。'), h('pre', { style: styles.raw }, rawText(value)))
  if (graph.status === 'valid' && (layout === 'auto' || layout === 'flow')) return h(ChartBoundary, { fallback: h('pre', { style: styles.raw }, rawText(value)) }, h(FlowView, { plan: { ...graph.plan, title: '原文关系', sourceText: rawText(value), reason: '仅绘制来源明确提供的节点与连线，图示不改变原始数据。' } }))
  const board = isStreaming ? undefined : analyzeTaskRecords(value)
  if (board && (layout === 'auto' || layout === 'board')) return h(BoardView, { plan: board })
  const detail = isStreaming ? undefined : analyzeMasterDetail(value)
  if (detail && (layout === 'auto' || layout === 'records')) return h(MasterDetailView, { plan: detail })
  const records = rowsFromRecords(value)
  if (records) {
    const { headers, rows: cells } = records, plans = isStreaming || layout === 'document' || layout === 'table' ? [] : analyzeTableCharts(headers, cells)
    const head = h(TableHeader, null, h(TableRow, null, ...headers.map(k => h(TableHead, { key: k }, k))))
    const rows = cells.map((row, i) => h(TableRow, { key: i }, ...row.map((cell, j) => h(TableCell, { key: j }, cell))))
    return h('div', { className: 'iexp-table-group' }, plans.length > 0 && h('div', { className: 'iexp-chart-grid' }, ...plans.map((plan, i) => h(SafeAutoChart, { key: i, plan }))), h(SourceTable, { plans }, head, h(PagedTableBody, null, ...rows)))
  }
  return h('pre', { style: styles.raw }, rawText(value))
}
function ContentBody({ value, isStreaming = false, path = EMPTY_COMPOSITION_PATH, program }: { value: unknown, isStreaming?: boolean, path?: readonly number[], program?: CompositionSelection }): ReactElement {
  const theme = useExperienceTheme()
  const contextualProgram = useCompositionSelection() as CompositionSelection | undefined
  const rootProgram = program ?? contextualProgram
  const normalized = normalizeCompositionSource(value)
  const childCount = normalized.kind === 'blocks' ? normalized.values.length : 0
  const childPaths = useMemo(() => Array.from({ length: childCount }, (_part, index) => [...path, index]), [path, childCount])
  const structured = normalized.kind === 'structured' || normalized.kind === 'scalar' || normalized.kind === 'empty'
  const block = structured ? structuredBlockAt(rootProgram, path) : undefined
  const content:ReactNode=normalized.kind==='blocks'
    ?normalized.values.map((part,index)=>h(ContentBody,{key:index,value:part,isStreaming,path:childPaths[index]!,program:rootProgram}))
    :normalized.kind==='markdown'
      ?h(MarkdownContent,{text:normalized.markdown,isStreaming,path,program:rootProgram})
      :scopedSelection(block?.selection, h(StructuredContent,{value:normalized.kind==='structured'||normalized.kind==='scalar'?normalized.value:value,isStreaming,dark:theme==='dark'}))
  const basis = structured ? h(BlockLayoutBasis, { program: rootProgram, path }) : undefined
  return h(UiverseRenderScope, { role: 'content' }, h(ThemeProvider, { cssSelector: '.dsh-experience', mode: theme }, h('div', { className: 'dsh-experience iexp-content iexp-reply-surface', 'data-experience-theme': theme }, basis, content)))
}

/** One composition boundary per actual source output; nested renderers share its decision. */
export function ContentView({value,isStreaming=false,documentId,sessionId,decide=true}:{value:unknown,isStreaming?:boolean,documentId?:string,sessionId?:string,decide?:boolean}):ReactElement {
  return h(AdaptiveCompositionView,{value,isStreaming,documentId,sessionId,decide},h(ContentBody,{value,isStreaming}))
}

export interface McpUiApi {
  mcpOpen(input: { sessionId: string, artifactId: string, hostOrigin: string }): Promise<{ instanceId: string, proxyUrl: string, html: string, input: Record<string, unknown>, result: CallToolResult }>
  mcpAction(input: { sessionId: string, instanceId: string, commandId: string, name: string, args: Record<string, unknown> }): Promise<CallToolResult>
  mcpClose(input: { sessionId: string, instanceId: string }): Promise<null>
}
function McpContent({ artifact, api }: { artifact: ExperienceArtifact, api?: McpUiApi }): ReactElement {
  const [opened, setOpened] = useState(false)
  const [instance, setInstance] = useState<Awaited<ReturnType<McpUiApi['mcpOpen']>>>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!opened || !api) return
    let disposed = false; let current: string | undefined
    setError('')
    const hostOrigin = location.protocol === 'dsh-app:' && location.host === 'app' ? 'dsh-app://app' : location.origin
    void api.mcpOpen({ sessionId: artifact.source.sessionId, artifactId: artifact.id, hostOrigin }).then(async value => {
      if (disposed) { await api.mcpClose({ sessionId: artifact.source.sessionId, instanceId: value.instanceId }); return }
      current = value.instanceId; setInstance(value)
    }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : String(e)) })
    return () => { disposed = true; if (current) void api.mcpClose({ sessionId: artifact.source.sessionId, instanceId: current }).catch(() => {}); setInstance(undefined) }
  }, [opened, api, artifact.id, artifact.source.sessionId])
  const callTool = useCallback((name: string, args: Record<string, unknown>) => {
    if (!api || !instance) return Promise.reject(new Error('MCP App 未连接'))
    return api.mcpAction({ sessionId: artifact.source.sessionId, instanceId: instance.instanceId, commandId: crypto.randomUUID(), name, args })
  }, [api, instance, artifact.source.sessionId])
  return h('div', null, !api ? h('p', { role: 'status' }, 'MCP App 服务不可用。请查看原始内容。') : !opened ? h(ThemeButton, { type: 'button', style: styles.button, onClick: () => setOpened(true) }, '打开 MCP App') : null,
    error && h('p', { role: 'alert' }, `MCP App 无法打开：${error}`),
    opened && !instance && !error && h('p', { role: 'status' }, '正在打开 MCP App…'),
    instance && h(McpAppView, { proxyUrl: instance.proxyUrl, html: instance.html, input: instance.input, result: instance.result, callTool }))
}
/** Project only human-readable parts of a captured assistant message. */
export function assistantContent(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const message = value as { role?: unknown, content?: unknown }
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return value
  const blocks = message.content as unknown[]
  const text = blocks.flatMap(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return []
    const part = block as { type?: unknown, text?: unknown }
    return (part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string' && part.text.trim() ? [part.text] : []
  })
  if (text.length) return text.join('\n\n')
  return blocks.some(block => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool-call')
    ? '助手发起了工具调用。可在原文中查看详情。' : '此回复没有可展示的文本。可在原文中查看详情。'
}

function AssistantArtifactContent({artifact,isStreaming}:{artifact:ExperienceArtifact,isStreaming:boolean}):ReactElement {
  const message=[artifact.raw,artifact.payload].find(value=>value&&typeof value==='object'&&!Array.isArray(value)&&'content' in value&&Array.isArray(value.content)) as {content:unknown[]}|undefined
  if(!message)return h(ContentView,{value:assistantContent(artifact.payload),isStreaming,sessionId:artifact.source.sessionId,documentId:`artifact:${artifact.id}`,decide:false})
  const nodes=message.content.flatMap((block,index)=>{
    if(!block||typeof block!=='object'||!('type' in block))return []
    if((block.type==='text'||block.type==='reasoning')&&'text' in block&&typeof block.text==='string'){
      const text=h(ContentView,{value:block.text,isStreaming,sessionId:artifact.source.sessionId,documentId:`artifact:${artifact.id}:${block.type}:${index}`,decide:block.type==='text'})
      return [block.type==='reasoning'?h('details',{key:index},h('summary',null,'思考过程'),text):h(Fragment,{key:index},text)]
    }
    return []
  })
  return nodes.length?h('div',null,...nodes):h(ContentView,{value:assistantContent(message),isStreaming,decide:false})
}

export function ArtifactView({ artifact, openuiEnabled = true, isStreaming = false, onContinue, stateApi, mcpApi, displayMode }: { displayMode?: DisplayMode, artifact: ExperienceArtifact, openuiEnabled?: boolean, isStreaming?: boolean, stateApi?: WidgetStateApi, mcpApi?: McpUiApi, onContinue?: (event: ActionEvent, state: Record<string, unknown>, signal: AbortSignal) => Promise<void> }): ReactElement {
  const theme = useExperienceTheme()
  const library = useSyncExternalStore(openUiWidgets.subscribe, openUiWidgets.getSnapshot, openUiWidgets.getSnapshot)
  const [pending] = useState(() => new Set<AbortController>())
  useEffect(() => () => { pending.forEach(controller => controller.abort()); pending.clear() }, [pending])
  const [errors, setErrors] = useState<string[]>([])
  const [actionError, setActionError] = useState('')
  const [state, setState] = useState<Record<string, unknown>>({})
  const [stateReady, setStateReady] = useState(!stateApi)
  const [stateError, setStateError] = useState('')
  const stateControl = useRef<{ revision: number, disposed: boolean, canSave: boolean, last: string, timer?: ReturnType<typeof setTimeout>, saving: boolean, next?: SaveWidgetStateInput['state'] }>({ revision: 0, disposed: false, saving: false, canSave: false, last: '{}' })
  const stateKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifact.id) && !!artifact.source.sessionId
  useEffect(() => {
    setErrors([]); setActionError(''); setState({}); setStateError('')
    const control = { revision: 0, disposed: false, saving: false, canSave: false, last: '{}' } as typeof stateControl.current
    stateControl.current = control
    if (!stateApi || !stateKey) { setStateReady(true); return () => { control.disposed = true } }
    setStateReady(false)
    void stateApi.widgetState({ sessionId: artifact.source.sessionId, artifactId: artifact.id }).then(result => {
      if (!control.disposed) { const saved = widgetStateSchema.parse(result); control.revision = saved.revision; control.canSave = true; control.last = JSON.stringify(saved.state); setState(saved.state); setStateReady(true) }
    }).catch(error => { if (!control.disposed) { setStateError(`无法恢复组件状态：${error instanceof Error ? error.message : String(error)}`); setStateReady(true) } })
    return () => { control.disposed = true; if (control.timer) clearTimeout(control.timer) }
  }, [artifact.id, artifact.source.sessionId, stateApi, stateKey])
  const updateState = (next: Record<string, unknown>) => {
    const control = stateControl.current
    const serialized = JSON.stringify(next)
    if (serialized === control.last) return
    control.last = serialized
    setState(next)
    if (!stateApi || !stateKey || !stateReady || control.disposed || !control.canSave) return
    try { control.next = saveWidgetStateSchema.shape.state.parse(JSON.parse(serialized)) } catch (error) { setStateError(`无法保存组件状态：${error instanceof Error ? error.message : String(error)}`); return }
    if (control.timer) clearTimeout(control.timer)
    const flush = async () => {
      if (control.saving || !control.next || control.disposed) return
      const value = control.next; control.next = undefined; control.saving = true
      try {
        const saved = widgetStateSchema.parse(await stateApi.saveWidgetState({ sessionId: artifact.source.sessionId, artifactId: artifact.id, expectedRevision: control.revision, state: value }))
        if (!control.disposed) { control.revision = saved.revision; setStateError('') }
      } catch (error) { if (!control.disposed) { control.next = undefined; setStateError(`无法保存组件状态：${error instanceof Error ? error.message : String(error)}`) } }
      finally { control.saving = false; if (control.next && !control.disposed) void flush() }
    }
    control.timer = setTimeout(() => { void flush() }, 300)
  }
  const visual = artifact.protocol === 'openui' && openuiEnabled && typeof artifact.payload === 'string'
    ? h('div', null, stateReady ? h(Renderer, { response: artifact.payload, library, isStreaming, initialState: state, onStateUpdate: updateState, onAction: (event) => { if (event.type !== 'continue_conversation' || !onContinue) { setActionError('此交互类型没有可用的会话执行路径，未执行任何操作。'); return }; const controller = new AbortController(); pending.add(controller); setActionError(''); void onContinue(event, state, controller.signal).catch(error => { if (!controller.signal.aborted) setActionError(`提交失败：${error instanceof Error ? error.message : String(error)}`) }).finally(() => pending.delete(controller)) }, onError: (items) => setErrors(items.map(item => item.message)) }) : h('p', { role: 'status' }, '正在恢复组件状态…'), stateError && h('p', { role: 'alert' }, stateError), errors.length > 0 && h('p', { role: 'alert' }, `OpenUI 渲染错误：${errors.join('; ')}`), actionError && h('p', { role: 'alert' }, actionError))
    : artifact.protocol === 'openui' && !openuiEnabled
      ? h('p', { role: 'status' }, 'OpenUI 展示已关闭。请查看原始内容。')
    : artifact.protocol === 'mcp-app'
      ? h(McpContent, { artifact, api: mcpApi })
      : artifact.source.kind==='assistant'?h(AssistantArtifactContent,{artifact,isStreaming}):h(ContentView, { value: artifact.payload, isStreaming,sessionId:artifact.source.sessionId,documentId:`artifact:${artifact.id}` })
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: theme }, h('section', { className: 'dsh-experience iexp-artifact', style: styles.section }, h('strong', { className: 'iexp-source-label' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'file-text', size: 15 })), artifact.source.label), h(OutputView, { sessionId: artifact.source.sessionId, raw: artifact.raw, mode: displayMode }, artifact.protocol === 'content' ? visual : artifact.protocol === 'openui' ? h(AdaptiveCompositionView,{value:{type:'openui',source:artifact.payload},isStreaming,sessionId:artifact.source.sessionId,documentId:`artifact:${artifact.id}`},h('div', { className: 'dsh-experience iexp-content', 'data-experience-theme': theme }, visual)) : h('div', { className: 'dsh-experience iexp-content', 'data-experience-theme': theme }, visual))))
}
