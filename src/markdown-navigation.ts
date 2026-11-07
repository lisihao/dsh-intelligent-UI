import GithubSlugger from 'github-slugger'
import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import type { Root } from 'mdast'

export interface MarkdownNavigation {
  /** A unified-compatible attacher that marks only verified source directories. */
  readonly remarkPlugin: () => (tree: Root) => void
  /** Resolves only a same-document fragment that names an existing source heading. */
  readonly resolveHref: (href: string) => string | undefined
}

type SourcePosition = {
  readonly start?: { readonly offset?: number }
  readonly end?: { readonly offset?: number }
}

type MutableMarkdownNode = {
  type: string
  value?: string
  url?: string
  depth?: number
  ordered?: boolean
  start?: number
  children?: MutableMarkdownNode[]
  position?: SourcePosition
  data?: { hName?: string, hProperties?: Record<string, unknown> }
}

interface HeadingTarget {
  readonly text: string
  readonly start: number
  readonly slug: string
}

interface TocEntry {
  readonly paragraph: MutableMarkdownNode
  readonly target: HeadingTarget
  readonly existingLink?: MutableMarkdownNode
}

const markdown = unified().use(remarkParse).use(remarkGfm)
const tocLabels = new Set(['table of contents', 'contents', 'toc'])

function nodeText(node: MutableMarkdownNode): string {
  if (typeof node.value === 'string') return node.value
  return node.children?.map(nodeText).join('') ?? ''
}

function sourceOffset(node: MutableMarkdownNode, edge: 'start' | 'end'): number | undefined {
  const offset = node.position?.[edge]?.offset
  return typeof offset === 'number' ? offset : undefined
}

function headingTargets(source: string): readonly HeadingTarget[] {
  const tree = markdown.parse(source) as unknown as MutableMarkdownNode
  const headings: Array<{ text: string, start: number }> = []
  const visit = (node: MutableMarkdownNode): void => {
    if (node.type === 'heading' && typeof node.depth === 'number' && node.depth >= 1 && node.depth <= 6) {
      const start = sourceOffset(node, 'start')
      const text = nodeText(node).trim()
      if (start !== undefined && text) headings.push({ text, start })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  const slugger = new GithubSlugger()
  return headings.map(heading => ({ ...heading, slug: slugger.slug(heading.text) }))
}

function sameDocumentFragment(href: string): string | undefined {
  if (!href.startsWith('#') || href.length === 1) return undefined
  try { return decodeURIComponent(href.slice(1)) } catch { return undefined }
}

function isTocHeading(node: MutableMarkdownNode): boolean {
  if (node.type !== 'heading') return false
  const text = nodeText(node).trim()
  return text === '目录' || tocLabels.has(text.toLowerCase())
}

function isTextOnly(nodes: readonly MutableMarkdownNode[]): boolean {
  return nodes.length > 0 && nodes.every(node => node.type === 'text')
}

function simpleExistingLink(nodes: readonly MutableMarkdownNode[]): MutableMarkdownNode | undefined {
  const nonWhitespace = nodes.filter(node => node.type !== 'text' || !/^\s*$/u.test(node.value ?? ''))
  if (nonWhitespace.length !== 1 || nonWhitespace[0]?.type !== 'link') return undefined
  const link = nonWhitespace[0]
  return link.children && isTextOnly(link.children) ? link : undefined
}

/** Flatten only transparent experimental wrappers, preserving the nodes they contain. */
function sourceSequence(nodes: readonly MutableMarkdownNode[]): MutableMarkdownNode[] {
  const sequence: MutableMarkdownNode[] = []
  for (const node of nodes) {
    if (node.type === 'iexpBlock' && node.children) sequence.push(...sourceSequence(node.children))
    else sequence.push(node)
  }
  return sequence
}

function sourceTocEntry(item: MutableMarkdownNode, list: MutableMarkdownNode, source: string, listEnd: number, exactHeadings: ReadonlyMap<string, readonly HeadingTarget[]>, resolveHeading: (href: string) => HeadingTarget | undefined): TocEntry | undefined {
  if (item.type !== 'listItem' || item.children?.length !== 1) return undefined
  const paragraph = item.children[0]
  if (!paragraph || paragraph.type !== 'paragraph' || !paragraph.children?.length) return undefined

  const existingLink = simpleExistingLink(paragraph.children)
  if (existingLink) {
    const target = typeof existingLink.url === 'string' ? resolveHeading(existingLink.url) : undefined
    return target && target.start > listEnd ? { paragraph, target, existingLink } : undefined
  }
  if (!isTextOnly(paragraph.children)) return undefined
  const plainLabel = nodeText(paragraph).trim()
  const labels = [plainLabel]
  if (list.ordered) {
    const itemStart = sourceOffset(item, 'start'), paragraphStart = sourceOffset(paragraph, 'start')
    if (itemStart !== undefined && paragraphStart !== undefined && itemStart < paragraphStart) {
      // Reuse the literal marker in the source list, rather than inventing a
      // numbering convention, before making an exact heading comparison.
      labels.push((source.slice(itemStart, paragraphStart) + nodeText(paragraph)).trim())
    }
  }
  const targets = [...new Set(labels.flatMap(label => exactHeadings.get(label)?.filter(target => target.start > listEnd) ?? []))]
  return targets.length === 1 ? { paragraph, target: targets[0]! } : undefined
}

function sourceTocEntries(list: MutableMarkdownNode, source: string, exactHeadings: ReadonlyMap<string, readonly HeadingTarget[]>, resolveHeading: (href: string) => HeadingTarget | undefined): readonly (TocEntry | undefined)[] | undefined {
  if (list.type !== 'list' || !list.children?.length) return undefined
  const listEnd = sourceOffset(list, 'end')
  if (listEnd === undefined) return undefined
  return list.children.map(item => sourceTocEntry(item, list, source, listEnd, exactHeadings, resolveHeading))
}

function linkParagraph(entry: TocEntry, href: string): void {
  if (entry.existingLink) {
    entry.existingLink.url = href
    return
  }
  const children = entry.paragraph.children!
  entry.paragraph.children = [{ type: 'link', url: href, children, position: entry.paragraph.position }]
}

function sourceTocWrapper(list: MutableMarkdownNode, label: string, unmatched: number): MutableMarkdownNode {
  return {
    type: 'iexpSourceToc',
    children: [list],
    position: list.position,
    data: {
      hName: 'iexp-source-toc',
      hProperties: {
      'aria-label': '原文目录',
      'data-iexp-source-toc-label': label,
      'data-iexp-toc-unmatched': String(unmatched),
    },
    },
  }
}

function wrapSourceToc(node: MutableMarkdownNode, list: MutableMarkdownNode, label: string, unmatched: number): boolean {
  const children = node.children
  if (!children) return false
  const index = children.indexOf(list)
  if (index >= 0) {
    children.splice(index, 1, sourceTocWrapper(list, label, unmatched))
    return true
  }
  return children.some(child => wrapSourceToc(child, list, label, unmatched))
}

/**
 * Builds source-only anchor aliases and a conservative directory transformer.
 * No guessed fragment, external URL, ordinary list, source reference, or code
 * node is rewritten.
 */
export function markdownNavigation(source: string, anchor: (start: number) => string): MarkdownNavigation {
  const headings = headingTargets(source)
  const slugHeadings = new Map<string, HeadingTarget>()
  const exactHeadings = new Map<string, HeadingTarget[]>()
  for (const heading of headings) {
    slugHeadings.set(heading.slug, heading)
    const current = exactHeadings.get(heading.text)
    if (current) current.push(heading)
    else exactHeadings.set(heading.text, [heading])
  }

  const resolveHeading = (href: string): HeadingTarget | undefined => {
    const fragment = sameDocumentFragment(href)
    if (fragment === undefined) return undefined
    return slugHeadings.get(fragment) ?? (exactHeadings.get(fragment)?.length === 1 ? exactHeadings.get(fragment)?.[0] : undefined)
  }

  return {
    resolveHref: href => {
      const heading = resolveHeading(href)
      return heading === undefined ? undefined : anchor(heading.start)
    },
    remarkPlugin: () => (tree: Root): void => {
      const root = tree as unknown as MutableMarkdownNode
      const sequence = sourceSequence(root.children ?? [])
      for (let index = 0; index + 1 < sequence.length; index++) {
        const heading = sequence[index], list = sequence[index + 1]
        if (!heading || !list || !isTocHeading(heading)) continue
        const entries = sourceTocEntries(list, source, exactHeadings, resolveHeading)
        const matched = entries?.filter((entry): entry is TocEntry => entry !== undefined) ?? []
        // A heading named "目录" alone is not enough. Two independently
        // verified entries prevent an ordinary list from becoming navigation.
        if (matched.length < 2) continue
        for (const entry of matched) linkParagraph(entry, anchor(entry.target.start))
        wrapSourceToc(root, list, nodeText(heading).trim(), (entries?.length ?? 0) - matched.length)
      }
    },
  }
}
