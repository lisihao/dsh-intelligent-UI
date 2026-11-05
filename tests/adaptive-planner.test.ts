import { describe, expect, it } from 'vitest'
import { builtInThemes } from '../src/theme-contracts.js'
import { getCompositionCatalog } from '../src/adaptive-ui/catalog.js'
import { adaptiveComponentProvenanceById } from '../src/adaptive-ui/component-provenance.js'
import { compositionSelectionSchema } from '../src/adaptive-ui/contracts.js'
import {
  buildCompositionCandidates,
  InvalidCompositionChoiceError,
  liveSeriesInputSchema,
  normalizeCompositionSource,
  recognizeLiveSeries,
  validateCompositionChoices,
  type CandidateBundle,
  type CompositionInput,
} from '../src/adaptive-ui/planner.js'

const baseInput = (value: unknown, overrides: Partial<Omit<CompositionInput, 'value'>> = {}): CompositionInput => ({
  value,
  themes: builtInThemes,
  selectedThemeId: 'empryo',
  styleMode: 'automatic',
  capabilities: { webgl: true, reducedMotion: false },
  ...overrides,
})

function options(bundle: CandidateBundle, id: string): string[] {
  const question = bundle.questions.find(candidate => candidate.id === id)
  if (!question) return []
  return question.options.map(option => option.id)
}

const broadMarkdown = `# Evidence-led report

## Trend

| Year | Revenue (USD) |
| --- | ---: |
| 2023 | 10 |
| 2024 | 20 |
| 2025 | 30 |

## Comparison

| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |

## Work items

Start -> Verify -> Publish

| Task | Status | Description |
| --- | --- | --- |
| Inspect source | queued | Keep the original source accessible. |
| Render result | running | Use only deterministic candidates. |

## Evidence

The report cites [a primary source](https://example.com/report).

## Limits

The table remains available with its original units.
`

const toolTextBlocks = [
  {
    type: 'text',
    text: `# Tool output

## Historical values

| Year | Latency (ms) |
| --- | ---: |
| 2023 | 11 |
| 2024 | 9 |
| 2025 | 8 |`,
  },
  {
    type: 'text',
    text: `## Scenarios

| Scenario | Position | Detail |
| --- | --- | --- |
| Base case | Stable demand | This source-owned scenario keeps its original assumptions, units, time boundary, evidence limits, and qualifications available for comparison without generating a probability or recommendation. |
| Capacity case | Constrained delivery | This source-owned scenario records the stated capacity constraint, its observed timing, source basis, and conditional result without converting it into a causal claim or a missing measurement. |
| Downside case | Lower utilization | This source-owned scenario preserves the reported lower-utilization condition, its stated caveats, source limitation, and exact text for readers who need to inspect the original material. |`,
  },
  {
    type: 'text',
    text: `## Process

Collect -> Validate -> Render

## Limits

All source tables and qualifications remain inspectable.`,
  },
]

describe('adaptive composition catalog', () => {
  it('makes runtime, development-only, metadata-only, and blocked inventory visible separately', () => {
    const catalog = getCompositionCatalog(builtInThemes)
    expect(catalog.revision).toBe(1)
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'surface:source', availability: 'runtime' }))
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'uiverse:soft-relief:button', availability: 'runtime' }))
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'uiverse:galaxy-archive', availability: 'development-only' }))
    expect(catalog.entries.find(entry => entry.id === 'uiverse:galaxy-archive')?.metadata).toMatchObject({ components: 3802, categories: 11, executable: false })
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'canvas:ink-object', availability: 'conditional' }))
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'canvas:ascii-sweep', availability: 'blocked' }))
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'component:liveline', availability: 'conditional' }))
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'component:visx-historical', availability: 'conditional' }))
    const liveline = adaptiveComponentProvenanceById.liveline
    const livelineEntry = catalog.entries.find(entry => entry.id === 'component:liveline')
    expect(livelineEntry?.provenance).toMatchObject({
      package: liveline.packages.map(pkg => pkg.name).join(' + '),
      commit: liveline.sourceCommit,
      sourceUrl: liveline.sourceUrl,
    })
    expect(livelineEntry?.metadata).toMatchObject({
      sourceCommit: liveline.sourceCommit,
      packages: liveline.packages.map(pkg => ({ name: pkg.name, version: pkg.version, entry: pkg.entry, integrity: pkg.integrity })),
    })
    expect(catalog.entries.find(entry => entry.id === 'surface:continuous-paper')?.eligibility.allOf).toEqual(['sectioned-mixed-media-markdown'])
    expect(catalog.entries).toContainEqual(expect.objectContaining({ id: 'theme:empryo', availability: 'runtime' }))
  })
})

describe('buildCompositionCandidates', () => {
  it('offers only source-backed semantic choices across every installed theme', () => {
    const bundle = buildCompositionCandidates(baseInput(broadMarkdown))
    expect(options(bundle, 'theme')).toEqual([...builtInThemes].sort((left, right) => left.id.localeCompare(right.id)).map(theme => theme.id))
    expect(options(bundle, 'chart')).toEqual(expect.arrayContaining(['auto', 'openui', 'visx', 'ascii']))
    const asciiOption = bundle.questions.find(question => question.id === 'chart')?.options.find(option => option.id === 'ascii')
    expect(asciiOption?.description).toMatchObject({ reasons: expect.arrayContaining(['requires-ascii-theme']) })
    expect(options(bundle, 'layout')).toEqual(expect.arrayContaining(['auto', 'document', 'table', 'board', 'flow', 'research', 'heading-index', 'continuous']))
    expect(options(bundle, 'component-set')).toEqual(['native', 'soft-relief', 'clear-glass', 'mechanical-outline'])
    expect(bundle.semanticEvidence.candidates.find(candidate => candidate.id === 'surface:free-text-graph')).toBeUndefined()
    expect(bundle.catalog.entries.find(entry => entry.id === 'surface:free-text-graph')?.availability).toBe('blocked')
    const selection = validateCompositionChoices(bundle, bundle.defaultAnswers)
    expect(selection).toMatchObject({
      themeId: 'empryo', surface: 'semantic', chart: 'auto', componentSet: 'native', layout: 'auto', objectEffect: 'none',
    })
    expect(compositionSelectionSchema.parse(selection)).toEqual(selection)
  })

  it('locks the selected theme and rejects unavailable or extra choice answers', () => {
    const bundle = buildCompositionCandidates(baseInput('A short source.', { styleMode: 'selected', selectedThemeId: 'plain' }))
    expect(options(bundle, 'theme')).toEqual(['plain'])
    expect(options(bundle, 'component-set')).toEqual(['native'])
    expect(() => validateCompositionChoices(bundle, { ...bundle.defaultAnswers, theme: 'ascii' })).toThrow(InvalidCompositionChoiceError)
    expect(() => validateCompositionChoices(bundle, { ...bundle.defaultAnswers, unknown: 'unexpected' })).toThrow(InvalidCompositionChoiceError)
    expect(() => validateCompositionChoices(bundle, { ...bundle.defaultAnswers, chart: 'not-a-candidate' })).toThrow(InvalidCompositionChoiceError)
  })

  it('locks an explicitly selected v2 component set while automatic mode may select every compiled set', () => {
    const selected = buildCompositionCandidates(baseInput('A short source.', { styleMode: 'selected', selectedThemeId: 'uiverse-clear-glass' }))
    expect(options(selected, 'component-set')).toEqual(['clear-glass'])
    expect(() => validateCompositionChoices(selected, { ...selected.defaultAnswers, 'component-set': 'soft-relief' })).toThrow(InvalidCompositionChoiceError)
    const automatic = buildCompositionCandidates(baseInput('A short source.'))
    expect(options(automatic, 'component-set')).toEqual(['native', 'soft-relief', 'clear-glass', 'mechanical-outline'])
  })

  it('keeps a selected GPU theme as text-only fallback but excludes it from automatic selection without a GPU route', () => {
    const unsupported = buildCompositionCandidates(baseInput('A short source.', { capabilities: { webgl: false, reducedMotion: false } }))
    expect(options(unsupported, 'theme')).not.toContain('ascii-gpu')
    expect(unsupported.semanticEvidence.candidates.find(candidate => candidate.id === 'theme:ascii-gpu')).toMatchObject({
      eligible: false, reasons: expect.arrayContaining(['webgl-unavailable-native-gpu-fallback']),
    })
    const automaticSelectedGpu = buildCompositionCandidates(baseInput('A short source.', {
      selectedThemeId: 'ascii-gpu', capabilities: { webgl: false, reducedMotion: false },
    }))
    expect(automaticSelectedGpu.defaultAnswers.theme).not.toBe('ascii-gpu')
    expect(validateCompositionChoices(automaticSelectedGpu, automaticSelectedGpu.defaultAnswers).themeId).not.toBe('ascii-gpu')
    const selected = buildCompositionCandidates(baseInput('A short source.', {
      styleMode: 'selected', selectedThemeId: 'ascii-gpu', capabilities: { webgl: false, reducedMotion: false },
    }))
    expect(options(selected, 'theme')).toEqual(['ascii-gpu'])
    expect(selected.semanticEvidence.candidates.find(candidate => candidate.id === 'theme:ascii-gpu')).toMatchObject({
      eligible: true, reasons: expect.arrayContaining(['selected-theme-gpu-native-fallback']),
    })
  })

  it('does not turn a static historical chart into a live series and rejects incompatible ASCII combinations', () => {
    const bundle = buildCompositionCandidates(baseInput(broadMarkdown))
    expect(options(bundle, 'live')).toEqual([])
    expect(() => validateCompositionChoices(bundle, { ...bundle.defaultAnswers, theme: 'empryo', chart: 'ascii' })).toThrow(/ASCII chart choice requires an ASCII theme/)
  })

  it('uses a structured explicit graph but never infers a graph from free text or HTML', () => {
    const graph = buildCompositionCandidates(baseInput({
      nodes: [{ id: 'collect', label: 'Collect' }, { id: 'review', label: 'Review' }],
      edges: [{ source: 'collect', target: 'review', label: 'source relation' }],
    }))
    expect(options(graph, 'layout')).toContain('flow')
    const freeText = buildCompositionCandidates(baseInput('```json\n{"nodes":[{"id":"a"}],"edges":[]}\n```\n<div data-graph="invented"></div>'))
    expect(options(freeText, 'layout')).not.toContain('flow')
    expect(freeText.catalog.entries.find(entry => entry.id === 'surface:arbitrary-html')?.availability).toBe('blocked')
  })

  it('aggregates normal tool text blocks into chart, records, and flow candidates without crossing blocks', () => {
    const normalized = normalizeCompositionSource(toolTextBlocks)
    expect(normalized).toMatchObject({ kind: 'blocks' })
    if (normalized.kind !== 'blocks') throw new Error('Expected independently normalized blocks')
    expect(normalized.values).toHaveLength(3)
    expect(normalized.values[2]).toContain('Collect -> Validate -> Render')

    const bundle = buildCompositionCandidates(baseInput(toolTextBlocks))
    expect(bundle.semanticEvidence.sourceKind).toBe('blocks')
    expect(options(bundle, 'chart')).toEqual(expect.arrayContaining(['openui', 'visx']))
    expect(options(bundle, 'layout')).toEqual(expect.arrayContaining(['document', 'table', 'records', 'flow']))
    expect(options(bundle, 'layout')).not.toEqual(expect.arrayContaining(['heading-index', 'continuous']))
    for (const layout of ['table', 'records', 'flow'] as const) {
      const selection = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, layout })
      expect(selection.layout).toBe(layout)
      expect(compositionSelectionSchema.parse(selection)).toEqual(selection)
    }
  })

  it('recursively decodes a single text block JSON value for live, graph, and record candidates', () => {
    const asTextBlock = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]
    const live = asTextBlock({
      type: 'live-series', source: 'tool:metric-feed', unit: 'ms', timeUnit: 'milliseconds', updatedAt: 2_000,
      points: [{ time: 1_000, value: 12 }, { time: 2_000, value: 10 }],
    })
    expect(buildCompositionCandidates(baseInput(live)).semanticEvidence.sourceKind).toBe('live-series')
    expect(options(buildCompositionCandidates(baseInput(live)), 'live')).toEqual(['native', 'liveline'])

    const graph = asTextBlock({
      nodes: [{ id: 'collect', label: 'Collect' }, { id: 'review', label: 'Review' }],
      edges: [{ source: 'collect', target: 'review' }],
    })
    expect(options(buildCompositionCandidates(baseInput(graph)), 'layout')).toContain('flow')

    const records = asTextBlock([
      { name: 'Base', description: 'This original record retains enough detail to remain inspectable, including its stated limits, source basis, terminology, and conditions without turning it into a generated recommendation.' },
      { name: 'Downside', description: 'This original record separately retains enough detail to preserve its stated uncertainty, time boundary, evidence limitation, and exact distinction from the other named record.' },
    ])
    expect(options(buildCompositionCandidates(baseInput(records)), 'layout')).toContain('records')
  })

  it('does not synthesize a graph from JSON fragments kept inside separate Markdown code fences', () => {
    const fencedBlocks = [
      { type: 'text', text: '```json\n{"nodes":[{"id":"left","label":"Left"}]}\n```' },
      { type: 'text', text: '```json\n{"edges":[{"source":"left","target":"right"}]}\n```' },
    ]
    expect(normalizeCompositionSource(fencedBlocks)).toMatchObject({ kind: 'blocks' })
    const bundle = buildCompositionCandidates(baseInput(fencedBlocks))
    expect(bundle.semanticEvidence.sourceKind).toBe('blocks')
    expect(options(bundle, 'layout')).not.toContain('flow')
  })

  it('recognizes only the exact live-series contract and keeps a valid default selection', () => {
    const live = {
      type: 'live-series', source: 'tool:metric-feed', unit: 'ms', timeUnit: 'milliseconds', updatedAt: 3_000,
      points: [{ time: 1_000, value: 12 }, { time: 2_000, value: 10 }, { time: 3_000, value: 11 }],
    }
    const bundle = buildCompositionCandidates(baseInput(live))
    expect(options(bundle, 'live')).toEqual(['native', 'liveline'])
    expect(validateCompositionChoices(bundle, bundle.defaultAnswers).live).toBe('liveline')
    const staticTable = buildCompositionCandidates(baseInput([{ time: 1_000, value: 12 }, { time: 2_000, value: 10 }]))
    expect(options(staticTable, 'live')).toEqual([])

    const staleUpdate = { ...live, updatedAt: 2_999 }
    expect(liveSeriesInputSchema.safeParse(staleUpdate).success).toBe(false)
    expect(recognizeLiveSeries(staleUpdate)).toBeUndefined()
    expect(options(buildCompositionCandidates(baseInput(staleUpdate)), 'live')).toEqual([])
  })

  it('keeps animation-specific library choices out of reduced-motion output', () => {
    const initialLoading = { loading: true, visibleContent: false, surface: 'table' }
    const regular = buildCompositionCandidates(baseInput(initialLoading))
    expect(options(regular, 'loading')).toEqual(['native', 'skullet'])
    expect(validateCompositionChoices(regular, regular.defaultAnswers).loading).toBe('skullet')
    const reduced = buildCompositionCandidates(baseInput(initialLoading, { capabilities: { webgl: true, reducedMotion: true } }))
    expect(options(reduced, 'loading')).toEqual(['native'])

    const update = { type: 'metric-update', label: 'Latency', previous: '10 ms', value: '8 ms' }
    expect(options(buildCompositionCandidates(baseInput(update)), 'text-motion')).toEqual(['none', 'torph'])
    expect(options(buildCompositionCandidates(baseInput(update, { capabilities: { webgl: true, reducedMotion: true } })), 'text-motion')).toEqual(['none'])
  })
})
