import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Heading, Nodes, Root } from 'mdast'

export interface ContentSection {
  /** UTF-16 source offsets, matching mdast positions and String.slice. */
  start: number
  end: number
  text: string
  title: string
  headingDepth: Heading['depth']
  hasTable: boolean
  hasMedia: boolean
}
export interface ContentSectionsPlan { intro: string, sections: ContentSection[] }

const processor = unified().use(remarkParse).use(remarkGfm)
function headingText(node: Nodes): string {
  if (node.type === 'html') return ''
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
  if ('value' in node) return node.value
  return 'children' in node ? node.children.map(headingText).join('') : ''
}
function containsImage(node: Nodes): boolean {
  return node.type === 'image' || node.type === 'imageReference' || 'children' in node && node.children.some(containsImage)
}

/**
 * Partition substantial mixed-media Markdown at source-owned section boundaries.
 * Only root headings split the stream; quotations, nested lists and fenced code
 * remain inside their original section. No content is summarized or rewritten.
 */
export function planContentSections(text: string, options: { allowTextOnly?: boolean } = {}): ContentSectionsPlan | undefined {
  const root = processor.parse(text) as Root
  const headings = root.children.flatMap((node, index) => node.type === 'heading' ? [{ node, index }] : [])
  if (!headings.length) return undefined
  let eligible = headings
  // One opening h1 owns the document title, not a section parallel to its h2s.
  if (headings[0]!.node.depth === 1 && headings.filter(({ node }) => node.depth === 1).length === 1) eligible = headings.slice(1)
  if (!eligible.length) return undefined
  const depth = eligible.reduce((minimum, { node }) => Math.min(minimum, node.depth), 6)
  const boundaries = eligible.filter(({ node }) => node.depth === depth)
  if (boundaries.length < 2 || boundaries.some(({ node }) => node.position?.start.offset === undefined)) return undefined
  const sections = boundaries.map(({ node, index }, boundaryIndex): ContentSection => {
    const next = boundaries[boundaryIndex + 1]
    const start = node.position!.start.offset!, end = next?.node.position!.start.offset ?? text.length
    const nodes = root.children.slice(index, next?.index ?? root.children.length)
    return { start, end, text: text.slice(start, end), title: headingText(node), headingDepth: node.depth, hasTable: nodes.some(child => child.type === 'table'), hasMedia: nodes.some(containsImage) }
  })
  // Ordinary prose, code fences and quoted examples do not manufacture media.
  if (!options.allowTextOnly && !sections.some(section => section.hasTable || section.hasMedia)) return undefined
  return { intro: text.slice(0, sections[0]!.start), sections }
}
