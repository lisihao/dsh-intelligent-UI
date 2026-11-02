import type { AutoChartPlan } from './content-analysis.js'

export const CHART_POINT_BUDGET = 800
export const CATEGORY_PAGE_SIZE = 24
export const SOURCE_PAGE_SIZE = 100

/** A missing source row is different from a valid point skipped for display density. */
export function hasSourceGapBetween(plan: AutoChartPlan, before: number, after: number): boolean {
  const ranges = plan.omittedRowRanges
  if (!ranges?.length || after <= before + 1) return false
  // The source analyser emits sorted, non-overlapping half-open ranges.
  let low = 0, high = ranges.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (ranges[middle]![1] <= before + 1) low = middle + 1
    else high = middle
  }
  return low < ranges.length && ranges[low]![0] < after
}

/** Prefer the original points immediately on either side of a source gap. */
function gapBoundaryIndexes(plan: AutoChartPlan, start: number, end: number): number[] {
  const rows = plan.sourceRows, ranges = plan.omittedRowRanges
  if (!rows || !ranges?.length) return []
  const boundaries = new Set<number>()
  for (const [from, to] of ranges) {
    let low = start, high = end
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (rows[middle]! < to) low = middle + 1
      else high = middle
    }
    const before = low - 1, after = low
    if (before >= start && after < end && rows[before]! < from) {
      if (before !== start) boundaries.add(before)
      if (after !== end - 1) boundaries.add(after)
    }
  }
  return [...boundaries].sort((a, b) => a - b)
}

/** Display only: source-order envelope retains every series' bucket extrema and endpoints. */
export function chartRowIndexes(plan: AutoChartPlan, start = 0, end = plan.labels.length, budget = CHART_POINT_BUDGET): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > plan.labels.length || end <= start) throw new RangeError('图表行范围无效。')
  if (!Number.isInteger(budget) || budget < 2 * plan.series.length + 2) throw new RangeError('图表细节预算不足以保留各序列极值。')
  if (end - start <= budget || plan.kind === 'bar') return Array.from({ length: end - start }, (_, i) => start + i)
  const indexes = new Set([start, end - 1])
  const boundaries = gapBoundaryIndexes(plan, start, end)
  // Leave room for at least one extrema bucket, even for highly fragmented sources.
  const reserve = Math.min(boundaries.length, Math.floor((budget - 2 - 2 * plan.series.length) / 2))
  for (let position = 0; position < reserve; position++) {
    const index = reserve === 1 ? 0 : Math.round(position * (boundaries.length - 1) / (reserve - 1))
    indexes.add(boundaries[index]!)
  }
  const buckets = Math.floor((budget - indexes.size) / (2 * plan.series.length))
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
