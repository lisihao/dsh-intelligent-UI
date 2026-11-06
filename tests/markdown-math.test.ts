import type { Root } from 'mdast'
import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMath from 'remark-math'
import { mathMarkdownSource, preserveCurrencyAmounts } from '../src/markdown-math.js'

describe('source-preserving math delimiters', () => {
  it('normalizes the actual TeX delimiter forms without moving any source offsets', () => {
    const source = String.raw`内联 \(a_1 + b^2\)。

\[
\frac{x}{y} = z
\]

## 后续标题`
    const display = mathMarkdownSource(source)
    expect(display.length).toBe(source.length)
    expect(display.indexOf('## 后续标题')).toBe(source.indexOf('## 后续标题'))
    const tree = unified().use(remarkParse).use(remarkMath).parse(display)
    expect(tree.children.some(node => node.type === 'math')).toBe(true)
    expect(JSON.stringify(tree)).toContain('inlineMath')
    expect(JSON.stringify(tree)).toContain('a_1 + b^2')
  })
  it('does not treat delimiters in literal code, destinations or escaped text as math', () => {
    const source = ['`' + String.raw`\(a\)` + '`', '```text', String.raw`\[ literal \]`, '```', String.raw`[\(label\)](https://example.invalid) 与 \\(literal\\)`].join('\n\n')
    expect(mathMarkdownSource(source)).toBe(source)
  })
  it('keeps currency pairs visible instead of interpreting them as a formula', () => {
    const source = '预算 $10 to $20；公式 $x^2$。'
    const parser = unified().use(remarkParse).use(remarkMath).use(preserveCurrencyAmounts(source))
    const tree = parser.runSync(parser.parse(source))
    const children = ((tree as Root).children[0] as {children:Array<{type:string,value?:string}>}).children
    expect(children.filter(n => n.type === 'inlineMath').map(n => n.value)).toEqual(['x^2'])
    expect(children.filter(n => n.type === 'text').map(n => n.value).join('')).toContain('$10 to $20')
  })
})
