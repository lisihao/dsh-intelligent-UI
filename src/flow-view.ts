import { createElement as h, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, getViewportForBounds, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import { FLOW_NODE_WIDTH as NODE_WIDTH, layoutFlow, roundedRoute, sourceFanGeometry, type FlowGeometry, type FlowViewPlan } from './flow-layout.js'
export type { FlowViewPlan } from './flow-layout.js'

type ReadingNode = Node<{ label: string, description?: string, related: boolean }, 'reading'>
type ReadingEdge = Edge<{ points?: { x: number, y: number }[], labelPoint?: { x: number, y: number } }>
const MIN_READABLE_ZOOM = 0.8
const USER_OVERVIEW_MIN_ZOOM = 0.15
const INITIAL_FIT_OPTIONS = { minZoom: MIN_READABLE_ZOOM, maxZoom: 1, padding: 0.16 }
const OVERVIEW_FIT_OPTIONS = { minZoom: USER_OVERVIEW_MIN_ZOOM, maxZoom: 1, padding: 0.16 }

/** Pure view adapter: positions and emphasis change; original labels and relationships do not. */
export function buildFlowGraph(plan: FlowViewPlan, geometry: FlowGeometry, options: { selectedNodeId?: string, animate?: boolean } = {}): { nodes: ReadingNode[], edges: ReadingEdge[] } {
  const positions = new Map(geometry.nodes.map(node => [node.id, node]))
  const routes = new Map(geometry.routes.map(route => [route.id, route]))
  const neighbors = new Set<string>(options.selectedNodeId ? [options.selectedNodeId] : [])
  if (options.selectedNodeId) for (const edge of plan.edges) {
    if (edge.source === options.selectedNodeId) neighbors.add(edge.target)
    if (edge.target === options.selectedNodeId) neighbors.add(edge.source)
  }
  return {
    nodes: plan.nodes.map(node => ({
      id: node.id, type: 'reading', position: { x: positions.get(node.id)!.x, y: positions.get(node.id)!.y },
      data: { label: node.label, ...(node.description === undefined ? {} : { description: node.description }), related: neighbors.has(node.id) },
      // Public SSR geometry makes the first frame readable before ResizeObserver runs.
      // React Flow replaces initialHeight/handle data with real DOM measurements when ready.
      width: NODE_WIDTH, initialWidth: NODE_WIDTH, initialHeight: positions.get(node.id)!.height,
      handles: [
        { type: 'target', position: Position.Left, x: -3, y: positions.get(node.id)!.height / 2 - 3, width: 6, height: 6 },
        { type: 'source', position: Position.Right, x: NODE_WIDTH - 3, y: positions.get(node.id)!.height / 2 - 3, width: 6, height: 6 },
      ],
      style: { width: NODE_WIDTH, minHeight: positions.get(node.id)!.height },
      selected: node.id === options.selectedNodeId, draggable: false, connectable: false, deletable: false,
      focusable: true, ariaLabel: node.description ? `${node.label}，${node.description}` : node.label,
      className: options.selectedNodeId && !neighbors.has(node.id) ? 'iexp-flow-node-muted' : undefined,
    })),
    edges: plan.edges.map((edge, i) => {
      const emphasized = !options.selectedNodeId || edge.source === options.selectedNodeId || edge.target === options.selectedNodeId
      return {
        id: `relation-${i}`, source: edge.source, target: edge.target, label: edge.label,
        type: geometry.kind === 'source' ? 'default' : 'routed',
        data: { points: routes.get(`relation-${i}`)?.points, labelPoint: routes.get(`relation-${i}`)?.label }, animated: Boolean(options.animate && emphasized),
        focusable: false, selectable: false, deletable: false, reconnectable: false,
        className: emphasized ? 'iexp-flow-edge-active' : 'iexp-flow-edge-muted',
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--iexp-accent)', width: 18, height: 18 },
        style: { stroke: 'var(--iexp-accent)', strokeWidth: emphasized ? 1.8 : 1 },
        labelStyle: { fill: 'var(--iexp-text)', fontSize: 13 },
        labelBgStyle: { fill: 'var(--iexp-bg)', fillOpacity: 0.95 }, labelBgPadding: [7, 4], labelBgBorderRadius: 4,
      }
    }),
  }
}

function ReadingFlowNode({ data }: NodeProps<ReadingNode>): ReactElement {
  return h('div', { className: 'iexp-flow-node', 'data-related': data.related || undefined },
    h(Handle, { type: 'target', position: Position.Left, isConnectable: false }),
    h('strong', null, data.label), data.description !== undefined && h('p', null, data.description),
    h(Handle, { type: 'source', position: Position.Right, isConnectable: false }))
}
const NODE_TYPES = { reading: ReadingFlowNode }
function RoutedFlowEdge(props: EdgeProps<ReadingEdge>): ReactElement {
  const points = props.data?.points ?? []
  // Preserve ELK endpoints and bends. React Flow still supplies its public edge/label/marker surface.
  return h(BaseEdge, { id: props.id, path: roundedRoute(points), markerEnd: props.markerEnd, style: props.style,
    label: props.label, labelX: props.data?.labelPoint?.x, labelY: props.data?.labelPoint?.y,
    labelStyle: props.labelStyle, labelShowBg: props.labelShowBg, labelBgStyle: props.labelBgStyle,
    labelBgPadding: props.labelBgPadding, labelBgBorderRadius: props.labelBgBorderRadius,
  })
}
const EDGE_TYPES = { routed: RoutedFlowEdge }


function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function FlowView({ plan, motion: allowMotion = true, onNodeActivate }: { plan: FlowViewPlan, motion?: boolean, onNodeActivate?: (id: string) => void }): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(); const [motion, setMotion] = useState(true)
  const reduced = useReducedMotion()
  const instance = useRef<ReactFlowInstance<ReadingNode, ReadingEdge> | null>(null)
  const keyboardActivation = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const layoutKey = JSON.stringify({ nodes: plan.nodes, edges: plan.edges })
  const supplied = useMemo(() => sourceFanGeometry(plan), [layoutKey])
  const [layout, setLayout] = useState<{ key: string, geometry?: FlowGeometry, error?: string }>(() => ({ key: layoutKey, geometry: supplied }))
  useEffect(() => {
    if (supplied) { setLayout({ key: layoutKey, geometry: supplied }); return }
    let current = true
    setLayout({ key: layoutKey })
    void layoutFlow(plan).then(geometry => { if (current) setLayout({ key: layoutKey, geometry }) }, error => {
      if (current) setLayout({ key: layoutKey, error: error instanceof Error ? `${error.name}：${error.message}` : 'FlowLayoutError：无法完成原文关系图布局。' })
    })
    return () => { current = false }
  }, [layoutKey, supplied])
  const geometry = supplied ?? (layout.key === layoutKey ? layout.geometry : undefined)
  const graph = useMemo(() => geometry ? buildFlowGraph(plan, geometry, { selectedNodeId: selectedId, animate: allowMotion && motion && !reduced }) : { nodes: [], edges: [] }, [plan, geometry, selectedId, allowMotion, motion, reduced])
  const selected = plan.nodes.find(node => node.id === selectedId)
  const labels = new Map(plan.nodes.map(node => [node.id, node.label]))
  useEffect(() => { if (selectedId && !plan.nodes.some(node => node.id === selectedId)) setSelectedId(undefined) }, [plan, selectedId])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const update = () => setViewportWidth(element.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [geometry])
  const left = Math.min(...graph.nodes.map(node => node.position.x))
  const right = Math.max(...graph.nodes.map(node => node.position.x + NODE_WIDTH))
  const top = Math.min(...graph.nodes.map(node => node.position.y))
  const bottom = Math.max(...graph.nodes.map(node => node.position.y + Number(node.style?.minHeight ?? 80)))
  const readableFit = viewportWidth > (right - left) * MIN_READABLE_ZOOM + 64 && bottom - top < 400 / MIN_READABLE_ZOOM
  const returnToStart = () => {
    setSelectedId(undefined)
    const first = graph.nodes[0]
    if (first) void instance.current?.setViewport({ x: 28 - first.position.x, y: 36 - first.position.y, zoom: 1 })
  }
  const showWholeGraph = () => {
    const element = viewport.current
    if (!element || !element.clientWidth || !element.clientHeight) return
    // The public initial geometry is already complete; overview need not wait for ResizeObserver.
    const next = getViewportForBounds({ x: left, y: top, width: right - left, height: bottom - top }, element.clientWidth, element.clientHeight, USER_OVERVIEW_MIN_ZOOM, 1, OVERVIEW_FIT_OPTIONS.padding)
    void instance.current?.setViewport(next)
  }
  if (!geometry) return h('figure', { className: 'iexp-flow', 'data-motion': 'still' },
    h('figcaption', { className: 'iexp-flow-caption' }, h('strong', null, plan.title ?? '原文关系')),
    h('p', { role: layout.key === layoutKey && layout.error ? 'alert' : 'status' }, layout.key === layoutKey && layout.error ? `关系图布局失败（${layout.error}）。以下保留原始节点与连线。` : '正在排列原文节点与连线…'),
    h('ul', null, ...plan.nodes.map(node => h('li', { key: node.id }, h('strong', null, node.label), node.description !== undefined && h('span', null, `：${node.description}`)))),
    h('ul', null, ...plan.edges.map((edge, i) => h('li', { key: i }, `${labels.get(edge.source)} → ${labels.get(edge.target)}${edge.label === undefined ? '' : `：${edge.label}`}`))),
    (plan.sourceText !== undefined || plan.reason !== undefined) && h('details', { className: 'iexp-flow-source' }, h('summary', null, '查看原文与关系说明'), plan.reason !== undefined && h('p', null, plan.reason), plan.sourceText !== undefined && h('pre', null, plan.sourceText)))
  return h('figure', { className: 'iexp-flow', 'data-motion': allowMotion && motion && !reduced ? 'flowing' : 'still' },
    h('figcaption', { className: 'iexp-flow-caption' }, h('strong', null, plan.title ?? '原文关系'),
      h('span', null, '连线表示原文顺序或关系，不表示执行状态。')),
    h('div', { className: 'iexp-flow-toolbar' },
      allowMotion && h('button', { type: 'button', onClick: () => setMotion(value => !value), disabled: reduced, 'aria-pressed': !motion || reduced }, reduced ? '系统已关闭动效' : motion ? '暂停连线动效' : '恢复连线动效'),
      h('button', { type: 'button', onClick: returnToStart }, '回到起点'),
      selected && h('button', { type: 'button', onClick: () => setSelectedId(undefined) }, '取消节点选择')),
    h('div', { className: 'iexp-flow-viewport', ref: viewport,
      onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => { keyboardActivation.current = event.key === 'Enter' || event.key === ' ' },
      onPointerDownCapture: () => { keyboardActivation.current = false },
    }, h(ReactFlow<ReadingNode, ReadingEdge>, {
      nodes: graph.nodes, edges: graph.edges, nodeTypes: NODE_TYPES, edgeTypes: EDGE_TYPES,
      onInit: value => { instance.current = value },
      onNodeClick: (_event, node) => { setSelectedId(node.id); onNodeActivate?.(node.id) },
      onNodesChange: changes => {
        const selected = changes.find(change => change.type === 'select' && change.selected)
        if (selected?.type === 'select') {
          setSelectedId(selected.id)
          if (keyboardActivation.current) { keyboardActivation.current = false; onNodeActivate?.(selected.id) }
        }
        else if (changes.some(change => change.type === 'select')) setSelectedId(undefined)
      },
      onPaneClick: () => setSelectedId(undefined),
      nodesDraggable: false, nodesConnectable: false, nodesFocusable: true,
      edgesReconnectable: false, edgesFocusable: false, elementsSelectable: true,
      deleteKeyCode: null, multiSelectionKeyCode: null, selectionKeyCode: null,
      fitView: readableFit, fitViewOptions: INITIAL_FIT_OPTIONS, minZoom: USER_OVERVIEW_MIN_ZOOM, maxZoom: 1.6,
      defaultViewport: { x: 28 - (graph.nodes[0]?.position.x ?? 0), y: 36 - (graph.nodes[0]?.position.y ?? 0), zoom: 1 },
      autoPanOnNodeFocus: true, zoomOnDoubleClick: false, preventScrolling: false,
      'aria-label': plan.title ?? '原文关系图',
      ariaLabelConfig: {
        'node.a11yDescription.default': '按 Enter 或空格选择节点，查看直接相连的原文关系。节点不可移动。',
        'controls.ariaLabel': '关系图视图控制', 'controls.zoomIn.ariaLabel': '放大关系图',
        'controls.zoomOut.ariaLabel': '缩小关系图', 'controls.fitView.ariaLabel': '查看全图',
      },
    }, h(Controls, { showInteractive: false, fitViewOptions: OVERVIEW_FIT_OPTIONS, onFitView: showWholeGraph, position: 'bottom-left' }))),
    h('p', { className: 'iexp-flow-help' }, '拖动画布平移；可缩放查看。Tab 移到节点后按 Enter 或空格选择，显示直接相连的关系。'),
    selected && h('div', { className: 'iexp-flow-selection', role: 'status' }, h('strong', null, selected.label),
      selected.description !== undefined && h('p', null, selected.description),
      h('ul', null, ...plan.edges.filter(edge => edge.source === selectedId || edge.target === selectedId).map((edge, i) => h('li', { key: i }, `${labels.get(edge.source)} → ${labels.get(edge.target)}${edge.label === undefined ? '' : `：${edge.label}`}`))),
      !plan.edges.some(edge => edge.source === selectedId || edge.target === selectedId) && h('p', null, '原文未提供该节点的连线。')),
    (plan.sourceText !== undefined || plan.reason !== undefined) && h('details', { className: 'iexp-flow-source' }, h('summary', null, '查看原文与关系说明'),
      plan.reason !== undefined && h('p', null, plan.reason), plan.sourceText !== undefined && h('pre', null, plan.sourceText)))
}
