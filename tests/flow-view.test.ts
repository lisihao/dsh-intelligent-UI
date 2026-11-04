// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFlowGraph, FlowView, type FlowViewPlan } from '../src/flow-view.js'
import { layoutFlow, roundedRoute } from '../src/flow-layout.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // jsdom has no graphics context; real GPU behavior has its own controller and browser checks.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const plan: FlowViewPlan = {
  title: '来源流程', nodes: [{ id: 'a', label: '准备', description: '保留原始说明。' }, { id: 'b', label: '检查' }, { id: 'c', label: '交付' }, { id: 'd', label: '独立项目' }],
  edges: [{ source: 'a', target: 'b', label: '符合条件时' }, { source: 'b', target: 'c' }], sourceText: '准备 → 检查 → 交付\n<script>原文</script>', reason: '只表示原文关系。',
}
// jsdom has no SVG getBBox. Exact labels are checked in the adapter and browser;
// interactive tests exercise real paths without pretending to measure SVG text.
const mountedPlan: FlowViewPlan = { ...plan, edges: plan.edges.map(({ source, target }) => ({ source, target })) }

async function waitForFlow(host: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 100 && !host.querySelector('.react-flow__node'); attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(host.querySelector('[role="alert"]')?.textContent).toBeUndefined()
  expect(host.querySelector('.react-flow__node')).not.toBeNull()
}

describe('read-only source flow', () => {
  it('preserves exact content and highlights only the selected node’s actual adjacency', async () => {
    const geometry = await layoutFlow(plan)
    const graph = buildFlowGraph(plan, geometry, { selectedNodeId: 'b', animate: true })
    expect(graph.nodes.map(node => node.data.label)).toEqual(plan.nodes.map(node => node.label))
    expect(graph.nodes[0]!.data.description).toBe('保留原始说明。')
    expect(graph.nodes.filter(node => node.data.related).map(node => node.id)).toEqual(['a', 'b', 'c'])
    expect(graph.nodes.find(node => node.id === 'd')!.className).toBe('iexp-flow-node-muted')
    expect(graph.edges.map(edge => [edge.source, edge.target, edge.label])).toEqual(plan.edges.map(edge => [edge.source, edge.target, edge.label]))
    // Motion is a disposable GPU overlay; SVG remains a static source of geometry.
    expect(graph.edges.every(edge => !edge.animated && edge.type === 'routed')).toBe(true)
    const selectedEnd = buildFlowGraph(plan, geometry, { selectedNodeId: 'a', animate: true })
    expect(selectedEnd.edges.map(edge => edge.className)).toEqual(['iexp-flow-edge-active', 'iexp-flow-edge-muted'])
    expect(graph.nodes.every(node => node.draggable === false && node.connectable === false && node.deletable === false && node.focusable)).toBe(true)
    expect(graph.edges.every(edge => edge.reconnectable === false && edge.deletable === false)).toBe(true)
  })

  it('routes execution forks downwards while preserving progress and state updates without moving nodes', async () => {
    const execution: FlowViewPlan = { direction: 'DOWN', execution: true,
      nodes: ['lead', 'worker-a', 'worker-b', 'review'].map(id => ({ id, label: id, execution: { id, label: id, role: id === 'lead' ? 'lead' : 'worker', status: 'running', progress: {current: 3, total: 10} } })),
      edges: [{source: 'lead', target: 'worker-a', executionStatus: 'active'}, {source: 'lead', target: 'worker-b', executionStatus: 'idle'}, {source: 'worker-a', target: 'review'}, {source: 'worker-b', target: 'review'}] }
    const original = JSON.stringify(execution), geometry = await layoutFlow(execution)
    for (const [index, route] of geometry.routes.entries()) {
      const edge = execution.edges[index]!, from = geometry.nodes.find(node => node.id === edge.source)!, to = geometry.nodes.find(node => node.id === edge.target)!
      expect(to.y).toBeGreaterThan(from.y)
      expect(route.points[0]).toEqual({x: from.x + from.width / 2, y: from.y + from.height + 3})
      expect(route.points.at(-1)).toEqual({x: to.x + to.width / 2, y: to.y - 3})
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, {plan: execution}))); await waitForFlow(host)
    const first = host.querySelector<HTMLElement>('.react-flow__node')!, position = first.style.transform
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('3')
    const updated: FlowViewPlan = {...execution, nodes: execution.nodes.map(node => ({...node, execution: {...node.execution!, status: 'succeeded', progress: {current: 10, total: 10}}}))}
    await act(async () => root.render(createElement(FlowView, {plan: updated})))
    expect(host.querySelector('.react-flow__node')).toBe(first)
    expect(first.style.transform).toBe(position)
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('10')
    expect(host.querySelector('[data-execution-status=succeeded]')).not.toBeNull()
    expect(JSON.stringify(execution)).toBe(original)
    await act(async () => root.unmount()); host.remove()
  })

  it('lays out cycles, branches and disconnected nodes deterministically without overlap', async () => {
    const cyclic: FlowViewPlan = {
      nodes: Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: `${i} 原文中的较长中文节点名称`.repeat(i % 3 + 1), description: i % 4 === 0 ? '原文说明'.repeat(12) : undefined })),
      edges: [{ source: '0', target: '1' }, { source: '1', target: '2' }, { source: '2', target: '0' }, { source: '2', target: '3' }, { source: '1', target: '4' }, { source: '4', target: '4' }],
    }
    const geometry = await layoutFlow(cyclic)
    const nodes = buildFlowGraph(cyclic, geometry).nodes
    expect((await layoutFlow(cyclic)).nodes.map(node => [node.x, node.y])).toEqual(nodes.map(node => [node.position.x, node.position.y]))
    for (const [i, node] of nodes.entries()) for (const other of nodes.slice(i + 1)) {
      const separated = node.position.x + Number(node.style!.width) <= other.position.x || other.position.x + Number(other.style!.width) <= node.position.x ||
        node.position.y + Number(node.style!.minHeight) <= other.position.y || other.position.y + Number(other.style!.minHeight) <= node.position.y
      expect(separated).toBe(true)
    }
    expect(buildFlowGraph(cyclic, geometry).edges).toHaveLength(cyclic.edges.length)
  })

  it('honors complete safe source coordinates and relays overlapping coordinates to ELK', async () => {
    const positioned: FlowViewPlan = { nodes: [{ id: 'a', label: 'A', position: { x: 20, y: 40 } }, { id: 'b', label: 'B', position: { x: 400, y: 200 } }], edges: [] }
    expect((await layoutFlow(positioned)).nodes.map(node => ({ x: node.x, y: node.y }))).toEqual(positioned.nodes.map(node => node.position))
    const overlap = { ...positioned, nodes: positioned.nodes.map(node => ({ ...node, position: { x: 0, y: 0 } })) }
    expect((await layoutFlow(overlap)).kind).toBe('elk')
    expect(positioned.nodes[1]!.position).toEqual({ x: 400, y: 200 })
  })

  it('routes a 13-node / 16-edge graph around every unrelated node, including long skips', async () => {
    const source: FlowViewPlan = {
      nodes: Array.from({ length: 13 }, (_, i) => ({ id: `module-${i}`, label: ['presentation', 'content-layout', 'contracts', 'flow-view', 'layout-view'][i] ?? `模块 ${i}` })),
      edges: [...Array.from({ length: 12 }, (_, i) => ({ source: `module-${i}`, target: `module-${i + 1}` })),
        { source: 'module-0', target: 'module-4', label: '保留原文的直接关系' }, { source: 'module-2', target: 'module-8' }, { source: 'module-3', target: 'module-10' }, { source: 'module-12', target: 'module-1' }],
    }
    const original = JSON.stringify(source)
    const geometry = await layoutFlow(source)
    expect(geometry.kind).toBe('elk'); expect(geometry.routes).toHaveLength(16)
    for (const [i, route] of geometry.routes.entries()) {
      const edge = source.edges[i]!
      const from = geometry.nodes.find(node => node.id === edge.source)!
      const to = geometry.nodes.find(node => node.id === edge.target)!
      expect(route.points[0]).toEqual({ x: from.x + from.width + 3, y: from.y + from.height / 2 })
      expect(route.points.at(-1)).toEqual({ x: to.x - 3, y: to.y + to.height / 2 })
      for (const obstacle of geometry.nodes.filter(node => node.id !== edge.source && node.id !== edge.target)) {
        for (let j = 1; j < route.points.length; j += 1) {
          const a = route.points[j - 1]!; const b = route.points[j]!
          const crosses = a.y === b.y
            ? a.y > obstacle.y && a.y < obstacle.y + obstacle.height && Math.max(a.x, b.x) > obstacle.x && Math.min(a.x, b.x) < obstacle.x + obstacle.width
            : a.x > obstacle.x && a.x < obstacle.x + obstacle.width && Math.max(a.y, b.y) > obstacle.y && Math.min(a.y, b.y) < obstacle.y + obstacle.height
          expect(crosses, `route ${i} crosses ${obstacle.id}`).toBe(false)
        }
      }
      const path = roundedRoute(route.points)
      expect(path).toMatch(/^M/); expect(path).not.toContain('NaN')
    }
    const graph = buildFlowGraph(source, geometry)
    expect(graph.edges[12]!.label).toBe('保留原文的直接关系')
    expect(geometry.routes[12]!.label).toBeDefined()
    expect(JSON.stringify(source)).toBe(original)
  })

  it('shows a named layout error and original content when a graph cannot be laid out', async () => {
    const invalid = { ...mountedPlan, nodes: mountedPlan.nodes.slice(1) }
    await expect(layoutFlow(invalid)).rejects.toMatchObject({ name: 'FlowLayoutError' })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, { plan: invalid })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('FlowLayoutError')
    expect(host.querySelector('.react-flow__edge-path')).toBeNull()
    expect(host.querySelector('details pre')!.textContent).toBe(plan.sourceText)
    await act(async () => root.unmount()); host.remove()
  })

  it('renders visible nodes and every source edge before an observer measurement arrives', async () => {
    // The suite's observer does not publish measurements. This exercises React Flow's public
    // initial dimensions/handles path rather than relying on a browser-only measurement event.
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan })))
    await waitForFlow(host)
    const nodes = Array.from(host.querySelectorAll<HTMLElement>('.react-flow__node'))
    expect(nodes).toHaveLength(plan.nodes.length)
    expect(nodes.every(node => node.style.visibility === 'visible')).toBe(true)
    expect(host.querySelectorAll('.react-flow__edge-path')).toHaveLength(plan.edges.length)
    for (const path of host.querySelectorAll('.react-flow__edge-path')) {
      expect(path.getAttribute('d')).toMatch(/^M/)
      expect(path.getAttribute('d')).not.toContain('NaN')
    }
    await act(async () => root.unmount()); host.remove()
  })

  it('retains exact source labels while layout is pending without drawing guessed edges', () => {
    const html = renderToStaticMarkup(createElement(FlowView, { plan }))
    expect(html).toContain('符合条件时')
    expect(html).toContain('正在排列原文节点与连线')
    expect(html).not.toContain('react-flow__edge-path')
  })

  it('pauses and resumes relation motion and retains escaped original source', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan })))
    await waitForFlow(host)
    const motion = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '暂停连线动效')!
    expect(host.querySelector('figure')!.dataset.motion).toBe('flowing')
    await act(async () => motion.click())
    expect(motion.textContent).toBe('恢复连线动效'); expect(motion.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('figure')!.dataset.motion).toBe('still')
    await act(async () => motion.click())
    expect(motion.textContent).toBe('暂停连线动效')
    expect(host.querySelector('details pre')!.textContent).toBe(plan.sourceText)
    expect(host.querySelector('details script')).toBeNull()
    expect(host.textContent).toContain('不表示执行状态')
    await act(async () => root.unmount()); host.remove()
  })

  it('keeps the initial reading zoom, lets an explicit overview zoom out, and returns to reading size', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan })))
    await waitForFlow(host)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const zoom = () => Number(host.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform.match(/scale\(([^)]+)\)/)![1])
    expect(zoom()).toBe(1)
    // Supply this viewport's fixture dimensions; jsdom does not perform CSS layout.
    const viewport = host.querySelector<HTMLElement>('.iexp-flow-viewport')!
    Object.defineProperties(viewport, { clientWidth: { value: 500 }, clientHeight: { value: 440 } })
    const overview = host.querySelector<HTMLButtonElement>('button[aria-label="查看全图"]')!
    expect(overview).not.toBeNull()
    await act(async () => overview.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(zoom()).toBeLessThan(0.8)
    expect(zoom()).toBeGreaterThanOrEqual(0.15)
    const start = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '回到起点')!
    await act(async () => { start.click(); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(zoom()).toBe(1)
    expect(host.querySelectorAll('.react-flow__edge-path')).toHaveLength(plan.edges.length)
    expect(host.querySelector('details pre')!.textContent).toBe(plan.sourceText)
    await act(async () => root.unmount()); host.remove()
  })

  it('activates nodes by pointer and keyboard and keeps the same source relationships', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const activate = vi.fn()
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan, onNodeActivate: activate })))
    await waitForFlow(host)
    const first = host.querySelector<HTMLElement>('.react-flow__node[data-id="a"]')!
    const second = host.querySelector<HTMLElement>('.react-flow__node[data-id="b"]')!
    expect(first.getAttribute('aria-label')).toBe('准备，保留原始说明。')
    await act(async () => first.click())
    expect(activate).toHaveBeenLastCalledWith('a')
    expect(host.querySelector('.iexp-flow-selection[role="status"]')!.textContent).toContain('准备 → 检查')
    expect(host.querySelector('.iexp-flow-selection[role="status"]')!.textContent).not.toContain('检查 → 交付')
    await act(async () => second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(activate.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    expect(host.querySelector('.iexp-flow-selection[role="status"]')!.textContent).toContain('检查 → 交付')
    await act(async () => root.unmount()); host.remove()
  })

  it('respects reduced motion and omits motion controls for an orientation graph', async () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', () => query)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan })))
    await waitForFlow(host)
    const motion = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '系统已关闭动效')!
    expect(motion.disabled).toBe(true); expect(host.querySelector('figure')!.dataset.motion).toBe('still')
    await act(async () => root.render(createElement(FlowView, { plan: mountedPlan, motion: false })))
    expect(host.textContent).not.toContain('系统已关闭动效')
    expect(host.textContent).not.toContain('暂停连线动效')
    await act(async () => root.unmount()); host.remove()
    expect(query.removeEventListener.mock.calls).toEqual(query.addEventListener.mock.calls)
  })
})
