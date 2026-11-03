// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { ExperienceStore } from '../src/client.js'
import type { ExperienceApi, ExperienceSettings } from '../src/contracts.js'
const base: ExperienceSettings = { formatVersion: 1, revision: 0, takeover: false, openui: true, mcpApps: false }
describe('settings client', () => {
  it('does not let an older refresh undo a saved takeover setting', async () => {
    let complete!: (value: ExperienceSettings) => void
    const api: ExperienceApi = { settings: () => new Promise(resolve => { complete = resolve }), saveSettings: async input => ({ ...base, ...input, revision: 1 }), artifacts: async () => [], publish: async () => { throw new Error('not used') } }
    const store = new ExperienceStore(); store.update({ api, settings: base })
    const pending = store.refresh()
    await store.save({ expectedRevision: 0, takeover: true, openui: true, mcpApps: false })
    complete(base); await pending
    expect(store.snapshot().settings?.takeover).toBe(true)
  })
})

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, apiFromWire, openUiFence, continueInSession } from '../src/client.js'
import { vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

describe('chat takeover', () => {
  it('registers both conversation readers, relocates import out of Generated content and reads the exact preview session', async () => {
    vi.useFakeTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } }, () => null)
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const snapshot = { formatVersion: 1 as const, sessionId: 'preview-session', available: true, runs: [], warnings: [] }
    const wire = { settings: async () => ok(base), saveSettings: async () => ok(base), artifacts: vi.fn(async () => ok([])), publish: vi.fn(async () => { throw Error('No automatic publish') }), localFiles: vi.fn(async () => ok([])), insightPreview: vi.fn(async () => ok(snapshot)) }
    const cleanups: Array<() => void> = []
    const inject = vi.fn((_requirements: string[], _callback: unknown) => () => {}) // Layout navigation has its own declaration-aware integration tests.
    const using = vi.fn(() => { throw Error('No automatic session submission') })
    const ctx = { inject, slots: { register, inject: (_name: string, callback: () => () => void) => callback(), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : name === 'sessions' ? { using } : name === 'remote.solarExperience' ? wire : undefined, on: () => () => {} } as unknown as Context
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      apply(ctx)
      await vi.advanceTimersByTimeAsync(0)
      const readers = core.entriesOfSlot('conversation.view')
      expect(readers.map(entry => entry.options.id).sort()).toEqual(['solar-intelligent-experience', 'solar-intelligent-insight-preview'])
      expect(inject.mock.calls[0]?.[0]).toEqual(['layout'])
      const Generated = readers.find(entry => entry.options.id === 'solar-intelligent-experience')!.component as ComponentType<{ sessionId: string }>
      await act(async () => root.render(createElement(Generated, { sessionId: 'generated-session' })))
      expect(host.textContent).toContain('生成内容')
      expect(host.querySelector('input[type="file"]')).toBeNull()
      expect(host.querySelector('form[aria-label="导入本地数据"]')).toBeNull()
      expect(wire.artifacts).toHaveBeenCalledWith({ sessionId: 'generated-session' })
      const Preview = readers.find(entry => entry.options.id === 'solar-intelligent-insight-preview')!.component as ComponentType<{ sessionId: string }>
      await act(async () => root.render(createElement(Preview, { sessionId: 'preview-session' })))
      expect(host.textContent).toContain('当前会话还没有洞察结果')
      expect(wire.insightPreview).toHaveBeenCalledExactlyOnceWith({ sessionId: 'preview-session' })
      wire.insightPreview.mockResolvedValueOnce(ok({ ...snapshot, sessionId: 'foreign-session' }))
      await act(async () => root.render(createElement(Preview, { sessionId: 'next-session' })))
      expect(wire.insightPreview).toHaveBeenLastCalledWith({ sessionId: 'next-session' })
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('洞察结果与当前会话不一致')
      expect(host.textContent).not.toContain('当前会话还没有洞察结果')
      expect(wire.localFiles).not.toHaveBeenCalled()
      expect(wire.publish).not.toHaveBeenCalled()
      expect(using).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove(); cleanups.reverse().forEach(dispose => dispose()); vi.useRealTimers()
    }
  })

  it('shadows and restores official keyed renderers as persisted settings change', async () => {
    vi.useFakeTimers()
    const core = new SlotCore()
    const rootRegister = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    rootRegister({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } }, () => null)
    const officialAssistant = () => null; const officialTool = () => null
    rootRegister({ name: 'conversation.chat.node', key: 'assistant-step' }, officialAssistant)
    rootRegister({ name: 'conversation.chat.node', key: 'tool-call' }, officialTool)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const ctx = { inject: () => () => {}, slots: { register: rootRegister, inject: (_name: string, callback: () => () => void) => callback(), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    apply(ctx)
    await vi.advanceTimersByTimeAsync(0)
    const winner = (key: string) => core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === key)?.component
    expect(winner('assistant-step')).toBe(officialAssistant)
    settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
    expect(winner('assistant-step')).not.toBe(officialAssistant)
    expect(winner('tool-call')).not.toBe(officialTool)
    settings = { ...base, revision: 2, takeover: false }; await vi.advanceTimersByTimeAsync(5000)
    expect(winner('assistant-step')).toBe(officialAssistant)
    expect(winner('tool-call')).toBe(officialTool)
    cleanups.forEach(dispose => dispose()); vi.useRealTimers()
  })
  it.each(['same-priority', 'higher-priority'] as const)('reports %s conflict and rolls back owned entries', async conflict => {
    vi.useFakeTimers()
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } }, () => null)
    const officialAssistant = () => null; const officialTool = () => null; const foreign = () => null
    register({ name: 'conversation.chat.node', key: 'assistant-step' }, officialAssistant)
    register({ name: 'conversation.chat.node', key: 'tool-call' }, officialTool)
    const removeForeign = register({ name: 'conversation.chat.node', key: 'tool-call', priority: conflict === 'same-priority' ? -100 : -200 }, foreign)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const ctx = { inject: () => () => {}, slots: { register, inject: (_name: string, callback: () => () => void) => callback(), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    apply(ctx); await vi.advanceTimersByTimeAsync(0)
    settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
    expect(core.entries('conversation.chat.node').filter(entry => entry.component !== officialAssistant && entry.component !== officialTool && entry.component !== foreign)).toHaveLength(0)
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'assistant-step')?.component).toBe(officialAssistant)
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'tool-call')?.component).toBe(foreign)
    const settingEntry = core.entriesOfSlot('settings.section')[0]!
    const SettingsView = settingEntry.component as () => React.ReactElement
    const { createElement } = await import('react'); const { createRoot } = await import('react-dom/client'); const { act } = await import('react')
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(SettingsView)))
    expect(host.textContent).toContain('聊天接管不可用')
    settings = { ...base, revision: 2, takeover: false }; await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(host.textContent).not.toContain('聊天接管不可用')
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'tool-call')?.component).toBe(foreign)
    await act(async () => root.unmount()); host.remove(); removeForeign(); cleanups.forEach(dispose => dispose()); vi.useRealTimers()
  })
  it('recognizes only explicit complete or streaming OpenUI fences', () => {
    expect(openUiFence('```openui\nroot = TextContent("Hi")\n```', false)).toBe('root = TextContent("Hi")')
    expect(openUiFence('```openui\nroot = TextContent("Hi', true)).toContain('TextContent')
    expect(openUiFence('```openui\nroot = X', false)).toBeUndefined()
    expect(openUiFence('ordinary markdown', true)).toBeUndefined()
  })
  it('uses a real submission identity and sends state into the session prompt', async () => {
    const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    const beginSubmission = vi.fn(() => ({ requestId: 'request-1', abandon: vi.fn() }))
    const session = { beginSubmission, prompt }
    const ctx = { sessions: { using: async (_id: unknown, _options: unknown, run: (ref: unknown) => unknown) => run({ ready: Promise.resolve({ session }) }) } } as unknown as Parameters<typeof continueInSession>[0]
    await continueInSession(ctx, 'session-1' as never, { type: 'continue_conversation', params: {}, humanFriendlyMessage: 'Submit' }, { name: 'Alice' }, new AbortController().signal)
    expect(prompt).toHaveBeenCalledOnce()
    expect(JSON.stringify(prompt.mock.calls)).toContain('Alice')
    expect(beginSubmission).toHaveBeenCalledOnce()
  })
})

describe('optional reader wire boundaries', () => {
  it('keeps older hosts optional and validates library/preview values without changing their source', async () => {
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const required = { settings: async () => ok(base), saveSettings: async () => ok(base), artifacts: async () => ok([]), publish: async () => { throw Error('not used') } }
    const older = apiFromWire(required)
    expect(older.localFiles).toBeUndefined()
    expect(older.insightPreview).toBeUndefined()
    const file = { formatVersion: 1, id: '123e4567-e89b-42d3-a456-426614174000', createdAt: '2026-11-02T00:00:00.000Z', source: { sessionId: 'library:intelligent-ui:files', kind: 'generated', label: '本地导入：报告.md' }, protocol: 'content', providerId: 'local-import', raw: '\uFEFF原文\r\n', payload: '\uFEFF原文\r\n' }
    const snapshot = { formatVersion: 1, sessionId: 'reader-session', available: true, runs: [], warnings: [] }
    const localFiles = vi.fn(async (): Promise<{ ok: true; value: unknown }> => ok([file]))
    const insightPreview = vi.fn(async (_input: { sessionId: string }): Promise<{ ok: true; value: unknown }> => ok(snapshot))
    const api = apiFromWire({ ...required, localFiles, insightPreview } as unknown as Parameters<typeof apiFromWire>[0])
    expect(await api.localFiles!()).toEqual([file])
    expect(await api.insightPreview!({ sessionId: 'reader-session' })).toEqual(snapshot)
    expect(insightPreview).toHaveBeenCalledWith({ sessionId: 'reader-session' })
    localFiles.mockResolvedValueOnce(ok([{ ...file, formatVersion: 99 }]))
    await expect(api.localFiles!()).rejects.toThrow()
    insightPreview.mockResolvedValueOnce(ok({ ...snapshot, runs: [{ id: 'unvalidated' }] }))
    await expect(api.insightPreview!({ sessionId: 'reader-session' })).rejects.toThrow()
  })
})
