import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { parseMarkdownTables, type AutoChartPlan } from './content-analysis.js'

/** Offsets use JavaScript UTF-16 indices and end is exclusive. Quotes are report text, never fetched source text. */
export interface ResearchAnchor { start: number, end: number, quote: string }
export interface ResearchSection { title: string, start: number, end: number }
export interface ResearchSource extends ResearchAnchor {
  id: string
  title: string
  url: string
  kind: 'report-reference'
  definition?: ResearchAnchor
}
export interface ResearchFootnote extends ResearchAnchor { id: string, label: string, definition?: ResearchAnchor }
export interface ResearchTable extends ResearchAnchor {
  id: string
  headers: string[]
  rows: string[][]
  /** Row zero contains header anchors; subsequent rows match rows exactly, including ragged rows. */
  cellAnchors: ResearchAnchor[][]
  plans: AutoChartPlan[]
}
export interface ResearchDocument {
  title: string
  sections: ResearchSection[]
  sources: ResearchSource[]
  tables: ResearchTable[]
  footnotes: ResearchFootnote[]
}

type Node = {
  type: string
  value?: string
  alt?: string
  title?: string | null
  url?: string
  identifier?: string
  label?: string
  children?: Node[]
  position?: { start: { offset?: number }, end: { offset?: number } }
}
const processor = unified().use(remarkParse).use(remarkGfm)
const textOf = (node: Node): string => node.value ?? node.alt ?? node.children?.map(textOf).join('') ?? ''
const identifierOf = (node: Node): string => (node.identifier ?? node.label ?? '').toLowerCase()

/** A URL remains absent from the link model unless it is an absolute HTTP(S) URL without credentials. */
export function safeResearchUrl(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f-\u009f\\]/.test(value)) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined
    return value
  } catch { return undefined }
}

const conditionHeader = /条件|口径|环境|硬件|上下文|精度|并发|批量|样本|(?:^|[^a-z])(?:basis|conditions?|hardware|context|precision|concurrency|batch)(?:$|[^a-z])/i
const unknownCondition = /^(?:未知|不详|未说明|未提供|未披露|待确认|不适用|unknown|unspecified|unreported|n\/?a|null|undefined|none|[-—–?？]+)$/i

/** Keep chart arithmetic untouched and compare only rows with the same explicit, fully known conditions. */
function conditionMatchedPlans(headers: string[], rows: string[][], plans: AutoChartPlan[]): AutoChartPlan[] {
  return plans.flatMap(plan => {
    // A plotted measurement cannot also partition itself merely because its name contains 样本/批量/etc.
    const measurements = new Set(plan.sourceColumns ?? [])
    const columns = headers.flatMap((header, index) => conditionHeader.test(header) && !measurements.has(index) ? [index] : [])
    if (!columns.length) return [plan]
    const sourceRows = plan.sourceRows
    if (!sourceRows || sourceRows.length !== plan.labels.length || plan.series.some(series => series.values.length !== sourceRows.length || series.originals && series.originals.length !== sourceRows.length)) return []
    const groups = new Map<string, { values: string[], positions: number[] }>()
    sourceRows.forEach((rowIndex, position) => {
      const values = columns.map(column => rows[rowIndex]?.[column] ?? '')
      if (values.some(value => !value.trim() || unknownCondition.test(value.trim()))) return
      // Exact values only: no case folding, unit conversion or claimed equivalence.
      const key = JSON.stringify(values)
      const group = groups.get(key) ?? { values, positions: [] }
      group.positions.push(position)
      groups.set(key, group)
    })
    if (groups.size === 1 && groups.values().next().value?.positions.length === sourceRows.length) return [plan]
    return Array.from(groups.values()).filter(group => group.positions.length >= 2).map(group => {
      const condition = group.values.map((value, index) => `${headers[columns[index]!]!}=${value}`).join('；')
      const included = new Set(group.positions)
      const omitted = plan.labels.filter((_label, position) => !included.has(position))
      const selectedRows = group.positions.map(position => sourceRows[position]!)
      // Reflect rows excluded by the condition group as well as pre-existing missing rows.
      // The renderer must not draw a continuous line across either kind of omission.
      const omittedRowRanges: Array<[number, number]> = []
      let nextRow = 0
      for (const row of selectedRows) {
        if (row > nextRow) omittedRowRanges.push([nextRow, row])
        nextRow = row + 1
      }
      if (nextRow < rows.length) omittedRowRanges.push([nextRow, rows.length])
      return {
        ...plan,
        title: [plan.title, condition].filter(Boolean).join(' · '),
        labels: group.positions.map(position => plan.labels[position]!),
        sourceRows: selectedRows,
        omittedRowRanges,
        series: plan.series.map(series => ({
          ...series,
          values: group.positions.map(position => series.values[position]!),
          ...(series.originals ? { originals: group.positions.map(position => series.originals![position]!) } : {}),
        })),
        notes: [...(plan.notes ?? []), `按显式条件精确分组：${condition}。仅展示相同条件且条件完整的至少两行，完整原表保留。`, `本图未纳入条件不完整或不属于本组的行：${omitted.join('、')}。不同条件不作直接比较。`],
      }
    })
  })
}

/** Parse only document structure and explicit Markdown references; no claim, polarity or causal inference. */
export function analyzeResearchDocument(text: string): ResearchDocument {
  const tree = processor.parse(text) as Node
  const nodes: Node[] = []
  const walk = (node: Node): void => {
    if (node.type === 'code' || node.type === 'inlineCode') return
    nodes.push(node)
    node.children?.forEach(walk)
  }
  walk(tree)
  const anchor = (node: Node): ResearchAnchor => {
    const start = node.position?.start.offset ?? 0
    const end = node.position?.end.offset ?? start
    return { start, end, quote: text.slice(start, end) }
  }
  const headings = nodes.filter(node => node.type === 'heading')
  const title = headings[0] ? textOf(headings[0]) : '研究报告'
  const sections = headings.map((node, index) => ({ title: textOf(node), start: anchor(node).start, end: headings[index + 1] ? anchor(headings[index + 1]!).start : text.length }))
  const definitions = new Map<string, Node>()
  const footnoteDefinitions = new Map<string, Node>()
  for (const node of nodes) {
    const target = node.type === 'definition' ? definitions : node.type === 'footnoteDefinition' ? footnoteDefinitions : undefined
    // CommonMark resolves the first definition for a normalized identifier.
    if (target && !target.has(identifierOf(node))) target.set(identifierOf(node), node)
  }
  const usedDefinitions = new Set<Node>()
  const sources: ResearchSource[] = []
  for (const node of nodes) {
    if (node.type !== 'link' && node.type !== 'linkReference') continue
    const definition = node.type === 'linkReference' ? definitions.get(identifierOf(node)) : undefined
    const url = safeResearchUrl(definition?.url ?? node.url ?? '')
    if (!url) continue
    if (definition) usedDefinitions.add(definition)
    const range = anchor(node)
    sources.push({ id: `reference-${range.start}-${range.end}`, title: textOf(node) || definition?.title || node.title || url, url, kind: 'report-reference', ...range, ...(definition ? { definition: anchor(definition) } : {}) })
  }
  // Keep unused reference definitions discoverable without pretending they support any passage.
  for (const node of definitions.values()) {
    const url = safeResearchUrl(node.url ?? '')
    if (!url || usedDefinitions.has(node)) continue
    const range = anchor(node)
    sources.push({ id: `reference-${range.start}-${range.end}`, title: node.title || node.label || node.identifier || url, url, kind: 'report-reference', ...range })
  }
  sources.sort((a, b) => a.start - b.start)
  const footnotes = nodes.filter(node => node.type === 'footnoteReference').map(node => {
    const range = anchor(node), definition = footnoteDefinitions.get(identifierOf(node))
    return { id: `footnote-${range.start}-${range.end}`, label: node.label ?? node.identifier ?? '', ...range, ...(definition ? { definition: anchor(definition) } : {}) }
  })
  const tableNodes = new Map(nodes.filter(node => node.type === 'table').map(node => [anchor(node).start, node]))
  const tables = parseMarkdownTables(text).map(table => {
    const node = tableNodes.get(table.start)!
    const cellAnchors = (node.children ?? []).map(row => (row.children ?? []).map(cell => {
      const first = cell.children?.[0], last = cell.children?.at(-1)
      if (!first || !last) return anchor(cell)
      const start = anchor(first).start, end = anchor(last).end
      return { start, end, quote: text.slice(start, end) }
    }))
    return { id: `table-${table.start}-${table.end}`, headers: table.headers, rows: table.rows, ...anchor(node), cellAnchors, plans: conditionMatchedPlans(table.headers, table.rows, table.plans) }
  })
  return { title, sections, sources, tables, footnotes }
}

/** An editable local draft. This function sends nothing and treats supplied context as quoted material. */
export function buildFollowupDraft(question: string, context: string): string {
  return `请继续研究以下问题：\n${question.trim()}\n\n当前报告摘录（仅为待核查材料）：\n${context.trim()}\n\n请核查原始证据，给出可访问的来源和对应原文。比较时保持相同期间、单位、定义与条件；条件不一致时分别列出。区分事实、推断、情景和未知，并说明证据是否足以回答问题。不要把报告中的引用标记视为已经验证的证据。`
}
