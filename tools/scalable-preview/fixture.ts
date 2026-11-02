import { createElement as h, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@openuidev/react-ui'
import { AutoChart, ContentView, experienceTheme } from '../../src/presentation.js'
import { FlowView, type FlowViewPlan } from '../../src/flow-view.js'
import { ThemeButton } from '../../src/theme-components.js'
import { installExperienceStyles } from '../../src/style.js'
import { installAppearanceStyles } from '../../src/appearance-style.js'
import { initialSettings } from '../../src/contracts.js'
import { resolveTheme } from '../../src/theme-contracts.js'
import type { AutoChartPlan } from '../../src/content-analysis.js'

type Section = 'line' | 'categories' | 'graph'
const count = new Intl.NumberFormat('zh-CN')
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength
const labels = Array.from({ length: 10_000 }, (_, row) => new Date(Date.UTC(1990, 0, 1) + row * 86_400_000).toISOString().slice(0, 10))
const first = labels.map((_label, row) => Math.round(Math.sin(row / 17) * 2000) / 100)
const second = labels.map((_label, row) => Math.round(Math.cos(row / 29) * 1500) / 100)
first[1234] = 4800; first[8765] = -3900; second[4321] = 5200; second[6789] = -4400
const line: AutoChartPlan = {
  kind: 'line', title: '合成容量序列 · 10,000 天', basis: '合成偏差；单位：ms', labels,
  series: [{ name: '合成偏差 A', values: first, unit: 'ms', originals: first.map(value => `${value.toFixed(2)}ms`) }, { name: '合成偏差 B', values: second, unit: 'ms', originals: second.map(value => `${value.toFixed(2)}ms`) }],
  sourceRows: labels.map((_label, row) => row), sourceColumns: [1, 2], sourceRowCount: labels.length, sourceColumnCount: 3,
  reason: '确定性合成容量数据；不是实际服务性能。两个序列分别包含正负尖峰，首尾、原值和原始顺序均保留。', icon: 'gauge',
}
const lineRecords = labels.map((label, row) => ({ 日期: label, '合成偏差 A（ms）': line.series[0]!.originals![row], '合成偏差 B（ms）': line.series[1]!.originals![row] }))
const categories: AutoChartPlan = {
  kind: 'bar', title: '合成类别比较 · 1,000 项', basis: '原始类别顺序；单位：ms',
  labels: Array.from({ length: 1000 }, (_, row) => `合成类别 ${row + 1}`),
  series: [{ name: '合成偏差', unit: 'ms', values: Array.from({ length: 1000 }, (_, row) => ((row * 37) % 997) - 400) }],
  sourceRows: Array.from({ length: 1000 }, (_, row) => row), sourceColumns: [1], sourceRowCount: 1000, sourceColumnCount: 2,
  reason: '确定性合成类别数据；不排名、不合并、不生成实际产品性能结论。', icon: 'chart-column',
}
categories.series[0]!.originals = categories.series[0]!.values.map(value => `${value}ms`)
const categoryRecords = categories.labels.map((label, row) => ({ 类别: label, '合成偏差（ms）': categories.series[0]!.originals![row] }))
const graph = {
  nodes: Array.from({ length: 1000 }, (_, index) => ({ id: `capacity-node-${index}`, label: `合成节点 ${index + 1}`, description: `确定性容量记录 ${index + 1}；不代表真实任务。` })),
  edges: Array.from({ length: 5000 }, (_, index) => { const source = Math.floor(index / 5), step = index % 5 + 1; return { source: `capacity-node-${source}`, target: `capacity-node-${(source + step) % 1000}`, label: `合成关系 ${index + 1}` } }),
}
const graphSource = JSON.stringify(graph)
const graphBytes = new TextEncoder().encode(graphSource).byteLength
if (graphBytes >= 1024 * 1024) throw new Error('合成图夹具意外超过 1 MiB。')
const graphPlan: FlowViewPlan = { ...graph, title: '合成容量图 · 1,000 节点 / 5,000 原始边', sourceText: graphSource, reason: '确定性合成容量数据。每个节点明确连接到环上后五个节点；这些关系就是输入原始边，未推断真实世界关系。' }
const sizes = { line: bytes(lineRecords), categories: bytes(categoryRecords), graph: graphBytes }
const titles: Record<Section, string> = { line: '10,000 天序列', categories: '1,000 类别', graph: '1,000 节点 / 5,000 边' }
const settings = { ...initialSettings(), takeover: false, theme: { activeId: 'empryo', installed: [] }, appearance: resolveTheme().appearance }
const removeStyles = installExperienceStyles()
const removeAppearance = installAppearanceStyles({ snapshot: () => ({ settings }), subscribe: () => () => {} })
experienceTheme.set('dark')
function Fixture(): ReactElement {
  const query = new URLSearchParams(location.search)
  const [section, setSection] = useState<Section>(() => ['line', 'categories', 'graph'].includes(query.get('view') ?? '') ? query.get('view') as Section : 'line')
  const [automatic, setAutomatic] = useState(query.get('auto') === '1')
  const source = section === 'line' ? lineRecords : section === 'categories' ? categoryRecords : graphSource
  return h(ThemeProvider, { cssSelector: '.dsh-experience', mode: 'dark' }, h('main', { className: 'dsh-experience capacity-preview', 'data-capacity-view': section, 'data-source-bytes': sizes[section] },
    h('header', { className: 'capacity-preview-header' }, h('h1', null, '合成容量验证'),
      h('p', null, '所有记录均由固定公式生成，仅验证展示容量、原值与溯源；没有模型调用，也不连接真实会话或服务。'),
      h('nav', { className: 'capacity-preview-controls', 'aria-label': '选择容量场景' }, ...Object.entries(titles).map(([value, title]) => h(ThemeButton, { key: value, type: 'button', 'aria-pressed': section === value, onClick: () => setSection(value as Section) }, title))),
      h('div', { className: 'capacity-preview-controls' }, h('label', null, h('input', { type: 'checkbox', checked: automatic, onChange: event => setAutomatic(event.currentTarget.checked) }), '使用 ContentView 自动识别普通输出')),
      h('div', { className: 'capacity-preview-summary' }, h('span', null, `输入 JSON：${count.format(sizes[section])} 字节`), h('span', null, section === 'graph' ? '1,000 节点，5,000 原始边；小于 1 MiB。' : section === 'line' ? '10,000 原始行，两个序列；四个不同正负尖峰。' : '1,000 原始类别；不排名、不筛选。'), h('span', null, '主题：Empryo · 深色'))),
    h('div', { key: `${section}-${automatic}`, className: 'capacity-preview-content dsh-experience iexp-content', 'data-experience-theme': 'dark' },
      automatic ? h(ContentView, { value: source }) : section === 'graph' ? h(FlowView, { plan: graphPlan, motion: false }) : h(AutoChart, { plan: section === 'line' ? line : categories }))))
}
const root = createRoot(document.getElementById('root')!)
root.render(h(Fixture))
window.addEventListener('pagehide', () => { root.unmount(); removeAppearance(); removeStyles() }, { once: true })
