import { describe, expect, test } from 'vitest'
// @ts-expect-error The generator is deliberately plain Node ESM, copied into a disposable carrier.
import { generatedRealmPageModule, generatedRegistryModule } from '../tools/tuffui/generate-realm.mjs'
// @ts-expect-error The smoke-page generator is deliberately plain Node ESM.
import { generatedDemoModule, generatedDemoPageModule } from '../tools/tuffui/generate-demo-smoke.mjs'

const ids = `surface action-button choice-controls status-pill segmented-control progress-bar rolling-number text-field tooltip-hint action-menu popover-panel modal-sheet toast-stack select-field tab-panels disclosure agent-avatar loading-skeleton range-slider key-hint loader empty-state date-field drop-zone ai-chat coding-agent data-answer booking-assistant agent-console support-widget handoff-inbox streaming-message agent-status message-branches response-feedback agent-composer agent-question tool-approval-queue tool-call-block file-changes terminal-output mcp-servers background-agents checkpoint-timeline run-trace eval-results context-window-meter memory-panel usage-summary rate-limits chat-thread user-message conversation-list prompt-suggestions attachment-preview code-block source-list chart-card dot-histogram tick-gauge mirror-strips radial-dots match-field radar-chart diverging-bars blast-radius iso-bars hex-density data-table stat-grid form-card result-carousel slot-picker confirmation-card json-viewer artifact-panel`.split(' ')

describe('TuffUI realm generator', () => {
  test('creates a static import closure for every pinned visual entry', () => {
    const module = generatedRegistryModule({ formatVersion: 1, entries: ids.map(id => ({ id, sourcePath: `registry/${id}/${id}.tsx` })) })
    expect((module.match(/^import \* as component/gmu) ?? [])).toHaveLength(76)
    expect(module).toContain('"data-table": component')
    expect(module).toContain('export const tuffUiRealmEntryCount = 76')
    expect(generatedRealmPageModule()).toContain('TuffUiRealmApp')
  })

  test('refuses a partial carrier closure', () => {
    expect(() => generatedRegistryModule({ formatVersion: 1, entries: [] })).toThrow('TUFFUI_REALM_MANIFEST_INVALID')
  })

  test('keeps the all-entry browser smoke page separate from the data-bound realm', () => {
    const demos = generatedDemoModule({ formatVersion: 1, entries: ids.map(id => ({ id, sourcePath: `registry/${id}/${id}.tsx` })) })
    expect((demos.match(/^import Demo/gmu) ?? [])).toHaveLength(76)
    expect(demos).toContain("@/registry/data-table/demo'")
    expect(generatedDemoPageModule()).toContain('data-testid="tuffui-demo-smoke"')
  })
})
