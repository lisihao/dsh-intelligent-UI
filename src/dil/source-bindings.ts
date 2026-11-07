import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { TableCell } from 'mdast'
export interface DilSourceBindings {
  readonly source: string
  readonly segments: readonly {readonly index:number, readonly kind:string, readonly source:string}[]
  readonly tables: readonly {readonly header:readonly string[], readonly rows:readonly (readonly string[])[], readonly source:string}[]
  readonly items: readonly string[]
}

const parser = unified().use(remarkParse).use(remarkGfm)

/** Original Markdown stays in source; cell bindings omit table grammar, not cell markup. */
export function buildDilSourceBindings(source: string): DilSourceBindings {
  const tree = parser.parse(source)
  const span = (node: {position?: {start: {offset?: number}, end: {offset?: number}}}): string => {
    const start = node.position?.start.offset, end = node.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('DIL_BINDING_SOURCE_POSITION_MISSING')
    return source.slice(start, end)
  }
  const cell = (node: TableCell): string => {
    const first = node.children[0], last = node.children.at(-1)
    if (!first || !last) return ''
    // remark-gfm tableCell positions include the separator pipe and padding.
    // Phrasing positions identify only content, including code/link/emphasis syntax.
    return span({position: {start:first.position!.start, end:last.position!.end}})
  }
  return {
    source,
    segments: tree.children.map((node, index) => ({index, kind:node.type, source:span(node)})),
    tables: tree.children.filter(node => node.type === 'table').map(table => ({
      header: table.children[0]!.children.map(cell),
      rows: table.children.slice(1).map(row => row.children.map(cell)),
      source: span(table),
    })),
    items: tree.children.filter(node => node.type === 'list').flatMap(list => list.children.map(span)),
  }
}
