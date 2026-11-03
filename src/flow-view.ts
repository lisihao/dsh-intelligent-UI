import { installFlowParticles, type FlowParticles } from './flow-particles.js'
import type { ExecutionNode } from './execution-flow.js'
import { LargeFlowView } from './large-flow-view.js'
import { ThemeButton, ThemeCard, ThemeLoader } from './theme-components.js'
import { UiverseRenderScope } from './uiverse-render.js'
import { createElement as h, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, getViewportForBounds, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import { FLOW_NODE_WIDTH as NODE_WIDTH, layoutFlow, roundedRoute, sourceFanGeometry, isLargeFlow, type FlowGeometry, type FlowViewPlan } from './flow-layout.js'
export type { FlowViewPlan } from './flow-layout.js'

type ReadingNode = Node<{ label: string, description?: string, related: boolean, compact?: boolean, vertical?: boolean, execution?: ExecutionNode }, 'reading'>
type ReadingEdge = Edge<{ points?: { x: number, y: number }[], labelPoint?: { x: number, y: number } }>
const MIN_READABLE_ZOOM = 0.8
const USER_OVERVIEW_MIN_ZOOM = 0.15
const INITIAL_FIT_OPTIONS = { minZoom: MIN_READABLE_ZOOM, maxZoom: 1, padding: 0.16 }
const OVERVIEW_FIT_OPTIONS = { minZoom: USER_OVERVIEW_MIN_ZOOM, maxZoom: 1, padding: 0.16 }

/** Pure view adapter: positions and emphasis change; original labels and relationships do not. */
export function buildFlowGraph(plan: FlowViewPlan, geometry: FlowGeometry, options: { selectedNodeId?: string, animate?: boolean, compact?: boolean, edgeIndexes?: number[] } = {}): { nodes: ReadingNode[], edges: ReadingEdge[] } {
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
      data: { label: node.label, ...(node.description === undefined ? {} : { description: node.description }), related: neighbors.has(node.id), compact: options.compact, vertical: plan.direction === 'DOWN', execution: node.execution },
      // Public SSR geometry makes the first frame readable before ResizeObserver runs.
      // React Flow replaces initialHeight/handle data with real DOM measurements when ready.
      width: NODE_WIDTH, initialWidth: NODE_WIDTH, initialHeight: positions.get(node.id)!.height,
      handles: [
        { type: 'target', position: plan.direction === 'DOWN' ? Position.Top : Position.Left, x: plan.direction === 'DOWN' ? NODE_WIDTH / 2 - 3 : -3, y: plan.direction === 'DOWN' ? -3 : positions.get(node.id)!.height / 2 - 3, width: 6, height: 6 },
        { type: 'source', position: plan.direction === 'DOWN' ? Position.Bottom : Position.Right, x: plan.direction === 'DOWN' ? NODE_WIDTH / 2 - 3 : NODE_WIDTH - 3, y: plan.direction === 'DOWN' ? positions.get(node.id)!.height - 3 : positions.get(node.id)!.height / 2 - 3, width: 6, height: 6 },
      ],
      style: { width: NODE_WIDTH, minHeight: positions.get(node.id)!.height },
      selected: node.id === options.selectedNodeId, draggable: false, connectable: false, deletable: false,
      focusable: true, ariaLabel: node.description ? `${node.label}，${node.description}` : node.label,
      className: options.selectedNodeId && !neighbors.has(node.id) ? 'iexp-flow-node-muted' : undefined,
    })),
    edges: plan.edges.map((edge, i) => {
      const emphasized = !options.selectedNodeId || edge.source === options.selectedNodeId || edge.target === options.selectedNodeId
      return {
        id: `relation-${options.edgeIndexes?.[i] ?? i}`, source: edge.source, target: edge.target, label: options.compact ? undefined : edge.label,
        type: routes.has(`relation-${options.edgeIndexes?.[i] ?? i}`) ? 'routed' : 'default',
        data: { points: routes.get(`relation-${options.edgeIndexes?.[i] ?? i}`)?.points, labelPoint: routes.get(`relation-${options.edgeIndexes?.[i] ?? i}`)?.label }, animated: false,
        focusable: false, selectable: false, deletable: false, reconnectable: false,
        className: `${emphasized ? 'iexp-flow-edge-active' : 'iexp-flow-edge-muted'}${edge.executionStatus ? ` iexp-flow-execution-edge-${edge.executionStatus}` : ''}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--iexp-accent)', width: 18, height: 18 },
        style: { stroke: 'var(--iexp-accent)', strokeWidth: emphasized ? 1.8 : 1 },
        labelStyle: { fill: 'var(--iexp-text)', fontSize: 13 },
        labelBgStyle: { fill: 'var(--iexp-bg)', fillOpacity: 0.95 }, labelBgPadding: [7, 4], labelBgBorderRadius: 4,
      }
    }),
  }
}

const executionStatus = { queued: '等待中', running: '运行中', succeeded: '已完成', failed: '失败', blocked: '受阻', cancelled: '已取消', skipped: '已跳过' }
const executionRole = { lead: '主控', advisor: '审阅', worker: '工作节点', tool: '工具' }
const numeric = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 })
const percentage = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
function ReadingFlowNode({ data }: NodeProps<ReadingNode>): ReactElement {
  const execution = data.execution, progress = execution?.progress
  const ratio = progress && progress.total > 0 ? progress.current / progress.total : undefined
  return h(ThemeCard, { renderRole: 'flow', className: `iexp-flow-node${data.compact ? ' iexp-flow-node-compact' : ''}`, 'data-related': data.related || undefined,
    'data-execution-role': execution?.role, 'data-execution-status': execution?.status },
    h(Handle, { type: 'target', position: data.vertical ? Position.Top : Position.Left, isConnectable: false }),
    h('strong', null, data.label), !data.compact && data.description !== undefined && h('p', null, data.description),
    execution && data.compact && h('span', {className: 'iexp-execution-compact-status'}, execution.status ? executionStatus[execution.status] : '状态未上报'),
    execution && !data.compact && h('div', { className: 'iexp-execution-node-data' },
      h('div', { className: 'iexp-execution-node-meta' }, execution.role && h('span', null, executionRole[execution.role]), execution.model && h('span', {title: execution.model}, execution.model)),
      h('span', { className: 'iexp-execution-node-status' }, execution.status ? executionStatus[execution.status] : '状态未上报'),
      progress ? h('div', { className: 'iexp-execution-progress' },
        h('div', { className: 'iexp-execution-progress-label' }, h('span', null, `${numeric.format(progress.current)} / ${numeric.format(progress.total)}${progress.unit ? ` ${progress.unit}` : ''}`), h('strong', null, ratio === undefined ? '总量为 0' : percentage.format(ratio))),
        ratio !== undefined && h('div', { className: 'iexp-execution-progress-track', role: 'progressbar', 'aria-label': `${data.label}的来源进度`, 'aria-valuemin': 0, 'aria-valuemax': progress.total, 'aria-valuenow': progress.current }, h('span', { style: { transform: `scaleX(${ratio})` } }))) : h('span', { className: 'iexp-execution-progress-unknown' }, '进度未上报'),
      !!execution.metrics?.length && h('dl', { className: 'iexp-execution-metrics' }, ...execution.metrics.flatMap((metric, index) => [h('dt', { key: `label-${index}`, title: metric.label }, metric.label), h('dd', { key: `value-${index}` }, typeof metric.value === 'number' ? numeric.format(metric.value) : metric.value, metric.unit ? ` ${metric.unit}` : '')]))),
    h(Handle, { type: 'source', position: data.vertical ? Position.Bottom : Position.Right, isConnectable: false }))
}
export const FLOW_NODE_TYPES = { reading: ReadingFlowNode }
function RoutedFlowEdge(props: EdgeProps<ReadingEdge>): ReactElement {
  const points = props.data?.points ?? []
  // Preserve ELK endpoints and bends. React Flow still supplies its public edge/label/marker surface.
  return h(BaseEdge, { id: props.id, path: roundedRoute(points), markerEnd: props.markerEnd, style: props.style,
    label: props.label, labelX: props.data?.labelPoint?.x, labelY: props.data?.labelPoint?.y,
    labelStyle: props.labelStyle, labelShowBg: props.labelShowBg, labelBgStyle: props.labelBgStyle,
    labelBgPadding: props.labelBgPadding, labelBgBorderRadius: props.labelBgBorderRadius,
  })
}
export const FLOW_EDGE_TYPES = { routed: RoutedFlowEdge }


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

function SmallFlowView({ plan, motion: allowMotion = true, onNodeActivate }: { plan: FlowViewPlan, motion?: boolean, onNodeActivate?: (id: string) => void }): ReactElement {
  const [selectedId, setSelectedId] = useState<string>(); const [motion, setMotion] = useState(true)
  const [particleError, setParticleError] = useState<string>()
  const particleLayer = useRef<FlowParticles>()
  const reduced = useReducedMotion()
  const instance = useRef<ReactFlowInstance<ReadingNode, ReadingEdge> | null>(null)
  const keyboardActivation = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const layoutKey = JSON.stringify({ nodes: plan.nodes.map(({execution, ...node}) => ({...node, ...(execution ? {execution: {metrics: execution.metrics?.map(metric => metric.label)}} : {})})), edges: plan.edges.map(({executionStatus: _status, ...edge}) => edge), direction: plan.direction })
  const supplied = useMemo(() => plan.direction === 'DOWN' ? undefined : sourceFanGeometry(plan), [layoutKey])
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
  const activeEdges = plan.execution ? new Set(plan.edges.flatMap((edge, index) => edge.executionStatus === 'active' ? [`relation-${index}`] : [])) : selectedId ? new Set(plan.edges.flatMap((edge, index) => edge.source === selectedId || edge.target === selectedId ? [`relation-${index}`] : [])) : null
  const activeKey = activeEdges ? [...activeEdges].join(',') : '*'
  useEffect(() => {
    const element = viewport.current
    if (!element || !geometry) return
    setParticleError(undefined)
    const layer = installFlowParticles({ viewport: element, activeEdgeIds: activeEdges, onRecovery: () => setParticleError(undefined), onError: error => setParticleError(`连线动效暂不可用：${error.message}`) })
    particleLayer.current = layer; layer.setMotion(allowMotion && motion && !reduced)
    return () => { particleLayer.current = undefined; layer.dispose() }
  }, [!!geometry, layoutKey])
  useEffect(() => { particleLayer.current?.setActiveEdges(activeEdges); particleLayer.current?.setMotion(allowMotion && motion && !reduced) }, [activeKey, allowMotion, motion, reduced])
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
  const stageHeight = plan.execution && geometry ? Math.max(420, Math.min(920, Math.ceil(bottom - top + 80))) : 420
  const readableFit = viewportWidth > (right - left) * MIN_READABLE_ZOOM + 64 && bottom - top < (stageHeight - 20) / MIN_READABLE_ZOOM
  // Execution starts with its structure visible on desktop; narrow views retain
  // readable native-size nodes and can pan/zoom. Source-only updates keep this view.
  useEffect(() => {
    if (!plan.execution || !geometry || !viewportWidth || !instance.current) return
    const next = viewportWidth >= 680
      ? getViewportForBounds({x:left,y:top,width:right-left,height:bottom-top}, viewportWidth, stageHeight, 0.5, 1, 0.12)
      : (() => {const zoom=Math.min(1,(viewportWidth-24)/NODE_WIDTH); return {x:(viewportWidth-NODE_WIDTH*zoom)/2-(graph.nodes[0]?.position.x??0)*zoom,y:28-(graph.nodes[0]?.position.y??0)*zoom,zoom}})()
    void instance.current.setViewport(next)
  }, [geometry, viewportWidth, stageHeight])
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
    layout.key === layoutKey && layout.error ? h('p', { role: 'alert' }, `关系图布局失败（${layout.error}）。以下保留原始节点与连线。`) : h(ThemeLoader, { renderRole: 'flow', label: '正在排列原文节点与连线…' }),
    h('ul', null, ...plan.nodes.map(node => h('li', { key: node.id }, h('strong', null, node.label), node.description !== undefined && h('span', null, `：${node.description}`)))),
    h('ul', null, ...plan.edges.map((edge, i) => h('li', { key: i }, `${labels.get(edge.source)} → ${labels.get(edge.target)}${edge.label === undefined ? '' : `：${edge.label}`}`))),
    (plan.sourceText !== undefined || plan.reason !== undefined) && h('details', { className: 'iexp-flow-source' }, h('summary', null, '查看原文与关系说明'), plan.reason !== undefined && h('p', null, plan.reason), plan.sourceText !== undefined && h('pre', null, plan.sourceText)))
  return h(UiverseRenderScope, { role: 'flow' }, h('figure', { className: 'iexp-flow', 'data-execution': plan.execution || undefined, 'data-motion': allowMotion && motion && !reduced ? 'flowing' : 'still' },
    h('figcaption', { className: 'iexp-flow-caption' }, h('strong', null, plan.title ?? '原文关系'),
      h('span', null, plan.execution ? '状态与进度来自来源快照，仅活动连线显示流动光点。' : '连线表示原文顺序或关系，不表示执行状态。')),
    h('div', { className: 'iexp-flow-toolbar' },
      allowMotion && h(ThemeButton, { type: 'button', onClick: () => setMotion(value => !value), disabled: reduced, 'aria-pressed': !motion || reduced }, reduced ? '系统已关闭动效' : motion ? '暂停连线动效' : '恢复连线动效'),
      h(ThemeButton, { type: 'button', onClick: returnToStart }, plan.execution ? '按原尺寸阅读' : '回到起点'),
      selected && h(ThemeButton, { type: 'button', onClick: () => setSelectedId(undefined) }, '取消节点选择')),
    h('div', { className: 'iexp-flow-viewport', ref: viewport, style: plan.execution ? { height: stageHeight } : undefined,
      onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => { keyboardActivation.current = event.key === 'Enter' || event.key === ' ' },
      onPointerDownCapture: () => { keyboardActivation.current = false },
    }, h(ReactFlow<ReadingNode, ReadingEdge>, {
      nodes: graph.nodes, edges: graph.edges, nodeTypes: FLOW_NODE_TYPES, edgeTypes: FLOW_EDGE_TYPES,
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
    particleError && h('p', { className: 'iexp-flow-help', role: 'status' }, particleError),
    h('p', { className: 'iexp-flow-help' }, '拖动画布平移；可缩放查看。Tab 移到节点后按 Enter 或空格选择，显示直接相连的关系。'),
    selected && h('div', { className: 'iexp-flow-selection', role: 'status' }, h('strong', null, selected.label),
      selected.description !== undefined && h('p', null, selected.description),
      h('ul', null, ...plan.edges.filter(edge => edge.source === selectedId || edge.target === selectedId).map((edge, i) => h('li', { key: i }, `${labels.get(edge.source)} → ${labels.get(edge.target)}${edge.label === undefined ? '' : `：${edge.label}`}`))),
      !plan.edges.some(edge => edge.source === selectedId || edge.target === selectedId) && h('p', null, '原文未提供该节点的连线。')),
    (plan.sourceText !== undefined || plan.reason !== undefined) && h('details', { className: 'iexp-flow-source' }, h('summary', null, '查看原文与关系说明'),
      plan.reason !== undefined && h('p', null, plan.reason), plan.sourceText !== undefined && h('pre', null, plan.sourceText))))
}

export function FlowView(props: { plan: FlowViewPlan, motion?: boolean, onNodeActivate?: (id: string) => void }): ReactElement {
  return isLargeFlow(props.plan) ? h(LargeFlowView, props) : h(SmallFlowView, props)
}
