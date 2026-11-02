import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AutoChartPlan } from './content-analysis.js'

const INITIAL_COLUMNS = 21
const MAX_COLUMNS = 64
const PROBE = '################'

/** This adapter is for categorical data with a single, shared measurement unit. */
export function supportsAsciiChart(plan: AutoChartPlan): boolean {
  if (plan.kind !== 'bar' || !plan.labels.length || !plan.series.length) return false
  const unit = plan.series[0]!.unit
  return plan.series.every(series => series.unit === unit
    && series.values.length === plan.labels.length
    && series.values.every(Number.isFinite)
    && (!series.originals || series.originals.length === plan.labels.length))
}

/** Include zero and use the source-wide extent even when the current view is paged. */
function extent(plan: AutoChartPlan): { min: number, max: number, magnitude: number } {
  let min = 0, max = 0
  for (const series of plan.series) for (const value of series.values) { min = Math.min(min, value); max = Math.max(max, value) }
  return { min, max, magnitude: Math.max(-min, max) }
}

function characters(value: number, maximum: number, leftSlots: number, rightSlots: number): { leftTrack: string, leftBar: string, rightBar: string, rightTrack: string } {
  const slots = value < 0 ? leftSlots : rightSlots
  const length = value === 0 || maximum === 0 ? 0 : Math.max(1, Math.round(Math.abs(value) / maximum * slots))
  const left = value < 0 ? length : 0, right = value > 0 ? length : 0
  return { leftTrack: '-'.repeat(leftSlots - left), leftBar: '#'.repeat(left), rightBar: '#'.repeat(right), rightTrack: '-'.repeat(rightSlots - right) }
}

/**
 * Renders a paged view of categorical measurements as ASCII. Pass the original
 * plan as scalePlan so the zero axis and scale do not change between pages.
 * The caller owns the figure, source disclosure and any unsupported fallback.
 */
export function AsciiChart({ plan, scalePlan = plan }: { plan: AutoChartPlan, scalePlan?: AutoChartPlan }): ReactElement | null {
  const domain = useMemo(() => supportsAsciiChart(scalePlan) ? extent(scalePlan) : undefined, [scalePlan])
  const validView = supportsAsciiChart(plan), view = validView ? extent(plan) : undefined
  const valid = !!domain && !!view && view.min >= domain.min && view.max <= domain.max
    && plan.series.length === scalePlan.series.length
    && plan.series.every((series, index) => series.unit === scalePlan.series[index]!.unit)
  const container = useRef<HTMLDivElement>(null), probe = useRef<HTMLSpanElement>(null)
  const [columns, setColumns] = useState(INITIAL_COLUMNS)

  useEffect(() => {
    const element = container.current, sample = probe.current
    if (!valid || !element || !sample) return
    let live = true
    const measure = () => {
      if (!live) return
      const width = element.clientWidth, glyph = sample.getBoundingClientRect().width / PROBE.length
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(glyph) || glyph <= 0) return
      // Leave a pixel of tolerance for fractional glyph and layout rounding.
      setColumns(Math.max(3, Math.min(MAX_COLUMNS, Math.floor((width - 1) / glyph))))
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element); observer?.observe(sample)
    const win = element.ownerDocument.defaultView, fonts = element.ownerDocument.fonts
    win?.addEventListener('resize', measure)
    fonts?.addEventListener?.('loadingdone', measure)
    void fonts?.ready.then(measure, () => {})
    measure()
    return () => { live = false; observer?.disconnect(); win?.removeEventListener('resize', measure); fonts?.removeEventListener?.('loadingdone', measure) }
  }, [valid])

  if (!valid || !domain) return null
  const mixed = domain.min < 0 && domain.max > 0, negativeOnly = domain.min < 0 && domain.max === 0
  const leftSlots = mixed ? Math.floor((columns - 1) / 2) : negativeOnly ? columns - 1 : 0
  const rightSlots = mixed ? leftSlots : negativeOnly ? 0 : columns - 1
  const zero = mixed ? '居中' : negativeOnly ? '在右侧' : '在左侧'

  return h('div', { ref: container, className: 'iexp-ascii-chart', 'data-ascii-chart': 'bar' },
    h('style', null, asciiChartCss),
    h('span', { className: 'iexp-ascii-chart-probe', 'aria-hidden': true, ref: probe }, PROBE),
    h('p', { className: 'iexp-ascii-chart-guide' }, `全图（含各分页）统一尺度，零线${zero}；字符长度按最大绝对值离散近似，非零值至少显示一格。精确数值见原文及数据表。`),
    h('ol', { className: 'iexp-ascii-chart-categories', role: 'list' }, ...plan.labels.map((label, row) =>
      h('li', { key: row, className: 'iexp-ascii-chart-category' },
        h('div', { className: 'iexp-ascii-chart-label' }, label),
        ...plan.series.map((series, column) => {
          const value = series.values[row]!
          const original = series.originals?.[row] ?? `${value}${series.unit}`
          const bar = characters(value, domain.magnitude, leftSlots, rightSlots)
          const seriesName = `${series.name}${series.unit && !series.name.includes(series.unit) ? `（${series.unit}）` : ''}`
          return h('div', { className: 'iexp-ascii-chart-measure', key: column },
            h('span', { className: 'iexp-ascii-chart-series' }, seriesName),
            h('span', { className: 'iexp-ascii-chart-mark', 'aria-hidden': true },
              h('span', { className: 'iexp-ascii-chart-track' }, bar.leftTrack),
              h('span', { className: 'iexp-ascii-chart-bar', style: { color: `var(--iexp-series-${column % 8 + 1}, var(--iexp-accent))` } }, bar.leftBar),
              h('span', { className: 'iexp-ascii-chart-axis' }, '|'),
              h('span', { className: 'iexp-ascii-chart-bar', style: { color: `var(--iexp-series-${column % 8 + 1}, var(--iexp-accent))` } }, bar.rightBar),
              h('span', { className: 'iexp-ascii-chart-track' }, bar.rightTrack)),
            h('span', { className: 'iexp-ascii-chart-value' }, original))
        })))))
}

/** Scoped styles follow the active theme; source labels keep the reading face. */
export const asciiChartCss = `
.dsh-experience .iexp-ascii-chart { position:relative; min-width:0; color:var(--iexp-text); font-size:var(--iexp-meta-size,13px); line-height:1.55; }
.dsh-experience .iexp-ascii-chart-guide { margin:0 0 12px; color:var(--iexp-muted); }
.dsh-experience .iexp-ascii-chart-categories { display:grid; gap:12px; margin:0; padding:0; list-style:none; }
.dsh-experience .iexp-ascii-chart-category { min-width:0; }
.dsh-experience .iexp-ascii-chart-label { color:var(--iexp-text); overflow-wrap:anywhere; }
.dsh-experience .iexp-ascii-chart-measure { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,max-content); column-gap:8px; min-width:0; }
.dsh-experience .iexp-ascii-chart-series, .dsh-experience .iexp-ascii-chart-value { overflow-wrap:anywhere; }
.dsh-experience .iexp-ascii-chart-series { grid-area:1 / 1; color:var(--iexp-muted); }
.dsh-experience .iexp-ascii-chart-mark, .dsh-experience .iexp-ascii-chart-probe { white-space:pre; font-family:var(--iexp-code-font,monospace); font-variation-settings:'MONO' 1,'CASL' 0; font-size:inherit; letter-spacing:0; }
.dsh-experience .iexp-ascii-chart-mark { grid-area:2 / 1 / 3 / -1; max-width:100%; overflow:hidden; }
.dsh-experience .iexp-ascii-chart-probe { position:absolute; visibility:hidden; pointer-events:none; }
.dsh-experience .iexp-ascii-chart-track { color:var(--iexp-muted); }
.dsh-experience .iexp-ascii-chart-axis { color:var(--iexp-text); }
.dsh-experience .iexp-ascii-chart-value { grid-area:1 / 2; color:var(--iexp-text); font-variant-numeric:tabular-nums; }
`
