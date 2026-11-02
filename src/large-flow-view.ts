import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type MouseEvent, type KeyboardEvent } from 'react'
import { Controls, ReactFlow, getViewportForBounds, type ReactFlowInstance } from '@xyflow/react'
import { ThemeButton, ThemeInput } from './theme-components.js'
import { UiverseRenderScope } from './uiverse-render.js'
import { buildFlowGraph, FLOW_NODE_TYPES, FLOW_EDGE_TYPES } from './flow-view.js'
import { layoutFlow, sourceOverviewGeometry, type FlowGeometry, type FlowViewPlan } from './flow-layout.js'
import { flowBounds, flowNeighborhoodPages, flowWindow, indexFlow, FLOW_SOURCE_PAGE_SIZE, type FlowViewport } from './flow-scale.js'
import { createGraphOverviewRenderer, type OverviewRenderer } from './graph-overview-renderer.js'
const format = new Intl.NumberFormat('zh-CN')
function SourcePages<T>({ items, name, render, initialOpen = false }: { items: readonly T[], name: string, render: (item: T, index: number) => ReactNode, initialOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(initialOpen), [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / FLOW_SOURCE_PAGE_SIZE)), current = Math.min(page, pages - 1)
  return h('details', { className: 'iexp-flow-source-pages', open, onToggle: (event: { currentTarget: HTMLDetailsElement }) => setOpen(event.currentTarget.open) },
    h('summary', null, `${name}（${format.format(items.length)}）`), open && h('div', null,
      h('div', { className: 'iexp-flow-toolbar' },
        h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: current === 0, onClick: () => setPage(current - 1) }, `上一页${name}`),
        h('label', null, `${name}页码 `, h(ThemeInput, { renderRole: 'flow', type: 'number', min: 1, max: pages, value: current + 1, 'aria-label': `${name}页码`, onChange: event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setPage(Math.max(0, Math.min(pages - 1, Math.floor(value) - 1))) } })),
        h('span', null, `共 ${format.format(pages)} 页`),
        h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: current === pages - 1, onClick: () => setPage(current + 1) }, `下一页${name}`)),
      h('ol', { start: current * FLOW_SOURCE_PAGE_SIZE + 1 }, ...items.slice(current * FLOW_SOURCE_PAGE_SIZE, (current + 1) * FLOW_SOURCE_PAGE_SIZE).map((item, index) => h('li', { key: current * FLOW_SOURCE_PAGE_SIZE + index }, render(item, current * FLOW_SOURCE_PAGE_SIZE + index))))))
}
function GraphOverview({ plan, geometry, selectedId, onSelect }: { plan: FlowViewPlan, geometry: FlowGeometry, selectedId?: string, onSelect: (id: string) => void }): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const map = useRef({ zoom: 1, x: 0, y: 0 })
  const renderer = useRef<OverviewRenderer>(), redraw = useRef<() => void>(() => {})
  const [rendererKind, setRendererKind] = useState<string>(), [renderError, setRenderError] = useState<string>()
  redraw.current = () => {
    if (!renderer.current) return
    try { map.current = renderer.current.draw(geometry, plan, selectedId); setRendererKind(renderer.current.kind) }
    catch (error) { setRenderError(`GraphOverviewRenderingError：${error instanceof Error ? error.message : '总览绘制失败。'} 完整原文列表仍可使用。`) }
  }
  useEffect(() => {
    const element = canvas.current
    if (!element || typeof CanvasRenderingContext2D === 'undefined') { setRenderError('GraphOverviewUnavailable：当前环境没有画布接口；完整原文列表仍可使用。'); return }
    try { renderer.current = createGraphOverviewRenderer(element) }
    catch (error) { setRenderError(`GraphOverviewInitializationError：${error instanceof Error ? error.message : '总览画布初始化失败。'} 完整原文列表仍可使用。`); return }
    const draw = () => redraw.current()
    const lost = () => setRenderError(element.dataset.renderError || 'GPU 上下文暂时丢失；搜索与原文列表仍可使用。')
    const restored = () => { setRenderError(undefined); draw() }
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored)
    draw()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(draw); observer?.observe(element)
    return () => { observer?.disconnect(); element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored); renderer.current?.dispose(); renderer.current = undefined }
  }, [])
  useEffect(() => redraw.current(), [plan, geometry, selectedId])
  return h('div', null, h('canvas', { ref: canvas, 'data-renderer': rendererKind, className: 'iexp-flow-overview', role: 'img', 'aria-label': `关系总览：${format.format(plan.nodes.length)} 个节点，${format.format(plan.edges.length)} 条原文连线。请用节点搜索或完整列表查看名称与方向。`,
    onClick: (event: MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect(), transform = map.current
      const x = (event.clientX - rect.left - transform.x) / transform.zoom, y = (event.clientY - rect.top - transform.y) / transform.zoom
      const node = geometry.nodes.find(node => x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height)
      if (node) onSelect(node.id)
    },
  }), renderError ? h('p', { role: 'alert' }, renderError) : rendererKind && h('p', { className: 'iexp-flow-help' }, rendererKind === 'webgl2' ? 'WebGL2 批量总览；搜索、选取与原文使用普通页面控件。' : 'Canvas2D 总览：当前环境未提供 WebGL2，源数据与页面控件保持可用。'))
}
export function LargeFlowView({ plan: inputPlan, onNodeActivate }: { plan: FlowViewPlan, motion?: boolean, onNodeActivate?: (id: string) => void }): ReactElement {
  const fingerprint = useMemo(() => JSON.stringify(inputPlan), [inputPlan]), plan = useMemo(() => inputPlan, [fingerprint])
  const [selectedId, setSelectedId] = useState<string>(), [query, setQuery] = useState(''), [mode, setMode] = useState<'overview' | 'detail'>('overview'), [detailPage, setDetailPage] = useState(0)
  const [layout, setLayout] = useState<{ geometry?: FlowGeometry, error?: string }>({})
  const keyboardActivation = useRef(false), controller = useRef<AbortController>()
  const instance = useRef<ReactFlowInstance<ReturnType<typeof buildFlowGraph>['nodes'][number], ReturnType<typeof buildFlowGraph>['edges'][number]> | null>(null)
  const viewportElement = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 800, height: 440 })
  const [viewport, setViewport] = useState<FlowViewport>({ x: 0, y: 0, zoom: 1 })
  const fallback = useMemo(() => sourceOverviewGeometry(plan), [plan]), source = useMemo(() => indexFlow(plan), [plan])
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; let current = true
    setLayout({}); setMode('overview'); setSelectedId(undefined); setDetailPage(0)
    void layoutFlow(plan, { signal: abort.signal }).then(geometry => { if (current) setLayout({ geometry }) }, error => { if (current) setLayout({ error: error instanceof Error ? `${error.name}：${error.message}` : 'FlowLayoutError：后台布局失败。' }) })
    return () => { current = false; abort.abort() }
  }, [plan])
  const geometry = layout.geometry ?? fallback
  const selected = selectedId ? source.nodes.get(selectedId) : undefined
  const adjacent = selectedId ? source.incident.get(selectedId) ?? [] : []
  const neighborhoods = useMemo(() => selectedId ? flowNeighborhoodPages(plan, source, selectedId) : [], [plan, source, selectedId])
  const currentPage = Math.min(detailPage, Math.max(0, neighborhoods.length - 1)), neighborhood = neighborhoods[currentPage]
  const neighborhoodKey = useMemo(() => JSON.stringify(neighborhood), [neighborhood])
  const initialDetail = useMemo(() => neighborhood ? sourceOverviewGeometry(neighborhood) : undefined, [neighborhood])
  const [detailLayout, setDetailLayout] = useState<{ key: string, geometry?: FlowGeometry, error?: string }>({ key: '' })
  useEffect(() => {
    if (!neighborhood) return
    let current = true; setDetailLayout({ key: neighborhoodKey })
    void layoutFlow(neighborhood, { compact: true }).then(geometry => {
      if (current) setDetailLayout({ key: neighborhoodKey, geometry: { ...geometry, routes: geometry.routes.map((route, index) => ({ ...route, id: `relation-${neighborhood.edgeIndexes[index]}` })) } })
    }, error => { if (current) setDetailLayout({ key: neighborhoodKey, error: `FlowNeighborhoodLayoutError：${error instanceof Error ? error.message : '局部布局失败。'} 临时排列仍保留本页原文关系。` }) })
    return () => { current = false }
  }, [neighborhoodKey])
  const detailGeometry = detailLayout.key === neighborhoodKey ? detailLayout.geometry ?? initialDetail : initialDetail
  const detailBounds = useMemo(() => detailGeometry ? flowBounds(detailGeometry) : undefined, [detailGeometry])
  const detailHeight = detailBounds ? Math.min(760, Math.max(440, Math.ceil(detailBounds.height * 0.85 + 64))) : 440
  const fitDetail = () => {
    if (!detailBounds) return
    const next = getViewportForBounds(detailBounds, size.width, detailHeight, 0.65, 1, 0.12)
    setViewport(next); void instance.current?.setViewport(next)
  }
  useEffect(() => fitDetail(), [detailGeometry, size.width, detailHeight])
  const matches = useMemo(() => { const value = query.trim().toLocaleLowerCase('zh-CN'); return value ? plan.nodes.filter(node => [node.id, node.label, node.description ?? ''].some(text => text.toLocaleLowerCase('zh-CN').includes(value))) : [] }, [plan, query])
  const select = (id: string, notify = true) => {
    if (!source.nodes.has(id)) return
    if (selectedId === id) fitDetail()
    else { setSelectedId(id); setDetailPage(0) }
    setMode('detail'); if (notify) onNodeActivate?.(id)
  }
  useEffect(() => {
    const element = viewportElement.current; if (!element) return
    const update = () => { const next = { width: element.clientWidth || 800, height: element.clientHeight || detailHeight }; setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next) }; update()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update); observer?.observe(element)
    return () => observer?.disconnect()
  }, [mode, detailHeight])
  const windowed = useMemo(() => neighborhood && detailGeometry ? flowWindow(neighborhood, detailGeometry, viewport, size.width, detailHeight) : undefined, [neighborhood, detailGeometry, viewport, size.width, detailHeight])
  const graph = useMemo(() => windowed && detailGeometry && neighborhood ? buildFlowGraph({ nodes: windowed.nodes, edges: windowed.edges }, detailGeometry, { selectedNodeId: selectedId, compact: true, edgeIndexes: windowed.edgeIndexes.map(index => neighborhood.edgeIndexes[index]!) }) : { nodes: [], edges: [] }, [neighborhood, detailGeometry, windowed, selectedId])
  const relation = (index: number) => { const edge = plan.edges[index]!; return h('span', null,
    h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => select(edge.source) }, source.nodes.get(edge.source)!.label), ' → ',
    h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => select(edge.target) }, source.nodes.get(edge.target)!.label), edge.label === undefined ? '' : `：${edge.label}`, h('details', null, h('summary', null, '原始连线字段'), h('pre', null, JSON.stringify(edge, null, 2)))) }
  return h(UiverseRenderScope, { role: 'flow' }, h('figure', { className: 'iexp-flow iexp-flow-large', 'data-motion': 'still', 'data-layout': geometry.kind, 'data-layout-algorithm': geometry.algorithm ?? 'source-order' },
    h('figcaption', { className: 'iexp-flow-caption' }, h('strong', null, plan.title ?? '原文关系'), h('span', null, `${format.format(plan.nodes.length)} 个节点 · ${format.format(plan.edges.length)} 条原文连线；连线不表示执行状态。`)),
    layout.error ? h('p', { role: 'alert' }, `${layout.error} 当前按原文顺序排列，不推断层级或距离。`) : !layout.geometry ? h('div', { className: 'iexp-flow-toolbar' }, h('span', { role: 'status' }, '正在后台排列节点；当前总览按原文顺序分布，不推断层级或距离。'), h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => controller.current?.abort() }, '取消后台布局')) : h('p', { className: 'iexp-flow-help' }, 'ELK 力导向概览已完成；位置仅用于阅读，不代表关系强度、执行顺序或最优结构。'),
    h('div', { className: 'iexp-flow-search' }, h('label', null, '搜索原文节点', h(ThemeInput, { renderRole: 'flow', type: 'search', value: query, placeholder: '名称、标识或描述', onChange: event => setQuery(event.currentTarget.value), 'aria-label': '搜索原文节点' })),
      !!query.trim() && h('span', { role: 'status' }, `找到 ${format.format(matches.length)} 个节点`)),
    !!query.trim() && h(SourcePages<FlowViewPlan['nodes'][number]>, { items: matches, name: '搜索结果', initialOpen: true, render: node => h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => select(node.id) }, node.label) }),
    h('div', { className: 'iexp-flow-toolbar' }, h(ThemeButton, { renderRole: 'flow', type: 'button', 'aria-pressed': mode === 'overview', onClick: () => setMode('overview') }, '查看总览'), selected && h(ThemeButton, { renderRole: 'flow', type: 'button', 'aria-pressed': mode === 'detail', onClick: () => select(selected.id) }, '定位选中节点'), selected && h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => { setSelectedId(undefined); setMode('overview') } }, '取消节点选择')),
    mode === 'overview' ? h(GraphOverview, { plan, geometry, selectedId, onSelect: select }) : h('div', null,
      h('div', { className: 'iexp-flow-toolbar', role: 'group', 'aria-label': '直接邻域分页' }, h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: currentPage === 0, onClick: () => setDetailPage(currentPage - 1) }, '上一页邻域'),
        h('span', { role: 'status' }, `邻域第 ${format.format(currentPage + 1)} / ${format.format(neighborhoods.length)} 页：${format.format(neighborhood?.nodes.length ?? 0)} 个节点、${format.format(neighborhood?.edges.length ?? 0)} 条原文连线；全部直接关系 ${format.format(adjacent.length)} 条。`),
        h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: currentPage >= neighborhoods.length - 1, onClick: () => setDetailPage(currentPage + 1) }, '下一页邻域')),
      detailLayout.key === neighborhoodKey && detailLayout.error ? h('p', { role: 'alert' }, detailLayout.error) : h('p', { className: 'iexp-flow-help' }, detailGeometry?.kind === 'elk' ? 'ELK 单独排列本页直接邻域；箭头与连线均来自原文。' : '正在排列本页直接邻域；当前按原文顺序临时分布。'),
      h('div', { className: 'iexp-flow-viewport', ref: viewportElement, style: { height: detailHeight }, 'data-neighborhood-layout': detailGeometry?.kind, onKeyDownCapture: (event: KeyboardEvent<HTMLDivElement>) => { keyboardActivation.current = event.key === 'Enter' || event.key === ' ' }, onPointerDownCapture: () => { keyboardActivation.current = false } }, h(ReactFlow<ReturnType<typeof buildFlowGraph>['nodes'][number], ReturnType<typeof buildFlowGraph>['edges'][number]>, {
        nodes: graph.nodes, edges: graph.edges, nodeTypes: FLOW_NODE_TYPES, edgeTypes: FLOW_EDGE_TYPES, onlyRenderVisibleElements: true,
        onInit: value => { instance.current = value; void value.setViewport(viewport) }, onMove: (_event, next) => setViewport(next),
        onNodeClick: (_event, node) => select(node.id), onNodesChange: changes => { const change = changes.find(change => change.type === 'select' && change.selected); if (change?.type === 'select' && change.id !== selectedId) { select(change.id, keyboardActivation.current); keyboardActivation.current = false } },
        defaultViewport: viewport, minZoom: 0.5, maxZoom: 1.6, nodesDraggable: false, nodesConnectable: false, nodesFocusable: true, edgesReconnectable: false, edgesFocusable: false, deleteKeyCode: null,
        zoomOnDoubleClick: false, preventScrolling: false, 'aria-label': '原文关系局部详情', ariaLabelConfig: { 'node.a11yDescription.default': '按 Enter 或空格选择，查看完整原文及直接连线。', 'controls.zoomIn.ariaLabel': '放大关系详情', 'controls.zoomOut.ariaLabel': '缩小关系详情' },
      }, h(Controls, { showFitView: false, showInteractive: false, position: 'bottom-left' })))),
    h('p', { className: 'iexp-flow-help' }, mode === 'overview' ? '总览显示全部节点与连线分布，省略细小标签和方向。搜索或选取节点查看原文；完整列表支持页码跳转。' : `当前画面绘制 ${format.format(graph.nodes.length)} 个节点、${format.format(graph.edges.length)} 条连线；邻域按最多 25 个节点、100 条直接关系分页，完整连线标签和全部原文仍可读取。`),
    selected && h('section', { className: 'iexp-flow-selection', 'aria-label': '选中节点原文' }, h('strong', null, selected.label), selected.description !== undefined && h('p', null, selected.description), h('p', null, `直接相连的原文关系：${format.format(adjacent.length)} 条`), h(SourcePages<number>, { key: selected.id, items: adjacent, name: '直接连线', render: relation })),
    h(SourcePages<FlowViewPlan['nodes'][number]>, { items: plan.nodes, name: '完整节点', render: node => h('div', null, h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => select(node.id) }, node.label), node.description !== undefined && h('p', null, node.description), h('details', null, h('summary', null, '原始节点字段'), h('pre', null, JSON.stringify(node, null, 2)))) }),
    h(SourcePages<number>, { items: plan.edges.map((_edge, index) => index), name: '完整连线', render: relation }),
    (plan.sourceText !== undefined || plan.reason !== undefined) && h('details', { className: 'iexp-flow-source' }, h('summary', null, '查看原文与关系说明'), plan.reason !== undefined && h('p', null, plan.reason), plan.sourceText !== undefined && h('pre', null, plan.sourceText))))
}
