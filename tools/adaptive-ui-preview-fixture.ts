import { createElement as h, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { compositionCancelResultSchema, compositionReceiptResultSchema, compositionResultSchema, type CompositionCancelInput, type CompositionReceiptInput, type ComposeInput } from '../src/adaptive-ui/contracts.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import { saveSettingsSchema, settingsSchema, type ExperienceSettings } from '../src/contracts.js'
import { ExperienceStore, Settings, installBlockLayoutShortcut } from '../src/client.js'
import { OutputView, ContentView, DisplayModeControl } from '../src/presentation.js'
import { installExperienceStyles } from '../src/style.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { themePackageSchema } from '../src/theme-contracts.js'
import softReliefSource from '../src/themes/uiverse-soft-relief.dsh-theme.json' with { type: 'json' }
import mechanicalOutlineSource from '../src/themes/uiverse-mechanical-outline.dsh-theme.json' with { type: 'json' }

type PreviewEvent = {
  type: 'composition' | 'receipt' | 'cancel'
  documentId: string
  operationId?: string
  status?: string
  observed?: boolean
  decisionCalls?: number
  schema?: { revision: number; questionIds: string[]; optionIds?: Record<string, string[]> }
  selection?: Record<string, unknown>
}

declare global {
  interface Window { __adaptiveUiPreviewEvents?: PreviewEvent[] }
}

const sessionId = 'synthetic-adaptive-browser-session'
const softRelief = themePackageSchema.parse(softReliefSource)
const mechanicalOutline = themePackageSchema.parse(mechanicalOutlineSource)

const taskSource = `# 合成任务验收

以下是固定本地样例，不含真实会话、账号或模型输出。

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| 核对来源 | queued | 保留原始任务与说明。 |
| 渲染布局 | running | 只使用已验证的候选项。 |
| 确认回执 | done | 挂载后才记录观察结果。 |`

const historicalSource = `# 合成历史趋势

| 日期 | 延迟（ms） |
| --- | ---: |
| 2026-11-01 | 8.2 |
| 2026-11-02 | 7.6 |
| 2026-11-03 | 9.1 |
| 2026-11-04 | 7.9 |`

const liveCapturedAt = Date.now()
const liveSource = {
  type: 'live-series' as const,
  source: 'synthetic:local-latency-snapshot',
  unit: 'ms',
  timeUnit: 'milliseconds' as const,
  points: [
    { time: liveCapturedAt - 120_000, value: 8.2 },
    { time: liveCapturedAt - 60_000, value: 7.6 },
    { time: liveCapturedAt, value: 7.9 },
  ],
  updatedAt: liveCapturedAt,
}

const scopeSource = '# 局部普通排版\n\n此段是局部 Plain 主题的合成内容，用于验证它不会继承外层 ASCII 的字距规则。'

// These three inputs are fixed local sources.  They exercise the ordinary
// ContentView path, not an inferred or remotely generated graph/report.
const strategyGraphSource = {
  nodes: [
    { id: 'scope', label: '明确边界', description: '确定本轮策略只覆盖可观察的来源、约束和停止条件。' },
    { id: 'evidence', label: '核对证据', description: '逐项检查来源记录、单位和限定条件，不补造关系。' },
    { id: 'decision', label: '选择方案', description: '仅在前两步保留完整时比较可执行方案。' },
  ],
  edges: [
    { source: 'scope', target: 'evidence', label: '限定检查范围' },
    { source: 'evidence', target: 'decision', label: '保留证据后比较' },
  ],
} as const

const comparisonRecordsSource = [
  {
    name: '方案 A：局部缓存',
    description: '在固定本地样例中保留最近一次完整响应，以降低重复读取造成的等待。该记录只描述比较条件，不代表线上命中率、成本或真实模型质量，也不将样例差异视为节约，更不替代对来源版本、失败条件和完整响应的逐条核对。',
    条件: '仅在请求体小于 64 KiB、未启用强制刷新且响应完整时比较；不能把本地回退与远端结果合并。',
    单位: 'ms / 次（P95）',
    观测窗口: '2026-11-01 至 2026-11-05（5 个合成采样点）',
  },
  {
    name: '方案 B：逐次读取',
    description: '在相同的固定本地样例中每次重新读取来源，以便保留更新可见性。该记录不估算生产吞吐量，也不把合成结果解释为用户真实工作负载，并且不把局部时延差异当作可推广的性能承诺或成本结论。',
    条件: '仅在同一来源版本、同一 64 KiB 上限且无网络请求时比较；不包含认证、模型调用或后台刷新。',
    单位: 'ms / 次（P95）',
    观测窗口: '2026-11-01 至 2026-11-05（5 个合成采样点）',
  },
] as const

const citedReportSource = `# 合成方案比较报告

本报告是固定本地样例，用于验证章节导航和引文原文保留；不构成真实研究结论。[资料 A](https://sources.example.invalid/a)

## 范围与问题

比较只覆盖两个明确的本地读取方案。单位为 ms / 次（P95），不把样例结果外推为生产时延。[资料 B](https://sources.example.invalid/b)

### 范围条件

请求体必须小于 64 KiB，且来源版本一致；缺失、重试和外部调用不纳入本节比较。

## 方法与材料

记录保留 2026-11-01 至 2026-11-05 的五个合成采样点。每个点的原始单位与条件保持不变。[资料 A](https://sources.example.invalid/a)

## 比较结果

本地缓存适合验证重复读取路径；逐次读取适合验证来源更新可见性。两者都不能证明真实模型、付费调用或线上业务效果。

## 限制与引文

本报告没有真实会话、账号、凭据或外部网络请求。任何部署、成本和质量判断都需要独立的真实证据。[资料 B](https://sources.example.invalid/b)

[^1]: 资料 A：固定本地来源记录，版本 synthetic-2026-11-05。
[^2]: 资料 B：合成验收约束；该引用不请求外部网络。`

const mixedBlockLayoutSource = `# 混合区块编排验收

这段普通说明必须保留在完整文档中，并保留[本地资料][mixed-source]与脚注[^mixed-note]。它不提供额外指标，也不改变相邻区块的来源边界。

## 历史数值

下面的表格是固定的历史数值序列，单位和日期来自原文。

| 日期 | 延迟（ms） |
| --- | ---: |
| 2026-11-01 | 8.2 |
| 2026-11-02 | 7.6 |
| 2026-11-03 | 9.1 |
| 2026-11-04 | 7.9 |

## 任务状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| 核对来源 | queued | 保留原始任务与说明。 |
| 渲染布局 | running | 只使用已验证的候选项。 |
| 确认回执 | done | 挂载后才记录观察结果。 |

## 来源流程

读取来源 → 核对证据 -> 记录结果

[mixed-source]: https://sources.example.invalid/mixed-source "固定本地来源"
[^mixed-note]: 固定本地脚注；该脚注不请求外部网络。`

const scenarios = [
  { id: 'board-soft', label: '相同任务源：柔和浮雕看板', documentId: 'synthetic-task-board-soft', value: taskSource },
  { id: 'table-mechanical', label: '相同任务源：机械描边原表', documentId: 'synthetic-task-table-mechanical', value: taskSource },
  { id: 'history-visx', label: '相同历史源：visx 历史图', documentId: 'synthetic-history-visx', value: historicalSource },
  { id: 'history-openui', label: '相同历史源：OpenUI 图', documentId: 'synthetic-history-openui', value: historicalSource },
  { id: 'live-static', label: '明确实时序列：静态精确快照', documentId: 'synthetic-live-static', value: liveSource },
  { id: 'scope-plain', label: '全局 ASCII 下的局部 Plain 样式范围', documentId: 'synthetic-scope-plain', value: scopeSource },
  { id: 'strategy-flow', label: '明确 nodes/edges：策略流程图', documentId: 'synthetic-strategy-flow', value: strategyGraphSource },
  { id: 'comparison-records', label: '方案比较记录：Clear glass 详情', documentId: 'synthetic-comparison-records', value: comparisonRecordsSource },
  { id: 'cited-report-index', label: '多节有引文报告：章节目录', documentId: 'synthetic-cited-report-index', value: citedReportSource },
  { id: 'mixed-block-layout', label: '混合区块：图表、看板与流程并存', documentId: 'synthetic-mixed-block-layout', value: mixedBlockLayoutSource, blockLayout: true },
] as const

type Scenario = typeof scenarios[number]

function initialSettings(): ExperienceSettings {
  return {
    formatVersion: 1,
    revision: 0,
    takeover: true,
    openui: true,
    mcpApps: false,
    adaptive: { enabled: true, styleMode: 'automatic', blockLayout: false, blockLayoutShortcut: 'Alt+Meta+KeyI' },
    theme: { activeId: 'empryo', installed: [] },
    appearance: { backgroundColor: '#24262b', translucent: true },
  }
}

let sharedSettings = initialSettings()
const settingsListeners = new Set<() => void>()
const appearanceSource = {
  snapshot: () => ({ settings: sharedSettings }),
  subscribe(listener: () => void) {
    settingsListeners.add(listener)
    return () => settingsListeners.delete(listener)
  },
}

let productionSettings = initialSettings()
const productionSettingsApi = {
  settings: async () => productionSettings,
  saveSettings: async (input: unknown) => {
    const parsed = saveSettingsSchema.parse(input)
    if (parsed.expectedRevision !== productionSettings.revision) throw new Error('SYNTHETIC_SETTINGS_REVISION_CONFLICT')
    productionSettings = settingsSchema.parse({
      ...productionSettings,
      takeover: parsed.takeover,
      openui: parsed.openui,
      mcpApps: parsed.mcpApps,
      ...(parsed.appearance === undefined ? {} : { appearance: parsed.appearance }),
      ...(parsed.themeId === undefined ? {} : { theme: { activeId: parsed.themeId, installed: productionSettings.theme?.installed ?? [] } }),
      ...(parsed.adaptive === undefined ? {} : { adaptive: parsed.adaptive }),
      ...(parsed.themeSource === undefined ? {} : { themeSource: parsed.themeSource }),
      revision: productionSettings.revision + 1,
    })
    productionStore.update({ api: productionSettingsApi as never, settings: productionSettings })
    return productionSettings
  },
  artifacts: async () => [],
  publish: async (input: unknown) => input,
}
const productionStore = new ExperienceStore()
productionStore.update({ api: productionSettingsApi as never, settings: productionSettings })

async function setProductionBlockLayout(enabled: boolean): Promise<void> {
  const current = productionStore.snapshot().settings
  if (!current || current.adaptive?.blockLayout === enabled) return
  await productionStore.save({
    expectedRevision: current.revision,
    takeover: current.takeover,
    openui: current.openui,
    mcpApps: current.mcpApps,
    adaptive: { ...(current.adaptive ?? { enabled: true, styleMode: 'automatic' }), blockLayout: enabled },
  } as never)
}

function publishSettings(next: ExperienceSettings): void {
  sharedSettings = next
  for (const listener of [...settingsListeners]) listener()
}

function publishPreviewEvent(event: PreviewEvent): void {
  window.__adaptiveUiPreviewEvents ??= []
  window.__adaptiveUiPreviewEvents.push(event)
  window.dispatchEvent(new CustomEvent('adaptive-preview-event', { detail: event }))
}

function responseSchema(response: Response): PreviewEvent['schema'] | undefined {
  const revision = Number(response.headers.get('x-adaptive-schema-revision'))
  const questionIds = response.headers.get('x-adaptive-schema-questions')?.split(',').filter(Boolean) ?? []
  const encodedOptions = response.headers.get('x-adaptive-schema-options')
  let optionIds: Record<string, string[]> | undefined
  if (encodedOptions) {
    try { optionIds = JSON.parse(encodedOptions) as Record<string, string[]> } catch { /* The synthetic schema remains usable without this optional evidence. */ }
  }
  return Number.isSafeInteger(revision) && revision > 0 && questionIds.length > 0 ? { revision, questionIds, optionIds } : undefined
}

async function postJson(path: string, input: unknown): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const value = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(typeof (value as { error?: unknown } | undefined)?.error === 'string' ? (value as { error: string }).error : `本地夹具请求失败：HTTP ${response.status}`)
  return { response, value }
}

function createCompositionApi(): CompositionApi {
  return {
    async composition(input: ComposeInput) {
      const { response, value } = await postJson('/api/composition', input)
      const result = compositionResultSchema.parse(value)
      publishPreviewEvent({
        type: 'composition',
        documentId: input.documentId,
        operationId: result.operationId,
        status: result.status,
        schema: responseSchema(response),
        selection: result.selection,
      })
      return result
    },
    async compositionReceipt(input: CompositionReceiptInput) {
      const { response, value } = await postJson('/api/compositionReceipt', input)
      const result = compositionReceiptResultSchema.parse(value)
      const decisionCalls = Number(response.headers.get('x-adaptive-decision-calls'))
      publishPreviewEvent({ type: 'receipt', documentId: input.documentId, operationId: result.operationId, status: result.status, decisionCalls: Number.isSafeInteger(decisionCalls) ? decisionCalls : undefined, observed: true })
      return result
    },
    async compositionCancel(input: CompositionCancelInput) {
      const { value } = await postJson('/api/compositionCancel', input)
      const result = compositionCancelResultSchema.parse(value)
      publishPreviewEvent({ type: 'cancel', documentId: input.documentId, status: result.reason })
      return result
    },
  }
}

installExperienceStyles()
installAppearanceStyles(appearanceSource)

function Preview(): ReturnType<typeof h> {
  const [scenarioId, setScenarioId] = useState<Scenario['id']>('board-soft')
  const [settings, setSettings] = useState<ExperienceSettings>(() => sharedSettings)
  const [eventRevision, setEventRevision] = useState(0)
  const scenario = scenarios.find(candidate => candidate.id === scenarioId) ?? scenarios[0]
  const api = useMemo(() => createCompositionApi(), [])
  const adaptiveEnabled = settings.adaptive?.enabled === true

  useEffect(() => { publishSettings(settings) }, [settings])
  useEffect(() => {
    const unsubscribe = productionStore.subscribe(() => {
      if (scenario.blockLayout !== true) return
      const next = productionStore.snapshot().settings
      if (next) setSettings(next)
    })
    return unsubscribe
  }, [scenario.blockLayout])
  useEffect(() => installBlockLayoutShortcut(productionStore, window), [])
  useEffect(() => { void setProductionBlockLayout(scenario.blockLayout === true) }, [scenario.blockLayout])
  useEffect(() => {
    const rerender = () => setEventRevision(value => value + 1)
    window.addEventListener('adaptive-preview-event', rerender)
    return () => window.removeEventListener('adaptive-preview-event', rerender)
  }, [])

  const previewEvents = (window.__adaptiveUiPreviewEvents ?? []).slice(-4)
  const activeTheme = settings.theme?.activeId ?? 'empryo'
  const updateActiveTheme = (activeId: string) => setSettings(current => ({
    ...current,
    revision: current.revision + 1,
    theme: { ...(current.theme ?? { installed: [] }), activeId, installed: current.theme?.installed ?? [] },
  }))
  const toggleAdaptive = () => setSettings(current => ({
    ...current,
    revision: current.revision + 1,
    adaptive: { ...(current.adaptive ?? { styleMode: 'automatic' }), enabled: current.adaptive?.enabled !== true },
  }))
  const updateScenario = (nextId: Scenario['id']) => {
    setScenarioId(nextId)
  }

  return h('main', {
    className: 'dsh-experience',
    'data-adaptive-preview': 'synthetic',
    'data-paid-model-calls': '0',
    'data-preview-adaptive-enabled': String(adaptiveEnabled),
    'data-preview-block-layout': String(settings.adaptive?.blockLayout === true),
    'data-preview-block-layout-shortcut': settings.adaptive?.blockLayoutShortcut ?? '',
    style: { minWidth: 0, maxWidth: 1280, margin: '0 auto', padding: 16 },
  },
  h('header', { style: { display: 'grid', gap: 12, marginBottom: 16 } },
    h('h1', null, '自适应界面：合成浏览器验收'),
    h('p', { 'data-preview-notice': true }, '固定本地样例；模拟公开 Jev 选择接口；零真实模型、付费调用、凭据或真实会话。'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } },
      h('label', null, '合成场景 ', h('select', { 'aria-label': '合成场景', value: scenario.id, onChange: (event: { currentTarget: HTMLSelectElement }) => updateScenario(event.currentTarget.value as Scenario['id']) },
        ...scenarios.map(item => h('option', { key: item.id, value: item.id }, item.label)))),
      h('label', null, '共享主题 ', h('select', { 'aria-label': '共享主题', value: activeTheme, onChange: (event: { currentTarget: HTMLSelectElement }) => updateActiveTheme(event.currentTarget.value) },
        h('option', { value: 'empryo' }, 'Empryo（本地回退）'),
        h('option', { value: 'ascii' }, 'Classic ASCII（外层范围探针）'),
        h('option', { value: softRelief.id }, softRelief.name),
        h('option', { value: mechanicalOutline.id }, mechanicalOutline.name))),
      h('button', { type: 'button', 'data-adaptive-toggle': true, 'aria-pressed': adaptiveEnabled, onClick: toggleAdaptive }, adaptiveEnabled ? '停用智能编排' : '启用智能编排'),
      h(DisplayModeControl, { sessionId })),
    h('p', null, '稳定文档 ID：', h('code', { 'data-preview-document-id': true }, scenario.documentId))),
  scenario.blockLayout === true && h('section', { 'data-block-layout-settings-panel': true, 'aria-label': '生产智能编排设置', style: { marginBottom: 16 } },
    h(Settings, { store: productionStore })),
  h('p', { 'data-global-ascii-probe': true }, '相邻外层段落：当共享主题为 Classic ASCII 时，保留全局 ASCII 字距规则。'),
  h('section', { id: 'preview-output', 'aria-label': '生产 ContentView 合成输出' },
    h(CompositionRuntimeContext.Provider, { value: { api, settings, sessionId } },
      h(OutputView, { sessionId, raw: scenario.value }, h(ContentView, { key: scenario.id, value: scenario.value, documentId: scenario.documentId, sessionId })))),
  h('section', { 'aria-label': '夹具验收记录', 'data-preview-evidence': true, style: { marginTop: 16 } },
    h('h2', null, '夹具验收记录'),
    h('p', null, `已记录 ${eventRevision ? previewEvents.length : 0} 条无原文事件。`),
    h('ul', null, ...previewEvents.map((event, index) => h('li', { key: `${event.type}-${event.operationId ?? event.documentId}-${index}` },
      `${event.type} · ${event.documentId} · ${event.status ?? '已发出'}`,
      event.schema ? ` · schema v${event.schema.revision}` : '',
      event.observed ? ' · observed=true' : '')))))
}

createRoot(document.getElementById('root')!).render(h(Preview))
