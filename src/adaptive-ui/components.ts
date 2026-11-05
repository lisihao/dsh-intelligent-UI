import { Children, Fragment, createElement as h, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Bar, LinePath } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { Liveline } from 'liveline'
import { SkeletonBox } from 'skullet/react'
import { TextMorph } from 'torph/react'
import { appearancePreferences, appearanceTokens } from '../appearance.js'
import { hasSourceGapBetween } from '../chart-scaling.js'
import type { AutoChartPlan } from '../content-analysis.js'
import { lineAbscissa } from '../dense-line-plot.js'
import { usePresentationTheme } from '../theme-runtime.js'
import { liveSeriesInputSchema, type LiveSeriesInput } from './source-contracts.js'

export { liveSeriesInputSchema, recognizeLiveSeries } from './source-contracts.js'
export type { LiveSeriesInput } from './source-contracts.js'

export interface AdaptiveLoadingProps {
  loading: boolean
  label?: string
  children?: ReactNode
  error?: string
  empty?: boolean
}

function hasPresentedChildren(children: ReactNode): boolean {
  return Children.toArray(children).some(child => typeof child !== 'string' || child.trim().length > 0)
}

/**
 * The Skullet use is intentionally narrow: one neutral, static geometry box.
 * It neither measures nor clones caller children, so refresh preserves values.
 */
export function AdaptiveLoading({ loading, label = '正在加载…', children, error, empty = false }: AdaptiveLoadingProps): ReactElement {
  if (error) return h('section', { className: 'iexp-adaptive-loading', 'data-adaptive-loading': 'error', role: 'alert' },
    h('p', null, error), children)
  if (empty) return h('section', { className: 'iexp-adaptive-loading', 'data-adaptive-loading': 'empty', role: 'status' },
    h('p', null, '没有可展示的数据。'), children)
  if (!loading) return h(Fragment, null, children)
  if (hasPresentedChildren(children)) return h('section', { className: 'iexp-adaptive-loading', 'data-adaptive-loading': 'refresh', 'aria-busy': true },
    children, h('p', { role: 'status' }, label))
  return h('section', { className: 'iexp-adaptive-loading', 'data-adaptive-loading': 'initial', 'aria-busy': true, 'aria-label': label, style: { minWidth: 0 } },
    h('span', { role: 'status' }, label),
    h(SkeletonBox, {
      height: '5.5rem', width: '100%', radius: 'var(--iexp-control-radius)',
      // Skullet reads this before attempting an animation.
      style: { display: 'block', '--skullet-animation': 'none', '--skullet-base': 'var(--iexp-soft)' } as CSSProperties,
    }))
}

function reducedMotionQuery(): MediaQueryList | undefined {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia('(prefers-reduced-motion: reduce)')
}
function reducedMotionSnapshot(): boolean { return reducedMotionQuery()?.matches ?? true }
function subscribeReducedMotion(listener: () => void): () => void {
  const media = reducedMotionQuery()
  media?.addEventListener?.('change', listener)
  return () => media?.removeEventListener?.('change', listener)
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true)
}

function pageVisibleSnapshot(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible'
}
function subscribePageVisibility(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
function usePageVisible(): boolean {
  return useSyncExternalStore(subscribePageVisibility, pageVisibleSnapshot, () => false)
}

/** Never morph prose, code, citations, URLs, or potentially editable content. */
function mayMorphText(text: string): boolean {
  return text.length > 0 && text.length <= 120
    && !/[\r\n\x60]/.test(text)
    && !/(?:https?:\/\/|www\.)/i.test(text)
    && !/\[[^\]]+\]|【[^】]+】/.test(text)
}

export function AdaptiveText({ text, motion = true }: { text: string, motion?: boolean }): ReactElement {
  const reducedMotion = useReducedMotion()
  if (!motion || reducedMotion || !mayMorphText(text)) return h('span', { 'data-adaptive-text': 'plain' }, text)
  // The numeric option changes only glyph motion; the original formatted string remains the child.
  return h(TextMorph, { as: 'span', className: 'iexp-adaptive-text', numbers: true, respectReducedMotion: true, children: text })
}

function exactValue(value: number, unit: string): string { return String(value) + ' ' + unit }
function exactTime(time: number, timeUnit: LiveSeriesInput['timeUnit']): string { return String(time) + ' ' + timeUnit }
function seconds(time: number, timeUnit: LiveSeriesInput['timeUnit']): number { return timeUnit === 'milliseconds' ? time / 1000 : time }

/**
 * Pinned Liveline 0.0.7, with badge=false, uses:
 * left = now - window * (1 - 0.015), then accepts point.time >= left - 2
 * and point.time <= now. The adapter owns this compatibility calculation.
 */
export const LIVELINE_NO_BADGE_WINDOW_BUFFER = 0.015
export const LIVELINE_LEFT_EDGE_GRACE_SECONDS = 2
export const LIVELINE_MAX_WINDOW_SECONDS = 24 * 60 * 60

export type LivelineWindowDecision =
  | { kind: 'ready', windowSeconds: number, expiresAtSeconds: number }
  | { kind: 'static', reason: 'future-observation' | 'current-window' | 'outside-bounded-window' }

/**
 * Its fixed viewport comes solely from source span and observed cadence. The
 * wall clock is used only to test the published filter's current visibility.
 */
export function resolveLivelineWindow(points: readonly { time: number }[], nowSeconds: number): LivelineWindowDecision {
  if (!Number.isFinite(nowSeconds) || points.length < 2 || points.some(point => !Number.isFinite(point.time))) {
    throw new RangeError('Liveline window requires at least two finite timestamped points.')
  }
  const first = points[0]!.time, latest = points[points.length - 1]!.time
  if (latest > nowSeconds) return { kind: 'static', reason: 'future-observation' }
  let cadence = 0
  for (let index = 1; index < points.length; index++) cadence = Math.max(cadence, points[index]!.time - points[index - 1]!.time)
  const sourceSpan = latest - first
  const minimumWindow = Math.max(1, (sourceSpan + cadence - LIVELINE_LEFT_EDGE_GRACE_SECONDS) / (1 - LIVELINE_NO_BADGE_WINDOW_BUFFER))
  // The ceiling and one-second margin protect the boundary from fractional
  // browser-clock values while retaining the source points themselves intact.
  const windowSeconds = Math.ceil(minimumWindow) + 1
  if (windowSeconds > LIVELINE_MAX_WINDOW_SECONDS) return { kind: 'static', reason: 'outside-bounded-window' }
  const rightEdge = nowSeconds + windowSeconds * LIVELINE_NO_BADGE_WINDOW_BUFFER
  const leftEdge = rightEdge - windowSeconds
  const visible = points.filter(point => point.time >= leftEdge - LIVELINE_LEFT_EDGE_GRACE_SECONDS && point.time <= nowSeconds)
  const secondLatest = points[points.length - 2]!
  const expiresAtSeconds = secondLatest.time + windowSeconds * (1 - LIVELINE_NO_BADGE_WINDOW_BUFFER) + LIVELINE_LEFT_EDGE_GRACE_SECONDS
  if (nowSeconds >= expiresAtSeconds || visible.length < 2) return { kind: 'static', reason: 'current-window' }
  return { kind: 'ready', windowSeconds, expiresAtSeconds }
}

function liveWindowFallbackMessage(source: LiveSeriesInput, decision: Exclude<LivelineWindowDecision, { kind: 'ready' }>): string {
  const first = source.points[0]!, latest = source.points[source.points.length - 1]!
  if (decision.reason === 'future-observation') {
    return '来源最新观测 ' + exactTime(latest.time, source.timeUnit) + ' 晚于当前浏览器时钟；固定版本 Liveline 不会将该点纳入当前窗口，以下显示精确静态快照。'
  }
  if (decision.reason === 'current-window') {
    return '当前时间窗口不再同时包含至少两条来源观测；为保留实际时间戳，以下显示精确静态快照。'
  }
  return '来源首个观测 ' + exactTime(first.time, source.timeUnit) + ' 至最新观测 ' + exactTime(latest.time, source.timeUnit) + ' 超出 Liveline 的限定显示窗口，以下显示精确静态快照。'
}

/** One deadline per unchanged live source; no polling or background data work. */
function useLiveSeriesExpiry(expiresAtSeconds: number | undefined, revision: string, enabled: boolean): void {
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!enabled || expiresAtSeconds === undefined || typeof window === 'undefined') return
    const delay = expiresAtSeconds * 1000 - Date.now()
    // The deadline can pass between render and effect setup. Queue one local
    // redraw even then; returning early would leave an unchanged source live.
    const timer = window.setTimeout(() => rerender(previous => previous + 1), Math.max(0, Math.ceil(delay)))
    return () => window.clearTimeout(timer)
  }, [expiresAtSeconds, revision, enabled])
}

function LiveSeriesSourceTable({ source, open = false }: { source: LiveSeriesInput, open?: boolean }): ReactElement {
  return h('details', { className: 'iexp-disclosure', open, 'data-live-series-source': true },
    h('summary', null, '完整原始观测（' + source.points.length + '）'),
    h('div', { style: { overflowX: 'auto' } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
        h('caption', { style: { textAlign: 'start' } }, '来源：' + source.source + '；数值单位：' + source.unit),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, '来源时间（' + source.timeUnit + '）'),
          h('th', { scope: 'col' }, '数值（' + source.unit + '）'))),
        h('tbody', null,
          ...source.points.map((point, index) => h('tr', { key: index },
            h('th', { scope: 'row' }, exactTime(point.time, source.timeUnit)),
            h('td', null, exactValue(point.value, source.unit)),
          )),
        ),
      ),
    ),
  )
}

function LiveSeriesMetadata({ source, motion = false }: { source: LiveSeriesInput, motion?: boolean }): ReactElement {
  const latest = source.points[source.points.length - 1]!
  return h('div', { className: 'iexp-live-series-metadata', style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', color: 'var(--iexp-text)', fontVariantNumeric: 'tabular-nums' } },
    h('span', null, h('strong', null, '最新值：'), h(AdaptiveText, { text: exactValue(latest.value, source.unit), motion })),
    h('span', null, h('strong', null, '最新观测：'), exactTime(latest.time, source.timeUnit)),
    source.updatedAt !== undefined && h('span', null, h('strong', null, '来源更新时间：'), exactTime(source.updatedAt, source.timeUnit)))
}

function useAccentColor(): string {
  const theme = usePresentationTheme()
  const appearance = useSyncExternalStore(appearancePreferences.subscribe, appearancePreferences.getSnapshot, appearancePreferences.getSnapshot)
  return appearanceTokens(appearance, theme).variables['--iexp-accent']!
}

/**
 * An offscreen Liveline is unmounted rather than merely paused. Its own
 * effect cleanup then releases the animation frame and canvas listeners.
 */
function useViewportVisible(ref: { current: Element | null }): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      setVisible(entries[0]?.isIntersecting === true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

/**
 * Liveline receives only validated observations. The displayed current value
 * always comes from the last source point rather than a separate input field.
 */
export function LiveSeriesView({ source, dark, animate = true }: { source: LiveSeriesInput, dark: boolean, animate?: boolean }): ReactElement {
  const root = useRef<HTMLElement | null>(null)
  const reducedMotion = useReducedMotion(), pageVisible = usePageVisible(), inViewport = useViewportVisible(root), accent = useAccentColor()
  const parsed = liveSeriesInputSchema.safeParse(source)
  const validSource = parsed.success ? parsed.data : undefined
  const normalized = validSource ? validSource.points.map(point => ({ time: seconds(point.time, validSource.timeUnit), value: point.value })) : []
  const sourceRevision = validSource ? JSON.stringify([validSource.source, validSource.unit, validSource.timeUnit, validSource.updatedAt, validSource.points]) : ''
  const currentTime = Date.now() / 1000
  const windowDecision = normalized.length < 2 ? undefined : resolveLivelineWindow(normalized, currentTime)
  useLiveSeriesExpiry(windowDecision?.kind === 'ready' ? windowDecision.expiresAtSeconds : undefined, sourceRevision, animate && !reducedMotion && pageVisible && inViewport && windowDecision?.kind === 'ready')
  if (!parsed.success) return h('section', { className: 'iexp-live-series', 'data-live-series': 'invalid', role: 'alert' },
    h('p', null, '实时序列数据无法显示：' + parsed.error.issues.map(issue => (issue.path.join('.') || '数据') + '：' + issue.message).join('；') + '。请查看调用方保留的原始内容。'))
  const valid = parsed.data, latest = valid.points[valid.points.length - 1]!
  const fallback = !animate
    ? '此实时序列的动画已停用，以下显示精确静态快照。'
    : reducedMotion
      ? '已启用减少动态效果，以下显示精确静态快照。'
    : !pageVisible
      ? '页面当前不可见，以下显示精确静态快照。'
      : !inViewport
        ? '图形当前不在可视区域，以下显示精确静态快照。'
        : valid.points.length < 2
          ? '来源只有一条观测，不能绘制时间序列；以下显示精确静态记录。'
          : windowDecision?.kind === 'static'
            ? liveWindowFallbackMessage(valid, windowDecision)
            : undefined
  const frameStyle: CSSProperties = {
    minWidth: 0, background: 'var(--iexp-card)', color: 'var(--iexp-text)', border: '1px solid var(--iexp-line)',
    borderRadius: 'var(--iexp-control-radius)', padding: '12px', fontVariantNumeric: 'tabular-nums',
  }
  const metadataMotion = animate && !fallback && !reducedMotion && pageVisible && inViewport
  if (fallback) return h('section', { ref: root, className: 'iexp-live-series', 'data-live-series': 'static', style: frameStyle, 'aria-label': '实时序列：' + valid.source },
    h('p', { role: 'status' }, fallback), h(LiveSeriesMetadata, { source: valid, motion: metadataMotion }), h(LiveSeriesSourceTable, { source: valid, open: true }))
  if (!windowDecision || windowDecision.kind !== 'ready') return h('section', { ref: root, className: 'iexp-live-series', 'data-live-series': 'static', style: frameStyle, 'aria-label': '实时序列：' + valid.source },
    h('p', { role: 'status' }, '实时序列窗口无法确定，以下显示精确静态快照。'), h(LiveSeriesMetadata, { source: valid }), h(LiveSeriesSourceTable, { source: valid, open: true }))
  const windowSeconds = windowDecision.windowSeconds
  const formatTime = (time: number) => {
    const matching = normalized.findIndex(point => point.time === time)
    const raw = matching === -1 ? valid.timeUnit === 'milliseconds' ? time * 1000 : time : valid.points[matching]!.time
    return exactTime(raw, valid.timeUnit)
  }
  return h('section', { ref: root, className: 'iexp-live-series', 'data-live-series': 'live', style: frameStyle, 'aria-label': '实时序列：' + valid.source },
    h('p', { style: { margin: '0 0 8px' } }, h('strong', null, valid.source), ' · ' + valid.unit),
    h(LiveSeriesMetadata, { source: valid, motion: metadataMotion }),
    h('div', { style: { height: 260, marginTop: 10, color: 'var(--iexp-accent)' } }, h(Liveline, {
      data: normalized, value: latest.value, theme: dark ? 'dark' : 'light', color: accent, window: windowSeconds,
      grid: true, badge: false, momentum: false, fill: false, loading: false, paused: false, scrub: false,
      exaggerate: false, showValue: false, valueMomentumColor: false, degen: false, badgeTail: false,
      tooltipOutline: false, pulse: false, lerpSpeed: 1, formatValue: value => exactValue(value, valid.unit), formatTime,
      style: { height: '100%' },
    })),
    h('p', { role: 'status', style: { color: 'var(--iexp-muted)' } }, '图形使用声明的实时来源；完整原始观测与时间单位保留如下。'),
    h(LiveSeriesSourceTable, { source: valid }))
}

type HistoricalDatum = { index: number, value: number }
const HISTORICAL_WIDTH = 720, HISTORICAL_HEIGHT = 320, HISTORICAL_LEFT = 58, HISTORICAL_RIGHT = 18, HISTORICAL_TOP = 18, HISTORICAL_BOTTOM = 56

function invalidChartPlan(plan: AutoChartPlan): string | undefined {
  if (!Array.isArray(plan.labels) || plan.labels.length === 0) return '没有可绘制的原始标签'
  if (!Array.isArray(plan.series) || plan.series.length === 0) return '没有可绘制的数值序列'
  for (const series of plan.series) {
    if (!Array.isArray(series.values) || series.values.length !== plan.labels.length) return '序列「' + series.name + '」与原始标签数量不一致'
    if (series.values.some(value => !Number.isFinite(value))) return '序列「' + series.name + '」包含非有限数值'
  }
  return undefined
}
function chartColor(palette: readonly string[], index: number): string {
  return palette[index] || 'var(--iexp-series-' + (index % 8 + 1) + ', var(--iexp-accent))'
}
function sourceGap(plan: AutoChartPlan, index: number): boolean {
  if (index === 0) return false
  const before = plan.sourceRows?.[index - 1] ?? index - 1
  const after = plan.sourceRows?.[index] ?? index
  return hasSourceGapBetween(plan, before, after)
}
function lineSegments(plan: AutoChartPlan, values: number[]): HistoricalDatum[][] {
  const segments: HistoricalDatum[][] = []
  for (let index = 0; index < values.length; index++) {
    if (index === 0 || sourceGap(plan, index)) segments.push([])
    segments[segments.length - 1]!.push({ index, value: values[index]! })
  }
  return segments
}
function labelIndexes(length: number): number[] {
  const count = Math.min(length, 6)
  if (count <= 1) return [0]
  return [...new Set(Array.from({ length: count }, (_value, index) => Math.round(index * (length - 1) / (count - 1))))]
}

/**
 * A narrow visx adapter for source-derived line and bar plans. The parent
 * retains the existing ChartDataTable disclosure as the complete source view.
 */
export function HistoricalChart({ plan, palette }: { plan: AutoChartPlan, palette: readonly string[] }): ReactElement {
  const error = invalidChartPlan(plan)
  if (error) return h('div', { className: 'iexp-historical-chart', 'data-historical-chart': 'invalid', role: 'alert' },
    '历史图表无法显示：' + error + '。完整原表仍由调用方保留。')
  const values = plan.series.flatMap(series => series.values)
  const minimum = Math.min(...values), maximum = Math.max(...values)
  const sourceLow = plan.kind === 'bar' ? Math.min(0, minimum) : minimum
  const sourceHigh = plan.kind === 'bar' ? Math.max(0, maximum) : maximum
  const padding = Math.max(Math.abs(sourceHigh - sourceLow) * 0.05, Math.max(Math.abs(sourceLow), Math.abs(sourceHigh)) * 0.01, 0.000001)
  const domain: [number, number] = sourceLow === sourceHigh ? [sourceLow - padding, sourceHigh + padding] : [sourceLow - (plan.kind === 'line' ? padding : 0), sourceHigh + (plan.kind === 'line' ? padding : 0)]
  const positionIds = plan.labels.map((_label, index) => String(index))
  const categoryX = scaleBand({ domain: positionIds, range: [HISTORICAL_LEFT, HISTORICAL_WIDTH - HISTORICAL_RIGHT], padding: 0.2 })
  const linePositions = plan.kind === 'line' ? lineAbscissa(plan) : []
  const lineMinimum = linePositions.length ? Math.min(...linePositions) : 0
  const lineMaximum = linePositions.length ? Math.max(...linePositions) : 1
  const lineX = scaleLinear({ domain: lineMinimum === lineMaximum ? [lineMinimum - 1, lineMaximum + 1] : [lineMinimum, lineMaximum], range: [HISTORICAL_LEFT, HISTORICAL_WIDTH - HISTORICAL_RIGHT], nice: false })
  const y = scaleLinear({ domain, range: [HISTORICAL_HEIGHT - HISTORICAL_BOTTOM, HISTORICAL_TOP], nice: false })
  const plotBottom = HISTORICAL_HEIGHT - HISTORICAL_BOTTOM, plotRight = HISTORICAL_WIDTH - HISTORICAL_RIGHT
  const xCenter = (index: number) => plan.kind === 'line'
    ? lineX(linePositions[index]!)
    : (categoryX(String(index)) ?? HISTORICAL_LEFT) + categoryX.bandwidth() / 2
  const title = plan.title ?? (plan.kind === 'line' ? '历史趋势' : '历史数值比较')
  const gaps = plan.labels.reduce((count, _label, index) => count + (sourceGap(plan, index) ? 1 : 0), 0)
  const description = title + '，' + plan.series.map(series => series.name + (series.unit ? '（' + series.unit + '）' : '')).join('；') + '。' + (gaps ? '原表有 ' + gaps + ' 处未纳入行，折线在这些位置断开。' : '数据按原始标签顺序绘制。')
  const tickIndexes = labelIndexes(plan.labels.length)
  const zero = y(0)
  return h('figure', { className: 'iexp-historical-chart', 'data-historical-chart': plan.kind, style: { margin: 0, minWidth: 0 } },
    h('figcaption', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginBottom: 8 } },
      h('strong', null, title), h('span', { style: { color: 'var(--iexp-muted)' } }, plan.basis || plan.series.map(series => series.unit).filter(Boolean).join(' / ') || '原始数值')),
    h('svg', { role: 'img', tabIndex: 0, 'aria-label': description, width: '100%', height: HISTORICAL_HEIGHT, viewBox: '0 0 ' + HISTORICAL_WIDTH + ' ' + HISTORICAL_HEIGHT, style: { display: 'block', maxWidth: '100%' } },
      h('title', null, title), h('desc', null, description),
      h('line', { x1: HISTORICAL_LEFT, x2: plotRight, y1: plotBottom, y2: plotBottom, stroke: 'var(--iexp-line)' }),
      h('line', { x1: HISTORICAL_LEFT, x2: plotRight, y1: y(sourceHigh), y2: y(sourceHigh), stroke: 'var(--iexp-line)', strokeDasharray: '2 4' }),
      sourceLow !== sourceHigh && h('line', { x1: HISTORICAL_LEFT, x2: plotRight, y1: y(sourceLow), y2: y(sourceLow), stroke: 'var(--iexp-line)', strokeDasharray: '2 4' }),
      h('text', { x: HISTORICAL_LEFT - 8, y: y(sourceHigh) + 4, textAnchor: 'end', fill: 'var(--iexp-muted)', fontSize: 12 }, String(sourceHigh)),
      sourceLow !== sourceHigh && h('text', { x: HISTORICAL_LEFT - 8, y: y(sourceLow) + 4, textAnchor: 'end', fill: 'var(--iexp-muted)', fontSize: 12 }, String(sourceLow)),
      ...(plan.kind === 'line'
        ? plan.series.flatMap((series, seriesIndex) => {
            const color = chartColor(palette, seriesIndex)
            return lineSegments(plan, series.values).flatMap((segment, segmentIndex) => [
              h(LinePath<HistoricalDatum>, { key: 'line-' + seriesIndex + '-' + segmentIndex, data: segment, x: datum => xCenter(datum.index), y: datum => y(datum.value), stroke: color, strokeWidth: 2, fill: 'none', vectorEffect: 'non-scaling-stroke' }),
              ...segment.map(datum => h('circle', { key: 'point-' + seriesIndex + '-' + datum.index, cx: xCenter(datum.index), cy: y(datum.value), r: 2.5, fill: color })),
            ])
          })
        : plan.series.flatMap((series, seriesIndex) => {
            const color = chartColor(palette, seriesIndex), width = Math.max(1, categoryX.bandwidth() / plan.series.length)
            return series.values.map((value, index) => {
              const valueY = y(value), top = Math.min(zero, valueY), height = Math.abs(zero - valueY)
              return h(Bar, { key: 'bar-' + seriesIndex + '-' + index, x: (categoryX(String(index)) ?? HISTORICAL_LEFT) + width * seriesIndex, y: top, width, height, fill: color })
            })
          })),
      ...tickIndexes.map((index, tickIndex) => h('text', { key: 'label-' + index, x: xCenter(index), y: plotBottom + 20, textAnchor: tickIndex === 0 ? 'start' : tickIndex === tickIndexes.length - 1 ? 'end' : 'middle', fill: 'var(--iexp-muted)', fontSize: 12 }, plan.labels[index])),
    ),
    h('div', { 'aria-label': '图例', style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 8 } },
      ...plan.series.map((series, index) => h('span', { key: series.name, style: { color: 'var(--iexp-text)' } },
        h('svg', { width: 18, height: 12, 'aria-hidden': true }, h('line', { x1: 0, x2: 18, y1: 6, y2: 6, stroke: chartColor(palette, index), strokeWidth: 2 })),
        ' ' + series.name + (series.unit ? '（' + series.unit + '）' : '')))),
    h('p', { role: 'status', style: { color: 'var(--iexp-muted)' } }, String(plan.labels.length) + ' 个原始标签' + (gaps ? '；' + gaps + ' 处原表缺口未连线' : '') + '；完整原始数据由调用方保留。'))
}
