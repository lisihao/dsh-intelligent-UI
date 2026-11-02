import type { AutoChartPlan } from './content-analysis.js'

export const CHART_POINT_BUDGET = 800
export const CATEGORY_PAGE_SIZE = 24
export const SOURCE_PAGE_SIZE = 100

/** Display only: source-order envelope retains every series' bucket extrema and endpoints. */
export function chartRowIndexes(plan: AutoChartPlan, start = 0, end = plan.labels.length, budget = CHART_POINT_BUDGET): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > plan.labels.length || end <= start) throw new RangeError('图表行范围无效。')
  if (!Number.isInteger(budget) || budget < 2 * plan.series.length + 2) throw new RangeError('图表细节预算不足以保留各序列极值。')
  if (end - start <= budget || plan.kind === 'bar') return Array.from({ length: end - start }, (_, i) => start + i)
  const buckets = Math.floor((budget - 2) / (2 * plan.series.length))
  const indexes = new Set([start, end - 1])
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = start + 1 + Math.floor(bucket * (end - start - 2) / buckets)
    const to = start + 1 + Math.floor((bucket + 1) * (end - start - 2) / buckets)
    for (const series of plan.series) {
      let min = from, max = from
      for (let row = from + 1; row < to; row++) {
        if (series.values[row]! < series.values[min]!) min = row
        if (series.values[row]! > series.values[max]!) max = row
      }
      indexes.add(min); indexes.add(max)
    }
  }
  return [...indexes].sort((a, b) => a - b)
}

/** No source plan is mutated; original strings and exact row mappings follow displayed points. */
export function chartAtRows(plan: AutoChartPlan, indexes: number[]): AutoChartPlan {
  return { ...plan, labels: indexes.map(index => plan.labels[index]!), sourceRows: indexes.map(index => plan.sourceRows?.[index] ?? index), series: plan.series.map(series => ({ ...series, values: indexes.map(index => series.values[index]!), ...(series.originals ? { originals: indexes.map(index => series.originals![index]!) } : {}) })) }
}
