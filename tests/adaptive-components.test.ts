// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutoChartPlan } from '../src/content-analysis.js'
import { lineAbscissa } from '../src/dense-line-plot.js'

const upstream = vi.hoisted(() => ({
  liveline: vi.fn(),
  livelineCleanup: vi.fn(),
  skullet: vi.fn(),
  torph: vi.fn(),
}))

vi.mock('liveline', async () => {
  const react = await import('react')
  return {
    Liveline: (props: Record<string, unknown>) => {
      upstream.liveline(props)
      react.useEffect(() => () => { upstream.livelineCleanup() }, [])
      return react.createElement('div', { 'data-liveline': true })
    },
  }
})
vi.mock('skullet/react', async () => {
  const react = await import('react')
  return {
    SkeletonBox: (props: Record<string, unknown>) => {
      upstream.skullet(props)
      return react.createElement('span', { 'data-skullet-box': true })
    },
  }
})
vi.mock('torph/react', async () => {
  const react = await import('react')
  return {
    TextMorph: (props: Record<string, unknown>) => {
      upstream.torph(props)
      const child = typeof props.children === 'string' || typeof props.children === 'number' ? props.children : null
      return react.createElement('span', { 'data-torph': true }, child)
    },
  }
})

import { AdaptiveLoading, AdaptiveText, HistoricalChart, LIVELINE_LEFT_EDGE_GRACE_SECONDS, LIVELINE_NO_BADGE_WINDOW_BUFFER, LiveSeriesView, liveSeriesInputSchema, recognizeLiveSeries, resolveLivelineWindow } from '../src/adaptive-ui/components.js'
import { adaptiveComponentProvenance, adaptiveComponentSource } from '../src/adaptive-ui/component-provenance.js'
import { liveSeriesInputSchema as sharedLiveSeriesInputSchema, recognizeLiveSeries as sharedRecognizeLiveSeries } from '../src/adaptive-ui/source-contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const nodeRequire = createRequire(join(process.cwd(), 'tests', 'adaptive-components.test.ts'))

function installMedia(reduced: boolean): void {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
}
function installIntersectionObserver(): { callbacks: IntersectionObserverCallback[], disconnect: ReturnType<typeof vi.fn> } {
  const callbacks: IntersectionObserverCallback[] = [], disconnect = vi.fn()
  class TestIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void { disconnect() }
    takeRecords(): IntersectionObserverEntry[] { return [] }
    readonly root: Element | Document | null = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  return { callbacks, disconnect }
}
async function mount(element: ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div'), root = createRoot(host)
  roots.push(root); document.body.append(host)
  await act(async () => { root.render(element) })
  return host
}
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const source = {
  type: 'live-series' as const,
  source: '延迟探针',
  unit: 'ms',
  timeUnit: 'milliseconds' as const,
  points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.5 }],
  updatedAt: 2_000,
}

describe('explicit live-series boundary', () => {
  it('requires the complete strict protocol and never recognizes ordinary tables or arrays', () => {
    expect(liveSeriesInputSchema).toBe(sharedLiveSeriesInputSchema)
    expect(recognizeLiveSeries).toBe(sharedRecognizeLiveSeries)
    expect(liveSeriesInputSchema.parse(source)).toEqual(source)
    expect(recognizeLiveSeries(source)).toEqual(source)
    expect(recognizeLiveSeries(source.points)).toBeUndefined()
    expect(recognizeLiveSeries([{ time: 1, value: 2 }])).toBeUndefined()
    expect(recognizeLiveSeries({ source: 'ordinary table', unit: 'ms', points: source.points })).toBeUndefined()
    expect(liveSeriesInputSchema.safeParse({ ...source, unexpected: true }).success).toBe(false)
    expect(liveSeriesInputSchema.safeParse({ ...source, points: [...source.points].reverse() }).success).toBe(false)
    expect(liveSeriesInputSchema.safeParse({ ...source, updatedAt: 999 }).success).toBe(false)
  })

  it('converts milliseconds only for Liveline while deriving its current value from the last source point', async () => {
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const host = await mount(h(LiveSeriesView, { source, dark: true }))
    const props = upstream.liveline.mock.calls[0]?.[0] as Record<string, unknown>
    expect(props.data).toEqual([{ time: 1, value: 8.25 }, { time: 2, value: 7.5 }])
    expect(props.value).toBe(7.5)
    expect(props).toMatchObject({ theme: 'dark', badge: false, momentum: false, fill: false, scrub: false, exaggerate: false, valueMomentumColor: false, degen: false, pulse: false, lerpSpeed: 1 })
    expect(upstream.torph.mock.calls[0]?.[0]).toMatchObject({ children: '7.5 ms', numbers: true })
    expect(host.textContent).toContain('最新值：7.5 ms')
    expect(host.textContent).toContain('来源更新时间：2000 milliseconds')
    expect(host.querySelector('[data-live-series-source]')).not.toBeNull()
  })

  it('uses a complete exact table rather than Liveline for reduced motion or a hidden document', async () => {
    installMedia(true); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const reduced = await mount(h(LiveSeriesView, { source, dark: false }))
    expect(upstream.liveline).not.toHaveBeenCalled()
    expect(reduced.querySelector('[data-live-series=static]')).not.toBeNull()
    expect(reduced.textContent).toContain('1000 milliseconds')
    expect(reduced.textContent).toContain('8.25 ms')
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const hidden = await mount(h(LiveSeriesView, { source, dark: false }))
    expect(hidden.textContent).toContain('页面当前不可见')
    expect(hidden.querySelector('table')).not.toBeNull()
  })

  it('uses an exact static table when animate is false and unmounts Liveline when its viewport leaves view', async () => {
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const stopped = await mount(h(LiveSeriesView, { source, dark: false, animate: false }))
    expect(upstream.liveline).not.toHaveBeenCalled()
    expect(stopped.textContent).toContain('动画已停用')
    const observer = installIntersectionObserver()
    const host = await mount(h(LiveSeriesView, { source, dark: false }))
    expect(upstream.liveline).not.toHaveBeenCalled()
    const target = host.querySelector('[data-live-series=static]')!
    await act(async () => { observer.callbacks[0]!([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(host.querySelector('[data-liveline]')).not.toBeNull()
    await act(async () => { observer.callbacks[0]!([{ target, isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(host.querySelector('[data-liveline]')).toBeNull()
    expect(upstream.livelineCleanup).toHaveBeenCalledOnce()
  })

  it('matches the pinned Liveline no-badge window filter with a source-derived cadence margin', async () => {
    const packagePath = nodeRequire.resolve('liveline/package.json')
    const archive = await readFile(join(dirname(packagePath), 'dist', 'index.js'), 'utf8')
    expect(archive).toContain('var WINDOW_BUFFER_NO_BADGE = 0.015;')
    expect(archive).toContain('p.time >= leftEdge - 2 && p.time <= filterRight')
    const complete = resolveLivelineWindow([{ time: 400 }, { time: 1_000 }], 1_000)
    expect(complete.kind).toBe('ready')
    if (complete.kind !== 'ready') throw Error('Expected complete source window.')
    const leftEdge = 1_000 + complete.windowSeconds * LIVELINE_NO_BADGE_WINDOW_BUFFER - complete.windowSeconds
    expect(complete.windowSeconds).toBeGreaterThan(1_200)
    expect(400).toBeGreaterThanOrEqual(leftEdge - LIVELINE_LEFT_EDGE_GRACE_SECONDS)
    expect(complete.expiresAtSeconds).toBeGreaterThan(1_600)
    expect(resolveLivelineWindow([{ time: 998 }, { time: 1_000.5 }], 1_000)).toMatchObject({ kind: 'static', reason: 'future-observation' })
    expect(resolveLivelineWindow([{ time: 900 }, { time: 997 }], 1_000)).toMatchObject({ kind: 'ready' })
    expect(resolveLivelineWindow([{ time: 0 }, { time: 600 }], 100_000)).toMatchObject({ kind: 'static', reason: 'current-window' })
    expect(resolveLivelineWindow([{ time: 0 }, { time: 200_000 }], 200_000)).toMatchObject({ kind: 'static', reason: 'outside-bounded-window' })
  })

  it('renders the exact source snapshot instead of mounting Liveline when the current window no longer contains two points', async () => {
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const host = await mount(h(LiveSeriesView, { source, dark: false }))
    expect(upstream.liveline).not.toHaveBeenCalled()
    expect(host.querySelector('[data-live-series=static]')).not.toBeNull()
    expect(host.textContent).toContain('当前时间窗口不再同时包含至少两条来源观测')
    expect(host.querySelector('table')?.textContent).toContain('1000 milliseconds')
  })

  it('uses one local expiry deadline for unchanged live props, then falls back without polling', async () => {
    vi.useFakeTimers(); vi.setSystemTime(2_000)
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const host = await mount(h(LiveSeriesView, { source, dark: false }))
    expect(host.querySelector('[data-live-series=live]')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(host.querySelector('[data-live-series=static]')).not.toBeNull()
    expect(host.querySelector('[data-liveline]')).toBeNull()
    expect(upstream.livelineCleanup).toHaveBeenCalledOnce()
    const mounts = upstream.liveline.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(upstream.liveline).toHaveBeenCalledTimes(mounts)
  })

  it('queues one immediate redraw when expiry passes between render and effect setup', async () => {
    vi.useFakeTimers()
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(Date, 'now').mockReturnValueOnce(2_000).mockReturnValue(5_000)
    const host = await mount(h(LiveSeriesView, { source, dark: false }))
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(host.querySelector('[data-live-series=static]')).not.toBeNull()
    expect(host.querySelector('[data-liveline]')).toBeNull()
  })

  it('replaces the one expiry timer on source change and clears it on unmount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(2_000)
    installMedia(false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    await mount(h(LiveSeriesView, { source, dark: false }))
    const root = roots.at(-1)!
    expect(vi.getTimerCount()).toBe(1)
    const changed = { ...source, points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.25 }] }
    await act(async () => { root.render(h(LiveSeriesView, { source: changed, dark: false })) })
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { root.unmount() })
    roots.splice(roots.indexOf(root), 1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('bounded adapters', () => {
  it('uses a static neutral Skullet box only for initial loading and keeps refresh/error content visible', async () => {
    const initial = await mount(h(AdaptiveLoading, { loading: true, label: '读取来源' }))
    expect(initial.querySelector('[data-adaptive-loading=initial]')).not.toBeNull()
    expect(upstream.skullet).toHaveBeenCalledOnce()
    const style = upstream.skullet.mock.calls[0]?.[0]?.style as Record<string, unknown>
    expect(style['--skullet-animation']).toBe('none')
    const refreshed = await mount(h(AdaptiveLoading, { loading: true, label: '刷新中' }, h('strong', null, '已确认的原值')))
    expect(refreshed.textContent).toContain('已确认的原值')
    expect(refreshed.textContent).toContain('刷新中')
    expect(upstream.skullet).toHaveBeenCalledOnce()
    const error = await mount(h(AdaptiveLoading, { loading: true, error: '来源连接失败' }, h('span', null, '最后确认值')))
    expect(error.querySelector('[role=alert]')?.textContent).toContain('来源连接失败')
    expect(error.textContent).toContain('最后确认值')
  })

  it('uses Torph only for a short eligible text and keeps reduced-motion or citation text plain', async () => {
    installMedia(false)
    const animated = await mount(h(AdaptiveText, { text: '7.50 ms' }))
    expect(animated.querySelector('[data-torph]')?.textContent).toBe('7.50 ms')
    expect(upstream.torph.mock.calls[0]?.[0]).toMatchObject({ numbers: true, respectReducedMotion: true })
    installMedia(true)
    const reduced = await mount(h(AdaptiveText, { text: '7.50 ms' }))
    expect(reduced.querySelector('[data-adaptive-text=plain]')?.textContent).toBe('7.50 ms')
    const citation = await mount(h(AdaptiveText, { text: '结论见[来源一](https://example.test)' }))
    expect(citation.querySelector('[data-adaptive-text=plain]')).not.toBeNull()
    installMedia(false)
    const disabled = await mount(h(AdaptiveText, { text: '7.50 ms', motion: false }))
    expect(disabled.querySelector('[data-adaptive-text=plain]')?.textContent).toBe('7.50 ms')
  })

  it('uses unmodified visx line and bar primitives while retaining source gaps and accessible metadata', async () => {
    const line: AutoChartPlan = {
      kind: 'line', labels: ['2020', '2021', '2030'], sourceRows: [0, 2, 3], omittedRowRanges: [[1, 2]],
      series: [{ name: '延迟', values: [8, 10, 9], unit: 'ms', originals: ['8.0 ms', '10.0 ms', '9.0 ms'] }],
      title: '真实延迟', reason: '来自原始探针。', icon: 'gauge',
    }
    const lineHost = await mount(h(HistoricalChart, { plan: line, palette: ['rgb(1, 2, 3)'] }))
    expect(lineHost.querySelector('[data-historical-chart=line]')).not.toBeNull()
    expect(lineHost.querySelectorAll('path.visx-linepath')).toHaveLength(2)
    expect(lineHost.querySelector('[role=img]')?.getAttribute('aria-label')).toContain('断开')
    expect(lineHost.textContent).toContain('完整原始数据由调用方保留')
    const xs = [...lineHost.querySelectorAll<SVGCircleElement>('circle')].map(circle => Number(circle.getAttribute('cx')))
    const positions = lineAbscissa(line)
    expect((xs[1]! - xs[0]!) / (xs[2]! - xs[1]!)).toBeCloseTo((positions[1]! - positions[0]!) / (positions[2]! - positions[1]!), 8)
    expect(xs[1]! - xs[0]!).toBeLessThan((xs[2]! - xs[1]!) / 5)
    const bar: AutoChartPlan = { ...line, kind: 'bar', omittedRowRanges: undefined, labels: ['A', 'B'], sourceRows: undefined, series: [{ name: '成本', values: [4, -2], unit: 'USD' }] }
    const barHost = await mount(h(HistoricalChart, { plan: bar, palette: ['rgb(1, 2, 3)'] }))
    expect(barHost.querySelectorAll('rect.visx-bar')).toHaveLength(2)
  })
})

describe('component provenance', () => {
  it('records all pinned package archives and their shipped notice assets', () => {
    expect(adaptiveComponentProvenance.map(entry => entry.id)).toEqual(['skullet', 'torph', 'liveline', 'visx'])
    expect(adaptiveComponentSource('visx').packages.map(pkg => pkg.version)).toEqual(['4.0.0', '4.0.0'])
    expect(adaptiveComponentSource('liveline').licenseAsset).toBe('lib/Liveline-MIT.txt')
  })
})
