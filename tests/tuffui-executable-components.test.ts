import { describe, expect, test } from 'vitest'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { registerTuffUiComponents, tuffUiContentSource, TUFFUI_EXECUTABLE_RENDERER_KEY } from '../src/tuffui/executable-components.js'

const ids = `surface action-button choice-controls status-pill segmented-control progress-bar rolling-number text-field tooltip-hint action-menu popover-panel modal-sheet toast-stack select-field tab-panels disclosure agent-avatar loading-skeleton range-slider key-hint loader empty-state date-field drop-zone ai-chat coding-agent data-answer booking-assistant agent-console support-widget handoff-inbox streaming-message agent-status message-branches response-feedback agent-composer agent-question tool-approval-queue tool-call-block file-changes terminal-output mcp-servers background-agents checkpoint-timeline run-trace eval-results context-window-meter memory-panel usage-summary rate-limits chat-thread user-message conversation-list prompt-suggestions attachment-preview code-block source-list chart-card dot-histogram tick-gauge mirror-strips radial-dots match-field radar-chart diverging-bars blast-radius iso-bars hex-density data-table stat-grid form-card result-carousel slot-picker confirmation-card json-viewer artifact-panel`.split(' ')
const blocks = new Set(['ai-chat', 'coding-agent', 'data-answer', 'booking-assistant', 'agent-console', 'support-widget', 'handoff-inbox'])
const prop = (name: string, sourceType: string, wireType: string, optional = false) => ({ name, sourceType, wireType, optional })
function catalog() {
  const entry = (id: string) => ({ id, kind: blocks.has(id) ? 'block' : 'ui', title: id, description: `Pinned ${id}`, sourcePath: `registry/${id}/${id}.tsx`, sha256: 'a'.repeat(64), exports: [{ name: 'Rendered', props: [prop('data', 'Record<string, unknown>', 'object')] }] })
  const entries = ids.map(entry)
  const replace = (id: string, name: string, props: readonly ReturnType<typeof prop>[]) => { const index = entries.findIndex(entry => entry.id === id); entries[index] = { ...entries[index]!, exports: [{ name, props: [...props] }] } }
  replace('data-table', 'DataTable', [prop('data', 'DataRow[]', 'array'), prop('columns', 'DataColumn[]', 'array'), prop('title', 'string', 'string'), prop('subtitle', 'string', 'string', true), prop('pageSize', 'number', 'number', true), prop('searchable', 'boolean', 'boolean', true), prop('onRowClick', '(row: DataRow) => void', 'callback', true)])
  replace('json-viewer', 'JsonViewer', [prop('data', 'JsonValue', 'unknown'), prop('title', 'string', 'string', true), prop('defaultDepth', 'number', 'number', true)])
  replace('code-block', 'CodeBlock', [prop('data', 'CodeBlockData', 'object'), prop('showLineNumbers', 'boolean', 'boolean', true), prop('defaultWrap', 'boolean', 'boolean', true)])
  replace('source-list', 'SourceList', [prop('data', 'SourceListData', 'object'), prop('variant', 'string', 'string', true)])
  replace('streaming-message', 'StreamingMessage', [prop('data', 'StreamingMessageData', 'object'), prop('model', 'string', 'string', true), prop('showHeader', 'boolean', 'boolean', true)])
  replace('chart-card', 'ChartCard', [prop('data', '{ labels: string[]; series: ChartSeries[] }', 'object'), prop('type', 'ChartType', 'string', true), prop('title', 'string', 'string'), prop('subtitle', 'string', 'string', true)])
  return createTuffUiCatalog({ formatVersion: 1, repository: 'https://github.com/yurigdesigner/tuffui.git', commit: '378f3eaac693c693d2ec845baf38bf6c0488cb37', license: 'MIT', registrySha256: 'b'.repeat(64), entries })
}
const capabilities = { webgl: false, reducedMotion: true }
const typeSchemas = {
  formatVersion: 1 as const,
  sourceManifestSha256: 'c'.repeat(64),
  entries: {
    'data-table': {
      DataTable: {
        data: { kind: 'array' as const, items: { kind: 'object' as const, properties: { id: { optional: false, schema: { kind: 'string' as const } }, task: { optional: false, schema: { kind: 'string' as const } } } } },
        columns: { kind: 'array' as const, items: { kind: 'object' as const, properties: { key: { optional: false, schema: { kind: 'string' as const } }, label: { optional: false, schema: { kind: 'string' as const } } } } },
        title: { kind: 'string' as const },
      },
    },
    'chart-card': {
      ChartCard: {
        data: { kind: 'object' as const, properties: {
          labels: { optional: false, schema: { kind: 'array' as const, items: { kind: 'string' as const } } },
          series: {
            optional: false,
            schema: {
              kind: 'array' as const,
              items: {
                kind: 'object' as const,
                properties: {
                  id: { optional: false, schema: { kind: 'string' as const } },
                  label: { optional: false, schema: { kind: 'string' as const } },
                  values: { optional: false, schema: { kind: 'array' as const, items: { kind: 'number' as const } } },
                },
              },
            },
          },
        } },
      },
    },
  },
}

describe('TuffUI executable component registration', () => {
  test('registers all 76 pinned IDs, but only exposes projections with real source evidence', () => {
    const registry = new ExecutableComponentRegistry(), source = '| Name | Score |\n| --- | ---: |\n| Alpha | 7 |\n| Beta | 9 |'
    registerTuffUiComponents(registry, catalog())
    expect(registry.list()).toHaveLength(76)
    const audit = registry.audit({ source: { id: 'block-1', value: source }, capabilities })
    expect(audit.entries.find(entry => entry.id === 'tuffui:data-table')).toMatchObject({ eligible: true, rendererKey: TUFFUI_EXECUTABLE_RENDERER_KEY })
    expect(audit.entries.find(entry => entry.id === 'tuffui:agent-console')).toMatchObject({ eligible: false, reasons: ['TUFFUI_SOURCE_PROJECTION_NOT_APPLICABLE'] })
    const dispatch = registry.dispatch('tuffui:data-table', { source: { id: 'block-1', value: source }, capabilities })
    expect(dispatch).toMatchObject({ id: 'tuffui:data-table', rendererKey: 'tuffui-v1', input: { componentId: 'data-table', binding: { exportName: 'DataTable' } } })
  })

  test('validates an explicit same-ID binding and rejects an action outside Host authority', () => {
    const registry = new ExecutableComponentRegistry(), input = { exportName: 'DataTable', props: { data: [{ id: 'a', task: 'Actual host row' }], columns: [{ key: 'task', label: 'Task' }], title: 'Actual host data' }, actions: [{ prop: 'onRowClick', actionId: 'host-table-select' }] }
    registerTuffUiComponents(registry, catalog(), { typeSchemas })
    const source = tuffUiContentSource({ 'data-table': input }, undefined, 'block-2')
    expect(registry.dispatch('tuffui:data-table', { source, capabilities, hostActionIds: ['host-table-select'] })).toMatchObject({ input: { componentId: 'data-table', binding: { props: { title: 'Actual host data' } }, mountId: 'tuff-block-2-data-table' }, actionIds: ['host-table-select'] })
    const audit = registry.audit({ source, capabilities, hostActionIds: [] })
    expect(audit.entries.find(entry => entry.id === 'tuffui:data-table')).toMatchObject({ eligible: false, reasons: ['TUFFUI_ACTION_NOT_HOST_OWNED'] })
  })

  test('requires a source-derived nested schema for explicit complex props', () => {
    const registry = new ExecutableComponentRegistry(), input = { exportName: 'DataTable', props: { data: [{ id: 'a', task: 'Actual host row' }], columns: [{ key: 'task', label: 'Task' }], title: 'Actual host data' } }
    registerTuffUiComponents(registry, catalog())
    const audit = registry.audit({ source: tuffUiContentSource({ 'data-table': input }, undefined, 'block-5'), capabilities })
    expect(audit.entries.find(entry => entry.id === 'tuffui:data-table')).toMatchObject({ eligible: false, reasons: ['TUFFUI_NESTED_SCHEMA_REQUIRED'] })
  })

  test('reads explicit bindings from the Root source envelope value', () => {
    const registry = new ExecutableComponentRegistry(), input = { exportName: 'DataTable', props: { data: [{ id: 'a', task: 'Actual host row' }], columns: [{ key: 'task', label: 'Task' }], title: 'Actual host data' } }
    registerTuffUiComponents(registry, catalog(), { typeSchemas })
    const source = { id: 'root-block', reference: 'source-span:0-42', value: tuffUiContentSource({ 'data-table': input }) }
    expect(registry.dispatch('tuffui:data-table', { source, capabilities })).toMatchObject({ input: { mountId: 'tuff-root-block-data-table', componentId: 'data-table' } })
  })

  test('projects only actual JSON and exact fenced code without fabricating agent state', () => {
    const registry = new ExecutableComponentRegistry(); registerTuffUiComponents(registry, catalog())
    const json = registry.dispatch('tuffui:json-viewer', { source: { id: 'block-3', value: { observed: true, count: 2 } }, capabilities })
    expect(json.input).toMatchObject({ componentId: 'json-viewer', binding: { exportName: 'JsonViewer', props: { data: { observed: true, count: 2 } } } })
    const code = registry.dispatch('tuffui:code-block', { source: { id: 'block-4', value: '```ts\nconst observed = true\n```' }, capabilities })
    expect(code.input).toMatchObject({ componentId: 'code-block', binding: { props: { data: { code: 'const observed = true', language: 'ts' } } } })
    expect(() => registry.dispatch('tuffui:ai-chat', { source: { id: 'block-4', value: 'ordinary prose' }, capabilities })).toThrow(/TUFFUI_SOURCE_PROJECTION_NOT_APPLICABLE/)
    expect(() => registry.dispatch('tuffui:code-block', { source: { id: 'block-4', value: '```rust\nlet observed = true;\n```' }, capabilities })).toThrow(/TUFFUI_SOURCE_PROJECTION_NOT_APPLICABLE/)
  })

  test('keeps every source link rather than silently applying a top-K cutoff', () => {
    const registry = new ExecutableComponentRegistry(); registerTuffUiComponents(registry, catalog())
    const links = Array.from({ length: 33 }, (_, index) => `[source ${String(index + 1)}](https://example.test/${String(index + 1)})`).join('\n')
    const dispatch = registry.dispatch('tuffui:source-list', { source: { id: 'block-6', value: links }, capabilities })
    const input = dispatch.input as { binding: { props: { data: { sources: unknown[] } } } }
    expect(input.binding.props.data.sources).toHaveLength(33)
  })

  test('maps one analyzer-validated source table directly to ChartCard without making totals, targets, or synthetic trend state', () => {
    const registry = new ExecutableComponentRegistry()
    registerTuffUiComponents(registry, catalog(), { typeSchemas })
    const source = `| Period | Revenue (USD) | Cost (USD) |
| --- | ---: | ---: |
| 2025-01 | 12 | 7 |
| 2025-02 | 16 | 9 |
| 2025-03 | 18 | 10 |`
    const context = { source: { id: 'chart-source', value: source }, capabilities }
    expect(registry.audit(context).entries.find(entry => entry.id === 'tuffui:chart-card')).toMatchObject({ eligible: true, reasons: ['validated-source-table-chart-plan'] })
    const dispatch = registry.dispatch('tuffui:chart-card', context)
    const binding = (dispatch.input as { binding: { exportName: string, props: Record<string, unknown> } }).binding
    expect(binding).toMatchObject({ exportName: 'ChartCard', props: { type: 'line', title: 'Revenue (USD) / Cost (USD)', data: { labels: ['2025-01', '2025-02', '2025-03'], series: [{ id: 'source-column-1', label: 'Revenue (USD)', values: [12, 16, 18] }, { id: 'source-column-2', label: 'Cost (USD)', values: [7, 9, 10] }] } } })
    expect(binding.props).not.toHaveProperty('total')
    expect(binding.props).not.toHaveProperty('partialLast')
    expect(binding.props).not.toHaveProperty('format')
  })

  test('does not silently choose the first chart when the source analyzer yields multiple incompatible Tuff Card plans', () => {
    const registry = new ExecutableComponentRegistry()
    registerTuffUiComponents(registry, catalog(), { typeSchemas })
    const source = `| Category | A (USD) | B (USD) | C (USD) | D (USD) | E (USD) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Alpha | 1 | 2 | 3 | 4 | 5 |
| Beta | 6 | 7 | 8 | 9 | 10 |`
    const context = { source: { id: 'ambiguous-chart-source', value: source }, capabilities }
    expect(registry.audit(context).entries.find(entry => entry.id === 'tuffui:chart-card')).toMatchObject({ eligible: false, reasons: ['TUFFUI_CHART_MAPPING_MULTIPLE_PLANS'] })
    expect(() => registry.dispatch('tuffui:chart-card', context)).toThrow(/TUFFUI_CHART_MAPPING_MULTIPLE_PLANS/)
  })
})
