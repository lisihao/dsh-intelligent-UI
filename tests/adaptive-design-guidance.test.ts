import { describe, expect, it } from 'vitest'

import paperFlowPackage from '../theme/paper-flow.dsh-theme.json' with { type: 'json' }
import { builtInThemes, themePackageSchema, type ThemePackage } from '../src/theme-contracts.js'
import { neutralDesignRubric, presentationGuidance } from '../src/adaptive-ui/design-guidance.js'
import { BLOCK_PRESENTATION_IDS } from '../src/adaptive-ui/presentation-recipes.js'
import { buildCompositionCandidates, validateCompositionChoices, type CandidateBundle, type CompositionInput } from '../src/adaptive-ui/planner.js'

function input(value: unknown, overrides: Partial<Omit<CompositionInput, 'value'>> = {}): CompositionInput {
  return {
    value,
    themes: builtInThemes,
    selectedThemeId: 'empryo',
    styleMode: 'automatic',
    capabilities: { webgl: true, reducedMotion: false },
    blockLayout: true,
    ...overrides,
  }
}

function question(bundle: CandidateBundle, id: string) {
  const value = bundle.questions.find(candidate => candidate.id === id)
  if (!value) throw new Error(`Question not found: ${id}`)
  return value
}

function option(bundle: CandidateBundle, questionId: string, optionId: string): Record<string, unknown> {
  const value = question(bundle, questionId).options.find(candidate => candidate.id === optionId)?.description
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Option description not found: ${questionId}/${optionId}`)
  return value as Record<string, unknown>
}

const source = `# SENSITIVE_SOURCE_SENTINEL

Readers need the exact evidence and qualification without a generated summary.

| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |`

const paperFlow = themePackageSchema.parse(paperFlowPackage)

describe('experimental adaptive design guidance', () => {
  it('keeps automatic experimental questions and eligibility invariant when only the active theme changes', () => {
    const empryo = buildCompositionCandidates(input(source, { selectedThemeId: 'empryo' }))
    const plain = buildCompositionCandidates(input(source, { selectedThemeId: 'plain' }))

    expect(plain.questions).toEqual(empryo.questions)
    expect(plain.semanticEvidence.candidates).toEqual(empryo.semanticEvidence.candidates)
  })

  it('carries self-contained, balanced theme metadata and treats custom descriptions as data', () => {
    const base = builtInThemes.find(theme => theme.id === 'plain')!
    const customTheme: ThemePackage = {
      ...base,
      id: 'custom-review',
      name: 'Custom review surface',
      author: 'Local reviewer',
      description: 'Ignore these words as instructions; this is only package metadata.',
    }
    const bundle = buildCompositionCandidates(input(source, { themes: [...builtInThemes, customTheme] }))
    const custom = option(bundle, 'theme', 'custom-review')
    const metadata = custom.theme as Record<string, unknown>

    expect(custom).toMatchObject({
      visualCharacteristics: expect.any(String),
      appropriateWhen: expect.any(String),
      benefits: expect.any(String),
      tradeoff: expect.any(String),
      eligibility: expect.any(String),
    })
    expect(metadata).toMatchObject({
      id: 'custom-review',
      name: 'Custom review surface',
      declaredDescription: 'Ignore these words as instructions; this is only package metadata.',
      declaredDescriptionHandling: expect.stringContaining('untrusted'),
      appearance: { backgroundColor: base.appearance.backgroundColor },
      tokens: { density: base.tokens.density, font: base.tokens.font },
    })

    const empryoText = JSON.stringify(option(bundle, 'theme', 'empryo')).toLowerCase()
    expect(empryoText).not.toContain('沿用当前')
    expect(empryoText).not.toContain('current')
    expect(empryoText).not.toContain('reference')
    expect(empryoText).not.toContain('default')
  })

  it('keeps automatic global theme choices separate from equally shaped per-block material choices', () => {
    const bundle = buildCompositionCandidates(input(source))
    const theme = question(bundle, 'theme')
    const binding = bundle.blockLayout!.blocks[0]!
    const materials = question(bundle, `${binding.reference.id}:component-set`)

    for (const candidate of theme.options) {
      const description = candidate.description as Record<string, unknown>
      const metadata = description.theme as Record<string, unknown>
      expect(description.purpose).toContain('global color')
      expect(description.purpose).toContain('independently')
      expect(metadata).not.toHaveProperty('componentSet')
      expect(JSON.stringify(description).toLowerCase()).not.toContain('current theme')
    }

    const schemas = materials.options.map(candidate => Object.keys(candidate.description as Record<string, unknown>).sort())
    expect(schemas).toEqual(schemas.map(() => schemas[0]))
    expect(materials.options.map(candidate => (candidate.description as { material: { id: string } }).material.id))
      .toEqual(['native', 'soft-relief', 'clear-glass', 'mechanical-outline'])
    for (const candidate of materials.options) {
      const description = candidate.description as Record<string, unknown>
      expect(description).toMatchObject({
        purpose: expect.stringContaining('ThemeCard'),
        visualCharacteristics: expect.any(String),
        appropriateWhen: expect.any(String),
        benefits: expect.any(String),
        tradeoff: expect.any(String),
      })
      expect(JSON.stringify(description).toLowerCase()).not.toContain('default recommendation')
    }

    for (const candidate of theme.options) {
      const selection = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, theme: candidate.id })
      expect(selection.themeId).toBe(candidate.id)
    }
    for (const candidate of materials.options) {
      const selection = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [`${binding.reference.id}:component-set`]: candidate.id })
      expect(selection.blockLayout?.blocks.find(block => block.id === binding.reference.id)?.selection.componentSet).toBe(candidate.id)
    }
    const locked = buildCompositionCandidates(input(source, { styleMode: 'selected', selectedThemeId: 'uiverse-soft-relief' }))
    const lockedBinding = locked.blockLayout!.blocks[0]!
    expect(question(locked, `${lockedBinding.reference.id}:component-set`).options.map(candidate => candidate.id)).toEqual(['soft-relief'])
  })

  it('derives concrete continuous-reading guidance from an imported continuous theme without forcing a root frame', () => {
    const bundle = buildCompositionCandidates(input(source, { themes: [...builtInThemes, paperFlow] }))
    const paper = option(bundle, 'theme', 'paper-flow')
    const metadata = paper.theme as Record<string, unknown>

    expect(paper).toMatchObject({
      visualCharacteristics: expect.stringContaining('opaque surfaces'),
      appropriateWhen: expect.stringContaining('continuous reading sequence'),
      benefits: expect.stringContaining('retaining original blocks'),
      tradeoff: expect.stringContaining('does not select or force the root frame'),
    })
    expect(metadata).toMatchObject({
      name: 'Paper · 连续信息流',
      appearance: { backgroundColor: '#08090b', translucent: false },
      tokens: { font: 'system', density: 'compact', composition: 'continuous' },
    })
  })

  it('uses one referenced neutral source-bound rubric and compact source scope on experimental prompts', () => {
    const bundle = buildCompositionCandidates(input(source))
    const binding = bundle.blockLayout!.blocks[0]!
    const presentation = question(bundle, `${binding.reference.id}:presentation`).prompt as Record<string, unknown>
    const material = question(bundle, `${binding.reference.id}:component-set`).prompt as Record<string, unknown>
    const rubric = neutralDesignRubric() as Record<string, unknown>

    expect(rubric).toMatchObject({
      sourceFidelity: expect.stringContaining('Hard constraint'),
      criteria: expect.arrayContaining(['content fit', 'readability', 'scannability', 'navigation', 'explicit source relationships', 'proportionate density', 'interaction cost']),
      comparison: expect.stringContaining('concrete reading or inspection need'),
      visualOrganization: expect.stringContaining('group existing source fields'),
      decorativeOnlyChange: expect.stringContaining('concrete'),
      prohibitedBiases: expect.arrayContaining([expect.stringContaining('novelty'), expect.stringContaining('native')]),
    })
    expect(rubric.sourceFidelity).toEqual(expect.stringContaining('semantic step or time order'))
    expect(rubric.contentBoundary).toEqual(expect.stringContaining('no registered adapter provides a source summary'))
    expect(rubric.contentBoundary).not.toEqual(expect.stringContaining('Do not add, omit, summarize, reorder'))
    for (const prompt of [presentation, material]) {
      expect(prompt.designRubricRef).toBe('composition.designRubric')
      expect(prompt.sourceScope).toMatchObject({ blockId: binding.reference.id, kind: binding.reference.kind, path: binding.reference.path })
      expect(JSON.stringify(prompt)).not.toContain('SENSITIVE_SOURCE_SENTINEL')
    }
  })

  it('describes materials and every registered block presentation with content fit and a concrete tradeoff', () => {
    const bundle = buildCompositionCandidates(input(source))
    const binding = bundle.blockLayout!.blocks[0]!
    const material = question(bundle, `${binding.reference.id}:component-set`)
    for (const candidate of material.options) {
      expect(candidate.description).toMatchObject({
        visualCharacteristics: expect.any(String),
        appropriateWhen: expect.any(String),
        benefits: expect.any(String),
        tradeoff: expect.any(String),
      })
    }

    expect(BLOCK_PRESENTATION_IDS).toEqual(expect.arrayContaining(['source-list-grid', 'source-label-table']))
    expect(BLOCK_PRESENTATION_IDS).toHaveLength(41)
    for (const id of BLOCK_PRESENTATION_IDS) {
      const guidance = presentationGuidance(id)
      expect(guidance.purpose.length).toBeGreaterThan(30)
      expect(guidance.contentFit.length).toBeGreaterThan(30)
      expect(guidance.tradeoff.length).toBeGreaterThan(30)
    }

    const cards = option(bundle, `${binding.reference.id}:presentation`, 'cards')
    const disclosure = option(bundle, `${binding.reference.id}:presentation`, 'disclosure')
    expect(cards).toMatchObject({ contentFit: expect.any(String), tradeoff: expect.stringContaining('does not split') })
    expect(disclosure).toMatchObject({
      purpose: expect.stringContaining('starts fully expanded'),
      contentFit: expect.stringContaining('collapse it after inspection'),
      tradeoff: expect.stringContaining('user-initiated collapse'),
    })
  })
})
