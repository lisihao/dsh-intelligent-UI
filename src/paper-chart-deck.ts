import { ChartDataTable } from './chart-viewport.js'
import { createElement as h, useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement } from 'react'
import type { AutoChartPlan } from './content-analysis.js'

interface PaperChartDeckProps { plans: AutoChartPlan[], Chart: ComponentType<{ plan: AutoChartPlan }> }
const motionQuery = '(prefers-reduced-motion: reduce)'
const numberFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 })
function planTitle(plan: AutoChartPlan): string { return plan.title || plan.series.map(series => series.name).join('、') || '原表图表' }
function planMeta(plan: AutoChartPlan): string {
  return [...new Set([plan.basis, ...plan.series.map(series => plan.basis?.includes(series.unit) ? '' : series.unit)].filter((value): value is string => !!value))].join(' · ')
}
function SourceRail({ plan }: { plan: AutoChartPlan }): ReactElement {
  if (plan.labels.length > 100) return h('div', { className: 'iexp-paper-chart-data' }, h('p', { className: 'iexp-paper-chart-data-meta' }, planTitle(plan), planMeta(plan) && ` · ${planMeta(plan)}`), h(ChartDataTable, { plan }))
  const data = h('div', { className: 'iexp-paper-chart-data-scroll', tabIndex: 0, role: 'region', 'aria-label': '当前图表完整选取数据' },
    h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, '原始标签'), ...plan.series.map((series, index) => h('th', { key: index, scope: 'col' }, series.name, series.unit && `（${series.unit}）`)))),
      h('tbody', null, ...plan.labels.map((label, row) => h('tr', { key: row }, h('th', { scope: 'row' }, label), ...plan.series.map((series, column) => h('td', { key: column }, series.originals?.[row] ?? numberFormat.format(series.values[row]!))))))))
  return h('div', { className: 'iexp-paper-chart-data' },
    h('p', { className: 'iexp-paper-chart-data-meta' }, planTitle(plan), planMeta(plan) && ` · ${planMeta(plan)}`),
    plan.labels.length <= 4 && plan.series.length === 1 ? data : h('details', { className: 'iexp-paper-chart-data-source' }, h('summary', null, '当前图表原始数据'), data))
}

/** One source-derived chart stage; switching never regenerates data or remounts a hidden chart. */
export function PaperChartDeck({ plans, Chart }: PaperChartDeckProps): ReactElement | null {
  const signature = JSON.stringify(plans)
  const [selection, setSelection] = useState({ signature, index: 0, playing: false })
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(motionQuery).matches)
  const [background, setBackground] = useState(() => typeof document !== 'undefined' && document.hidden)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const prefix = useId()
  const current = selection.signature === signature && selection.index < plans.length ? selection.index : 0
  const playing = selection.signature === signature && selection.playing && !reducedMotion && plans.length > 1
  const stop = () => setSelection(previous => previous.playing ? { signature, index: current, playing: false } : previous)
  useEffect(() => { setSelection(previous => previous.signature === signature ? previous : { signature, index: 0, playing: false }) }, [signature])
  useEffect(() => {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(motionQuery) : undefined
    const updateMotion = () => {
      const reduced = query?.matches ?? false
      setReducedMotion(reduced)
      if (reduced) setSelection(previous => ({ ...previous, playing: false }))
    }
    const updateVisibility = () => setBackground(document.hidden)
    updateMotion(); updateVisibility()
    query?.addEventListener('change', updateMotion); document.addEventListener('visibilitychange', updateVisibility)
    return () => { query?.removeEventListener('change', updateMotion); document.removeEventListener('visibilitychange', updateVisibility) }
  }, [])
  useEffect(() => {
    if (!playing || background) return
    const timer = window.setInterval(() => setSelection(previous => previous.signature === signature && previous.playing ? { ...previous, index: (previous.index + 1) % plans.length } : previous), 5000)
    return () => window.clearInterval(timer)
  }, [playing, background, signature, plans.length])
  const choose = (index: number, focus = false) => {
    setSelection({ signature, index, playing: false })
    if (focus) tabs.current[index]?.focus()
  }
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % plans.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + plans.length) % plans.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = plans.length - 1
    else return
    event.preventDefault(); choose(next, true)
  }
  const onManualInput = (event: { target: EventTarget }) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-paper-playback]')) stop()
  }
  if (!plans.length) return null
  const active = plans[current]!
  return h('section', { className: 'iexp-paper-chart-deck', 'aria-label': '原表图表展示', onPointerDownCapture: onManualInput, onClickCapture: onManualInput, onKeyDownCapture: onManualInput },
    plans.length > 1 && h('div', { className: 'iexp-paper-chart-controls' },
      h('div', { className: 'iexp-paper-chart-tabs', role: 'tablist', 'aria-label': '选择原表图表' }, ...plans.map((plan, index) => h('button', {
        key: index, type: 'button', role: 'tab', id: `${prefix}-tab-${index}`, 'aria-controls': `${prefix}-panel-${index}`, 'aria-selected': index === current,
        tabIndex: index === current ? 0 : -1, ref: (element: HTMLButtonElement | null) => { tabs.current[index] = element }, onClick: () => choose(index), onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onTabKey(event, index),
      }, h('span', { className: 'iexp-paper-chart-tab-title' }, planTitle(plan)), h('span', { className: 'iexp-paper-chart-tab-meta' }, planMeta(plan))))),
      h('button', { type: 'button', className: 'iexp-paper-chart-playback', 'data-paper-playback': true, disabled: reducedMotion, 'aria-pressed': playing, 'aria-describedby': reducedMotion ? `${prefix}-motion` : undefined, onClick: () => setSelection({ signature, index: current, playing: !playing }) }, playing ? '暂停演示' : '演示切换'),
      h('span', { className: 'iexp-paper-chart-status', id: `${prefix}-motion`, role: 'status' }, reducedMotion ? '系统已启用减少动态，演示切换已停用。' : playing && background ? '页面隐藏，演示已暂停。' : playing ? '每 5 秒切换一张原表图表。' : ''),
      h('p', { className: 'iexp-paper-chart-scale-note' }, '各图独立刻度；跨图比较须核对单位与期间，不能只比较条长。')),
    h('div', { className: 'iexp-paper-chart-stage' }, ...plans.map((plan, index) => h('div', {
      key: `${index}-${JSON.stringify(plan)}`, className: 'iexp-paper-chart-panel', role: 'tabpanel', id: `${prefix}-panel-${index}`, hidden: index !== current,
      'aria-labelledby': plans.length > 1 ? `${prefix}-tab-${index}` : undefined, 'aria-label': plans.length === 1 ? planTitle(plan) : undefined,
    }, h(Chart, { plan })))),
    h(SourceRail, { key: current, plan: active }))
}
