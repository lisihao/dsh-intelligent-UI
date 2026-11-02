import { describe, expect, it } from 'vitest'
import { lineAbscissa } from '../src/dense-line-plot.js'
import type { AutoChartPlan } from '../src/content-analysis.js'
const plan = (labels: string[], sourceRows?: number[]): AutoChartPlan => ({ kind: 'line', labels, sourceRows, series: [{ name: 'raw', values: labels.map((_label, index) => index), unit: '' }], reason: '', icon: 'trending-up' })
describe('sampled continuous timeline', () => {
  it('retains actual irregular source date intervals rather than category spacing', () => {
    const values = lineAbscissa(plan(['2024-01-01', '2024-01-02', '2024-02-01']))
    expect(values[1]! - values[0]!).toBe(86_400_000)
    expect(values[2]! - values[1]!).toBe(30 * 86_400_000)
  })
  it('preserves quarter gaps and original positions for explicit non-date line plans', () => {
    expect(lineAbscissa(plan(['2023 Q1', '2024 Q1']))[1]! - lineAbscissa(plan(['2023 Q1', '2024 Q1']))[0]!).toBe(4)
    expect(lineAbscissa(plan(['A', 'B', 'C'], [0, 42, 999]))).toEqual([0, 42, 999])
  })
})
