// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AsciiChart, supportsAsciiChart } from '../src/ascii-chart.js'
import { ChartViewport } from '../src/chart-viewport.js'
import type { AutoChartPlan } from '../src/content-analysis.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function source(): AutoChartPlan {
  return {
    kind: 'bar', labels: ['甲', '乙', '丙'],
    series: [
      { name: '本期', unit: '万元', values: [-10, 0, 20], originals: ['约 -10.0', '0.00', '+20'] },
      { name: '同期', unit: '万元', values: [-20, 1, 10], originals: ['-20.0', '1（暂估）', '10'] },
    ], reason: '只展示原表所列数据', icon: 'chart-column',
  }
}

async function withChart(plan: AutoChartPlan, check: (host: HTMLDivElement) => void, scalePlan?: AutoChartPlan): Promise<void> {
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(h(AsciiChart, { plan, scalePlan })))
    check(host)
  } finally { await act(async () => root.unmount()) }
}

describe('ASCII chart eligibility', () => {
  it('accepts finite categorical multiseries values, including negatives and zero', () => {
    expect(supportsAsciiChart(source())).toBe(true)
  })
  it('leaves line charts and unsafe or incompatible plans to the caller fallback', () => {
    const plan = source()
    expect(supportsAsciiChart({ ...plan, kind: 'line' })).toBe(false)
    expect(supportsAsciiChart({ ...plan, labels: [] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [plan.series[0]!, { ...plan.series[1]!, unit: '%' }] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [{ ...plan.series[0]!, values: [1, 2] }] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [{ ...plan.series[0]!, values: [1, NaN, 2] }] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [{ ...plan.series[0]!, values: [1, Infinity, 2] }] })).toBe(false)
    expect(supportsAsciiChart({ ...plan, series: [{ ...plan.series[0]!, originals: ['one'] }] })).toBe(false)
  })
})

describe('source-preserving ASCII categorical plots', () => {
  it('plots every category and series on the same centered zero scale without changing original text', async () => {
    const plan = source(), before = JSON.stringify(plan)
    await withChart(plan, host => {
      expect([...host.querySelectorAll('.iexp-ascii-chart-label')].map(node => node.textContent)).toEqual(['甲', '乙', '丙'])
      expect([...host.querySelectorAll('.iexp-ascii-chart-value')].map(node => node.textContent)).toEqual(['约 -10.0', '-20.0', '0.00', '1（暂估）', '+20', '10'])
      expect([...host.querySelectorAll('.iexp-ascii-chart-series')].map(node => node.textContent)).toEqual(['本期（万元）', '同期（万元）', '本期（万元）', '同期（万元）', '本期（万元）', '同期（万元）'])
      const marks = [...host.querySelectorAll('.iexp-ascii-chart-mark')]
      expect(marks.map(mark => mark.textContent)).toEqual(['·····▉▉▉▉▉|··········', '▉▉▉▉▉▉▉▉▉▉|··········', '··········|··········', '··········|▌·········', '··········|▉▉▉▉▉▉▉▉▉▉', '··········|▉▉▉▉▉·····'])
      for (const mark of marks) {
        expect(mark.getAttribute('aria-hidden')).toBe('true')
        expect(mark.textContent).toMatch(/^[·▉▐]{10}\|[·▏▎▍▌▋▊▉]{10}$/)
      }
      expect(host.textContent).toContain('非零值总能看到')
    })
    expect(JSON.stringify(plan)).toBe(before)
  })

  it('keeps zero empty, shows nonzero values at least once, and avoids overflow at numeric extremes', async () => {
    const plan: AutoChartPlan = { kind: 'bar', labels: ['零', '最小', '最大', '负最大'], series: [{ name: '值', unit: '', values: [0, Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE] }], reason: '', icon: 'chart-column' }
    await withChart(plan, host => {
      expect([...host.querySelectorAll('.iexp-ascii-chart-mark')].map(node => node.textContent)).toEqual(['··········|··········', '··········|▏·········', '··········|▉▉▉▉▉▉▉▉▉▉', '▉▉▉▉▉▉▉▉▉▉|··········'])
      expect([...host.querySelectorAll('.iexp-ascii-chart-value')].map(node => node.textContent)).toEqual(plan.series[0]!.values.map(String))
      expect(host.innerHTML).not.toContain('NaN')
    })
  })

  it('draws negative bars in half cells and keeps a tiny negative value visible', async () => {
    const plan: AutoChartPlan = { kind: 'bar', labels: ['小亏', '微亏', '盈利'], series: [{ name: '值', unit: '', values: [-5, -Number.MIN_VALUE, 20] }], reason: '', icon: 'chart-column' }
    await withChart(plan, host => {
      expect([...host.querySelectorAll('.iexp-ascii-chart-mark')].map(node => node.textContent)).toEqual(['·······▐▉▉|··········', '·········▐|··········', '··········|▉▉▉▉▉▉▉▉▉▉'])
    })
  })

  it('keeps the same source-wide scale when the category viewport moves between pages', async () => {
    const plan: AutoChartPlan = {
      kind: 'bar', labels: Array.from({ length: 10 }, (_, index) => `对象${index}`),
      series: [{ name: '值', unit: 'ms', values: Array.from({ length: 10 }, (_, index) => index + 1) }],
      reason: '', icon: 'chart-column',
    }
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(h(ChartViewport, { plan, children: view => h(AsciiChart, { plan: view, scalePlan: plan }) })))
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe(`|${'▉'.repeat(2)}${'·'.repeat(18)}`)
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '下一组')!.click())
      expect(host.querySelector('.iexp-ascii-chart-label')!.textContent).toBe('对象8')
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe(`|${'▉'.repeat(18)}${'·'.repeat(2)}`)
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '上一组')!.click())
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe(`|${'▉'.repeat(2)}${'·'.repeat(18)}`)
    } finally { await act(async () => root.unmount()) }
  })

  it('places zero at the end for negative-only data and at the start for all-zero data', async () => {
    const plan: AutoChartPlan = { kind: 'bar', labels: ['亏损', '较小亏损', '持平'], series: [{ name: '值', unit: '', values: [-10, -5, 0] }], reason: '', icon: 'chart-column' }
    await withChart(plan, host => {
      expect([...host.querySelectorAll('.iexp-ascii-chart-mark')].map(mark => mark.textContent)).toEqual([`${'▉'.repeat(20)}|`, `${'·'.repeat(10)}${'▉'.repeat(10)}|`, `${'·'.repeat(20)}|`])
      expect(host.textContent).toContain('零线在右侧')
    })
    const zero = { ...plan, series: [{ ...plan.series[0]!, values: [0, 0, 0] }] }
    await withChart(zero, host => {
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe(`|${'·'.repeat(20)}`)
      expect(host.textContent).toContain('零线在左侧')
    })
  })

  it('keeps a centered zero across pages when both signs exist anywhere in the source', async () => {
    const plan: AutoChartPlan = { kind: 'bar', labels: Array.from({ length: 10 }, (_, i) => `对象${i}`), series: [{ name: '值', unit: '', values: [1, 2, 3, 4, 5, 6, 7, 8, -10, 10] }], reason: '', icon: 'chart-column' }
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(h(ChartViewport, { plan, children: view => h(AsciiChart, { plan: view, scalePlan: plan }) })))
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe('··········|▉·········')
      expect(host.textContent).toContain('零线居中')
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '下一组')!.click())
      expect(host.querySelector('.iexp-ascii-chart-mark')!.textContent).toBe('▉▉▉▉▉▉▉▉▉▉|··········')
      expect(host.textContent).toContain('零线居中')
    } finally { await act(async () => root.unmount()) }
  })

  it('uses actual glyph width to resize marks, tracks font changes and disconnects on unmount', async () => {
    let width = 240, glyphWidth = 8, callback: ResizeObserverCallback | undefined
    let fontReady!: () => void, fontChanged: (() => void) | undefined
    const observed: Element[] = [], disconnect = vi.fn()
    class Observer {
      constructor(cb: ResizeObserverCallback) { callback = cb }
      observe(target: Element) {
        observed.push(target)
        if (target.classList.contains('iexp-ascii-chart')) Object.defineProperty(target, 'clientWidth', { configurable: true, get: () => width })
        if (target.classList.contains('iexp-ascii-chart-probe')) Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => ({ width: glyphWidth * 16 }) })
      }
      disconnect() { disconnect() }
    }
    vi.stubGlobal('ResizeObserver', Observer)
    const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
    const removeFontListener = vi.fn()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>(resolve => { fontReady = resolve }), addEventListener: (_name: string, handler: () => void) => { fontChanged = handler }, removeEventListener: removeFontListener } })
    const plan: AutoChartPlan = { kind: 'bar', labels: ['甲'], series: [{ name: '值', unit: '', values: [1] }], reason: '', icon: 'chart-column' }
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(h(AsciiChart, { plan })))
      const mark = () => host.querySelector('.iexp-ascii-chart-mark')!.textContent!
      expect(observed.map(node => node.className)).toEqual(['iexp-ascii-chart', 'iexp-ascii-chart-probe'])
      expect(mark()).toBe(`|${'▉'.repeat(28)}`)
      width = 160
      await act(async () => callback!([], {} as ResizeObserver))
      expect(mark()).toBe(`|${'▉'.repeat(18)}`)
      width = 720
      await act(async () => callback!([], {} as ResizeObserver))
      expect(mark()).toBe(`|${'▉'.repeat(88)}`)
      width = 480; glyphWidth = 12
      await act(async () => fontChanged!())
      expect(mark()).toBe(`|${'▉'.repeat(38)}`)
      glyphWidth = 16
      await act(async () => { fontReady(); await Promise.resolve() })
      expect(mark()).toBe(`|${'▉'.repeat(28)}`)
    } finally {
      await act(async () => root.unmount())
      if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor)
      else delete (document as unknown as { fonts?: unknown }).fonts
      vi.unstubAllGlobals()
    }
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(removeFontListener).toHaveBeenCalledWith('loadingdone', fontChanged)
  })

  it('does not replace unsupported data or accept an unrelated scale', async () => {
    const plan = source()
    await withChart({ ...plan, kind: 'line' }, host => expect(host.innerHTML).toBe(''))
    await withChart(plan, host => expect(host.innerHTML).toBe(''), { ...plan, series: plan.series.map(series => ({ ...series, values: [1, 1, 1] })) })
  })
})
