import { describe, expect, test } from 'vitest'
import {
  TUFFUI_SOURCE_COMMIT,
  TUFFUI_SOURCE_LICENSE,
  TUFFUI_SOURCE_REPOSITORY,
  TuffUiContractError,
} from '../src/tuffui/contracts.js'
import {
  TUFFUI_VISUAL_ENTRY_COUNT,
  createTuffUiCatalog,
  tuffUiAvailability,
  validateTuffUiBinding,
  validateTuffUiMount,
} from '../src/tuffui/catalog.js'

const ids = `surface action-button choice-controls status-pill segmented-control progress-bar rolling-number text-field tooltip-hint action-menu popover-panel modal-sheet toast-stack select-field tab-panels disclosure agent-avatar loading-skeleton range-slider key-hint loader empty-state date-field drop-zone ai-chat coding-agent data-answer booking-assistant agent-console support-widget handoff-inbox streaming-message agent-status message-branches response-feedback agent-composer agent-question tool-approval-queue tool-call-block file-changes terminal-output mcp-servers background-agents checkpoint-timeline run-trace eval-results context-window-meter memory-panel usage-summary rate-limits chat-thread user-message conversation-list prompt-suggestions attachment-preview code-block source-list chart-card dot-histogram tick-gauge mirror-strips radial-dots match-field radar-chart diverging-bars blast-radius iso-bars hex-density data-table stat-grid form-card result-carousel slot-picker confirmation-card json-viewer artifact-panel`.split(' ')

function manifest() {
  return {
    formatVersion: 1,
    repository: TUFFUI_SOURCE_REPOSITORY,
    commit: TUFFUI_SOURCE_COMMIT,
    license: TUFFUI_SOURCE_LICENSE,
    registrySha256: 'a'.repeat(64),
    entries: ids.map(id => ({ id, kind: ['ai-chat', 'coding-agent', 'data-answer', 'booking-assistant', 'agent-console', 'support-widget', 'handoff-inbox'].includes(id) ? 'block' : 'ui', title: id, description: `${id} source entry`, sourcePath: `registry/${id}/${id}.tsx`, sha256: 'b'.repeat(64), exports: [{ name: 'Rendered', props: [{ name: 'data', optional: false, sourceType: 'Record<string, unknown>', wireType: 'object' }, { name: 'onSelect', optional: true, sourceType: '(value: string) => void', wireType: 'callback' }, { name: 'title', optional: true, sourceType: 'string', wireType: 'string' }] }] })),
  }
}

describe('TuffUI catalog', () => {
  test('requires the complete pinned 76-entry visual inventory', () => {
    const catalog = createTuffUiCatalog(manifest())
    expect(catalog.entries).toHaveLength(TUFFUI_VISUAL_ENTRY_COUNT)
    expect(catalog.entries.filter(entry => entry.kind === 'ui')).toHaveLength(69)
    expect(catalog.entries.filter(entry => entry.kind === 'block')).toHaveLength(7)
    expect(() => createTuffUiCatalog({ ...manifest(), entries: manifest().entries.slice(1) })).toThrow(/Expected 76 visual entries/)
  })

  test('allows only data bound to real declared props and explicit host action ids', () => {
    const catalog = createTuffUiCatalog(manifest())
    const binding = validateTuffUiBinding(catalog, 'data-table', { exportName: 'Rendered', props: { data: { rows: [{ id: 'one', count: 1 }] }, title: 'Observed rows' }, actions: [{ prop: 'onSelect', actionId: 'selection.row' }] })
    expect(binding).toMatchObject({ exportName: 'Rendered', actions: [{ prop: 'onSelect', actionId: 'selection.row' }] })
    expect(() => validateTuffUiBinding(catalog, 'data-table', { exportName: 'Rendered', props: {} })).toThrow(/no supplied source props/)
    expect(() => validateTuffUiBinding(catalog, 'data-table', { exportName: 'Rendered', props: { imaginary: true } })).toThrow(/does not declare prop/)
    expect(() => validateTuffUiBinding(catalog, 'data-table', { exportName: 'Rendered', props: { onSelect: 'run' } })).toThrow(/bound through actions/)
    expect(() => validateTuffUiBinding(catalog, 'data-table', { exportName: 'Rendered', props: { data: {} }, actions: [{ prop: 'onRetry', actionId: 'x' }] })).toThrow(/declared callback prop/)
  })

  test('surfaces missing bindings instead of silently falling back to a demo', () => {
    const catalog = createTuffUiCatalog(manifest())
    const availability = tuffUiAvailability(catalog, { 'data-table': { exportName: 'Rendered', props: { data: {} } } })
    expect(availability).toHaveLength(76)
    expect(availability.find(item => item.componentId === 'data-table')).toMatchObject({ available: true })
    expect(availability.find(item => item.componentId === 'tool-call-block')).toMatchObject({ available: false })
  })

  test('validates a Jev-selected mount without accepting an unlisted component', () => {
    const catalog = createTuffUiCatalog(manifest())
    expect(validateTuffUiMount(catalog, { protocolVersion: 1, mountId: 'reply-view', componentId: 'data-table', binding: { exportName: 'Rendered', props: { data: {} } } })).toMatchObject({ componentId: 'data-table' })
    expect(() => validateTuffUiMount(catalog, { protocolVersion: 1, mountId: 'reply-view', componentId: 'made-up', binding: { exportName: 'Rendered', props: { data: {} } } })).toThrow(TuffUiContractError)
  })

  test('enforces source-derived required and scalar prop types', () => {
    const source = manifest(); source.entries[0] = { ...source.entries[0]!, exports: [{ name: 'Rendered', props: [{ name: 'label', optional: false, sourceType: 'string', wireType: 'string' }, { name: 'count', optional: false, sourceType: 'number', wireType: 'number' }, { name: 'onRun', optional: false, sourceType: '() => void', wireType: 'callback' }] }] }
    const catalog = createTuffUiCatalog(source)
    expect(() => validateTuffUiBinding(catalog, 'surface', { exportName: 'Rendered', props: { label: 'Ready', count: 1 } })).toThrow(/required source callback/)
    expect(() => validateTuffUiBinding(catalog, 'surface', { exportName: 'Rendered', props: { label: 1, count: '1' }, actions: [{ prop: 'onRun', actionId: 'run' }] })).toThrow(/must satisfy string/)
    expect(validateTuffUiBinding(catalog, 'surface', { exportName: 'Rendered', props: { label: 'Ready', count: 1 }, actions: [{ prop: 'onRun', actionId: 'run' }] })).toMatchObject({ exportName: 'Rendered' })
  })
})
