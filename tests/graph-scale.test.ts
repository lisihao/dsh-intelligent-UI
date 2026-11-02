import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeGraph } from '../src/content-layout.js'
import { layoutFlow, sourceOverviewGeometry, type FlowViewPlan } from '../src/flow-layout.js'
import { flowWindow, flowNeighborhoodPages, indexFlow, FLOW_VISIBLE_NODE_LIMIT, FLOW_VISIBLE_EDGE_LIMIT } from '../src/flow-scale.js'
const large = (): FlowViewPlan => ({ nodes: Array.from({ length: 1000 }, (_, i) => ({ id: `node-${i}`, label: `原文节点 ${i}`, description: `保留说明 ${i}` })), edges: Array.from({ length: 5000 }, (_, i) => ({ source: `node-${i % 1000}`, target: `node-${(i * 7 + 1) % 1000}`, label: `原文连线 ${i}` })) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('source-preserving graph scale', () => {
  it('admits and preserves 1000 nodes / 5000 directed edges below the host byte boundary', () => {
    const plan = large(), before = JSON.stringify(plan)
    expect(new TextEncoder().encode(before).length).toBeLessThan(1024 * 1024)
    expect(analyzeGraph(plan)).toEqual({ status: 'valid', plan: { kind: 'graph', ...plan } })
    const source = indexFlow(plan)
    expect(source.nodes.size).toBe(1000)
    expect(source.incident.get('node-999')).toContain(4999)
    expect(JSON.stringify(plan)).toBe(before)
  })
  it('keeps large source order separate from inferred topology and bounds only the drawing projection', () => {
    const plan = large(), geometry = sourceOverviewGeometry(plan)
    expect(geometry.kind).toBe('overview'); expect(geometry.nodes.map(node => node.id)).toEqual(plan.nodes.map(node => node.id))
    const all = flowWindow(plan, geometry, { x: 0, y: 0, zoom: 0.01 }, 3440, 1440)
    expect(all.nodes.length).toBeLessThanOrEqual(FLOW_VISIBLE_NODE_LIMIT)
    expect(all.edges.length).toBeLessThanOrEqual(FLOW_VISIBLE_EDGE_LIMIT)
    const last = geometry.nodes.at(-1)!
    const moved = flowWindow(plan, geometry, { x: 28 - last.x, y: 36 - last.y, zoom: 1 }, 800, 440)
    expect(moved.nodes.some(node => node.id === 'node-999')).toBe(true)
    for (const [index, edge] of moved.edges.entries()) expect(edge).toBe(plan.edges[moved.edgeIndexes[index]!])
    expect(plan.edges).toHaveLength(5000)
  })
  it('lays out the last ring node with all ten direct relations instead of an isolated global position', async () => {
    const plan = large()
    plan.edges = Array.from({ length: 5000 }, (_, index) => ({ source: `node-${Math.floor(index / 5)}`, target: `node-${(Math.floor(index / 5) + index % 5 + 1) % 1000}`, label: `relation ${index}` }))
    const source = indexFlow(plan), pages = flowNeighborhoodPages(plan, source, 'node-999')
    expect(pages).toHaveLength(1); expect(pages[0]!.nodes).toHaveLength(11); expect(pages[0]!.edges).toHaveLength(10)
    expect(pages[0]!.edgeIndexes).toEqual(source.incident.get('node-999'))
    for (const [index, edge] of pages[0]!.edges.entries()) expect(edge).toBe(plan.edges[pages[0]!.edgeIndexes[index]!])
    const geometry = await layoutFlow(pages[0]!, { compact: true })
    expect(geometry.kind).toBe('elk'); expect(geometry.nodes).toHaveLength(11); expect(geometry.routes).toHaveLength(10)
    expect(geometry.nodes.every(node => node.height === 72)).toBe(true)
  })
  it('pages high-degree and repeated incident links without silently losing source edges', () => {
    const plan = large(); plan.edges = Array.from({ length: 5000 }, (_, index) => ({ source: 'node-999', target: `node-${index % 999}`, label: `relation ${index}` }))
    const source = indexFlow(plan), pages = flowNeighborhoodPages(plan, source, 'node-999')
    expect(pages.every(page => page.nodes.length <= 25 && page.edges.length <= 100)).toBe(true)
    expect(pages.flatMap(page => page.edgeIndexes)).toEqual(source.incident.get('node-999'))
    expect(pages.flatMap(page => page.edges)).toEqual(plan.edges)
    plan.edges = Array.from({ length: 5000 }, (_, index) => ({ source: 'node-999', target: 'node-0', label: `relation ${index}` }))
    const repeats = flowNeighborhoodPages(plan, indexFlow(plan), 'node-999')
    expect(repeats).toHaveLength(50); expect(repeats.every(page => page.edges.length === 100)).toBe(true)
    expect(repeats.flatMap(page => page.edges)).toEqual(plan.edges)
  })
  it('names unavailable workers rather than running a big inline ELK job', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(layoutFlow(large())).rejects.toMatchObject({ name: 'FlowLayoutWorkerUnavailable' })
  })
  it('retains a byte boundary and graph identity checks', () => {
    const huge = { nodes: Array.from({ length: 120 }, (_, i) => ({ id: String(i), label: 'label', description: 'x'.repeat(9000) })), edges: [] }
    expect(analyzeGraph(huge).status).toBe('invalid')
    const plan = large(); plan.nodes[999]!.id = plan.nodes[0]!.id
    expect(analyzeGraph(plan).status).toBe('invalid')
  })
  it('uses the dedicated worker result and releases its resources on success', async () => {
    const terminate = vi.fn(), revoke = vi.spyOn(URL, 'revokeObjectURL'); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:graph-success')
    class CompletingWorker {
      onmessage?: (event: { data: unknown }) => void
      addEventListener() {}
      terminate = terminate
      postMessage(message: { id: number, cmd: string, graph?: { children: { id: string }[] } }) {
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, data: message.cmd === 'layout' ? { ...message.graph, children: message.graph!.children.map((node, index) => ({ ...node, x: index * 288, y: 24 })) } : undefined } }))
      }
    }
    vi.stubGlobal('Worker', CompletingWorker); vi.stubGlobal('__IEXP_ELK_WORKER_SOURCE__', 'source for worker result boundary test')
    const result = await layoutFlow(large())
    expect(result.kind).toBe('elk'); expect(result.algorithm).toBe('force'); expect(result.nodes).toHaveLength(1000)
    expect(result.nodes.at(-1)?.id).toBe('node-999'); expect(result.nodes.at(-1)?.x).toBe(999 * 288)
    expect(terminate).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith('blob:graph-success')
  })
  it('preserves the actual library error message in a capped visible diagnostic', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:graph-error'); vi.spyOn(URL, 'revokeObjectURL')
    class FailingWorker {
      onmessage?: (event: { data: unknown }) => void
      addEventListener() {}
      terminate() {}
      postMessage(message: { id: number, cmd: string }) {
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...(message.cmd === 'layout' ? { error: { message: 'Maximum call stack size exceeded: ' + 'x'.repeat(1000) } } : { data: undefined }) } }))
      }
    }
    vi.stubGlobal('Worker', FailingWorker); vi.stubGlobal('__IEXP_ELK_WORKER_SOURCE__', 'source for actual error boundary test')
    const error = await layoutFlow(large()).catch(error => error) as Error
    expect(error.name).toBe('FlowLayoutWorkerError'); expect(error.message).toContain('Maximum call stack size exceeded')
    expect(error.message.length).toBeLessThan(600)
  })
  it('terminates and revokes a timed-out dedicated worker', async () => {
    const terminate = vi.fn(), revoke = vi.spyOn(URL, 'revokeObjectURL'), create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:graph-test')
    class WaitingWorker { onmessage?: (event: unknown) => void; postMessage() {} addEventListener() {} terminate = terminate }
    vi.stubGlobal('Worker', WaitingWorker); vi.stubGlobal('__IEXP_ELK_WORKER_SOURCE__', 'source for worker boundary test')
    await expect(layoutFlow(large(), { timeoutMs: 5 })).rejects.toMatchObject({ name: 'FlowLayoutTimeout' })
    expect(create).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith('blob:graph-test')
  })
  it('cancels and disposes a dedicated worker without dropping source data', async () => {
    const terminate = vi.fn(), revoke = vi.spyOn(URL, 'revokeObjectURL'); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:graph-abort')
    class WaitingWorker { postMessage() {} addEventListener() {} terminate = terminate }
    vi.stubGlobal('Worker', WaitingWorker); vi.stubGlobal('__IEXP_ELK_WORKER_SOURCE__', 'source for worker boundary test')
    const controller = new AbortController(), plan = large(), promise = layoutFlow(plan, { signal: controller.signal }); controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'FlowLayoutCancelled' })
    expect(terminate).toHaveBeenCalled(); expect(revoke).toHaveBeenCalledWith('blob:graph-abort'); expect(plan.edges).toHaveLength(5000)
  })
})
