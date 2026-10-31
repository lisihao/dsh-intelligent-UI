import { createElement as h, type ReactElement } from 'react'
import type { AutoChartPlan } from './content-analysis.js'
import { comparisonCss } from './comparison-style.js'

/** Small categorical comparisons only. Complex plots stay with the maintained chart renderer. */
export function isCompactComparison(plan: AutoChartPlan): boolean {
  if (plan.kind !== 'bar' || plan.series.length !== 1 || plan.labels.length < 2 || plan.labels.length > 6) return false
  const series = plan.series[0]!
  return series.values.length === plan.labels.length
    && series.values.every(value => Number.isFinite(value) && value >= 0)
    && plan.labels.every(label => !!label.trim())
    && (!series.originals || series.originals.length === plan.labels.length)
}

export interface ComparisonPlotProps { plan: AutoChartPlan }

/**
 * Thin meter adapter for the benchmark's direct-label grammar. OpenUI 0.18.1's
 * public BarChart API exposes neither custom mark shapes nor endpoint labels.
 * Ratios determine CSS width only; the original measurements remain visible.
 */
export function ComparisonPlot({ plan }: ComparisonPlotProps): ReactElement | null {
  if (!isCompactComparison(plan)) return null
  const series = plan.series[0]!
  const maximum = Math.max(...series.values)
  return h('div', { className: 'iexp-comparison', 'data-comparison-plot': true },
    h('style', null, comparisonCss),
    ...plan.labels.map((label, index) => {
      const value = series.values[index]!
      const original = series.originals?.[index] ?? `${value}${series.unit}`
      const position = `${maximum > 0 ? value / maximum * 100 : 0}%`
      return h('div', { className: 'iexp-comparison-row', key: index },
        h('span', { className: 'iexp-comparison-label' }, label),
        h('div', { className: 'iexp-comparison-measure' },
          h('div', {
            className: 'iexp-comparison-meter', role: 'meter',
            'aria-label': `${label} · ${series.name}`,
            'aria-valuemin': 0,
            // An empty [0, 0] interval has no useful meter domain. A unit interval
            // keeps all-zero meters valid without plotting a fabricated value.
            'aria-valuemax': maximum || 1,
            'aria-valuenow': value,
            'aria-valuetext': `${original}${series.unit ? `（单位：${series.unit}）` : ''}`,
          }, h('span', { className: 'iexp-comparison-stroke', style: { width: position }, 'aria-hidden': true })),
          h('span', { className: 'iexp-comparison-value', style: { insetInlineStart: position }, 'aria-hidden': true }, original)))
    }))
}
