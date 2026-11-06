import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

import type { Json } from './catalog.js'

/** Source-led list treatments; neither recipe interprets list content as data. */
export const SOURCE_ORGANIZATION_RECIPE_IDS = ['source-list-grid', 'source-label-table'] as const
export type SourceOrganizationRecipeId = typeof SOURCE_ORGANIZATION_RECIPE_IDS[number]

export interface SourceOrganizationCandidate {
  readonly id: SourceOrganizationRecipeId
  readonly purpose: string
  readonly evidence: readonly string[]
  readonly mapping: Json
}

/** A half-open UTF-16 range within one compiler-owned Markdown block. */
export interface SourceOrganizationRange {
  readonly start: number
  readonly end: number
}

export interface SourceOrganizationItem extends SourceOrganizationRange {
  /** Present only where a source strong node supplies the rendered label. */
  readonly explicitLabel?: SourceOrganizationLabel
}

/** The exact source label is carried in full; this module never truncates it. */
export interface SourceOrganizationLabel extends SourceOrganizationRange {
  readonly text: string
}

export interface SourceOrganizationList extends SourceOrganizationRange {
  readonly items: readonly SourceOrganizationItem[]
}

/**
 * The renderer resolves these ranges against the complete document AST.
 * Fragments are analyzed for eligibility, never rendered as replacement Markdown.
 * The public counterpart below intentionally exposes JSON only.
 */
export interface SourceOrganizationPlan extends SourceOrganizationCandidate {
  readonly lists: readonly SourceOrganizationList[]
}

type MarkdownPosition = {
  readonly start?: { readonly offset?: number }
  readonly end?: { readonly offset?: number }
}
type MarkdownNode = {
  readonly type: string
  readonly checked?: boolean | null
  readonly ordered?: boolean
  readonly children?: readonly MarkdownNode[]
  readonly value?: string
  readonly position?: MarkdownPosition
}
type MarkdownRoot = { readonly children?: readonly MarkdownNode[] }

const parser = unified().use(remarkParse).use(remarkGfm)

function sourceRange(node: MarkdownNode, length: number): SourceOrganizationRange | undefined {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === undefined || end === undefined || start < 0 || end <= start || end > length) return undefined
  return { start, end }
}

function visibleText(node: MarkdownNode): string {
  if (typeof node.value === 'string') return node.value
  return node.children?.map(visibleText).join('') ?? ''
}

function hasVisibleText(nodes: readonly MarkdownNode[]): boolean {
  return nodes.some(node => visibleText(node).trim().length > 0)
}

function completeNonTaskItems(list: MarkdownNode, length: number): readonly SourceOrganizationItem[] | undefined {
  if (list.type !== 'list' || list.ordered === true || !Array.isArray(list.children) || list.children.length < 2) return undefined
  const items: SourceOrganizationItem[] = []
  for (const item of list.children) {
    // GFM supplies a boolean for either checked or unchecked task items.
    if (item.type !== 'listItem' || typeof item.checked === 'boolean' || !Array.isArray(item.children) || !item.children.length || !hasVisibleText(item.children)) return undefined
    const range = sourceRange(item, length)
    if (!range) return undefined
    items.push(range)
  }
  return items
}

function explicitLabelItems(list: MarkdownNode, length: number): readonly SourceOrganizationItem[] | undefined {
  const base = completeNonTaskItems(list, length)
  if (!base || !Array.isArray(list.children)) return undefined
  const items: SourceOrganizationItem[] = []
  for (let index = 0; index < list.children.length; index++) {
    const item = list.children[index]!
    // The renderer moves only this simple, executable AST shape. It leaves
    // nested/rich item structures in their original list presentation.
    if (item.children?.length !== 1) return undefined
    const paragraph = item.children[0]
    if (!paragraph || paragraph.type !== 'paragraph' || !Array.isArray(paragraph.children) || paragraph.children.length < 2) return undefined
    const label = paragraph.children[0]
    if (!label || label.type !== 'strong' || !visibleText(label).trim() || !hasVisibleText(paragraph.children.slice(1))) return undefined
    const labelRange = sourceRange(label, length)
    if (!labelRange) return undefined
    items.push({ ...base[index]!, explicitLabel: { ...labelRange, text: visibleText(label) } })
  }
  return items
}

function mapping(lists: readonly SourceOrganizationList[]): Json {
  return {
    coordinateSystem: 'block-local-utf16',
    rangeConvention: '[start,end)',
    lists: lists.map(list => ({
      start: list.start,
      end: list.end,
      items: list.items.map(item => ({
        start: item.start,
        end: item.end,
        ...(item.explicitLabel ? { explicitLabel: { start: item.explicitLabel.start, end: item.explicitLabel.end, text: item.explicitLabel.text } } : {}),
      })),
    })),
  }
}

function plan(id: SourceOrganizationRecipeId, lists: readonly SourceOrganizationList[]): SourceOrganizationPlan {
  const isLabelTable = id === 'source-label-table'
  return {
    id,
    purpose: isLabelTable
      ? '将来源中明确加粗的前置名称置于标签列，并保留每项其余原文作为详情；不生成标签、事实或摘要。'
      : '按原始顺序将完整的同级无序条目排为响应式项目网格；不推断可比性、因果或工作流。',
    evidence: isLabelTable
      ? ['source:unordered-list', 'source:complete-non-task-siblings', 'source:explicit-strong-labels']
      : ['source:unordered-list', 'source:complete-non-task-siblings'],
    mapping: mapping(lists),
    lists,
  }
}

/**
 * Analyze one compiler-owned Markdown block. Only direct unordered lists are
 * candidates: nested lists remain untouched unless the renderer has a full
 * source-preserving transform for their exact shape.
 */
export function sourceOrganizationPlans(value: unknown): readonly SourceOrganizationPlan[] {
  if (typeof value !== 'string') return []
  let root: MarkdownRoot
  try {
    root = parser.parse(value) as unknown as MarkdownRoot
  } catch {
    return []
  }
  const gridLists: SourceOrganizationList[] = []
  const labelLists: SourceOrganizationList[] = []
  for (const node of root.children ?? []) {
    const listRange = sourceRange(node, value.length)
    const items = listRange ? completeNonTaskItems(node, value.length) : undefined
    if (listRange && items) gridLists.push({ ...listRange, items })
    const labeledItems = listRange ? explicitLabelItems(node, value.length) : undefined
    if (listRange && labeledItems) labelLists.push({ ...listRange, items: labeledItems })
  }
  return [
    ...(gridLists.length ? [plan('source-list-grid', gridLists)] : []),
    ...(labelLists.length ? [plan('source-label-table', labelLists)] : []),
  ]
}

/**
 * Public, deterministic candidate API for the planner. `mapping` is scoped to
 * the block's own source string; callers add any full-document offset from the
 * compiler reference instead of mutating these truthful local ranges.
 */
export function sourceOrganizationCandidates(value: unknown): readonly SourceOrganizationCandidate[] {
  return sourceOrganizationPlans(value).map(({ id, purpose, evidence, mapping: sourceMapping }) => ({ id, purpose, evidence, mapping: sourceMapping }))
}
