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

  it('uses the finest feasible source-heading grouping instead of silently leaving a huge document prose block', () => {
    const markdown = Array.from({ length: 26 }, (_value, section) => [
      `# Section ${section + 1}`,
      'Opening source prose remains intact.',
      ...Array.from({ length: 5 }, (_detail, index) => `## Detail ${section + 1}.${index + 1}\nBounded source prose remains in this section.`),
    ].join('\n\n')).join('\n\n')
    const compiled = compileBlockLayout(markdown)
    const prose = compiled.blocks.filter(block => block.kind === 'prose')
    expect(prose).toHaveLength(26)
    expect(prose.every(block => block.evidence.includes('grouping:heading-depth:1'))).toBe(true)
    expect(validateBlockSourceReferences(markdown, refs(compiled.blocks))).toBe(true)
  })

  it('keeps reference and footnote definitions document-scoped without creating selectable definition blocks', () => {
    const afterCode = `[链接][ref]

\`\`\`txt
x
\`\`\`

[ref]: https://example.test`
    const codeCompilation = compileBlockLayout(afterCode)
    expect(codeCompilation.blocks.map(block => block.kind)).toEqual(['prose', 'code'])
    expect(codeCompilation.blocks.some(block => block.value === '[ref]: https://example.test')).toBe(false)
    expect(validateBlockSourceReferences(afterCode, refs(codeCompilation.blocks))).toBe(true)

    const mixed = `正文保留 [链接][ref] 与脚注[^note]。

[ref]: https://example.test

定义后仍是同一个可阅读正文块。

[^note]: 脚注的完整来源文本。`
    const mixedCompilation = compileBlockLayout(mixed)
    expect(mixedCompilation.blocks).toHaveLength(1)
    expect(mixedCompilation.blocks[0]).toMatchObject({ kind: 'prose', start: 0, end: mixed.length })
    expect(String(mixedCompilation.blocks[0]!.value)).toContain('[ref]: https://example.test')
    expect(String(mixedCompilation.blocks[0]!.value)).toContain('[^note]: 脚注的完整来源文本。')
    expect(validateBlockSourceReferences(mixed, refs(mixedCompilation.blocks))).toBe(true)
  })

  it('rejects a Markdown source made only of document-scoped definitions by name', () => {
    try {
      compileBlockLayout('[ref]: https://example.test\n\n[^note]: Footnote source.')
      throw new Error('Expected definitions-only failure')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidBlockCompilationError)
      expect((error as InvalidBlockCompilationError).code).toBe('BLOCK_LAYOUT_MARKDOWN_DEFINITIONS_ONLY')
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

  it('gives passive prose explicit source-preserving recipes and an actual component consumer', () => {
    const bundle = buildCompositionCandidates(input('Ordinary source prose remains readable.', { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks[0]!
    expect(options(bundle, `${binding.reference.id}:presentation`)).toEqual(expect.arrayContaining(['reading', 'cards', 'disclosure']))
    expect(options(bundle, `${binding.reference.id}:component-set`)).toEqual(['native', 'soft-relief', 'clear-glass', 'mechanical-outline'])
    const selection = validateCompositionChoices(bundle, bundle.defaultAnswers)
    expect(selection.blockLayout?.blocks).toHaveLength(1)
    expect(selection.blockLayout?.blocks[0]).toMatchObject({
      presentation: 'reading',
      selection: { surface: 'source', layout: 'document', chart: 'auto', objectEffect: 'none' },
    })
  })

  it('keeps global reading choices concrete while batching exact per-block recipes', () => {
    const bundle = buildCompositionCandidates(input(richMarkdown, { blockLayout: true }))
    expect(bundle.blockLayout?.version).toBe(1)
    expect(options(bundle, 'surface')).toEqual(['semantic'])
    expect(options(bundle, 'layout')).toEqual(expect.arrayContaining(['document', 'heading-index', 'continuous']))
    expect(options(bundle, 'layout')).not.toEqual(expect.arrayContaining(['table', 'board', 'records', 'flow', 'research']))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const workflow = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'ordered-list')!
    expect(table.questionIds.every(id => id.startsWith(`${table.reference.id}:`))).toBe(true)
    expect(options(bundle, `${workflow.reference.id}:presentation`)).toContain('flow')
    expect(options(bundle, `${table.reference.id}:presentation`)).toContain('table')
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
  })

  it('binds an ASCII chart recipe to a known compatible local theme', () => {
    const asciiTable = `| Segment | Value (USD) |
| --- | ---: |
| North | 4 |
| South | 6 |`
    const bundle = buildCompositionCandidates(input(asciiTable, { blockLayout: true }))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const chartQuestion = `${table.reference.id}:presentation`
    expect(options(bundle, chartQuestion)).toContain('chart-ascii')
    const asciiOption = bundle.questions.find(question => question.id === chartQuestion)?.options.find(option => option.id === 'chart-ascii')!
    const asciiTheme = table.presentations!.find(plan => plan.id === 'chart-ascii')!.selection.themeId
    expect(asciiOption.description).toMatchObject({ purpose: expect.stringContaining(asciiTheme) })
    const selected = validateCompositionChoices(bundle, { ...bundle.defaultAnswers, [chartQuestion]: 'chart-ascii', theme: 'empryo' })
    const block = selected.blockLayout!.blocks.find(block => block.id === table.reference.id)!
    expect(block.presentation).toBe('chart-ascii')
    expect(bundle.identity.asciiThemeIds).toContain(block.selection.themeId)
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
    expect(options(bundle, `${tables[0]!.reference.id}:presentation`)).not.toContain('chart-openui')
    expect(options(bundle, `${tables[1]!.reference.id}:presentation`)).toContain('chart-openui')
  })

  it('does not advertise OpenUI for a structured series that requires the dense renderer', () => {
    const records = [
      { date: '2024-01-01', 'Latency (ms)': 10 },
      { date: '2024-01-02', 'Latency (ms)': 9 },
      { date: '2024-02-01', 'Latency (ms)': 8 },
    ]
    const bundle = buildCompositionCandidates(input(records, { blockLayout: true }))
    const binding = bundle.blockLayout!.blocks[0]!
    expect(options(bundle, `${binding.reference.id}:presentation`)).toContain('chart-dense')
    expect(options(bundle, `${binding.reference.id}:presentation`)).not.toContain('chart-openui')
  })

  it('resolves reference-style table headers from the complete document for board eligibility', () => {
    const source = '| [Task][task] | Status | Description |\n| --- | --- | --- |\n| Inspect | queued | Keep the source. |\n| Render | done | Preserve the complete record. |\n\n[task]: https://example.com/task'
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const question = `${table.reference.id}:presentation`
    expect(options(bundle, question)).toContain('board')
    const selection = validateCompositionChoices(bundle, {...bundle.defaultAnswers,[question]:'board'})
    expect(selection.blockLayout!.blocks.find(block => block.id === table.reference.id)).toMatchObject({ presentation: 'board', selection: { layout: 'board' } })
  })

  it('offers state and object renderers as complete presentation recipes', () => {
    const cases: ReadonlyArray<[unknown, string]> = [
      [{ type: 'live-series', source: 'tool:latency', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1, value: 2 }, { time: 2, value: 1 }] }, 'live-liveline'],
      [{ loading: true, visibleContent: false, surface: 'table' }, 'loading-skullet'],
      [{ type: 'metric-update', label: 'Latency', previous: '10 ms', value: '8 ms' }, 'text-torph'],
      [{ type: 'glb', url: 'https://example.com/model.glb' }, 'object-ink'],
    ]
    for (const [value, expected] of cases) {
      const bundle = buildCompositionCandidates(input(value, { blockLayout: true }))
      const binding = bundle.blockLayout!.blocks[0]!
      expect(options(bundle, `${binding.reference.id}:presentation`)).toContain(expected)
    }
  })

  it('does not advertise a partial compact chart recipe for a table with multiple incompatible chart plans', () => {
    const source = `| Segment | Revenue (USD) | Cost (USD) | Margin (%) |
| --- | ---: | ---: | ---: |
| North | 4 | 2 | 40 |
| South | 6 | 3 | 50 |`
    const bundle = buildCompositionCandidates(input(source, { blockLayout: true }))
    const table = bundle.blockLayout!.blocks.find(block => block.reference.kind === 'table')!
    const recipeIds = options(bundle, `${table.reference.id}:presentation`)
    expect(recipeIds).not.toContain('chart-compact')
    expect(recipeIds).toContain('chart-openui')
  })

  it('does not let a selected theme lock be bypassed by a block component question', () => {
    const bundle = buildCompositionCandidates(input('Locked source prose.', { blockLayout: true, styleMode: 'selected', selectedThemeId: 'uiverse-soft-relief' }))
    const binding = bundle.blockLayout!.blocks[0]!
    expect(options(bundle, `${binding.reference.id}:component-set`)).toEqual(['soft-relief'])
  })
})
