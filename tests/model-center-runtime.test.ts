import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForms, SchemaNode, SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  createModelCenterRuntime,
} from '../src/model-center.js'

type RuntimeInput = Parameters<typeof createModelCenterRuntime>[0]
type JsonRecord = Record<string, unknown>
type RemoteResult = { ok: true, value: unknown } | { ok: false, error?: unknown }

const ok = (value: unknown): RemoteResult => ({ ok: true, value })
const failed = (error: unknown = { message: 'fixture failure' }): RemoteResult => ({ ok: false, error })

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (current !== null && typeof current === 'object') {
      current = (current as JsonRecord)[segment]
    } else {
      return undefined
    }
  }
  return current
}

function hasPath(value: unknown, path: readonly string[]): boolean {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
      current = current[index]
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, segment)) {
      current = (current as JsonRecord)[segment]
    } else {
      return false
    }
  }
  return true
}

function schemaFixture(): Pick<SettingsSchemaService, 'getPath' | 'hasPath' | 'rehydrate' | 'nodeAtPath' | 'validate'> {
  const schemaRoot = { type: 'object', fields: ['models', 'models.0.id', 'models.0.contextWindow', 'models.0.maxTokens'] }
  const rehydrate = vi.fn((_serialized: unknown) => schemaRoot as unknown as SchemaNode)
  const nodeAtPath = vi.fn((_root: SchemaNode, path: readonly string[]) => {
    const key = path.join('.')
    return schemaRoot.fields.includes(key) ? schemaRoot as unknown as SchemaNode : undefined
  })
  const validate = vi.fn((_schema: SchemaNode, _value: unknown) => undefined)
  return { getPath, hasPath, rehydrate, nodeAtPath, validate }
}

function namespace(user: JsonRecord): SettingsNamespaceView {
  return {
    autoGenerate: true,
    ns: 'llm-deepseek',
    schema: {
      uid: 1,
      type: 'object',
      meta: { default: {} },
      dict: { models: 2, apiKeyEnv: 3 },
      refs: {
        '2': { type: 'array', meta: { default: [] }, inner: 4 },
        '3': { type: 'string', meta: {} },
        '4': { type: 'object', meta: { default: {} }, dict: { id: 5, contextWindow: 6, maxTokens: 6 } },
        '5': { type: 'string', meta: { required: true } },
        '6': { type: 'number', meta: { min: 1 } },
      },
    },
    value: {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      models: [{ id: 'deepseek-chat', contextWindow: 65536, maxTokens: 8192 }],
    },
    user: user as SettingsNamespaceView['user'],
    base: { models: [] },
    applies: 'live',
    secrets: [],
    revision: 7,
  }
}

function rawCostState(budget: { enabled: boolean, amount: number, period: 'month', currency: 'USD' }) {
  const period = (cost: number, apiCost: number) => ({ cost, apiCost })
  return {
    today: period(12, 4),
    month: period(30, 10),
    total: period(90, 45),
    balance: { status: 'off' },
    goQuota: { status: 'off', rolling: null, weekly: null, monthly: null },
    codingPlans: {},
    config: { currency: 'USD', budget },
    budgetUsed: 3,
  }
}

function applySet(root: JsonRecord, op: Extract<SettingsPathOpView, { op: 'set' }>) {
  let current: unknown = root
  for (const segment of op.path.slice(0, -1)) {
    current = Array.isArray(current)
      ? current[Number(segment)]
      : (current as JsonRecord)[segment]
  }
  const field = op.path.at(-1)
  if (field === undefined || current === null || typeof current !== 'object') throw Error('invalid fixture path')
  ;(current as JsonRecord)[field] = op.value
}

function runtimeFixture(options: {
  directoryFailure?: boolean
  descriptionFailure?: boolean
  credentialFailure?: boolean
  budgetFailure?: boolean
} = {}) {
  const user = {
    models: [{ id: 'deepseek-chat', contextWindow: 32768, maxTokens: 4096 }],
    providerLabel: 'retain-this-setting',
  }
  const view = namespace(user)
  const schema = schemaFixture()
  const ensure = vi.fn(async () => {
    if (options.descriptionFailure) throw Error('DESCRIPTION_SECRET_DO_NOT_ECHO')
  })
  const getSnapshot = vi.fn(() => ({
    status: 'ready' as const,
    view: { namespaces: [view], writable: true, hasDocument: true },
    error: null,
  }))
  const describeFace = { ensure, getSnapshot }
  const describe = vi.fn(() => describeFace)
  const mutate = vi.fn(async (ops: readonly SettingsPathOpView[], expectedRevision?: number) => {
    if (expectedRevision !== view.revision) return false
    for (const op of ops) {
      if (op.op !== 'set') throw Error('unexpected unset in runtime fixture')
      applySet(user, op)
    }
    return true
  })
  const form = { mutate }
  const getForm = vi.fn((_namespace: string) => form)
  const forms = { describe, get: getForm } as unknown as ConfigForms

  const ownerBudget = { enabled: true, amount: 120, period: 'month' as const, currency: 'USD' as const }
  const getLocalState = vi.fn(async () => ok(rawCostState(ownerBudget)))
  const updateConfig = vi.fn(async (patch: unknown) => {
    if (options.budgetFailure) throw Error('OWNER_SECRET_DO_NOT_ECHO')
    const budgetPatch = (patch as { budget?: Record<string, unknown> }).budget
    if (!budgetPatch || Object.keys(budgetPatch).join(',') !== 'amount') return failed({ message: 'unexpected budget replacement' })
    ownerBudget.amount = budgetPatch.amount as number
    return ok({})
  })

  const listProviders = vi.fn(async () => ok([{ id: 'deepseek', name: 'DeepSeek' }]))
  const listConfigurableProviders = vi.fn(async () => options.directoryFailure
    ? failed({ message: 'configuration directory unavailable' })
    : ok([{ provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }]))
  const modelCatalog = vi.fn(async () => ok({
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
    failures: [],
  }))
  const credentialDescribe = vi.fn(async (refs: string[]) => {
    expect(refs).toEqual(['DEEPSEEK_API_KEY'])
    if (options.credentialFailure) throw Error('CREDENTIAL_SECRET_DO_NOT_ECHO')
    return ok({
      DEEPSEEK_API_KEY: {
        configured: true,
        writable: false,
        source: 'keychain',
        value: 'DO_NOT_ECHO_SECRET_VALUE',
      },
    })
  })
  const remote = {
    llm: { listProviders, listConfigurableProviders },
    session: { modelCatalog },
    credentials: { describe: credentialDescribe },
    costMeter: { getLocalState, updateConfig },
  }
  const rpcCall = vi.fn(async () => failed({ message: 'subscription source unavailable' }))
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) }))
  const runtime = createModelCenterRuntime({
    remote,
    forms,
    schema,
    connection: { rpc: { call: rpcCall } },
    fetcher,
  } as unknown as RuntimeInput)
  return {
    runtime,
    view,
    user,
    ensure,
    describe,
    getForm,
    mutate,
    modelCatalog,
    credentialDescribe,
    listConfigurableProviders,
    updateConfig,
    ownerBudget,
    getLocalState,
    rpcCall,
    fetcher,
  }
}

describe('model center runtime composition', () => {
  it('composes the published catalog with ConfigForms and credential metadata without exposing secret values', async () => {
    const fixture = runtimeFixture()

    await fixture.runtime.store.refresh()
    const snapshot = fixture.runtime.store.snapshot()
    const model = snapshot.models[0]
    const account = snapshot.accounts[0]

    expect(fixture.modelCatalog).toHaveBeenCalledTimes(1)
    expect(fixture.ensure).toHaveBeenCalledTimes(1)
    expect(fixture.credentialDescribe).toHaveBeenCalledWith(['DEEPSEEK_API_KEY'])
    expect(model).toMatchObject({
      id: 'deepseek-chat',
      provider: 'deepseek',
      source: 'api',
      contextWindow: 65536,
      maxTokens: 8192,
      editable: true,
      definitionAddress: { namespace: 'llm-deepseek', modelPath: ['models', '0'], revision: 7 },
    })
    expect(account).toMatchObject({ provider: 'deepseek', configured: true, status: '凭据已配置' })
    expect(JSON.stringify(snapshot)).not.toContain('DO_NOT_ECHO_SECRET_VALUE')
  })

  it('saves only model fields through the ConfigForm revision fence and preserves other user config', async () => {
    const fixture = runtimeFixture()
    await fixture.runtime.store.refresh()
    const model = fixture.runtime.store.snapshot().models[0]
    if (!model) throw Error('model fixture missing')
    const before = structuredClone(fixture.user)

    const saved = await fixture.runtime.saveDefinition(model, { contextWindow: 131072, maxTokens: 16384 })

    expect(fixture.getForm).toHaveBeenCalledWith('llm-deepseek')
    expect(fixture.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['models', '0', 'contextWindow'], value: 131072 },
      { op: 'set', path: ['models', '0', 'maxTokens'], value: 16384 },
    ], 7)
    expect(fixture.user).toEqual({
      ...before,
      models: [{ id: 'deepseek-chat', contextWindow: 131072, maxTokens: 16384 }],
      providerLabel: 'retain-this-setting',
    })
    expect(saved?.key).toBe(model.key)
  })

  it('updates budget amount only and keeps the owner enabled state and period', async () => {
    const fixture = runtimeFixture()

    await fixture.runtime.saveBudget({ limit: 42 })

    expect(fixture.updateConfig).toHaveBeenCalledTimes(1)
    expect(fixture.updateConfig).toHaveBeenCalledWith({ budget: { amount: 42 } })
    expect(fixture.ownerBudget).toEqual({ enabled: true, amount: 42, period: 'month', currency: 'USD' })
    expect(fixture.runtime.store.snapshot().usage?.budget).toMatchObject({ enabled: true, limit: 42, period: '本月' })
  })

  it('retains model, account, and cost information when the configuration directory is incomplete', async () => {
    const fixture = runtimeFixture({ directoryFailure: true })

    await fixture.runtime.store.refresh()
    const snapshot = fixture.runtime.store.snapshot()

    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.models[0]?.id).toBe('deepseek-chat')
    expect(snapshot.usage?.today[0]).toMatchObject({ value: 4, currency: 'USD' })
    expect(snapshot.sources.models).toEqual({ status: 'error', error: '模型配置目录未完整读取，已显示可用模型。' })
    expect(fixture.listConfigurableProviders).toHaveBeenCalledTimes(1)
    expect(fixture.getLocalState).toHaveBeenCalledTimes(1)
  })

  it('retains the host catalog when ConfigForms description fails', async () => {
    const fixture = runtimeFixture({ descriptionFailure: true })

    await fixture.runtime.store.refresh()
    const snapshot = fixture.runtime.store.snapshot()

    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.models[0]).toMatchObject({ id: 'deepseek-chat', provider: 'deepseek', source: 'api' })
    expect(snapshot.accounts[0]).toMatchObject({ provider: 'deepseek', status: '通道已注册，账号状态未核实' })
    expect(snapshot.sources.models.status).toBe('error')
    expect(JSON.stringify(snapshot)).not.toContain('DESCRIPTION_SECRET_DO_NOT_ECHO')
  })

  it('turns credential and owner exceptions into safe metadata warnings and controlled budget errors', async () => {
    const fixture = runtimeFixture({ credentialFailure: true, budgetFailure: true })

    await fixture.runtime.store.refresh()
    const snapshot = fixture.runtime.store.snapshot()

    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.accounts[0]).toMatchObject({ provider: 'deepseek', status: '通道已注册，账号状态未核实' })
    expect(snapshot.sources.models).toEqual({ status: 'error', error: '部分凭据配置状态不可读，未将其显示为已连接。' })
    expect(JSON.stringify(snapshot)).not.toContain('CREDENTIAL_SECRET_DO_NOT_ECHO')

    const budgetError = await fixture.runtime.saveBudget({ limit: 42 }).catch(error => error)
    expect(budgetError).toBeInstanceOf(Error)
    expect((budgetError as Error).message).toBe('预算保存未被费用插件接受，请在原始费用设置中检查。')
    expect((budgetError as Error).message).not.toContain('OWNER_SECRET_DO_NOT_ECHO')
  })
})
