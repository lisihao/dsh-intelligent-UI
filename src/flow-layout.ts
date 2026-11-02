import ElkPackage from 'elkjs/lib/elk.bundled.js'
import type { ELK, ElkNode, ElkPoint } from 'elkjs/lib/elk-api.js'

export interface FlowViewPlan {
  title?: string
  nodes: { id: string, label: string, description?: string, position?: { x: number, y: number } }[]
  edges: { source: string, target: string, label?: string }[]
  sourceText?: string
  reason?: string
}
export interface FlowPoint { x: number, y: number }
export interface FlowGeometry {
  kind: 'elk' | 'source' | 'overview'
  algorithm?: 'force'
  nodes: { id: string, x: number, y: number, width: number, height: number }[]
  routes: { id: string, points: FlowPoint[], label?: FlowPoint }[]
}
export class FlowLayoutError extends Error {
  override name = 'FlowLayoutError'
}
export const FLOW_NODE_WIDTH = 240
function textLines(text: string): number {
  return text.split('\n').reduce((lines, line) => lines + Math.max(1, Math.ceil(Array.from(line).reduce((width, character) => width + (/[^\u0000-\u00ff]/u.test(character) ? 2 : 1), 0) / 26)), 0)
}
export function flowNodeHeight(node: FlowViewPlan['nodes'][number]): number {
  return 34 + textLines(node.label) * 24 + (node.description ? 10 + textLines(node.description) * 22 : 0)
}
const finitePoint = (point: ElkPoint | undefined): point is ElkPoint => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y))

/** Small source-positioned chapter fans retain their explicitly supplied geometry. */
export function sourceFanGeometry(plan: FlowViewPlan): FlowGeometry | undefined {
  if (!plan.nodes.length || plan.nodes.length > 8 || !plan.nodes.every(node => finitePoint(node.position))) return
  if (plan.edges.length && (plan.edges.length !== plan.nodes.length - 1 || new Set(plan.edges.map(edge => edge.source)).size !== 1 || new Set(plan.edges.map(edge => edge.target)).size !== plan.edges.length || plan.edges.some(edge => edge.source === edge.target))) return
  if (!plan.nodes.every((node, i) => plan.nodes.slice(i + 1).every(other =>
    Math.abs(node.position!.x - other.position!.x) >= FLOW_NODE_WIDTH + 32 ||
    node.position!.y + flowNodeHeight(node) + 32 <= other.position!.y || other.position!.y + flowNodeHeight(other) + 32 <= node.position!.y))) return
  return { kind: 'source', nodes: plan.nodes.map(node => ({ id: node.id, ...node.position!, width: FLOW_NODE_WIDTH, height: flowNodeHeight(node) })), routes: [] }
}

declare const __IEXP_ELK_WORKER_SOURCE__: string
export const GRAPH_SOURCE_BYTE_LIMIT = 1024 * 1024
export function isLargeFlow(plan: FlowViewPlan): boolean { return plan.nodes.length > 40 || plan.edges.length > 100 }
/** Distribution only: source order carries no inferred hierarchy or graph distance. */
export function sourceOverviewGeometry(plan: FlowViewPlan): FlowGeometry {
  const columns = Math.max(1, Math.ceil(Math.sqrt(plan.nodes.length)))
  return { kind: 'overview', nodes: plan.nodes.map((node, index) => ({ id: node.id, x: 24 + index % columns * 288, y: 24 + Math.floor(index / columns) * 112, width: FLOW_NODE_WIDTH, height: 72 })), routes: [] }
}
function namedLayoutError(name: string, message: string, cause?: unknown): FlowLayoutError {
  const detail = typeof cause === 'string' ? cause : cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : undefined
  const error = new FlowLayoutError(detail ? `${message} 原因：${detail.slice(0, 480)}` : message, { cause }); error.name = name; return error
}
async function workerLayout(input: ElkNode, options: { signal?: AbortSignal, timeoutMs?: number }): Promise<ElkNode> {
  if (options.signal?.aborted) throw namedLayoutError('FlowLayoutCancelled', '后台布局已取消；仍可查看完整原文。')
  if (typeof Worker === 'undefined' || typeof __IEXP_ELK_WORKER_SOURCE__ === 'undefined' || !__IEXP_ELK_WORKER_SOURCE__ || typeof URL.createObjectURL !== 'function') throw namedLayoutError('FlowLayoutWorkerUnavailable', '此环境无法启动后台布局；保留原文顺序总览与完整列表。')
  let worker: Worker | undefined, elk: ELK | undefined, url: string | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  try {
    url = URL.createObjectURL(new Blob([__IEXP_ELK_WORKER_SOURCE__], { type: 'text/javascript' }))
    worker = new Worker(url)
    const activeWorker = worker
    const result = new Promise<ElkNode>((resolve, reject) => {
      cancel = () => reject(namedLayoutError('FlowLayoutCancelled', '后台布局已取消；仍可查看完整原文。'))
      options.signal?.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => reject(namedLayoutError('FlowLayoutTimeout', '后台布局超时；可继续使用总览、搜索与完整列表。')), options.timeoutMs ?? 20_000)
      activeWorker.addEventListener('error', event => reject(namedLayoutError('FlowLayoutWorkerError', '后台布局进程失败；保留原文总览与完整列表。', event)), { once: true })
      elk = new ElkPackage.default({ workerFactory: () => activeWorker })
      void elk.layout(input).then(resolve, cause => reject(namedLayoutError('FlowLayoutWorkerError', 'ELK 后台布局失败；保留原文总览与完整列表。', cause)))
    })
    return await result
  } catch (cause) {
    if (cause instanceof FlowLayoutError) throw cause
    throw namedLayoutError('FlowLayoutWorkerError', '后台布局未能启动；保留原文总览与完整列表。', cause)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (cancel) options.signal?.removeEventListener('abort', cancel)
    elk?.terminateWorker(); worker?.terminate()
    if (url) URL.revokeObjectURL(url)
  }
}

let engine: ELK | undefined
/** Maintained ELK performs both node layout and obstacle-aware orthogonal edge routing. */
export async function layoutFlow(plan: FlowViewPlan, options: { signal?: AbortSignal, timeoutMs?: number, compact?: boolean } = {}): Promise<FlowGeometry> {
  const supplied = options.compact ? undefined : sourceFanGeometry(plan)
  if (supplied) return supplied
  if (!plan.nodes.length || new TextEncoder().encode(JSON.stringify({ nodes: plan.nodes, edges: plan.edges })).byteLength > GRAPH_SOURCE_BYTE_LIMIT) throw new FlowLayoutError('原文关系图为空或超过宿主 1 MiB 数据边界。')
  const large = isLargeFlow(plan)
  const nodeHeight = (node: FlowViewPlan['nodes'][number]) => large || options.compact ? 72 : flowNodeHeight(node)
  const indexes = new Map(plan.nodes.map((node, i) => [node.id, i]))
  if (indexes.size !== plan.nodes.length || plan.edges.some(edge => !indexes.has(edge.source) || !indexes.has(edge.target))) throw new FlowLayoutError('原文节点与连线不完整，无法布局。')
  const input: ElkNode = {
    id: 'source-flow',
    layoutOptions: large ? {
      'elk.algorithm': 'force', 'elk.force.iterations': '40', 'elk.edgeRouting': 'POLYLINE',
      'elk.randomSeed': '1', 'elk.padding': '[top=24,left=24,bottom=24,right=24]', 'elk.spacing.nodeNode': '56',
    } : {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1', 'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      'elk.spacing.nodeNode': '56', 'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '18',
      'elk.layered.spacing.nodeNodeBetweenLayers': '112', 'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: plan.nodes.map((node, i) => {
      const height = nodeHeight(node)
      return { id: `n${i}`, width: FLOW_NODE_WIDTH, height, ...(large ? {} : {
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: [
          { id: `n${i}-in`, x: -3, y: height / 2 - 3, width: 6, height: 6, layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.borderOffset': '-3' } },
          { id: `n${i}-out`, x: FLOW_NODE_WIDTH - 3, y: height / 2 - 3, width: 6, height: 6, layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.borderOffset': '-3' } },
        ],
      }) }
    }),
    edges: plan.edges.map((edge, i) => ({
      id: `relation-${i}`, sources: [`n${indexes.get(edge.source)}${large ? '' : '-out'}`], targets: [`n${indexes.get(edge.target)}${large ? '' : '-in'}`],
      ...(large || options.compact || edge.label === undefined ? {} : { labels: [{ text: edge.label, width: Math.max(24, Array.from(edge.label).reduce((width, character) => width + (/[^\u0000-\u00ff]/u.test(character) ? 13 : 7), 0) + 14), height: 26, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] }),
    })),
  }
  let output: ElkNode
  // The published CJS bundle exposes its constructor as both module.exports and .default.
  try {
    if (large) output = await workerLayout(input, options)
    else { engine ??= new ElkPackage.default(); output = await engine.layout(input) }
  }
  catch (cause) { if (cause instanceof FlowLayoutError) throw cause; throw new FlowLayoutError('ELK 无法完成原文关系图布局。', { cause }) }
  const laidOutNodes = new Map(output.children?.map(node => [node.id, node]))
  const nodes = plan.nodes.map((node, i) => {
    const result = laidOutNodes.get(`n${i}`)
    if (!result || !Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new FlowLayoutError('ELK 未返回完整的节点位置。')
    return { id: node.id, x: result.x!, y: result.y!, width: FLOW_NODE_WIDTH, height: nodeHeight(node) }
  })
  // Large-view detail connections use React Flow's public renderer; source edges stay exact.
  if (large) return { kind: 'elk', algorithm: 'force', nodes, routes: [] }
  const laidOutEdges = new Map(output.edges?.map(edge => [edge.id, edge]))
  const routes = plan.edges.map((_edge, i) => {
    const result = laidOutEdges.get(`relation-${i}`)
    if (result?.sections?.length !== 1) throw new FlowLayoutError('ELK 未返回完整的连线路径。')
    const section = result.sections[0]!
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
    if (!points.every(finitePoint) || points.some((point, j) => j > 0 && point.x !== points[j - 1]!.x && point.y !== points[j - 1]!.y)) throw new FlowLayoutError('ELK 返回的连线路径无效。')
    const label = result.labels?.[0]
    if (!options.compact && _edge.label !== undefined && (!label || !Number.isFinite(label.x) || !Number.isFinite(label.y))) throw new FlowLayoutError('ELK 未返回完整的连线标签位置。')
    return { id: result.id, points, ...(label ? { label: { x: label.x! + label.width! / 2, y: label.y! + label.height! / 2 } } : {}) }
  })
  return { kind: 'elk', nodes, routes }
}

/** Round only ELK's existing bends; this adapter never chooses a route or adds a relationship. */
export function roundedRoute(points: FlowPoint[], radius = 8): string {
  if (!points.length) return ''
  let path = `M${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1]!; const point = points[i]!; const next = points[i + 1]!
    const beforeLength = Math.hypot(point.x - previous.x, point.y - previous.y)
    const afterLength = Math.hypot(next.x - point.x, next.y - point.y)
    const bend = Math.min(radius, beforeLength / 2, afterLength / 2)
    if (!bend) { path += ` L${point.x} ${point.y}`; continue }
    const before = { x: point.x - (point.x - previous.x) * bend / beforeLength, y: point.y - (point.y - previous.y) * bend / beforeLength }
    const after = { x: point.x + (next.x - point.x) * bend / afterLength, y: point.y + (next.y - point.y) * bend / afterLength }
    path += ` L${before.x} ${before.y} Q${point.x} ${point.y} ${after.x} ${after.y}`
  }
  const last = points.at(-1)!
  return path + ` L${last.x} ${last.y}`
}
