// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentView } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

async function render(markdown: string) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(ContentView, { value: markdown })))
  return { host, root }
}

describe('source-faithful time series rendering', () => {
  it('draws short irregular dates at actual intervals and breaks at a missing NAV row', async () => {
    const source = '## 净资产时间序列\n\n| 日期 | 净资产 |\n| --- | ---: |\n| 2024-01-01 | 1.0000 |\n| 2024-01-02 | 未提供 |\n| 2024-02-01 | 1.2500 |\n\n## 回撤时间序列\n\n回撤是源提供的小数比例，不换算。\n\n| 日期 | 回撤比例 |\n| --- | ---: |\n| 2024-01-01 | 0 |\n| 2024-01-02 | -0.1 |\n| 2024-02-01 | -0.05 |'
    const { host, root } = await render(source)
    const charts = [...host.querySelectorAll('[data-auto-chart="line"]')]
    expect(charts).toHaveLength(2)
    const nav = charts[0]!.querySelector('.iexp-dense-line svg')!
    const navPath = nav.querySelector('path')!.getAttribute('d')!
    expect(navPath.match(/M/g)).toHaveLength(2)
    expect(navPath.match(/L/g)).toBeNull()
    expect(nav.querySelectorAll('circle')).toHaveLength(2) // Both isolated observed points remain visible.
    expect(nav.getAttribute('aria-label')).toContain('原表未纳入的行处断线')
    const drawdown = charts[1]!.querySelector('.iexp-dense-line svg')!
    const coordinates = [...drawdown.querySelector('path')!.getAttribute('d')!.matchAll(/[ML]([\d.]+),[\d.]+/g)].map(match => Number(match[1]))
    expect(coordinates).toHaveLength(3)
    expect((coordinates[1]! - coordinates[0]!) / (coordinates[2]! - coordinates[0]!)).toBeCloseTo(1 / 31, 3)
    const tickTexts = [...drawdown.querySelectorAll('text')].map(node => node.textContent)
    expect(tickTexts).toContain('2024-01-01'); expect(tickTexts).toContain('2024-02-01')
    expect(tickTexts).not.toContain('2024-01-02') // Its x position nearly overlaps the first label.
    expect(charts[1]!.textContent).not.toContain('-10%')
    await act(async () => drawdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(charts[1]!.textContent).toContain('2024-01-02 · 回撤比例：-0.1')
    expect(host.querySelector('[aria-label="原始数据表格"]')?.textContent).toContain('未提供')
    await act(async () => root.unmount())
  })

  it('retains gap boundaries and the complete original table on a sampled 1,000-row series', async () => {
    const start = Date.UTC(2020, 0, 1)
    const rows = Array.from({ length: 1000 }, (_, index) => `| ${new Date(start + index * 86_400_000).toISOString().slice(0, 10)} | ${index === 500 ? '缺失' : (1 + index / 1000).toFixed(3)} |`)
    const source = ['| 日期 | 净资产 |', '| --- | ---: |', ...rows].join('\n')
    const { host, root } = await render(source)
    const chart = host.querySelector('[data-auto-chart="line"]')!
    const path = chart.querySelector('.iexp-dense-line svg path')!.getAttribute('d')!
    expect(path.match(/M/g)).toHaveLength(2)
    expect(chart.querySelector('.iexp-chart-viewport')?.getAttribute('data-source-count')).toBe('999')
    expect(Number(chart.querySelector('.iexp-chart-viewport')?.getAttribute('data-rendered-count'))).toBeLessThanOrEqual(800)
    expect(host.textContent).toContain('本图未纳入')
    const sourceTable = host.querySelector('[aria-label="原始数据表格"]')!
    expect(sourceTable.textContent).toContain('共 1,000 行')
    const input = sourceTable.querySelector('input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, '6'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const jump = [...sourceTable.querySelectorAll('button')].find(button => button.textContent === '跳转原表页')!
    await act(async () => jump.click())
    expect(sourceTable.textContent).toContain('缺失')
    await act(async () => root.unmount())
  })
})
