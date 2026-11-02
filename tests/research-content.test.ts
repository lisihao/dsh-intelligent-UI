import { describe, expect, it } from 'vitest'
import { analyzeResearchDocument, buildFollowupDraft, safeResearchUrl } from '../src/research-content.js'
import { parseMarkdownTables } from '../src/content-analysis.js'

describe('deterministic research document adapter', () => {
  it('uses exact UTF-16 report anchors with emoji, CJK and CRLF', () => {
    const text = '# 😀研究报告\r\n\r\n中文 [原始资料](https://example.org/report) 说明。\r\n\r\n## 风险\r\n未知。'
    const result = analyzeResearchDocument(text)
    const citation = '[原始资料](https://example.org/report)'
    expect(result.title).toBe('😀研究报告')
    expect(result.sources).toEqual([{ id: `reference-${text.indexOf(citation)}-${text.indexOf(citation) + citation.length}`, title: '原始资料', url: 'https://example.org/report', kind: 'report-reference', start: text.indexOf(citation), end: text.indexOf(citation) + citation.length, quote: citation }])
    expect(result.sections).toEqual([{ title: '😀研究报告', start: 0, end: text.indexOf('## 风险') }, { title: '风险', start: text.indexOf('## 风险'), end: text.length }])
    expect(result.sources[0]!.start).toBeGreaterThan(Array.from(text.slice(0, result.sources[0]!.start)).length)
  })

  it('resolves full, collapsed and shortcut references to the first actual definition', () => {
    const text = '[正文][A]、[a][]、[a]。\n\n[A]: https://example.org/first "定义标题"\n[a]: https://example.org/ignored\n\n[unused]: https://example.org/unused "未使用资料"'
    const result = analyzeResearchDocument(text)
    expect(result.sources.map(source => source.url)).toEqual(['https://example.org/first', 'https://example.org/first', 'https://example.org/first', 'https://example.org/unused'])
    expect(result.sources.map(source => source.title)).toEqual(['正文', 'a', 'a', '未使用资料'])
    for (const source of result.sources.slice(0, 3)) expect(source.definition?.quote).toBe('[A]: https://example.org/first "定义标题"')
    for (const source of result.sources) expect(text.slice(source.start, source.end)).toBe(source.quote)
    expect(result.sources.at(-1)?.definition).toBeUndefined()
  })

  it('keeps footnote report anchors separate from the links inside a footnote', () => {
    const text = '😀观察[^note]，再次[^note]。\n\n[^note]: 尚未核查的说明，见 [SEC 原文](https://www.sec.gov/example.pdf)。'
    const result = analyzeResearchDocument(text)
    expect(result.footnotes).toHaveLength(2)
    expect(result.footnotes.map(note => note.quote)).toEqual(['[^note]', '[^note]'])
    expect(result.footnotes[0]?.definition?.quote).toBe('[^note]: 尚未核查的说明，见 [SEC 原文](https://www.sec.gov/example.pdf)。')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({ title: 'SEC 原文', quote: '[SEC 原文](https://www.sec.gov/example.pdf)', kind: 'report-reference' })
    expect(result.sources[0]).not.toHaveProperty('content')
  })

  it('preserves escaped pipes, formatted cell text and exact source cell anchors', () => {
    const text = '😀中文\n\n| **名称** | 原值 |\n|---|---|\n| A\\|B | **10** |\n| [资料](https://example.org) | 20[^n] |\n\n[^n]: 附注'
    const table = analyzeResearchDocument(text).tables[0]!
    expect(table.headers).toEqual(['名称', '原值'])
    expect(table.rows).toEqual([['A|B', '10'], ['资料', '20']])
    expect(table.cellAnchors.map(row => row.map(cell => cell.quote))).toEqual([['**名称**', '原值'], ['A\\|B', '**10**'], ['[资料](https://example.org)', '20[^n]']])
    for (const row of table.cellAnchors) for (const cell of row) expect(text.slice(cell.start, cell.end)).toBe(cell.quote)
    expect(text.slice(table.start, table.end)).toBe(table.quote)
    expect(table.plans).toEqual([])
  })

  it('retains every table, row and column, including ragged and empty source cells', () => {
    const largeRows = Array.from({ length: 205 }, (_, index) => `| 项目${index} | ${index} |`).join('\n')
    const text = `|名称|值|\n|---|---|\n${largeRows}\n\n|甲|乙|\n|---|---|\n| a | | extra |\n|z|`
    const result = analyzeResearchDocument(text)
    expect(result.tables).toHaveLength(2)
    expect(result.tables[0]?.rows).toHaveLength(205)
    expect(result.tables[0]?.cellAnchors).toHaveLength(206)
    expect(result.tables[0]?.plans).toHaveLength(1)
    expect(result.tables[0]?.plans[0]?.labels).toHaveLength(205)
    expect(result.tables[0]?.plans[0]?.series[0]?.values).toEqual(Array.from({ length: 205 }, (_, i) => i))
    expect(result.tables[0]?.plans[0]?.sourceRows?.at(-1)).toBe(204)
    expect(result.tables[1]?.plans).toEqual([])
    expect(result.tables[1]?.rows).toEqual([['a', '', 'extra'], ['z']])
    expect(result.tables[1]?.cellAnchors.map(row => row.length)).toEqual([2, 3, 1])
    for (const table of result.tables) for (const row of table.cellAnchors) for (const cell of row) expect(text.slice(cell.start, cell.end)).toBe(cell.quote)
  })

  it('reuses conservative existing chart plans without aggregating or discarding source rows', () => {
    const text = '单位：美元\n\n|类别|金额|\n|---|---|\n|A|10|\n|B|20|\n|合计|30|'
    const table = analyzeResearchDocument(text).tables[0]!
    expect(table.rows).toEqual([['A', '10'], ['B', '20'], ['合计', '30']])
    expect(table.plans[0]?.sourceRows).toEqual([0, 1])
    expect(table.plans[0]?.series[0]?.values).toEqual([10, 20])
    expect(table.cellAnchors[3]?.[1]?.quote).toBe('30')
  })

  it('charts only exact matching explicit conditions and remaps source rows without changing values', () => {
    const text = '|模型|吞吐量|上下文|精度|\n|---|---|---|---|\n|A|**48**|8K|BF16|\n|C|44|16K|FP8|\n|B|约36|8K|BF16|'
    const table = analyzeResearchDocument(text).tables[0]!
    expect(table.rows).toEqual([['A', '48', '8K', 'BF16'], ['C', '44', '16K', 'FP8'], ['B', '约36', '8K', 'BF16']])
    expect(table.plans).toHaveLength(1)
    expect(table.plans[0]?.labels).toEqual(['A', 'B'])
    expect(table.plans[0]?.sourceRows).toEqual([0, 2])
    expect(table.plans[0]?.sourceColumns).toEqual([1])
    expect(table.plans[0]?.series[0]).toMatchObject({ values: [48, 36], originals: ['**48**', '约36'] })
    expect(table.plans[0]?.notes?.join(' ')).toContain('上下文=8K；精度=BF16')
    expect(table.plans[0]?.notes?.join(' ')).toContain('C')
    expect(table.cellAnchors).toHaveLength(4)
  })

  it('does not draw singleton condition groups or incomplete condition rows', () => {
    const singleton = '|模型|吞吐量|hardware|context|\n|---|---|---|---|\n|A|48|M4|8K|\n|B|36|M5|8K|'
    expect(analyzeResearchDocument(singleton).tables[0]?.plans).toEqual([])
    const incomplete = '|模型|吞吐量|条件|\n|---|---|---|\n|A|48|BF16|\n|B|36|BF16|\n|C|44|未知|\n|D|46||'
    const table = analyzeResearchDocument(incomplete).tables[0]!
    expect(table.rows).toHaveLength(4)
    expect(table.plans[0]?.sourceRows).toEqual([0, 1])
    expect(table.plans[0]?.notes?.join(' ')).toContain('C、D')
  })

  it('preserves the normal plan when every selected row has the same known conditions', () => {
    const text = '|模型|吞吐量|硬件型号|上下文|精度|\n|---|---|---|---|---|\n|A|48|M4|8K|BF16|\n|B|36|M4|8K|BF16|'
    expect(analyzeResearchDocument(text).tables[0]?.plans).toEqual(parseMarkdownTables(text)[0]?.plans)
  })

  it('keeps separate exact groups without fuzzy equivalence or unit rescaling', () => {
    const text = '|模型|耗时(ms)|condition|\n|---|---|---|\n|A|48|BF16|\n|B|36|BF16|\n|C|44|bf16|\n|D|38|bf16|'
    const plans = analyzeResearchDocument(text).tables[0]!.plans
    expect(plans.map(plan => plan.sourceRows)).toEqual([[0, 1], [2, 3]])
    expect(plans.map(plan => plan.series[0]?.values)).toEqual([[48, 36], [44, 38]])
    expect(plans.every(plan => plan.series[0]?.unit === 'ms')).toBe(true)
  })

  it('ignores fake tables, definitions and references in fenced or inline code', () => {
    const text = '```md\n# 假标题\n[假引用](https://example.org/fake)\n\n[ref]: https://example.org/fake-definition\n\n|a|b|\n|---|---|\n|1|2|\n```\n\n`[代码](https://example.org/inline)`\n\n[未定义][ref]'
    expect(analyzeResearchDocument(text)).toEqual({ title: '研究报告', sections: [], sources: [], tables: [], footnotes: [] })
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', '//example.org/a', 'https://user:secret@example.org', 'https://user@example.org', 'https://example.org\\@evil.org', 'https://exa\nmple.org', 'https://example.org/ bad', 'https://'])('does not expose an unsafe outgoing URL: %s', url => {
    expect(safeResearchUrl(url)).toBeUndefined()
  })

  it('leaves unsafe Markdown and raw HTML links out of the outgoing link model', () => {
    const text = '[脚本](javascript:alert%281%29) [凭据](https://user:secret@example.org) [本地](file:///tmp/a) <a href="https://example.org/html">HTML</a>\n\n[unsafe]: javascript:alert(1)\n\n[引用][unsafe]'
    expect(analyzeResearchDocument(text).sources).toEqual([])
  })

  it('accepts absolute HTTP(S) links, including GFM autolinks, without fetching them', () => {
    expect(safeResearchUrl('HTTPS://example.org/中文?q=%20#片段')).toBe('HTTPS://example.org/中文?q=%20#片段')
    expect(analyzeResearchDocument('资料 <https://example.org/a> 以及 https://example.org/b').sources.map(source => source.url)).toEqual(['https://example.org/a', 'https://example.org/b'])
  })

  it('offers a plain source fallback and never infers facts, claims or graph edges from prose', () => {
    const result = analyzeResearchDocument('因此 A 支持 B；C 反对 B。未核查的因果说法。')
    expect(result).toEqual({ title: '研究报告', sections: [], sources: [], tables: [], footnotes: [] })
    expect(analyzeResearchDocument('')).toEqual(result)
  })

  it('builds a deterministic editable follow-up without implying references were verified', () => {
    const draft = buildFollowupDraft('  这个结论依据是什么？  ', '  😀中文原文 [1]  ')
    expect(draft).toContain('这个结论依据是什么？')
    expect(draft).toContain('😀中文原文 [1]')
    expect(draft).toContain('相同期间、单位、定义与条件')
    expect(draft).toContain('不要把报告中的引用标记视为已经验证的证据')
    expect(buildFollowupDraft('  这个结论依据是什么？  ', '  😀中文原文 [1]  ')).toBe(draft)
  })
})
