/**
 * A deliberately small, read-only projection of dsh-cost-meter's CostState.
 *
 * The installed service exposes a much larger state tree. This module keeps the
 * model-center contract independent from that tree: ledger amounts are copied
 * into explicit API/Plan meanings, quota readings stay absent when the source
 * does not know them, and configuration/history/credentials are never returned.
 */

export type ModelCenterMoneyCurrency = 'USD' | 'CNY' | 'EUR'
export type ModelCenterCostMeaning = 'api-estimate' | 'plan-equivalent' | 'combined-equivalent'
export type ModelCenterCostPeriod = 'day' | 'month' | 'all' | 'custom'
export type ModelCenterQuotaStatus = 'off' | 'ok' | 'error'

export interface ModelCenterEstimatedMoney {
  /** Amount in `currency`; dsh-cost-meter amounts are estimates, not invoices. */
  amount: number
  currency: ModelCenterMoneyCurrency
  meaning: ModelCenterCostMeaning
}

export interface ModelCenterPeriodCost {
  /** Estimated charge for pay-as-you-go/API usage. */
  apiEstimate: ModelCenterEstimatedMoney
  /** API-equivalent value of subscription usage; it is not an extra charge. */
  planEquivalent: ModelCenterEstimatedMoney
  /** `apiEstimate + planEquivalent`, still an estimate. */
  totalEquivalent: ModelCenterEstimatedMoney
}

export interface ModelCenterBalance {
  /** Account balance is intentionally separate from the ledger amounts above. */
  status: ModelCenterQuotaStatus
  currency?: string
  total?: number
  granted?: number
  toppedUp?: number
  fetchedAt?: number
}

export interface ModelCenterQuotaWindow {
  /** Percentage reported as used. Present only when the source reports it. */
  used?: number
  /** Percentage remaining, derived only from a reported `used` percentage (may be negative when over quota). */
  remaining?: number
  /** Source-provided reset time; absent when the source does not provide one. */
  resetsAt?: string
  /** A source-declared unlimited window has no fabricated percentage. */
  unlimited?: true
  /** Present when `used`/`remaining` are present; both values are percentages and are not clamped. */
  unit?: 'percent'
}

export interface ModelCenterQuota {
  status: ModelCenterQuotaStatus
  windows: Record<string, ModelCenterQuotaWindow>
  fetchedAt?: number
}

export interface ModelCenterBudget {
  enabled: boolean
  amount: number
  period: ModelCenterCostPeriod
  currency: string
  used?: number
  customStart?: string | null
  customEnd?: string | null
}

export interface ModelCenterCostSnapshot {
  today: ModelCenterPeriodCost
  month: ModelCenterPeriodCost
  total: ModelCenterPeriodCost
  /** Kept separate from `today`, `month`, and `total`; currencies are not combined. */
  balance: ModelCenterBalance
  goQuota: ModelCenterQuota
  codingPlans: Record<string, ModelCenterQuota>
  budget: ModelCenterBudget
}

export type ModelCenterCostErrorCode =
  | 'MODEL_CENTER_COST_SOURCE_INVALID'
  | 'MODEL_CENTER_COST_SNAPSHOT_INVALID'
  | 'MODEL_CENTER_COST_WIRE_INVALID'
  | 'MODEL_CENTER_COST_REMOTE_FAILED'

/** Named errors keep source failures diagnosable without echoing raw payloads. */
export class ModelCenterCostError extends Error {
  readonly code: ModelCenterCostErrorCode

  constructor(code: ModelCenterCostErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ModelCenterCostError'
    this.code = code
  }
}

/** The only remote capability used by the default reader. It must be read-only. */
export interface ModelCenterCostWire {
  getLocalState: () => Promise<ModelCenterCostRemoteResult | Record<string, unknown>> | ModelCenterCostRemoteResult | Record<string, unknown>
}

export type ModelCenterCostRemoteResult =
  | { ok: true, value: unknown }
  | { ok: false, error?: unknown }

type SourceRecord = Record<string, unknown>
const QUOTA_STATUSES: readonly ModelCenterQuotaStatus[] = ['off', 'ok', 'error']
const COST_PERIODS: readonly ModelCenterCostPeriod[] = ['day', 'month', 'all', 'custom']
const hasOwn = (value: SourceRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

function fail(code: ModelCenterCostErrorCode, message: string): never {
  throw new ModelCenterCostError(code, message)
}

function sourceRecord(value: unknown, path: string): SourceRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MODEL_CENTER_COST_SOURCE_INVALID', `${path} must be an object`)
  }
  return value as SourceRecord
}

function snapshotRecord(value: unknown, path: string): SourceRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} must be an object`)
  }
  return value as SourceRecord
}

function finiteNumber(value: unknown, path: string, { nonNegative = false } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || nonNegative && value < 0) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} must be a finite${nonNegative ? ' non-negative' : ''} number`)
  }
  return value
}

function optionalFiniteNumber(value: unknown, path: string, { nonNegative = false } = {}): number | undefined {
  if (value === undefined) return undefined
  return finiteNumber(value, path, { nonNegative })
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} must be a boolean`)
  return value
}

function optionalString(value: unknown, path: string, { allowNull = false } = {}): string | null | undefined {
  if (value === undefined) return undefined
  if (allowNull && value === null) return null
  if (typeof value !== 'string') {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} must be a string`)
  }
  return value
}

function requiredCurrency(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} must be a non-empty currency name`)
  }
  return value
}

function quotaStatus(value: unknown, path: string): ModelCenterQuotaStatus {
  if (typeof value !== 'string' || !QUOTA_STATUSES.includes(value as ModelCenterQuotaStatus)) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} has an unsupported status`)
  }
  return value as ModelCenterQuotaStatus
}

function optionalFetchedAt(value: unknown, path: string): number | undefined {
  const result = optionalFiniteNumber(value, path)
  return result !== undefined && result !== 0 ? result : undefined
}

function moneySource(row: SourceRecord, path: string, displayCurrency: string): { currency: ModelCenterMoneyCurrency, total: number, api: number } {
  const totalUsd = finiteNumber(row.cost, `${path}.cost`)
  const rawApi = hasOwn(row, 'apiCost') ? row.apiCost : undefined
  const apiUsd = rawApi === undefined
    ? totalUsd
    : finiteNumber(rawApi, `${path}.apiCost`)

  if (displayCurrency !== 'CNY' && displayCurrency !== 'EUR') return { currency: 'USD', total: totalUsd, api: apiUsd }
  const suffix = displayCurrency === 'CNY' ? 'Cny' : 'Eur'
  const frozenTotal = optionalFiniteNumber(row[`cost${suffix}`], `${path}.cost${suffix}`)
  const frozenApi = rawApi === undefined
    ? frozenTotal
    : optionalFiniteNumber(row[`apiCost${suffix}`], `${path}.apiCost${suffix}`)
  // Historical frozen amounts are the only safe conversion. If an older valid
  // state omitted them, retain the canonical USD amount instead of applying a
  // current exchange rate to a historical record.
  if (frozenTotal !== undefined && frozenApi !== undefined) {
    return { currency: displayCurrency as ModelCenterMoneyCurrency, total: frozenTotal, api: frozenApi }
  }
  return { currency: 'USD', total: totalUsd, api: apiUsd }
}

function estimated(amount: number, currency: ModelCenterMoneyCurrency, meaning: ModelCenterCostMeaning): ModelCenterEstimatedMoney {
  return { amount, currency, meaning }
}

function periodCost(value: unknown, path: string, displayCurrency: string): ModelCenterPeriodCost {
  const row = snapshotRecord(value, path)
  const source = moneySource(row, path, displayCurrency)
  const plan = source.total - source.api
  return {
    apiEstimate: estimated(source.api, source.currency, 'api-estimate'),
    planEquivalent: estimated(plan, source.currency, 'plan-equivalent'),
    totalEquivalent: estimated(source.total, source.currency, 'combined-equivalent'),
  }
}

function normalizeWindow(value: unknown, path: string, nullable = false): ModelCenterQuotaWindow | undefined {
  if ((value === null || value === undefined) && nullable) return undefined
  const source = snapshotRecord(value, path)
  const rawPercent = source.percent
  const percent = rawPercent === undefined
    ? undefined
    : finiteNumber(rawPercent, `${path}.percent`)
  const reset = optionalString(source.resetsAt, `${path}.resetsAt`)
  const unlimited = source.unlimited === undefined ? undefined : requiredBoolean(source.unlimited, `${path}.unlimited`)
  if (unlimited === true && percent !== undefined) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', `${path} cannot be both unlimited and percentage-based`)
  }
  const result: ModelCenterQuotaWindow = {}
  if (percent !== undefined) {
    result.used = percent
    result.remaining = 100 - percent
    result.unit = 'percent'
  }
  if (typeof reset === 'string' && reset.length > 0) result.resetsAt = reset
  if (unlimited === true) result.unlimited = true
  return result
}

function normalizeWindows(value: unknown, path: string): Record<string, ModelCenterQuotaWindow> {
  if (value === undefined) return {}
  const source = snapshotRecord(value, path)
  return Object.fromEntries(Object.entries(source).map(([name, raw]) => {
    const normalized = normalizeWindow(raw, `${path}.${name}`)
    return [name, normalized ?? {}]
  }))
}

function normalizeQuota(value: unknown, path: string, fixedWindowNames?: readonly string[]): ModelCenterQuota {
  const source = snapshotRecord(value, path)
  const fetchedAt = optionalFetchedAt(source.fetchedAt, `${path}.fetchedAt`)
  const windows = fixedWindowNames === undefined
    ? normalizeWindows(source.windows, `${path}.windows`)
    : Object.fromEntries(fixedWindowNames.flatMap(name => {
      const normalized = normalizeWindow(source[name], `${path}.${name}`, true)
      return normalized === undefined ? [] : [[name, normalized] as const]
    }))
  return {
    status: quotaStatus(source.status, `${path}.status`),
    windows,
    ...(fetchedAt !== undefined ? { fetchedAt } : {}),
  }
}

function normalizeBalance(value: unknown): ModelCenterBalance {
  const source = snapshotRecord(value, 'balance')
  const status = quotaStatus(source.status, 'balance.status')
  const result: ModelCenterBalance = { status }
  const currency = optionalString(source.currency, 'balance.currency')
  if (typeof currency === 'string' && currency.length > 0) result.currency = currency
  const fetchedAt = optionalFetchedAt(source.fetchedAt, 'balance.fetchedAt')
  if (fetchedAt !== undefined) result.fetchedAt = fetchedAt
  // Off/error states are not treated as a zero balance. Amount fields are
  // exposed only for an explicitly successful balance response.
  if (status === 'ok') {
    if (typeof currency !== 'string' || currency.length === 0) fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', 'balance.currency is required when balance.status is ok')
    result.total = finiteNumber(source.totalBalance, 'balance.totalBalance')
    result.granted = finiteNumber(source.grantedBalance, 'balance.grantedBalance')
    result.toppedUp = finiteNumber(source.toppedUpBalance, 'balance.toppedUpBalance')
  }
  return result
}

function normalizeBudget(config: SourceRecord, budgetUsed: unknown, currency: string): ModelCenterBudget {
  const source = snapshotRecord(config.budget, 'config.budget')
  const period = source.period
  if (typeof period !== 'string' || !COST_PERIODS.includes(period as ModelCenterCostPeriod)) {
    fail('MODEL_CENTER_COST_SNAPSHOT_INVALID', 'config.budget.period is unsupported')
  }
  const result: ModelCenterBudget = {
    enabled: requiredBoolean(source.enabled, 'config.budget.enabled'),
    amount: finiteNumber(source.amount, 'config.budget.amount'),
    period: period as ModelCenterCostPeriod,
    currency: currency === 'custom' ? (typeof config.symbol === 'string' && config.symbol.trim() ? `自定义币种（${config.symbol.slice(0,16)}）` : '自定义币种') : currency,
  }
  const used = optionalFiniteNumber(budgetUsed, 'budgetUsed')
  // Owner getLocalState returns displayUsd; its UI multiplies by exchangeRate.
  // This keeps historical frozen display amounts and the configured budget unit aligned.
  const rate = optionalFiniteNumber(config.exchangeRate, 'config.exchangeRate')
  if (used !== undefined) result.used = used * (rate !== undefined && rate > 0 ? rate : 1)
  const customStart = optionalString(source.customStart, 'config.budget.customStart', { allowNull: true })
  const customEnd = optionalString(source.customEnd, 'config.budget.customEnd', { allowNull: true })
  if (customStart !== undefined) result.customStart = customStart
  if (customEnd !== undefined) result.customEnd = customEnd
  return result
}

/**
 * Project only the stable, non-sensitive CostState fields needed by model-center.
 * The input is never mutated and unknown fields are intentionally ignored.
 */
export function normalizeCostSnapshot(raw: unknown): ModelCenterCostSnapshot {
  const source = sourceRecord(raw, 'cost snapshot')
  const config = snapshotRecord(source.config, 'config')
  const currency = requiredCurrency(config.currency, 'config.currency')
  return {
    today: periodCost(source.today, 'today', currency),
    month: periodCost(source.month, 'month', currency),
    total: periodCost(source.total, 'total', currency),
    balance: normalizeBalance(source.balance),
    goQuota: normalizeQuota(source.goQuota, 'goQuota', ['rolling', 'weekly', 'monthly']),
    codingPlans: Object.fromEntries(Object.entries(snapshotRecord(source.codingPlans, 'codingPlans')).map(([id, plan]) => {
      return [id, normalizeQuota(plan, `codingPlans.${id}`)]
    })),
    budget: normalizeBudget(config, source.budgetUsed, currency),
  }
}

function isRemoteResult(value: unknown): value is ModelCenterCostRemoteResult {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as SourceRecord).ok === 'boolean'
}

/** Read the local ledger only. No network refresh, price fetch, write, or reset is performed. */
export async function readModelCenterCost(wire: ModelCenterCostWire): Promise<ModelCenterCostSnapshot> {
  if (wire === null || typeof wire !== 'object' || typeof wire.getLocalState !== 'function') {
    throw new ModelCenterCostError('MODEL_CENTER_COST_WIRE_INVALID', 'getLocalState is required')
  }
  let response: unknown
  try {
    response = await wire.getLocalState()
  } catch {
    throw new ModelCenterCostError('MODEL_CENTER_COST_REMOTE_FAILED', 'getLocalState failed')
  }
  if (isRemoteResult(response)) {
    if (!response.ok) throw new ModelCenterCostError('MODEL_CENTER_COST_REMOTE_FAILED', 'getLocalState returned a failure')
    response = response.value
  }
  return normalizeCostSnapshot(response)
}
