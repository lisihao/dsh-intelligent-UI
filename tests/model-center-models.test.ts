import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SchemaNode, SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  findExistingModelDefinition,
  mutateExistingModelDefinition,
  readModelCenterModels,
  type ModelCenterModelsRemote,
} from '../src/model-center-models.js'

const ok = (value: unknown) => ({ ok: true as const, value })
const failed = (error: unknown = { message: 'fixture failure' }) => ({ ok: false as const, error })
type PublishedRemoteResult = { ok: true, value: unknown } | { ok: false, error?: unknown }

function catalogFixture(overrides: Record<string, unknown> = {}) {
  return {
    groups: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        models: [
          {
            id: 'shared-model',
            name: 'Shared model',
            contextWindow: 'unknown',
            maxInput: 999999,
          },
        ],
      },
      {
        id: 'openai-codex',
        name: 'Codex',
        models: [{ id: 'shared-model', name: 'Codex shared model' }],
      },
    ],
    failures: [],
    ...overrides,
  }
}

function publishedRpc(catalog = catalogFixture()) {
  const listProviders = vi.fn(async (): Promise<PublishedRemoteResult> => ok([
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai-codex', name: 'Codex' },
  ]))
  const listConfigurableProviders = vi.fn(async (): Promise<PublishedRemoteResult> => ok([]))
  const modelCatalog = vi.fn(async (): Promise<PublishedRemoteResult> => ok(catalog))
  const discoverModels = vi.fn(async (): Promise<PublishedRemoteResult> => ok([{ id: 'must-not-be-used', name: 'Discovery result' }]))
  const remote = {
    llm: { listProviders, listConfigurableProviders, discoverModels },
    session: { modelCatalog },
  }
  return { remote, listProviders, listConfigurableProviders, modelCatalog, discoverModels }
}

describe('model center published model catalog', () => {
  it('uses session.modelCatalog, never discoverModels, and retains the same id across providers', async () => {
    const fixture = publishedRpc()
    const snapshot = await readModelCenterModels(fixture.remote as unknown as ModelCenterModelsRemote)

    expect(fixture.modelCatalog).toHaveBeenCalledTimes(1)
    expect(fixture.discoverModels).not.toHaveBeenCalled()
    expect(snapshot.models.map(model => [model.provider, model.id])).toEqual([
      ['deepseek', 'shared-model'],
      ['openai-codex', 'shared-model'],
    ])
    expect(new Set(snapshot.models.map(model => model.key)).size).toBe(2)
    expect(snapshot.models[0]).not.toHaveProperty('contextWindow')
    expect(snapshot.models[0]).not.toHaveProperty('maxTokens')
    expect(snapshot.models[0]).not.toHaveProperty('maxInput')
  })

  it('rejects a duplicate model id returned twice by one provider route', async () => {
    const fixture = publishedRpc({
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [
          { id: 'duplicate', name: 'First' },
          { id: 'duplicate', name: 'Second' },
        ],
      }],
      failures: [],
    })

    await expect(readModelCenterModels(fixture.remote as unknown as ModelCenterModelsRemote))
      .rejects.toThrow('MODEL_CENTER_MODELS_DUPLICATE')
  })

  it('shows a configuration-directory warning while retaining the official catalog', async () => {
    const fixture = publishedRpc()
    fixture.listConfigurableProviders.mockResolvedValue(failed({ message: 'directory unavailable' }))

    const snapshot = await readModelCenterModels(fixture.remote as unknown as ModelCenterModelsRemote)

    expect(snapshot.warning).toBe('模型配置目录未完整读取，已显示可用模型。')
    expect(snapshot.models).toHaveLength(2)
    expect(snapshot.models[0]?.id).toBe('shared-model')
    expect(snapshot.providers.map(provider => provider.provider)).toEqual(['deepseek', 'openai-codex'])
  })
})

type JsonRecord = Record<string, unknown>

// This is the shape emitted by Schemastery.toJSON() for an object containing a
// models array. The mock below deliberately exercises the public schema face,
// rather than constructing SettingsSchemaService (which has no public value export).
const modelNamespaceSchema = {
  uid: 14,
  refs: {
    '1': { type: 'string', meta: { required: true } },
    '2': { type: 'number', meta: { min: 1 } },
    '3': { type: 'number', meta: { min: 1 } },
    '4': {
      type: 'object',
      meta: { default: {} },
      dict: { id: 1, contextWindow: 2, maxTokens: 3 },
    },
    '5': { type: 'array', meta: { default: [] }, inner: 4 },
    '8': { type: 'string', meta: {} },
    '9': {
      type: 'object',
      meta: { default: {} },
      dict: { id: 1, contextWindow: 2, maxTokens: 3 },
    },
    '10': { type: 'array', meta: { default: [] }, inner: 9 },
    '11': { type: 'object', meta: { default: {} }, dict: { models: 10 } },
    '12': { type: 'dict', meta: { default: {} }, inner: 11, sKey: 13 },
    '13': { type: 'string', meta: {} },
    '14': { type: 'object', meta: { default: {} }, dict: { models: 5, providers: 12 } },
  },
  type: 'object',
  meta: { default: {} },
  dict: { models: 5, providers: 12 },
} as const

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)]
    } else if (isRecord(current)) {
      current = current[segment]
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
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else {
      return false
    }
  }
  return true
}

function resolveSchemaNode(root: JsonRecord, reference: unknown): JsonRecord | undefined {
  if (typeof reference === 'number') {
    const refs = isRecord(root.refs) ? root.refs : undefined
    const node = refs?.[String(reference)]
    return isRecord(node) ? node : undefined
  }
  return isRecord(reference) ? reference : undefined
}

function nodeAtPath(rootValue: unknown, path: readonly string[]): JsonRecord | undefined {
  if (!isRecord(rootValue)) return undefined
  let root = rootValue
  let node = resolveSchemaNode(root, root)
  for (const segment of path) {
    if (!node) return undefined
    if (node.type === 'object' && isRecord(node.dict)) {
      node = resolveSchemaNode(root, node.dict[segment])
    } else if (node.type === 'array' && typeof node.inner === 'number' && /^\d+$/.test(segment)) {
      node = resolveSchemaNode(root, node.inner)
    } else if (node.type === 'dict') {
      node = resolveSchemaNode(root, node.inner)
    } else {
      return undefined
    }
  }
  return node
}

function schemaFixture(): Pick<SettingsSchemaService, 'getPath' | 'hasPath' | 'rehydrate' | 'nodeAtPath' | 'validate'> {
  const rehydrate = vi.fn((serialized: unknown) => serialized as SchemaNode)
  const node = vi.fn((root: SchemaNode, path: readonly string[]) => nodeAtPath(root, path) as unknown as SchemaNode | undefined)
  const validate = vi.fn((schema: SchemaNode, value: unknown) => {
    const nodeValue = schema as unknown as JsonRecord
    if (nodeValue.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return 'number required'
    const minimum = isRecord(nodeValue.meta) && typeof nodeValue.meta.min === 'number' ? nodeValue.meta.min : undefined
    if (minimum !== undefined && (value as number) < minimum) return 'minimum'
    return undefined
  })
  return {
    getPath,
    hasPath,
    rehydrate,
    nodeAtPath: node,
    validate,
  }
}

function namespace(options: {
  ns?: string
  value?: unknown
  user?: unknown
  revision?: number
  schema?: unknown
} = {}): SettingsNamespaceView {
  const hasUser = Object.hasOwn(options, 'user')
  return {
    autoGenerate: true,
    ns: options.ns ?? 'llm-deepseek',
    schema: (options.schema ?? modelNamespaceSchema) as SettingsNamespaceView['schema'],
    value: (options.value ?? {
      models: [{ id: 'deepseek-chat', contextWindow: 65536, maxTokens: 8192 }],
    }) as SettingsNamespaceView['value'],
    ...(hasUser
      ? { user: options.user as SettingsNamespaceView['user'] }
      : { user: { models: [{ id: 'deepseek-chat', contextWindow: 32768, maxTokens: 4096 }] } }),
    applies: 'live',
    secrets: [],
    revision: options.revision ?? 7,
  }
}

const deepseekProvider = {
  provider: 'deepseek',
  name: 'DeepSeek',
  active: true,
  settingsNs: 'llm-deepseek',
  settingsPath: [] as const,
}

describe('model center existing model editor', () => {
  it('recognizes an exact id in the confirmed DeepSeek family when raw user fields and schema nodes exist', () => {
    const schema = schemaFixture()
    const definition = findExistingModelDefinition(namespace(), deepseekProvider, 'deepseek-chat', schema)

    expect(definition).toEqual({
      modelPath: ['models', '0'],
      revision: 7,
      contextWindow: 65536,
      maxTokens: 8192,
      editable: true,
    })
    expect(schema.rehydrate).toHaveBeenCalledWith(modelNamespaceSchema)
    expect(schema.nodeAtPath).toHaveBeenCalled()
  })

  it('supports the confirmed nested pi-ai family and refuses an unrecognized family or bad path', () => {
    const schema = schemaFixture()
    const piNamespace = namespace({
      ns: 'llm-pi-ai',
      value: { providers: { anthropic: { models: [{ id: 'claude-3', contextWindow: 200000, maxTokens: 8192 }] } } },
      user: { providers: { anthropic: { models: [{ id: 'claude-3', contextWindow: 100000, maxTokens: 4096 }] } } },
    })
    const piProvider = {
      provider: 'anthropic', name: 'Anthropic', active: true,
      settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] as const,
    }
    const nestedDefinition = findExistingModelDefinition(piNamespace, piProvider, 'claude-3', schema)
    expect(nestedDefinition?.modelPath).toEqual(['providers', 'anthropic', 'models', '0'])
    expect(nestedDefinition?.editable).toBe(true)

    expect(findExistingModelDefinition(
      namespace(),
      { ...deepseekProvider, settingsPath: ['providers', 'deepseek'] },
      'deepseek-chat',
      schema,
    )).toBeUndefined()
    expect(findExistingModelDefinition(
      namespace({ ns: 'llm-unrecognized' }),
      { ...deepseekProvider, settingsNs: 'llm-unrecognized' },
      'deepseek-chat',
      schema,
    )).toBeUndefined()
    expect(findExistingModelDefinition(namespace(), deepseekProvider, 'wrong-id', schema)).toBeUndefined()
  })

  it('refuses a base-only model record even when the resolved value and schema are present', async () => {
    const schema = schemaFixture()
    const form = { mutate: vi.fn(async () => true) }
    const baseOnly = namespace({ user: undefined })

    expect(findExistingModelDefinition(baseOnly, deepseekProvider, 'deepseek-chat', schema)?.editable).toBe(false)
    await expect(mutateExistingModelDefinition({
      namespace: baseOnly,
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      modelPath: ['models', '0'],
      expectedRevision: 7,
      patch: { contextWindow: 131072 },
      form,
      schema,
    })).rejects.toThrow('MODEL_CENTER_MODEL_WRITE_UNAVAILABLE')
    expect(form.mutate).not.toHaveBeenCalled()
  })

  it('emits exact field operations at the expected revision without replacing providers or credentials', async () => {
    const schema = schemaFixture()
    const originalUser = {
      models: [{ id: 'deepseek-chat', contextWindow: 32768, maxTokens: 4096, credentialRef: 'keep-me' }],
      providerLabel: 'keep-provider-config',
    }
    const current = namespace({ user: originalUser })
    const credentialWrite = vi.fn()
    const providerReplace = vi.fn()
    let applied: unknown
    const mutate = vi.fn(async (ops: readonly SettingsPathOpView[], expectedRevision?: number) => {
      expect(expectedRevision).toBe(7)
      applied = structuredClone(originalUser)
      for (const op of ops) {
        if (op.op !== 'set') throw Error('unexpected unset')
        const model = (applied as JsonRecord).models as JsonRecord[]
        const index = Number(op.path[1])
        model[index] = { ...model[index], [op.path[2]!]: op.value }
      }
      return true
    })
    const formWithBoundarySpies = { mutate, credentialWrite, providerReplace }

    await mutateExistingModelDefinition({
      namespace: current,
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      modelPath: ['models', '0'],
      expectedRevision: 7,
      patch: { contextWindow: 131072, maxTokens: 16384 },
      form: formWithBoundarySpies,
      schema,
    })

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['models', '0', 'contextWindow'], value: 131072 },
      { op: 'set', path: ['models', '0', 'maxTokens'], value: 16384 },
    ], 7)
    expect(credentialWrite).not.toHaveBeenCalled()
    expect(providerReplace).not.toHaveBeenCalled()
    expect(applied).toEqual({
      models: [{ id: 'deepseek-chat', contextWindow: 131072, maxTokens: 16384, credentialRef: 'keep-me' }],
      providerLabel: 'keep-provider-config',
    })
  })

  it('rejects a stale revision or a caller-supplied model path before writing', async () => {
    const schema = schemaFixture()
    const mutate = vi.fn(async () => true)
    const form = { mutate }

    await expect(mutateExistingModelDefinition({
      namespace: namespace({ revision: 8 }),
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      modelPath: ['models', '0'],
      expectedRevision: 7,
      patch: { contextWindow: 131072 },
      form,
      schema,
    })).rejects.toThrow('MODEL_CENTER_MODEL_REVISION_CONFLICT')

    await expect(mutateExistingModelDefinition({
      namespace: namespace(),
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      modelPath: ['models', '1'],
      expectedRevision: 7,
      patch: { contextWindow: 131072 },
      form,
      schema,
    })).rejects.toThrow('MODEL_CENTER_MODEL_WRITE_UNAVAILABLE')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('propagates a rejected mutate as a named revision conflict', async () => {
    const schema = schemaFixture()
    const mutate = vi.fn(async () => false)

    await expect(mutateExistingModelDefinition({
      namespace: namespace(),
      provider: deepseekProvider,
      modelId: 'deepseek-chat',
      modelPath: ['models', '0'],
      expectedRevision: 7,
      patch: { maxTokens: 16384 },
      form: { mutate },
      schema,
    })).rejects.toThrow('MODEL_CENTER_MODEL_REVISION_CONFLICT')
    expect(mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['models', '0', 'maxTokens'], value: 16384 },
    ], 7)
  })
})
