import { Component, Fragment, createElement as h, useCallback, useEffect, useRef, useState, useMemo, useId, useSyncExternalStore, type ReactElement, type ReactNode, type ComponentProps } from 'react'
import { Renderer, type LibraryExtension, type ActionEvent } from '@openuidev/react-lang'
import { ThemeProvider, MarkDownRenderer, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, LineChart, BarChart, IconWrapper } from '@openuidev/react-ui'
import { openuiLibrary } from '@openuidev/react-ui/genui-lib'
import { widgetStateSchema, saveWidgetStateSchema, type ExperienceArtifact, type WidgetStateApi, type SaveWidgetStateInput } from './contracts.js'
import { styles } from './style.js'
import { appearancePreferences, appearanceTokens } from './appearance.js'
import { themePreferences } from './theme-runtime.js'
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
function useSelectedTheme() { return useSyncExternalStore(themePreferences.subscribe, themePreferences.getSnapshot, themePreferences.getSnapshot) }
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
  return h('label', { className: 'dsh-experience iexp-mode-control', style: styles.modeControl, title: '统一切换本会话的智能体验输出' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'panels-top-left', size: 15 })), '显示 ', h('select', { 'aria-label': '输出显示方式', value: mode, style: styles.button, onChange: (event: { currentTarget: HTMLSelectElement }) => displayModes.set(sessionId, event.currentTarget.value as DisplayMode) }, h('option', { value: 'visual' }, '展示'), h('option', { value: 'raw' }, '原文'), h('option', { value: 'compare' }, '对照')))
}
export function OutputView({ sessionId, raw, mode: override, children }: { sessionId: string, raw: unknown, mode?: DisplayMode, children?: ReactNode }): ReactElement {
  const shared = useDisplayMode(sessionId); const mode = override ?? shared; const theme = useExperienceTheme()
  return h('div', { style: mode === 'compare' ? styles.compare : undefined }, h('div', { hidden: mode === 'raw', style: { minWidth: 0 } }, children), mode !== 'visual' && h('div', { className: 'dsh-experience iexp-content iexp-raw-output', 'data-experience-theme': theme }, h('strong', null, '原始内容'), h('pre', { style: styles.raw }, rawText(raw))))
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

function ChartSource({ plan }: { plan: AutoChartPlan }): ReactElement {
  const header = h(TableHeader, null, h(TableRow, null, h(TableHead, null, '原表项目'), ...plan.series.map((series, i) => h(TableHead, { key: i }, series.name))))
  const rows = plan.labels.map((label, row) => h(TableRow, { key: row }, h(TableCell, null, label), ...plan.series.map((series, col) => h(TableCell, { key: col }, series.originals?.[row] ?? String(series.values[row])))))
  return h('details', { className: 'iexp-disclosure' }, h('summary', null, h(IconWrapper, { name: 'table-2', size: 15 }), '图表所用原始数据'), h('div', { style: styles.overflow, tabIndex: 0, role: 'region', 'aria-label': '图表选取的原始数据' }, h(Table, null, header, h(TableBody, null, ...rows))))
}

/** Charts are derived locally; the unmodified table remains the accessible data source. */
export function AutoChart({ plan }: { plan: AutoChartPlan }): ReactElement {
  const theme = useExperienceTheme(), selectedTheme = useSelectedTheme()
  let categoryKey = 'category'
  while (plan.series.some(series => series.name === categoryKey)) categoryKey = `_${categoryKey}`
  const horizontal = plan.kind === 'bar'
  const data = plan.labels.map((label, i) => Object.fromEntries([[categoryKey, horizontal && plan.series.length === 1 ? `${label} · ${plan.series[0]!.originals?.[i] ?? `${plan.series[0]!.values[i]}${plan.series[0]!.unit}`}` : label], ...plan.series.map(series => [series.name, series.values[i]!])]))
  const colors = appearanceTokens(appearancePreferences.getSnapshot(), selectedTheme).variables
  const palette = (theme === 'dark' ? selectedTheme.tokens.paletteDark : selectedTheme.tokens.paletteLight).map((_, index) => colors[`--iexp-series-${index + 1}`]!)
  const compact = selectedTheme.tokens.comparison === 'organic' && isCompactComparison(plan)
  const chartProps = { data, categoryKey, height: horizontal ? Math.max(230, plan.labels.length * (30 + plan.series.length * 26) + 56 + (plan.series.length > 1 ? 50 : 0)) : 280, width: '100%', showYAxis: true, legend: plan.series.length > 1, grid: true, isAnimationActive: false, customPalette: palette.slice(0, plan.series.length), ...(horizontal ? { xAxisLabel: plan.series[0]?.unit || '数值' } : { yAxisLabel: plan.series[0]?.unit || '数值' }) }
  const title = plan.title ?? (plan.kind === 'line' ? '时间趋势' : '数值比较')
  const notes = plan.notes ?? []
  const caveat = [notes.some(note => /近似|不是精确/.test(note)) && '含近似值', notes.some(note => /合计行/.test(note)) && '合计未参与比较', notes.some(note => /未纳入/.test(note)) && '含排除项', notes.some(note => /未使用列/.test(note)) && '仅展示选取列', notes.some(note => /未经审计|未审计|unaudited/i.test(note)) && '未经审计'].filter(Boolean).join(' · ')
  return h('figure', { className: `iexp-chart-card${compact ? ' iexp-chart-comparison' : ''}`, 'aria-label': `自动生成的${title}`, 'data-auto-chart': plan.kind },
    h('figcaption', { className: 'iexp-card-head' }, h('span', { className: 'iexp-card-title' }, h('span', { 'aria-hidden': true, className: 'iexp-card-icon' }, h(IconWrapper, { name: plan.icon, size: 17 })), h('strong', null, title)), h('span', { className: 'iexp-card-basis' }, plan.basis || plan.series[0]?.unit || '原表数值')),
    h('div', { className: 'iexp-chart-plot' }, compact ? h(ComparisonPlot, { plan }) : plan.kind === 'line' ? h(LineChart, { ...chartProps, variant: 'linear', showDots: true, crosshair: true, highlight: true }) : h(BarChart, { ...chartProps, orientation: 'horizontal', internalLine: false, barRadius: 3, density: 'compact' })),
    h('div', { className: 'iexp-card-foot' }, caveat && h('p', { className: 'iexp-chart-caveat' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'info', size: 14 })), caveat),
      selectedTheme.tokens.composition === 'continuous' ? h('div', { className: 'iexp-chart-notes' }, h('p', null, plan.reason), !!notes.length && h('ul', null, ...notes.map((note, i) => h('li', { key: i }, note)))) : h('details', { className: 'iexp-disclosure' }, h('summary', null, h(IconWrapper, { name: 'list-filter', size: 15 }), `口径与选取说明${notes.length ? `（${notes.length}）` : ''}`), h('p', null, plan.reason), !!notes.length && h('ul', null, ...notes.map((note, i) => h('li', { key: i }, note)))), selectedTheme.tokens.composition !== 'continuous' && h(ChartSource, { plan })))
}

function SourceTable({ plans, children, supplemented = false }: { plans: AutoChartPlan[], children?: ReactNode, supplemented?: boolean }): ReactElement {
  const table = h('div', { className: 'iexp-source-table', style: styles.overflow, tabIndex: 0, role: 'region', 'aria-label': '原始数据表格' }, h(Table, null, children))
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
function MarkdownContent({ text, isStreaming }: { text: string, isStreaming: boolean }): ReactElement {
  const tables = useMemo(() => isStreaming ? [] : parseMarkdownTables(text), [text, isStreaming])
  const layout = useMemo(() => isStreaming ? { flows: [] } : parseMarkdownLayouts(text), [text, isStreaming])
  const selectedTheme = useSelectedTheme()
  const sections = useMemo(() => !isStreaming && selectedTheme.tokens.composition === 'continuous' ? planContentSections(text) : undefined, [text, isStreaming, selectedTheme.tokens.composition])
  const prefix = useId().replaceAll(':', '')
  // Stable renderer types retain native disclosures and nested layout state during polling.
  const markdownOptions = useMemo<ComponentProps<typeof MarkDownRenderer>['options']>(() => {
    const headings = Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [`h${level}`, ({ children, node }: { children?: ReactNode, node?: { position?: { start: { offset?: number } } } }) => {
      const start = node?.position?.start.offset, icon = selectIcon(headingText(children))
      const heading = h(`h${level}`, { id: start === undefined ? undefined : headingAnchor(prefix, start), tabIndex: -1, style: styles.semanticHeading }, icon !== 'file-text' && h('span', { 'aria-hidden': true, style: styles.headingIcon }, h(IconWrapper, { name: icon, size: 20 })), h('span', null, children))
      return !sections && start !== undefined && start === layout.outline?.entries[0]?.start ? h(Fragment, null, h(HeadingIndex, { plan: layout.outline, prefix }), heading) : heading
    }]))
    return { remarkPlugins: [remarkGfm, ...(sections ? [continuousSectionsPlugin(sections, layout.flows.map(flow => flow.start), tables.filter(table => table.plans.length > 1).map(table => table.start))] : [])], components: {
      ...headings,
      p: ({ children, node }) => {
        const flow = layout.flows.find(plan => plan.sourceKind === 'arrow-chain' && plan.start === node?.position?.start.offset)
        return flow ? h(SafeFlow, { plan: flow }) : h('p', null, children)
      },
      ol: ({ children, node, start }) => {
        const flow = layout.flows.find(plan => plan.sourceKind === 'ordered-list' && plan.start === node?.position?.start.offset)
        return flow ? h(SafeFlow, { plan: flow }) : h('ol', { start }, children)
      },
      table: ({ children, node }) => {
        const table = tables.find(table => table.start === node?.position?.start.offset), plans = table?.plans ?? []
        const board = table ? analyzeTaskTable(table.headers, table.rows) : undefined
        const detail = sections && !board && !plans.length && table ? planReadingTable(table.headers, table.rows) : undefined
        return h('div', { className: 'iexp-table-group' }, board ? h(BoardView, { plan: board }) : detail ? h(MasterDetailView, { plan: detail }) : plans.length > 0 && (sections ? h(PaperChartDeck, { plans, Chart: SafeAutoChart }) : h('div', { className: 'iexp-chart-grid' }, ...plans.map((plan, i) => h(SafeAutoChart, { key: i, plan })))), h(SourceTable, { plans, supplemented: !!board || !!detail }, children))
      },
    } }
  }, [layout, prefix, tables, sections])
  return h('div', { className: `iexp-document${sections ? ' iexp-continuous' : ''}`, 'data-content-layout': sections ? 'continuous' : undefined }, sections && layout.outline && h(HeadingIndex, { plan: layout.outline, prefix }), h(MarkDownRenderer, { textMarkdown: text, options: markdownOptions }))
}
function StructuredContent({ value, isStreaming }: { value: unknown, isStreaming: boolean }): ReactElement {
  const graph = isStreaming ? { status: 'unrecognized' as const } : analyzeGraph(value)
  if (graph.status === 'invalid') return h('div', null, h('p', { role: 'alert' }, '关系图数据不完整或格式不受支持，请查看原始内容。'), h('pre', { style: styles.raw }, rawText(value)))
  if (graph.status === 'valid') return h(ChartBoundary, { fallback: h('pre', { style: styles.raw }, rawText(value)) }, h(FlowView, { plan: { ...graph.plan, title: '原文关系', sourceText: rawText(value), reason: '仅绘制来源明确提供的节点与连线，图示不改变原始数据。' } }))
  const board = isStreaming ? undefined : analyzeTaskRecords(value)
  if (board) return h(BoardView, { plan: board })
  const detail = isStreaming ? undefined : analyzeMasterDetail(value)
  if (detail) return h(MasterDetailView, { plan: detail })
  const records = rowsFromRecords(value)
  if (records) {
    const { headers, rows: cells } = records, plans = isStreaming ? [] : analyzeTableCharts(headers, cells)
    const head = h(TableHeader, null, h(TableRow, null, ...headers.map(k => h(TableHead, { key: k }, k))))
    const rows = cells.map((row, i) => h(TableRow, { key: i }, ...row.map((cell, j) => h(TableCell, { key: j }, cell))))
    return h('div', { className: 'iexp-table-group' }, plans.length > 0 && h('div', { className: 'iexp-chart-grid' }, ...plans.map((plan, i) => h(SafeAutoChart, { key: i, plan }))), h(SourceTable, { plans }, head, h(TableBody, null, ...rows)))
  }
  return h('pre', { style: styles.raw }, rawText(value))
}
export function ContentView({ value, isStreaming = false }: { value: unknown, isStreaming?: boolean }): ReactElement {
  const theme = useExperienceTheme()
  let content: ReactNode
  if (typeof value === 'string') {
    let decoded: unknown, parsed = false
    try { if (/^\s*[\[{]/.test(value)) { decoded = JSON.parse(value); parsed = true } } catch { /* Ordinary Markdown remains unchanged. */ }
    content = parsed ? h(StructuredContent, { value: decoded, isStreaming }) : h(MarkdownContent, { text: value, isStreaming })
  } else if (Array.isArray(value) && value.length > 0 && value.every(x => x && typeof x === 'object' && (x as { type?: unknown }).type === 'text' && typeof (x as { text?: unknown }).text === 'string')) {
    content = value.map((part, i) => h(ContentView, { key: i, value: (part as { text: string }).text, isStreaming }))
  } else content = h(StructuredContent, { value, isStreaming })
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: theme }, h('div', { className: 'dsh-experience iexp-content iexp-reply-surface', 'data-experience-theme': theme }, content))
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
  return h('div', null, !api ? h('p', { role: 'status' }, 'MCP App 服务不可用。请查看原始内容。') : !opened ? h('button', { type: 'button', style: styles.button, onClick: () => setOpened(true) }, '打开 MCP App') : null,
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
      : h(ContentView, { value: artifact.source.kind === 'assistant' ? assistantContent(artifact.payload) : artifact.payload, isStreaming })
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: theme }, h('section', { className: 'dsh-experience iexp-artifact', style: styles.section }, h('strong', { className: 'iexp-source-label' }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'file-text', size: 15 })), artifact.source.label), h(OutputView, { sessionId: artifact.source.sessionId, raw: artifact.raw, mode: displayMode }, artifact.protocol === 'content' ? visual : h('div', { className: 'dsh-experience iexp-content', 'data-experience-theme': theme }, visual))))
}
