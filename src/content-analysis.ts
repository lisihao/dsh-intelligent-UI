import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

/** A deterministic presentation plan. Values are copied, never estimated or aggregated. */
export interface AutoChartPlan {
  kind: 'line' | 'bar'
  labels: string[]
  series: Array<{ name: string, values: number[], unit: string, originals?: string[] }>
  title?: string
  basis?: string
  notes?: string[]
  sourceRows?: number[]
  sourceColumns?: number[]
  sourceRowCount?: number
  sourceColumnCount?: number
  /** Exact omitted source positions, in zero-based half-open [start, end) ranges. */
  omittedRowRanges?: Array<[number, number]>
  /** Excludes the label column, which is always retained. */
  omittedColumnRanges?: Array<[number, number]>
  reason: string
  icon: string
}
export interface ContentTable { headers: string[], rows: string[][] }
export interface MarkdownTable extends ContentTable { context: string, start: number, end: number, plan?: AutoChartPlan, plans: AutoChartPlan[] }

/** Names use the existing OpenUI/Lucide catalog, rather than a second icon system. */
export function selectIcon(text: string): string {
  if (/风险|警告|失败|错误|隐患|未通过|不通过|未完成|未成功|不成功|未验证|未验证通过|not\s+(?:passed|verified|complete|successful)|unverified|incomplete|risk|warn|fail|error/i.test(text)) return 'triangle-alert'
  if (/成本|费用|收入|现金|预算|cost|expense|revenue|cash|budget/i.test(text)) return 'wallet'
  if (/性能|耗时|延迟|速度|performance|latency|duration|speed/i.test(text)) return 'gauge'
  if (/趋势|增长|时间序列|trend|growth|timeline/i.test(text)) return 'trending-up'
  if (/对比|比较|分布|comparison|compare|distribution/i.test(text)) return 'chart-column'
  if (/完成|通过|成功|验证|passed|success|complete|verified/i.test(text)) return 'circle-check-big'
  return 'file-text'
}

const units: Record<string, string> = {
  '倍': '倍', '%': '%', '％': '%', ms: 'ms', '毫秒': 'ms', s: 's', sec: 's', seconds: 's', '秒': 's',
  min: 'min', minutes: 'min', '分钟': 'min', h: 'h', hours: 'h', '小时': 'h',
  usd: 'USD', '美元': 'USD', '$': 'USD', cny: 'CNY', rmb: 'CNY', '人民币': 'CNY', '元': 'CNY',
  '亿元': '亿元', '万元': '万元', '亿美元': '亿美元', '万美元': '万美元',
  kb: 'KB', mb: 'MB', gb: 'GB', tb: 'TB', kib: 'KiB', mib: 'MiB', gib: 'GiB',
  '个': '个', '次': '次', '项': '项', '条': '条', '人': '人',
}
const unit = (text: string): string | undefined => units[text.trim().toLowerCase()]
function headerUnit(header: string): string | undefined {
  const match = header.match(/[（(]([^()（）]+)[）)]\s*$/)
  if (match) return unit(match[1]!)
  if (/(?:%|％)\s*$/.test(header)) return '%'
  const suffix = header.match(/(?:_|\s)(ms|seconds|sec|s|minutes|min|hours|h|usd|cny|rmb|kb|mb|gb|tb|kib|mib|gib)$/i)
  if (suffix) return unit(suffix[1]!)
  return undefined
}
interface NumericCell { value: number, unit: string, original: string, approximate: boolean, qualification: string }
function numeric(text: string, inheritedUnit?: string): NumericCell | undefined {
  const original = text
  const clean = text.trim().replaceAll('−', '-')
  const match = clean.match(/^(约|大约|近|≈|~)?\s*([$])?\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+-]?\.\d+)\s*([^\d\s()（）]*)(?:\s*[（(]([^()（）]+)[）)])?$/)
  if (!match) return undefined
  const prefix = match[2] ? unit(match[2]) : undefined
  const suffix = match[4] ? unit(match[4]) : undefined
  if (match[4] && !suffix || prefix && suffix && prefix !== suffix) return undefined
  const explicit = prefix ?? suffix
  if (inheritedUnit && explicit && inheritedUnit !== explicit) return undefined
  const value = Number(match[3]!.replaceAll(',', ''))
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return undefined
  return { value, unit: explicit ?? inheritedUnit ?? '', original, approximate: !!match[1], qualification: match[5]?.trim() ?? '' }
}

/** Recognize only unambiguous time labels; no Date.parse locale guessing. */
function timeKey(text: string): { kind: string, order: number } | undefined {
  let match = text.trim().match(/^(\d{4})(?:[-/年](\d{1,2})(?:[-/月](\d{1,2})日?)?月?)?$/)
  if (match) {
    const year = Number(match[1]), month = Number(match[2] ?? 1), day = Number(match[3] ?? 1)
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
    return { kind: match[3] ? 'day' : match[2] ? 'month' : 'year', order: date.getTime() }
  }
  match = text.trim().match(/^(\d{4})\s*(?:年?\s*Q([1-4])|年第([一二三四1-4])季度)$/i)
  if (match) return { kind: 'quarter', order: Number(match[1]) * 4 + Number(match[2] ?? ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[match[3]!] ?? match[3]) }
  return undefined
}

export function chartLabelPosition(label: string): number | undefined { return timeKey(label)?.order }

const identifierHeader = /(?:^|[\s_\-])(id|uuid|sku|version|year|month|day|date|index)(?:$|[\s_\-(])/i
const identifierChinese = /编号|标识|版本|年份|月份|日期|序号|代码|邮编|电话/
function isIdentifier(header: string): boolean { return identifierHeader.test(header) || identifierChinese.test(header) || /^\d{4}(?:年)?$/.test(header) }

/** Period identity comes from the actual row/column, never unrelated surrounding prose. */
function periodOf(text: string): string {
  // A fiscal/calendar equivalence is usable only when the source explicitly supplies it.
  const equivalent = text.match(/[（(]\s*(?:即|equivalent to)\s*(\d{4})\s*Q([1-4])\s*[）)]/i)
  if (equivalent) return `${equivalent[1]} Q${equivalent[2]}`
  if (/\bTTM\b|滚动(?:十二|12)个月|trailing (?:twelve|12) months/i.test(text)) {
    const end = text.match(/(?:截至|ending)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}\s*Q[1-4])/i)?.[1]
    return `TTM${end ? ` · ${end}` : ''}`
  }
  const quarter = text.match(/(FY)?\s*(\d{4})\s*(?:年?\s*Q([1-4])|年第([一二三四1-4])季度)/i)
  if (quarter) return `${quarter[1] ? 'FY' : ''}${quarter[2]} Q${quarter[3] ?? ({ 一: 1, 二: 2, 三: 3, 四: 4 } as Record<string, number>)[quarter[4]!] ?? quarter[4]}`
  const half = text.match(/(\d{4})\s*年?\s*(上半年|下半年|H[12])/i)
  if (half) return `${half[1]} ${/上|H1/i.test(half[2]!) ? 'H1' : 'H2'}`
  const year = text.match(/(\d{4})\s*年?\s*(?:全年|年度|annual)/i)
  if (year) return `${year[1]} 全年`
  if (/\bYTD\b|年初至今/i.test(text)) return `YTD${text.match(/\d{4}/)?.[0] ?? ''}`
  if (/全年|\bannual\b/i.test(text)) return '全年'
  if (/半年|\bhalf[- ]year\b/i.test(text)) return '半年'
  if (/月度|\bmonthly\b/i.test(text)) return '月度'
  return ''
}
function declaredUnit(context: string): { value?: string, invalid: boolean } {
  const texts = Array.from(context.matchAll(/(?:单位)(?:均)?\s*(?:为|是|[:：])\s*([^\s，,。;；）)]+)|\bunit\s*[:：]\s*([^\s，,。;；）)]+)/gi), match => match[1] ?? match[2]!)
  const values = texts.map(unit)
  return { value: values[0], invalid: values.some(value => !value) || new Set(values).size > 1 }
}
const totalLabel = /^(?:合计|总计|总额|总数|汇总|total|sum)(?:\s*[（(].*[）)])?$/i
const directComparisonBan = /不可比|不能直接比较|不宜直接比较|not comparable|do not compare/i
const sourceWarning = /口径|假设|估算|测算|近似|不可|不能|不宜|假定|定义|未经审计|未审计|unaudited|definition|scenario|assum|estimat|different|not comparable/i

/** Complement sorted source indices without scanning every omitted row for every group. */
function omittedRanges(included: number[], end: number, start = 0): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const index of included) {
    if (index > start) ranges.push([start, index])
    start = index + 1
  }
  if (start < end) ranges.push([start, end])
  return ranges
}
const NOTE_EXAMPLES = 6
function examples(count: number, labels: string[]): string { return labels.join('、') + (count > labels.length ? `；另有 ${count - labels.length} 项，完整位置见原表` : '') }

/** Extract compatible subsets. Omitted positions stay exact even when explanatory examples are summarized. */
export function analyzeTableCharts(headers: string[], rows: string[][], context = '', unitContext = context): AutoChartPlan[] {
  if (headers.length < 2 || rows.length < 2 || headers.some(header => !header.trim()) || new Set(headers).size !== headers.length || rows.some(row => row.length !== headers.length)) return []
  const labels = rows.map(row => row[0]!.trim())
  if (labels.some(label => label.length > 120) || new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length) return []
  const times = labels.map(timeKey)
  const temporal = times.every((value): value is NonNullable<typeof value> => !!value)
  if (times.some(Boolean) && !temporal) return []
  if (temporal && (new Set(times.map(value => value.kind)).size !== 1 || times.some((value, index) => index > 0 && value.order <= times[index - 1]!.order))) return []
  if (!temporal && (isIdentifier(headers[0]!) || /^(?:时间|日期|年月|月份|年份|季度|period|time|timestamp|date)$/i.test(headers[0]!.trim()) || labels.some(label => numeric(label) !== undefined))) return []
  // An explicit ban on comparison still wins; warnings against summation do not prohibit non-aggregated views.
  if (directComparisonBan.test(context)) return []
  const inherited = declaredUnit(unitContext)
  if (inherited.invalid) return []
  const basePeriod = periodOf(unitContext)
  const sourceNotes = context.split(/\n|(?<=[。；;])/).filter(text => sourceWarning.test(text)).map(text => text.trim()).filter(Boolean)
  type Candidate = { column: number, period: string, rowPeriod: string, rows: number[], cells: NumericCell[] }
  const candidates: Candidate[] = []
  const totalRows = rows.flatMap((row, index) => totalLabel.test(row[0]!.trim()) ? [index] : [])
  const totalRowSet = new Set(totalRows)
  const nonTotalRows = rows.flatMap((_row, index) => totalRowSet.has(index) ? [] : [index])
  const totalNote = totalRows.length ? `合计行未参与分项比较：${examples(totalRows.length, totalRows.slice(0, NOTE_EXAMPLES).map(index => labels[index]!))}；原表保留合计值。` : undefined
  for (let column = 1; column < headers.length; column++) {
    const header = headers[column]!
    const columnPeriod = periodOf(header)
    if (isIdentifier(header) && !columnPeriod || /[（(][^()（）]+[）)]\s*$/.test(header) && !headerUnit(header) && !columnPeriod || headerUnit(header) && inherited.value && headerUnit(header) !== inherited.value) { continue }
    const parsed = rows.map(row => numeric(row[column]!, headerUnit(header) ?? inherited.value))
    if (/资本支出|capex/i.test(header) && new Set(parsed.filter((cell): cell is NumericCell => !!cell).map(cell => cell.qualification)).size > 1) continue
    const groups = new Map<string, { rows: number[], cells: NumericCell[], rowPeriod: string }>()
    for (let row = 0; row < rows.length; row++) {
      const cell = parsed[row]
      if (!cell || !labels[row] || totalRowSet.has(row)) continue
      const rowPeriod = temporal ? '' : periodOf(labels[row]!)
      // Distinct qualifiers can denote distinct measurement definitions (cash PP&E vs finance leases).
      const key = JSON.stringify([cell.unit, rowPeriod, cell.qualification])
      const group = groups.get(key) ?? { rows: [], cells: [], rowPeriod }
      group.rows.push(row); group.cells.push(cell); groups.set(key, group)
    }
    for (const group of groups.values()) {
      if (group.rows.length < 2) continue
      candidates.push({ column, period: columnPeriod || group.rowPeriod || basePeriod || (/年度|annual/i.test(header) ? '年度' : ''), rowPeriod: group.rowPeriod, rows: group.rows, cells: group.cells })
    }
  }
  const compatible = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.period, candidate.cells[0]!.unit, candidate.rows, candidate.cells[0]!.qualification])
    const group = compatible.get(key) ?? []; group.push(candidate); compatible.set(key, group)
  }
  const plans: AutoChartPlan[] = []
  for (const group of compatible.values()) {
    // At most four series per axis; all remaining compatible columns get another complete view.
    for (let start = 0; start < group.length; start += 4) {
      const chosen = group.slice(start, start + 4), first = chosen[0]!
      const basis = [first.period, first.cells[0]!.unit && `单位：${first.cells[0]!.unit}`, first.cells[0]!.qualification].filter(Boolean).join('；')
      const notes = [...sourceNotes]
      if (totalNote) notes.push(totalNote)
      const included = new Set(first.rows), omittedCount = rows.length - first.rows.length - totalRows.length
      if (omittedCount) {
        const sample: string[] = []
        for (const index of nonTotalRows) {
          if (!included.has(index)) sample.push(`${labels[index] || `第${index + 1}行`}（${chosen.map(item => rows[index]![item.column]).join('；')}）`)
          if (sample.length === NOTE_EXAMPLES) break
        }
        notes.push(`${omittedCount <= NOTE_EXAMPLES ? '本图未纳入：' : `本图未纳入 ${omittedCount} 行：`}${examples(omittedCount, sample)}。原因：缺失、非数值、单位、期间或数据定义不同；完整数据见原表。`)
      }
      const sourceColumns = chosen.map(item => item.column)
      const selectedColumns = new Set(sourceColumns), omittedColumnCount = headers.length - 1 - chosen.length
      if (omittedColumnCount) {
        const sample: string[] = []
        for (let column = 1; column < headers.length && sample.length < NOTE_EXAMPLES; column++) if (!selectedColumns.has(column)) sample.push(headers[column]!)
        notes.push(`${omittedColumnCount <= NOTE_EXAMPLES ? '本图未使用列：' : `本图未使用列（${omittedColumnCount} 列）：`}${examples(omittedColumnCount, sample)}；仍保留在原表。`)
      }
      let approximationCount = 0
      const approximationSample: string[] = []
      for (const item of chosen) for (let index = 0; index < item.cells.length; index++) {
        const cell = item.cells[index]!
        if (!cell.approximate) continue
        approximationCount++
        if (approximationSample.length < NOTE_EXAMPLES) approximationSample.push(`${labels[item.rows[index]!]} / ${headers[item.column]}：${cell.original}`)
      }
      if (approximationCount) notes.push(approximationCount <= NOTE_EXAMPLES ? `含原文近似值（不是精确值）：${approximationSample.join('；')}。` : `含原文近似值（不是精确值，共 ${approximationCount} 项）：${examples(approximationCount, approximationSample)}。`)
      const titlePeriod = chosen.every(item => periodOf(headers[item.column]!) === first.period) ? '' : first.period
      const title = [titlePeriod, chosen.map(item => headers[item.column]).join(' / '), approximationCount ? '含近似值' : ''].filter(Boolean).join(' · ')
      plans.push({ kind: temporal ? 'line' : 'bar', labels: first.rows.map(index => labels[index]!), series: chosen.map(item => ({ name: headers[item.column]!, values: item.cells.map(cell => cell.value), unit: item.cells[0]!.unit, originals: item.cells.map(cell => cell.original) })), title, basis, notes: [...new Set(notes)], sourceRows: first.rows, sourceColumns, sourceRowCount: rows.length, sourceColumnCount: headers.length, omittedRowRanges: omittedRanges(first.rows, rows.length), omittedColumnRanges: omittedRanges(sourceColumns, headers.length, 1), reason: temporal ? '仅展示所列时间序列；未补值、换算或年化，完整口径见原表。' : '从原表提取可绘制的列与分组；不汇总、不年化，完整口径见原表。', icon: temporal ? 'trending-up' : 'chart-column' })
    }
  }
  return plans
}
/** Compatibility helper for callers that need only the first plan. */
export function analyzeTable(headers: string[], rows: string[][], context = '', unitContext = context): AutoChartPlan | undefined { return analyzeTableCharts(headers, rows, context, unitContext)[0] }

const processor = unified().use(remarkParse).use(remarkGfm)
type AstNode = { type: string, value?: string, children?: AstNode[], position?: { start: { offset?: number }, end: { offset?: number } } }
function plainText(node: AstNode): string { return node.value ?? node.children?.map(plainText).join('') ?? '' }
function unreliableCell(node: AstNode): boolean { return ['delete', 'html', 'footnoteReference', 'image', 'imageReference'].includes(node.type) || !!node.children?.some(unreliableCell) }
/** Source offsets and table cells come from the maintained CommonMark/GFM AST, never a pipe-splitting parser. */
export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const tree = processor.parse(markdown) as AstNode
  const result: MarkdownTable[] = []
  const walk = (node: AstNode, heading = '') => {
    let context = heading
    const siblings = node.children ?? []
    for (let index = 0; index < siblings.length; index++) {
      const child = siblings[index]!
      if (child.type === 'heading') context = plainText(child)
      if (child.type === 'table') {
        const cells = child.children?.map(row => row.children?.map(plainText) ?? []) ?? []
        const headers = cells[0] ?? [], rows = cells.slice(1)
        const start = child.position?.start.offset, end = child.position?.end.offset
        if (start !== undefined && end !== undefined) {
          // Keep qualifications on either side, but never borrow from another table or section.
          const before = siblings.slice(0, index)
          const previousBoundary = before.findLastIndex(sibling => sibling.type === 'table' || sibling.type === 'heading')
          const preceding = before.slice(previousBoundary + 1)
          const nextBoundary = siblings.findIndex((sibling, siblingIndex) => siblingIndex > index && (sibling.type === 'table' || sibling.type === 'heading'))
          const following = siblings.slice(index + 1, nextBoundary < 0 ? siblings.length : nextBoundary)
          const prefix = preceding.map(plainText).join('\n').slice(-500)
          const suffix = following.map(plainText).join('\n')
          const unitProse = preceding.findLast(sibling => sibling.type === 'paragraph')
          const nearby = `${context}\n${unitProse ? plainText(unitProse) : prefix}\n${suffix}`
          const cellNodes = child.children?.map(row => row.children ?? []) ?? []
          const safeRows = rows.map((row, rowIndex) => row.map((value, column) => unreliableCell(cellNodes[rowIndex + 1]?.[column] ?? { type: 'text' }) ? '' : value))
          const plans = analyzeTableCharts(headers, safeRows, nearby, unitProse ? plainText(unitProse) : '').map(plan => ({ ...plan, series: plan.series.map((series, index) => ({ ...series, originals: plan.sourceRows!.map(row => { const cell = cellNodes[row + 1]?.[plan.sourceColumns![index]!]; const parts = cell?.children; const from = parts?.[0]?.position?.start.offset; const to = parts?.at(-1)?.position?.end.offset; return from !== undefined && to !== undefined ? markdown.slice(from, to) : rows[row]![plan.sourceColumns![index]!]! }) })) }))
          result.push({ headers, rows, context, start, end, plans, plan: plans[0] })
        }
      } else if (child.type !== 'code' && child.type !== 'inlineCode') walk(child, context)
    }
  }
  walk(tree)
  return result
}

/** Tables are inferred only from complete primitive records; nested or incomplete JSON stays as source. */
export function rowsFromRecords(value: unknown): ContentTable | undefined {
  if (!Array.isArray(value) || !value.length || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return undefined
  const records = value as Array<Record<string, unknown>>
  const headers = Object.keys(records[0]!)
  if (!headers.length || records.some(row => Object.keys(row).length !== headers.length || headers.some(key => !(key in row) || !['string', 'number', 'boolean'].includes(typeof row[key])))) return undefined
  return { headers, rows: records.map(row => headers.map(key => String(row[key]))) }
}
