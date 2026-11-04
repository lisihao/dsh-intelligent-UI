import { describe, expect, it, vi } from 'vitest'
import {
  ModelCenterCostError,
  normalizeCostSnapshot,
  readModelCenterCost,
  type ModelCenterCostRemoteResult,
} from '../src/model-center-cost.js'

function day(cost: number, apiCost: number) {
  return {
    date: '2026-11-04', input: 100, output: 20, cacheRead: 5, cacheWrite: 0, reasoning: 0,
    calls: 2, cost, apiCost, costCny: cost * 7.2, apiCostCny: apiCost * 7.2,
    sessions: [], byProviderModel: {},
  }
}

function fixture() {
  return {
    today: day(12.5, 4.25), month: day(30, 10), total: day(99, 50), budgetUsed: 11.75,
    balance: {
      status: 'ok', message: 'provider returned no secret', fetchedAt: 1730726400000,
      currency: 'USD', totalBalance: 100, grantedBalance: 20, toppedUpBalance: 80,
    },
    goQuota: {
      status: 'ok', message: 'go token secret must not escape', fetchedAt: 1730726400000,
      rolling: { percent: 25, resetsAt: '2026-11-04T12:00:00Z' },
      weekly: null,
      monthly: { percent: 100, resetsAt: '2026-11-30T00:00:00Z' },
    },
    codingPlans: {
      anthropic: {
        enabled: true, display: 'settings', refreshMinutes: 15, apiKey: 'ANTHROPIC_SECRET',
        status: 'ok', message: 'provider token ANTHROPIC_SECRET', fetchedAt: 1730726400000,
        windows: {
          five_hour: { percent: 40, resetsAt: '2026-11-04T12:00:00Z' },
          weekly: { resetsAt: '' },
          unlimited: { unlimited: true, resetsAt: '2026-12-01T00:00:00Z' },
        },
      },
    },
    config: {
      locale: 'en', currency: 'USD', symbol: '$', exchangeRate: 7.2,
      prices: { models: { secretModel: { output: 1 } }, default: { output: 1 } },
      customBalance: { request: { headers: { Authorization: 'Bearer HEADER_SECRET' } } },
      budget: { enabled: true, amount: 120, period: 'month', customStart: null, customEnd: null, detail: true },
    },
    history: [{ date: '2026-11-03', cost: 100, secretHistoryField: 'DO_NOT_COPY' }],
  }
}

describe('model-center cost projection', () => {
  it('separates API estimate, Plan equivalent, and combined equivalent', () => {
    const output = normalizeCostSnapshot(fixture())
    expect(output.today.apiEstimate).toEqual({ amount: 4.25, currency: 'USD', meaning: 'api-estimate' })
    expect(output.today.planEquivalent).toEqual({ amount: 8.25, currency: 'USD', meaning: 'plan-equivalent' })
    expect(output.today.totalEquivalent).toEqual({ amount: 12.5, currency: 'USD', meaning: 'combined-equivalent' })
    expect(output.month.planEquivalent.amount).toBe(20)
    expect(output.total.apiEstimate.amount).toBe(50)
  })

  it('keeps account balance separate and preserves source currency', () => {
    const output = normalizeCostSnapshot(fixture())
    expect(output.balance).toEqual({ status: 'ok', currency: 'USD', total: 100, granted: 20, toppedUp: 80, fetchedAt: 1730726400000 })
    expect(output.balance.currency).not.toBe(output.today.apiEstimate.meaning)
  })

  it('projects quota windows with used/remaining/reset semantics without inventing unknown values', () => {
    const output = normalizeCostSnapshot(fixture())
    expect(output.goQuota.windows).toEqual({
      rolling: { used: 25, remaining: 75, resetsAt: '2026-11-04T12:00:00Z', unit: 'percent' },
      monthly: { used: 100, remaining: 0, resetsAt: '2026-11-30T00:00:00Z', unit: 'percent' },
    })
    expect(output.codingPlans.anthropic?.windows.five_hour).toEqual({ used: 40, remaining: 60, resetsAt: '2026-11-04T12:00:00Z', unit: 'percent' })
    expect(output.codingPlans.anthropic?.windows.weekly).toEqual({})
    expect(output.codingPlans.anthropic?.windows.unlimited).toEqual({ unlimited: true, resetsAt: '2026-12-01T00:00:00Z' })
    expect(output.goQuota.windows.weekly).toBeUndefined()
  })

  it('preserves a reported over-quota percentage and a negative balance', () => {
    const source = fixture()
    source.goQuota.rolling.percent = 125
    source.balance.totalBalance = -3
    const output = normalizeCostSnapshot(source)
    expect(output.goQuota.windows.rolling).toMatchObject({ used: 125, remaining: -25, unit: 'percent' })
    expect(output.balance.total).toBe(-3)
  })

  it('uses the published old-snapshot fallback when apiCost is absent', () => {
    const source = fixture()
    delete (source.today as Record<string, unknown>).apiCost
    const output = normalizeCostSnapshot(source)
    expect(output.today.apiEstimate.amount).toBe(12.5)
    expect(output.today.planEquivalent.amount).toBe(0)
  })

  it('keeps only safe budget fields and drops history, price catalog, headers, and credentials', () => {
    const output = normalizeCostSnapshot(fixture())
    expect(output.budget).toEqual({ enabled: true, amount: 120, period: 'month', currency: 'USD', used: 11.75, customStart: null, customEnd: null })
    const encoded = JSON.stringify(output)
    expect(encoded).not.toContain('ANTHROPIC_SECRET')
    expect(encoded).not.toContain('HEADER_SECRET')
    expect(encoded).not.toContain('DO_NOT_COPY')
    expect(output).not.toHaveProperty('history')
    expect(output).not.toHaveProperty('config')
    expect(output).not.toHaveProperty('priceCatalog')
  })

  it('does not mutate a frozen source object', () => {
    const source = fixture()
    const before = structuredClone(source)
    Object.freeze(source)
    expect(normalizeCostSnapshot(source)).toBeTruthy()
    expect(source).toEqual(before)
  })

  it('reads only getLocalState and unwraps the typed remote result', async () => {
    const getLocalState = vi.fn(async (): Promise<ModelCenterCostRemoteResult> => ({ ok: true, value: fixture() }))
    const getState = vi.fn()
    const refreshCodingPlan = vi.fn()
    const output = await readModelCenterCost({ getLocalState, getState, refreshCodingPlan } as never)
    expect(getLocalState).toHaveBeenCalledTimes(1)
    expect(getState).not.toHaveBeenCalled()
    expect(refreshCodingPlan).not.toHaveBeenCalled()
    expect(output.today.totalEquivalent.amount).toBe(12.5)
  })

  it('reports named errors at malformed source and remote boundaries without echoing raw data', async () => {
    expect(() => normalizeCostSnapshot({ secret: 'DO_NOT_ECHO' })).toThrowError(/MODEL_CENTER_COST_SNAPSHOT_INVALID|MODEL_CENTER_COST_SOURCE_INVALID/)
    expect(() => normalizeCostSnapshot({ ...fixture(), today: { ...day(12.5, 4.25), cost: '12.5', secret: 'DO_NOT_ECHO' } })).toThrowError(/MODEL_CENTER_COST_SNAPSHOT_INVALID/)
    try { await readModelCenterCost({ getLocalState: async () => ({ ok: false, error: { message: 'Bearer DO_NOT_ECHO' } }) }) } catch (error) {
      expect(error).toBeInstanceOf(ModelCenterCostError)
      expect((error as Error).message).toBe('MODEL_CENTER_COST_REMOTE_FAILED: getLocalState returned a failure')
      expect((error as Error).message).not.toContain('DO_NOT_ECHO')
    }
  })
})
