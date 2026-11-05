import type { ComposeInput } from '../../src/adaptive-ui/contracts.js'

/** Explicit synthetic sources and independent acceptance expectations; never real user data. */
export interface ConversationScenario {
  id: string
  title: string
  prompt: string
  value: ComposeInput['value']
  choices: Record<string, string>
  requiredText: string[]
  requiredSelector: string
  forbiddenSelectors: string[]
  forbiddenOptions: Record<string, string[]>
  nextValue?: ComposeInput['value']
  nextText?: string
}

export const conversationScenarios: readonly ConversationScenario[] = [
  {
    id: 'short-conditional-answer', title: '普通条件短答',
    prompt: '简要说明：当前没有拿到检测结果，能否判断服务已经恢复？',
    value: '尚未拿到检测结果，因此不能确认服务已经恢复；这也不表示服务一定仍然故障。',
    choices: { theme: 'plain', surface: 'semantic', layout: 'document' },
    requiredText: ['尚未拿到检测结果', '不能确认服务已经恢复', '不表示服务一定仍然故障'],
    requiredSelector: '.iexp-document', forbiddenSelectors: ['svg[role="img"]', '.react-flow', '.iexp-board', '[data-live-series]'],
    forbiddenOptions: { layout: ['board', 'records', 'flow', 'research'], chart: ['openui', 'visx', 'dense'] },
  },
  {
    id: 'historical-gap', title: '非等间隔、带缺失值的历史图',
    prompt: '把这组历史延迟画出来，保留实际日期间隔；缺失值不要补成零。',
    value: '# 合成历史延迟\n\n| 日期 | 延迟（ms） |\n| --- | ---: |\n| 2026-10-01 | 12.50 |\n| 2026-10-02 | 11.25 |\n| 2026-10-05 | — |\n| 2026-10-09 | 9.75 |\n| 2026-10-10 | 10.00 |\n\n固定合成数据；缺失不表示零，下降不证明任何改动造成改善。',
    choices: { theme: 'uiverse-soft-relief', 'component-set': 'soft-relief', surface: 'semantic', chart: 'visx', layout: 'auto' },
    requiredText: ['2026-10-01', '2026-10-05', '12.50', '10.00', '—', '缺失不表示零', '下降不证明任何改动造成改善'],
    requiredSelector: '.iexp-historical-chart path.visx-linepath', forbiddenSelectors: ['[data-live-series]', '.iexp-board'],
    forbiddenOptions: { live: ['liveline', 'native'], layout: ['board', 'flow'] },
  },
  {
    id: 'task-board', title: '已有任务状态的机械描边看板',
    prompt: '把任务组织成看板；只显示原来已有的状态，不执行或推进任务。',
    value: [
      { Task: '核对来源', Status: 'queued', Description: '需要原始链接；尚未开始。' },
      { Task: '核查单位', Status: 'running', Description: '单位为 ms，不改成 s。' },
      { Task: '记录限制', Status: 'done', Description: '检查完成不等于检查通过。' },
    ],
    choices: { theme: 'uiverse-mechanical-outline', 'component-set': 'mechanical-outline', surface: 'semantic', layout: 'board' },
    requiredText: ['核对来源', '核查单位', '记录限制', '单位为 ms，不改成 s。', '检查完成不等于检查通过。'],
    requiredSelector: '.iexp-board .iexp-task', forbiddenSelectors: ['.react-flow', '[data-live-series]'],
    forbiddenOptions: { chart: ['visx', 'dense'], live: ['liveline'] },
  },
  {
    id: 'signed-number-update', title: '带符号和精度的数值更新',
    prompt: '更新偏差显示，保留正负号、小数位和单位；只更新数据，不重新决定布局。',
    value: { type: 'metric-update', label: '合成偏差', previous: '+0.00', value: '-0.75', unit: 'ms' },
    nextValue: { type: 'metric-update', label: '合成偏差', previous: '-0.75', value: '+0.00', unit: 'ms' },
    nextText: '+0.00 ms',
    choices: { theme: 'uiverse-clear-glass', 'component-set': 'clear-glass', surface: 'semantic', 'text-motion': 'none', layout: 'auto' },
    requiredText: ['合成偏差', '-0.75 ms', '+0.00'], requiredSelector: '[data-iexp-update="metric-update"]',
    forbiddenSelectors: ['.react-flow', '.iexp-historical-chart', '[data-live-series]'],
    forbiddenOptions: { chart: ['openui', 'visx'], layout: ['flow', 'board'], live: ['liveline'] },
  },
  {
    id: 'live-exact-snapshot', title: '减少动态效果下的实时源精确快照',
    prompt: '查看实时探针；减少动态效果时保留完整静态数据，后续数据不重复请求布局。',
    value: { type: 'live-series', source: 'synthetic:latency-probe', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1000, value: 8.25 }, { time: 2000, value: 7.5 }], updatedAt: 2000 },
    nextValue: { type: 'live-series', source: 'synthetic:latency-probe', unit: 'ms', timeUnit: 'milliseconds', points: [{ time: 1000, value: 8.25 }, { time: 2000, value: 7.5 }, { time: 3000, value: 6.25 }], updatedAt: 3000 },
    nextText: '最新值：6.25 ms',
    choices: { theme: 'plain', surface: 'semantic', live: 'native', layout: 'auto' },
    requiredText: ['8.25', '7.5', '1000 milliseconds', '2000 milliseconds', '最新值：7.5 ms'],
    requiredSelector: '[data-live-series] table', forbiddenSelectors: ['.iexp-historical-chart', '.react-flow'],
    forbiddenOptions: { live: ['liveline'], chart: ['visx'] },
  },
  {
    id: 'known-initial-load', title: '已知加载阶段及其原始状态',
    prompt: '显示已知指标面板的初次加载；不要编造指标或已有结果。',
    value: { loading: true, surface: 'metric', visibleContent: false, label: '正在读取合成探针数据' },
    choices: { theme: 'empryo', surface: 'semantic', loading: 'native', layout: 'auto' },
    requiredText: ['正在加载内容', '正在读取合成探针数据'], requiredSelector: '[role="status"]',
    forbiddenSelectors: ['svg[role="img"]', '[data-live-series]', '.iexp-board'],
    forbiddenOptions: { chart: ['openui', 'visx'], layout: ['flow', 'board'], loading: ['skullet'] },
  },
]
