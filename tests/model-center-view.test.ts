// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelCenterView } from '../src/model-center-view.js'
import type { ModelCenterViewActions, ModelCenterViewState } from '../src/model-center-view-model.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: { host: HTMLElement, root: Root }[] = []

function state(overrides: Partial<ModelCenterViewState> = {}): ModelCenterViewState {
  const account = {
    key: 'private-account-key',
    label: 'DeepSeek 官方 API',
    accountLabel: '个人账号',
    source: 'api' as const,
    status: 'API Key 已配置',
    configured: true,
    fields: [
      { label: '认证方式', value: 'API Key' },
      { label: '账号标识', value: 'person@example.test' },
    ],
    originalSection: 'account',
  }
  const model = {
    key: 'private-model-key',
    id: 'internal-model-id-not-for-ui',
    provider: 'internal-provider',
    name: 'DeepSeek V4.1 Flash',
    providerLabel: 'DeepSeek',
    accountLabel: '个人账号',
    source: 'api' as const,
    input: ['text'],
    contextWindow: 32768,
    maxTokens: 8192,
    reasoningEfforts: ['medium'],
    editable: false,
  }
  return {
    accounts: [account],
    models: [model],
    usage: {
      today: [], balances: [], quotas: [],
    },
    sources: {
      models: { status: 'ready' }, web: { status: 'ready' }, cost: { status: 'ready' }, subscriptions: { status: 'ready' },
    },
    busy: false,
    ...overrides,
  }
}

function actions(overrides: Partial<ModelCenterViewActions> = {}): ModelCenterViewActions {
  return { refresh: vi.fn(), openOriginal: vi.fn(), ...overrides }
}

async function mount(viewState: ModelCenterViewState, viewActions: ModelCenterViewActions): Promise<{ host: HTMLElement, root: Root }> {
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); roots.push({ host, root })
  await act(async () => root.render(h(ModelCenterView, { state: viewState, actions: viewActions })))
  return { host, root }
}

async function click(element: Element): Promise<void> {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

async function setValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })
}

afterEach(async () => {
  for (const { host, root } of roots.splice(0)) { await act(async () => root.unmount()); host.remove() }
})

describe('ModelCenterView', () => {
  it('renders supplied records once, preserves semantic connection text, and never renders internal keys or model ids', async () => {
    const viewState = state()
    Object.freeze(viewState.accounts); Object.freeze(viewState.models)
    const viewActions = actions(), { host, root } = await mount(viewState, viewActions)
    expect(host.querySelectorAll('.iec-account-row')).toHaveLength(1)
    expect(host.querySelector('.iec-account-layout > .iec-account-detail')).not.toBeNull()
    expect(host.querySelectorAll('.iec-table tbody tr')).toHaveLength(1)
    expect(host.textContent).toContain('API Key 已配置')
    expect(host.textContent).toContain('person@example.test')
    expect(host.textContent).not.toContain('private-account-key')
    expect(host.textContent).not.toContain('internal-model-id-not-for-ui')
    await act(async () => root.render(h(ModelCenterView, { state: viewState, actions: viewActions })))
    expect(host.querySelectorAll('.iec-account-row')).toHaveLength(1)
    expect(host.querySelectorAll('.iec-table tbody tr')).toHaveLength(1)
    expect(viewState.accounts).toHaveLength(1)
    expect(viewState.models).toHaveLength(1)
  })

  it('keeps active tab and local selections across a refresh-shaped rerender and supports roving tab keys', async () => {
    const first = state()
    const secondAccount = { ...first.accounts[0]!, key: 'second-account', label: '网页账号', accountLabel: '网页个人账号', source: 'web' as const, originalSection: 'deepseek-web-login' }
    const secondModel = { ...first.models[0]!, key: 'second-model', id: 'another-internal-id', name: 'DeepSeek 网页快速模式', source: 'web' as const, accountLabel: '网页个人账号' }
    const viewState = { ...first, accounts: [first.accounts[0]!, secondAccount], models: [first.models[0]!, secondModel] }
    const viewActions = actions(), { host, root } = await mount(viewState, viewActions)
    await click(host.querySelectorAll<HTMLButtonElement>('.iec-account-row')[1]!)
    expect(host.querySelector('[aria-label="所选账号详情"]')?.textContent).toContain('网页个人账号')
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!)
    await click(host.querySelectorAll<HTMLButtonElement>('.iec-model-select')[1]!)
    expect(host.querySelector('[aria-label="模型定义"]')?.textContent).toContain('DeepSeek 网页快速模式')
    const refreshed = { ...viewState, accounts: viewState.accounts.map(account => ({ ...account })), models: viewState.models.map(model => ({ ...model, contextWindow: (model.contextWindow ?? 0) + 1 })) }
    await act(async () => root.render(h(ModelCenterView, { state: refreshed, actions: viewActions })))
    expect(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[aria-label="模型定义"]')?.textContent).toContain('DeepSeek 网页快速模式')
    const modelsTab = host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!
    await act(async () => modelsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(host.querySelector<HTMLButtonElement>('#iexp-model-center-usage-tab')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(host.querySelector('#iexp-model-center-usage-tab'))
    await act(async () => host.querySelector<HTMLButtonElement>('#iexp-model-center-usage-tab')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(host.querySelector<HTMLButtonElement>('#iexp-model-center-accounts-tab')?.getAttribute('aria-selected')).toBe('true')
  })

  it('shows sanitized state and source failures with a retry, rather than dropping the state slot', async () => {
    const viewState = state({ error: '模型中心配置暂时不可用。', sources: { models: { status: 'error', error: '模型目录需要重新读取。' }, web: { status: 'ready' }, cost: { status: 'ready' }, subscriptions: { status: 'ready' } } })
    const viewActions = actions(), { host } = await mount(viewState, viewActions)
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!)
    expect(host.textContent).toContain('模型中心配置暂时不可用。')
    expect(host.textContent).toContain('模型目录需要重新读取。')
    await click(host.querySelector<HTMLButtonElement>('[aria-label="重新读取模型目录"]')!)
    expect(viewActions.refresh).toHaveBeenCalledOnce()
  })

  it('keeps zero separate from unavailable amounts, balances, and quota windows', async () => {
    const viewState = state({ usage: {
      today: [{ value: 0, currency: 'CNY', meaning: 'API 估算费用' }],
      balances: [{ key: 'balance-internal', label: 'API 账户余额', money: { value: 0, currency: 'CNY', meaning: '来源返回余额' } }],
      quotas: [{ key: 'quota-zero', label: '订阅窗口 A', window: '5 小时窗口', remainingPercent: 0 }, { key: 'quota-unavailable', label: '订阅窗口 B', window: '每周窗口' }],
      budget: { limit: 50, currency: 'CNY', period: '每日', used: 0 },
    } })
    const { host } = await mount(viewState, actions())
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-usage-tab')!)
    expect(host.textContent).toContain('0 CNY')
    expect(host.textContent).toContain('剩余 0%')
    expect(host.textContent).toContain('额度未提供')
    expect(host.querySelectorAll('[data-value-state="zero"]')).not.toHaveLength(0)
    const unavailable = Array.from(host.querySelectorAll<HTMLElement>('[data-value-state="unavailable"]')).map(element => element.textContent).join(' ')
    expect(unavailable).toContain('额度未提供')
    expect(unavailable).not.toContain('0')
  })

  it('validates model definition input, shows a public save conflict, and saves the opened model snapshot', async () => {
    const first = state()
    const editable = { ...first.models[0]!, editable: true }
    const saveDefinition = vi.fn(async () => { throw new Error('配置已被其他页面更改，请重新打开模型定义。') })
    const viewActions = actions({ saveDefinition })
    const { host, root } = await mount({ ...first, models: [editable] }, viewActions)
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!)
    const form = host.querySelector<HTMLFormElement>('.iec-definition-form')!
    const context = host.querySelector<HTMLInputElement>('input[aria-label="上下文窗口"]')!
    const maxTokens = host.querySelector<HTMLInputElement>('input[aria-label="最大输出"]')!
    await setValue(context, '1.5'); await submit(form)
    expect(saveDefinition).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('大于 0 的安全整数')
    await setValue(context, '8192'); await setValue(maxTokens, '2048')
    const refreshed = { ...first, models: [{ ...editable, contextWindow: 65536, maxTokens: 4096 }] }
    await act(async () => root.render(h(ModelCenterView, { state: refreshed, actions: viewActions })))
    expect(host.querySelector<HTMLInputElement>('input[aria-label="上下文窗口"]')?.value).toBe('8192')
    await submit(host.querySelector<HTMLFormElement>('.iec-definition-form')!)
    expect(saveDefinition).toHaveBeenCalledWith(editable, { contextWindow: 8192, maxTokens: 2048 })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('配置已被其他页面更改，请重新打开模型定义。')
  })

  it('advances the definition snapshot only after an accepted same-model save', async () => {
    const base = state()
    const editable = { ...base.models[0]!, editable: true }
    const accepted = { ...editable, contextWindow: 9000, maxTokens: 2048, definitionAddress: { namespace: 'owner', modelPath: ['models', 'flash'], revision: 2 } }
    const saveDefinition = vi.fn().mockResolvedValueOnce(accepted).mockResolvedValueOnce(undefined)
    const { host } = await mount({ ...base, models: [editable] }, actions({ saveDefinition }))
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!)
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="上下文窗口"]')!, '9000')
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="最大输出"]')!, '2048')
    await submit(host.querySelector<HTMLFormElement>('.iec-definition-form')!)
    expect(saveDefinition).toHaveBeenNthCalledWith(1, editable, { contextWindow: 9000, maxTokens: 2048 })
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="上下文窗口"]')!, '10000')
    await submit(host.querySelector<HTMLFormElement>('.iec-definition-form')!)
    expect(saveDefinition).toHaveBeenNthCalledWith(2, accepted, { contextWindow: 10000, maxTokens: 2048 })
  })

  it('distinguishes a configured but disabled budget, hides progress, and still permits amount edits', async () => {
    const base = state()
    const disabledUsage = { ...base.usage!, budget: { enabled: false, limit: 80, currency: 'CNY', period: '每周', used: 20 } }
    const saveBudget = vi.fn(async () => { throw new Error('预算配置已被其他页面更改，请重新打开预算。') })
    const { host } = await mount({ ...base, usage: disabledUsage }, actions({ saveBudget }))
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-usage-tab')!)
    expect(host.textContent).toContain('预算未启用')
    expect(host.textContent).toContain('已配置上限：80 CNY')
    expect(host.querySelector('.iec-budget-card .iec-meter')).toBeNull()
    await setValue(host.querySelector<HTMLInputElement>('input[aria-label="预算上限"]')!, '90')
    await submit(host.querySelector<HTMLFormElement>('.iec-budget-card form')!)
    expect(saveBudget).toHaveBeenCalledWith({ limit: 90 })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('预算配置已被其他页面更改，请重新打开预算。')
  })

  it('routes add, advanced, model fallback, usage settings, and refresh through the supplied root actions', async () => {
    const first = state()
    const readonly = { ...first.models[0]!, key: 'readonly-model', id: 'readonly-internal-id', name: '订阅模型', editable: false, source: 'subscription' as const }
    const viewActions = actions(), { host } = await mount({ ...first, models: [first.models[0]!, readonly] }, viewActions)
    await click(host.querySelector<HTMLButtonElement>('.iec-primary')!)
    await click(host.querySelector<HTMLButtonElement>('.iec-account-detail .iec-secondary')!)
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-models-tab')!)
    await click(host.querySelectorAll<HTMLButtonElement>('.iec-model-select')[1]!)
    await click(host.querySelector<HTMLButtonElement>('.iec-definition-heading .iec-secondary')!)
    await click(host.querySelector<HTMLButtonElement>('#iexp-model-center-usage-tab')!)
    await click(host.querySelector<HTMLButtonElement>('.iec-panel-heading .iec-secondary')!)
    await click(host.querySelector<HTMLButtonElement>('.iec-refresh')!)
    expect(viewActions.openOriginal).toHaveBeenNthCalledWith(1, 'models')
    expect(viewActions.openOriginal).toHaveBeenNthCalledWith(2, 'account')
    expect(viewActions.openOriginal).toHaveBeenNthCalledWith(3, 'models')
    expect(viewActions.openOriginal).toHaveBeenNthCalledWith(4, 'cost-meter')
    expect(viewActions.refresh).toHaveBeenCalledOnce()
  })
})
