// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionPlan } from '../src/execution-flow.js'

const graph = vi.hoisted(() => ({ last: undefined as unknown }))
vi.mock('../src/flow-view.js', async () => {
  const React = await import('react')
  return { FlowView: ({ plan }: { plan: unknown }) => { graph.last = plan; return React.createElement('div', { 'data-flow-stub': true }) } }
})
import { ExecutionFlowView } from '../src/execution-flow-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function example(count = 0): ExecutionPlan {
  return {
    kind: 'execution-flow', title: '来源任务',
    nodes: [
      { id: 'a', label: '检索', role: 'worker', status: 'running', progress: { current: 0, total: 0 } },
      { id: 'b', label: '校验', description: '原始说明', metrics: [{ label: '准确数', value: 9, unit: '条' }] },
    ],
    edges: [{ source: 'a', target: 'b', label: '交付', status: 'active' }],
    events: Array.from({ length: count }, (_, index) => ({ id: `e${index + 1}`, message: `原文事件 ${index + 1}` })),
  }
}
function messages(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-execution-log] li')].map(node => node.textContent ?? '')
}
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

describe('source-bound execution flow', () => {
  afterEach(() => { graph.last = undefined; vi.restoreAllMocks() })

  it('maps only supplied execution fields into the existing graph and passes the caller’s raw source unchanged', async () => {
    const plan = example(), original = JSON.stringify(plan)
    const raw = '{ "unknownSourceField": "保留", "status": "done" }'
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan, sourceText: raw })))
      expect(graph.last).toEqual({
        title: '来源任务', direction: 'DOWN', execution: true, sourceText: raw,
        nodes: [{ id: 'a', label: '检索', execution: plan.nodes[0] }, { id: 'b', label: '校验', description: '原始说明', execution: plan.nodes[1] }],
        edges: [{ source: 'a', target: 'b', label: '交付', executionStatus: 'active' }],
      })
      expect(host.textContent).toContain('执行快照，依据来源提供的信息展示。')
      expect(host.textContent).toContain('暂无来源事件。')
      expect(host.textContent).not.toContain('来源更新时间')
      expect(host.textContent).not.toContain('0%')
      expect(JSON.stringify(plan)).toBe(original)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('retains exact supplied timestamp, source order and linked node label', async () => {
    const plan = example()
    plan.updatedAt = '2026-11-02T19:03:04Z'
    plan.events = [{ id: 'one', timestamp: '2026-11-02T19:01:02Z', nodeId: 'a', message: '检索\n完成' }, { id: 'two', message: '等待核验' }]
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan })))
      expect(host.textContent).toContain('来源更新时间：2026-11-02T19:03:04Z')
      expect(host.querySelector('time')?.getAttribute('datetime')).toBe(plan.updatedAt)
      expect(messages(host)).toEqual(['2026-11-02T19:01:02Z检索检索\n完成', '等待核验'])
      expect((graph.last as { sourceText?: string }).sourceText).toBeUndefined()
      expect(host.textContent).toContain('来源顺序 1–2 / 2')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('reflects a later source status and progress without inventing fields on other nodes', async () => {
    const plan = example(), host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan, sourceText: '原快照' })))
      const updated: ExecutionPlan = { ...plan, nodes: [{ ...plan.nodes[0]!, status: 'succeeded', progress: { current: 2, total: 2, unit: '项' } }, plan.nodes[1]!] }
      await act(async () => root.render(h(ExecutionFlowView, { plan: updated, sourceText: '新快照' })))
      const rendered = graph.last as { sourceText?: string, nodes: Array<{ execution: ExecutionPlan['nodes'][number] }> }
      expect(rendered.sourceText).toBe('新快照')
      expect(rendered.nodes[0]!.execution).toEqual(updated.nodes[0])
      expect(rendered.nodes[1]!.execution).toEqual(plan.nodes[1])
      expect(rendered.nodes[1]!.execution.status).toBeUndefined()
      expect(rendered.nodes[1]!.execution.progress).toBeUndefined()
      expect(plan.nodes[0]!.status).toBe('running')
      expect(plan.nodes[0]!.progress).toEqual({ current: 0, total: 0 })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps an older page fixed across new snapshots and provides explicit access back to the latest', async () => {
    const plan = example(12), host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan, sourceText: '原始快照 A' })))
      expect(messages(host)).toEqual(Array.from({ length: 8 }, (_, i) => `原文事件 ${i + 5}`))
      await act(async () => button(host, '上一页事件').click())
      const earlier = messages(host)
      expect(earlier).toEqual(Array.from({ length: 8 }, (_, i) => `原文事件 ${i + 1}`))

      const updated: ExecutionPlan = { ...plan, events: [...plan.events, { id: 'e13', message: '原文事件 13' }, { id: 'e14', message: '原文事件 14' }] }
      await act(async () => root.render(h(ExecutionFlowView, { plan: updated, sourceText: '原始快照 B' })))
      expect(messages(host)).toEqual(earlier)
      expect((graph.last as { sourceText?: string }).sourceText).toBe('原始快照 B')
      expect(host.textContent).toContain('来源顺序 1–8 / 14')
      await act(async () => button(host, '查看最新事件').click())
      expect(messages(host)).toEqual(Array.from({ length: 8 }, (_, i) => `原文事件 ${i + 7}`))
      expect(host.textContent).toContain('来源顺序 7–14 / 14')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('pauses following when inspecting the log, and follows new records again only after choosing latest', async () => {
    const plan = example(8), host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan })))
      const log = host.querySelector<HTMLDivElement>('[data-execution-log]')!
      await act(async () => log.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
      const updated: ExecutionPlan = { ...plan, events: [...plan.events, { id: 'e9', message: '新事件 9' }] }
      await act(async () => root.render(h(ExecutionFlowView, { plan: updated })))
      expect(messages(host)[0]).toBe('原文事件 1')
      expect(messages(host)).not.toContain('新事件 9')
      await act(async () => button(host, '查看最新事件').click())
      expect(messages(host)).toContain('新事件 9')
      const next: ExecutionPlan = { ...updated, events: [...updated.events, { id: 'e10', message: '新事件 10' }] }
      await act(async () => root.render(h(ExecutionFlowView, { plan: next })))
      expect(messages(host)).toContain('新事件 10')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('does not reset scroll position when a reader moves above the bottom and a new event arrives', async () => {
    const plan = example(8), host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan })))
      const log = host.querySelector<HTMLDivElement>('[data-execution-log]')!
      Object.defineProperties(log, { scrollHeight: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 100 } })
      log.scrollTop = 40
      await act(async () => log.dispatchEvent(new Event('scroll', { bubbles: true })))
      const updated: ExecutionPlan = { ...plan, events: [...plan.events, { id: 'e9', message: '新事件 9' }] }
      await act(async () => root.render(h(ExecutionFlowView, { plan: updated })))
      expect(log.scrollTop).toBe(40)
      expect(messages(host)[0]).toBe('原文事件 1')
      expect(messages(host)).not.toContain('新事件 9')
      await act(async () => button(host, '查看最新事件').click())
      expect(log.scrollTop).toBe(400)
      expect(messages(host)).toContain('新事件 9')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the rendered event window bounded even for a long supplied log', async () => {
    const plan = example(3000), host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ExecutionFlowView, { plan })))
      expect(messages(host)).toHaveLength(8)
      expect(messages(host)[7]).toBe('原文事件 3000')
      expect(host.textContent).toContain('来源顺序 2,993–3,000 / 3,000')
      await act(async () => button(host, '上一页事件').click())
      expect(messages(host)).toHaveLength(8)
      expect(messages(host)[0]).toBe('原文事件 2985')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
