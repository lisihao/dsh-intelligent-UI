import { describe, expect, it } from 'vitest'
import { buildDilSourceBindings } from '../tools/dil-live/source-bindings.js'

describe('source-bound DIL Markdown data', () => {
  it('omits table separators from numeric cells while retaining the exact original table', () => {
    const source = '| 项目 | CAD 百万 |\n|---|---:|\n| 人员 | 6.0 |\n| 工具 | 1.5 |'
    const data = buildDilSourceBindings(source)
    expect(data.source).toBe(source)
    expect(data.tables[0]).toEqual({header:['项目','CAD 百万'],rows:[['人员','6.0'],['工具','1.5']],source})
    expect(data.tables[0]!.rows.map(row => Number(row[1]))).toEqual([6,1.5])
  })
  it('retains actual cell markup and escaped pipes, and distinguishes an empty cell', () => {
    const source = '| Label | Detail |\n|---|---|\n| **A** | [source](https://example.com) and `x` |\n| a\\|b | |'
    const data = buildDilSourceBindings(source)
    expect(data.tables[0]!.rows).toEqual([['**A**','[source](https://example.com) and `x`'],['a\\|b','']])
    expect(data.tables[0]!.source).toBe(source)
  })
  it('keeps source segments and list items without rewriting code, math or punctuation', () => {
    const source = '# 标题\n\n- $x^2$\n- `a | b`\n\n```rust\nlet x = 1;\n```'
    const data = buildDilSourceBindings(source)
    expect(data.items).toEqual(['- $x^2$','- `a | b`'])
    expect(data.segments.at(-1)!.source).toBe('```rust\nlet x = 1;\n```')
  })
})
