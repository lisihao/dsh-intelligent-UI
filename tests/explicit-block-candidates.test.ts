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
})
