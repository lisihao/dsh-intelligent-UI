import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

/** A pair of currency amounts is not an inline formula: e.g. $10 to $20. */
export function preserveCurrencyAmounts(source: string) {
  return function currencyAmounts() {
    return (tree: Root): void => {
      type Node = { type: string, value?: string, children?: Node[], position?: { start: { offset?: number }, end: { offset?: number } }, data?: unknown }
      const walk = (node: Node): void => {
        const start = node.position?.start.offset, end = node.position?.end.offset
        if (node.type === 'inlineMath' && start !== undefined && end !== undefined
          && /^\d[\d,.]*(?:\s|$)/.test(node.value ?? '') && /^\d/.test(source.slice(end))) {
          node.type = 'text'; node.value = source.slice(start, end); delete node.data
        }
        node.children?.forEach(walk)
      }
      walk(tree as unknown as Node)
    }
  }
}

/** Normalize supported TeX delimiters only for display, retaining every UTF-16 offset. */
export function mathMarkdownSource(source: string): string {
  type Node = { type: string, children?: Node[], position?: { start: { offset?: number }, end: { offset?: number } } }
  const protectedRanges: Array<[number, number]> = []
  const walk = (node: Node): void => {
    if (['code', 'inlineCode', 'html', 'definition', 'link', 'image', 'linkReference', 'imageReference'].includes(node.type)) {
      const start = node.position?.start.offset, end = node.position?.end.offset
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end])
      return
    }
    node.children?.forEach(walk)
  }
  walk(unified().use(remarkParse).use(remarkGfm).parse(source) as unknown as Node)
  const escaped = (at: number) => { let count = 0; while (at > 0 && source[--at] === '\\') count++; return count % 2 === 1 }
  const chars = source.split('')
  const pattern = /\\([[(])([\s\S]*?)\\([\])])/g
  for (const match of source.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length, closing = end - 2
    if ((match[1] === '[' ? ']' : ')') !== match[3] || escaped(start) || escaped(closing)
      || protectedRanges.some(([from, to]) => from < end && to > start)) continue
    chars[start] = '$'; chars[start + 1] = match[1] === '[' ? '$' : ' '
    chars[closing] = match[1] === '[' ? '$' : ' '; chars[closing + 1] = '$'
  }
  return chars.join('')
}
