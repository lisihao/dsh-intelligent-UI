import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { EffectDomain } from './effect-planner.js'

/** A text offset in the supplied Markdown, measured in UTF-16 code units. */
export interface CanvasDomainAnchor { readonly start: number; readonly end: number }
export interface CanvasResearchEvidence {
  readonly sections: { readonly count: number; readonly anchors: readonly CanvasDomainAnchor[] }
  readonly citations: { readonly paragraphs: number; readonly sections: number; readonly distinctHosts: number; readonly anchors: readonly CanvasDomainAnchor[] }
  readonly technical: { readonly paragraphs: number; readonly sections: number; readonly topicGroups: number; readonly anchors: readonly CanvasDomainAnchor[] }
  readonly empirical: { readonly tables: number; readonly citedParagraphs: number; readonly anchors: readonly CanvasDomainAnchor[] }
}

/** Classification is advisory. It does not verify references or select any visual effect. */
export type CanvasAutoPriorDomain = 'quantitative' | 'project-management' | 'coding'
export interface CanvasAutoDomainContext { readonly priorDomain?: CanvasAutoPriorDomain }

export type CanvasAutoDomainDecision =
  | { readonly status: 'identified'; readonly domain: EffectDomain; readonly basis: 'explicit-domain'; readonly evidence: { readonly field: 'domain' } }
  | { readonly status: 'identified'; readonly domain: CanvasAutoPriorDomain; readonly basis: 'existing-domain-evidence'; readonly evidence: { readonly kind: 'prior-domain' | 'structured-record' | 'markdown-table' | 'code-fence' } }
  | { readonly status: 'identified'; readonly domain: 'technical-insight'; readonly basis: 'structural-evidence'; readonly evidence: CanvasResearchEvidence }
  | { readonly status: 'unclassified'; readonly reason: 'unsupported-source' | 'invalid-declared-domain' | 'too-large' | 'code-dominant' | 'instruction-guide' | 'insufficient-evidence'; readonly evidence?: CanvasResearchEvidence }

type Node = {
  readonly type: string
  readonly depth?: number
  readonly value?: string
  readonly url?: string
  readonly identifier?: string
  readonly position?: { readonly start: { readonly offset?: number }; readonly end: { readonly offset?: number } }
  readonly children?: readonly Node[]
}
type ParagraphEvidence = { section: number; anchor: CanvasDomainAnchor; hosts: Set<string>; groups: Set<number>; measured: boolean }
type Section = { anchor: CanvasDomainAnchor; guide: boolean; reference: boolean; hasProse: boolean }

const markdown = unified().use(remarkParse).use(remarkGfm)
const validDomains = new Set<EffectDomain>(['technical-insight', 'coding', 'project-management', 'quantitative', 'general'])
const MAX_MARKDOWN_CHARS = 1024 * 1024
const MAX_EVIDENCE_ANCHORS = 6
const MIN_BODY_ALNUM = 24
const GUIDE_HEADING = /^(?:installation|install|getting started|quick\s*start|usage|configuration|configuration guide|setup|examples?|troubleshooting|how to (?:install|use|configure)|安装(?:指南|教程|步骤|与准备)?|使用(?:指南|教程|方法|说明)?|快速开始|快速入门|配置(?:指南|说明|方法)?|环境配置|操作步骤|示例|疑难排查|故障排除)(?:\s|[：:（(]|$)/iu
const REFERENCE_HEADING = /^(?:references?|sources?|bibliography|works cited|参考文献|参考资料|资料来源|引用来源)(?:\s|[：:（(]|$)/iu
const TOPICS = [
  /(?:\b(?:ai|llm|llms|gpt|agentic)\b|artificial intelligence|large language model|machine learning|deep learning|人工智能|大语言模型|大模型|神经网络|机器学习|深度学习|智能体)/iu,
  /(?:\b(?:gpu|cpu|tpu|fpga|npu)\b|data cent(?:er|re)|semiconductor|inference|算力|推理|芯片|晶圆|半导体|训练集群|数据中心)/iu,
  /(?:\b(?:api|sdk|webgl|webgpu|kubernetes|database|compiler|cloud computing|distributed systems?)\b|数据库|软件架构|系统架构|分布式系统|云计算|编译器|量子计算|开源软件)/iu,
] as const
const NUMBER = /(?:^|[^\p{L}\p{N}])[-+]?\d[\d,]*(?:\.\d+)?(?:$|[^\p{L}\p{N}])/u
const MEASURED = /[-+]?\d[\d,]*(?:\.\d+)?\s*(?:%|％|亿美元|亿元|万元|美元|人民币|千瓦时|兆瓦|万亿|亿|万|倍|毫秒|秒|小时|token(?:s)?(?:\/s)?|tok\/s|gb|gib|mb|mib|tb|tib|ms|ns|watt(?:s)?|tflops|兆字节|万台|台)(?![a-z])/iu
const UNIT = /(?:%|％|亿美元|亿元|万元|美元|人民币|毫秒|秒|小时|兆瓦|token|tok\/s|\bgb\b|\bgib\b|\bmb\b|\bmib\b|\btb\b|\btib\b|\bms\b|\bns\b|\bwatt(?:s)?\b|瓦|percent)/iu

function span(node: Node): CanvasDomainAnchor | undefined {
  const start = node.position?.start.offset, end = node.position?.end.offset
  return typeof start === 'number' && typeof end === 'number' && end > start ? { start, end } : undefined
}
function meaningfulLength(value: string): number { let count = 0; for (const _ of value.matchAll(/[\p{L}\p{N}]/gu)) count++; return count }
function text(node: Node, excludeLinks = false): string {
  if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html' || node.type === 'image' || node.type === 'imageReference') return ''
  if (excludeLinks && (node.type === 'link' || node.type === 'linkReference')) return ''
  return node.value ?? node.children?.map(child => text(child, excludeLinks)).join('') ?? ''
}
function normalizedIdentifier(value: string): string { return value.toLowerCase().replace(/\s+/gu, ' ').trim() }
function hostFor(url: string): string | undefined {
  if (/[\u0000-\u0020\u007f-\u009f\\]/u.test(url)) return undefined
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password ? parsed.hostname.toLowerCase().replace(/^www\./u, '') : undefined
  } catch { return undefined }
}
function linkHosts(node: Node, definitions: ReadonlyMap<string, string>, footnotes: ReadonlyMap<string, Node>, hosts: Set<string>, visited = new Set<string>()): void {
  if (['code', 'inlineCode', 'html', 'image', 'imageReference'].includes(node.type)) return
  if (node.type === 'footnoteReference' && node.identifier) {
    const id = normalizedIdentifier(node.identifier)
    if (visited.has(id)) return
    visited.add(id)
    const definition = footnotes.get(id)
    if (definition) linkHosts(definition, definitions, footnotes, hosts, visited)
    return
  }
  if (node.type === 'link' || node.type === 'linkReference') {
    const url = node.url ?? (node.identifier ? definitions.get(normalizedIdentifier(node.identifier)) : undefined)
    const host = url && hostFor(url)
    if (host) hosts.add(host)
    return
  }
  node.children?.forEach(child => linkHosts(child, definitions, footnotes, hosts, visited))
}
function hasMeasuredTable(node: Node): boolean {
  const rows = node.children ?? []
  if (rows.length < 3) return false
  const headers = (rows[0]?.children ?? []).map(cell => text(cell))
  const numericRowsByColumn: number[] = []
  for (const row of rows.slice(1)) {
    for (const [index, cell] of (row.children ?? []).entries()) {
      const value = text(cell)
      if (MEASURED.test(value) || (UNIT.test(headers[index] ?? '') && NUMBER.test(` ${value} `))) {
        numericRowsByColumn[index] = (numericRowsByColumn[index] ?? 0) + 1
      }
    }
  }
  return numericRowsByColumn.some(count => count >= 2)
}
function anchors(values: readonly CanvasDomainAnchor[]): readonly CanvasDomainAnchor[] { return values.slice(0, MAX_EVIDENCE_ANCHORS) }
function ownValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function structuredDomain(source: unknown): 'quantitative' | 'project-management' | undefined {
  if (!source || typeof source !== 'object') return undefined
  const pending: object[] = [source], seen = new Set<object>()
  let tasks = false
  while (pending.length) {
    const item = pending.pop()!
    if (seen.has(item)) continue
    seen.add(item)
    if (!Array.isArray(item)) {
      const time = ['date', 'time', 'timestamp', '日期', '时间'].some(key => {
        const value = ownValue(item, key)
        return (typeof value === 'string' && !!value.trim()) || (typeof value === 'number' && Number.isFinite(value))
      })
      const price = ['close', 'nav', '收盘', '净值'].some(key => { const value = ownValue(item, key); return typeof value === 'number' && Number.isFinite(value) })
      if (time && price) return 'quantitative'
      const status = ['status', 'state', '状态'].some(key => { const value = ownValue(item, key); return typeof value === 'string' && !!value.trim() })
      const task = ['task', 'taskTitle', 'issue', '任务', '工单'].some(key => { const value = ownValue(item, key); return typeof value === 'string' && !!value.trim() })
      if (status && task) tasks = true
    }
    for (const key of Object.keys(item)) {
      const value = ownValue(item, key)
      if (value && typeof value === 'object') pending.push(value)
    }
  }
  return tasks ? 'project-management' : undefined
}
function markdownDomain(root: Node): 'quantitative' | 'project-management' | undefined {
  const pending = [root]
  let tasks = false
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'table' && node.children && node.children.length > 1) {
      const headers = (node.children[0]?.children ?? []).map(cell => text(cell).trim().toLowerCase())
      const date = headers.findIndex(header => /^(?:date|time|timestamp|日期|时间)$/u.test(header))
      const close = headers.findIndex(header => /^(?:close|nav|收盘|收盘价|净值)$/u.test(header))
      const task = headers.findIndex(header => /^(?:task|issue|ticket|任务|事项|工单)$/u.test(header))
      const status = headers.findIndex(header => /^(?:status|state|状态)$/u.test(header))
      for (const row of node.children.slice(1)) {
        const cells = (row.children ?? []).map(cell => text(cell).trim())
        if (date >= 0 && close >= 0
          && /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:\b|$)/u.test(cells[date] ?? '')
          && /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u.test(cells[close] ?? '')) return 'quantitative'
        if (task >= 0 && status >= 0 && cells[task] && cells[status]) tasks = true
      }
    }
    node.children?.forEach(child => pending.push(child))
  }
  return tasks ? 'project-management' : undefined
}

/**
 * Recognize only a source-owned domain declaration or a highly evidenced technical
 * report. Preserve explicitly supplied domain/prior; assess the whole report
 * before allowing a single task table or code example to classify its domain.
 * Code, lists/navigation, blockquotes and unused reference definitions do not
 * supply research evidence. Failure means "unknown", not "general".
 */
export function classifyCanvasAutoDomain(source: unknown, context: CanvasAutoDomainContext = {}): CanvasAutoDomainDecision {
  if (source === undefined || source === null || (typeof source === 'string' && !source.trim())) return { status: 'unclassified', reason: 'unsupported-source' }
  let raw: string | undefined
  if (typeof source === 'string') raw = source
  else if (source && typeof source === 'object' && !Array.isArray(source)) {
    const declared = ownValue(source, 'domain')
    if (declared !== undefined && declared !== null) {
      if (typeof declared !== 'string' || !validDomains.has(declared as EffectDomain)) return { status: 'unclassified', reason: 'invalid-declared-domain' }
      return { status: 'identified', domain: declared as EffectDomain, basis: 'explicit-domain', evidence: { field: 'domain' } }
    }
    const value = ownValue(source, 'text')
    if (typeof value === 'string') raw = value
  }
  const suppliedPrior = context.priorDomain
  if (suppliedPrior !== undefined) {
    if (!['quantitative', 'project-management', 'coding'].includes(suppliedPrior)) return { status: 'unclassified', reason: 'invalid-declared-domain' }
    return { status: 'identified', domain: suppliedPrior, basis: 'existing-domain-evidence', evidence: { kind: 'prior-domain' } }
  }
  const structured = structuredDomain(source)
  if (raw === undefined || !raw.trim()) return structured
    ? { status: 'identified', domain: structured, basis: 'existing-domain-evidence', evidence: { kind: 'structured-record' } }
    : { status: 'unclassified', reason: 'unsupported-source' }
  if (raw.length > MAX_MARKDOWN_CHARS) return structured
    ? { status: 'identified', domain: structured, basis: 'existing-domain-evidence', evidence: { kind: 'structured-record' } }
    : { status: 'unclassified', reason: 'too-large' }
  const root = markdown.parse(raw) as Node
  const tableDomain = markdownDomain(root)
  const earlier = structured === 'quantitative' || tableDomain === 'quantitative' ? 'quantitative'
    : structured === 'project-management' || tableDomain === 'project-management' ? 'project-management' : undefined
  const existing = earlier ? { status: 'identified', domain: earlier, basis: 'existing-domain-evidence', evidence: { kind: structured === earlier ? 'structured-record' : 'markdown-table' } } as const : undefined
  const hasCodeFence = /(?:^|\n)\s*(```|~~~)[^\n]*\n[\s\S]*?\n\s*\1/mu.test(raw)
  const coding = { status: 'identified', domain: 'coding', basis: 'existing-domain-evidence', evidence: { kind: 'code-fence' } } as const
  const definitions = new Map<string, string>()
  const footnotes = new Map<string, Node>()
  for (const node of root.children ?? []) {
    if (node.type === 'definition' && node.identifier && node.url) {
      const key = normalizedIdentifier(node.identifier)
      if (!definitions.has(key)) definitions.set(key, node.url)
    }
    if (node.type === 'footnoteDefinition' && node.identifier) {
      const key = normalizedIdentifier(node.identifier)
      if (!footnotes.has(key)) footnotes.set(key, node)
    }
  }
  const sections: Section[] = [], paragraphs: ParagraphEvidence[] = [], tables: CanvasDomainAnchor[] = []
  let codeLength = 0, proseLength = 0
  const composition = [root]
  while (composition.length) {
    const node = composition.pop()!
    if (node.type === 'code') { codeLength += node.value?.length ?? 0; continue }
    if (node.type === 'paragraph') { proseLength += meaningfulLength(text(node, true)); continue }
    if (node.type !== 'definition' && node.type !== 'footnoteDefinition') node.children?.forEach(child => composition.push(child))
  }
  let current = -1
  for (const node of root.children ?? []) {
    if (node.type === 'heading' && (node.depth ?? 0) <= 3) {
      const anchor = span(node)
      if (!anchor) { current = -1; continue }
      const label = text(node).trim().replace(/^(?:\d+(?:[.)、．]|\s+)|[一二三四五六七八九十]+[、.．])\s*/u, '')
      sections.push({ anchor, guide: GUIDE_HEADING.test(label), reference: REFERENCE_HEADING.test(label), hasProse: false })
      current = sections.length - 1
      continue
    }
    const section = sections[current]
    if (!section || section.reference) continue
    if (node.type === 'table') {
      const anchor = span(node)
      if (anchor && hasMeasuredTable(node)) tables.push(anchor)
      continue
    }
    if (node.type !== 'paragraph') continue
    const body = text(node, true), length = meaningfulLength(body), anchor = span(node)
    if (!anchor || length < MIN_BODY_ALNUM) continue
    section.hasProse = true
    const hosts = new Set<string>(); linkHosts(node, definitions, footnotes, hosts)
    const groups = new Set<number>()
    TOPICS.forEach((pattern, index) => { if (pattern.test(body)) groups.add(index) })
    paragraphs.push({ section: current, anchor, hosts, groups, measured: MEASURED.test(body) })
  }
  const bodySections = sections.filter(section => section.hasProse && !section.reference)
  const cited = paragraphs.filter(paragraph => paragraph.hosts.size > 0)
  const citedSections = new Set(cited.map(paragraph => paragraph.section))
  const hosts = new Set(cited.flatMap(paragraph => [...paragraph.hosts]))
  const technical = paragraphs.filter(paragraph => paragraph.groups.size > 0)
  const technicalSections = new Set(technical.map(paragraph => paragraph.section))
  const topicGroups = new Set(technical.flatMap(paragraph => [...paragraph.groups]))
  const measuredCited = cited.filter(paragraph => paragraph.measured)
  const measuredSections = new Set(measuredCited.map(paragraph => paragraph.section))
  const evidence: CanvasResearchEvidence = {
    sections: { count: bodySections.length, anchors: anchors(bodySections.map(section => section.anchor)) },
    citations: { paragraphs: cited.length, sections: citedSections.size, distinctHosts: hosts.size, anchors: anchors(cited.map(paragraph => paragraph.anchor)) },
    technical: { paragraphs: technical.length, sections: technicalSections.size, topicGroups: topicGroups.size, anchors: anchors(technical.map(paragraph => paragraph.anchor)) },
    empirical: { tables: tables.length, citedParagraphs: measuredCited.length, anchors: anchors([...tables, ...measuredCited.map(paragraph => paragraph.anchor)]) },
  }
  if (codeLength > 0 && codeLength > proseLength * 0.65) return existing ?? (hasCodeFence ? coding : { status: 'unclassified', reason: 'code-dominant', evidence })
  const guides = bodySections.filter(section => section.guide).length
  if (guides >= 2 && guides * 2 >= bodySections.length) return existing ?? (hasCodeFence ? coding : { status: 'unclassified', reason: 'instruction-guide', evidence })
  const hasMeasurements = tables.length > 0 || (measuredCited.length >= 2 && measuredSections.size >= 2)
  if (bodySections.length < 3 || cited.length < 2 || citedSections.size < 2 || hosts.size < 2
    || technical.length < 2 || technicalSections.size < 2 || topicGroups.size < 2 || !hasMeasurements) {
    return existing ?? { status: 'unclassified', reason: 'insufficient-evidence', evidence }
  }
  return { status: 'identified', domain: 'technical-insight', basis: 'structural-evidence', evidence }
}
