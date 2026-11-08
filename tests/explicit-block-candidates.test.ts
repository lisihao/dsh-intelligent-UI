import { describe, expect, it } from 'vitest'

import { builtInThemes } from '../src/theme-contracts.js'
import { BLOCK_PRESENTATION_IDS } from '../src/adaptive-ui/presentation-recipes.js'
import {
  buildCompositionCandidates,
  validateCompositionChoices,
  type CandidateBundle,
  type CompositionInput,
} from '../src/adaptive-ui/planner.js'

function input(value: unknown, overrides: Partial<Omit<CompositionInput, 'value'>> = {}): CompositionInput {
  return {
    value,
    themes: builtInThemes,
    selectedThemeId: 'empryo',
    styleMode: 'automatic',
    capabilities: { webgl: true, reducedMotion: false },
    ...overrides,
  }
}

function options(bundle: CandidateBundle, id: string): string[] {
  return bundle.questions.find(question => question.id === id)?.options.map(option => option.id) ?? []
}

function description(bundle: CandidateBundle, questionId: string, optionId: string): Record<string, unknown> {
  const value = bundle.questions.find(question => question.id === questionId)?.options.find(option => option.id === optionId)?.description
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Description not found: ${questionId}/${optionId}`)
  return value as Record<string, unknown>
}

const mixedSource = `# Source report

Prose preserves its source link [evidence][evidence].

\`\`\`ts
const executable = false
\`\`\`

| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |

[evidence]: https://example.com/evidence`

describe('explicit block candidates', () => {
  it('offers source-preserving alternatives for prose and code instead of suppressing passive compiler blocks', () => {
    const bundle = buildCompositionCandidates(input(mixedSource, { blockLayout: true }))
    const bindings = bundle.blockLayout!.blocks.filter(binding => ['prose', 'code'].includes(binding.reference.kind))
    expect(bindings.map(binding => binding.reference.kind)).toEqual(expect.arrayContaining(['prose', 'code']))
    for (const binding of bindings) {
      const presentation = options(bundle, `${binding.reference.id}:presentation`)
      expect(presentation).toEqual(expect.arrayContaining(['reading', 'cards', 'disclosure']))
      expect(options(bundle, `${binding.reference.id}:component-set`)).toEqual(['native', 'soft-relief', 'clear-glass', 'mechanical-outline'])
    }
  })

  it('offers no automatic semantic visual choice in the experimental question set', () => {
    const bundle = buildCompositionCandidates(input(mixedSource, { blockLayout: true }))
    expect(bundle.questions.flatMap(question => question.options.map(option => option.id))).not.toContain('auto')
    expect(options(bundle, 'surface')).toEqual(['semantic'])
    expect(options(bundle, 'layout')).not.toContain('auto')
    for (const binding of bundle.blockLayout!.blocks) {
      expect(binding.questionIds).toEqual(expect.arrayContaining([
        `${binding.reference.id}:presentation`,
        `${binding.reference.id}:component-set`,
      ]))
      expect(binding.questionIds.some(id => /:(?:surface|chart|layout|object-effect)$/.test(id))).toBe(false)
    }
  })

  it('binds every emitted option to a known concrete renderer recipe and validates each selectable plan', () => {
    const bundle = buildCompositionCandidates(input(mixedSource, { blockLayout: true }))
    const known = new Set<string>(BLOCK_PRESENTATION_IDS)
    for (const binding of bundle.blockLayout!.blocks) {
      const plans = binding.presentations!
      const questionId = `${binding.reference.id}:presentation`
      expect(options(bundle, questionId)).toEqual(plans.map(plan => plan.id))
      for (const plan of plans) {
        expect(known.has(plan.id)).toBe(true)
        expect(plan.evidence.length).toBeGreaterThan(0)
        expect(plan.selection.layout).not.toBe('auto')
        expect(plan.selection.objectEffect).not.toBe('auto')

        const selected = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [questionId]: plan.id })
        const block = selected.blockLayout!.blocks.find(item => item.id === binding.reference.id)!
        expect(block.presentation).toBe(plan.id)
        expect(block.selection.layout).not.toBe('auto')
        expect(block.selection.objectEffect).not.toBe('auto')
        expect(block.evidence).toEqual(expect.arrayContaining([...plan.evidence]))
      }
    }
  })

  it('describes every explicit recipe with purpose, source-specific applicability, and tradeoff without a preferred option', () => {
    const bundle = buildCompositionCandidates(input(mixedSource, { blockLayout: true }))
    for (const binding of bundle.blockLayout!.blocks) {
      const question = bundle.questions.find(item => item.id === `${binding.reference.id}:presentation`)!
      expect(question.prompt).toMatchObject({
        field: 'presentation',
        constraints: expect.arrayContaining(['No listed option is a default recommendation or preference.']),
      })
      for (const option of question.options) {
        const description = option.description as Record<string, unknown>
        expect(description).toMatchObject({
          purpose: expect.any(String),
          appropriateWhen: expect.any(String),
          tradeoff: expect.any(String),
          evidence: expect.any(Array),
        })
        expect((description.evidence as unknown[]).length).toBeGreaterThan(0)
      }
    }
  })

  it('attaches an actual bounded source mapping to a qualified full-Markdown chart and retains its notes', () => {
    const source = `**预算情景**

单位：亿元；按已确认预算口径估算，人员成本是假设，不是市场报价。

| 项目 | 金额 | 说明 |
| --- | ---: | --- |
| 基础预算 | 6.0 | 已确认 |
| 人员成本 | 1.5 | 假设 |
| 合计 | 7.5 | 不参与分项比较 |

本表总额按估算情景口径，合计不参与分项比较。`
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks.find(candidate => candidate.reference.kind === 'table')!
    const option = description(bundle, `${binding.reference.id}:presentation`, 'chart-openui')
    const mapping = option.chartMapping as { plans: Array<Record<string, unknown>> }
    const plan = mapping.plans[0]!
    const valueAxis = plan.valueAxis as { units: string[], series: Array<Record<string, unknown>> }
    const omitted = plan.omitted as { totals: { count: number, items: Array<Record<string, unknown>> }, fields: { count: number, items: Array<Record<string, unknown>> } }
    const qualifications = plan.sourceQualifications as { notes: string[] }

    expect(option.sourceScope).toMatchObject({ blockId: binding.reference.id, start: binding.reference.start, end: binding.reference.end })
    expect(plan.plan).toMatchObject({ kind: 'bar', basis: '单位：亿元' })
    expect(plan.categoryAxis).toMatchObject({ sourceColumn: 0, sourceHeader: '项目', kind: 'source-category' })
    expect(valueAxis.units).toEqual(['亿元'])
    expect(valueAxis.series).toEqual([expect.objectContaining({ name: '金额', unit: '亿元', sourceColumn: 1, sourceHeader: '金额' })])
    expect(omitted.totals).toMatchObject({ count: 1, items: [expect.objectContaining({ sourceRow: 2, category: '合计' })] })
    expect(omitted.fields).toMatchObject({ count: 1, items: [expect.objectContaining({ sourceColumn: 2, header: '说明' })] })
    expect(qualifications.notes.join(' ')).toContain('人员成本是假设')
    expect(qualifications.notes.join(' ')).toContain('合计不参与分项比较')

    const selected = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [`${binding.reference.id}:presentation`]: 'chart-openui' })
    expect(selected.blockLayout?.blocks.find(block => block.id === binding.reference.id)?.presentation).toBe('chart-openui')
  })

  it('bounds large chart mappings to source ranges and endpoint samples rather than duplicate raw tables', () => {
    const rows = Array.from({ length: 12 }, (_value, index) => `| Segment ${index + 1} | ${index + 1} |`).join('\n')
    const bundle = buildCompositionCandidates(input(`单位：亿美元。\n\n| Segment | Value |\n| --- | ---: |\n${rows}`, { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks.find(candidate => candidate.reference.kind === 'table')!
    const mapping = description(bundle, `${binding.reference.id}:presentation`, 'chart-openui').chartMapping as { plans: Array<Record<string, unknown>> }
    const plan = mapping.plans[0]!
    const categories = (plan.categoryAxis as { categories: Record<string, unknown> }).categories
    const series = ((plan.valueAxis as { series: Array<{ values: Record<string, unknown> }> }).series[0]!).values

    expect(categories).toMatchObject({ count: 12, omittedIndexRanges: [[4, 8]] })
    expect(categories).not.toHaveProperty('items')
    expect(series).toMatchObject({ count: 12, omittedIndexRanges: [[4, 8]] })
    expect(plan.sourceRows).toMatchObject({ includedRanges: [[0, 12]] })
  })

  it('connects registered source organization candidates with their block-local UTF-16 mapping and global source scope', () => {
    const source = `- **Latency:** 12 ms measured at the source boundary.
- **Availability:** 99.9% for the stated period.`
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks.find(candidate => options(bundle, `${candidate.reference.id}:presentation`).includes('source-list-grid'))!
    const questionId = `${binding.reference.id}:presentation`

    expect(options(bundle, questionId)).toEqual(expect.arrayContaining(['source-list-grid', 'source-label-table']))
    for (const id of ['source-list-grid', 'source-label-table']) {
      const option = description(bundle, questionId, id)
      const mapping = option.mapping as { coordinateSystem: string, lists: Array<Record<string, unknown>> }
      expect(mapping.coordinateSystem).toBe('block-local-utf16')
      expect(mapping.lists[0]).toMatchObject({ start: 0, items: expect.any(Array) })
      expect(option.sourceScope).toMatchObject({ blockId: binding.reference.id, start: binding.reference.start, end: binding.reference.end })
      const selected = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [questionId]: id })
      expect(selected.blockLayout?.blocks.find(block => block.id === binding.reference.id)).toMatchObject({
        presentation: id,
        selection: { surface: 'semantic', chart: 'auto', objectEffect: 'none', layout: 'document' },
      })
    }
  })
})
