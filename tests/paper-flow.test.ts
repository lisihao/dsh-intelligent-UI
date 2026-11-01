// @vitest-environment jsdom
import { createElement as h, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentView, OutputView, displayModes } from '../src/presentation.js'
import { themePreferences } from '../src/theme-runtime.js'
import { themePackageSchema } from '../src/theme-contracts.js'
import paper from '../theme/paper-flow.dsh-theme.json' with { type: 'json' }
import { continuousCss } from '../src/continuous-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const text = `# 原报告\n\n保留[跨章来源][source]与脚注[^basis]。\n\n## 费用构成\n\n单位：亿元，2025 全年。以下含原文近似值。\n\n| 项目 | 费用（亿元） |\n| --- | ---: |\n| 训练 | 约18.75 |\n| 推理 | 21.50 |\n\n## 验证时长\n\n另一份独立口径。\n\n| 文件 | 耗时（ms） |\n| --- | ---: |\n| a.ts | 14.625 |\n| b.ts | 31.125 |\n\n## 说明\n\n不可把费用与耗时相加。\n\n[source]: https://example.org/source\n[^basis]: 原文未审计，须保留全部说明。\n`
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  themePreferences.set({ activeId: paper.id, installed: [themePackageSchema.parse(paper)] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); themePreferences.reset(); displayModes.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Paper continuous presentation', () => {
  it('keeps full-document references, footnotes, exact cells and original heading order while composing chapters', async () => {
    await act(async () => root.render(h(ContentView, { value: text })))
    expect(host.querySelectorAll('.iexp-story-section')).toHaveLength(3)
    expect([...host.querySelectorAll('.iexp-story-section')].map(e => e.getAttribute('data-story-layout'))).toEqual(['feature', 'split', 'text'])
    expect([...host.querySelectorAll('.iexp-story-section h2')].map(e => e.textContent)).toEqual(['费用构成', '验证时长', '说明'])
    expect(host.querySelector('a[href="https://example.org/source"]')).toBeTruthy()
    expect(host.querySelector('[data-footnotes]')?.textContent).toContain('原文未审计')
    expect(host.querySelectorAll('[data-auto-chart]')).toHaveLength(2)
    const tables = [...host.querySelectorAll('[aria-label="原始数据表格"] table')].map(e => e.textContent)
    expect(tables[0]).toContain('约18.75'); expect(tables[1]).toContain('14.625')
    expect(host.textContent).toContain('2025 全年')
    const anchors = [...host.querySelectorAll('.iexp-heading-index a[href]')].map(e => e.getAttribute('href')!.slice(1))
    for (const id of anchors) expect(host.querySelector(`[id="${id}"]`)).toBeTruthy()
  })
  it('pairs each subtopic with its own visual inside a long chapter without changing heading order', async () => {
    const source = '# Report\n\n## One\n\n### A\n\n| File | Cost (USD) |\n| --- | ---: |\n| x | 12 |\n| y | 18 |\n\n### B\n\nShort explanation.\n\n| File | Time (ms) |\n| --- | ---: |\n| x | 4 |\n| y | 9 |\n\n## Two\n\nEnd.'
    await act(async () => root.render(h(ContentView, { value: source })))
    expect(host.querySelector('.iexp-story-section')?.getAttribute('data-story-layout')).toBe('chapter')
    expect([...host.querySelectorAll('.iexp-story-panel')].map(e => e.getAttribute('data-story-layout'))).toEqual(['text', 'feature', 'split'])
    expect([...host.querySelectorAll('h2,h3')].map(e => e.textContent)).toEqual(['One', 'A', 'B', 'Two'])
    expect(host.querySelectorAll('[data-auto-chart]')).toHaveLength(2)
  })

  it('retains open original data and DOM identity across an equal refresh and unified raw/visual toggles', async () => {
    const render = () => h(OutputView, { sessionId: 'paper', raw: text }, h(ContentView, { value: text }))
    await act(async () => root.render(render()))
    const detail = host.querySelector('.iexp-full-table') as HTMLDetailsElement
    await act(async () => (detail.querySelector('summary') as HTMLElement).click())
    expect(detail.open).toBe(true)
    await act(async () => root.render(render()))
    expect(host.querySelector('.iexp-full-table')).toBe(detail)
    await act(async () => displayModes.set('paper', 'raw'))
    expect(host.querySelector('.iexp-raw-output pre')?.textContent).toBe(text)
    await act(async () => displayModes.set('paper', 'visual'))
    expect(host.querySelector('.iexp-full-table')).toBe(detail); expect(detail.open).toBe(true)
  })
  it('leaves old themes and streaming replies in document mode, then composes only the finished rich reply', async () => {
    await act(async () => root.render(h(ContentView, { value: text, isStreaming: true })))
    expect(host.querySelector('.iexp-continuous')).toBeNull()
    expect(host.querySelector('[data-auto-chart]')).toBeNull()
    await act(async () => root.render(h(ContentView, { value: text })))
    expect(host.querySelector('.iexp-continuous')).toBeTruthy()
    await act(async () => themePreferences.reset())
    expect(host.querySelector('.iexp-continuous')).toBeNull()
    expect(host.querySelectorAll('[data-auto-chart]')).toHaveLength(2)
  })
  it('does not split short prose or animate/hide text as a loading effect', async () => {
    await act(async () => root.render(h(ContentView, { value: '## 回答\n\n这是原文。' })))
    expect(host.querySelector('.iexp-continuous')).toBeNull()
    expect(host.textContent).toContain('这是原文。')
    expect(continuousCss).toContain('prefers-reduced-motion:reduce')
    expect(continuousCss).toContain('animation:none; display:none')
    expect(continuousCss).not.toContain('opacity:0')
    expect(continuousCss).toContain('@container iexp-story (min-width:920px)')
  })
})
