// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InsightPreviewRun, InsightPreviewSnapshot } from '../src/insight-preview-contracts.js'

const spies = vi.hoisted(() => ({ workspace: vi.fn(), document: vi.fn() }))
vi.mock('../src/research-view.js', () => ({
  ResearchWorkspace: (props: { children?: ReactNode; sessionId: string; documentId: string; text: string }) => {
    spies.workspace(props)
    return h('div', { 'data-research': props.documentId }, props.children)
  },
}))
vi.mock('../src/document-view.js', () => ({
  DocumentView: (props: { raw: string; documentId: string }) => {
    spies.document(props)
    return h('pre', { 'data-document': props.documentId }, props.raw)
  },
}))
vi.mock('../src/presentation.js', () => ({ useDisplayMode: () => 'visual' }))

import { InsightPreview, type InsightPreviewApi } from '../src/insight-preview-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: { root: Root; host: HTMLElement }[] = []
afterEach(async () => {
  for (const { root, host } of roots.splice(0)) { await act(async () => root.unmount()); host.remove() }
  vi.clearAllMocks()
})

const session = 'session-1'
const original = '原始分析：20%（2025 年）\n\n[来源](https://example.org)'
const documentId = (value: string) => `preview:${value.repeat(64)}`
function run(overrides: Partial<InsightPreviewRun> = {}): InsightPreviewRun {
  return {
    id: 'run-1', source: 'workflow', sourceRunId: 'command-1', title: '技术洞察', status: 'running',
    updatedAt: '2026-11-02T12:00:00.000Z', pptxState: 'pending',
    outputs: [{ id: 'output-1', documentId: documentId('a'), label: '阶段分析', status: 'completed', nodeId: 'analysis', text: original, location: 'node' }],
    raw: { run: { message: '保留运行说明', nodes: [{ nodeId: 'failed', status: 'failed', error: '源节点错误', outputs: [] }] } },
    ...overrides,
  }
}
function snapshot(sessionId = session, runs: InsightPreviewRun[] = [run()]): InsightPreviewSnapshot {
  return { formatVersion: 1, sessionId, available: true, runs, warnings: [] }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function mount(api?: InsightPreviewApi, sessionId = session) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push({ root, host })
  await act(async () => root.render(h(InsightPreview, { api, sessionId })))
  return { root, host }
}
async function render(root: Root, api: InsightPreviewApi | undefined, sessionId: string) {
  await act(async () => root.render(h(InsightPreview, { api, sessionId })))
}

describe('Insight preview view', () => {
  it('reads exactly the current session and exposes intermediate analysis while PPTX is pending', async () => {
    const api = { insightPreview: vi.fn().mockResolvedValue(snapshot()) }
    const { host } = await mount(api)
    expect(api.insightPreview).toHaveBeenCalledOnce()
    expect(api.insightPreview).toHaveBeenCalledWith({ sessionId: session })
    expect(host.textContent).toContain('等待原流程生成 PPTX')
    expect(host.querySelector('[data-document]')?.textContent).toBe(original)
    expect(spies.workspace).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: session, text: original }))
    expect(spies.document).toHaveBeenLastCalledWith(expect.objectContaining({ raw: original }))
  })

  it('makes the complete output-less failure record accessible without fabricating a document', async () => {
    const noOutput = run({ status: 'failed', outputs: [], pptxState: 'unknown' })
    const { host } = await mount({ insightPreview: vi.fn().mockResolvedValue(snapshot(session, [noOutput])) })
    expect(host.textContent).toContain('这项运行尚无可预览正文')
    expect(host.querySelector('[data-document]')).toBeNull()
    const details = host.querySelector<HTMLDetailsElement>('details.iexp-preview-provenance')!
    expect(details.querySelector('summary')?.textContent).toBe('原始运行记录')
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })) })
    expect(JSON.parse(details.querySelector('pre')!.textContent!)).toEqual(noOutput.raw)
    expect(details.textContent).toContain('源节点错误')
    expect(details.textContent).toContain('保留运行说明')
  })

  it('ignores an old session response that resolves after the new session', async () => {
    const old = deferred<InsightPreviewSnapshot>(), current = deferred<InsightPreviewSnapshot>()
    const api = { insightPreview: vi.fn(({ sessionId }: { sessionId: string }) => sessionId === 'old-session' ? old.promise : current.promise) }
    const { root, host } = await mount(api, 'old-session')
    await render(root, api, 'new-session')
    const newText = '新会话专属分析'
    await act(async () => current.resolve(snapshot('new-session', [run({ outputs: [{ id: 'new', documentId: documentId('b'), label: '结果', text: newText, status: 'completed', location: 'node' }] })])))
    expect(host.querySelector('[data-document]')?.textContent).toBe(newText)
    await act(async () => old.resolve(snapshot('old-session')))
    expect(host.querySelector('[data-document]')?.textContent).toBe(newText)
    expect(host.textContent).not.toContain(original)
  })

  it('does not mount old content under a newly selected session even for an intermediate render', async () => {
    const current = deferred<InsightPreviewSnapshot>()
    const api = { insightPreview: vi.fn(({ sessionId }: { sessionId: string }) => sessionId === 'old-session' ? Promise.resolve(snapshot('old-session')) : current.promise) }
    const { root, host } = await mount(api, 'old-session')
    expect(host.querySelector('[data-document]')?.textContent).toBe(original)
    spies.workspace.mockClear()
    await render(root, api, 'new-session')
    expect(spies.workspace.mock.calls.some(([props]) => props.sessionId === 'new-session' && props.text === original)).toBe(false)
    expect(host.textContent).not.toContain(original)
  })

  it('keeps distinct research-document identities for separate phases of one node', async () => {
    const twoPhases = run({
      source: 'legacy',
      outputs: [
        { id: 'phase-1', documentId: documentId('c'), label: '研究计划', status: 'completed', nodeId: 'research', stageKey: 'plan', text: '研究计划原文', location: 'stage' },
        { id: 'phase-2', documentId: documentId('d'), label: '研究成果', status: 'completed', nodeId: 'research', stageKey: 'research', text: '研究成果原文', location: 'stage' },
      ],
    })
    const { host } = await mount({ insightPreview: vi.fn().mockResolvedValue(snapshot(session, [twoPhases])) })
    const first = spies.workspace.mock.lastCall![0].documentId
    const outputSelect = host.querySelectorAll<HTMLSelectElement>('select')[1]!
    await act(async () => { outputSelect.value = 'phase-2'; outputSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    const second = spies.workspace.mock.lastCall![0].documentId
    expect(host.querySelector('[data-document]')?.textContent).toBe('研究成果原文')
    expect(first).not.toBe(second)
    expect(first.length).toBeLessThanOrEqual(200)
    expect(second.length).toBeLessThanOrEqual(200)
  })

  it('shows missing-service, read-error, and session-mismatch states without presenting data', async () => {
    const absent = await mount()
    expect(absent.host.textContent).toContain('洞察结果来源尚未连接')
    expect(absent.host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    const failed = await mount({ insightPreview: vi.fn().mockRejectedValue(new Error('读取失败')) })
    expect(failed.host.querySelector('[role=alert]')?.textContent).toContain('读取失败')
    expect(failed.host.querySelector('[data-document]')).toBeNull()
    const foreign = await mount({ insightPreview: vi.fn().mockResolvedValue(snapshot('other-session')) })
    expect(foreign.host.querySelector('[role=alert]')?.textContent).toContain('与当前会话不一致')
    expect(foreign.host.querySelector('[data-document]')).toBeNull()
  })
})
