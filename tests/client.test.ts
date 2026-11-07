// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { ExperienceStore } from '../src/client.js'
import { ContentView } from '../src/presentation.js'
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

type SlotRegister = (options: unknown, component: unknown) => () => void
type FactoryRegister = (options: unknown, component: unknown) => () => void

function installOfficialUserMessageSeams(core: SlotCore, register: SlotRegister) {
  const registerFactory = core.registerFactory.bind(core) as unknown as FactoryRegister
  const officialUserText = () => null
  const officialUserContent = () => null
  const officialText = () => null
  registerFactory({ name: 'conversation.user.text', scope: 'session', children: { 'conversation.user.text.node': { kind: 'keyed', scope: 'session', inline: true } } }, officialUserText)
  registerFactory({ name: 'conversation.chat.user.content', scope: 'session', children: { 'conversation.chat.user.images': { kind: 'single', scope: 'session' } } }, officialUserContent)
  register({ name: 'conversation.user.text.node', key: 'text', priority: 100 }, officialText)
  return { registerFactory, officialText, officialUserText, officialUserContent }
}

describe('chat takeover', () => {
  it('registers both conversation readers, relocates import out of Generated content and reads the exact preview session', async () => {
    vi.useFakeTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const snapshot = { formatVersion: 1 as const, sessionId: 'preview-session', available: true, runs: [], warnings: [] }
    const wire = { settings: async () => ok(base), saveSettings: async () => ok(base), artifacts: vi.fn(async () => ok([])), publish: vi.fn(async () => { throw Error('No automatic publish') }), localFiles: vi.fn(async () => ok([])), insightPreview: vi.fn(async () => ok(snapshot)) }
    const cleanups: Array<() => void> = []
    const inject = vi.fn((_requirements: string[], _callback: unknown) => () => {}) // Layout navigation has its own declaration-aware integration tests.
    const using = vi.fn(() => { throw Error('No automatic session submission') })
    const ctx = { locale: { subscribe: () => () => {} }, inject, slots: { register, inject: (_name: string, callback: () => () => void) => callback(), entries: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : name === 'sessions' ? { using } : name === 'remote.solarExperience' ? wire : undefined, on: () => () => {} } as unknown as Context
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      apply(ctx)
      await vi.advanceTimersByTimeAsync(0)
      const readers = core.entriesOfSlot('conversation.view')
      expect(readers.map(entry => entry.options.id).sort()).toEqual(['solar-intelligent-experience', 'solar-intelligent-insight-preview'])
      expect(inject.mock.calls.map(call => call[0])).toContainEqual(['layout'])
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
    rootRegister({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const { registerFactory, officialText } = installOfficialUserMessageSeams(core, rootRegister)
    const officialAssistant = () => null; const officialTool = () => null; const officialUser = () => null
    rootRegister({ name: 'conversation.chat.node', key: 'assistant-step' }, officialAssistant)
    rootRegister({ name: 'conversation.chat.node', key: 'tool-call' }, officialTool)
    rootRegister({ name: 'conversation.chat.node', key: 'user' }, officialUser)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const ctx = { locale: { subscribe: () => () => {} }, inject: () => () => {}, slots: { register: rootRegister, registerFactory, inject: (_name: string, callback: () => () => void) => callback(), entries: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    apply(ctx)
    await vi.advanceTimersByTimeAsync(0)
    const winner = (key: string) => core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === key)?.component
    const userTextWinner = () => core.entriesOfSlot('conversation.user.text.node').find(entry => entry.options.key === 'text')?.component
    expect(winner('assistant-step')).toBe(officialAssistant)
    expect(winner('user')).toBe(officialUser)
    expect(userTextWinner()).toBe(officialText)
    settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
    expect(winner('assistant-step')).not.toBe(officialAssistant)
    expect(winner('tool-call')).not.toBe(officialTool)
    expect(winner('user')).toBe(officialUser)
    expect(userTextWinner()).not.toBe(officialText)
    settings = { ...base, revision: 2, takeover: false }; await vi.advanceTimersByTimeAsync(5000)
    expect(winner('assistant-step')).toBe(officialAssistant)
    expect(winner('tool-call')).toBe(officialTool)
    expect(userTextWinner()).toBe(officialText)
    settings = { ...base, revision: 3, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
    cleanups.forEach(dispose => dispose())
    expect(winner('assistant-step')).toBe(officialAssistant)
    expect(winner('tool-call')).toBe(officialTool)
    expect(userTextWinner()).toBe(officialText)
    vi.useRealTimers()
  })

  it('keeps the official user row and content factories while rendering the raw user text as data', async () => {
    vi.useFakeTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as SlotRegister
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const { registerFactory, officialText, officialUserText, officialUserContent } = installOfficialUserMessageSeams(core, register)
    const officialUser = () => null; const officialSteering = () => null
    register({ name: 'conversation.chat.node', key: 'user' }, officialUser)
    register({ name: 'conversation.chat.node', key: 'steering' }, officialSteering)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const ctx = { locale: { subscribe: () => () => {} }, inject: () => () => {}, slots: { register, registerFactory, inject: (_name: string, callback: () => () => void) => callback(), entries: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      apply(ctx); await vi.advanceTimersByTimeAsync(0)
      settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
      const chatWinner = (key: string) => core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === key)?.component
      const SmartText = core.entriesOfSlot('conversation.user.text.node').find(entry => entry.options.key === 'text')!.component as ComponentType<{ raw: string }>
      expect(chatWinner('user')).toBe(officialUser)
      expect(chatWinner('steering')).toBe(officialSteering)
      expect(core.factory('conversation.user.text')?.component).toBe(officialUserText)
      expect(core.factory('conversation.chat.user.content')?.component).toBe(officialUserContent)
      expect(SmartText).not.toBe(officialText)
      const unsafeRaw = '<iframe src="https://untrusted.example"></iframe>\n\n```openui\nroot = TextContent("用户原文，不执行")\n```'
      await act(async () => root.render(createElement(SmartText, { raw: unsafeRaw })))
      expect(host.textContent).toContain('用户原文，不执行')
      expect(host.querySelector('iframe')).toBeNull()
      const raw = '首行\r\n保留软换行与 [链接](https://example.com)\r\n\r\n- 第一项\r\n  - 嵌套项\r\n\r\n| 名称 | 值 |\r\n| --- | --- |\r\n| 表格 | 1 |\r\n\r\n```ts\r\n  const exact = "间距";\r\n\r\n  // 保留空行\r\n```'
      await act(async () => root.render(createElement(SmartText, { raw })))
      expect(host.querySelector('.iexp-user-message-text')).not.toBeNull()
      expect(host.querySelector('p[data-iexp-source-start="0"]')?.getAttribute('data-iexp-source-end')).toBe(String(raw.indexOf('\r\n\r\n')))
      expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
      expect(host.querySelectorAll('li')).toHaveLength(2)
      expect(host.querySelector('table')).not.toBeNull()
      expect(host.querySelector('pre')?.textContent).toContain('const exact = "间距";\r\n\r\n  // 保留空行')
      const softLines = '第一行\r\n第二行\r\n第三行'
      await act(async () => root.render(createElement(SmartText, { raw: softLines })))
      const softParagraph = host.querySelector('p[data-iexp-source-start="0"]')
      expect(softParagraph?.getAttribute('data-iexp-source-end')).toBe(String(softLines.length))
      expect(softParagraph?.querySelectorAll('br')).toHaveLength(2)
      const hardLines = '第一行  \r\n第二行\\\r\n第三行'
      await act(async () => root.render(createElement(SmartText, { raw: hardLines })))
      const hardParagraph = host.querySelector('p[data-iexp-source-start="0"]')
      expect(hardParagraph?.getAttribute('data-iexp-source-end')).toBe(String(hardLines.length))
      expect(hardParagraph?.querySelectorAll('br')).toHaveLength(2)
      const whitespaceOnly = ' \r\n\t '
      await act(async () => root.render(createElement(SmartText, { raw: whitespaceOnly })))
      const whitespace = host.querySelector('.iexp-user-message-whitespace')
      expect(whitespace?.firstChild?.nodeValue).toBe(whitespaceOnly)
      expect(host.querySelector('.dsh-experience.iexp-content')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove(); cleanups.reverse().forEach(dispose => dispose()); vi.useRealTimers()
    }
  })

  it('keeps soft line breaks opt-in to the user text renderer', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(createElement(ContentView, { value: '第一行\n第二行\n第三行' })))
      expect(host.querySelectorAll('.openui-markdown-renderer br')).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('retracts the first injection when the user-text injection throws synchronously', async () => {
    vi.useFakeTimers()
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as SlotRegister
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const { registerFactory, officialText } = installOfficialUserMessageSeams(core, register)
    const officialAssistant = () => null; const officialTool = () => null
    register({ name: 'conversation.chat.node', key: 'assistant-step' }, officialAssistant)
    register({ name: 'conversation.chat.node', key: 'tool-call' }, officialTool)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const firstInjectionDispose = vi.fn()
    const ctx = { locale: { subscribe: () => () => {} }, inject: () => () => {}, slots: {
      register,
      registerFactory,
      inject: (name: string, callback: () => () => void) => {
        if (name === 'conversation.chat.node') {
          const dispose = callback()
          return () => { firstInjectionDispose(); dispose() }
        }
        if (name === 'conversation.user.text.node') throw new Error('user text injection unavailable')
        return callback()
      },
      entries: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core),
      subscribe: core.subscribe.bind(core),
    }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    try {
      apply(ctx); await vi.advanceTimersByTimeAsync(0)
      settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
      expect(firstInjectionDispose).toHaveBeenCalledOnce()
      expect(core.entries('conversation.chat.node').filter(entry => entry.component !== officialAssistant && entry.component !== officialTool)).toHaveLength(0)
      expect(core.entriesOfSlot('conversation.user.text.node').find(entry => entry.options.key === 'text')?.component).toBe(officialText)
    } finally {
      cleanups.reverse().forEach(dispose => dispose()); vi.useRealTimers()
    }
  })

  it.each([
    ['same-priority', 'tool-call', 'conversation.chat.node', 'tool-call', -100],
    ['higher-priority', 'tool-call', 'conversation.chat.node', 'tool-call', -200],
    ['same-priority', 'user text', 'conversation.user.text.node', 'text', -100],
    ['higher-priority', 'user text', 'conversation.user.text.node', 'text', -200],
  ] as const)('reports %s %s conflict and rolls back owned entries', async (_priorityName, target, slot, key, priority) => {
    vi.useFakeTimers()
    const core = new SlotCore()
    const register = core.register.bind(core) as unknown as (options: unknown, component: unknown) => () => void
    register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' }, 'settings.section': { kind: 'list', scope: 'root' }, 'settings.action': { kind: 'list', scope: 'root' }, 'conversation.view': { kind: 'list', scope: 'session' }, 'conversation.session.header.utilities': { kind: 'list', scope: 'session' }, 'conversation.session.header.actions': { kind: 'list', scope: 'session' } } }, () => null)
    const { registerFactory, officialText } = installOfficialUserMessageSeams(core, register)
    const officialAssistant = () => null; const officialTool = () => null; const foreign = () => null
    register({ name: 'conversation.chat.node', key: 'assistant-step' }, officialAssistant)
    register({ name: 'conversation.chat.node', key: 'tool-call' }, officialTool)
    const removeForeign = register({ name: slot, key, priority }, foreign)
    let settings = base
    const ok = <T>(value: T) => ({ ok: true as const, value })
    const wire = { settings: async () => ok(settings), saveSettings: async () => ok(settings), artifacts: async () => ok([]), publish: async () => ok({}) }
    const cleanups: Array<() => void> = []
    const ctx = { locale: { subscribe: () => () => {} }, inject: () => () => {}, slots: { register, registerFactory, inject: (_name: string, callback: () => () => void) => callback(), entries: core.entries.bind(core), entriesOfSlot: core.entriesOfSlot.bind(core), subscribe: core.subscribe.bind(core) }, effect: (callback: () => () => void) => { const dispose = callback(); cleanups.push(dispose); return dispose }, provide: () => () => {}, remote: { $mount: async () => async () => {} }, get: (name: string) => name === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : wire, on: () => () => {} } as unknown as Context
    apply(ctx); await vi.advanceTimersByTimeAsync(0)
    settings = { ...base, revision: 1, takeover: true }; await vi.advanceTimersByTimeAsync(5000)
    expect(core.entries('conversation.chat.node').filter(entry => entry.component !== officialAssistant && entry.component !== officialTool && (slot !== 'conversation.chat.node' || entry.component !== foreign))).toHaveLength(0)
    expect(core.entries('conversation.user.text.node').filter(entry => entry.component !== officialText && (slot !== 'conversation.user.text.node' || entry.component !== foreign))).toHaveLength(0)
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'assistant-step')?.component).toBe(officialAssistant)
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'tool-call')?.component).toBe(target === 'tool-call' ? foreign : officialTool)
    expect(core.entriesOfSlot('conversation.user.text.node').find(entry => entry.options.key === 'text')?.component).toBe(target === 'user text' ? foreign : officialText)
    const settingEntry = core.entriesOfSlot('settings.section')[0]!
    const SettingsView = settingEntry.component as () => React.ReactElement
    const { createElement } = await import('react'); const { createRoot } = await import('react-dom/client'); const { act } = await import('react')
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(createElement(SettingsView)))
    expect(host.textContent).toContain('聊天接管不可用')
    settings = { ...base, revision: 2, takeover: false }; await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(host.textContent).not.toContain('聊天接管不可用')
    expect(core.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'tool-call')?.component).toBe(target === 'tool-call' ? foreign : officialTool)
    expect(core.entriesOfSlot('conversation.user.text.node').find(entry => entry.options.key === 'text')?.component).toBe(target === 'user text' ? foreign : officialText)
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
