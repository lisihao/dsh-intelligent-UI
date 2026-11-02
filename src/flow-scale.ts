import type { FlowGeometry, FlowViewPlan } from './flow-layout.js'
export const FLOW_VISIBLE_NODE_LIMIT = 180
export const FLOW_VISIBLE_EDGE_LIMIT = 300
export const FLOW_SOURCE_PAGE_SIZE = 25
export interface FlowViewport { x: number, y: number, zoom: number }
export function indexFlow(plan: FlowViewPlan) {
  const nodes = new Map(plan.nodes.map(node => [node.id, node]))
  const incident = new Map(plan.nodes.map(node => [node.id, [] as number[]]))
  plan.edges.forEach((edge, index) => { incident.get(edge.source)?.push(index); if (edge.target !== edge.source) incident.get(edge.target)?.push(index) })
  return { nodes, incident }
}
/** Bounded drawing projection only. All source objects and original edge indexes survive outside the viewport. */
export function flowWindow(plan: FlowViewPlan, geometry: FlowGeometry, viewport: FlowViewport, width: number, height: number) {
  const left = (-viewport.x - 80) / viewport.zoom, top = (-viewport.y - 80) / viewport.zoom
  const right = (width - viewport.x + 80) / viewport.zoom, bottom = (height - viewport.y + 80) / viewport.zoom
  const visible = geometry.nodes.filter(node => node.x + node.width >= left && node.x <= right && node.y + node.height >= top && node.y <= bottom)
  const ids = new Set(visible.slice(0, FLOW_VISIBLE_NODE_LIMIT).map(node => node.id))
  const edgeIndexes: number[] = []
  for (let index = 0; index < plan.edges.length && edgeIndexes.length < FLOW_VISIBLE_EDGE_LIMIT; index++) {
    const edge = plan.edges[index]!
    if (ids.has(edge.source) && ids.has(edge.target)) edgeIndexes.push(index)
  }
  return { nodes: plan.nodes.filter(node => ids.has(node.id)), edges: edgeIndexes.map(index => plan.edges[index]!), edgeIndexes, visibleCount: visible.length }
}
export function flowBounds(geometry: FlowGeometry) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const node of geometry.nodes) { left = Math.min(left, node.x); top = Math.min(top, node.y); right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height) }
  return { x: Number.isFinite(left) ? left : 0, y: Number.isFinite(top) ? top : 0, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

export interface FlowNeighborhood {
  nodes: FlowViewPlan['nodes']
  edges: FlowViewPlan['edges']
  edgeIndexes: number[]
}
/** Page actual incident edges, not arbitrary spatial neighbors. Every source edge occurs once. */
export function flowNeighborhoodPages(plan: FlowViewPlan, source: ReturnType<typeof indexFlow>, selectedId: string): FlowNeighborhood[] {
  const selected = source.nodes.get(selectedId)
  if (!selected) return []
  const pages: FlowNeighborhood[] = []
  let ids = new Set([selectedId]), edgeIndexes: number[] = []
  const finish = () => { pages.push({ nodes: [...ids].map(id => source.nodes.get(id)!), edges: edgeIndexes.map(index => plan.edges[index]!), edgeIndexes }); ids = new Set([selectedId]); edgeIndexes = [] }
  for (const index of source.incident.get(selectedId) ?? []) {
    const edge = plan.edges[index]!, neighbor = edge.source === selectedId ? edge.target : edge.source
    if (edgeIndexes.length === 100 || !ids.has(neighbor) && ids.size === 25) finish()
    ids.add(neighbor); edgeIndexes.push(index)
  }
  if (edgeIndexes.length || !pages.length) finish()
  return pages
}
