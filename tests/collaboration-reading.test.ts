// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollaborationView } from '../src/collaboration-view.js'
import type { CollaborationSnapshot } from '../src/collaboration-contracts.js'
import type { DocumentViewProps } from '../src/document-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, host: HTMLDivElement | undefined
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; host = undefined; vi.restoreAllMocks() })
function state(result: string): CollaborationSnapshot {
 return { sessionId: 'synthetic-session', loading: false, running: false,
  team: { state: 'ready', members: [], tasks: [] }, children: { state: 'ready', rows: [] },
  pstack: { state: 'ready', summary: '本轮已使用 pstack。', calls: [{ key: 'synthetic-call', label: '独立验证者', description: '检查结果的阅读与原文。', status: 'completed', statusLabel: '已完成', resultTitle: '执行结果', result }], history: [] } }
}
async function mount(result: string, DocumentView: (props: DocumentViewProps) => ReturnType<typeof h>) {
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 await act(async () => root!.render(h(CollaborationView, { snapshot: state(result), DocumentView, onOpen: () => { throw Error('No automatic navigation') } })))
 return host.querySelector<HTMLElement>('.iexp-collab-result[aria-label="执行结果"]')!
}
describe('collaboration document reading', () => {
 it('preserves source and a visible warning when the first render throws, then retries on explicit reading', async () => {
  const report = '**Synthetic result**\n\nOriginal line.'
  let fail = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const document = (props: DocumentViewProps) => { if (fail) throw Error('SYNTHETIC_DOCUMENT_FAILURE'); return h('article', { 'data-test-rich': true }, String(props.value)) }
  const result = await mount(report, document)
  expect(result.querySelector('pre')?.textContent).toBe(report)
  expect(result.querySelector('[role="alert"]')?.textContent).toContain('已切换到完整原文')
  const buttons = result.querySelectorAll<HTMLButtonElement>('button')
  expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
  expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true')
  fail = false
  await act(async () => buttons[0]!.click())
  expect(result.querySelector('[data-test-rich]')?.textContent).toBe(report)
  expect(result.querySelector('pre')).toBeNull()
  expect(result.querySelector('[role="alert"]')).toBeNull()
 })
 it('never mounts a renderer for an oversized result and keeps all source characters', async () => {
  const report = 'x'.repeat(200_001)
  const render = vi.fn((props: DocumentViewProps) => h('article', null, String(props.value)))
  const result = await mount(report, render)
  expect(render).not.toHaveBeenCalled()
  expect(result.querySelector('pre')?.textContent).toBe(report)
  expect(result.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
 })
})
