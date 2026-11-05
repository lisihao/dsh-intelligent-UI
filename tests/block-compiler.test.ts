import { describe, expect, it } from 'vitest'
import { builtInThemes } from '../src/theme-contracts.js'
import {
  InvalidBlockCompilationError,
  compileBlockLayout,
  validateBlockSourceReferences,
  type BlockSourceReference,
} from '../src/adaptive-ui/block-compiler.js'
import {
  buildCompositionCandidates,
  validateCompositionChoices,
  type CandidateBundle,
  type CompositionInput,
} from '../src/adaptive-ui/planner.js'

const richMarkdown = `# Source-bound report

This opening paragraph keeps a [reference link][primary] and its complete document context.

## Metrics

| Year | Revenue (USD) |
| --- | ---: |
| 2023 | 10 |
| 2024 | 20 |
| 2025 | 30 |

## Workflow

1. Collect source facts
2. Verify stated limits
3. Publish the original record

~~~ts
const source = 'preserved'
~~~

[primary]: https://example.com/primary
`

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

function refs(blocks: ReturnType<typeof compileBlockLayout>['blocks']): BlockSourceReference[] {
  return blocks.map(({ id, path, start, end, kind, evidence }) => ({ id, path, ...(start === undefined ? {} : { start, end }), kind, evidence }))
}

describe('source-bound block compiler', () => {
  it('uses complete Markdown AST positions, coalesces passive prose, and preserves qualified ordered-list flow context', () => {
    const compiled = compileBlockLayout(richMarkdown)
    expect(compiled.version).toBe(1)
    expect(compiled.blocks.map(block => block.kind)).toEqual(expect.arrayContaining(['prose', 'table', 'ordered-list', 'code']))
    const table = compiled.blocks.find(block => block.kind === 'table')!
    expect(richMarkdown.slice(table.start, table.end)).toContain('| Year | Revenue (USD) |')
    const workflow = compiled.blocks.find(block => block.kind === 'ordered-list')!
    expect(workflow.evidence).toContain('source:flow:ordered-list')
    expect(workflow.path).toEqual([])
    expect(validateBlockSourceReferences(richMarkdown, refs(compiled.blocks))).toBe(true)
    expect(validateBlockSourceReferences(richMarkdown, refs(compiled.blocks).map((block, index) => index === 0 ? { ...block, kind: 'forged' } : block))).toBe(false)
  })

  it('scopes normalized text blocks and structured values with paths rather than combining their source', () => {
    const source = [
      { type: 'text', text: '# First\n\n| A | B |\n| --- | ---: |\n| x | 1 |\n| y | 2 |' },
      { type: 'text', text: JSON.stringify({ type: 'live-series', source: 'tool:latency', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1, value: 2 }, { time: 2, value: 1 }] }) },
    ]
    const compiled = compileBlockLayout(source)
    expect(compiled.blocks.some(block => block.path.join('.') === '0' && block.kind === 'table')).toBe(true)
    expect(compiled.blocks.some(block => block.path.join('.') === '1' && block.kind === 'structured-record')).toBe(true)
    expect(validateBlockSourceReferences(source, refs(compiled.blocks))).toBe(true)
  })

  it('fails by name instead of truncating a source that exceeds the block limit', () => {
    const markdown = Array.from({ length: 129 }, (_value, index) => `\`\`\`txt\n${index}\n\`\`\``).join('\n\n')
    try {
      compileBlockLayout(markdown)
      throw new Error('Expected block-limit failure')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidBlockCompilationError)
      expect((error as InvalidBlockCompilationError).code).toBe('BLOCK_LAYOUT_BLOCK_LIMIT_EXCEEDED')
    }
  })
})

describe('experimental block composition planner', () => {
  it('leaves legacy candidates byte-for-byte equivalent when the toggle is absent or false', () => {
    const ordinary = buildCompositionCandidates(input(richMarkdown))
    const disabled = buildCompositionCandidates(input(richMarkdown, { blockLayout: false }))
    expect(disabled).toEqual(ordinary)
    expect(disabled.blockLayout).toBeUndefined()
  })

  it('keeps passive prose native and does not ask for a component treatment without a renderer consumer', () => {
    const bundle = buildCompositionCandidates(input('Ordinary source prose remains readable.', { blockLayout: true }))
    expect(options(bundle, 'component-set')).toHaveLength(1)
    const selection = validateCompositionChoices(bundle, bundle.defaultAnswers)
    expect(selection.blockLayout?.blocks).toHaveLength(1)
    expect(selection.blockLayout?.blocks[0]?.selection).toMatchObject({ surface: 'source', layout: 'document', chart: 'auto', objectEffect: 'none' })
  })

  it('keeps global reading choices narrow while batching exact per-block choices', () => {
    const bundle = buildCompositionCandidates(input(richMarkdown, { blockLayout: true }))
    expect(bundle.blockLayout?.version).toBe(1)
    expect(options(bundle, 'layout')).toEqual(expect.arrayContaining(['auto', 'document']))
    expect(options(bundle, 'layout')).not.toEqual(expect.arrayContaining(['table', 'board', 'records', 'flow', 'research']))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const workflow = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'ordered-list')!
    expect(table.questionIds.every(id => id.startsWith(`${table.reference.id}:`))).toBe(true)
    expect(options(bundle, `${workflow.reference.id}:layout`)).toContain('flow')
    expect(options(bundle, `${table.reference.id}:chart`)).toEqual(expect.arrayContaining(['auto', 'dense', 'visx']))
    expect(options(bundle, `${table.reference.id}:component-set`)).toEqual(expect.arrayContaining(['native', 'soft-relief', 'clear-glass', 'mechanical-outline']))
    const inspection = bundle.questions.find(question => question.id === 'inspection')
    expect(inspection?.options.map(option => option.id)).toEqual(['none', 'research'])
    expect(inspection?.options[1]?.description).toMatchObject({
      purpose: expect.stringContaining('report-local'),
      appropriateWhen: expect.any(String),
      tradeoff: expect.stringContaining('neither verifies citations'),
    })
    expect(JSON.stringify(bundle.blockLayout)).not.toContain('catalog')

    const selection = validateCompositionChoices(bundle, bundle.defaultAnswers)
    expect(selection.blockLayout?.inspection).toBe('none')
    expect(selection.blockLayout?.blocks).toHaveLength(bundle.blockLayout!.blocks.length)
    expect(selection.blockLayout?.blocks.every(block => block.selection.themeId === selection.themeId)).toBe(true)
    expect(validateBlockSourceReferences(richMarkdown, selection.blockLayout!.blocks)).toBe(true)

    const selectedHistorical = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [`${table.reference.id}:chart`]: 'visx' })
    expect(selectedHistorical.blockLayout?.blocks.find(block => block.id === table.reference.id)?.evidence).toContain('historical-time-series')
  })

  it('rejects a per-block ASCII chart under a non-ASCII global theme', () => {
    const asciiTable = `| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |`
    const bundle = buildCompositionCandidates(input(asciiTable, { blockLayout: true }))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const chartQuestion = `${table.reference.id}:chart`
    expect(options(bundle, chartQuestion)).toContain('ascii')
    expect(() => validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [chartQuestion]: 'ascii', theme: 'empryo' })).toThrow(/ASCII chart choice/)
  })

  it('uses the exact full-document table analysis so a local slice cannot lose comparison prohibitions', () => {
    const source = `## Restricted comparison

不能直接比较。

| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |

以上数据不可比。

## Separate valid comparison

| Segment | Value (USD) |
| --- | ---: |
| East | 3 |
| West | 7 |`
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const tables = bundle.blockLayout!.blocks.filter(block => block.reference.kind === 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0]!.fixedAnswers.chart).toBe('auto')
    expect(options(bundle, `${tables[0]!.reference.id}:chart`)).toEqual([])
    expect(options(bundle, `${tables[1]!.reference.id}:chart`)).toEqual(expect.arrayContaining(['auto', 'openui']))
  })

  it('does not advertise OpenUI for a structured series that the existing renderer must route through dense lines', () => {
    const records = [
      { date: '2024-01-01', 'Latency (ms)': 10 },
      { date: '2024-01-02', 'Latency (ms)': 9 },
      { date: '2024-02-01', 'Latency (ms)': 8 },
    ]
    const bundle = buildCompositionCandidates(input(records, { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks[0]!
    expect(options(bundle, `${binding.reference.id}:chart`)).toEqual(expect.arrayContaining(['auto', 'dense']))
    expect(options(bundle, `${binding.reference.id}:chart`)).not.toContain('openui')
  })

  it('resolves reference-style table headers from the complete document for board eligibility', () => {
    const source = '| [Task][task] | Status | Description |\n| --- | --- | --- |\n| Inspect | queued | Keep the source. |\n| Render | done | Preserve the complete record. |\n\n[task]: https://example.com/task'
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    expect(options(bundle, `${table.reference.id}:layout`)).toContain('board')
    const selection = validateCompositionChoices(bundle, {...bundle.defaultAnswers,[`${table.reference.id}:layout`]:'board'})
    expect(selection.blockLayout!.blocks.find(block => block.id === table.reference.id)?.selection.layout).toBe('board')
  })

  it('retains every eligible stateful runtime axis as a local block choice', () => {
    const cases: ReadonlyArray<[unknown, string, string]> = [
      [{ type: 'live-series', source: 'tool:latency', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1, value: 2 }, { time: 2, value: 1 }] }, 'live', 'liveline'],
      [{ loading: true, visibleContent: false, surface: 'table' }, 'loading', 'skullet'],
      [{ type: 'metric-update', label: 'Latency', previous: '10 ms', value: '8 ms' }, 'text-motion', 'torph'],
      [{ type: 'glb', url: 'https://example.com/model.glb' }, 'object-effect', 'ink-object'],
    ]
    for (const [value, field, expected] of cases) {
      const bundle = buildCompositionCandidates(input(value, { blockLayout: true }))
      const binding = bundle.blockLayout!.blocks[0]!
      expect(options(bundle, `${binding.reference.id}:${field}`)).toContain(expected)
    }
  })
})
