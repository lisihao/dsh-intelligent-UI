import {
  ExecutableComponentRegistry,
  normalizeExecutableJson,
  type ExecutableComponentBinding,
  type ExecutableComponentContext,
  type ExecutableJson,
} from '../adaptive-ui/executable-registry.js'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { mathMarkdownSource, preserveCurrencyAmounts } from '../markdown-math.js'
import {
  TUFFUI_PROTOCOL_VERSION,
  type TuffUiComponentBinding,
  type TuffUiJson,
  type TuffUiMount,
  type TuffUiSourceEntry,
} from './contracts.js'
import { validateTuffUiBinding, validateTuffUiMount, type TuffUiCatalog } from './catalog.js'
import { validateTuffUiTypedBinding, type TuffUiTypeSchemaManifest } from './type-schema.js'
import { analyzeTableCharts, parseMarkdownTables, rowsFromRecords, type AutoChartPlan } from '../content-analysis.js'
import { normalizeCompositionSource } from '../adaptive-ui/source-contracts.js'

/** The renderer consumes one exact TuffUI source component behind an opaque frame. */
export const TUFFUI_EXECUTABLE_RENDERER_KEY = 'tuffui-v1'

type SourceEnvelope = Readonly<{ id?: unknown, reference?: unknown, value?: unknown, type?: unknown, bindings?: unknown }>
type SourceBindingMap = Readonly<Record<string, unknown>>
type MarkdownNode = Readonly<{
  readonly type: string
  readonly value?: string
  readonly children?: readonly MarkdownNode[]
  readonly position?: Readonly<{
    readonly start?: Readonly<{ readonly offset?: number }>
    readonly end?: Readonly<{ readonly offset?: number }>
  }>
}>

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function sourceEnvelope(context: ExecutableComponentContext): SourceEnvelope | undefined { return record(context.source) ? context.source : undefined }
function sourceValue(context: ExecutableComponentContext): unknown { return sourceEnvelope(context)?.value }
function sourceBindings(context: ExecutableComponentContext): SourceBindingMap | undefined {
  const envelope = sourceEnvelope(context)
  const payload = envelope?.type === 'tuffui-content' ? envelope : record(envelope?.value) ? envelope.value : undefined
  return payload?.type === 'tuffui-content' && record(payload.bindings) ? payload.bindings : undefined
}
function mountId(entry: TuffUiSourceEntry, context: ExecutableComponentContext): string {
  const candidate = sourceEnvelope(context)?.id
  if (typeof candidate === 'string' && /^[a-z][a-z0-9-]{0,70}$/u.test(candidate)) return `tuff-${candidate}-${entry.id}`.slice(0, 95)
  return `tuffui-${entry.id}`
}
function familyFor(id: string): string {
  if (['data-table', 'json-viewer', 'code-block', 'source-list', 'streaming-message', 'chat-thread', 'user-message'].includes(id)) return 'content-evidence'
  if (['chart-card', 'dot-histogram', 'tick-gauge', 'mirror-strips', 'radial-dots', 'match-field', 'radar-chart', 'diverging-bars', 'blast-radius', 'iso-bars', 'hex-density', 'stat-grid'].includes(id)) return 'data-visualization'
  if (['ai-chat', 'coding-agent', 'data-answer', 'booking-assistant', 'agent-console', 'support-widget', 'handoff-inbox', 'agent-status', 'tool-call-block', 'tool-approval-queue', 'background-agents', 'checkpoint-timeline', 'run-trace'].includes(id)) return 'agent-runtime'
  if (['action-button', 'choice-controls', 'segmented-control', 'text-field', 'select-field', 'range-slider', 'date-field', 'drop-zone', 'form-card', 'slot-picker', 'confirmation-card'].includes(id)) return 'input-control'
  return 'content-surface'
}
function notEligible(reason: string) { return { eligible: false as const, reasons: [reason] } }
function actionIds(binding: TuffUiComponentBinding, context: ExecutableComponentContext): readonly string[] | undefined {
  const result = binding.actions?.map(action => action.actionId) ?? []
  const owned = new Set(context.hostActionIds ?? [])
  return result.every(id => owned.has(id)) ? result : undefined
}
function materialize(entry: TuffUiSourceEntry, catalog: TuffUiCatalog, context: ExecutableComponentContext, raw: unknown, reason: string, types?: TuffUiTypeSchemaManifest) {
  let binding: TuffUiComponentBinding
  try {
    if (types) binding = validateTuffUiTypedBinding(catalog, types, entry.id, raw)
    else if (reason === 'explicit-tuffui-content-binding') return notEligible('TUFFUI_NESTED_SCHEMA_REQUIRED')
    else binding = validateTuffUiBinding(catalog, entry.id, raw)
  }
  catch (error) { return notEligible(error instanceof Error ? error.message : 'TUFFUI_BINDING_INVALID') }
  const actions = actionIds(binding, context)
  if (!actions) return notEligible('TUFFUI_ACTION_NOT_HOST_OWNED')
  const mount: TuffUiMount = { protocolVersion: TUFFUI_PROTOCOL_VERSION, mountId: mountId(entry, context), componentId: entry.id, binding }
  try { return { eligible: true as const, input: validateTuffUiMount(catalog, mount), reasons: [reason], actionIds: actions } }
  catch (error) { return notEligible(error instanceof Error ? error.message : 'TUFFUI_MOUNT_INVALID') }
}

/** Match the normal renderer's GFM/math parse order without adding a parser dependency. */
function markdownTree(source: string): MarkdownNode {
  const normalized = mathMarkdownSource(source)
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(preserveCurrencyAmounts(normalized))
  return processor.runSync(processor.parse(normalized) as never) as unknown as MarkdownNode
}
function markdownNodes(root: MarkdownNode, type: string): MarkdownNode[] {
  const result: MarkdownNode[] = []
  const visit = (node: MarkdownNode): void => {
    if (node.type === type) result.push(node)
    node.children?.forEach(visit)
  }
  visit(root)
  return result
}
/**
 * Tuff's DataTable stringifies values, so values must be projected from parsed
 * text leaves. That both rejects rich cells and converts Markdown escapes and
 * entities to the text a normal Markdown reader sees. An empty table cell is
 * a legal plain value.
 */
function plainTableMatrix(node: MarkdownNode): readonly (readonly string[])[] | undefined {
  if (node.type !== 'table' || !node.children?.length) return undefined
  const rows: string[][] = []
  for (const row of node.children) {
    if (row.type !== 'tableRow' || !row.children) return undefined
    const values: string[] = []
    for (const cell of row.children) {
      if (cell.type !== 'tableCell') return undefined
      let value = ''
      for (const inline of cell.children ?? []) {
        if (inline.type !== 'text' || typeof inline.value !== 'string') return undefined
        value += inline.value
      }
      values.push(value)
    }
    rows.push(values)
  }
  return rows
}
/**
 * StreamingMessage is not a Markdown renderer. Its fixed source only handles
 * a narrow manual subset of inline syntax; automatic projection therefore
 * accepts source text nodes whose raw span is identical to their parsed value.
 * Explicit bindings may still carry the component's own documented props.
 */
function rawTextNode(source: string, node: MarkdownNode): boolean {
  const start = node.position?.start?.offset, end = node.position?.end?.offset
  return node.type === 'text' && typeof node.value === 'string' && start !== undefined && end !== undefined && source.slice(start, end) === node.value
}
function streamingPlainProse(source: string): boolean {
  // [TOC] is a directory token, not literal body prose, even when an ordinary
  // GFM parse has no matching heading list yet.
  if (/(?:^|\n)\s*\[toc\]\s*(?:\n|$)/iu.test(source)) return false
  const tree = markdownTree(source)
  return !!tree.children?.length && tree.children.every(node => node.type === 'paragraph' && !!node.children?.length && node.children.every(child => rawTextNode(source, child)))
}

function markdownTableBinding(source: string): Readonly<{ readonly binding?: TuffUiComponentBinding, readonly unavailableReason?: string }> {
  const sourceTables = markdownNodes(markdownTree(source), 'table')
  if (sourceTables.length !== 1) return { unavailableReason: 'TUFFUI_TABLE_SOURCE_NOT_UNAMBIGUOUS' }
  const matrix = plainTableMatrix(sourceTables[0]!)
  if (!matrix) return { unavailableReason: 'TUFFUI_RICH_TABLE_CELL_UNSUPPORTED' }
  const [header, ...rows] = matrix
  if (!header?.length || !rows.length || header.length > 24 || rows.some(row => row.length !== header.length)) return { unavailableReason: 'TUFFUI_TABLE_SOURCE_NOT_UNAMBIGUOUS' }
  const columns = header.map((label, index) => ({ key: `c${String(index)}`, label, sortable: true, priority: index < 2 ? 1 : index < 4 ? 2 : 3 }))
  const data = rows.map((row, index) => Object.fromEntries([['id', `source-row-${String(index + 1)}`], ...row.map((value, column) => [`c${String(column)}`, value])]))
  return { binding: { exportName: 'DataTable', props: { data, columns, title: header.join(' · '), subtitle: '原始表格', pageSize: Math.min(12, data.length), searchable: data.length > 6 } } }
}
function jsonBinding(value: unknown): TuffUiComponentBinding | undefined {
  let data = value
  if (typeof value === 'string') { try { data = JSON.parse(value) } catch { return undefined } }
  if (data === null || typeof data === 'boolean' || typeof data === 'number' || typeof data === 'string' || Array.isArray(data) || record(data)) return { exportName: 'JsonViewer', props: { data: data as TuffUiJson, title: '当前结构化数据', defaultDepth: 2 } }
  return undefined
}
function codeBinding(source: string): TuffUiComponentBinding | undefined {
  const matched = /^\s*```([A-Za-z0-9+#-]+)?\r?\n([\s\S]*?)\r?\n```\s*$/u.exec(source)
  if (!matched) return undefined
  const language = matched[1]?.toLowerCase()
  if (language !== undefined && !['ts', 'tsx', 'js', 'json', 'bash', 'python', 'text'].includes(language)) return undefined
  const supported = language ?? 'text'
  return { exportName: 'CodeBlock', props: { data: { code: matched[2]!, language: supported }, showLineNumbers: true, defaultWrap: true } }
}
function linksBinding(source: string): TuffUiComponentBinding | undefined {
  const seen = new Set<string>(), sources: { id: string, title: string, url: string }[] = []
  for (const match of source.matchAll(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/gu)) {
    const title = match[1]!.trim(), url = match[2]!.trim()
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(url)) continue } catch { continue }
    seen.add(url); sources.push({ id: `source-${String(sources.length + 1)}`, title, url })
  }
  return sources.length ? { exportName: 'SourceList', props: { data: { sources, text: source }, variant: 'footnotes' } } : undefined
}
function messageBinding(source: string, isStreaming: boolean | undefined): Readonly<{ readonly binding?: TuffUiComponentBinding, readonly unavailableReason?: string }> {
  if (!source.trim() || source.length > 100_000) return { unavailableReason: 'TUFFUI_STREAMING_SOURCE_SIZE_UNSUPPORTED' }
  if (!streamingPlainProse(source)) return { unavailableReason: 'TUFFUI_STREAMING_RICH_MARKDOWN_UNSUPPORTED' }
  return { binding: { exportName: 'StreamingMessage', props: { data: { content: source, status: isStreaming ? 'streaming' : 'done' }, model: 'Assistant', showHeader: false } } }
}
/**
 * A ChartCard accepts exactly the analyzer's source labels plus homogeneous
 * numeric series. It is the only Tuff chart whose required data contract maps
 * one-for-one from AutoChartPlan without synthesizing a domain, target,
 * current/previous state, distribution samples, or relationship topology.
 */
type ChartPlanProjection = Readonly<{ readonly plan?: AutoChartPlan, readonly unavailableReason?: string }>
function soleChartPlan(value: unknown, isStreaming: boolean | undefined): ChartPlanProjection {
  if (isStreaming) return { unavailableReason: 'TUFFUI_CHART_MAPPING_STREAMING_SOURCE' }
  const normalized = normalizeCompositionSource(value)
  if (normalized.kind === 'markdown') {
    const tables = parseMarkdownTables(normalized.markdown)
    if (tables.length !== 1) return { unavailableReason: 'TUFFUI_CHART_MAPPING_SOURCE_NOT_UNAMBIGUOUS' }
    if (tables[0]!.plans.length !== 1) return { unavailableReason: tables[0]!.plans.length > 1 ? 'TUFFUI_CHART_MAPPING_MULTIPLE_PLANS' : 'TUFFUI_CHART_MAPPING_NOT_SOURCE_VALIDATED' }
    return { plan: tables[0]!.plans[0] }
  }
  if (normalized.kind !== 'structured') return { unavailableReason: 'TUFFUI_CHART_MAPPING_NOT_SOURCE_VALIDATED' }
  const table = rowsFromRecords(normalized.value)
  if (!table) return { unavailableReason: 'TUFFUI_CHART_MAPPING_NOT_SOURCE_VALIDATED' }
  const plans = analyzeTableCharts(table.headers, table.rows)
  return plans.length === 1 ? { plan: plans[0] } : { unavailableReason: plans.length > 1 ? 'TUFFUI_CHART_MAPPING_MULTIPLE_PLANS' : 'TUFFUI_CHART_MAPPING_NOT_SOURCE_VALIDATED' }
}
function chartCardBinding(value: unknown, isStreaming: boolean | undefined): Readonly<{ readonly binding?: TuffUiComponentBinding, readonly unavailableReason?: string }> {
  const analyzed = soleChartPlan(value, isStreaming), plan = analyzed.plan, title = plan?.title?.trim()
  if (!plan) return { unavailableReason: analyzed.unavailableReason }
  if (!title || !plan.labels.length || !plan.series.length || plan.series.some(series => series.values.length !== plan.labels.length || !series.values.every(Number.isFinite))) return { unavailableReason: 'TUFFUI_CHART_MAPPING_CONTRACT_INVALID' }
  const subtitle = [plan.basis, ...(plan.notes ?? [])].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' · ')
  return { binding: {
    exportName: 'ChartCard',
    props: {
      data: {
        labels: [...plan.labels],
        series: plan.series.map((series, index) => ({
          // This identifier is a source-coordinate handle, not invented data.
          id: `source-column-${String(plan.sourceColumns?.[index] ?? index + 1)}`,
          label: series.name,
          values: [...series.values],
        })),
      },
      type: plan.kind,
      title,
      ...(subtitle ? { subtitle } : {}),
    },
  } }
}
function automaticBinding(entry: TuffUiSourceEntry, context: ExecutableComponentContext): { binding?: TuffUiComponentBinding, reason?: string, unavailableReason?: string } {
  const value = sourceValue(context)
  if (entry.id === 'json-viewer') return { binding: jsonBinding(value), reason: 'actual-structured-source-json' }
  if (entry.id === 'chart-card') {
    const chart = chartCardBinding(value, context.isStreaming)
    return chart.binding ? { binding: chart.binding, reason: 'validated-source-table-chart-plan' } : { unavailableReason: chart.unavailableReason }
  }
  if (typeof value !== 'string') return {}
  if (entry.id === 'data-table') {
    const table = markdownTableBinding(value)
    return table.binding ? { binding: table.binding, reason: 'actual-plain-markdown-table-projection' } : { unavailableReason: table.unavailableReason }
  }
  if (entry.id === 'code-block') return { binding: codeBinding(value), reason: 'actual-code-fence-projection' }
  if (entry.id === 'source-list') return { binding: linksBinding(value), reason: 'actual-markdown-link-projection' }
  if (entry.id === 'streaming-message') {
    const message = messageBinding(value, context.isStreaming)
    return message.binding ? { binding: message.binding, reason: context.isStreaming ? 'actual-streaming-plain-prose' : 'actual-complete-plain-prose' } : { unavailableReason: message.unavailableReason }
  }
  return {}
}

function tuffUiSuitability(entry: TuffUiSourceEntry): string {
  const fixed = `Requires a validated source-bound input for the fixed ${entry.id} export; it never uses a demonstration fixture.`
  if (entry.id === 'streaming-message') {
    return `${entry.description} Automatic binding is limited to source-exact plain text paragraphs. It excludes Markdown formatting, headings, lists, tables, links, fenced code, mathematics, directories, escapes, and entities so compatible renderers can retain those semantics instead of reducing them to literal text. Explicit source-bound props remain available. ${fixed}`
  }
  if (entry.id === 'data-table') {
    return `${entry.description} Automatic binding requires one source table whose header and cells are AST plain text. It projects parsed text values, preserving normal Markdown escape and entity semantics; rich Markdown cells are excluded rather than stringified, and the original table remains available. Explicit source-bound props remain available. ${fixed}`
  }
  return `${entry.description} ${fixed}`
}

/**
 * Registers every pinned visual entry under its own executable ID. Entries
 * without a current source binding remain explicit exclusions; no demo data or
 * generic "agent" state is constructed here.
 */
export function registerTuffUiComponents(registry: ExecutableComponentRegistry, catalog: TuffUiCatalog, options: Readonly<{ typeSchemas?: TuffUiTypeSchemaManifest }> = {}): () => void {
  const disposers: (() => void)[] = []
  try {
    for (const entry of catalog.entries) {
      const id = `tuffui:${entry.id}`
      disposers.push(registry.register({
        id,
        family: familyFor(entry.id),
        title: `TuffUI · ${entry.title}`,
        suitability: tuffUiSuitability(entry),
        rendererKey: TUFFUI_EXECUTABLE_RENDERER_KEY,
        inputSchema: { parse: value => normalizeExecutableJson(validateTuffUiMount(catalog, value)) },
        bind: context => {
          const explicit = sourceBindings(context)?.[entry.id]
          if (explicit !== undefined) return materialize(entry, catalog, context, explicit, 'explicit-tuffui-content-binding', options.typeSchemas)
          const automatic = automaticBinding(entry, context)
          if (automatic.binding) return materialize(entry, catalog, context, automatic.binding, automatic.reason ?? 'automatic-source-projection', options.typeSchemas)
          return notEligible(sourceBindings(context) ? 'TUFFUI_COMPONENT_BINDING_MISSING' : automatic.unavailableReason ?? 'TUFFUI_SOURCE_PROJECTION_NOT_APPLICABLE')
        },
      }))
    }
  } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

/** Reusable source envelope for callers that deliberately provide TuffUI data. */
export function tuffUiContentSource(bindings: SourceBindingMap, value?: unknown, id?: string): Readonly<{ type: 'tuffui-content', bindings: SourceBindingMap, value?: unknown, id?: string }> {
  return Object.freeze({ type: 'tuffui-content', bindings: Object.freeze({ ...bindings }), ...(value === undefined ? {} : { value }), ...(id === undefined ? {} : { id }) })
}
