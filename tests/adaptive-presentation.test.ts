// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ArtifactView, ContentView } from '../src/presentation.js'
import { initialSettings, type ExperienceArtifact, type ExperienceSettings } from '../src/contracts.js'
import { themePreferences } from '../src/theme-runtime.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ComposeInput, CompositionResult, CompositionSelection } from '../src/adaptive-ui/contracts.js'
import { apply } from '../src/client.js'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Deferred<T> = { promise: Promise<T>, resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(next => { resolve = next }), resolve }
}

type Mounted = { root: Root, host: HTMLDivElement }
type MountOptions = {
  documentId?: string
  sessionId?: string
  isStreaming?: boolean
  decide?: boolean
  settings?: ExperienceSettings
}

function settings(overrides: Partial<ExperienceSettings> = {}): ExperienceSettings {
  return {
    ...initialSettings(),
    revision: 1,
    takeover: true,
    adaptive: { enabled: true, styleMode: 'automatic' },
    theme: { activeId: 'empryo', installed: [] },
    ...overrides,
  }
}

function selectedResult(selection: Partial<CompositionSelection> = {}, operationId = 'operation-1'): CompositionResult {
  return {
    status: 'selected',
    reason: 'JEV_SELECTION_ADOPTED',
    sourceVersion: 'sha256:source-version',
    operationId,
    selection: {
      themeId: 'empryo',
      surface: 'semantic',
      chart: 'auto',
      componentSet: 'native',
      objectEffect: 'none',
      layout: 'auto',
      ...selection,
    },
  }
}

function nonSelectedResult(status: 'local' | 'stale' | 'failed', reason: string): CompositionResult {
  return { status, reason, sourceVersion: 'sha256:source-version' }
}

function makeApi(decide: (input: ComposeInput) => Promise<CompositionResult>) {
  const composition = vi.fn(decide)
  const compositionReceipt = vi.fn(async (_input: unknown) => ({ status: 'observed' as const }))
  const compositionCancel = vi.fn(async (_input: unknown) => ({ cancelled: true }))
  const api: CompositionApi = { composition, compositionReceipt, compositionCancel }
  return { api, composition, compositionReceipt, compositionCancel }
}

const mounted: Mounted[] = []
async function render(value: unknown, api: CompositionApi, options: MountOptions = {}): Promise<Mounted> {
  return renderElement(h(ContentView, {
    value,
    documentId: options.documentId,
    sessionId: options.sessionId ?? 'session-1',
    isStreaming: options.isStreaming,
    decide: options.decide,
  }), api, options)
}

async function renderElement(element: ReactElement, api: CompositionApi, options: MountOptions = {}): Promise<Mounted> {
  const host = document.createElement('div')
  const root = createRoot(host)
  const mount: Mounted = { root, host }
  mounted.push(mount)
  document.body.append(host)
  const sessionId = options.sessionId ?? 'session-1'
  await act(async () => root.render(h(CompositionRuntimeContext.Provider, {
    value: { api, sessionId, settings: options.settings ?? settings() },
  }, element)))
  return mount
}

async function rerender(mount: Mounted, value: unknown, api: CompositionApi, options: MountOptions = {}): Promise<void> {
  const sessionId = options.sessionId ?? 'session-1'
  await act(async () => mount.root.render(h(CompositionRuntimeContext.Provider, {
    value: { api, sessionId, settings: options.settings ?? settings() },
  }, h(ContentView, {
    value,
    documentId: options.documentId,
    sessionId,
    isStreaming: options.isStreaming,
    decide: options.decide,
  }))))
}

async function unmount(mount: Mounted): Promise<void> {
  await act(async () => mount.root.unmount())
  mount.host.remove()
  const index = mounted.indexOf(mount)
  if (index >= 0) mounted.splice(index, 1)
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) })
}

async function waitForSelection(host: HTMLDivElement): Promise<void> {
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()) })
}

async function waitForFlowNodes(host: HTMLDivElement, count: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (host.querySelectorAll('.react-flow__node').length !== count && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(host.querySelectorAll('.react-flow__node')).toHaveLength(count)
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

const taskRecords = [
  { Task: '核对原文', Status: '待处理', Description: '保持原始字段与交互。' },
  { Task: '保存来源', Status: '已完成', Description: '完整保留来源数据。' },
]

beforeEach(() => {
  themePreferences.reset()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => contextId === '2d'
    ? { font: '', measureText: (text: string) => ({ width: text.length * 7 }), setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {} } as unknown as CanvasRenderingContext2D
    : null)
})

afterEach(async () => {
  for (const mount of mounted.splice(0)) {
    await act(async () => mount.root.unmount())
    mount.host.remove()
  }
  themePreferences.reset()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('adaptive composition through the real ContentView', () => {
  it('adopts different known themes and component sets for the same source while retaining native input behavior', async () => {
    const originalTheme = themePreferences.getSnapshot().id
    const api = makeApi(input => Promise.resolve(selectedResult(
      input.documentId === 'soft-document'
        ? { themeId: 'uiverse-soft-relief', componentSet: 'soft-relief', layout: 'board' }
        : { themeId: 'uiverse-clear-glass', componentSet: 'clear-glass', layout: 'board' },
      input.documentId === 'soft-document' ? 'operation-soft' : 'operation-glass',
    )))

    const soft = await render(taskRecords, api.api, { documentId: 'soft-document' })
    const glass = await render(taskRecords, api.api, { documentId: 'glass-document' })
    await waitForSelection(soft.host)
    await waitForSelection(glass.host)

    expect(themePreferences.getSnapshot().id).toBe(originalTheme)
    expect(soft.host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe('uiverse-soft-relief')
    expect(glass.host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe('uiverse-clear-glass')

    const softSearch = soft.host.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!
    const glassSearch = glass.host.querySelector<HTMLInputElement>('[aria-label="搜索任务"]')!
    expect(softSearch).toMatchObject({ type: 'search', value: '' })
    expect(glassSearch).toMatchObject({ type: 'search', value: '' })
    expect(softSearch.getAttribute('placeholder')).toBe('搜索任务、说明或状态')
    expect(softSearch.getAttribute('data-iexp-component-set')).toBe('soft-relief')
    expect(glassSearch.getAttribute('data-iexp-component-set')).toBe('clear-glass')
    expect(softSearch.getAttribute('data-iexp-uiverse-role')).toBe('task')
    expect(glassSearch.getAttribute('data-iexp-uiverse-role')).toBe('task')
    expect(soft.host.querySelector('.iexp-task')?.textContent).toContain('核对原文')
    expect(glass.host.textContent).toContain('保存来源')

    await setInputValue(softSearch, '核对')
    expect(soft.host.querySelectorAll('.iexp-task')).toHaveLength(1)
    expect(soft.host.querySelector('.iexp-task')?.textContent).toContain('核对原文')
  })

  it('changes the rendered surface between board and table for the same source', async () => {
    const api = makeApi(input => Promise.resolve(selectedResult({ themeId: 'plain', layout: input.documentId === 'board-document' ? 'board' : 'table' }, input.documentId)))
    const board = await render(taskRecords, api.api, { documentId: 'board-document' })
    const table = await render(taskRecords, api.api, { documentId: 'table-document' })
    await waitForSelection(board.host)
    await waitForSelection(table.host)

    expect(board.host.querySelector('.iexp-board')).not.toBeNull()
    expect(board.host.querySelector('.iexp-board-columns')).not.toBeNull()
    expect(board.host.querySelector('table')).toBeNull()
    expect(table.host.querySelector('.iexp-board')).toBeNull()
    expect(table.host.querySelector('.iexp-table-group table')).not.toBeNull()
    expect(table.host.querySelector('table')?.textContent).toContain('核对原文')
    expect(table.host.querySelector('table')?.textContent).toContain('完整保留来源数据。')
  })

  it.each([
    ['local rejection', () => Promise.resolve(nonSelectedResult('local', 'JEV_SELECTION_REJECTED'))],
    ['stale result', () => Promise.resolve(nonSelectedResult('stale', 'COMPOSITION_STALE'))],
    ['failed result', () => Promise.resolve(nonSelectedResult('failed', 'JEV_SELECTION_FAILED'))],
    ['rejected request', () => Promise.reject(new Error('JEV_SELECTION_REJECTED'))],
  ])('keeps the original source visible after an %s', async (_label, makeResult: () => Promise<CompositionResult>) => {
    const source = '# 原始输出\n\n这段来源必须完整保留。'
    const api = makeApi(() => makeResult())
    const mount = await render(source, api.api, { documentId: 'rejected-document' })
    await flush()

    expect(mount.host.textContent).toContain('原始输出')
    expect(mount.host.textContent).toContain('这段来源必须完整保留。')
    expect(mount.host.querySelector('[data-iexp-composition-status="selected"]')).toBeNull()
    expect(api.compositionReceipt).not.toHaveBeenCalled()
  })

  it('keeps the source visible when the host returns an invalid result shape', async () => {
    const invalid = { ...selectedResult(), selection: { ...selectedResult().selection, chart: 'unsupported' } } as unknown as CompositionResult
    const api = makeApi(() => Promise.resolve(invalid))
    const mount = await render('原始内容：不应因无效选择而消失。', api.api, { documentId: 'invalid-document' })
    await flush()

    expect(mount.host.textContent).toContain('原始内容：不应因无效选择而消失。')
    expect(mount.host.querySelector('[data-iexp-composition-status="selected"]')).toBeNull()
    expect(api.compositionReceipt).not.toHaveBeenCalled()
  })

  it('does not let delayed source A adopt over source B, and cancels each request by its own requestId', async () => {
    const sourceA = '# 来源 A\n\n旧内容。'
    const sourceB = '# 来源 B\n\n新内容。'
    const first = deferred<CompositionResult>(), second = deferred<CompositionResult>()
    const requests: ComposeInput[] = []
    const api = makeApi(input => {
      requests.push(input)
      return requests.length === 1 ? first.promise : second.promise
    })
    const mount = await render(sourceA, api.api, { documentId: 'racing-document' })
    await vi.waitFor(() => expect(api.composition).toHaveBeenCalledTimes(1))
    await rerender(mount, sourceB, api.api, { documentId: 'racing-document' })
    await vi.waitFor(() => expect(api.composition).toHaveBeenCalledTimes(2))

    expect(requests[0]?.requestId).toBeTruthy()
    expect(requests[1]?.requestId).toBeTruthy()
    expect(api.compositionCancel).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', documentId: 'racing-document', requestId: requests[0]!.requestId,
    }))

    first.resolve(selectedResult({ themeId: 'uiverse-soft-relief', componentSet: 'soft-relief', layout: 'board' }, 'operation-old'))
    await flush()
    expect(mount.host.textContent).toContain('来源 B')
    expect(mount.host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe('empryo')
    expect(api.compositionReceipt).not.toHaveBeenCalled()

    await unmount(mount)
    expect(api.compositionCancel).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', documentId: 'racing-document', requestId: requests[1]!.requestId,
    }))
    second.resolve(selectedResult({ themeId: 'uiverse-clear-glass', componentSet: 'clear-glass', layout: 'board' }, 'operation-new'))
    await flush()
    expect(api.compositionReceipt).not.toHaveBeenCalled()
  })

  it('reuses one live-series decision across point ticks while binding the latest source value', async () => {
    const first = {
      type: 'live-series' as const, source: '延迟探针', unit: 'ms', timeUnit: 'milliseconds' as const,
      points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.5 }], updatedAt: 2_000,
    }
    const next = {
      ...first,
      points: [...first.points, { time: 3_000, value: 6.5 }], updatedAt: 3_000,
    }
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain', live: 'native' }, 'operation-live')))
    const mount = await render(first, api.api, { documentId: 'live-document' })
    await waitForSelection(mount.host)
    expect(mount.host.textContent).toContain('最新值：7.5 ms')
    expect(api.composition).toHaveBeenCalledOnce()

    await rerender(mount, next, api.api, { documentId: 'live-document' })
    await flush()

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.compositionCancel).not.toHaveBeenCalled()
    expect(mount.host.querySelector('[data-live-series]')?.textContent).toContain('最新值：6.5 ms')
    expect(mount.host.querySelector('[data-live-series] table')?.textContent).toContain('3000 milliseconds')
  })

  it.each([
    {
      name: 'JSON live-series',
      first: JSON.stringify({ type: 'live-series', source: '延迟探针', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.5 }], updatedAt: 2_000 }),
      next: JSON.stringify({ type: 'live-series', source: '延迟探针', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.5 }, { time: 3_000, value: 6.25 }], updatedAt: 3_000 }),
      latest: '最新值：6.25 ms',
      selection: { live: 'native' as const },
    },
    {
      name: 'JSON metric-update',
      first: JSON.stringify({ type: 'metric-update', label: '延迟', unit: 'ms', previous: '8.00', value: '7.50' }),
      next: JSON.stringify({ type: 'metric-update', label: '延迟', unit: 'ms', previous: '7.50', value: '6.25' }),
      latest: '6.25 ms',
      selection: {},
    },
  ])('reuses one decision for $name when the JSON string carries only a value tick', async ({ first, next, latest, selection }) => {
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain', ...selection }, 'operation-json-tick')))
    const mount = await render(first, api.api, { documentId: `json-${selection.live ? 'live' : 'metric'}` })
    await waitForSelection(mount.host)
    expect(mount.host.textContent).toContain(selection.live ? '最新值：7.5 ms' : '7.50 ms')
    await rerender(mount, next, api.api, { documentId: `json-${selection.live ? 'live' : 'metric'}` })
    await flush()

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.compositionCancel).not.toHaveBeenCalled()
    expect(mount.host.textContent).toContain(latest)
  })

  it.each([
    {
      name: 'tool live-series',
      first: { type: 'live-series', source: '工具延迟', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1_000, value: 8.5 }, { time: 2_000, value: 7.5 }], updatedAt: 2_000 },
      next: { type: 'live-series', source: '工具延迟', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1_000, value: 8.5 }, { time: 2_000, value: 7.5 }, { time: 3_000, value: 6.25 }], updatedAt: 3_000 },
      latest: '最新值：6.25 ms',
      selection: { live: 'native' as const },
    },
    {
      name: 'tool metric-update',
      first: { type: 'metric-update', label: '工具延迟', unit: 'ms', previous: '8.50', value: '7.50' },
      next: { type: 'metric-update', label: '工具延迟', unit: 'ms', previous: '7.50', value: '6.25' },
      latest: '6.25 ms',
      selection: {},
    },
  ])('normalizes a single standard tool JSON text block for $name ticks without a second RPC', async ({ first, next, latest, selection }) => {
    const tool = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]
    const firstTool = tool(first), nextTool = tool(next)
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain', ...selection }, 'operation-tool-tick')))
    const mount = await render(firstTool, api.api, { documentId: `tool-${selection.live ? 'live' : 'metric'}` })
    await waitForSelection(mount.host)
    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.composition.mock.calls[0]?.[0]?.value).toEqual(firstTool)

    await rerender(mount, nextTool, api.api, { documentId: `tool-${selection.live ? 'live' : 'metric'}` })
    await flush()

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.compositionCancel).not.toHaveBeenCalled()
    expect(mount.host.textContent).toContain(latest)
  })

  it('renders a single standard tool JSON graph through the real flow surface without changing the tool source', async () => {
    const graph = { nodes: [{ id: 'source', label: '读取工具原文' }, { id: 'verify', label: '核对工具回执' }], edges: [{ source: 'source', target: 'verify' }] }
    const tool = [{ type: 'text', text: JSON.stringify(graph) }]
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain', layout: 'flow' }, 'operation-tool-graph')))
    const mount = await render(tool, api.api, { documentId: 'tool-graph' })
    await waitForSelection(mount.host)
    await waitForFlowNodes(mount.host, 2)

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.composition.mock.calls[0]?.[0]?.value).toEqual(tool)
    expect([...mount.host.querySelectorAll('.react-flow__node strong')].map(node => node.textContent)).toEqual(['读取工具原文', '核对工具回执'])
    expect(mount.host.querySelector('.react-flow')).not.toBeNull()
    expect(mount.host.querySelector('.iexp-flow-source pre')?.textContent).toBe(JSON.stringify(graph, null, 2))
  })

  it('keeps multiple independent tool text blocks separate while sharing one composition choice', async () => {
    const blocks = [
      { type: 'text', text: JSON.stringify({ type: 'metric-update', label: '独立指标', unit: 'ms', previous: '8.00', value: '6.25' }) },
      { type: 'text', text: '```json\n{"type":"live-series","source":"原样围栏","unit":"ms","timeUnit":"milliseconds","points":[{"time":1000,"value":8}]}\n```' },
      { type: 'text', text: '# 独立 Markdown\n\n第三个 block 不应和前两个拼接。' },
    ]
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain' }, 'operation-tool-blocks')))
    const mount = await render(blocks, api.api, { documentId: 'tool-blocks' })
    await waitForSelection(mount.host)
    await flush()

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.composition.mock.calls[0]?.[0]?.value).toEqual(blocks)
    expect(mount.host.querySelectorAll('[data-iexp-update="metric-update"]')).toHaveLength(1)
    expect(mount.host.querySelector('[data-iexp-update="metric-update"]')?.textContent).toContain('6.25 ms')
    expect(mount.host.querySelector('pre code')?.textContent).toContain('原样围栏')
    expect(mount.host.querySelector('h1')?.textContent).toBe('独立 Markdown')
    expect(mount.host.textContent).toContain('第三个 block 不应和前两个拼接。')
  })

  it.each([
    {
      name: 'metric',
      first: { type: 'metric-update', label: '延迟', unit: 'ms', previous: '8.00', value: '7.50' },
      next: { type: 'metric-update', label: '延迟', unit: 'ms', previous: '7.50', value: '6.25' },
    },
    {
      name: 'status',
      first: { type: 'status-update', label: '任务状态', unit: 'state', previous: '等待中', value: '运行中' },
      next: { type: 'status-update', label: '任务状态', unit: 'state', previous: '运行中', value: '已完成' },
    },
  ])('reuses one %s update decision when only the short value changes', async ({ first, next }) => {
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain' }, 'operation-short-update')))
    const mount = await render(first, api.api, { documentId: `short-${first.type}` })
    await waitForSelection(mount.host)
    await rerender(mount, next, api.api, { documentId: `short-${first.type}` })
    await flush()

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.compositionCancel).not.toHaveBeenCalled()
    expect(mount.host.textContent).toContain(String(next.value))
  })

  it('does not reuse a live decision for a source identity change or invalid new data', async () => {
    const valid = {
      type: 'live-series' as const, source: '延迟探针', unit: 'ms', timeUnit: 'milliseconds' as const,
      points: [{ time: 1_000, value: 8.25 }, { time: 2_000, value: 7.5 }], updatedAt: 2_000,
    }
    const changedIdentity = { ...valid, source: '吞吐探针', points: [{ time: 1_000, value: 125 }, { time: 2_000, value: 140 }], updatedAt: 2_000 }
    const invalid = { ...changedIdentity, points: [{ time: 2_000, value: 140 }, { time: 1_000, value: 125 }] }
    let calls = 0
    const api = makeApi(() => {
      calls += 1
      return Promise.resolve(calls === 3
        ? nonSelectedResult('local', 'COMPOSITION_SOURCE_UNRECOGNIZED')
        : selectedResult({ themeId: calls === 1 ? 'uiverse-soft-relief' : 'uiverse-clear-glass', componentSet: calls === 1 ? 'soft-relief' : 'clear-glass' }, `operation-${calls}`))
    })
    const mount = await render(valid, api.api, { documentId: 'identity-document' })
    await waitForSelection(mount.host)
    expect(mount.host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe('uiverse-soft-relief')

    await rerender(mount, changedIdentity, api.api, { documentId: 'identity-document' })
    await waitForSelection(mount.host)
    expect(api.composition).toHaveBeenCalledTimes(2)
    expect(mount.host.querySelector('[data-iexp-adaptive-theme]')?.getAttribute('data-iexp-adaptive-theme')).toBe('uiverse-clear-glass')

    await rerender(mount, invalid, api.api, { documentId: 'identity-document' })
    await flush()
    expect(api.composition).toHaveBeenCalledTimes(3)
    expect(mount.host.querySelector('[data-iexp-composition-status="selected"]')).toBeNull()
    expect(mount.host.textContent).toContain('吞吐探针')
  })

  it('projects assistant artifact reasoning separately and composes only its text block', async () => {
    const blocks = [
      { type: 'reasoning', text: '内部推理必须仍然可展开查看。' },
      { type: 'text', text: '最终回答只应作为编排来源。' },
    ]
    const artifact = {
      formatVersion: 1 as const,
      id: 'assistant-artifact',
      createdAt: '',
      source: { sessionId: 'session-1', kind: 'assistant' as const, label: '助手回复' },
      protocol: 'content' as const,
      raw: { role: 'assistant', content: blocks },
      payload: { role: 'assistant', content: blocks },
      providerId: 'test',
    } satisfies ExperienceArtifact
    const api = makeApi(() => Promise.resolve(selectedResult({ themeId: 'plain' }, 'operation-assistant-text')))
    const mixed = await renderElement(h(ArtifactView, { artifact }), api.api)
    await waitForSelection(mixed.host)

    expect(api.composition).toHaveBeenCalledOnce()
    expect(api.composition.mock.calls[0]?.[0]?.value).toBe('最终回答只应作为编排来源。')
    expect(api.composition.mock.calls[0]?.[0]?.documentId).toBe('artifact:assistant-artifact:text:1')
    expect(mixed.host.querySelector('details summary')?.textContent).toContain('思考过程')
    expect(mixed.host.querySelector('details')?.textContent).toContain('内部推理必须仍然可展开查看。')
    expect(mixed.host.textContent).toContain('最终回答只应作为编排来源。')

    await unmount(mixed)
    api.composition.mockClear()
    const pureReasoning = {
      ...artifact,
      id: 'reasoning-only-artifact',
      raw: { role: 'assistant', content: [{ type: 'reasoning', text: '只有思考过程也必须可读。' }] },
      payload: { role: 'assistant', content: [{ type: 'reasoning', text: '只有思考过程也必须可读。' }] },
    } satisfies ExperienceArtifact
    const pure = await renderElement(h(ArtifactView, { artifact: pureReasoning }), api.api)
    await flush()
    expect(api.composition).not.toHaveBeenCalled()
    expect(pure.host.querySelector('details summary')?.textContent).toContain('思考过程')
    expect(pure.host.textContent).toContain('只有思考过程也必须可读。')
  })

  it('keeps the assistant OpenUI stream composition document ID bound to anchorSeq through the real client slot', async () => {
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'conversation.user.text.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const appSettings = settings({ takeover: true, openui: true })
    const ok = <T,>(value: T) => ({ ok: true as const, value })
    const wire = {
      settings: vi.fn(async () => ok(appSettings)),
      saveSettings: vi.fn(async () => ok(appSettings)),
      artifacts: vi.fn(async () => ok([])),
      publish: vi.fn(async () => ok({})),
      composition: vi.fn(async (_input: ComposeInput) => ok(selectedResult({ themeId: 'plain' }, 'operation-client-openui'))),
      compositionReceipt: vi.fn(async () => ok({ status: 'observed' as const, operationId: 'operation-client-openui', sourceVersion: 'sha256:source-version' })),
      compositionCancel: vi.fn(async () => ok({ cancelled: true, reason: 'COMPOSITION_CANCELLED' })),
    }
    const cleanups: Array<() => void> = []
    const ctx = {
      locale: { subscribe: () => () => {} },
      inject: () => () => {},
      slots: {
        register,
        inject: (_name: string, callback: () => () => void) => callback(),
        entries: core.entries.bind(core),
        entriesOfSlot: core.entriesOfSlot.bind(core),
        subscribe: core.subscribe.bind(core),
      },
      effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose },
      provide: () => () => {},
      remote: { $mount: async () => async () => {} },
      get: (name: string) => name === 'theme'
        ? { getTheme: () => ({ active: { colorScheme: 'light' } }) }
        : name === 'remote.solarExperience' ? wire : name === 'sessions' ? { using: vi.fn() } : undefined,
      on: () => () => {},
    } as unknown as Context
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    try {
      apply(ctx)
      await flush()
      const entry = core.entriesOfSlot('conversation.chat.node').find(item => item.options.key === 'assistant-step')
      expect(entry).toBeDefined()
      const Assistant = entry!.component as (props: Record<string, unknown>) => ReactElement
      const node = { anchorSeq: 42, data: { status: 'done', blocks: [{ kind: 'text', text: '```openui\nroot = TextContent("完成")\n```' }] } }
      await act(async () => root.render(h(Assistant, { sessionId: 'session-1', node, loadImage: () => Promise.resolve('') })))
      await vi.waitFor(() => expect(wire.composition).toHaveBeenCalled())
      expect(wire.composition.mock.calls[0]?.[0]?.documentId).toBe('artifact:stream-42-0')
      // With the Jev feature off the Host answers `local` (with a local selection); a copied loose table still renders as a table.
      const local = selectedResult({ themeId: 'plain' }, 'operation-local')
      wire.composition.mockImplementation(async () => ok({ status: 'local' as const, reason: 'JEV_FEATURE_DISABLED', sourceVersion: local.sourceVersion, selection: local.selection }))
      const loose = { anchorSeq: 43, data: { status: 'done', blocks: [{ kind: 'text', text: '| 研究维度 | 当前判断 |\n\n| --- | --- |\n\n| 甲 | 明确 |\n\n| 乙 | 较强 |' }] } }
      const before = wire.composition.mock.calls.length
      await act(async () => root.render(h(Assistant, { sessionId: 'session-1', node: loose, loadImage: () => Promise.resolve('') })))
      await vi.waitFor(() => expect(wire.composition.mock.calls.length).toBeGreaterThan(before))
      await flush(); await flush()
      expect(host.querySelector('[data-iexp-composition-status="local"]')).not.toBeNull()
      expect(host.querySelectorAll('table tbody tr')).toHaveLength(2)
      // The user's own message is visualized locally; it is never a composition input.
      const userText = core.entriesOfSlot('conversation.user.text.node').find(item => item.options.key === 'text')
      expect(userText).toBeDefined()
      const UserText = userText!.component as (props: Record<string, unknown>) => ReactElement
      const calls = wire.composition.mock.calls.length
      await act(async () => root.render(h(UserText, { sessionId: 'session-1', raw: '# 标题\n\n用户自己的消息\n第二行' })))
      await flush(); await flush()
      expect(host.textContent).toContain('用户自己的消息')
      expect(host.querySelector('br')).not.toBeNull()
      expect(wire.composition.mock.calls.length).toBe(calls)
      // A pasted, unfenced JSON array becomes an indented json code block.
      await act(async () => root.render(h(UserText, { sessionId: 'session-1', raw: 'Run these calls.\n[\n[\n"search",\n{\n"query": "K13"\n}\n]\n]' })))
      await flush(); await flush()
      const code = host.querySelector('code[data-iexp-code-language="json"]')
      expect(code?.textContent).toBe('[\n  [\n    "search",\n    {\n      "query": "K13"\n    }\n  ]\n]')
      expect(wire.composition.mock.calls.length).toBe(calls)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      cleanups.reverse().forEach(dispose => dispose())
    }
  })

  it('honors table and records decisions without chart substitution on a non-continuous theme', async () => {
    const numeric = '# 数值表\n\n| 项目 | 金额（亿元） |\n| --- | ---: |\n| 训练 | 23.80 |\n| 推理 | 97.41 |'
    const narrativeRows = ['需求增长', '基准情况', '融资收紧'].map(title => `| ${title} | ${'条件原文，保持完整口径。'.repeat(8)} | ${'观察指标原文，保持完整来源。'.repeat(8)} |`).join('\n')
    const records = `| 情景 | 形成条件 | 观察指标 |\n| --- | --- | --- |\n${narrativeRows}`
    const api = makeApi(input => Promise.resolve(selectedResult({
      themeId: 'plain',
      layout: input.documentId === 'markdown-table' ? 'table' : 'records',
    }, input.documentId)))
    const table = await render(numeric, api.api, { documentId: 'markdown-table' })
    const detail = await render(records, api.api, { documentId: 'markdown-records' })
    await waitForSelection(table.host)
    await waitForSelection(detail.host)

    expect(table.host.querySelector('table')).not.toBeNull()
    expect(table.host.querySelector('[data-auto-chart]')).toBeNull()
    expect(table.host.querySelector('.iexp-chart-grid')).toBeNull()
    expect(detail.host.querySelector('.iexp-continuous')).toBeNull()
    expect(detail.host.querySelector('[data-content-layout="master-detail"]')).not.toBeNull()
    expect(detail.host.querySelector('.iexp-object-detail')?.textContent).toContain('需求增长')
    expect(detail.host.querySelector('[data-auto-chart]')).toBeNull()
  })

  it('keeps heading-index and continuous as distinct planned layouts for a long chapter source', async () => {
    const source = `# 长篇报告\n\n导言保留完整。\n\n## 背景\n\n背景段落与来源口径。\n\n## 证据\n\n| 项目 | 数值 |\n| --- | ---: |\n| A | 12 |\n| B | 18 |\n\n## 方法\n\n方法段落保留完整。\n\n## 限制\n\n限制与不确定性说明。\n\n## 结论\n\n结论段落保留完整。`
    const api = makeApi(input => Promise.resolve(selectedResult({
      themeId: 'plain',
      layout: input.documentId === 'planned-heading-index' ? 'heading-index' : 'continuous',
    }, input.documentId)))
    const heading = await render(source, api.api, { documentId: 'planned-heading-index' })
    const continuous = await render(source, api.api, { documentId: 'planned-continuous' })
    await waitForSelection(heading.host)
    await waitForSelection(continuous.host)

    expect(heading.host.querySelector('[data-content-layout="heading-index"]')).not.toBeNull()
    expect(heading.host.querySelector('.iexp-continuous')).toBeNull()
    expect(continuous.host.querySelector('.iexp-continuous')).not.toBeNull()
    expect(continuous.host.querySelectorAll('.iexp-story-section')).toHaveLength(5)
    expect(continuous.host.querySelector('[data-content-layout="heading-index"]')).not.toBeNull()
    expect(continuous.host.textContent).toContain('限制与不确定性说明。')
  })

  it.each([
    ['streaming', { isStreaming: true, settings: settings() }],
    ['adaptive disabled', { settings: settings({ adaptive: { enabled: false, styleMode: 'automatic' } }) }],
    ['takeover disabled', { settings: settings({ takeover: false }) }],
  ])('does not send a composition request while %s', async (_label, options: MountOptions) => {
    const api = makeApi(() => Promise.resolve(selectedResult()))
    const mount = await render('源内容仍然可见。', api.api, { ...options, documentId: `disabled-${_label}` })
    await flush()

    expect(api.composition).not.toHaveBeenCalled()
    expect(api.compositionCancel).not.toHaveBeenCalled()
    expect(mount.host.textContent).toContain('源内容仍然可见。')
  })

  it('writes an observed receipt only after a selected composition is mounted', async () => {
    const decision = deferred<CompositionResult>()
    let host: HTMLDivElement | undefined
    const api = makeApi(() => decision.promise)
    api.compositionReceipt.mockImplementation(async input => {
      expect(host?.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()
      return { status: 'observed' as const, input }
    })
    const mount = await render(taskRecords, api.api, { documentId: 'receipt-document' })
    host = mount.host
    await flush()
    expect(api.compositionReceipt).not.toHaveBeenCalled()

    decision.resolve(selectedResult({ themeId: 'uiverse-soft-relief', componentSet: 'soft-relief', layout: 'board' }, 'operation-receipt'))
    await flush()
    await waitForSelection(mount.host)
    await flush()

    expect(api.compositionReceipt).toHaveBeenCalledOnce()
    expect(api.compositionReceipt).toHaveBeenCalledWith({
      sessionId: 'session-1', documentId: 'receipt-document', sourceVersion: 'sha256:source-version', operationId: 'operation-receipt', observed: true,
    })
  })
})
