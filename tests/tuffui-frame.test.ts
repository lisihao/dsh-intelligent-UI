import { describe, expect, test } from 'vitest'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { TuffUiFrameHost, TuffUiPortFrameHost, parseTuffUiHostMessage, tuffUiFrameActionSender } from '../src/tuffui/frame.js'

const ids = `surface action-button choice-controls status-pill segmented-control progress-bar rolling-number text-field tooltip-hint action-menu popover-panel modal-sheet toast-stack select-field tab-panels disclosure agent-avatar loading-skeleton range-slider key-hint loader empty-state date-field drop-zone ai-chat coding-agent data-answer booking-assistant agent-console support-widget handoff-inbox streaming-message agent-status message-branches response-feedback agent-composer agent-question tool-approval-queue tool-call-block file-changes terminal-output mcp-servers background-agents checkpoint-timeline run-trace eval-results context-window-meter memory-panel usage-summary rate-limits chat-thread user-message conversation-list prompt-suggestions attachment-preview code-block source-list chart-card dot-histogram tick-gauge mirror-strips radial-dots match-field radar-chart diverging-bars blast-radius iso-bars hex-density data-table stat-grid form-card result-carousel slot-picker confirmation-card json-viewer artifact-panel`.split(' ')
const catalog = createTuffUiCatalog({ formatVersion: 1, repository: 'https://github.com/yurigdesigner/tuffui.git', commit: '378f3eaac693c693d2ec845baf38bf6c0488cb37', license: 'MIT', registrySha256: 'a'.repeat(64), entries: ids.map(id => ({ id, kind: ['ai-chat', 'coding-agent', 'data-answer', 'booking-assistant', 'agent-console', 'support-widget', 'handoff-inbox'].includes(id) ? 'block' : 'ui', title: id, description: id, sourcePath: `registry/${id}/${id}.tsx`, sha256: 'b'.repeat(64), exports: [{ name: 'Rendered', props: [{ name: 'data', optional: false, sourceType: 'Record<string, unknown>', wireType: 'object' }, { name: 'onSelect', optional: true, sourceType: '(value: string) => void', wireType: 'callback' }] }] })) })

describe('TuffUI frame boundary', () => {
  test('sends a validated mount and accepts only a current action from its exact frame and origin', () => {
    const sent: unknown[] = []
    const frame = { postMessage: (message: unknown) => sent.push(message) }
    const nonce = '1'.repeat(32)
    const host = new TuffUiFrameHost(catalog, frame, 'https://dsh.local', nonce)
    const mount = host.mount({ protocolVersion: 1, mountId: 'table-view', componentId: 'data-table', binding: { exportName: 'Rendered', props: { data: {} }, actions: [{ prop: 'onSelect', actionId: 'table.select' }] } })
    expect(sent).toHaveLength(1)
    expect(parseTuffUiHostMessage(sent[0], nonce)).toMatchObject({ type: 'tuffui/mount', revision: 1 })
    const ignored = host.receive({ origin: 'https://evil.test', source: frame, data: { type: 'tuffui/action', protocolVersion: 1, nonce, mountId: 'table-view', revision: 1, actionId: 'table.select', payload: { id: 'row-1' } } })
    expect(ignored).toBeUndefined()
    const event = host.receive({ origin: 'https://dsh.local', source: frame, data: { type: 'tuffui/action', protocolVersion: 1, nonce, mountId: 'table-view', revision: 1, actionId: 'table.select', payload: { id: 'row-1' } } })
    expect(event).toEqual({ kind: 'action', mountId: 'table-view', revision: 1, actionId: 'table.select', payload: { id: 'row-1' } })
    expect(mount.componentId).toBe('data-table')
  })

  test('the realm action helper posts an opaque action event only', () => {
    const sent: unknown[] = []
    const target = { postMessage: (message: unknown) => sent.push(message) }
    const mount = { protocolVersion: 1 as const, mountId: 'table-view', componentId: 'data-table', binding: { exportName: 'Rendered', props: { data: {} }, actions: [{ prop: 'onSelect', actionId: 'table.select' }] } }
    tuffUiFrameActionSender(target, 'https://dsh.local', '2'.repeat(32), mount, 1, 'table.select')({ id: 'row-1' })
    expect(sent[0]).toMatchObject({ type: 'tuffui/action', actionId: 'table.select', payload: { id: 'row-1' } })
  })

  test('the opaque-frame bridge queues data until a nonce-bound MessageChannel handshake completes', () => {
    const windowMessages: unknown[] = [], portMessages: unknown[] = []
    const hostPort: { postMessage(value: unknown): void, onmessage: ((event: { data: unknown }) => void) | null, start(): void } = { postMessage: value => portMessages.push(value), onmessage: null, start: () => undefined }
    const realmPort = { postMessage: () => undefined, onmessage: null as ((event: { data: unknown }) => void) | null, start: () => undefined }
    const frame = { postMessage: (message: unknown, origin: string, transfer?: readonly unknown[]) => windowMessages.push({ message, origin, transferCount: transfer?.length ?? 0 }) }
    const nonce = '3'.repeat(32)
    const host = new TuffUiPortFrameHost(catalog, frame, 'https://host.example', nonce, () => ({ port1: hostPort, port2: realmPort }))
    host.connect()
    host.mount({ protocolVersion: 1, mountId: 'table-view', componentId: 'data-table', binding: { exportName: 'Rendered', props: { data: {} }, actions: [{ prop: 'onSelect', actionId: 'table.select' }] } })
    expect(windowMessages).toEqual([{ message: { type: 'tuffui/connect', protocolVersion: 1, nonce, parentOrigin: 'https://host.example' }, origin: '*', transferCount: 1 }])
    expect(portMessages).toEqual([])
    hostPort.onmessage?.({ data: { type: 'tuffui/ready', protocolVersion: 1, nonce } })
    expect(portMessages).toHaveLength(1)
    expect(portMessages[0]).toMatchObject({ type: 'tuffui/mount', mount: { componentId: 'data-table' } })
    const event = host.receive({ type: 'tuffui/action', protocolVersion: 1, nonce, mountId: 'table-view', revision: 1, actionId: 'table.select', payload: { id: 'row-1' } })
    expect(event).toMatchObject({ kind: 'action', actionId: 'table.select', payload: { id: 'row-1' } })
  })
})
