// @vitest-environment jsdom
import { createElement as h, act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperChartDeck } from '../src/paper-chart-deck.js'
import type { AutoChartPlan } from '../src/content-analysis.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Values retained from an actual test-run report; they are single-run durations, not product performance claims.
const plans: AutoChartPlan[] = [
  { kind: 'bar', title: '前端测试耗时', basis: '本次运行 · 单次耗时', labels: ['client.test.ts', 'presentation.test.ts'], series: [{ name: '耗时', values: [28.801025390625, 471.93701171875], originals: ['28.801025390625 ms', '471.93701171875 ms'], unit: 'ms' }], reason: '按本次测试输出展示。包含刻意等待，不可作为产品性能基准。', notes: ['包含刻意等待。'], icon: 'gauge' },
  { kind: 'bar', title: '数据测试耗时', basis: '本次运行 · 单次耗时', labels: ['registry.test.ts', 'store.test.ts'], series: [{ name: '耗时', values: [7.158447265625, 26.45849609375], originals: ['7.158447265625 ms', '26.45849609375 ms'], unit: 'ms' }], reason: '原始文件顺序与原值保留。', icon: 'gauge' },
]
describe('Paper chart stage', () => {
  let host: HTMLDivElement, root: Root, reduced: boolean, background: boolean
  let motionListeners: Set<() => void>
  let mounted: ReturnType<typeof vi.fn>, unmounted: ReturnType<typeof vi.fn>
  function Chart({ plan }: { plan: AutoChartPlan }) {
    const [localState, setLocalState] = useState(0)
    useEffect(() => { mounted(plan); return () => { unmounted(plan) } }, [])
    return h('article', null, h('p', null, plan.reason), ...(plan.notes ?? []).map(note => h('p', { key: note }, note)), h('button', { onClick: () => setLocalState(localState + 1) }, `${plan.title} local state ${localState}`))
  }
  const selectedTab = () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!
  const visiblePanel = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter(panel => !panel.hidden)
  const playback = () => host.querySelector<HTMLButtonElement>('[data-paper-playback]')!
  async function render(value = plans) { await act(async () => root.render(h(PaperChartDeck, { plans: value, Chart }))) }
  beforeEach(() => {
    vi.useFakeTimers(); reduced = false; background = false; motionListeners = new Set(); mounted = vi.fn(); unmounted = vi.fn()
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => background)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return reduced }, media: '(prefers-reduced-motion: reduce)', addEventListener: (_type: string, listener: () => void) => motionListeners.add(listener), removeEventListener: (_type: string, listener: () => void) => motionListeners.delete(listener) })))
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shows one original plan, keeps other charts mounted, and preserves local state through a real tab roundtrip', async () => {
    await render()
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(visiblePanel()).toHaveLength(1)
    expect(host.querySelector('.iexp-paper-chart-scale-note')?.textContent).toContain('各图独立刻度')
    expect(selectedTab().textContent).toContain('前端测试耗时')
    expect(selectedTab().textContent).toContain('本次运行 · 单次耗时')
    expect(selectedTab().textContent).toContain('ms')
    expect(mounted.mock.calls.map(call => call[0])).toEqual(plans)
    const firstChartButton = visiblePanel()[0]!.querySelector('button')!
    await act(async () => firstChartButton.click())
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click())
    expect(visiblePanel()).toHaveLength(1); expect(visiblePanel()[0]!.textContent).toContain('数据测试耗时')
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!.click())
    expect(firstChartButton.textContent).toContain('local state 1')
    expect(mounted).toHaveBeenCalledTimes(2); expect(unmounted).not.toHaveBeenCalled()
    const table = host.querySelector('.iexp-paper-chart-data table')!
    expect(table.textContent).toContain('28.801025390625 ms'); expect(table.textContent).toContain('471.93701171875 ms')
    expect(host.querySelector('.iexp-paper-chart-data details')).toBeNull()
    expect(host.textContent).toContain('包含刻意等待，不可作为产品性能基准')
  })
  it('supports ArrowRight/ArrowLeft, Home and End with roving focus and linked accessible panels', async () => {
    await render()
    const key = async (value: string) => { await act(async () => selectedTab().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))) }
    await key('End'); expect(selectedTab().textContent).toContain('数据测试耗时'); expect(document.activeElement).toBe(selectedTab())
    await key('ArrowRight'); expect(selectedTab().textContent).toContain('前端测试耗时')
    await key('ArrowLeft'); expect(selectedTab().textContent).toContain('数据测试耗时')
    await key('Home'); expect(selectedTab().textContent).toContain('前端测试耗时')
    expect(selectedTab().tabIndex).toBe(0)
    expect(host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.tabIndex).toBe(-1)
    expect(document.getElementById(selectedTab().getAttribute('aria-controls')!)).toBe(visiblePanel()[0])
    expect(visiblePanel()[0]!.getAttribute('aria-labelledby')).toBe(selectedTab().id)
  })
  it('starts paused, cycles only after an explicit play action, and stops on manual selection', async () => {
    await render()
    await act(async () => vi.advanceTimersByTime(10_000)); expect(selectedTab().textContent).toContain('前端测试耗时')
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => playback().click())
    expect(playback().getAttribute('aria-pressed')).toBe('true')
    await act(async () => vi.advanceTimersByTime(4999)); expect(selectedTab().textContent).toContain('前端测试耗时')
    await act(async () => vi.advanceTimersByTime(1)); expect(selectedTab().textContent).toContain('数据测试耗时')
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]!.click())
    expect(playback().getAttribute('aria-pressed')).toBe('false'); expect(vi.getTimerCount()).toBe(0)
    await act(async () => vi.advanceTimersByTime(10_000)); expect(selectedTab().textContent).toContain('前端测试耗时')
  })
  it('pauses the clock in background and stops a running demonstration when reduced motion becomes active', async () => {
    await render(); await act(async () => playback().click())
    background = true; await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => vi.advanceTimersByTime(15_000)); expect(selectedTab().textContent).toContain('前端测试耗时')
    background = false; await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => vi.advanceTimersByTime(5000)); expect(selectedTab().textContent).toContain('数据测试耗时')
    reduced = true; await act(async () => { for (const listener of motionListeners) listener() })
    expect(playback().disabled).toBe(true); expect(playback().getAttribute('aria-pressed')).toBe('false'); expect(vi.getTimerCount()).toBe(0)
    reduced = false; await act(async () => { for (const listener of motionListeners) listener() })
    expect(playback().disabled).toBe(false); expect(vi.getTimerCount()).toBe(0)
  })
  it('never permits autoplay while the system already requests reduced motion and cleans subscriptions on unmount', async () => {
    reduced = true; await render()
    expect(playback().disabled).toBe(true); expect(vi.getTimerCount()).toBe(0)
    expect(host.textContent).toContain('演示切换已停用')
    await act(async () => root.render(null))
    expect(motionListeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(unmounted).toHaveBeenCalledTimes(2)
  })
  it('clears a running timer on unmount and stops automatic switching when the chart receives user input', async () => {
    await render(); await act(async () => playback().click())
    await act(async () => visiblePanel()[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(playback().getAttribute('aria-pressed')).toBe('false'); expect(vi.getTimerCount()).toBe(0)
    await act(async () => playback().click())
    await act(async () => visiblePanel()[0]!.querySelector('button')!.click()) // Assistive activation can emit click without pointerdown.
    expect(playback().getAttribute('aria-pressed')).toBe('false'); expect(vi.getTimerCount()).toBe(0)
    await act(async () => playback().click()); expect(vi.getTimerCount()).toBe(1)
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0); expect(motionListeners.size).toBe(0)
  })
  it('retains selection for an equal polling refresh but resets to the first valid plan when actual input changes', async () => {
    await render(); await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click())
    await render(structuredClone(plans)); expect(selectedTab().textContent).toContain('数据测试耗时')
    await act(async () => playback().click())
    const changed = structuredClone(plans); changed[0]!.series[0]!.values[0] = 29
    await render(changed); expect(selectedTab().textContent).toContain('前端测试耗时'); expect(playback().getAttribute('aria-pressed')).toBe('false'); expect(vi.getTimerCount()).toBe(0)
    await render([plans[1]!]); expect(host.querySelector('[role="tablist"]')).toBeNull(); expect(host.querySelector('[data-paper-playback]')).toBeNull(); expect(visiblePanel()).toHaveLength(1)
    expect(visiblePanel()[0]!.textContent).toContain('数据测试耗时')
    await render([]); expect(host.textContent).toBe('')
  })
})
