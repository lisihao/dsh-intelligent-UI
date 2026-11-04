import { createElement as h, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { modelCenterViewCss } from './model-center-style.js'
import type { CenterAccount, CenterModel, CenterMoney, CenterQuota, CenterSourceState, CenterUsage, ModelCenterViewActions, ModelCenterViewState } from './model-center-view-model.js'

type Tab = 'accounts' | 'models' | 'usage'

export interface ModelCenterViewProps {
  state: ModelCenterViewState
  actions: ModelCenterViewActions
}

const tabs: readonly { key: Tab, label: string }[] = [
  { key: 'accounts', label: '账号与连接' },
  { key: 'models', label: '模型与能力' },
  { key: 'usage', label: '用量与费用' },
]

const sourceLabels = {
  api: 'API',
  subscription: '订阅',
  web: '网页',
  other: '其他来源',
} as const

const knownInputs: Record<string, string> = {
  text: '文本', image: '图片', audio: '音频', video: '视频', file: '文件',
}

const knownReasoning: Record<string, string> = {
  none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最大', '支持思考': '支持思考',
}

function finite(value: number | undefined): value is number { return typeof value === 'number' && Number.isFinite(value) }
function positive(value: number | undefined): value is number { return finite(value) && value > 0 }
function clamp(value: number): number { return Math.min(100, Math.max(0, value)) }
function sourceLabel(source: CenterAccount['source'] | CenterModel['source']): string { return sourceLabels[source] }
function readableList(values: readonly string[] | undefined, dictionary: Record<string, string>, unavailable: string): string {
  if (!values?.length) return unavailable
  const mapped = values.map(value => dictionary[value.toLowerCase()] ?? '由来源提供').filter((value, index, all) => all.indexOf(value) === index)
  return mapped.length ? mapped.join('、') : unavailable
}
function displayLimit(value: number | undefined): string { return positive(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '未声明' }
function displayStatus(account: CenterAccount): string {
  const raw = account.status.trim()
  if (raw) return raw
  if (account.configured === true) return '已配置'
  if (account.configured === false) return '未配置'
  return '状态未提供'
}
function displayField(label: string, value: string): string {
  return value.trim() || '未提供'
}
function formatNumber(value: number): string { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) }
function moneyText(money: CenterMoney | undefined): string {
  if (!money || !finite(money.value) || !money.currency.trim()) return '未提供'
  return formatNumber(money.value) + ' ' + money.currency.trim()
}
function dateText(value: number | undefined): string | undefined {
  if (!finite(value)) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
function inputDraft(value: number | undefined): string { return positive(value) ? String(value) : '' }
function publicError(error: unknown, fallback: string): string { return error instanceof Error && error.message.trim() ? error.message.trim() : fallback }
function acceptedModel(value: unknown, key: string): value is CenterModel { return typeof value === 'object' && value !== null && (value as { key?: unknown }).key === key }

function SourceNotices({ state, sources, onRefresh }: { state: ModelCenterViewState, sources: readonly { label: string, state: CenterSourceState }[], onRefresh: () => void }): ReactElement | null {
  const notices: ReactElement[] = []
  if (state.error) notices.push(h('div', { key: 'root-error', className: 'iec-notice', role: 'alert' }, h('p', null, state.error), h('button', { type: 'button', className: 'iec-link-button', onClick: onRefresh }, '重新读取')))
  if (state.busy) notices.push(h('div', { key: 'busy', className: 'iec-notice', role: 'status' }, h('p', null, '正在刷新模型中心信息…')))
  for (const source of sources) {
    if (source.state.status === 'ready') continue
    const base = source.state.status === 'loading'
      ? source.label + '正在读取…'
      : source.state.status === 'unavailable'
        ? source.label + '当前未提供。'
        : source.label + '暂时无法读取。'
    const message = source.state.status === 'error' && source.state.error?.trim() ? base + ' ' + source.state.error.trim() : base
    notices.push(h('div', { key: source.label, className: 'iec-notice', role: source.state.status === 'error' ? 'alert' : 'status' },
      h('p', null, message),
      source.state.status !== 'loading' && h('button', { type: 'button', className: 'iec-link-button', onClick: onRefresh, disabled: state.busy, 'aria-label': '重新读取' + source.label }, '重新读取')))
  }
  return notices.length ? h('div', { className: 'iec-notices' }, notices) : null
}

function EmptyState({ message, action }: { message: string, action?: ReactElement }): ReactElement {
  return h('div', { className: 'iec-empty', role: 'status' }, h('p', null, message), action)
}

function AccountsPanel({ state, actions, selected, onSelect, hidden }: { state: ModelCenterViewState, actions: ModelCenterViewActions, selected: CenterAccount | undefined, onSelect: (key: string) => void, hidden: boolean }): ReactElement {
  const loading = state.busy || state.sources.web.status === 'loading' || state.sources.subscriptions.status === 'loading'
  return h('section', { className: 'iec-panel', id: 'iexp-model-center-accounts-panel', role: 'tabpanel', 'aria-labelledby': 'iexp-model-center-accounts-tab', hidden },
    h('div', { className: 'iec-panel-heading' },
      h('div', null, h('h3', null, '已接入的账号'), h('p', null, '按 API、订阅和网页通道分别查看与管理。')),
      h('button', { type: 'button', className: 'iec-primary', onClick: () => actions.openOriginal('models') }, '添加连接')),
    h(SourceNotices, { state, sources: [{ label: '网页通道', state: state.sources.web }, { label: '订阅信息', state: state.sources.subscriptions }], onRefresh: actions.refresh }),
    state.accounts.length === 0
      ? h(EmptyState, { message: loading ? '正在读取账号与连接…' : '尚未读取到账号连接。', action: h('button', { type: 'button', className: 'iec-secondary', onClick: () => actions.openOriginal('account') }, '打开原始账号设置') })
      : h('div', { className: 'iec-account-layout' },
        h('div', { className: 'iec-account-list', role: 'group', 'aria-label': '账号连接列表' }, state.accounts.map(account => h('div', { key: account.key }, h('button', {
          type: 'button',
          className: 'iec-account-row',
          'aria-pressed': selected?.key === account.key,
          onClick: () => onSelect(account.key),
        }, h('span', { className: 'iec-account-row-title' }, account.label), h('span', { className: 'iec-source-tag' }, sourceLabel(account.source)), h('span', { className: 'iec-account-status' }, displayStatus(account))))),
        h(AccountDetail, { account: selected, actions }))))
}

function AccountDetail({ account, actions }: { account: CenterAccount | undefined, actions: ModelCenterViewActions }): ReactElement {
  if (!account) return h(EmptyState, { message: '选择一个账号连接以查看详情。' })
  const fields = account.fields
  return h('section', { className: 'iec-account-detail', 'aria-label': '所选账号详情' },
    h('div', { className: 'iec-section-heading' },
      h('div', null, h('h3', null, account.accountLabel?.trim() || account.label), h('p', { className: 'iec-detail-copy' }, sourceLabel(account.source) + ' 连接')),
      h('div', { className: 'iec-detail-actions' }, h('button', { type: 'button', className: 'iec-secondary', onClick: () => actions.openOriginal(account.originalSection || 'accounts') }, '管理高级设置'))),
    fields.length
      ? h('dl', { className: 'iec-account-fields' }, fields.map((field, index) => h('div', { key: field.label + '-' + index }, h('dt', null, field.label), h('dd', null, displayField(field.label, field.value)))))
      : h('p', { className: 'iec-detail-copy' }, '此连接未提供可展示的详情。'))
}

function ModelsPanel({ state, actions, selected, onSelect, hidden }: { state: ModelCenterViewState, actions: ModelCenterViewActions, selected: CenterModel | undefined, onSelect: (key: string) => void, hidden: boolean }): ReactElement {
  const [query, setQuery] = useState('')
  const showSearch = state.models.length > 6
  const models = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return state.models
    return state.models.filter(model => [model.name, model.providerLabel, model.accountLabel, sourceLabel(model.source)].filter((value): value is string => !!value).some(value => value.toLocaleLowerCase().includes(needle)))
  }, [query, state.models])
  const loading = state.busy || state.sources.models.status === 'loading'
  return h('section', { className: 'iec-panel', id: 'iexp-model-center-models-panel', role: 'tabpanel', 'aria-labelledby': 'iexp-model-center-models-tab', hidden },
    h('div', { className: 'iec-panel-heading' }, h('div', null, h('h3', null, '可用模型'), h('p', null, '相同名称的模型按来源和账号范围区分。'))),
    h(SourceNotices, { state, sources: [{ label: '模型目录', state: state.sources.models }], onRefresh: actions.refresh }),
    showSearch && h('label', { className: 'iec-model-search' }, h('span', { className: 'iec-form-help' }, '搜索模型'), h('input', { type: 'search', value: query, onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value), placeholder: '按模型、提供方或账号搜索', 'aria-label': '搜索模型' })),
    state.models.length === 0
      ? h(EmptyState, { message: loading ? '正在读取模型目录…' : '当前没有可展示的模型。', action: h('button', { type: 'button', className: 'iec-secondary', onClick: () => actions.openOriginal('models') }, '打开原始模型设置') })
      : models.length === 0
        ? h(EmptyState, { message: '没有匹配的模型。' })
        : h('div', { className: 'iec-table-wrap', tabIndex: 0, 'aria-label': '可用模型列表' },
          h('table', { className: 'iec-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, '模型'), h('th', { scope: 'col' }, '来源与账号'), h('th', { scope: 'col' }, '输入与推理'), h('th', { scope: 'col' }, '维护方式'))),
            h('tbody', null, models.map(model => h('tr', { key: model.key },
              h('td', null, h('button', { type: 'button', className: 'iec-model-select', 'aria-pressed': selected?.key === model.key, onClick: () => onSelect(model.key) }, h('span', { className: 'iec-model-title' }, model.name), h('span', { className: 'iec-subline' }, model.providerLabel))),
              h('td', null, h('span', { className: 'iec-source-tag' }, sourceLabel(model.source)), h('span', { className: 'iec-subline' }, model.accountLabel?.trim() || model.providerLabel)),
              h('td', { className: 'iec-abilities' }, readableList(model.input, knownInputs, '输入未声明'), model.reasoningEfforts?.length ? '；推理：' + readableList(model.reasoningEfforts, knownReasoning, '由来源提供') : ''),
              h('td', null, model.editable && actions.saveDefinition ? '可在此编辑' : '由原始设置维护')))))),
    h(ModelDefinition, { model: selected, actions }))
}

function ModelDefinition({ model, actions }: { model: CenterModel | undefined, actions: ModelCenterViewActions }): ReactElement {
  if (!model) return h('section', { className: 'iec-definition', 'aria-label': '模型定义' }, h(EmptyState, { message: '选择一个模型以查看定义。' }))
  const editable = !!model.editable && !!actions.saveDefinition
  return h('section', { className: 'iec-definition', 'aria-label': '模型定义' },
    h('div', { className: 'iec-definition-heading' }, h('div', null, h('h3', null, model.name), h('p', { className: 'iec-detail-copy' }, editable ? '可编辑的模型定义' : '模型定义')),
      !editable && h('button', { type: 'button', className: 'iec-secondary', onClick: () => actions.openOriginal('models') }, '打开原始模型设置')),
    h('dl', { className: 'iec-definition-grid' },
      h('div', null, h('dt', null, '上下文窗口'), h('dd', { className: 'iec-num' }, displayLimit(model.contextWindow))),
      h('div', null, h('dt', null, '最大输出'), h('dd', { className: 'iec-num' }, displayLimit(model.maxTokens))),
      h('div', null, h('dt', null, '推理等级'), h('dd', null, readableList(model.reasoningEfforts, knownReasoning, '由来源提供'))),
      h('div', null, h('dt', null, '输入类型'), h('dd', null, readableList(model.input, knownInputs, '未声明')))),
    editable && h(ModelDefinitionForm, { key: model.key, model, saveDefinition: actions.saveDefinition! }))
}

function ModelDefinitionForm({ model, saveDefinition }: { model: CenterModel, saveDefinition: NonNullable<ModelCenterViewActions['saveDefinition']> }): ReactElement {
  // A save must fence against the exact definition that the user opened, even if a refresh supplies a newer revision meanwhile.
  const [snapshot, setSnapshot] = useState(() => model)
  const [contextWindow, setContextWindow] = useState(() => inputDraft(snapshot.contextWindow))
  const [maxTokens, setMaxTokens] = useState(() => inputDraft(snapshot.maxTokens))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const drafts = [{ label: '上下文窗口', value: contextWindow }, { label: '最大输出', value: maxTokens }]
    const patch: { contextWindow?: number, maxTokens?: number } = {}
    for (const draft of drafts) {
      const raw = draft.value.trim()
      if (!raw) continue
      const value = Number(raw)
      if (!Number.isSafeInteger(value) || value <= 0) { setNotice(''); setError(draft.label + '必须是大于 0 的安全整数。'); return }
      if (draft.label === '上下文窗口') patch.contextWindow = value
      else patch.maxTokens = value
    }
    if (patch.contextWindow === undefined && patch.maxTokens === undefined) { setNotice(''); setError('请至少填写一项模型定义。'); return }
    setError(''); setNotice(''); setSaving(true)
    void saveDefinition(snapshot, patch).then(accepted => { if (acceptedModel(accepted, snapshot.key)) setSnapshot(accepted); setNotice('模型定义已提交保存。') }, error => { setError(publicError(error, '模型定义未保存。')) }).finally(() => setSaving(false))
  }
  return h('form', { className: 'iec-definition-form', onSubmit: submit },
    h('div', { className: 'iec-form-grid' },
      h('label', { className: 'iec-form-field' }, '上下文窗口', h('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric', value: contextWindow, onChange: (event: { currentTarget: HTMLInputElement }) => setContextWindow(event.currentTarget.value), 'aria-label': '上下文窗口' })),
      h('label', { className: 'iec-form-field' }, '最大输出', h('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric', value: maxTokens, onChange: (event: { currentTarget: HTMLInputElement }) => setMaxTokens(event.currentTarget.value), 'aria-label': '最大输出' }))),
    h('div', { className: 'iec-form-actions' }, h('span', { className: 'iec-form-help' }, '留空的字段不会修改。'), h('button', { type: 'submit', className: 'iec-primary', disabled: saving }, saving ? '正在保存…' : '保存定义')),
    error && h('p', { className: 'iec-form-error', role: 'alert' }, error),
    notice && h('p', { className: 'iec-save-status', role: 'status' }, notice))
}

function quotaState(quota: CenterQuota): { label: string, percent?: number, state: 'zero' | 'value' | 'unavailable' } {
  if (quota.error) return { label: '额度暂不可用', state: 'unavailable' }
  if (finite(quota.remainingPercent)) return { label: '剩余 ' + formatNumber(quota.remainingPercent) + '%', percent: clamp(quota.remainingPercent), state: quota.remainingPercent === 0 ? 'zero' : 'value' }
  if (finite(quota.usedPercent)) return { label: '已用 ' + formatNumber(quota.usedPercent) + '%', percent: clamp(quota.usedPercent), state: quota.usedPercent === 0 ? 'zero' : 'value' }
  return { label: '额度未提供', state: 'unavailable' }
}

function MoneyItems({ items, emptyMessage }: { items: readonly { key?: string, label: string, money: CenterMoney, updatedAt?: number }[], emptyMessage: string }): ReactElement {
  if (!items.length) return h('p', { className: 'iec-value-note' }, emptyMessage)
  return h('div', { className: 'iec-money-grid' }, items.map((item, index) => {
    const value = moneyText(item.money)
    const updated = dateText(item.updatedAt)
    return h('article', { key: item.key ?? item.label + '-' + index, className: 'iec-money-item' },
      h('span', { className: 'iec-money-title' }, item.label || '未命名来源'),
      h('strong', { className: 'iec-money-value', 'data-value-state': value === '未提供' ? 'unavailable' : item.money.value === 0 ? 'zero' : 'value' }, value),
      h('span', { className: 'iec-value-note' }, item.money.meaning?.trim() || '来源未说明金额口径'),
      updated && h('span', { className: 'iec-value-note' }, '更新时间：' + updated))
  }))
}

function BudgetEditor({ budget, saveBudget }: { budget: CenterUsage['budget'] | undefined, saveBudget: NonNullable<ModelCenterViewActions['saveBudget']> }): ReactElement {
  const [limit, setLimit] = useState(() => finite(budget?.limit) ? String(budget.limit) : '')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setLimit(finite(budget?.limit) ? String(budget.limit) : ''); setError(''); setNotice(''); setSaving(false) }, [budget?.limit])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = Number(limit.trim())
    if (!limit.trim() || !Number.isFinite(value) || value < 0) { setNotice(''); setError('预算上限必须是不小于 0 的有限数字。'); return }
    setError(''); setNotice(''); setSaving(true)
    void saveBudget({ limit: value }).then(() => { setNotice('预算已提交保存。') }, error => { setError(publicError(error, '预算未保存。')) }).finally(() => setSaving(false))
  }
  return h('form', { className: 'iec-definition-form', onSubmit: submit },
    h('label', { className: 'iec-form-field' }, '预算上限', h('input', { type: 'number', min: '0', step: 'any', inputMode: 'decimal', value: limit, onChange: (event: { currentTarget: HTMLInputElement }) => setLimit(event.currentTarget.value), 'aria-label': '预算上限' })),
    h('div', { className: 'iec-form-actions' }, h('span', { className: 'iec-form-help' }, '保存时使用现有预算货币与周期。'), h('button', { type: 'submit', className: 'iec-primary', disabled: saving }, saving ? '正在保存…' : '保存预算')),
    error && h('p', { className: 'iec-form-error', role: 'alert' }, error),
    notice && h('p', { className: 'iec-save-status', role: 'status' }, notice))
}

function UsagePanel({ state, actions, hidden }: { state: ModelCenterViewState, actions: ModelCenterViewActions, hidden: boolean }): ReactElement {
  const usage = state.usage
  const loading = state.busy || state.sources.cost.status === 'loading' || state.sources.subscriptions.status === 'loading'
  const budget = usage?.budget
  const budgetEnabled = budget?.enabled !== false
  const budgetUsed = budget && finite(budget.used) ? budget.used : undefined
  const budgetProgress = budget && budgetEnabled && positive(budget.limit) && budgetUsed !== undefined ? (budgetUsed / budget.limit) * 100 : undefined
  return h('section', { className: 'iec-panel', id: 'iexp-model-center-usage-panel', role: 'tabpanel', 'aria-labelledby': 'iexp-model-center-usage-tab', hidden },
    h('div', { className: 'iec-panel-heading' },
      h('div', null, h('h3', null, '用量与费用'), h('p', null, '估算费用、账户余额和订阅额度分别呈现。')),
      h('button', { type: 'button', className: 'iec-secondary', onClick: () => actions.openOriginal('cost-meter') }, '打开原始用量设置')),
    h(SourceNotices, { state, sources: [{ label: '费用台账', state: state.sources.cost }, { label: '订阅额度', state: state.sources.subscriptions }], onRefresh: actions.refresh }),
    usage?.warning && h('div', { className: 'iec-notices' }, h('div', { className: 'iec-notice', role: 'status' }, h('p', null, usage.warning))),
    !usage
      ? h(EmptyState, { message: loading ? '正在读取用量与费用…' : '用量与费用尚未提供；未提供不代表 0。' })
      : h('div', { className: 'iec-usage-stack' },
        h('section', { className: 'iec-usage-section', 'aria-label': 'API 估算费用' }, h('div', { className: 'iec-usage-heading' }, h('h3', null, 'API 估算费用'), h('span', { className: 'iec-value-note' }, '不同货币不合并计算')), h(MoneyItems, { items: usage.today.map((money, index) => ({ key: money.currency + '-' + index, label: money.meaning?.trim() || '估算费用', money })), emptyMessage: '暂无估算费用记录；未提供不代表 0。' })),
        h('section', { className: 'iec-usage-section', 'aria-label': '账户余额' }, h('div', { className: 'iec-usage-heading' }, h('h3', null, '账户余额'), h('span', { className: 'iec-value-note' }, '仅显示来源返回的余额')), h(MoneyItems, { items: usage.balances, emptyMessage: '账户余额未提供；这不表示余额为 0。' })),
        h('section', { className: 'iec-usage-section', 'aria-label': '订阅额度' },
          h('div', { className: 'iec-usage-heading' }, h('h3', null, '订阅额度'), h('span', { className: 'iec-value-note' }, '按各自额度窗口计算')),
          usage.quotas.length
            ? h('div', { className: 'iec-quota-list' }, usage.quotas.map(quota => {
              const summary = quotaState(quota), reset = dateText(quota.resetAt)
              return h('div', { key: quota.key, className: 'iec-quota-row' },
                h('div', null, h('div', { className: 'iec-quota-title' }, quota.label || '未命名订阅'), h('div', { className: 'iec-quota-meta' }, quota.window?.trim() || '窗口未说明')),
                h('div', null, summary.percent !== undefined && h('div', { className: 'iec-meter', 'aria-label': quota.label + summary.label }, h('span', { style: { width: summary.percent + '%' } })), h('div', { className: 'iec-quota-value', 'data-value-state': summary.state }, summary.label)),
                h('div', { className: 'iec-quota-meta' }, reset ? '重置：' + reset : '重置时间未提供'))
            }))
            : h('p', { className: 'iec-value-note' }, '订阅额度未提供；这不表示额度为 0。')),
        (budget || actions.saveBudget) && h('section', { className: 'iec-usage-section', 'aria-label': '预算' },
          h('div', { className: 'iec-usage-heading' }, h('h3', null, '预算'), h('span', { className: 'iec-value-note' }, budget?.period?.trim() || '周期未说明')),
          h('div', { className: 'iec-budget-card' },
            h('div', null, h('div', { className: 'iec-budget-value', 'data-value-state': budget ? 'value' : 'unavailable' }, budget ? (budgetEnabled ? (budgetUsed === undefined ? '已用未提供 / ' : moneyText({ value: budgetUsed, currency: budget.currency, meaning: '' }) + ' / ') + moneyText({ value: budget.limit, currency: budget.currency, meaning: '' }) : '预算未启用') : '预算未设置'), h('div', { className: 'iec-budget-note' }, !budget ? '预算上限未设置。' : !budgetEnabled ? '已配置上限：' + moneyText({ value: budget.limit, currency: budget.currency, meaning: '' }) : budgetProgress === undefined ? '预算进度未提供。' : '已用 ' + formatNumber(budgetProgress) + '%')),
            budgetEnabled && budgetProgress !== undefined && h('div', { className: 'iec-meter', 'aria-label': '预算已用 ' + formatNumber(budgetProgress) + '%' }, h('span', { style: { width: clamp(budgetProgress) + '%' } })),
            budget && actions.saveBudget && h(BudgetEditor, { budget, saveBudget: actions.saveBudget })))))
}

export function ModelCenterView({ state, actions }: ModelCenterViewProps): ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('accounts')
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | undefined>(() => state.accounts[0]?.key)
  const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(() => state.models[0]?.key)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  useEffect(() => { setSelectedAccountKey(current => current && state.accounts.some(account => account.key === current) ? current : state.accounts[0]?.key) }, [state.accounts])
  useEffect(() => { setSelectedModelKey(current => current && state.models.some(model => model.key === current) ? current : state.models[0]?.key) }, [state.models])
  const selectedAccount = state.accounts.find(account => account.key === selectedAccountKey) ?? state.accounts[0]
  const selectedModel = state.models.find(model => model.key === selectedModelKey) ?? state.models[0]
  const selectTab = (tab: Tab) => { setActiveTab(tab); tabRefs.current[tab]?.focus() }
  const tabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const index = Math.max(0, tabs.findIndex(tab => tab.key === current))
    let next: Tab | undefined
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]!.key
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]!.key
    if (event.key === 'Home') next = tabs[0]!.key
    if (event.key === 'End') next = tabs[tabs.length - 1]!.key
    if (next) { event.preventDefault(); selectTab(next) }
  }
  return h('section', { className: 'dsh-experience iexp-model-center', 'aria-labelledby': 'iexp-model-center-title' },
    h('style', { 'data-iexp-model-center-style': 'true' }, modelCenterViewCss),
    h('div', { className: 'iec-shell' },
      h('header', { className: 'iec-titlebar' }, h('div', null, h('h2', { id: 'iexp-model-center-title' }, '模型中心'), h('p', null, '账号、可用模型和用量信息集中查看。')), h('button', { type: 'button', className: 'iec-refresh', onClick: actions.refresh, disabled: state.busy }, state.busy ? '正在刷新…' : '刷新')),
      h('div', { className: 'iec-tabs', role: 'tablist', 'aria-label': '模型中心页面' }, tabs.map(tab => h('button', { key: tab.key, ref: (element: HTMLButtonElement | null): void => { tabRefs.current[tab.key] = element }, type: 'button', id: 'iexp-model-center-' + tab.key + '-tab', className: 'iec-tab', role: 'tab', 'aria-selected': activeTab === tab.key, 'aria-controls': 'iexp-model-center-' + tab.key + '-panel', tabIndex: activeTab === tab.key ? 0 : -1, onClick: () => selectTab(tab.key), onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => tabKeyDown(event, tab.key) }, tab.label))),
      h(AccountsPanel, { state, actions, selected: selectedAccount, onSelect: setSelectedAccountKey, hidden: activeTab !== 'accounts' }),
      h(ModelsPanel, { state, actions, selected: selectedModel, onSelect: setSelectedModelKey, hidden: activeTab !== 'models' }),
      h(UsagePanel, { state, actions, hidden: activeTab !== 'usage' })))
}
