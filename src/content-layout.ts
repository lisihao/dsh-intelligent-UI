import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, Paragraph, List } from 'mdast'
import { z } from 'zod'

export interface SourceSpan { start: number, end: number, original: string }
export interface FlowStep extends SourceSpan { text: string }
export interface FlowPlan extends SourceSpan {
  kind: 'flow'
  relationship: 'sequence'
  sourceKind: 'arrow-chain' | 'ordered-list'
  steps: FlowStep[]
}
export interface GraphPlan {
  kind: 'graph'
  nodes: Array<{ id: string, label: string, description?: string }>
  edges: Array<{ source: string, target: string, label?: string }>
}
export type GraphAnalysis =
  | { status: 'unrecognized' }
  | { status: 'invalid', error: { name: 'InvalidGraphPayload', message: string } }
  | { status: 'valid', plan: GraphPlan }
export interface BoardItem {
  title: string
  description?: string
  /** Kept for source access, never a request to display internal identifiers. */
  record: Readonly<Record<string, unknown>>
  sourceRow?: number
  cells?: string[]
}
export interface BoardPlan {
  kind: 'board'
  readonly: true
  /** Original source order remains independent of status grouping. */
  records: ReadonlyArray<Readonly<Record<string, unknown>>>
  groups: Array<{ status: string, items: BoardItem[] }>
  headers?: string[]
}
export interface HeadingEntry extends SourceSpan { text: string, depth: 2 | 3, parent?: number }
export interface HeadingIndexPlan { kind: 'heading-index', entries: HeadingEntry[] }
export interface MasterDetailPlan { kind: 'master-detail', items: BoardItem[] }

const processor = unified().use(remarkParse).use(remarkGfm)
const MAX_MARKDOWN_LENGTH = 500_000
function span(source: string, node: { position?: { start: { offset?: number }, end: { offset?: number } } }): SourceSpan | undefined {
  const start = node.position?.start.offset, end = node.position?.end.offset
  return start === undefined || end === undefined ? undefined : { start, end, original: source.slice(start, end) }
}
function nodeText(node: { value?: string, children?: unknown[] }): string {
  return node.value ?? node.children?.map(child => nodeText(child as Parameters<typeof nodeText>[0])).join('') ?? ''
}
function paragraphStep(source: string, paragraph: Paragraph): FlowStep | undefined {
  // Code, markup, links and footnotes can carry meaning that a plain diagram label loses.
  if (!paragraph.children.every(child => child.type === 'text')) return undefined
  const sourceSpan = span(source, paragraph)
  if (!sourceSpan || !sourceSpan.original.trim() || sourceSpan.original.length > 2_000) return undefined
  return { ...sourceSpan, text: nodeText(paragraph) }
}
function arrowFlow(source: string, paragraph: Paragraph): FlowPlan | undefined {
  const step = paragraphStep(source, paragraph)
  if (!step || /[\n\r`]/.test(step.original)) return undefined
  const arrows = [...step.original.matchAll(/->|→/g)]
  if (!arrows.length || arrows.length > 11) return undefined
  // The AST decodes Markdown escapes. Inspect the same source span to keep escaped arrows literal.
  if (arrows.some(arrow => {
    let slashes = 0
    for (let index = arrow.index! - 1; index >= 0 && step.original[index] === '\\'; index--) slashes++
    return slashes % 2 === 1
  })) return undefined
  const boundaries = [0, ...arrows.map(arrow => arrow.index! + arrow[0].length)]
  const steps: FlowStep[] = []
  for (let index = 0; index < boundaries.length; index++) {
    const from = boundaries[index]!, to = arrows[index]?.index ?? step.original.length
    const segment = step.original.slice(from, to)
    const text = segment.trim()
    if (!text || text.length > 500) return undefined
    const start = step.start + from + segment.indexOf(text)
    steps.push({ start, end: start + text.length, original: text, text })
  }
  return { kind: 'flow', relationship: 'sequence', sourceKind: 'arrow-chain', start: step.start, end: step.end, original: step.original, steps }
}
function orderedFlow(source: string, list: List, context: string): FlowPlan | undefined {
  // Numbered findings or information gaps are enumerations, not processes.
  if (!/流程|步骤|操作顺序|执行顺序|\b(?:workflow|steps|procedure)\b/i.test(context) || !list.ordered || list.children.length < 2 || list.children.length > 12) return undefined
  const listSpan = span(source, list)
  if (!listSpan) return undefined
  const steps: FlowStep[] = []
  for (const item of list.children) {
    // Nested lists, multi-paragraph items and checked tasks remain complete Markdown.
    if (item.children.length !== 1 || item.children[0]?.type !== 'paragraph' || item.checked != null) return undefined
    const step = paragraphStep(source, item.children[0])
    if (!step) return undefined
    steps.push(step)
  }
  return { kind: 'flow', relationship: 'sequence', sourceKind: 'ordered-list', ...listSpan, steps }
}

/** CommonMark/GFM AST positions are UTF-16 offsets, matching String.slice and the source renderer. */
export function parseMarkdownLayouts(markdown: string): { flows: FlowPlan[], outline?: HeadingIndexPlan } {
  if (markdown.length > MAX_MARKDOWN_LENGTH) return { flows: [] }
  const root = processor.parse(markdown) as Root
  const flows: FlowPlan[] = [], entries: HeadingEntry[] = []
  let parent: number | undefined
  let heading = '', preceding = ''
  // Only top-level prose is eligible; quoted examples, code and table cells are not workflow assertions.
  for (const node of root.children) {
    const flow = node.type === 'paragraph' ? arrowFlow(markdown, node) : node.type === 'list' ? orderedFlow(markdown, node, `${heading}\n${preceding}`) : undefined
    if (flow) flows.push(flow)
    preceding = node.type === 'paragraph' ? nodeText(node) : ''
    if (node.type === 'heading') {
      heading = nodeText(node)
      if (node.depth === 1) parent = undefined
      if (node.depth !== 2 && node.depth !== 3) continue
      const sourceSpan = span(markdown, node)
      if (!sourceSpan) continue
      const entry: HeadingEntry = { ...sourceSpan, text: heading, depth: node.depth }
      if (node.depth === 3 && parent !== undefined) entry.parent = parent
      if (node.depth === 2) parent = entries.length
      entries.push(entry)
    }
  }
  return { flows, ...(entries.length >= 4 && entries.length <= 100 ? { outline: { kind: 'heading-index' as const, entries } } : {}) }
}

const nonempty = (maximum: number) => z.string().max(maximum).refine(value => value.trim().length > 0, 'Expected nonempty text')
const graphSchema = z.object({
  nodes: z.array(z.object({ id: nonempty(200), label: nonempty(1_000), description: z.string().max(10_000).optional() }).strict()).min(1),
  edges: z.array(z.object({ source: nonempty(200), target: nonempty(200), label: z.string().max(1_000).optional() }).strict()),
}).strict().superRefine((graph, context) => {
  if (new TextEncoder().encode(JSON.stringify(graph)).byteLength > 1024 * 1024) context.addIssue({ code: 'custom', message: 'Graph exceeds the host 1 MiB source boundary' })
  const ids = new Set<string>()
  graph.nodes.forEach((node, index) => {
    if (ids.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: 'Duplicate node ID' })
    ids.add(node.id)
  })
  graph.edges.forEach((edge, index) => {
    for (const key of ['source', 'target'] as const) {
      if (!ids.has(edge[key])) context.addIssue({ code: 'custom', path: ['edges', index, key], message: 'Unknown node ID' })
    }
  })
})
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
/** Recognized but invalid graph data has a named error; callers keep the original payload visible. */
export function analyzeGraph(value: unknown): GraphAnalysis {
  if (!isRecord(value) || !Object.hasOwn(value, 'nodes') && !Object.hasOwn(value, 'edges')) return { status: 'unrecognized' }
  const parsed = graphSchema.safeParse(value)
  if (!parsed.success) return { status: 'invalid', error: { name: 'InvalidGraphPayload', message: parsed.error.issues.map(issue => `${issue.path.join('.') || 'graph'}: ${issue.message}`).join('; ') } }
  return { status: 'valid', plan: { kind: 'graph', ...parsed.data } }
}

const statusNames = /^(?:status|state|状态|任务状态)$/i
const taskNames = /^(?:task|task[ _-]?(?:name|title)|任务|任务名称|任务名|任务标题)$/i
const ordinaryNames = /^(?:title|name|标题|名称)$/i
const descriptionNames = /^(?:description|detail|details|描述|说明|详情)$/i
const financialFields = /(?:revenue|income|cash|profit|valuation|amount|price|payment|invoice|balance|财务|营收|收入|现金|利润|估值|金额|价格|付款|账单|余额)/i
function homogeneousRecords(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length < 2 || !value.every(isRecord)) return undefined
  const records = value as Array<Record<string, unknown>>, keys = Object.keys(records[0]!)
  if (!keys.length || records.some(record => Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key)))) return undefined
  return records
}
function textField(record: Record<string, unknown>, key: string | undefined): string | undefined {
  const value = key === undefined ? undefined : record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
function board(records: Array<Record<string, unknown>>, titleKey: string, statusKey: string, descriptionKey?: string): BoardPlan | undefined {
  const groups = new Map<string, BoardItem[]>()
  for (const record of records) {
    const title = textField(record, titleKey), status = textField(record, statusKey)
    if (!title || !status || title.length > 10_000 || status.length > 200) return undefined
    const description = textField(record, descriptionKey)
    const item: BoardItem = { title, ...(description ? { description } : {}), record }
    const items = groups.get(status) ?? []
    items.push(item); groups.set(status, items)
  }
  return { kind: 'board', readonly: true, records, groups: [...groups].map(([status, items]) => ({ status, items })) }
}
/** Unknown status strings remain exact columns, in first-source-occurrence order. */
export function analyzeTaskRecords(value: unknown): BoardPlan | undefined {
  const records = homogeneousRecords(value)
  if (!records) return undefined
  const keys = Object.keys(records[0]!), explicitTask = keys.find(key => taskNames.test(key))
  const title = explicitTask ?? keys.find(key => ordinaryNames.test(key)), status = keys.find(key => statusNames.test(key))
  if (!title || !status || !explicitTask && keys.some(key => financialFields.test(key))) return undefined
  return board(records, title, status, keys.find(key => descriptionNames.test(key)))
}
/** A generic Name/Status table might describe companies or accounts; require an explicit Task header. */
export function analyzeTaskTable(headers: string[], rows: string[][]): BoardPlan | undefined {
  if (headers.length < 2 || new Set(headers).size !== headers.length || rows.length < 2 || rows.some(row => row.length !== headers.length)) return undefined
  const title = headers.find(key => taskNames.test(key)), status = headers.find(key => statusNames.test(key))
  if (!title || !status) return undefined
  const records = rows.map(row => Object.fromEntries(headers.map((key, index) => [key, row[index]!])) as Record<string, unknown>)
  const plan = board(records, title, status, headers.find(key => descriptionNames.test(key)))
  if (!plan) return undefined
  const sourceRows = new Map(records.map((record, index) => [record, index]))
  for (const group of plan.groups) for (const item of group.items) {
    item.sourceRow = sourceRows.get(item.record)!
    item.cells = [...rows[item.sourceRow]!]
  }
  return { ...plan, headers: [...headers] }
}

/** A substantial existing description supports selection/detail; short numeric records stay tables. */
export function analyzeMasterDetail(value: unknown): MasterDetailPlan | undefined {
  const records = homogeneousRecords(value)
  if (!records) return undefined
  const keys = Object.keys(records[0]!), titleKey = keys.find(key => ordinaryNames.test(key) || taskNames.test(key)), descriptionKey = keys.find(key => descriptionNames.test(key))
  if (!titleKey || !descriptionKey) return undefined
  const items: BoardItem[] = []
  for (const record of records) {
    const title = textField(record, titleKey), description = textField(record, descriptionKey)
    if (!title || title.length > 1_000 || !description || description.trim().length < 80 || description.length > 20_000) return undefined
    items.push({ title, description, record })
  }
  return { kind: 'master-detail', items }
}
