import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { validateTuffUiTypeSchemaManifest } from '../src/tuffui/type-schema.js'
import { registerTuffUiComponents, tuffUiContentSource } from '../src/tuffui/executable-components.js'

const catalog = createTuffUiCatalog(JSON.parse(readFileSync(new URL('../resources/components/tuffui/source-manifest.json', import.meta.url), 'utf8')))
const types = validateTuffUiTypeSchemaManifest(JSON.parse(readFileSync(new URL('../resources/components/tuffui/type-schema.json', import.meta.url), 'utf8')))
const registry = new ExecutableComponentRegistry()
registerTuffUiComponents(registry, catalog, { typeSchemas: types })
const context = (value: unknown, isStreaming = false) => ({ source: { id: 'semantic-source', value }, capabilities: { webgl: false, reducedMotion: true }, isStreaming })
function assessment(id: string, value: unknown) { return registry.audit(context(value)).entries.find(entry => entry.id === id) }

describe('actual TuffUI automatic semantic compatibility', () => {
  it('keeps ordinary source paragraphs eligible with exact content and actual streaming state', () => {
    const value = '完整的普通正文。\n\n第二段保留原来的条件与数值 6.0。'
    for (const isStreaming of [false, true]) {
      expect(registry.dispatch('tuffui:streaming-message', context(value, isStreaming)).input).toMatchObject({ binding: { props: { data: { content: value, status: isStreaming ? 'streaming' : 'done' } } } })
    }
  })

  it.each([
    '```ts\nconst amount = 6.0\n```',
    '$$\nx^2 + y^2 = 1\n$$',
    'A formula $x^2$ in source.',
    '\\(x^2\\)',
    '[TOC]',
    '# Heading\n\nBody',
    '- First\n- Second',
    '[Source](https://example.com/source)',
    'A &amp; B',
    'An escaped \\* marker',
    '__bold__',
    '``a`b``',
  ])('does not offer a plain-message adapter for unsupported Markdown: %s', value => {
    expect(assessment('tuffui:streaming-message', value)).toMatchObject({ eligible: false, reasons: ['TUFFUI_STREAMING_RICH_MARKDOWN_UNSUPPORTED'] })
  })

  it('projects displayed plain text, empty cells and exact decimal strings into the real DataTable contract', () => {
    const source = '| Label &amp; scope | Amount |\n| --- | ---: |\n| A \\| B | 6.0 |\n| | |'
    expect(registry.dispatch('tuffui:data-table', context(source)).input).toMatchObject({ binding: { props: {
      columns: [{ key: 'c0', label: 'Label & scope' }, { key: 'c1', label: 'Amount' }],
      data: [{ id: 'source-row-1', c0: 'A | B', c1: '6.0' }, { id: 'source-row-2', c0: '', c1: '' }],
    } } })
  })

  it.each(['`source()`', '$x^2$', '**important**', '[source](https://example.com/source)', '<b>source</b>'])('does not offer a String-cell table for rich source: %s', cell => {
    const source = `| Meaning | Value |\n| --- | --- |\n| ${cell} | 6.0 |`
    expect(assessment('tuffui:data-table', source)).toMatchObject({ eligible: false, reasons: ['TUFFUI_RICH_TABLE_CELL_UNSUPPORTED'] })
  })

  it('retains explicit source props instead of treating every supplied string as automatic Markdown', () => {
    const value = '```ts\nconst literal = true\n```'
    const source = tuffUiContentSource({ 'streaming-message': { exportName: 'StreamingMessage', props: { data: { content: value, status: 'done' }, showHeader: false } } })
    expect(registry.dispatch('tuffui:streaming-message', context(source)).input).toMatchObject({ binding: { props: { data: { content: value } } } })
  })
})
