import { createElement as h, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { compositionCancelResultSchema, compositionReceiptResultSchema, compositionResultSchema, type CompositionCancelInput, type CompositionReceiptInput, type ComposeInput } from '../src/adaptive-ui/contracts.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ExperienceSettings } from '../src/contracts.js'
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
  schema?: { revision: number; questionIds: string[] }
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

const scenarios = [
  { id: 'board-soft', label: '相同任务源：柔和浮雕看板', documentId: 'synthetic-task-board-soft', value: taskSource },
  { id: 'table-mechanical', label: '相同任务源：机械描边原表', documentId: 'synthetic-task-table-mechanical', value: taskSource },
  { id: 'history-visx', label: '相同历史源：visx 历史图', documentId: 'synthetic-history-visx', value: historicalSource },
  { id: 'history-openui', label: '相同历史源：OpenUI 图', documentId: 'synthetic-history-openui', value: historicalSource },
  { id: 'live-static', label: '明确实时序列：静态精确快照', documentId: 'synthetic-live-static', value: liveSource },
  { id: 'scope-plain', label: '全局 ASCII 下的局部 Plain 样式范围', documentId: 'synthetic-scope-plain', value: scopeSource },
] as const

type Scenario = typeof scenarios[number]

function initialSettings(): ExperienceSettings {
  return {
    formatVersion: 1,
    revision: 0,
    takeover: true,
    openui: true,
    mcpApps: false,
    adaptive: { enabled: true, styleMode: 'automatic' },
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
  return Number.isSafeInteger(revision) && revision > 0 && questionIds.length > 0 ? { revision, questionIds } : undefined
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
      const { value } = await postJson('/api/compositionReceipt', input)
      const result = compositionReceiptResultSchema.parse(value)
      publishPreviewEvent({ type: 'receipt', documentId: input.documentId, operationId: result.operationId, status: result.status, observed: true })
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
    adaptive: { enabled: current.adaptive?.enabled !== true, styleMode: 'automatic' },
  }))

  return h('main', {
    className: 'dsh-experience',
    'data-adaptive-preview': 'synthetic',
    'data-paid-model-calls': '0',
    'data-preview-adaptive-enabled': String(adaptiveEnabled),
    style: { minWidth: 0, maxWidth: 1280, margin: '0 auto', padding: 16 },
  },
  h('header', { style: { display: 'grid', gap: 12, marginBottom: 16 } },
    h('h1', null, '自适应界面：合成浏览器验收'),
    h('p', { 'data-preview-notice': true }, '固定本地样例；模拟公开 Jev 选择接口；零真实模型、付费调用、凭据或真实会话。'),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' } },
      h('label', null, '合成场景 ', h('select', { 'aria-label': '合成场景', value: scenario.id, onChange: (event: { currentTarget: HTMLSelectElement }) => setScenarioId(event.currentTarget.value as Scenario['id']) },
        ...scenarios.map(item => h('option', { key: item.id, value: item.id }, item.label)))),
      h('label', null, '共享主题 ', h('select', { 'aria-label': '共享主题', value: activeTheme, onChange: (event: { currentTarget: HTMLSelectElement }) => updateActiveTheme(event.currentTarget.value) },
        h('option', { value: 'empryo' }, 'Empryo（本地回退）'),
        h('option', { value: 'ascii' }, 'Classic ASCII（外层范围探针）'),
        h('option', { value: softRelief.id }, softRelief.name),
        h('option', { value: mechanicalOutline.id }, mechanicalOutline.name))),
      h('button', { type: 'button', 'data-adaptive-toggle': true, 'aria-pressed': adaptiveEnabled, onClick: toggleAdaptive }, adaptiveEnabled ? '停用智能编排' : '启用智能编排'),
      h(DisplayModeControl, { sessionId })),
    h('p', null, '稳定文档 ID：', h('code', { 'data-preview-document-id': true }, scenario.documentId))),
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
