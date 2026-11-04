// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowView } from '../src/flow-view.js'
import * as flowLayout from '../src/flow-layout.js'
import type { FlowViewPlan } from '../src/flow-layout.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} }); vi.stubGlobal('Worker', undefined) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const plan: FlowViewPlan = { nodes: Array.from({ length: 1000 }, (_, i) => ({ id: `node-${i}`, label: `完整节点 ${i}`, description: `原文说明 ${i}` })), edges: Array.from({ length: 5000 }, (_, i) => ({ source: `node-${Math.floor(i / 5)}`, target: `node-${(Math.floor(i / 5) + i % 5 + 1) % 1000}`, label: `精确关系 ${i}` })) }
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function open(host: HTMLElement, name: string) { const details = [...host.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent?.startsWith(name))!; await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) }); return details }
describe('large graph accessible source surfaces', () => {
  it('retains all original pages and exact search selection without mounting the whole graph', async () => {
    const before = JSON.stringify(plan), host = document.createElement('div'); document.body.append(host); const root = createRoot(host), activate = vi.fn()
    try {
      await act(async () => root.render(createElement(FlowView, { plan, onNodeActivate: activate })))
      expect(host.querySelector('canvas')).not.toBeNull()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('FlowLayoutWorkerUnavailable')
      expect(host.querySelectorAll('li')).toHaveLength(0)
      const nodes = await open(host, '完整节点')
      expect(nodes.querySelectorAll('li')).toHaveLength(25)
      await input(nodes.querySelector('input')!, '40')
      expect(nodes.textContent).toContain('完整节点 999'); expect(nodes.textContent).toContain('原文说明 999')
      const edges = await open(host, '完整连线'); await input(edges.querySelector('input')!, '200')
      expect(edges.querySelectorAll('li')).toHaveLength(25); expect(edges.textContent).toContain('精确关系 4999')
      await input(host.querySelector('input[type="search"]')!, 'node-999')
      const results = [...host.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent?.startsWith('搜索结果'))!
      expect(results.textContent).toContain('完整节点 999')
      await act(async () => results.querySelector('li button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      expect(activate).toHaveBeenCalledWith('node-999')
      expect(host.querySelector('[aria-label="直接邻域分页"]')?.textContent).toContain('11 个节点、10 条原文连线')
      for (let attempt = 0; attempt < 60 && host.querySelector('[data-neighborhood-layout]')?.getAttribute('data-neighborhood-layout') !== 'elk'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.querySelector('[data-neighborhood-layout]')?.getAttribute('data-neighborhood-layout')).toBe('elk')
      expect(host.querySelector('[aria-label="选中节点原文"]')?.textContent).toContain('原文说明 999')
      expect(host.querySelectorAll('.react-flow__node').length).toBeLessThanOrEqual(180)
      expect(host.querySelector('figure')?.dataset.motion).toBe('still')
      await act(async () => root.render(createElement(FlowView, { plan: JSON.parse(JSON.stringify(plan)), onNodeActivate: activate })))
      expect(host.querySelector('input[type="search"]')?.getAttribute('value')).toBe('node-999')
      expect(host.querySelector('[aria-label="选中节点原文"]')?.textContent).toContain('原文说明 999')
      expect(JSON.stringify(plan)).toBe(before)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('keeps large execution geometry and selection across state snapshots and preserves DOWN neighborhood geometry', async () => {
    const source: FlowViewPlan = {
      execution: true, direction: 'DOWN',
      nodes: Array.from({ length: 41 }, (_, index) => ({ id: `exec-${index}`, label: `执行节点 ${index}`, execution: { id: `exec-${index}`, label: `执行节点 ${index}`, status: 'running', progress: { current: 1, total: 2 }, metrics: [{ label: '来源计数', value: 1 }] } })),
      edges: Array.from({ length: 40 }, (_, index) => ({ source: `exec-${index}`, target: `exec-${index + 1}`, executionStatus: 'active' })),
    }
    const calls = vi.spyOn(flowLayout, 'layoutFlow'), host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(createElement(FlowView, { plan: source })))
      await input(host.querySelector('input[type="search"]')!, 'exec-40')
      const result = [...host.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent?.startsWith('搜索结果'))!
      await act(async () => result.querySelector('li button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      for (let attempt = 0; attempt < 60 && host.querySelector('[data-neighborhood-layout]')?.getAttribute('data-neighborhood-layout') !== 'elk'; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.querySelector('[data-neighborhood-layout]')?.getAttribute('data-neighborhood-layout')).toBe('elk')
      const local = calls.mock.calls.find(call => call[1]?.compact)
      expect(local?.[0].direction).toBe('DOWN'); expect(local?.[0].execution).toBe(true)
      expect(host.querySelector('.react-flow__handle-top')).not.toBeNull(); expect(host.querySelector('.react-flow__handle-bottom')).not.toBeNull()
      const before = calls.mock.calls.length
      const updated: FlowViewPlan = { ...source, nodes: source.nodes.map(node => node.id === 'exec-40' ? { ...node, execution: { ...node.execution!, status: 'succeeded', progress: { current: 2, total: 2 }, metrics: [{ label: '来源计数', value: 2 }, { label: '后续来源统计', value: 3 }] } } : node), edges: source.edges.map(edge => ({ ...edge, executionStatus: 'done' })) }
      await act(async () => root.render(createElement(FlowView, { plan: updated })))
      expect(calls).toHaveBeenCalledTimes(before)
      expect(host.querySelector('[aria-label="选中节点原文"]')?.textContent).toContain('执行节点 40')
      expect(host.querySelector('[data-execution-status="succeeded"]')).not.toBeNull()
      expect(host.querySelector('[data-neighborhood-layout]')?.getAttribute('data-neighborhood-layout')).toBe('elk')
      const renamed = { ...updated, nodes: updated.nodes.map(node => node.id === 'exec-40' ? { ...node, label: '改变节点结构标签' } : node) }
      await act(async () => root.render(createElement(FlowView, { plan: renamed })))
      expect(calls.mock.calls.length).toBeGreaterThan(before)
      expect(host.querySelector('[aria-label="选中节点原文"]')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

})
