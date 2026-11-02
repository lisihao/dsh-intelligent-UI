// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentView } from '../src/presentation.js'
import { themePreferences } from '../src/theme-runtime.js'
import { builtInThemes, resolveTheme } from '../src/theme-contracts.js'
import { ThemeButton, themeComponentSet } from '../src/theme-components.js'
import { resolveUiverseAdapter } from '../src/uiverse-render.js'
import { themeComponentsCss } from '../src/theme-components-style.js'
import sources from '../src/uiverse-sources.json' with { type: 'json' }

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; element: HTMLDivElement }> = []
const tasks = [
  { title: '核对 23.80 亿元原文', status: '等待外部', description: '保持原有单位与口径。' },
  { title: '保存完整来源', status: '待处理', description: '不要改写任务数据。' },
  { title: '复查 97.41 亿元回执', status: '等待外部', description: '保持来源顺序。' },
]
beforeEach(() => {
  themePreferences.reset()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  for (const { root, element } of mounted.splice(0)) { await act(async () => root.unmount()); element.remove() }
  themePreferences.reset(); vi.unstubAllGlobals()
})
async function mount(value: unknown) {
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element); mounted.push({ root, element })
  await act(async () => root.render(h(ContentView, { value })))
  return element
}
async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
function sourceMatches(element: Element, set: 'soft-relief' | 'clear-glass' | 'mechanical-outline', role: string) {
  const source = sources.sets[set].find(item => item.role === role)!
  expect(element.getAttribute('data-iexp-uiverse-source')).toBe(source.file.replace(/\.html$/, ''))
  expect(element.getAttribute('data-iexp-uiverse-sha256')).toBe(source.sha256)
}

describe('Uiverse adapters chosen by actual ContentView semantics', () => {
  it('keeps V3 ASCII controls and task cards native by default without changing their source', async () => {
    const ascii = resolveTheme({ activeId: 'ascii', installed: [] })
    expect(ascii.formatVersion).toBe(3)
    expect(themeComponentSet(ascii)).toBe('native')
    expect(resolveUiverseAdapter(ascii, 'input', 'task')).toBeUndefined()
    expect(resolveUiverseAdapter(ascii, 'card', 'task')).toBeUndefined()
    await act(async () => themePreferences.set({ activeId: 'ascii', installed: [] }))
    const before = JSON.stringify(tasks), element = await mount(tasks)
    const input = element.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!
    expect(input.classList.contains('iexp-uiv-input')).toBe(false)
    expect(element.querySelectorAll('[data-iexp-uiverse-source]')).toHaveLength(0)
    expect(element.querySelector('.iexp-task')?.classList.contains('iexp-uiv-card')).toBe(false)
    expect(JSON.parse(element.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
    expect(JSON.stringify(tasks)).toBe(before)
    await type(input, '23.80')
    expect(element.querySelectorAll('.iexp-task')).toHaveLength(1)
  })

  it('automatically renders a v1 chart card from ordinary Markdown and preserves every exact source cell', async () => {
    const text = '# 已披露费用\n\n来源口径保持不变。\n\n| 项目 | 金额（亿元） |\n|---|---:|\n| 训练 | 23.80 |\n| 推理 | 97.41 |'
    const element = await mount(text)
    const card = element.querySelector('figure.iexp-chart-card')!
    expect(resolveTheme().formatVersion).toBe(1)
    expect(card.classList.contains('iexp-uiv-card')).toBe(true)
    expect(card.getAttribute('data-iexp-component-mode')).toBe('contextual')
    expect(card.getAttribute('data-iexp-uiverse-role')).toBe('chart')
    sourceMatches(card, 'clear-glass', 'card')
    const full = element.querySelector<HTMLDetailsElement>('.iexp-full-table')!
    expect([...full.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([['训练', '23.80'], ['推理', '97.41']])
    expect(full.textContent).toContain('金额（亿元）')
    expect(element.querySelector('.openui-markdown-renderer > p')?.closest('.iexp-uiv-card')).toBeNull()
    expect(element.querySelector('iframe')).toBeNull()
  })
  it('uses a real adapted task search/card with v1 tokens and preserves search state when v2 overrides the set', async () => {
    const snapshot = JSON.stringify(tasks), element = await mount(tasks)
    const input = element.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!
    expect(input.classList.contains('iexp-uiv-input')).toBe(true)
    sourceMatches(input, 'soft-relief', 'input')
    sourceMatches(element.querySelector('.iexp-task')!, 'soft-relief', 'card')
    await type(input, '23.80')
    expect(element.querySelectorAll('.iexp-task')).toHaveLength(1)
    input.focus()
    const explicit = builtInThemes.find(theme => theme.formatVersion === 2 && theme.componentSet === 'mechanical-outline')!
    await act(async () => themePreferences.set({ activeId: explicit.id, installed: [] }))
    expect(element.querySelector('[aria-label="搜索任务"]')).toBe(input)
    expect(input.value).toBe('23.80')
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('data-iexp-component-mode')).toBe('theme')
    sourceMatches(input, 'mechanical-outline', 'input')
    sourceMatches(element.querySelector('.iexp-task')!, 'mechanical-outline', 'card')
    expect(JSON.parse(element.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
    expect(JSON.stringify(tasks)).toBe(snapshot)
  })
  it('automatically adapts record navigation markup and preserves selected full record across a v2 change', async () => {
    const records = [
      { name: '第一项记录', description: '第一项的原始详细说明与未验证边界，不得缩写或代写。'.repeat(5), amount: '23.80 亿元' },
      { name: '第二项记录', description: '第二项的完整叙述和适用条件，保留全部原始文字。'.repeat(5), amount: '97.41 亿元' },
    ]
    const element = await mount(records), buttons = [...element.querySelectorAll<HTMLButtonElement>('.iexp-object-list button')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.querySelector('.iexp-uiv-backplate')).not.toBeNull()
    expect(buttons[0]!.querySelector('.iexp-uiv-button-label > strong')?.textContent).toBe(records[0]!.name)
    sourceMatches(buttons[0]!, 'clear-glass', 'button')
    await act(async () => buttons[1]!.click())
    const detail = element.querySelector('.iexp-object-detail')!
    expect(detail.querySelector('.iexp-object-description')?.textContent).toBe(records[1]!.description)
    expect(detail.textContent).toContain('97.41 亿元')
    const disclosure = detail.querySelector<HTMLDetailsElement>('details')!
    await act(async () => { disclosure.open = true })
    buttons[1]!.focus()
    const explicit = builtInThemes.find(theme => theme.formatVersion === 2 && theme.componentSet === 'soft-relief')!
    await act(async () => themePreferences.set({ activeId: explicit.id, installed: [] }))
    expect(element.querySelector('.iexp-object-detail')).toBe(detail)
    expect(detail.querySelector('details')).toBe(disclosure)
    expect(disclosure.open).toBe(true)
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(buttons[1])
    sourceMatches(detail, 'soft-relief', 'card')
    expect(JSON.parse(disclosure.querySelector('pre')!.textContent!)).toEqual(records[1])
  })
  it('renders canonical graph nodes and controls through compiled adapters without changing graph source', async () => {
    const graph = { nodes: [{ id: 'one', label: '读取原文' }, { id: 'two', label: '核对 97.41 亿元' }], edges: [{ source: 'one', target: 'two' }] }
    const element = await mount(graph)
    const deadline = Date.now() + 5000
    while (element.querySelectorAll('.iexp-flow-node').length !== 2 && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const nodes = [...element.querySelectorAll('.iexp-flow-node')]
    expect(nodes).toHaveLength(2)
    expect(nodes.map(node => node.querySelector('strong')?.textContent)).toEqual(graph.nodes.map(node => node.label))
    for (const node of nodes) sourceMatches(node, 'soft-relief', 'card')
    const pause = [...element.querySelectorAll<HTMLButtonElement>('.iexp-flow-toolbar button')].find(button => button.textContent === '暂停连线动效')!
    expect(pause.querySelector('.iexp-uiv-button-label')).not.toBeNull()
    await act(async () => pause.click())
    expect(pause.textContent).toBe('恢复连线动效')
    expect(element.querySelector('figure')?.getAttribute('data-motion')).toBe('still')
    expect(element.querySelector('.iexp-flow-source pre')?.textContent).toBe(JSON.stringify(graph, null, 2))
    expect(element.querySelector('iframe')).toBeNull()
  })
  it('leaves ordinary prose and controls outside the owned content scope native', async () => {
    const element = await mount('普通段落保持原文。\n\n第二段包含 23.80 亿元，不能推断为图表。')
    expect(element.querySelectorAll('.openui-markdown-renderer p')).toHaveLength(2)
    expect(element.querySelector('[data-iexp-uiverse-source]')).toBeNull()
    expect(element.querySelector('.iexp-uiv-card')).toBeNull()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host); mounted.push({ root, element: host })
    await act(async () => root.render(h(ThemeButton, { type: 'button' }, '原生设置按钮')))
    expect(host.querySelector('.iexp-uiv-button')).toBeNull()
  })
  it('loads concrete adapter styles for content rather than adding provenance-only labels', async () => {
    const element = await mount([{ name: '甲', description: '原始说明保持完整。'.repeat(12) }, { name: '乙', description: '另一项原始说明保持完整。'.repeat(12) }])
    const style = document.createElement('style'); style.textContent = themeComponentsCss; document.head.append(style)
    try {
      const button = element.querySelector('.iexp-object-list button')!
      expect(getComputedStyle(button).position).toBe('relative')
      expect(button.querySelector('.iexp-uiv-backplate')).not.toBeNull()
      expect(button.querySelector('.iexp-uiv-button-label')).not.toBeNull()
    } finally { style.remove() }
  })
})
