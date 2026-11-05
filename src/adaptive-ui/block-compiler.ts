import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { parseMarkdownLayouts } from '../content-layout.js'
import { normalizeCompositionSource } from './source-contracts.js'

/** The persisted selection format is intentionally versioned independently of the renderer. */
export const BLOCK_LAYOUT_VERSION = 1 as const
export const MAX_BLOCK_LAYOUT_BLOCKS = 128
export const MAX_BLOCK_LAYOUT_PATH_DEPTH = 16
export const MAX_BLOCK_LAYOUT_EVIDENCE = 8

type MarkdownNode = {
  readonly type: string
  readonly ordered?: boolean
  readonly children?: readonly MarkdownNode[]
  readonly position?: { readonly start?: { readonly offset?: number }, readonly end?: { readonly offset?: number } }
}

type MarkdownRoot = { readonly children: readonly MarkdownNode[] }

/**
 * The public portion is the only data a renderer needs to bind a presentation
 * back to original source. `path` scopes normalized tool text blocks; Markdown
 * offsets are UTF-16 offsets in that exact path's complete Markdown string.
 */
export interface BlockSourceReference {
  readonly id: string
  readonly path: readonly number[]
  readonly start?: number
  readonly end?: number
  readonly kind: string
  readonly evidence: readonly string[]
}

/** A compiler-owned unit used by the planner; `value` never comes from a model response. */
export interface CompiledBlock extends BlockSourceReference {
  readonly value: unknown
  /** Passive blocks still preserve source coverage but do not create cosmetic questions. */
  readonly passive: boolean
}

export interface BlockLayoutCompilation {
  readonly version: typeof BLOCK_LAYOUT_VERSION
  readonly blocks: readonly CompiledBlock[]
}

export class InvalidBlockCompilationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InvalidBlockCompilationError'
    this.code = code
  }
}

const parser = unified().use(remarkParse).use(remarkGfm)

function sourcePathId(path: readonly number[]): string {
  return path.length ? `path-${path.join('-')}` : 'root'
}

function sourceId(path: readonly number[], start: number | undefined, end: number | undefined, kind: string): string {
  const range = start === undefined ? 'value' : `${start}-${end}`
  return `block-${sourcePathId(path)}-${range}-${kind}`
}

function structuralEvidence(...entries: readonly string[]): readonly string[] {
  const values = [...new Set(entries.filter(entry => entry.length > 0))]
  if (values.length > MAX_BLOCK_LAYOUT_EVIDENCE) throw new InvalidBlockCompilationError('BLOCK_LAYOUT_EVIDENCE_LIMIT_EXCEEDED', 'A source block has too many evidence entries.')
  return values
}

function assertPath(path: readonly number[]): void {
  if (path.length > MAX_BLOCK_LAYOUT_PATH_DEPTH) throw new InvalidBlockCompilationError('BLOCK_LAYOUT_PATH_DEPTH_EXCEEDED', `Block source path exceeds ${MAX_BLOCK_LAYOUT_PATH_DEPTH} segments.`)
  if (path.some(part => !Number.isInteger(part) || part < 0)) throw new InvalidBlockCompilationError('BLOCK_LAYOUT_PATH_INVALID', 'Block source paths require nonnegative integer segments.')
}

function nodeRange(node: MarkdownNode): { start: number, end: number } {
  const start = node.position?.start?.offset, end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new InvalidBlockCompilationError('BLOCK_LAYOUT_MARKDOWN_POSITION_MISSING', 'Markdown block positions must contain a nonempty UTF-16 source range.')
  }
  return { start, end }
}

function containsImage(node: MarkdownNode): boolean {
  return node.type === 'image' || node.type === 'imageReference' || node.children?.some(containsImage) === true
}

function isArrowFlow(flowKinds: ReadonlyMap<number, 'arrow-chain' | 'ordered-list'>, node: MarkdownNode): boolean {
  const start = node.position?.start?.offset
  return start !== undefined && flowKinds.get(start) === 'arrow-chain'
}

type PendingNode = { readonly node: MarkdownNode, readonly start: number, readonly end: number }

function markdownBlock(path: readonly number[], markdown: string, start: number, end: number, kind: string, evidence: readonly string[], passive: boolean): CompiledBlock {
  return {
    id: sourceId(path, start, end, kind), path: [...path], start, end, kind,
    evidence: structuralEvidence('source:markdown', `node:${kind}`, `range:${start}-${end}`, ...evidence),
    // This substring is eligibility-only. Renderers retain and render `markdown`
    // as one document, so links and footnote definitions remain document-scoped.
    value: markdown.slice(start, end), passive,
  }
}

/**
 * Compiles top-level Markdown structure only. Noninteractive headings, prose,
 * quotations and ordinary lists are coalesced so a long document does not
 * exhaust the bounded program merely because it contains many passive nodes.
 */
function compileMarkdown(markdown: string, path: readonly number[]): CompiledBlock[] {
  let root: MarkdownRoot
  try { root = parser.parse(markdown) as unknown as MarkdownRoot }
  catch (error) { throw new InvalidBlockCompilationError('BLOCK_LAYOUT_MARKDOWN_PARSE_FAILED', error instanceof Error ? error.message : 'Markdown parsing failed.') }

  const layout = parseMarkdownLayouts(markdown)
  const flowKinds = new Map<number, 'arrow-chain' | 'ordered-list'>(layout.flows.map(flow => [flow.start, flow.sourceKind]))
  const blocks: CompiledBlock[] = []
  let pending: PendingNode[] = []

  const flushPending = () => {
    if (!pending.length) return
    const first = pending[0]!, last = pending.at(-1)!
    const nodeKinds = [...new Set(pending.map(item => item.node.type))]
    blocks.push(markdownBlock(path, markdown, first.start, last.end, 'prose', [
      'source:passive-markdown',
      ...nodeKinds.slice(0, 3).map(kind => `contains:${kind}`),
    ], true))
    pending = []
  }

  for (const node of root.children) {
    const { start, end } = nodeRange(node)
    const flowKind = flowKinds.get(start)
    const specialParagraph = node.type === 'paragraph' && (flowKind === 'arrow-chain' || containsImage(node))
    const specialList = node.type === 'list' && flowKind === 'ordered-list'
    const special = node.type === 'table' || node.type === 'code' || specialParagraph || specialList
    if (!special) {
      pending.push({ node, start, end })
      continue
    }
    flushPending()
    if (node.type === 'table') {
      blocks.push(markdownBlock(path, markdown, start, end, 'table', ['source:table'], false))
    } else if (node.type === 'code') {
      blocks.push(markdownBlock(path, markdown, start, end, 'code', ['source:code'], true))
    } else if (node.type === 'list') {
      // `parseMarkdownLayouts` already requires a preceding source heading or
      // paragraph that explicitly frames an ordered list as a workflow.
      blocks.push(markdownBlock(path, markdown, start, end, 'ordered-list', ['source:list', 'source:ordered-list', 'source:flow:ordered-list'], false))
    } else {
      blocks.push(markdownBlock(path, markdown, start, end, 'paragraph', [
        ...(flowKind === 'arrow-chain' ? ['source:flow:arrow-chain'] : []),
        ...(containsImage(node) ? ['source:illustration'] : []),
      ], false))
    }
  }
  flushPending()
  return blocks
}

function structuredKind(value: unknown): string {
  if (Array.isArray(value)) return 'structured-array'
  if (value && typeof value === 'object') return 'structured-record'
  return 'scalar'
}

function structuredBlock(value: unknown, path: readonly number[]): CompiledBlock {
  const kind = structuredKind(value)
  return {
    id: sourceId(path, undefined, undefined, kind), path: [...path], kind,
    evidence: structuralEvidence('source:structured', `node:${kind}`, `path:${sourcePathId(path)}`),
    value,
    passive: kind === 'scalar',
  }
}

function compileValue(value: unknown, path: readonly number[], output: CompiledBlock[]): void {
  assertPath(path)
  const source = normalizeCompositionSource(value)
  if (source.kind === 'empty') return
  if (source.kind === 'blocks') {
    source.values.forEach((child, index) => compileValue(child, [...path, index], output))
    return
  }
  const compiled = source.kind === 'markdown'
    ? compileMarkdown(source.markdown, path)
    : [structuredBlock(source.value, path)]
  output.push(...compiled)
  if (output.length > MAX_BLOCK_LAYOUT_BLOCKS) {
    throw new InvalidBlockCompilationError('BLOCK_LAYOUT_BLOCK_LIMIT_EXCEEDED', `Block layout supports at most ${MAX_BLOCK_LAYOUT_BLOCKS} source blocks.`)
  }
}

/**
 * Compile source references only; this does not alter the source or ask a
 * model to segment it. A normalized tool-text array becomes independently
 * scoped paths such as `[0]`, `[1]`, and so on.
 */
export function compileBlockLayout(value: unknown): BlockLayoutCompilation {
  const blocks: CompiledBlock[] = []
  compileValue(value, [], blocks)
  if (!blocks.length) throw new InvalidBlockCompilationError('BLOCK_LAYOUT_EMPTY', 'Block layout requires at least one source-owned block.')
  const ids = new Set<string>()
  for (const block of blocks) {
    assertPath(block.path)
    if (ids.has(block.id)) throw new InvalidBlockCompilationError('BLOCK_LAYOUT_SOURCE_ID_DUPLICATE', `Duplicate block source id: ${block.id}`)
    ids.add(block.id)
  }
  return { version: BLOCK_LAYOUT_VERSION, blocks }
}

/** Alias retained for consumers that describe this operation as compilation of composition blocks. */
export const compileCompositionBlocks = compileBlockLayout

type SourceReferenceLike = {
  readonly id?: unknown
  readonly path?: unknown
  readonly start?: unknown
  readonly end?: unknown
  readonly kind?: unknown
}

function sameReference(expected: BlockSourceReference, actual: SourceReferenceLike): boolean {
  if (actual.id !== expected.id || actual.kind !== expected.kind) return false
  if (!Array.isArray(actual.path) || actual.path.length !== expected.path.length || actual.path.some((part, index) => part !== expected.path[index])) return false
  return actual.start === expected.start && actual.end === expected.end
}

/**
 * Recompiles the source and compares the complete ordered reference set. It
 * intentionally accepts no source text from a plan or model response.
 */
export function validateBlockSourceReferences(value: unknown, blocks: readonly SourceReferenceLike[]): boolean {
  try {
    const compiled = compileBlockLayout(value).blocks
    return compiled.length === blocks.length && compiled.every((expected, index) => sameReference(expected, blocks[index]!))
  } catch {
    return false
  }
}
