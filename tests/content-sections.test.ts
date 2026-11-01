import { describe, expect, it } from 'vitest'
import { planContentSections, type ContentSectionsPlan } from '../src/content-sections.js'

function expectExactSource(source: string, plan: ContentSectionsPlan): void {
  expect(plan.intro + plan.sections.map(section => section.text).join('')).toBe(source)
  expect(Buffer.from(plan.intro + plan.sections.map(section => section.text).join(''))).toEqual(Buffer.from(source))
  for (const section of plan.sections) expect(source.slice(section.start, section.end)).toBe(section.text)
  expect(plan.sections[0]!.start).toBe(plan.intro.length)
  for (let index = 1; index < plan.sections.length; index++) expect(plan.sections[index - 1]!.end).toBe(plan.sections[index]!.start)
  expect(plan.sections.at(-1)!.end).toBe(source.length)
}

describe('source-preserving Markdown sections', () => {
  it('keeps a report title and complete introduction before same-level Chinese and English sections', () => {
    const source = '# 运行结果 / Execution report\r\n\r\n真实日志 🌞。单位、条件和来源均保留。  \r\n第二行。\r\n\r\n## 验证结果\r\n\r\n| 文件 | 耗时 (ms) |\r\n| --- | ---: |\r\n| client.test.ts | 28.801025390625 |\r\n| presentation.test.ts | 471.93701171875 |\r\n\r\n来源：本次测试运行。\r\n\r\n## Caveats and next steps\r\n\r\n包含刻意等待，不能当成产品性能基准。\r\n'
    const plan = planContentSections(source)!
    expect(plan.sections.map(section => [section.title, section.headingDepth, section.hasTable, section.hasMedia])).toEqual([
      ['验证结果', 2, true, false], ['Caveats and next steps', 2, false, false],
    ])
    expect(plan.intro).toBe(source.slice(0, source.indexOf('## 验证结果')))
    expectExactSource(source, plan)
  })
  it('leaves h3 and h4 material within its owning h2 section', () => {
    const source = '# Report\n\n## Findings\n\n### Data\n\n| Item | Count |\n|---|---|\n| A | 12 |\n\n#### Qualification\n\nOriginal condition.\n\n## Sources\n\n### Primary source\n\n![Source image](./source.png)\n'
    const plan = planContentSections(source)!
    expect(plan.sections).toHaveLength(2)
    expect(plan.sections[0]!.text).toContain('#### Qualification')
    expect(plan.sections[1]!.text).toContain('### Primary source')
    expect(plan.sections.map(section => section.hasMedia)).toEqual([false, true])
    expectExactSource(source, plan)
  })
  it('supports multiple h1 chapters when there is no single document-title h1', () => {
    const source = 'Preface without a heading.\n\n# 第一章\n\n![Original diagram](diagram.svg)\n\n## Local detail\n\nKeep this nested heading.\n\n# 第二章\n\n完整结论。'
    const plan = planContentSections(source)!
    expect(plan.sections.map(section => [section.title, section.headingDepth])).toEqual([['第一章', 1], ['第二章', 1]])
    expect(plan.intro).toBe('Preface without a heading.\n\n')
    expectExactSource(source, plan)
  })
  it('ignores fake headings and images inside fences, inline code, quotations and list nesting', () => {
    const source = '## Actual section\n\n```md\n## Fenced heading\n![not an image](fake.png)\n```\n\n> ## Quoted heading\n>\n> A quoted example.\n\n- ### List heading\n\n`![inline example](fake.png)`\n\n## Actual image\n\n![Explicit image](real.png)\n'
    const plan = planContentSections(source)!
    expect(plan.sections.map(section => section.title)).toEqual(['Actual section', 'Actual image'])
    expect(plan.sections.map(section => section.hasMedia)).toEqual([false, true])
    expect(plan.sections[0]!.text).toContain('> ## Quoted heading')
    expectExactSource(source, plan)
  })
  it('extracts heading display text from Markdown formatting without changing original section content', () => {
    const source = '## **Result** and [evidence](https://example.org) `v2` &amp; <span>条件</span>\n\n![proof](proof.png)\n\n## Final _notes_\n\nNo source rewriting.\n'
    const plan = planContentSections(source)!
    expect(plan.sections.map(section => section.title)).toEqual(['Result and evidence v2 & 条件', 'Final notes'])
    expect(plan.sections[0]!.text).toContain('**Result**')
    expectExactSource(source, plan)
  })
  it('recognizes setext headings and explicit reference images through the existing parser', () => {
    const source = 'First section\n-------------\n\n![Original plot][plot]\n\nSecond section\n--------------\n\nRetain the reference definition.\n\n[plot]: ./plot.svg "Original title"\n'
    const plan = planContentSections(source)!
    expect(plan.sections.map(section => section.title)).toEqual(['First section', 'Second section'])
    expect(plan.sections[0]!.hasMedia).toBe(true)
    expectExactSource(source, plan)
  })
  it.each([
    '', '普通简短回答。', '## One\n\nAn ordinary answer.\n\n## Two\n\nAnother paragraph.',
    '## Code\n\n```mermaid\ngraph TD\nA-->B\n```\n\n## Explanation\n\nOrdinary explanation.',
    '## Code\n\n```md\n![fake](fake.png)\n```\n\n## Another\n\n`![fake](fake.png)`',
    '![intro only](cover.png)\n\n## One\n\nPlain prose.\n\n## Two\n\nMore prose.',
    '## One\n\n![only one section](image.png)',
    '# Title\n\n## Only chapter\n\n### Child one\n\n![nested](image.png)\n\n### Child two\n\nNo second peer chapter.',
    '## Quoted table\n\n> | A | B |\n> |---|---|\n> |a|1|\n\n## More prose\n\nPlain paragraph.',
    '```md\n## One\n## Two\n![image](fake.png)\n```',
  ])('keeps unsupported or ordinary text in its original layout: %s', source => {
    expect(planContentSections(source)).toBeUndefined()
  })
  it('does not treat an image-looking hyperlink or raw HTML as a rendered Markdown image', () => {
    expect(planContentSections('## One\n\n[image](plot.png)\n\n## Two\n\n<img src="plot.png">')).toBeUndefined()
  })
  it('retains completed section offsets when ordinary output is appended', () => {
    const source = '# Report 🌞\n\n## First\n\n![Image](image.png)\n\n## Second\n\nPartial output'
    const before = planContentSections(source)!
    const withMoreText = planContentSections(source + ' now completed.\n\n')!
    const appended = source + ' now completed.\n\n## Third\n\nFinal notes.\n'
    const after = planContentSections(appended)!
    expect(withMoreText.sections[0]).toEqual(before.sections[0])
    expect(after.sections[0]).toEqual(before.sections[0])
    expect(after.sections[1]!.start).toBe(before.sections[1]!.start)
    expect(after.sections[1]!.end).toBe(appended.indexOf('## Third'))
    expect(after.intro).toBe(before.intro)
    expectExactSource(appended, after)
  })
})
