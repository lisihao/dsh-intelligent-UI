// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ChartViewport, ChartDataTable, PagedTableBody } from '../src/chart-viewport.js'
import type { AutoChartPlan } from '../src/content-analysis.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function plan(kind: 'line' | 'bar'): AutoChartPlan {
  return { kind, labels: Array.from({ length: 10_000 }, (_, i) => `source-${i}`), series: [{ name: 'latency', unit: 'ms', values: Array.from({ length: 10_000 }, (_, i) => i), originals: Array.from({ length: 10_000 }, (_, i) => `约${i}ms`) }], sourceRows: Array.from({ length: 10_000 }, (_, i) => i * 2), reason: 'fixture', icon: 'gauge' }
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = async (host: Element, text: string) => { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click()) }
describe('source-preserving chart navigation', () => {
  it('shows an explicit envelope, validates ranges and recovers exact source points at detail', async () => {
    const host = document.createElement('div'), root = createRoot(host), source = plan('line')
    await act(async () => root.render(h(ChartViewport, { plan: source, children: view => h('output', null, JSON.stringify(view.sourceRows)) })))
    expect(Number(host.querySelector('[data-rendered-count]')!.getAttribute('data-rendered-count'))).toBeLessThanOrEqual(800)
    expect(host.textContent).toContain('不求均值')
    const inputs = host.querySelectorAll('input')
    await input(inputs[0]!, '100'); await input(inputs[1]!, '120')
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(JSON.parse(host.querySelector('output')!.textContent!)).toEqual(Array.from({ length: 21 }, (_, i) => (99 + i) * 2))
    await input(inputs[0]!, '0')
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('有效起止行')
    expect(host.querySelector('[data-rendered-count]')!.getAttribute('data-rendered-count')).toBe('21')
    await click(host, '查看全序列'); expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(source.series[0]!.originals![99]).toBe('约99ms')
    await act(async () => root.unmount())
  })
  it('pages categories in source order instead of sorting or throwing away small values', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(h(ChartViewport, { plan: plan('bar'), children: view => h('output', null, view.labels.join(',')) })))
    expect(host.querySelector('output')!.textContent).toBe(Array.from({ length: 8 }, (_, i) => `source-${i}`).join(','))
    await click(host, '下一组'); expect(host.querySelector('output')!.textContent).toContain('source-8,source-9')
    await click(host, '上一组'); expect(host.querySelector('output')!.textContent).toContain('source-0,source-1')
    await act(async () => root.unmount())
  })
  it('mounts at most 100 original rows on disclosure, reaches the last page and preserves exact strings and source IDs', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    await act(async () => root.render(h(ChartDataTable, { plan: plan('line') })))
    expect(host.querySelector('table')).toBeNull()
    await act(async () => { const details = host.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle')) })
    expect(host.querySelectorAll('tbody tr')).toHaveLength(100)
    await input(host.querySelector('input')!, '100')
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('tbody tr:last-child')!.getAttribute('data-source-row')).toBe('19998')
    expect(host.querySelector('tbody tr:last-child')!.textContent).toBe('source-9999约9999ms')
    await act(async () => root.unmount())
  })
  it('bounds mounted full-table rows without replacing source-cell anchors', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    const rows = Array.from({ length: 220 }, (_, i) => h('tr', { key: i }, h('td', null, h('span', { 'data-iexp-source-start': i }, `source-${i}`))))
    await act(async () => root.render(h('table', null, h(PagedTableBody, null, ...rows))))
    expect(host.querySelectorAll('[data-iexp-source-start]')).toHaveLength(100)
    await click(host, '下一页原表'); await click(host, '下一页原表')
    expect(host.querySelectorAll('[data-iexp-source-start]')).toHaveLength(20)
    expect(host.querySelector('[data-iexp-source-start="219"]')!.textContent).toBe('source-219')
    await act(async () => root.unmount())
  })
})
