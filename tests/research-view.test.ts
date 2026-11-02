// @vitest-environment jsdom
import { createElement as h, act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { themePreferences } from '../src/theme-runtime.js'
import { ResearchWorkspace, ResearchModeControl, researchModes } from '../src/research-view.js'
import type { ResearchApi, ResearchState } from '../src/research-contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const text = '# 技术评估\n\n仅在相同负载下可比。\n\n[测试说明](https://example.com/report)\n\n| 方法 | 耗时 |\n| --- | --- |\n| 甲 | 12 秒 |\n| 乙 | 8 秒 |'
const quote = '仅在相同负载下可比。', start = text.indexOf(quote)
function state(analysis = false): ResearchState { return { formatVersion: 1, revision: 0, reportHash: 'a'.repeat(64), notes: {}, reviews: {}, questions: [], ...(analysis ? { analysis: { formatVersion: 1, reportHash: 'a'.repeat(64), question: '哪些方法可比？', claims: [{ id: 'claim1', text: '比较需要相同负载', kind: 'inference', anchor: { start, end: start + quote.length, quote }, conditions: ['相同负载'], evidence: [{ id: 'ev1', relation: 'limitation', anchor: { start, end: start + quote.length, quote }, note: '负载不同不能直接比较' }], openQuestions: ['负载是否一致？'] }] } } : {}) } }
function api(initial = state()): ResearchApi {
  return { get: vi.fn(async () => initial), prepare: vi.fn(async () => ({ state: { ...initial, revision: 1, request: { id: 'request', status: 'prepared' as const, createdAt: '2026-11-01T00:00:00Z' } }, requestId: 'request', prompt: '整理当前报告' })), markSubmission: vi.fn(async input => ({ ...initial, revision: 2, request: { id: 'request', status: input.status, createdAt: '2026-11-01T00:00:00Z' } })), saveNotes: vi.fn(async input => ({ ...initial, revision: 1, notes: input.notes, reviews: input.reviews, questions: input.questions })) }
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); researchModes.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount(props: Partial<Parameters<typeof ResearchWorkspace>[0]> = {}, enabled = true) {
  researchModes.set('session', enabled)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const base = { sessionId: 'session', documentId: 'doc', text, children: h('details', { open: true, 'data-original': true }, h('summary', null, '原报告'), quote), ...props }
  await act(async () => root.render(h(ResearchWorkspace, base)))
  cleanup.push(async () => { await act(async () => root.unmount()); host.remove() })
  return { host, root, base }
}
function button(host: HTMLElement, label: string) { const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label); if (!match) throw new Error(`No button: ${label}`); return match }
async function click(host: HTMLElement, label: string) { await act(async () => button(host, label).click()) }
async function change(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
  await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })))
}

describe('research workspace', () => {
  it('keeps report children mounted across activation, tabs and deactivation', async () => {
    const unmounted = vi.fn()
    function Report() { useEffect(() => () => unmounted(), []); return h('details', { open: true, 'data-original': true }, h('summary', null, '原报告'), '报告正文') }
    const { host } = await mount({ children: h(Report) }, false)
    const original = host.querySelector('[data-original]'); (original as HTMLElement).scrollTop = 32
    await act(async () => researchModes.set('session', true)); await click(host, '来源'); await click(host, '报告'); await act(async () => researchModes.set('session', false))
    expect(host.querySelector('[data-original]')).toBe(original); expect((original as HTMLElement).scrollTop).toBe(32); expect(unmounted).not.toHaveBeenCalled()
  })
  it('does not prepare or dispatch before explicit confirmation', async () => {
    const remote = api(), onOrganize = vi.fn(async () => {})
    const { host } = await mount({ api: remote, onOrganize })
    expect(remote.prepare).not.toHaveBeenCalled(); expect(onOrganize).not.toHaveBeenCalled()
    await click(host, 'AI 整理'); expect(host.textContent).toContain('可能产生模型费用'); expect(remote.prepare).not.toHaveBeenCalled()
    await click(host, '取消整理'); expect(onOrganize).not.toHaveBeenCalled()
    await click(host, 'AI 整理'); await click(host, '开始整理')
    expect(remote.prepare).toHaveBeenCalledOnce(); expect(onOrganize).toHaveBeenCalledWith('整理当前报告', expect.any(AbortSignal)); expect(remote.markSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }))
  })
  it('shows a useful fallback and disables AI when the current model interface is missing', async () => {
    const { host } = await mount()
    await click(host, '判断'); expect(host.textContent).toContain('尚未整理判断'); expect(button(host, 'AI 整理').disabled).toBe(true)
    expect(host.textContent).toContain('当前会话未提供模型提交接口')
  })
  it('inspects exact source snippets and restores focus after Escape in narrow content', async () => {
    const { host } = await mount()
    await click(host, '来源'); const opener = button(host, '测试说明'); opener.focus(); await act(async () => opener.click())
    const dialog = host.querySelector('[role=dialog]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(document.activeElement).toBe(dialog)
    expect(dialog.querySelector('blockquote')?.textContent).toBe('[测试说明](https://example.com/report)')
    expect(dialog.textContent).toContain('报告内引用，外部原文未核查')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(opener)
  })
  it('keeps table units and context and cross-links table cells to the exact report', async () => {
    const { host } = await mount()
    await click(host, '技术比较'); expect(host.querySelectorAll('.iexp-research-table tbody tr')).toHaveLength(2)
    await click(host, '12 秒'); expect(host.querySelector('blockquote')?.textContent).toBe('12 秒')
    expect(host.textContent).toContain('仅在相同负载下可比。')
  })
  it('preserves ordinary prose without inventing sources, tables or judgments', async () => {
    const { host } = await mount({ text: '一段普通文字，没有引用或比较数据。' })
    await click(host, '来源'); expect(host.textContent).toContain('未包含可识别的链接或脚注')
    await click(host, '技术比较'); expect(host.textContent).toContain('没有可识别的 Markdown 表格')
    expect(host.querySelector('table')).toBeNull()
  })
  it('labels AI relationships as awaiting review and creates editable copy-only followups', async () => {
    const remote = api(state(true)), onOrganize = vi.fn(async () => {}), writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { host } = await mount({ api: remote, onOrganize })
    await click(host, '判断'); expect(host.textContent).toContain('AI 关联，待复核')
    const followup = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '拟定追问草稿')!
    await act(async () => followup.click())
    const field = host.querySelector('.iexp-research-draft textarea') as HTMLTextAreaElement
    expect(field.value).toContain('比较需要相同负载')
    await change(field, '请核查负载条件，并保留来源。'); await click(host, '复制草稿')
    expect(writeText).toHaveBeenCalledWith('请核查负载条件，并保留来源。'); expect(host.textContent).toContain('草稿已复制')
    expect(onOrganize).not.toHaveBeenCalled(); expect(remote.prepare).not.toHaveBeenCalled()
  })
  it('retains unsaved notes on CAS failure and exposes the actual error', async () => {
    const remote = api(state(true)); remote.saveNotes = vi.fn(async () => { throw new Error('RESEARCH_REVISION_CONFLICT') })
    const { host } = await mount({ api: remote })
    await click(host, '判断'); const field = host.querySelector('.iexp-research-claim textarea') as HTMLTextAreaElement
    await change(field, '我的核查备注'); await click(host, '保存研究记录')
    expect(field.value).toBe('我的核查备注'); expect(host.querySelector('[role=alert]')?.textContent).toContain('研究记录已更新，请重新打开工作区后再次保存')
    expect(host.textContent).toContain('有未保存的修改')
  })
  it('reports uncertain dispatch without retrying and aborts the callback on unmount', async () => {
    const remote = api(), onOrganize = vi.fn(async () => { throw new Error('网络中断') })
    const { host } = await mount({ api: remote, onOrganize })
    await click(host, 'AI 整理'); await click(host, '开始整理')
    expect(remote.markSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown', error: '网络中断' }))
    expect(host.querySelector('[role=alert]')?.textContent).toContain('不会自动重试'); expect(onOrganize).toHaveBeenCalledOnce(); expect(button(host, 'AI 整理').disabled).toBe(true)
  })
  it('polls only pending requests and cleans up scheduled polls on unmount', async () => {
    vi.useFakeTimers(); const initial = state(); initial.request = { id: 'request', status: 'queued', createdAt: '2026-11-01T00:00:00Z' }
    const remote = api(initial), { root } = await mount({ api: remote })
    expect(remote.get).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1500)); expect(remote.get).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount()); await act(async () => vi.advanceTimersByTimeAsync(6000)); expect(remote.get).toHaveBeenCalledTimes(2)
  })
  it('uses content width rather than viewport width to select the inline inspector', async () => {
    let notify: ResizeObserverCallback | undefined
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { notify = callback } observe() {} disconnect() {} })
    const { host } = await mount(); await act(async () => notify?.([{ contentRect: { width: 1200 } } as ResizeObserverEntry], {} as ResizeObserver))
    await click(host, '来源'); await click(host, '测试说明')
    expect(host.querySelector('[role=complementary]')).not.toBeNull(); expect(host.querySelector('[role=dialog]')).toBeNull()
    vi.unstubAllGlobals()
  })
  it('aborts an in-flight callback on unmount and marks the outcome unknown', async () => {
    const remote = api(); let signal: AbortSignal | undefined
    const onOrganize = vi.fn((_prompt: string, input: AbortSignal) => new Promise<void>((_resolve, reject) => { signal = input; input.addEventListener('abort', () => reject(new Error('会话界面已关闭')), { once: true }) }))
    const { host, root } = await mount({ api: remote, onOrganize })
    await click(host, 'AI 整理'); await click(host, '开始整理'); expect(signal?.aborted).toBe(false)
    await act(async () => root.unmount()); expect(signal?.aborted).toBe(true)
    expect(remote.markSubmission).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }))
  })
  it('retains newer edits made while an earlier note save is in flight', async () => {
    const initial = state(true), remote = api(initial); let resolve: ((value: ResearchState) => void) | undefined
    remote.saveNotes = vi.fn(() => new Promise<ResearchState>(done => { resolve = done }))
    const { host } = await mount({ api: remote }); await click(host, '判断')
    const field = host.querySelector('.iexp-research-claim textarea') as HTMLTextAreaElement
    await change(field, '第一次备注'); await click(host, '保存研究记录'); await change(field, '继续补充的备注')
    await act(async () => resolve?.({ ...initial, revision: 1, notes: { claim1: '第一次备注' } }))
    expect(field.value).toBe('继续补充的备注'); expect(button(host, '保存研究记录').disabled).toBe(false)
    expect(host.textContent).toContain('仍有新的修改')
  })
  it('keeps AI disabled while the report is streaming', async () => {
    const remote = api(), onOrganize = vi.fn(async () => {})
    const { host } = await mount({ api: remote, onOrganize, isStreaming: true })
    expect(button(host, 'AI 整理').disabled).toBe(true); expect(remote.get).not.toHaveBeenCalled(); expect(onOrganize).not.toHaveBeenCalled()
  })
  it('opens exact report citations on primary click while preserving modified link clicks', async () => {
    const { host } = await mount({ children: h('p', null, h('a', { href: 'https://example.com/report' }, '测试说明')) })
    const link = host.querySelector<HTMLAnchorElement>('.iexp-research-report a')!
    const primary = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    await act(async () => link.dispatchEvent(primary))
    expect(primary.defaultPrevented).toBe(true); expect(host.querySelector('[role=dialog] blockquote')?.textContent).toBe('[测试说明](https://example.com/report)')
    await click(host, '关闭')
    const modifiedResults: boolean[] = []
    link.addEventListener('click', event => { modifiedResults.push(event.defaultPrevented); event.preventDefault() })
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      await act(async () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifier })))
      expect(host.querySelector('[role=dialog]')).toBeNull()
    }
    expect(modifiedResults).toEqual([false, false, false, false])
  })
  it('chooses the exact repeated citation within its rendered source block', async () => {
    const report = '[第一处](https://example.com/report)\n\n[第二处](https://example.com/report)', second = report.indexOf('[第二处]')
    const { host } = await mount({ text: report, children: h('div', null, h('p', { 'data-iexp-source-start': 0, 'data-iexp-source-end': second - 2 }, h('a', { href: 'https://example.com/report' }, '第一处')), h('p', { 'data-iexp-source-start': second, 'data-iexp-source-end': report.length }, h('a', { href: 'https://example.com/report' }, '第二处'))) })
    await act(async () => host.querySelectorAll<HTMLAnchorElement>('.iexp-research-report a')[1]!.click())
    expect(host.querySelector('[role=dialog] blockquote')?.textContent).toBe('[第二处](https://example.com/report)')
  })
  it('returns from evidence to the smallest containing report block with focus and temporary highlight', async () => {
    vi.useFakeTimers()
    const remote = api(state(true)), { host } = await mount({ api: remote, children: h('article', { 'data-iexp-source-start': 0, 'data-iexp-source-end': text.length }, h('p', { 'data-iexp-source-start': start, 'data-iexp-source-end': start + quote.length }, quote)) })
    const source = host.querySelector<HTMLElement>('.iexp-research-report p[data-iexp-source-start]')!, scroll = vi.fn(); source.scrollIntoView = scroll
    await click(host, '判断'); await click(host, '限制片段'); await click(host, '定位报告片段')
    await act(async () => vi.advanceTimersByTimeAsync(32))
    expect(host.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('报告')
    expect(host.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement).toBe(source)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }); expect(source.dataset.iexpResearchHighlight).toBe('true')
    expect(host.querySelector('.iexp-research-report article')?.getAttribute('data-iexp-research-highlight')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(1800)); expect(source.dataset.iexpResearchHighlight).toBeUndefined(); expect(source.hasAttribute('tabindex')).toBe(false)
    expect(researchModes.get('session')).toBe(true)
  })
  it('opens only target ancestor disclosures inside the report before locating a raw table cell', async () => {
    vi.useFakeTimers()
    const outer = document.createElement('details'); document.body.append(outer)
    try {
      const { host } = await mount({ api: api(state(true)), children: h('div', null,
        h('details', { className: 'iexp-full-table', 'data-target-disclosure': true }, h('summary', null, '完整原表'), h('details', { 'data-inner-disclosure': true }, h('summary', null, '单元格上下文'), h('span', { 'data-iexp-source-start': start, 'data-iexp-source-end': start + quote.length }, quote))),
        h('details', { 'data-unrelated-disclosure': true }, h('summary', null, '其他原表'), '保持折叠')) })
      outer.append(host)
      const source = host.querySelector<HTMLElement>('span[data-iexp-source-start]')!, scroll = vi.fn(() => {
        expect(host.querySelector<HTMLDetailsElement>('[data-target-disclosure]')?.open).toBe(true)
        expect(host.querySelector<HTMLDetailsElement>('[data-inner-disclosure]')?.open).toBe(true)
      }); source.scrollIntoView = scroll
      await click(host, '判断'); await click(host, '定位判断原文'); await click(host, '定位报告片段'); await act(async () => vi.advanceTimersByTimeAsync(32))
      expect(scroll).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(source)
      expect(host.querySelector<HTMLDetailsElement>('[data-unrelated-disclosure]')?.open).toBe(false); expect(outer.open).toBe(false)
    } finally { outer.remove() }
  })
  it('shows a named source-navigation limitation and snapshot instead of searching outside its report', async () => {
    vi.useFakeTimers(); const foreign = document.createElement('p'); foreign.dataset.iexpSourceStart = String(start); foreign.dataset.iexpSourceEnd = String(start + quote.length); foreign.scrollIntoView = vi.fn(); document.body.append(foreign)
    try {
      const { host } = await mount({ api: api(state(true)), children: h('p', null, quote) })
      await click(host, '判断'); await click(host, '定位判断原文'); await click(host, '定位报告片段'); await act(async () => vi.advanceTimersByTimeAsync(32))
      expect(host.querySelector('.iexp-research-location')?.textContent).toContain('报告片段不可定位')
      expect(host.querySelector('.iexp-research-location blockquote')?.textContent).toBe(quote); expect(foreign.scrollIntoView).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(host.querySelector('.iexp-research-report'))
    } finally { foreign.remove() }
  })
  it('permits an explicit confirmed retry only after a failed request', async () => {
    const initial = state(); initial.request = { id: 'old-request', status: 'failed', createdAt: '2026-11-01T00:00:00Z' }
    const remote = api(initial), onOrganize = vi.fn(async () => {}), { host } = await mount({ api: remote, onOrganize })
    expect(button(host, 'AI 整理').disabled).toBe(false); expect(remote.prepare).not.toHaveBeenCalled()
    await click(host, 'AI 整理'); expect(remote.prepare).not.toHaveBeenCalled(); await click(host, '开始整理')
    expect(remote.prepare).toHaveBeenCalledOnce(); expect(onOrganize).toHaveBeenCalledOnce()
  })
  it('uses source-backed contextual controls for the default v1 content theme', async () => {
    themePreferences.reset(); expect(themePreferences.getSnapshot().formatVersion).toBe(1)
    const { host } = await mount({ api: api(state(true)) })
    const tab = button(host, '判断'), input = host.querySelector<HTMLInputElement>('input[id]')!
    for (const control of [tab, input]) {
      expect(control.dataset.iexpComponentMode).toBe('contextual'); expect(control.dataset.iexpUiverseRole).toBe('content')
      expect(control.dataset.iexpComponentSet).toBe('soft-relief'); expect(control.dataset.iexpUiverseSource).toBeTruthy()
    }
    expect(tab.classList.contains('iexp-uiv-button')).toBe(true)
  })
  it('wraps exact condition text into a strip and keeps human notes collapsed and mounted', async () => {
    const initial = state(true); initial.analysis!.claims[0]!.conditions = ['相同负载', '相同硬件与精度', '报告中的完整限定条件不截断']
    const { host } = await mount({ api: api(initial) }); await click(host, '判断')
    expect([...host.querySelectorAll('.iexp-research-conditions > li')].map(item => item.textContent)).toEqual(initial.analysis!.claims[0]!.conditions)
    const disclosure = host.querySelector<HTMLDetailsElement>('.iexp-research-note')!, field = disclosure.querySelector('textarea')!
    expect(disclosure.open).toBe(false); expect(field).not.toBeNull()
    await act(async () => disclosure.querySelector('summary')!.click()); expect(disclosure.open).toBe(true)
    await change(field, '我保留的核查备注'); await click(host, '来源'); await click(host, '判断')
    expect(host.querySelector('.iexp-research-note textarea')).toBe(field); expect(field.value).toBe('我保留的核查备注'); expect(disclosure.open).toBe(true)
    expect(disclosure.querySelector('summary')?.textContent).toContain('已填写')
  })
  it('expands a raw table below a tagged table group and focuses the visible original instead of the chart', async () => {
    vi.useFakeTimers()
    const { host } = await mount({ api: api(state(true)), children: h('div', { className: 'iexp-table-group', 'data-iexp-source-start': 0, 'data-iexp-source-end': text.length }, h('figure', null, '补充图表'), h('details', { className: 'iexp-full-table' }, h('summary', null, '完整原表'), h('div', { className: 'iexp-source-table', tabIndex: 0 }, h('table', null, h('tbody', null, h('tr', null, h('td', null, quote))))))) })
    const disclosure = host.querySelector<HTMLDetailsElement>('.iexp-full-table')!, source = host.querySelector<HTMLElement>('.iexp-source-table')!, scroll = vi.fn(() => expect(disclosure.open).toBe(true)); source.scrollIntoView = scroll
    await click(host, '判断'); await click(host, '定位判断原文'); await click(host, '定位报告片段'); await act(async () => vi.advanceTimersByTimeAsync(32))
    expect(disclosure.open).toBe(true); expect(scroll).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(source)
    expect(source.dataset.iexpResearchHighlight).toBe('true'); expect(host.querySelector('.iexp-table-group')?.getAttribute('data-iexp-research-highlight')).toBeNull()
    expect(host.querySelector('.iexp-research-location')?.textContent).toContain('尚未定位到单独行')
    await act(async () => vi.advanceTimersByTimeAsync(1800)); expect(source.getAttribute('tabindex')).toBe('0')
  })
  it('includes native summary in both ends of the inspector focus cycle', async () => {
    const { host } = await mount(); await click(host, '来源'); await click(host, '测试说明')
    const dialog = host.querySelector<HTMLElement>('[role=dialog]')!, first = dialog.querySelector<HTMLButtonElement>('button')!, summary = dialog.querySelector<HTMLElement>('summary')!
    first.focus(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement).toBe(summary)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(first)
  })
  it('keeps chart title, units, explicit comparison conditions and original approximation notes', async () => {
    const report = '# 耗时比较\n\n| 方法 | 耗时（秒） | 硬件 |\n| --- | --- | --- |\n| 甲 | 约 12 秒 | 同一台 |\n| 乙 | 8 秒 | 同一台 |\n| 丙 | 6 秒 | 另一台 |'
    const { host } = await mount({ text: report }); await click(host, '技术比较')
    const chart = host.querySelector<HTMLElement>('[data-auto-chart]')!
    expect(chart).not.toBeNull(); expect(chart.querySelector('.iexp-card-head')?.textContent).toContain('耗时（秒）')
    expect(chart.querySelector('.iexp-card-basis')?.textContent).toContain('单位：s'); expect(chart.textContent).toContain('硬件=同一台')
    expect(chart.querySelector('.iexp-card-foot')?.textContent).toContain('近似'); expect(chart.textContent).toContain('约 12 秒')
    expect(host.querySelectorAll('.iexp-research-table tbody tr')).toHaveLength(3)
    expect(chart.closest('.iexp-content')).toBe(host.querySelector('.iexp-research-compare'))
  })
  it('retains maintained complex charts when a source table exceeds the compact comparison limit', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (value: string) => ({ width: value.length * 7 }) } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const report = '| 方法 | 耗时（秒） |\n| --- | --- |\n' + Array.from({ length: 7 }, (_, index) => `| 方法${index + 1} | ${index + 1} 秒 |`).join('\n')
    const { host } = await mount({ text: report }); await click(host, '技术比较')
    expect(host.querySelector('[data-auto-chart=bar]')).not.toBeNull(); expect(host.querySelectorAll('.iexp-research-table tbody tr')).toHaveLength(7)
  })
  it('exports an accessible per-session enable control', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    try { await act(async () => root.render(h(ResearchModeControl, { sessionId: 'another' }))); const control = host.querySelector('input')!; expect(control.getAttribute('aria-label')).toBe('研究工作区'); await act(async () => control.click()); expect(researchModes.get('another')).toBe(true); expect(researchModes.get('session')).toBe(false) }
    finally { await act(async () => root.unmount()) }
  })
})
