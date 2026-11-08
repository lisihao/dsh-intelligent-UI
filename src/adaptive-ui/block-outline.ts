import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { blockLayoutMarkdownLeaves, type BlockLayoutCompilation } from './block-compiler.js'
import { isStandaloneNumberedBoldHeading } from '../content-analysis.js'

export const BLOCK_OUTLINE_FORMAT = 'block-outline@2'
export const MAX_BLOCK_OUTLINE_SECTIONS = 512
export const MAX_BLOCK_OUTLINE_TITLE_CHARACTERS = 200

type MarkdownNode = {
  readonly type: string
  readonly depth?: number
  readonly value?: string
  readonly alt?: string
  readonly children?: readonly MarkdownNode[]
  readonly position?: { readonly start?: { readonly offset?: number }, readonly end?: { readonly offset?: number } }
}

export interface BlockOutlineSection {
  readonly id: string
  readonly path: readonly number[]
  readonly depth: number
  readonly title: string
  readonly titleTruncated: boolean
  /** UTF-16 range in the Markdown at `path`, from the heading to the next heading of the same or a higher level. */
  readonly start: number
  readonly end: number
  readonly parentId: string | null
  readonly evidence: readonly string[]
}

export interface BlockOutlineBlock {
  readonly blockId: string
  /** Innermost section containing the block's first character; null before the first heading or for structured values. */
  readonly sectionId: string | null
}

export interface BlockOutline {
  readonly format: typeof BLOCK_OUTLINE_FORMAT
  readonly complete: boolean
  readonly sections: readonly BlockOutlineSection[]
  readonly blocks: readonly BlockOutlineBlock[]
  readonly omitted?: { readonly reason: 'BLOCK_OUTLINE_SECTION_LIMIT_EXCEEDED', readonly sectionCount: number }
}

const parser = unified().use(remarkParse).use(remarkGfm)

function plainText(node: MarkdownNode): string {
  if (typeof node.value === 'string' && node.type !== 'html') return node.value
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if (node.type === 'break') return ' '
  return (node.children ?? []).map(plainText).join('')
}

function sectionsFor(path: readonly number[], markdown: string): BlockOutlineSection[] {
  const root = parser.parse(markdown) as unknown as { readonly children: readonly MarkdownNode[] }
  // A numbered bold-only paragraph (the existing table-context boundary rule)
  // has no source level; it sits one level below the nearest open Markdown heading.
  const open: { readonly depth: number, readonly bold: boolean }[] = []
  const headings = root.children.flatMap(node => {
    const start = node.position?.start?.offset
    if (typeof start !== 'number') return []
    if (node.type === 'heading' && typeof node.depth === 'number') {
      while (open.length && open.at(-1)!.depth >= node.depth!) open.pop()
      open.push({ depth: node.depth, bold: false })
      return [{ node, depth: node.depth, start, evidence: ['source:heading', `heading-depth:${node.depth}`] }]
    }
    if (!isStandaloneNumberedBoldHeading(node as never)) return []
    while (open.at(-1)?.bold) open.pop()
    const depth = (open.at(-1)?.depth ?? 0) + 1
    open.push({ depth, bold: true })
    return [{ node, depth, start, evidence: ['source:numbered-bold-paragraph', 'depth:derived-from-enclosing-heading'] }]
  })
  const prefix = path.length ? `path-${path.join('-')}` : 'root'
  const parents: BlockOutlineSection[] = []
  const sections: BlockOutlineSection[] = []
  headings.forEach((heading, index) => {
    const next = headings.slice(index + 1).find(candidate => candidate.depth <= heading.depth)
    while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop()
    const text = plainText(heading.node).replace(/\s+/gu, ' ').trim()
    const truncated = text.length > MAX_BLOCK_OUTLINE_TITLE_CHARACTERS
    const section: BlockOutlineSection = {
      id: `section-${prefix}-${heading.start}`,
      path: [...path],
      depth: heading.depth,
      title: truncated ? text.slice(0, MAX_BLOCK_OUTLINE_TITLE_CHARACTERS) : text,
      titleTruncated: truncated,
      start: heading.start,
      end: next?.start ?? markdown.length,
      parentId: parents.at(-1)?.id ?? null,
      evidence: heading.evidence,
    }
    sections.push(section)
    parents.push(section)
  })
  return sections
}

function samePath(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

/**
 * Describes the source heading tree and which compiled block sits in which
 * section. Sections come from top-level Markdown headings and from numbered
 * bold-only paragraphs; headings nested inside lists or quotes are not sections.
 */
export function outlineBlockLayout(value: unknown, compilation: BlockLayoutCompilation): BlockOutline {
  const sections = blockLayoutMarkdownLeaves(value).flatMap(leaf => sectionsFor(leaf.path, leaf.markdown))
  if (sections.length > MAX_BLOCK_OUTLINE_SECTIONS) {
    return {
      format: BLOCK_OUTLINE_FORMAT, complete: false, sections: [],
      blocks: compilation.blocks.map(block => ({ blockId: block.id, sectionId: null })),
      omitted: { reason: 'BLOCK_OUTLINE_SECTION_LIMIT_EXCEEDED', sectionCount: sections.length },
    }
  }
  const blocks = compilation.blocks.map(block => {
    const start = block.start
    if (start === undefined) return { blockId: block.id, sectionId: null }
    let innermost: BlockOutlineSection | undefined
    for (const section of sections) {
      if (samePath(section.path, block.path) && section.start <= start && start < section.end) innermost = section
    }
    return { blockId: block.id, sectionId: innermost?.id ?? null }
  })
  return { format: BLOCK_OUTLINE_FORMAT, complete: true, sections, blocks }
}
