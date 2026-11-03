import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { BarChart, IconWrapper, LineChart, PieChart, RadarChart, ScatterChart, ThemeProvider } from '@openuidev/react-ui'
import { ExperienceStore, HeaderControls } from '../../src/client.js'
import { initialSettings, type ExperienceArtifact, type ExperienceSettings } from '../../src/contracts.js'
import { ArtifactView, ContentView, OutputView, displayModes, experienceTheme } from '../../src/presentation.js'
import { FlowView } from '../../src/flow-view.js'
import { installExperienceStyles } from '../../src/style.js'
import { installAppearanceStyles } from '../../src/appearance-style.js'
import { installAsciiVisualTheme } from '../../src/ascii-visual-theme.js'
import { publishAsciiVisualFrame, releaseAsciiVisualFrame } from '../../src/ascii-visual-frames.js'
import type { ExecutionEdge, ExecutionEvent, ExecutionNode, ExecutionPlan } from '../../src/execution-flow.js'
import { ThemeButton } from '../../src/theme-components.js'
import { resolveTheme } from '../../src/theme-contracts.js'
import { OPENUI_VISUAL_SAMPLE } from '../fixtures/intelligent-experience-canary/visual-sample.mjs'

declare const LOCAL_REPORT: string | null
const sessionId = 'local-ascii-gpu-fixture'
const params = new URLSearchParams(location.search)
const executionOnly = params.get('execution') === '1'
const showcaseOnly = params.get('showcase') === '1'
const typographyOnly = params.get('typography') === '1'
const requestedTheme = params.get('theme')
const themeId = requestedTheme && ['empryo','ascii','ascii-gpu','uiverse-soft-relief'].includes(requestedTheme) ? requestedTheme : 'ascii-gpu'
const preference = { activeId: themeId, installed: [] }
let settings: ExperienceSettings = { ...initialSettings(), takeover: true, openui: true, theme: preference, appearance: resolveTheme(preference).appearance }
const store = new ExperienceStore()
store.update({ settings, api: {
  settings: async () => settings,
  saveSettings: async input => {
    if (input.expectedRevision !== settings.revision) throw new Error('设置已变化，请重试。')
    const { themeId: nextThemeId, expectedRevision: _expected, ...values } = input
    const theme = nextThemeId ? { activeId: nextThemeId, installed: settings.theme?.installed ?? [] } : settings.theme
    resolveTheme(theme)
    settings = { ...settings, ...values, theme, revision: settings.revision + 1 }
    return settings
  },
  artifacts: async () => [],
  publish: async () => { throw new Error('本地验收不会发布内容。') },
} })
const removeStyles = installExperienceStyles(), removeAppearance = installAppearanceStyles(store)
const removeAsciiEffect = installAsciiVisualTheme(store)
experienceTheme.set('dark')

const chartData = [
  { period: '一月', measured: 18, baseline: 12 },
  { period: '二月', measured: 32, baseline: 20 },
  { period: '三月', measured: 24, baseline: 27 },
  { period: '四月', measured: 43, baseline: 31 },
]
const pieData = [{ category: '处理', value: 45 }, { category: '传输', value: 30 }, { category: '存储', value: 25 }]
const radarData = [
  { category: '准确', current: 80, baseline: 61 }, { category: '时效', current: 56, baseline: 75 },
  { category: '稳定', current: 72, baseline: 62 }, { category: '成本', current: 48, baseline: 58 },
  { category: '覆盖', current: 69, baseline: 53 },
]
const scatterData = [{ name: '样本 A', data: [{ x: 1, y: 3 }, { x: 2, y: 7 }, { x: 3, y: 4 }, { x: 5, y: 9 }] }, { name: '样本 B', data: [{ x: 1, y: 5 }, { x: 2, y: 2 }, { x: 4, y: 8 }] }]
const small = {
  title: '合成小型关系图',
  nodes: [{ id: 'input', label: '输入' }, { id: 'analysis', label: '分析' }, { id: 'result', label: '结果' }],
  edges: [{ source: 'input', target: 'analysis', label: '输入数据' }, { source: 'analysis', target: 'result', label: '输出结果' }],
  reason: '节点与关系均为本地合成样本。',
}
const large = {
  title: '合成大型关系图 · 64 节点',
  nodes: Array.from({ length: 64 }, (_, i) => ({ id: `node-${i}`, label: `合成节点 ${i + 1}`, description: `合成说明 ${i + 1}` })),
  edges: Array.from({ length: 63 }, (_, i) => ({ source: `node-${i}`, target: `node-${i + 1}`, label: `合成关系 ${i + 1}` })),
  reason: '这是确定性合成关系，不代表真实执行、业务或依赖。',
}
const rawSamples = { chartData, pieData, radarData, scatterData, small, large }
const demoReport = '# 合成研究输出\n\n以下图形和数值仅供本地验收，不代表真实服务。\n\n## 合成容量\n\n| 月份 | 费用（万元） |\n| --- | ---: |\n| 一月 | 12 |\n| 二月 | 24 |\n| 三月 | 19 |\n| 四月 | 35 |\n\n来源：固定本地样本。'
const report = typeof LOCAL_REPORT === 'string' ? LOCAL_REPORT : demoReport
const artifact: ExperienceArtifact = {
  formatVersion: 1, id: 'fixed-local-ascii-gpu-fixture', createdAt: '2026-11-02T00:00:00Z',
  source: { sessionId, kind: 'generated', label: 'OpenUI 合成输出' }, protocol: 'openui',
  raw: OPENUI_VISUAL_SAMPLE, payload: OPENUI_VISUAL_SAMPLE, providerId: 'local-fixture',
}

function RasterSamples(): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null), image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d')
    if (!element || !ctx) return
    const sky = ctx.createLinearGradient(0, 0, 0, element.height)
    sky.addColorStop(0, '#577a99'); sky.addColorStop(0.55, '#bd8e72'); sky.addColorStop(1, '#272b36')
    ctx.fillStyle = sky; ctx.fillRect(0, 0, element.width, element.height)
    ctx.fillStyle = '#232933'; ctx.beginPath(); ctx.moveTo(0, 145); ctx.lineTo(95, 82); ctx.lineTo(160, 126); ctx.lineTo(225, 72); ctx.lineTo(320, 142); ctx.lineTo(320, 180); ctx.lineTo(0, 180); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#f8dc9c'; ctx.beginPath(); ctx.arc(250, 42, 18, 0, Math.PI * 2); ctx.fill()
    if (image.current) image.current.src = element.toDataURL('image/png')
    const publish = () => publishAsciiVisualFrame(element)
    element.addEventListener('iexp:visual-frame-request', publish)
    publish()
    return () => { element.removeEventListener('iexp:visual-frame-request', publish); releaseAsciiVisualFrame(element) }
  }, [])
  return h('section', { className: 'fixture-section', 'data-fixture-kind': 'bitmap' }, h('h2', null, '合成位图 · Canvas 与 PNG'),
    h('p', null, '同一幅合成光影：左侧为 Canvas，右侧为本地生成的 PNG，并非实拍。'),
    h('div', { className: 'fixture-raster' }, h('canvas', { ref: canvas, width: 320, height: 180, 'aria-label': '合成山景 Canvas' }), h('img', { ref: image, alt: '合成山景 PNG' })))
}

function NetworkScene(): ReactElement {
  const nodes = [
    { x: 120, y: 112, label: '核心', radius: 21 },
    { x: 45, y: 50, label: '数据', radius: 15 }, { x: 119, y: 31, label: '模型', radius: 15 },
    { x: 193, y: 50, label: '工具', radius: 15 }, { x: 34, y: 147, label: '来源', radius: 15 },
    { x: 207, y: 147, label: '输出', radius: 15 }, { x: 71, y: 207, label: '验证', radius: 15 },
    { x: 168, y: 207, label: '洞察', radius: 15 },
  ]
  const edges = [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[1,2],[2,3],[1,4],[3,5],[4,6],[5,7],[6,7]] as const
  return h('svg', { viewBox: '0 0 240 240', width: 240, height: 240, role: 'img', 'aria-label': '合成网络图，展示核心与七个节点的关系', 'data-fixture-icon': 'scene' },
    h('circle', { cx: 120, cy: 120, r: 103, fill: 'none', stroke: '#52677a', strokeWidth: 0.7, strokeDasharray: '3 6' }),
    h('circle', { cx: 120, cy: 120, r: 74, fill: 'none', stroke: '#384c5b', strokeWidth: 0.6 }),
    ...edges.map(([from, to], index) => {
      const a = nodes[from]!, b = nodes[to]!
      return h('path', { key: `edge-${index}`, d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, fill: 'none', stroke: index < 7 ? '#99b9cf' : '#52677a', strokeWidth: index < 7 ? 1.3 : 0.7 })
    }),
    ...nodes.map((node, index) => h('g', { key: node.label },
      h('circle', { cx: node.x, cy: node.y, r: node.radius + 3, fill: 'none', stroke: '#7895aa', strokeWidth: 0.7 }),
      h('circle', { cx: node.x, cy: node.y, r: node.radius, fill: index === 0 ? '#577f9a' : '#243d4c', stroke: '#b1c9d5', strokeWidth: 1 }),
      h('circle', { cx: node.x, cy: node.y - 5, r: 2, fill: '#d6ecf4' }),
      h('text', { x: node.x, y: node.y + 7, textAnchor: 'middle', fill: '#f1f5f5', fontSize: 8 }, node.label))))
}

/** A transparent source image created locally for the real image-object path. */
function SyntheticObjectImage(): ReactElement {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true, objectUrl = ''
    const surface = document.createElement('canvas')
    surface.width = surface.height = 320
    const ctx = surface.getContext('2d')
    if (!ctx) { setError('无法创建本地合成图标。'); return }
    const nodes = [
      [160, 160, 27], [160, 46, 14], [238, 80, 17], [274, 160, 12],
      [238, 240, 16], [160, 274, 14], [80, 240, 16], [46, 160, 12], [80, 80, 17],
      [160, 100, 8], [220, 160, 8], [160, 220, 8], [100, 160, 8],
    ] as const
    const links = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1], [9, 10], [10, 11], [11, 12], [12, 9]] as const
    ctx.clearRect(0, 0, surface.width, surface.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.strokeStyle = '#92bda5'; ctx.lineWidth = 3
    for (const [from, to] of links) {
      const a = nodes[from]!, b = nodes[to]!
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    }
    ctx.strokeStyle = '#d7edd9'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(160, 160, 128, 0, Math.PI * 2); ctx.stroke()
    for (const [index, [x, y, radius]] of nodes.entries()) {
      ctx.fillStyle = index === 0 ? '#f1fff0' : '#b9d985'
      ctx.strokeStyle = '#e5f4df'; ctx.lineWidth = index === 0 ? 4 : 2
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#415d49'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, radius * 0.3), 0, Math.PI * 2); ctx.fill()
    }
    surface.toBlob(blob => {
      if (!live) return
      if (!blob) { setError('无法生成本地合成 PNG。'); return }
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }, 'image/png')
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [])
  const record = { type: 'image/png', role: 'illustration', url, alt: '原始合成图标' }
  return h('section', { className: 'fixture-section', 'data-fixture-kind': 'ascii-object', 'data-fixture-object': 'synthetic-network-png' },
    h('h2', null, '合成网络图标 · ASCII Object'),
    h('p', null, '本地图形生成的透明 PNG；同时保留原图与来源记录。'),
    error ? h('p', { role: 'status' }, error) : url ? h(ContentView, { value: record }) : h('p', { role: 'status' }, '正在生成本地合成图标…'))
}

const showcaseMarkdown = `## 合成样本

以下数值仅用于本地展示。

| 类别 | 样本数（项） |
| --- | ---: |
| 甲 | 18 |
| 乙 | 32 |
| 丙 | 24 |
| 丁 | 43 |
`

type FixtureDisposable = { dispose(): void }
type FixtureMesh = { rotation: { set(x: number, y: number, z: number): unknown } }
type FixtureGroup = { add(...items: FixtureMesh[]): unknown }
type FixtureThree = {
  Group: new () => FixtureGroup
  Mesh: new (geometry: FixtureDisposable, material: FixtureDisposable) => FixtureMesh
  MeshStandardMaterial: new (options: { color: string, metalness: number, roughness: number }) => FixtureDisposable
  TorusGeometry: new (...values: number[]) => FixtureDisposable
  TorusKnotGeometry: new (...values: number[]) => FixtureDisposable
}
type FixtureExporter = { GLTFExporter: new () => { parseAsync(scene: FixtureGroup, options: { binary: true }): Promise<ArrayBuffer | Record<string, unknown>> } }

/** The GLB and its object URL exist only for the lifetime of this local fixture. */
function SyntheticModel(): ReactElement {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true, objectUrl = ''
    let disposeGeometry = () => {}
    // The pinned project dependency is JavaScript-only; keep the fixture's used API typed locally.
    // @ts-expect-error Three.js 0.185.1 has no declarations in this project.
    const threeModule = import('three') as Promise<FixtureThree>
    // @ts-expect-error The pinned exporter's declarations are not installed either.
    const exporterModule = import('three/addons/exporters/GLTFExporter.js') as Promise<FixtureExporter>
    void Promise.all([threeModule, exporterModule]).then(async ([three, { GLTFExporter }]) => {
      if (!live) return
      const group = new three.Group()
      const geometry = new three.TorusKnotGeometry(0.8, 0.24, 192, 28, 2, 3)
      const ringGeometry = new three.TorusGeometry(1.48, 0.026, 8, 112)
      const material = new three.MeshStandardMaterial({ color: '#d1e3d0', metalness: 0.15, roughness: 0.58 })
      const ringMaterial = new three.MeshStandardMaterial({ color: '#a9c8ad', metalness: 0.12, roughness: 0.66 })
      let disposed = false
      disposeGeometry = () => {
        if (disposed) return
        disposed = true; geometry.dispose(); ringGeometry.dispose(); material.dispose(); ringMaterial.dispose()
      }
      const knot = new three.Mesh(geometry, material)
      knot.rotation.set(0.36, -0.22, 0.12)
      const firstRing = new three.Mesh(ringGeometry, ringMaterial)
      firstRing.rotation.set(0.28, 0.35, 0.1)
      const secondRing = new three.Mesh(ringGeometry, ringMaterial)
      secondRing.rotation.set(1.05, 0.2, 0.75)
      group.add(knot, firstRing, secondRing)
      return new GLTFExporter().parseAsync(group, { binary: true })
    }).then(result => {
      if (!live) return
      if (!(result instanceof ArrayBuffer)) throw new Error('未生成二进制模型')
      objectUrl = URL.createObjectURL(new Blob([result], { type: 'model/gltf-binary' }))
      setUrl(objectUrl)
    }).catch(() => { disposeGeometry(); if (live) setError('无法生成本地三维模型。') })
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      disposeGeometry()
    }
  }, [])
  const source = { type: 'model/gltf-binary', url, title: '本地合成几何模型' }
  return h('section', { className: 'fixture-showcase-panel fixture-showcase-model', 'data-fixture-showcase': 'model' },
    h('h2', null, '本地合成三维模型'),
    h('p', null, '本地合成模型；可旋转，保留原始模型链接。'),
    error ? h('p', { role: 'status' }, error) : url ? h(OutputView, { sessionId, raw: source }, h(ContentView, { value: source })) : h('p', { role: 'status' }, '正在生成本地模型…'))
}

function ShowcaseFixture(): ReactElement {
  return h('main', { className: 'fixture-main' },
    h('header', { className: 'fixture-header' },
      h('div', null, h('h1', null, 'ASCII 图形 · 本地展示'), h('p', null, '三维模型、网络图和数据均为合成样本。')),
      h(HeaderControls, { store, sessionId })),
    h('div', { 'data-slot': 'conversation.view', className: 'dsh-experience fixture-content fixture-showcase' },
      h(SyntheticModel),
      h('div', { className: 'fixture-showcase-side' },
        h('section', { className: 'fixture-showcase-panel fixture-showcase-network', 'data-fixture-showcase': 'network' },
          h('h2', null, '合成网络图标'), h(NetworkScene)),
        h('section', { className: 'fixture-showcase-panel fixture-showcase-chart', 'data-fixture-showcase': 'chart' },
          h('h2', null, '合成数据对照'), h(OutputView, { sessionId, raw: showcaseMarkdown }, h(ContentView, { value: showcaseMarkdown }))))))
}

const terminalMarkdown = `# 字符终端里的研究输出

技术洞察需要清晰的正文、精确的数字和可追溯的证据。Terminal text should feel consistent: i l 1 I / O 0; !=; fi fl.

## 证据与判断

**结论保持可读**，强调通过字重区分。GPU ASCII 负责图形，原生文字仍可选择和复制；不会修改原始报告，也不会给每一行添加虚假的命令提示符。

- 数据期间：2026-11-01 至 2026-11-02；以下均为合成测试。
- API latency = 12.50 ms；sample_count = 1,024；confidence = 0.85。
- 中文全角标点：“证据”、（单位）、《来源》，中英混排自然换行。

### 合成数据对照

| 项目 | 耗时（ms） |
|---|---:|
| 检索 Search | 12.5 |
| 分析 Analyze | 24 |
| 验证 Verify | 18 |

来源：确定性本地样本，非真实任务指标。

\`\`\`text
task       state       elapsed
search     complete     12.50 ms
analyze    running       24.00 ms
verify     queued         0.00 ms
\`\`\`

#### 编码与复核

保留完整原文、代码、数值和口径；[查看合成来源](https://example.com/synthetic/research/source-with-a-long-path-for-wrapping-0123456789)。
`
function TypographyFixture(): ReactElement {
  return h('main', { className:'fixture-main' },
    h('header', { className:'fixture-header' },
      h('div',null,h('h1',null,'终端文字 · 本地验收'),h('p',null,'中英混排、数值与代码均为合成样本。')),
      h(HeaderControls,{store,sessionId})),
    h('div',{'data-slot':'conversation.view',className:'dsh-experience fixture-content','data-fixture-typography':true},
      h(OutputView,{sessionId,raw:terminalMarkdown},h(ContentView,{value:terminalMarkdown}))))
}

// These immutable snapshots are illustrative local input, not DSH task state.
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }
  return value
}
const replayNodes: Array<Omit<ExecutionNode, 'status' | 'progress' | 'metrics'> & { total: number }> = [
  { id: 'lead', label: '主控 Agent', role: 'lead', model: '演示模型 A', description: '整理目标与范围', total: 2 },
  { id: 'advisor', label: '顾问 Agent', role: 'advisor', model: '演示模型 B', description: '检查计划与约束', total: 3 },
  { id: 'router', label: '任务路由', role: 'tool', description: '分派三项并行工作', total: 1 },
  { id: 'worker-a', label: '资料收集', role: 'worker', model: '演示模型 C', description: '整理示例材料', total: 4 },
  { id: 'worker-b', label: '方案分析', role: 'worker', model: '演示模型 D', description: '梳理示例方案', total: 3 },
  { id: 'worker-c', label: '结果验证', role: 'worker', model: '演示模型 E', description: '检查示例结果', total: 5 },
  { id: 'review', label: '汇总审阅', role: 'advisor', model: '演示模型 B', description: '合并与审阅示例结果', total: 2 },
]
const replayLinks = [
  ['lead', 'router'], ['advisor', 'router'], ['router', 'worker-a'], ['router', 'worker-b'], ['router', 'worker-c'],
  ['worker-a', 'review'], ['worker-b', 'review'], ['worker-c', 'review'],
] as const
type ReplayStage = { at: number, statuses: NonNullable<ExecutionNode['status']>[], completed: number[] }
const replayStages: ReplayStage[] = [
  { at: 0, statuses: ['running', 'queued', 'queued', 'queued', 'queued', 'queued', 'queued'], completed: [0, 0, 0, 0, 0, 0, 0] },
  { at: 3, statuses: ['succeeded', 'running', 'queued', 'queued', 'queued', 'queued', 'queued'], completed: [2, 1, 0, 0, 0, 0, 0] },
  { at: 6, statuses: ['succeeded', 'succeeded', 'running', 'queued', 'queued', 'queued', 'queued'], completed: [2, 3, 0, 0, 0, 0, 0] },
  { at: 9, statuses: ['succeeded', 'succeeded', 'succeeded', 'running', 'running', 'running', 'queued'], completed: [2, 3, 1, 1, 1, 1, 0] },
  { at: 13, statuses: ['succeeded', 'succeeded', 'succeeded', 'running', 'running', 'running', 'queued'], completed: [2, 3, 1, 2, 2, 3, 0] },
  { at: 17, statuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'running', 'running', 'queued'], completed: [2, 3, 1, 4, 2, 4, 0] },
  { at: 21, statuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'running'], completed: [2, 3, 1, 4, 3, 5, 1] },
  { at: 25, statuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'], completed: [2, 3, 1, 4, 3, 5, 2] },
]
const replayEvents: Array<ExecutionEvent & { at: number }> = [
  { at: 0, id: 'event-0', nodeId: 'lead', message: '本地演示开始：整理示例目标。' },
  { at: 3, id: 'event-1', nodeId: 'advisor', message: '主控完成示例范围，顾问开始检查。' },
  { at: 6, id: 'event-2', nodeId: 'router', message: '顾问检查完成，路由准备分派。' },
  { at: 9, id: 'event-3', nodeId: 'router', message: '三项示例工作并行开始。' },
  { at: 13, id: 'event-4', nodeId: 'worker-c', message: '并行节点更新了示例进度。' },
  { at: 17, id: 'event-5', nodeId: 'worker-a', message: '资料收集示例完成，等待汇合。' },
  { at: 21, id: 'event-6', nodeId: 'review', message: '三项示例工作已完成，开始汇总。' },
  { at: 25, id: 'event-7', nodeId: 'review', message: '本地演示回放结束。' },
]
const stamp = (seconds: number) => new Date(Date.UTC(2000, 0, 1, 0, 0, seconds)).toISOString()
const replaySnapshots: readonly ExecutionPlan[] = freezeDeep(replayStages.map(stage => {
  const nodes: ExecutionNode[] = replayNodes.map(({ total, ...node }, index) => ({
    ...node, status: stage.statuses[index]!, progress: { current: stage.completed[index]!, total, unit: '项' },
    metrics: [{ label: '示例完成', value: stage.completed[index]!, unit: '项' }],
  }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges: ExecutionEdge[] = replayLinks.map(([source, target]) => {
    const from = byId.get(source)!, to = byId.get(target)!
    return { source, target, status: to.status === 'succeeded' ? 'done' : from.status === 'succeeded' && to.status === 'running' ? 'active' : 'idle' }
  })
  const events = replayEvents.filter(event => event.at <= stage.at).map(({ at, ...event }) => ({ ...event, timestamp: stamp(at) }))
  return { kind: 'execution-flow' as const, title: '本地演示 · 并行执行流程', nodes, edges, events, updatedAt: stamp(stage.at) }
}))

function ExecutionReplay(): ReactElement {
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(true), [generation, setGeneration] = useState(0)
  const remaining = useRef((replayStages[1]!.at - replayStages[0]!.at) * 1000)
  const version = useRef(0)
  useEffect(() => {
    if (!playing || step >= replaySnapshots.length - 1) return
    const currentVersion = version.current, duration = remaining.current, started = performance.now()
    let fired = false
    const timer = window.setTimeout(() => {
      fired = true
      const next = step + 1
      remaining.current = next < replaySnapshots.length - 1 ? (replayStages[next + 1]!.at - replayStages[next]!.at) * 1000 : 0
      setStep(next)
      if (next === replaySnapshots.length - 1) setPlaying(false)
    }, duration)
    return () => {
      window.clearTimeout(timer)
      if (!fired && currentVersion === version.current) remaining.current = Math.max(0, duration - (performance.now() - started))
    }
  }, [step, playing, generation])
  const replay = () => {
    version.current++
    remaining.current = (replayStages[1]!.at - replayStages[0]!.at) * 1000
    setStep(0); setPlaying(true); setGeneration(value => value + 1)
  }
  const snapshot = replaySnapshots[step]!
  return h('section', { className: 'fixture-section', 'data-fixture-execution': true, 'data-fixture-replay-step': step, 'data-fixture-replay-playing': playing },
    h('h2', null, '本地演示回放'),
    h('p', null, '固定合成快照，展示分派、并行与汇合；不运行模型或真实任务。'),
    h('div', { className: 'iexp-flow-toolbar' },
      h(ThemeButton, { type: 'button', onClick: () => setPlaying(value => !value), disabled: step === replaySnapshots.length - 1 }, playing ? '暂停回放' : '继续回放'),
      h(ThemeButton, { type: 'button', onClick: replay }, '重新回放'),
      h('span', { className: 'fixture-replay-clock' }, `演示进度 ${replayStages[step]!.at} / 25 秒`)),
    h(OutputView, { sessionId, raw: snapshot }, h(ContentView, { value: snapshot })))
}

function ExecutionFixture(): ReactElement {
  return h('main', { className: 'fixture-main' },
    h('header', { className: 'fixture-header' },
      h('div', null, h('h1', null, '执行流程 · 本地验收'), h('p', null, '仅展示合成快照；不连接正式 DSH。')),
      h(HeaderControls, { store, sessionId })),
    h('div', { 'data-slot': 'conversation.view', className: 'dsh-experience fixture-content' }, h(ExecutionReplay)))
}

function Fixture(): ReactElement {
  const [count, setCount] = useState(0)
  const clicked = () => setCount(value => value + 1)
  const charts = [
    { name: '柱状图', chart: h(BarChart, { data: chartData, categoryKey: 'period', height: 230, width: '100%', condensed: true, legend: true, isAnimationActive: false, onClick: clicked }) },
    { name: '折线图', chart: h(LineChart, { data: chartData, categoryKey: 'period', height: 230, width: '100%', condensed: true, legend: true, showDots: true, crosshair: true, isAnimationActive: false, onClick: clicked }) },
    { name: '环形图', chart: h(PieChart, { data: pieData, categoryKey: 'category', dataKey: 'value', height: 230, width: '100%', variant: 'donut', legend: true, legendVariant: 'default', minChartSize: 120, maxChartSize: 220, isAnimationActive: false, onClick: clicked }) },
    { name: '雷达图', chart: h(RadarChart, { data: radarData, categoryKey: 'category', height: 230, width: '100%', legend: true, variant: 'area', minChartSize: 120, maxChartSize: 220, isAnimationActive: false, onClick: clicked }) },
    { name: '散点图', chart: h(ScatterChart, { data: scatterData, height: 230, width: '100%', grid: true, legend: true, isAnimationActive: false, onClick: clicked }) },
  ]
  return h('main', { className: 'fixture-main' },
    h('header', { className: 'fixture-header' },
      h('div', null, h('h1', null, 'ASCII 图形本地验收'), h('p', null, LOCAL_REPORT ? '图形样本为合成数据；另含指定的本地报告。不连接正式 DSH，不调用模型。' : '所有图表、关系与图片均为合成样本；不连接正式 DSH，不调用模型。')),
      h(HeaderControls, { store, sessionId })),
    h('div', { 'data-slot': 'conversation.view', className: 'dsh-experience fixture-content' },
      h(OutputView, { sessionId, raw: JSON.stringify(rawSamples, null, 2) },
        h(ThemeProvider, { cssSelector: '.dsh-experience', mode: 'dark' },
          h('section', { className: 'fixture-section', 'data-fixture-kind': 'icons' }, h('h2', null, '图标与命中区域'),
            h('p', null, '小图标、大图标和按钮来自实际组件；网络图为本地合成 SVG。'),
            h('div', { className: 'fixture-icons' },
              h('span', { 'data-fixture-icon': 'small', 'aria-label': '小图标：活动' }, h(IconWrapper, { name: 'activity', size: 18 })),
              h('span', { 'data-fixture-icon': 'large', 'aria-label': '大图标：网络' }, h(IconWrapper, { name: 'network', size: 112 })),
              h(NetworkScene),
              h('button', { type: 'button', onClick: clicked }, h('span', { 'aria-hidden': true }, h(IconWrapper, { name: 'search', size: 18 })), ' 检查点击'),
              h('label', null, '本地输入 ', h('input', { type: 'text', defaultValue: '原始内容保持可编辑', 'aria-label': '本地验收输入' }))),
            h('p', { role: 'status', 'data-fixture-clicks': true }, `交互计数：${count}`)),
          h('section', { className: 'fixture-section', 'data-fixture-kind': 'charts' }, h('h2', null, 'OpenUI 原生图表'),
            h('div', { className: 'fixture-grid' }, ...charts.map(({ name, chart }) => h('section', { key: name, className: 'fixture-chart', 'data-fixture-chart': name }, h('h3', null, name), chart))),
            h('details', null, h('summary', null, '查看全部合成图表数据'), h('pre', null, JSON.stringify({ chartData, pieData, radarData, scatterData }, null, 2)))),
          h(RasterSamples),
          h('section', { className: 'fixture-section', 'data-fixture-kind': 'small-flow' }, h('h2', null, '小型流程'), h(FlowView, { plan: small, motion: false })),
          h('section', { className: 'fixture-section', 'data-fixture-kind': 'large-flow' }, h('h2', null, '大型流程'), h(FlowView, { plan: large, motion: false })),
        )),
      h('section', { className: 'fixture-section', 'data-fixture-kind': 'artifact' }, h('h2', null, '生成内容 · ArtifactView'), h(ArtifactView, { artifact, openuiEnabled: true })),
      h('section', { className: 'fixture-section', 'data-fixture-kind': 'report' }, h('h2', null, LOCAL_REPORT ? '指定的本地报告' : '普通输出 · ContentView'),
        h(OutputView, { sessionId, raw: report }, h(ContentView, { value: report }))),
      h(SyntheticObjectImage)))
}

const root = createRoot(document.getElementById('root')!)
root.render(h(typographyOnly ? TypographyFixture : executionOnly ? ExecutionFixture : showcaseOnly ? ShowcaseFixture : Fixture))
window.addEventListener('pagehide', () => { root.unmount(); removeAsciiEffect(); removeAppearance(); removeStyles(); displayModes.clear() }, { once: true })
