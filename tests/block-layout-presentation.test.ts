// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentView } from '../src/presentation.js'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { compileBlockLayout, type CompiledBlock } from '../src/adaptive-ui/block-compiler.js'
import type { BaseCompositionSelection } from '../src/adaptive-ui/planner.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ComposeInput, CompositionResult } from '../src/adaptive-ui/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Mounted = { root: Root, host: HTMLDivElement }
const mounted: Mounted[] = []
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations')

const source = `# 原始报告

连续正文保留 [来源链接][evidence] 与脚注[^note]。

## 数值

| 项目 | 金额（亿元） |
| --- | ---: |
| 训练 | 23.80 |
| 推理 | 97.41 |

## 工作流

准备 → 核验 → 保存

## 任务

| 任务名称 | 状态 | 说明 |
| --- | --- | --- |
| 核对原文 | 待处理 | 保持原始来源 |
| 保存结果 | 已完成 | 记录完整结论 |

## 限制

这份限制说明必须保留在同一份 Markdown 文档中。

[evidence]: https://example.com/evidence
[^note]: 这是脚注文本。`

function selection(overrides: Partial<BaseCompositionSelection> = {}): BaseCompositionSelection {
  return {
    themeId: 'ascii',
    surface: 'semantic',
    chart: 'auto',
    componentSet: 'native',
    objectEffect: 'none',
    layout: 'auto',
    ...overrides,
  }
}

function blockSelection(block: CompiledBlock, sourceSurface = false): BaseCompositionSelection {
  const text = typeof block.value === 'string' ? block.value : ''
  if (block.kind === 'table' && text.includes('金额（亿元）')) return selection(sourceSurface ? { surface: 'source' } : { chart: 'compact' })
  if (block.kind === 'table' && text.includes('任务名称')) return selection({ layout: 'board' })
  if (block.kind === 'paragraph') return selection({ layout: 'flow' })
  if (block.kind === 'structured-array') return selection({ layout: 'table' })
  return selection()
}

function plannedResult(value: unknown, options: { root?: Partial<BaseCompositionSelection>, inspection?: 'none' | 'research', sourceSurface?: boolean, invalidReferences?: boolean } = {}): CompositionResult {
  const compiled = compileBlockLayout(value)
  const blocks = compiled.blocks.map(block => ({
    id: block.id,
    path: [...block.path],
    ...(block.start === undefined ? {} : { start: block.start }),
    ...(block.end === undefined ? {} : { end: block.end }),
    kind: block.kind,
    selection: blockSelection(block, options.sourceSurface),
    evidence: [...block.evidence],
  }))
  const references = options.invalidReferences ? blocks.slice(0, -1) : blocks
  return {
    status: 'selected',
    reason: 'JEV_SELECTION_ADOPTED',
    sourceVersion: 'sha256:block-layout-presentation',
    operationId: 'block-layout-presentation',
    selection: {
      ...selection(options.root),
      blockLayout: { version: compiled.version, inspection: options.inspection ?? 'none', blocks: references },
    },
  } as CompositionResult
}

function settings(blockLayout: boolean): ExperienceSettings {
  return {
    ...initialSettings(),
    revision: 1,
    takeover: true,
    adaptive: { enabled: true, styleMode: 'automatic', blockLayout },
    theme: { activeId: 'ascii', installed: [] },
  }
}

function apiFor(plan: (value: unknown) => CompositionResult) {
  const composition = vi.fn((input: ComposeInput) => Promise.resolve(plan(input.value)))
  const compositionReceipt = vi.fn(async () => ({ status: 'observed' }))
  const compositionCancel = vi.fn(async () => ({ cancelled: true }))
  const api: CompositionApi = { composition, compositionReceipt, compositionCancel }
  return { api, composition, compositionReceipt }
}

function tree(value: unknown, api: CompositionApi, enabled: boolean) {
  return h(CompositionRuntimeContext.Provider, { value: { api, sessionId: 'block-layout-session', settings: settings(enabled) } },
    h(ContentView, { value, documentId: 'block-layout-document', sessionId: 'block-layout-session' }),
  )
}

async function mount(value: unknown, api: CompositionApi, enabled = true): Promise<Mounted> {
  const host = document.createElement('div'), root = createRoot(host), item = { root, host }
  mounted.push(item)
  document.body.append(host)
  await act(async () => root.render(tree(value, api, enabled)))
  return item
}

async function rerender(item: Mounted, value: unknown, api: CompositionApi, enabled = true): Promise<void> {
  await act(async () => item.root.render(tree(value, api, enabled)))
}

async function waitFor(host: HTMLElement, selector: string): Promise<void> {
  await act(async () => { await vi.waitFor(() => expect(host.querySelector(selector)).not.toBeNull()) })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => kind === '2d'
    ? { font: '', measureText: (text: string) => ({ width: text.length * 7 }), setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {} } as unknown as CanvasRenderingContext2D
    : null)
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  document.body.replaceChildren()
  if (getAnimationsDescriptor) Object.defineProperty(Element.prototype, 'getAnimations', getAnimationsDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'getAnimations')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('source-bound experimental block layout', () => {
  it('keeps one Markdown document while applying chart, board, and flow choices to their source blocks', async () => {
    const fake = apiFor(value => plannedResult(value, { root: { layout: 'heading-index' } }))
    const item = await mount(source, fake.api)

    await waitFor(item.host, '[data-iexp-composition-status="selected"]')
    await waitFor(item.host, '[data-comparison-plot]')
    await waitFor(item.host, '.iexp-board')
    await waitFor(item.host, '.iexp-flow')

    expect(item.host.querySelector('[data-content-layout="heading-index"]')).not.toBeNull()
    expect(item.host.querySelector<HTMLAnchorElement>('a[href="https://example.com/evidence"]')?.textContent).toBe('来源链接')
    expect(item.host.textContent).toContain('这是脚注文本。')
    const basis = item.host.querySelector<HTMLDetailsElement>('[data-iexp-block-layout-basis="true"]')!
    expect(basis).not.toBeNull()
    expect(basis.textContent).toContain('内容块布局依据')
    expect(basis.textContent).toContain('不代表模型返回的文字理由')
    expect(basis.textContent).toContain('紧凑比较图')
    expect(basis.textContent).toContain('任务看板')
    expect(basis.textContent).toContain('步骤或关系图')
    expect(basis.textContent).not.toMatch(/block-root|source:table|range:\d+/)

    const fullTable = item.host.querySelector<HTMLDetailsElement>('details.iexp-full-table')!
    await act(async () => { fullTable.open = true })
    await rerender(item, source, fake.api)
    expect(item.host.querySelector('details.iexp-full-table')).toBe(fullTable)
    expect(fullTable.open).toBe(true)
  })

  it('uses compiler paths for independently normalized text blocks', async () => {
    const blocks = [
      { type: 'text', text: '| 项目 | 金额（亿元） |\n| --- | ---: |\n| 训练 | 23.80 |\n| 推理 | 97.41 |' },
      { type: 'text', text: '| 任务名称 | 状态 | 说明 |\n| --- | --- | --- |\n| 核对原文 | 待处理 | 保持原始来源 |\n| 保存结果 | 已完成 | 记录完整结论 |' },
    ]
    const fake = apiFor(value => plannedResult(value))
    const item = await mount(blocks, fake.api)

    await waitFor(item.host, '[data-iexp-composition-status="selected"]')
    await waitFor(item.host, '[data-comparison-plot]')
    await waitFor(item.host, '.iexp-board')
    const bases = [...item.host.querySelectorAll('[data-iexp-block-layout-basis="true"]')]
    expect(bases).toHaveLength(2)
    expect(bases.map(node => node.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('第 1 个内容块'),
      expect.stringContaining('第 2 个内容块'),
    ]))

    const fullTable = item.host.querySelector<HTMLDetailsElement>('details.iexp-full-table')!
    await act(async () => { fullTable.open = true })
    await rerender(item, blocks.map(block => ({ ...block })), fake.api)
    expect(item.host.querySelector('details.iexp-full-table')).toBe(fullTable)
    expect(fullTable.open).toBe(true)
  })

  it('honors a local source surface without replacing the complete native table', async () => {
    const fake = apiFor(value => plannedResult(value, { sourceSurface: true }))
    const item = await mount(source, fake.api)

    await waitFor(item.host, '[data-iexp-composition-status="selected"]')
    expect(item.host.querySelector('[data-comparison-plot]')).toBeNull()
    expect(item.host.querySelector('table')?.textContent).toContain('金额（亿元）')
    expect(item.host.textContent).toContain('23.80')
  })

  it('applies the compiler-owned selection to a structured array leaf', async () => {
    const records = [
      { Task: '核对原文', Status: '待处理', Description: '保持原始来源。' },
      { Task: '保存结果', Status: '已完成', Description: '记录完整结论。' },
    ]
    const fake = apiFor(value => plannedResult(value))
    const item = await mount(records, fake.api)

    await waitFor(item.host, '[data-iexp-composition-status="selected"]')
    expect(item.host.querySelector('.iexp-board')).toBeNull()
    expect(item.host.querySelector('.iexp-table-group table')?.textContent).toContain('核对原文')
    expect(item.host.querySelector('[data-iexp-block-layout-basis]')?.textContent).toContain('结构化列表')
  })

  it('bypasses a selected block plan when the experimental switch is off or its references do not cover the source', async () => {
    const disabled = apiFor(value => plannedResult(value, { sourceSurface: true }))
    const disabledMount = await mount(source, disabled.api, false)
    await waitFor(disabledMount.host, '[data-iexp-composition-status="local"]')
    expect(disabledMount.host.querySelector('[data-iexp-block-layout-basis]')).toBeNull()
    expect(disabled.compositionReceipt).not.toHaveBeenCalled()

    const invalid = apiFor(value => plannedResult(value, { invalidReferences: true }))
    const invalidMount = await mount(source, invalid.api, true)
    await waitFor(invalidMount.host, '[data-iexp-composition-status="local"]')
    expect(invalidMount.host.querySelector('[data-iexp-block-layout-basis]')).toBeNull()
    expect(invalid.compositionReceipt).not.toHaveBeenCalled()
  })

  it('uses research inspection for a normalized singleton text block without replacing its source renderer', async () => {
    const singleton = [{ type: 'text', text: source }]
    const fake = apiFor(value => plannedResult(value, { root: { layout: 'heading-index' }, inspection: 'research' }))
    const item = await mount(singleton, fake.api)

    await waitFor(item.host, '[data-iexp-composition-status="selected"]')
    await waitFor(item.host, '[data-research-workspace="enabled"]')
    expect(item.host.querySelector('.iexp-flow')).not.toBeNull()
    expect(item.host.querySelector<HTMLAnchorElement>('a[href="https://example.com/evidence"]')?.textContent).toBe('来源链接')
  })
})
