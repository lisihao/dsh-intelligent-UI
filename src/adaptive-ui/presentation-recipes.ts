import { CANVAS_HTML_EFFECT_NAMES } from '../canvas-html-names.js'

/** Executable source-bound recipes. Catalog/archive entries are not recipes. */
export const BLOCK_PRESENTATION_IDS = [
  'reading', 'cards', 'disclosure', 'table', 'board', 'records', 'flow',
  'source-list-grid', 'source-label-table',
  'chart-openui', 'chart-compact', 'chart-dense', 'chart-ascii', 'chart-visx',
  'illustration-native', 'object-ink', 'object-ascii', 'object-glass',
  'live-native', 'live-liveline', 'loading-native', 'loading-skullet', 'text-native', 'text-torph',
  ...CANVAS_HTML_EFFECT_NAMES.map(slug => `canvas-${slug}` as const),
  'canvas-bend', 'canvas-hex-float', 'canvas-particle-scroll',
] as const
export type BlockPresentationId = typeof BLOCK_PRESENTATION_IDS[number]

/** Names refer to real renderer adapters, never to arbitrary archived markup. */
export const BLOCK_PRESENTATION_LABELS = {
  reading: '完整阅读', cards: '内容卡片', disclosure: '可展开详情',
  table: '完整表格', board: '任务看板', records: '记录详情', flow: '来源步骤与关系图',
  'source-list-grid': '来源条目网格', 'source-label-table': '来源标签详情表',
  'chart-openui': 'OpenUI 图表', 'chart-compact': '紧凑比较图', 'chart-dense': '密集趋势图',
  'chart-ascii': 'ASCII 图表', 'chart-visx': 'Visx 历史图表',
  'illustration-native': '原生插图或模型', 'object-ink': '墨绘对象',
  'object-ascii': 'ASCII 对象', 'object-glass': '玻璃对象',
  'live-native': '实时序列静态快照', 'live-liveline': 'Liveline 实时序列',
  'loading-native': '原生加载状态', 'loading-skullet': 'Skullet 加载骨架',
  'text-native': '原生数值或文字更新', 'text-torph': 'Torph 数值或文字变形',
  ...Object.fromEntries(CANVAS_HTML_EFFECT_NAMES.map(slug => [`canvas-${slug}`, `Canvas ${slug} 视觉副本`])),
  'canvas-bend': 'Canvas Bend 隔离视觉副本', 'canvas-hex-float': 'Canvas Hex Float 隔离视觉副本',
  'canvas-particle-scroll': 'Canvas Particle Scroll 视觉副本',
} as Readonly<Record<BlockPresentationId, string>>
