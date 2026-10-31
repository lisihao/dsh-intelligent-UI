// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ComparisonPlot, isCompactComparison } from '../src/comparison-view.js'
import type { AutoChartPlan } from '../src/content-analysis.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const plan = (values = [12, 8]): AutoChartPlan => ({ kind: 'bar', labels: ['对象甲', '对象乙'], series: [{ name: '耗时', values, unit: '秒', originals: values.map(value => value === 12 ? '12.0 秒' : value === 8 ? '约 8 秒' : `${value} 秒`) }], reason: '仅比较原表数值', icon: 'gauge' })

async function render(input: AutoChartPlan, check: (host: HTMLDivElement) => void): Promise<void> {
  const host = document.createElement('div'); const root = createRoot(host)
  try { await act(async () => root.render(createElement(ComparisonPlot, { plan: input }))); check(host) }
  finally { await act(async () => root.unmount()) }
}

describe('compact comparison eligibility', () => {
  it('accepts a few nonnegative comparable rows, including zero', () => {
    expect(isCompactComparison(plan())).toBe(true)
    expect(isCompactComparison(plan([0, 8]))).toBe(true)
    expect(isCompactComparison(plan([0, 0]))).toBe(true)
  })
  it('leaves temporal, negative, multiple-series and dense charts to OpenUI', () => {
    expect(isCompactComparison({ ...plan(), kind: 'line' })).toBe(false)
    expect(isCompactComparison(plan([-1, 8]))).toBe(false)
    expect(isCompactComparison({ ...plan(), series: [...plan().series, ...plan().series] })).toBe(false)
    expect(isCompactComparison({ ...plan(), labels: Array.from({ length: 7 }, (_, i) => `对象${i}`), series: [{ name: '值', values: [1, 2, 3, 4, 5, 6, 7], unit: '' }] })).toBe(false)
  })
  it('rejects incomplete or nonfinite measurements', () => {
    for (const values of [[1], [NaN, 2], [Infinity, 2]]) expect(isCompactComparison(plan(values))).toBe(false)
    expect(isCompactComparison({ ...plan(), labels: ['甲', ''] })).toBe(false)
    expect(isCompactComparison({ ...plan(), labels: ['甲'] })).toBe(false)
  })
})

describe('benchmark comparison plot', () => {
  it('keeps exact originals, units and source order while using one visual scale', async () => {
    const input = plan(); const unchanged = JSON.stringify(input)
    await render(input, host => {
      const meters = host.querySelectorAll('[role="meter"]')
      expect([...host.querySelectorAll('.iexp-comparison-label')].map(node => node.textContent)).toEqual(input.labels)
      expect([...host.querySelectorAll('.iexp-comparison-value')].map(node => node.textContent)).toEqual(['12.0 秒', '约 8 秒'])
      expect(meters[0]?.getAttribute('aria-valuenow')).toBe('12')
      expect(meters[1]?.getAttribute('aria-valuemax')).toBe('12')
      expect(meters[1]?.getAttribute('aria-valuetext')).toBe('约 8 秒（单位：秒）')
      expect((host.querySelector('.iexp-comparison-stroke') as HTMLElement).style.width).toBe('100%')
      expect(host.textContent).not.toContain('66.7%')
    })
    expect(JSON.stringify(input)).toBe(unchanged)
  })
  it('shows zero without a fictitious minimum bar and preserves very large values', async () => {
    const input = plan([0, Number.MAX_VALUE]); input.series[0]!.originals = undefined
    await render(input, host => {
      const bars = [...host.querySelectorAll<HTMLElement>('.iexp-comparison-stroke')]
      expect(bars.map(bar => bar.style.width)).toEqual(['0%', '100%'])
      expect(host.querySelectorAll('[role="meter"]')[1]?.getAttribute('aria-valuenow')).toBe(String(Number.MAX_VALUE))
      expect(host.querySelectorAll('.iexp-comparison-value')[1]?.textContent).toBe(`${Number.MAX_VALUE}秒`)
    })
  })
  it('renders all-zero data without invalid widths or an invalid meter interval', async () => {
    await render(plan([0, 0]), host => {
      expect([...host.querySelectorAll<HTMLElement>('.iexp-comparison-stroke')].map(bar => bar.style.width)).toEqual(['0%', '0%'])
      expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuemax')).toBe('1')
      expect(host.innerHTML).not.toContain('NaN')
    })
  })
  it('returns no replacement plot for an ineligible plan', async () => {
    await render(plan([-1, 8]), host => expect(host.innerHTML).toBe(''))
  })
})
