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
import { resolveTheme } from '../../src/theme-contracts.js'
import { OPENUI_VISUAL_SAMPLE } from '../fixtures/intelligent-experience-canary/visual-sample.mjs'

declare const LOCAL_REPORT: string | null
const sessionId = 'local-ascii-gpu-fixture'
const params = new URLSearchParams(location.search)
const themeId = params.get('theme') === 'empryo' ? 'empryo' : 'ascii'
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
  const edges = [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[1,2],[2,3],[1,4],[3,5],[4,6],[5,7],[6,7]]
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
root.render(h(Fixture))
window.addEventListener('pagehide', () => { root.unmount(); removeAsciiEffect(); removeAppearance(); removeStyles(); displayModes.clear() }, { once: true })
