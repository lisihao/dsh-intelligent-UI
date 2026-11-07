export type ModelCenterSource = 'api' | 'subscription' | 'web' | 'other'
export interface CenterAccount {
  key: string
  label: string
  accountLabel?: string
  provider?: string
  active?: boolean
  source: ModelCenterSource
  status: string
  configured?: boolean
  fields: readonly { label: string, value: string }[]
  originalSection: string
}
export interface CenterModel {
  key: string
  id: string
  provider: string
  name: string
  providerLabel: string
  accountLabel?: string
  source: ModelCenterSource
  input?: readonly string[]
  contextWindow?: number
  maxTokens?: number
  reasoningEfforts?: readonly string[]
  editable?: boolean
  definitionAddress?: { namespace: string, modelPath: readonly string[], revision: number }
}
export interface CenterMoney { value: number, currency: string, meaning: string }
export interface CenterQuota { key: string, label: string, window?: string, usedPercent?: number, remainingPercent?: number, resetAt?: number, error?: string }
export interface CenterUsage {
  warning?: string
  today: readonly CenterMoney[]
  balances: readonly { key: string, label: string, money: CenterMoney, updatedAt?: number }[]
  quotas: readonly CenterQuota[]
  budget?: { enabled?: boolean, limit: number, currency: string, period: string, used?: number }
  asOf?: number
}
export interface CenterSourceState { status: 'loading' | 'ready' | 'error' | 'unavailable', error?: string }
export interface ModelCenterViewState {
  accounts: readonly CenterAccount[]
  models: readonly CenterModel[]
  usage?: CenterUsage
  sources: { models: CenterSourceState, web: CenterSourceState, cost: CenterSourceState, subscriptions: CenterSourceState }
  busy: boolean
  error?: string
}
export interface ModelCenterViewActions {
  refresh(): void
  openOriginal(section: string): void
  saveDefinition?(model: CenterModel, patch: { contextWindow?: number, maxTokens?: number }): Promise<CenterModel | void>
  saveBudget?(input: { limit: number }): Promise<void>
}
