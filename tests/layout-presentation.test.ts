// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactView, ContentView, DisplayModeControl, displayModes } from '../src/presentation.js'
import type { ExperienceArtifact } from '../src/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root, host: HTMLDivElement }> = []
const scrollIntoView = vi.fn()
beforeEach(() => {
  displayModes.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
  scrollIntoView.mockClear()
})
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove() }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
async function mount(element: ReactElement) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ root, host })
  await act(async () => root.render(element))
  return { host, render: async (next: ReactElement) => { await act(async () => root.render(next)) } }
}
async function waitForFlowNodes(host: HTMLElement, count: number) {
  // Keep each real asynchronous ELK/layout interval inside act; no renderer or geometry substitute.
  const deadline = Date.now() + 5_000
  while (host.querySelectorAll('.react-flow__node').length !== count && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(host.querySelectorAll('.react-flow__node')).toHaveLength(count)
}
function artifact(payload: ExperienceArtifact['payload'], raw: ExperienceArtifact['raw'] = payload): ExperienceArtifact {
  return { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 'layouts', kind: 'generated', label: '源内容' }, protocol: 'content', raw, payload, providerId: 'test' }
}
async function searchTasks(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
// jsdom has no SVG getBBox; edge-label measurement is covered in the browser and pure graph tests.
const graph: ExperienceArtifact['payload'] = { nodes: [{ id: 'private-source', label: '读取原文', description: '保持来源说明。' }, { id: 'private-target', label: '核对结果' }], edges: [{ source: 'private-source', target: 'private-target' }] }
const tasks = [{ id: 'secret-A', title: '检查原文', status: '等待外部 🟠', description: '不得推断完成' }, { id: 'secret-B', title: '保存结果', status: '自定义状态', description: '保留原值' }, { id: 'secret-C', title: '检查回执', status: '等待外部 🟠', description: '保持先后顺序' }]

describe('actual automatic layout routing', () => {
  it('keeps expanded source and chapter navigation when unchanged artifacts refresh', async () => {
    const text = '# Report\n\n## Basis\n\n| Item | Cost (USD) |\n| --- | ---: |\n| A | 12 |\n| B | 20 |\n\n## Method\n\nSource.\n\n## Results\n\nSource.\n\n## Notes\n\nSource.'
    const { host, render } = await mount(h(ArtifactView, { artifact: artifact(text) }))
    const chapter = host.querySelector<HTMLDetailsElement>('details.iexp-heading-index')!
    const source = host.querySelector<HTMLDetailsElement>('details.iexp-full-table')!
    expect(chapter).not.toBeNull(); expect(source).not.toBeNull()
    await act(async () => { chapter.open = true; source.open = true })
    await render(h(ArtifactView, { artifact: artifact(text) }))
    expect(host.querySelector('details.iexp-heading-index')).toBe(chapter)
    expect(chapter.open).toBe(true)
    expect(host.querySelector('details.iexp-full-table')).toBe(source)
    expect(source.open).toBe(true)
  })

  it('renders canonical graphs through real React Flow and preserves pause state across shared raw mode', async () => {
    const raw = '  原始回执\n<script>必须保留为文字</script>  '
    const { host } = await mount(h('div', null, h(DisplayModeControl, { sessionId: 'layouts' }), h(ArtifactView, { artifact: artifact(graph, raw) })))
    await waitForFlowNodes(host, 2)
    expect([...host.querySelectorAll('.react-flow__node strong')].map(node => node.textContent)).toEqual(['读取原文', '核对结果'])
    expect(host.querySelector('.react-flow')).not.toBeNull()
    expect(host.querySelector('.iexp-flow-source pre')?.textContent).toBe(JSON.stringify(graph, null, 2))
    const pause = [...host.querySelectorAll('button')].find(button => button.textContent === '暂停连线动效')!
    await act(async () => pause.click())
    expect(host.querySelector('figure')?.dataset.motion).toBe('still')
    const mode = host.querySelector('select')!
    await act(async () => { mode.value = 'raw'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector('[hidden] .react-flow')).not.toBeNull()
    expect([...host.querySelectorAll('pre')].at(-1)?.textContent).toBe(raw)
    expect(host.querySelector('script')).toBeNull()
    await act(async () => { mode.value = 'visual'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector('figure')?.dataset.motion).toBe('still')
    expect(pause.textContent).toBe('恢复连线动效')
    expect(host.querySelector('[hidden] .react-flow')).toBeNull()
  })

  it('automatically projects source execution updates and retains every original field', async () => {
    const record = {kind: 'execution-flow', title: '验证执行快照', privateNote: '必须保留的额外字段', nodes: [{id: 'a', label: '核对', role: 'worker', status: 'running', progress: {current: 2, total: 8, unit: '项'}}], edges: [], events: [{id: 'e1', nodeId: 'a', message: '已检查两项'}]}
    const original = JSON.stringify(record), {host, render} = await mount(h(ContentView, {value: record}))
    await waitForFlowNodes(host, 1)
    expect(host.querySelector('[data-execution-flow]')).not.toBeNull()
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('2')
    expect(host.querySelector('.iexp-flow-source pre')?.textContent).toBe(JSON.stringify(record, null, 2))
    expect(host.querySelector('[data-execution-log]')?.textContent).toContain('已检查两项')
    const node = host.querySelector('.react-flow__node')!
    const updated = {...record, nodes: [{...record.nodes[0]!, status: 'done', progress: {current: 8, total: 8, unit: '项'}}], events: [...record.events, {id: 'e2', nodeId: 'a', message: '核对完成'}]}
    await render(h(ContentView, {value: updated}))
    expect(host.querySelector('.react-flow__node')).toBe(node)
    expect(host.querySelector('[data-execution-status=succeeded]')).not.toBeNull()
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('8')
    expect(host.querySelector('[data-execution-log]')?.textContent).toContain('核对完成')
    expect(host.querySelector('.iexp-flow-source pre')?.textContent).toBe(JSON.stringify(updated, null, 2))
    expect(JSON.stringify(record)).toBe(original)
    await render(h(ContentView, {value: {...record, nodes: [{...record.nodes[0]!, progress: {current: 9, total: 8}}]}}))
    expect(host.querySelector('[role=alert]')?.textContent).toContain('执行流程数据无法显示')
    expect(host.querySelector('.react-flow')).toBeNull()
  })

  it('makes invalid explicit graphs visibly fail and retains every original value', async () => {
    const invalid = { nodes: [{ id: 'a', label: '有效节点' }], edges: [{ source: 'a', target: 'missing-target', label: '<img onerror="untrusted">' }] }
    const { host } = await mount(h(ContentView, { value: invalid }))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('关系图数据不完整')
    expect(host.querySelector('pre')?.textContent).toBe(JSON.stringify(invalid, null, 2))
    expect(host.querySelector('.react-flow')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
  })

  it('routes explicit arrows and contextual ordered steps while preserving numbered information gaps', async () => {
    const markdown = '## 操作步骤\n\n1. 读取全部原文\n2. 核对真实回执\n\n## 阶段关系\n\n准备 → 验证 -> 保存\n\n## 六项关键信息缺口\n\n1. 收入的定义\n2. 费用的口径\n3. 披露的范围'
    const { host } = await mount(h(ContentView, { value: markdown }))
    await waitForFlowNodes(host, 5)
    expect(host.querySelectorAll('.iexp-flow')).toHaveLength(2)
    expect([...host.querySelectorAll('.iexp-flow-source pre')].map(node => node.textContent)).toEqual(['1. 读取全部原文\n2. 核对真实回执', '准备 → 验证 -> 保存'])
    expect([...host.querySelectorAll('.react-flow__node strong')].map(node => node.textContent)).toEqual(['读取全部原文', '核对真实回执', '准备', '验证', '保存'])
    expect([...host.querySelectorAll('ol > li')].map(node => node.textContent)).toEqual(['收入的定义', '费用的口径', '披露的范围'])
    expect(host.textContent).toContain('未推断额外的依赖或因果关系')
  })

  it('groups JSON tasks by exact unknown status while source records retain the interleaved input order', async () => {
    const { host } = await mount(h(ContentView, { value: tasks }))
    const board = host.querySelector('[data-content-layout="board"]')!
    expect([...board.querySelectorAll('.iexp-board-column')].map(column => column.getAttribute('aria-label'))).toEqual(['状态：等待外部 🟠', '状态：自定义状态'])
    expect([...board.querySelectorAll('.iexp-board-column:first-child h5')].map(node => node.textContent)).toEqual(['检查原文', '检查回执'])
    expect(board.querySelector('.iexp-board-columns')?.textContent).not.toContain('secret-A')
    expect(JSON.parse(board.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
    expect(board.querySelector('input[type="search"]')?.getAttribute('aria-label')).toBe('搜索任务')
    expect(board.querySelectorAll('select,button,[draggable="true"]')).toHaveLength(0)
  })

  it('filters reader cards locally, reports matching and empty states, and recovers the unchanged source', async () => {
    const { host } = await mount(h(ContentView, { value: tasks }))
    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索任务"]')!
    await searchTasks(search, '保存结果')
    expect([...host.querySelectorAll('.iexp-task h5')].map(node => node.textContent)).toEqual(['保存结果'])
    expect(host.querySelector('.iexp-layout-head')?.textContent).toContain('1 / 3 项任务')
    expect(JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
    await searchTasks(search, '等待外部 🟠')
    expect([...host.querySelectorAll('.iexp-task h5')].map(node => node.textContent)).toEqual(['检查原文', '检查回执'])
    expect(host.querySelector('.iexp-layout-head')?.textContent).toContain('2 / 3 项任务')
    await searchTasks(search, '未匹配的搜索词')
    expect(host.querySelectorAll('.iexp-task')).toHaveLength(0)
    expect(host.querySelector('[role="status"]')?.textContent).toContain('没有匹配的任务')
    expect(host.querySelector('.iexp-layout-head')?.textContent).toContain('0 / 3 项任务')
    expect(JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
    await searchTasks(search, '')
    expect(host.querySelectorAll('.iexp-task')).toHaveLength(tasks.length)
    expect(host.querySelector('.iexp-board-empty')).toBeNull()
    expect(host.querySelector('.iexp-layout-head')?.textContent).toContain('3 项任务')
    expect(JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(tasks)
  })

  it('expands a native long task title while retaining its full original string and source record', async () => {
    const title = '完整参数化用例名'.repeat(370) + '末'
    const records = [{ title, status: '来源状态', id: 'private-long-task' }, { title: '普通任务', status: '来源状态', id: 'private-other-task' }]
    const { host } = await mount(h(ContentView, { value: records }))
    const disclosure = host.querySelector<HTMLDetailsElement>('.iexp-task details')!
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('h5')?.textContent).toBe(title)
    const summary = disclosure.querySelector<HTMLElement>('summary[aria-label="展开或收起完整任务标题"]')!
    await act(async () => summary.click())
    expect(disclosure.open).toBe(true)
    expect(disclosure.querySelector('h5')?.textContent).toBe(title)
    expect(JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(records)
    await act(async () => summary.click())
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('h5')?.textContent).toBe(title)
  })

  it('routes an explicit GFM task table while keeping all source cells in original row order', async () => {
    const markdown = '| 任务名称 | 状态 | 编号 | 说明 |\n|---|---|---|---|\n|核对 A\\|B|等待外部|secret-A|按原口径|\n|保存结果|自定义|secret-B|保持原文|\n|复核结果|等待外部|secret-C|不要漏行|'
    const { host } = await mount(h(ContentView, { value: markdown }))
    expect(host.querySelector('[data-content-layout="board"]')).not.toBeNull()
    expect([...host.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([
      ['核对 A|B', '等待外部', 'secret-A', '按原口径'], ['保存结果', '自定义', 'secret-B', '保持原文'], ['复核结果', '等待外部', 'secret-C', '不要漏行'],
    ])
    const source = JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!) as Array<Record<string, string>>
    expect(source.map(record => record['任务名称'])).toEqual(['核对 A|B', '保存结果', '复核结果'])
    expect(host.querySelector('.iexp-board-columns')?.textContent).not.toContain('secret-')
    expect(host.querySelector('details.iexp-full-table summary')?.textContent).toContain('完整原表')
  })

  it('switches substantial named records without shortening details or exposing internal metadata in the reader fields', async () => {
    const records = [
      { name: '第一项方案', description: '第一项的原始详细内容、约束和未验证条件。'.repeat(8), id: 'hidden-record-A', sessionId: 'hidden-session-A', providerId: 'hidden-provider-A', category: '原文类别一' },
      { name: '第二项方案', description: '第二项的完整说明，不能以列表摘要替代全文。'.repeat(8), id: 'hidden-record-B', sessionId: 'hidden-session-B', providerId: 'hidden-provider-B', category: '原文类别二' },
    ]
    const { host } = await mount(h(ContentView, { value: records }))
    expect(host.querySelector('[data-content-layout="master-detail"]')).not.toBeNull()
    expect(host.querySelector('.iexp-object-description')?.textContent).toBe(records[0]!.description)
    const second = host.querySelectorAll<HTMLButtonElement>('.iexp-object-list button')[1]!
    await act(async () => second.click())
    expect(second.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.iexp-object-detail h3')?.textContent).toBe(records[1]!.name)
    expect(host.querySelector('.iexp-object-description')?.textContent).toBe(records[1]!.description)
    expect(host.querySelector('.iexp-record-fields')?.textContent).toContain('原文类别二')
    expect(host.querySelector('.iexp-record-fields')?.textContent).not.toContain('hidden-')
    expect(host.querySelector('.iexp-object-list')?.textContent).not.toContain('hidden-')
    expect(JSON.parse(host.querySelector('.iexp-layout-source pre')!.textContent!)).toEqual(records[1])
  })

  it('links real unique report headings across two outputs and leaves title and introduction before navigation', async () => {
    const source = '# 原始报告标题\n\n这里是必须先读的完整引言。\n\n## 第一章\n\n正文一。\n\n### 条件\n\n条件说明。\n\n## 第二章\n\n正文二。\n\n## 第三章\n\n正文三。'
    const { host } = await mount(h('div', null, h(ContentView, { value: source }), h(ContentView, { value: source })))
    const docs = [...host.querySelectorAll('.iexp-document')]
    expect(docs).toHaveLength(2)
    const ids = [...host.querySelectorAll('h1,h2,h3')].map(heading => heading.id)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    for (const doc of docs) {
      const navigation = doc.querySelector('[data-content-layout="heading-index"]')!
      expect(doc.querySelector('h1')!.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const introduction = [...doc.querySelectorAll('p')].find(paragraph => paragraph.textContent === '这里是必须先读的完整引言。')!
      expect(introduction.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const links = [...navigation.querySelectorAll<HTMLAnchorElement>('nav a')]
      expect(links.map(link => link.textContent)).toEqual(['第一章', '条件', '第二章', '第三章'])
      for (const link of links) {
        const target = document.getElementById(link.hash.slice(1))!
        expect(doc.contains(target)).toBe(true)
        expect(target.textContent).toBe(link.textContent)
      }
    }
    const link = docs[1]!.querySelectorAll<HTMLAnchorElement>('nav a')[1]!
    await act(async () => link.click())
    expect(document.activeElement?.id).toBe(link.hash.slice(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
  })

  it('navigates actual chapter spokes and retains source-derived subsection counts plus a full linear alternative', async () => {
    const source = '# 报告\n\n原始引言。\n\n## 背景\n\n### 条件\n\n### 范围\n\n## 方法\n\n## 结果\n\n### 限制\n\n## 结论'
    const { host } = await mount(h(ContentView, { value: source }))
    const fan = host.querySelector('svg.iexp-chapter-fan')!
    expect(fan).not.toBeNull()
    const spokes = [...fan.querySelectorAll('a')]
    expect(spokes.map(link => link.getAttribute('aria-label'))).toEqual(['背景，2个子标题', '方法', '结果，1个子标题', '结论'])
    expect([...fan.querySelectorAll('.iexp-chapter-count')].map(node => node.textContent)).toEqual(['2', '1'])
    expect([...host.querySelectorAll('.iexp-heading-index nav a')].map(link => link.textContent)).toEqual(['背景', '条件', '范围', '方法', '结果', '限制', '结论'])
    const result = spokes[2]!
    const target = document.getElementById(result.getAttribute('href')!.slice(1))!
    expect(target.textContent).toBe('结果')
    await act(async () => result.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(target)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(host.querySelector('.react-flow')).toBeNull()
  })

  it('keeps every linear heading link when long or dense source titles are unsuitable for an overview', async () => {
    const cases = [
      ['包含完整资格条件及口径说明的特别长章节标题', '第二章', '第三章', '第四章'],
      Array.from({ length: 9 }, (_, index) => `章节 ${index + 1}`),
    ]
    for (const titles of cases) {
      const source = '# 原报告\n\n' + titles.map(title => `## ${title}\n\n对应原文。`).join('\n\n')
      const { host } = await mount(h(ContentView, { value: source }))
      expect(host.querySelector('.iexp-chapter-fan')).toBeNull()
      const links = [...host.querySelectorAll<HTMLAnchorElement>('.iexp-heading-index nav a')]
      expect(links.map(link => link.textContent)).toEqual(titles)
      for (const link of links) expect(document.getElementById(link.hash.slice(1))?.textContent).toBe(link.textContent)
    }
  })

  it('defers graph, Markdown flow and task board inference until streaming finishes', async () => {
    const { host, render } = await mount(h(ContentView, { value: graph, isStreaming: true }))
    expect(host.querySelector('.react-flow')).toBeNull()
    expect(host.querySelector('pre')?.textContent).toBe(JSON.stringify(graph, null, 2))
    await render(h(ContentView, { value: graph }))
    await waitForFlowNodes(host, 2)
    expect(host.querySelector('.react-flow')).not.toBeNull()
    await render(h(ContentView, { value: tasks, isStreaming: true }))
    expect(host.querySelector('[data-content-layout="board"]')).toBeNull()
    expect(host.textContent).toContain('检查原文')
    await render(h(ContentView, { value: tasks }))
    expect(host.querySelector('[data-content-layout="board"]')).not.toBeNull()
    await render(h(ContentView, { value: '准备 → 验证 → 保存', isStreaming: true }))
    expect(host.querySelector('.react-flow')).toBeNull()
    expect(host.querySelector('p')?.textContent).toBe('准备 → 验证 → 保存')
    await render(h(ContentView, { value: '准备 → 验证 → 保存' }))
    await waitForFlowNodes(host, 3)
    expect(host.querySelector('.react-flow')).not.toBeNull()
  })
})
