import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_CENTER_WEB_PATHS,
  parseModelCenterWebAccounts,
  parseModelCenterWebModels,
  parseModelCenterWebStatus,
  readModelCenterWeb,
  type ModelCenterWebResponse,
} from '../src/model-center-web.js'

const secret = 'super-secret-token-value-should-never-appear'

function response(value: unknown, status = 200): ModelCenterWebResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => value }
}

describe('model center web read-only boundary', () => {
  it('reads only the three approved routes, redacts credentials, and keeps selection untouched', async () => {
    const fixtures = {
      [MODEL_CENTER_WEB_PATHS.status]: {
        provider: 'deepseek-web',
        registeredProviders: ['deepseek-web'],
        auth: {
          loggedIn: true,
          display: 'al***@example.com',
          hasCookie: true,
          hasFingerprint: true,
          tokenLength: secret.length,
          token: secret,
        },
        config: {
          guest: { session: { token: secret }, storage: { sessionToken: secret }, cookie: secret },
        },
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'fast', thinking: false, contextWindow: 1048576 },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', thinking: true, contextWindow: 1048576, token: secret },
        ],
      },
      [MODEL_CENTER_WEB_PATHS.accounts]: {
        activeId: 'acc_work',
        accounts: [{
          id: 'acc_work',
          title: 'Work account',
          label: 'Work',
          display: 'al***@example.com',
          isActive: true,
          unverified: false,
          token: secret,
          cookie: secret,
          extraHeaders: { authorization: `Bearer ${secret}` },
          lastVerifyError: { message: secret },
          limit: { untilMs: Date.now() + 60_000 },
        }],
      },
      [MODEL_CENTER_WEB_PATHS.models]: {
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text', 'image'], token: secret }],
        error: secret,
      },
    }
    const before = structuredClone(fixtures)
    const requests: Array<{ path: string; method: string }> = []
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, method: init?.method ?? 'GET' })
      return response(fixtures[path as keyof typeof fixtures])
    })

    const snapshot = await readModelCenterWeb(fetcher)

    expect(requests).toEqual([
      { path: MODEL_CENTER_WEB_PATHS.status, method: 'GET' },
      { path: MODEL_CENTER_WEB_PATHS.accounts, method: 'GET' },
      { path: MODEL_CENTER_WEB_PATHS.models, method: 'POST' },
    ])
    expect(snapshot.errors).toEqual([])
    expect(snapshot.status?.auth).toMatchObject({ loggedIn: true, hasCookie: true, hasFingerprint: true })
    expect(snapshot.status).not.toHaveProperty('config')
    expect(snapshot.status).not.toHaveProperty('auth.token')
    expect(snapshot.activeAccountId).toBe('acc_work')
    expect(snapshot.accounts?.[0]).toMatchObject({
      id: 'acc_work',
      internalId: 'acc_work',
      label: 'Work',
      isActive: true,
      state: 'limited',
    })
    expect(snapshot.accounts?.[0]).not.toHaveProperty('token')
    expect(snapshot.models).toEqual([
      {
        id: 'deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'fast',
        capabilities: ['text', 'image'],
        contextWindow: 1048576,
      },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        capabilities: ['thinking'],
        contextWindow: 1048576,
      },
    ])
    expect(JSON.stringify(snapshot)).not.toContain(secret)
    expect(fixtures).toEqual(before)
  })

  it('reports each failed source without dumping server errors or fabricating source data', async () => {
    const fetcher = vi.fn(async (path: string) => {
      if (path === MODEL_CENTER_WEB_PATHS.status) return response({ error: secret }, 503)
      if (path === MODEL_CENTER_WEB_PATHS.accounts) throw new Error(`network leaked ${secret}`)
      return response({ models: [{ id: 'deepseek-chat', inputModalities: ['text'] }] })
    })

    const snapshot = await readModelCenterWeb(fetcher)

    expect(snapshot.status).toBeNull()
    expect(snapshot.accounts).toBeNull()
    expect(snapshot.models).toEqual([{ id: 'deepseek-chat', capabilities: ['text'] }])
    expect(snapshot.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'status', kind: 'http', status: 503, message: 'HTTP 503' }),
      expect.objectContaining({ source: 'accounts', kind: 'request', message: 'request failed' }),
    ]))
    expect(JSON.stringify(snapshot)).not.toContain(secret)
    expect(JSON.stringify(snapshot)).not.toContain('network leaked')
  })

  it('keeps parser output to declared safe fields', () => {
    const status = parseModelCenterWebStatus({
      provider: 'deepseek-web',
      auth: { display: 'alice@example.com', token: secret, hasCookie: true },
      config: { guest: { token: secret } },
      models: [{ id: 'deepseek-chat', inputModalities: ['text', 'audio', 'image'], unknown: secret }],
    })
    const accounts = parseModelCenterWebAccounts({
      activeId: 'acc_1',
      accounts: [{ id: 'acc_1', label: 'Personal', token: secret, cookie: secret, isActive: true }],
    })
    const models = parseModelCenterWebModels({ models: [{ id: 'deepseek-chat', inputModalities: ['text'], secret }] })

    expect(status).toEqual({
      provider: 'deepseek-web',
      auth: { display: 'al***@example.com', hasCookie: true },
      models: [{ id: 'deepseek-chat', capabilities: ['text', 'image'] }],
    })
    expect(accounts.accounts[0]).toMatchObject({ id: 'acc_1', label: 'Personal', isActive: true })
    expect(models).toEqual([{ id: 'deepseek-chat', capabilities: ['text'] }])
    expect(JSON.stringify({ status, accounts, models })).not.toContain(secret)
  })
})
