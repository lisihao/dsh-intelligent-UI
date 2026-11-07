import { describe, expect, it } from 'vitest'
import { planContentSections } from '../src/content-sections.js'
import { parseMarkdownLayouts } from '../src/content-layout.js'

describe('experimental reading plans retain source without legacy recommendation thresholds', () => {
  it('offers continuous source sections for pure prose while preserving the legacy mixed-media preference', () => {
    const text = '# Document\n\n## First\n\nComplete reasoning with [source][ref].\n\n## Second\n\nA qualification must remain.\n\n[ref]: https://example.com/source'
    expect(planContentSections(text)).toBeUndefined()
    const plan = planContentSections(text, { allowTextOnly: true })!
    expect(plan.sections).toHaveLength(2)
    expect(plan.intro + plan.sections.map(section => section.text).join('')).toBe(text)
    expect(plan.sections.every(section => !section.hasTable && !section.hasMedia)).toBe(true)
  })

  it('offers the complete long-document index without changing the legacy 100-heading recommendation', () => {
    const text = Array.from({ length: 139 }, (_, index) => `## Source ${index + 1}\n\nOriginal paragraph ${index + 1}.`).join('\n\n')
    expect(parseMarkdownLayouts(text).outline).toBeUndefined()
    const outline = parseMarkdownLayouts(text, { completeOutline: true }).outline!
    expect(outline.entries).toHaveLength(139)
    for (const entry of outline.entries) expect(text.slice(entry.start)).toMatch(/^## Source /)
  })
})
