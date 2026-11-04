import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AutoChartPlan } from './content-analysis.js'
import { chartLabelPosition } from './content-analysis.js'
import { hasSourceGapBetween } from './chart-scaling.js'
const format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })
/** Continuous source abscissa: sampling must never turn uneven dates into equally spaced categories. */
export function lineAbscissa(plan: AutoChartPlan): number[] {
  const times = plan.labels.map(chartLabelPosition)
  return times.every((value): value is number => value !== undefined) ? times : plan.labels.map((_label, index) => plan.sourceRows?.[index] ?? index)
}
/** Keep the existing compact renderer for regular, complete small series. */
export function requiresDenseLinePlot(plan: AutoChartPlan): boolean {
  if (plan.kind !== 'line') return false
  if (plan.labels.length > 200) return true
  const rows = plan.sourceRows
  if (rows?.some((row, index) => index > 0 && hasSourceGapBetween(plan, rows[index - 1]!, row))) return true
  const positions = plan.labels.map(chartLabelPosition)
  if (positions.length < 3 || !positions.every((position): position is number => position !== undefined)) return false
  const firstStep = positions[1]! - positions[0]!
  return positions.some((position, index) => index > 1 && position - positions[index - 1]! !== firstStep)
}

/** Break only at source omissions, not at valid points hidden by display sampling. */
export function lineBreaks(plan: AutoChartPlan): boolean[] {
  return plan.labels.map((_label, index) => index === 0 || hasSourceGapBetween(plan, plan.sourceRows?.[index - 1] ?? index - 1, plan.sourceRows?.[index] ?? index))
}
export function DenseLinePlot({ plan, palette }: { plan: AutoChartPlan, palette: string[] }): ReactElement {
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(800), [selected, setSelected] = useState<number>()
  useEffect(() => { const element = container.current; if (!element) return; const update = () => setWidth(Math.max(160, element.clientWidth)); update(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); observer?.observe(element); return () => observer?.disconnect() }, [])
  useEffect(() => setSelected(undefined), [plan])
  const xs = useMemo(() => lineAbscissa(plan), [plan])
  const breaks = useMemo(() => lineBreaks(plan), [plan]), hasGaps = breaks.slice(1).some(Boolean)
  const left = Math.min(64, width / 4), right = width - 12, top = 12, bottom = 236, height = 284
  const first = xs[0]!, last = xs.at(-1)!, x = (value: number) => left + (value - first) / (last - first || 1) * (right - left)
  let low = Infinity, high = -Infinity
  for (const series of plan.series) for (const value of series.values) { low = Math.min(low, value); high = Math.max(high, value) }
  const pad = Math.max((high - low) * 0.05, Math.abs(high) * 0.01, 0.000001); low -= pad; high += pad
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top)
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4)
  const labelCount = width < 500 ? 3 : 5
  const candidates = [...new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (xs.length - 1) / (labelCount - 1))))]
  const firstLabel = candidates[0]!, lastLabel = candidates.at(-1)!
  const labelIndexes = [firstLabel]
  const textWidth = (index: number) => Math.max(18, plan.labels[index]!.length * 7)
  const firstRight = x(xs[firstLabel]!) + textWidth(firstLabel), lastLeft = x(xs[lastLabel]!) - textWidth(lastLabel)
  const staggerEndpoints = firstLabel !== lastLabel && firstRight + 8 > lastLeft
  let previousRight = firstRight
  for (const index of candidates.slice(1, -1)) {
    // Irregular times can put nearby indexes at almost the same x position.
    const left = x(xs[index]!) - textWidth(index) / 2, right = x(xs[index]!) + textWidth(index) / 2
    if (!staggerEndpoints && left >= previousRight + 8 && right <= lastLeft - 8) { labelIndexes.push(index); previousRight = right }
  }
  if (lastLabel !== firstLabel) labelIndexes.push(lastLabel)
  const current = selected === undefined ? undefined : Math.min(selected, plan.labels.length - 1)
  return h('div', { ref: container, className: 'iexp-dense-line' },
    h('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabIndex: 0, 'aria-label': `${plan.title ?? '时间趋势'}，横轴按原始期间间距绘制${hasGaps ? '，原表未纳入的行处断线' : ''}；左右方向键查看已绘制原值，完整点见原始数据。`,
      onKeyDown: event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); setSelected(previous => Math.max(0, Math.min(plan.labels.length - 1, (previous ?? 0) + (event.key === 'ArrowRight' ? 1 : -1)))) },
      onPointerMove: event => { const box = event.currentTarget.getBoundingClientRect(), target = first + ((event.clientX - box.left) / box.width * width - left) / (right - left) * (last - first); let nearest = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - target) < Math.abs(xs[nearest]! - target)) nearest = i; setSelected(nearest) },
    }, h('title', null, `${plan.title ?? '时间趋势'}；${plan.basis ?? ''}`),
      ...ticks.map((value, index) => h('g', { key: `tick-${index}` }, h('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: 'var(--iexp-line)', strokeDasharray: '2 4' }), h('text', { x: left - 8, y: y(value) + 4, textAnchor: 'end', fill: 'var(--iexp-muted)', fontSize: 12 }, format.format(value)))),
      ...plan.series.map((series, index) => h('g', { key: `series-${index}` },
        h('path', { d: series.values.map((value, row) => `${breaks[row] ? 'M' : 'L'}${x(xs[row]!).toFixed(3)},${y(value).toFixed(3)}`).join(' '), fill: 'none', stroke: palette[index] ?? 'var(--iexp-accent)', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' }),
        // A one-point segment has no visible SVG stroke, so show its actual point.
        ...series.values.flatMap((value, row) => breaks[row] && (row === series.values.length - 1 || breaks[row + 1]) ? [h('circle', { key: row, cx: x(xs[row]!), cy: y(value), r: 3, fill: palette[index] ?? 'var(--iexp-accent)' })] : []))),
      ...labelIndexes.map((index, i) => h('text', { key: `label-${index}`, x: x(xs[index]!), y: bottom + (staggerEndpoints && i === 1 ? 38 : 24), textAnchor: i === 0 ? 'start' : i === labelIndexes.length - 1 ? 'end' : 'middle', fill: 'var(--iexp-muted)', fontSize: 12 }, plan.labels[index])),
      current !== undefined && h('g', null, h('line', { x1: x(xs[current]!), x2: x(xs[current]!), y1: top, y2: bottom, stroke: 'var(--iexp-accent)', strokeDasharray: '3 3' }), ...plan.series.map((series, index) => h('circle', { key: index, cx: x(xs[current]!), cy: y(series.values[current]!), r: 3, fill: palette[index] ?? 'var(--iexp-accent)' })))),
    h('div', { className: 'iexp-data-controls', role: 'status' }, current === undefined ? `横轴保留原始期间间距${hasGaps ? '；原表未纳入的行处断线' : ''}；移动指针或按左右方向键查看原值。` : `${plan.labels[current]} · ${plan.series.map(series => `${series.name}：${series.originals?.[current] ?? `${series.values[current]} ${series.unit}`}`).join('；')}`),
    h('div', { className: 'iexp-data-controls', 'aria-label': '图例' }, ...plan.series.map((series, index) => h('span', { key: index }, h('svg', { width: 20, height: 12, 'aria-hidden': true }, h('line', { x1: 0, x2: 20, y1: 6, y2: 6, stroke: palette[index] ?? 'var(--iexp-accent)', strokeWidth: 2 })), ` ${series.name}${series.unit && !series.name.includes(series.unit) ? `（${series.unit}）` : ''}`))))
}
