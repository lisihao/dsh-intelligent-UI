import { describe, expect, it } from 'vitest'
import { CHART_POINT_BUDGET, chartAtRows, chartRowIndexes, hasSourceGapBetween } from '../src/chart-scaling.js'
import type { AutoChartPlan } from '../src/content-analysis.js'

function sourcePlan(): AutoChartPlan {
  const labels = Array.from({ length: 10_000 }, (_, index) => `原始项 ${index}`)
  const first = labels.map((_label, index) => Math.sin(index / 17)), second = labels.map((_label, index) => Math.cos(index / 29))
  first[1234] = 4800; first[8765] = -3900; second[4321] = 5200; second[6789] = -4400
  return { kind: 'line', labels, series: [{ name: '偏差 A', unit: 'ms', values: first, originals: first.map(value => `约${value.toFixed(8)}ms`) }, { name: '偏差 B', unit: 'ms', values: second, originals: second.map(value => `${value.toFixed(8)}ms`) }], sourceRows: labels.map((_label, index) => index * 2 + 7), sourceColumns: [2, 5], sourceRowCount: 20_008, sourceColumnCount: 6, basis: '原文定义与条件', notes: ['近似值保留原文，不能转换为精确值。'], reason: '测试选择原始点，不求均值。', icon: 'gauge' }
}
describe('source-preserving scalable chart display', () => {
  it('keeps endpoints and distinct positive/negative extrema from every series within the display budget', () => {
    const source = sourcePlan(), before = structuredClone(source)
    const indexes = chartRowIndexes(source)
    expect(indexes.length).toBeLessThanOrEqual(CHART_POINT_BUDGET)
    expect(indexes[0]).toBe(0); expect(indexes.at(-1)).toBe(9999)
    expect(indexes).toEqual([...new Set(indexes)].sort((a, b) => a - b))
    for (const spike of [1234, 8765, 4321, 6789]) expect(indexes).toContain(spike)
    const display = chartAtRows(source, indexes)
    for (let series = 0; series < source.series.length; series++) {
      expect(display.series[series]!.values).toContain(Math.min(...source.series[series]!.values))
      expect(display.series[series]!.values).toContain(Math.max(...source.series[series]!.values))
    }
    expect(source).toEqual(before)
  })
  it('maps every displayed label, original string and sparse source-row index without modifying the original plan', () => {
    const source = sourcePlan(), before = structuredClone(source), indexes = chartRowIndexes(source, 1000, 9000, 120)
    const display = chartAtRows(source, indexes)
    expect(indexes[0]).toBe(1000); expect(indexes.at(-1)).toBe(8999)
    expect(display.labels).toEqual(indexes.map(index => source.labels[index]))
    expect(display.sourceRows).toEqual(indexes.map(index => source.sourceRows![index]))
    expect(display.sourceColumns).toEqual([2, 5]); expect(display.basis).toBe(source.basis); expect(display.notes).toEqual(source.notes)
    for (let column = 0; column < source.series.length; column++) {
      expect(display.series[column]!.values).toEqual(indexes.map(index => source.series[column]!.values[index]))
      expect(display.series[column]!.originals).toEqual(indexes.map(index => source.series[column]!.originals![index]))
      expect(display.series[column]!.unit).toBe(source.series[column]!.unit)
    }
    expect(source).toEqual(before)
  })
  it('shows all original points when a selected range fits and keeps a category page in original order', () => {
    const source = sourcePlan()
    expect(chartRowIndexes(source, 9000, 9004)).toEqual([9000, 9001, 9002, 9003])
    expect(chartRowIndexes(source, 9999, 10_000)).toEqual([9999])
    const categories = { ...source, kind: 'bar' as const }
    const indexes = chartRowIndexes(categories, 9800, 9900)
    expect(indexes).toEqual(Array.from({ length: 100 }, (_, index) => 9800 + index))
    expect(chartAtRows(categories, indexes).labels).toEqual(source.labels.slice(9800, 9900))
  })
  it('retains the points on both sides of a real missing row under the display budget', () => {
    const rows = Array.from({ length: 2000 }, (_, index) => index < 900 ? index : index + 1)
    const source: AutoChartPlan = { kind: 'line', labels: rows.map(String), sourceRows: rows, omittedRowRanges: [[900, 901]], series: [{ name: '净值', unit: '', values: rows.map(row => row / 1000), originals: rows.map(String) }], reason: '', icon: 'trending-up' }
    const indexes = chartRowIndexes(source)
    expect(indexes.length).toBeLessThanOrEqual(CHART_POINT_BUDGET)
    expect(indexes).toContain(899); expect(indexes).toContain(900)
    const display = chartAtRows(source, indexes)
    const left = display.sourceRows!.indexOf(899), right = display.sourceRows!.indexOf(901)
    expect(right).toBe(left + 1)
    expect(hasSourceGapBetween(display, display.sourceRows![left]!, display.sourceRows![right]!)).toBe(true)
    expect(hasSourceGapBetween(display, 40, 50)).toBe(false)
    expect(source.series[0]?.values).toHaveLength(2000)
  })
  it('stays bounded with many missing ranges and never calls ordinary sampled points missing', () => {
    const rows = Array.from({ length: 2000 }, (_, index) => index * 2)
    const source: AutoChartPlan = { kind: 'line', labels: rows.map(String), sourceRows: rows, omittedRowRanges: rows.slice(0, -1).map(row => [row + 1, row + 2]), series: [{ name: '原始值', unit: '', values: rows }], reason: '', icon: 'trending-up' }
    const indexes = chartRowIndexes(source)
    expect(indexes.length).toBeLessThanOrEqual(CHART_POINT_BUDGET)
    expect(indexes[0]).toBe(0); expect(indexes.at(-1)).toBe(rows.length - 1)
    expect(hasSourceGapBetween(source, rows[indexes[0]!]!, rows[indexes[1]!]!)).toBe(true)
    expect(hasSourceGapBetween({ ...source, omittedRowRanges: [] }, rows[indexes[0]!]!, rows[indexes[1]!]!)).toBe(false)
  })
  it.each([[-1, 100], [0, 10_001], [100, 100], [100, 99], [0.5, 100], [0, 100.5], [Number.NaN, 100]])('rejects invalid source windows instead of silently clamping them: %s–%s', (start, end) => {
    expect(() => chartRowIndexes(sourcePlan(), start, end)).toThrow(RangeError)
  })
  it.each([0, 1, 5, 6.5, Number.POSITIVE_INFINITY])('rejects a display budget unable to retain every series envelope: %s', budget => {
    expect(() => chartRowIndexes(sourcePlan(), 0, 10_000, budget)).toThrow(RangeError)
  })
})
