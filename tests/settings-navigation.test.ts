// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { SlotCore, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import {
  SETTINGS_NAVIGATION_ACTION_ID,
  activateNativeSettingsSection,
  groupForSettingsSection,
  groupSettingsSections,
  installSettingsNavigation,
  readSettingsSections,
  normalizeSettingsLabel,
} from '../src/settings-navigation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Register = (options: Record<string, unknown>, component: unknown) => () => void

class Locale {
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit() { this.listeners.forEach(listener => listener()) }

  get count() { return this.listeners.size }
}

function storedEntry(id: string, label: string | (() => string), order: number): StoredEntry {
  return { component: null, options: { id, label, order } }
}

function createPreference() {
  let state = { settings: { settingsNavigation: false } }
  const listeners = new Set<() => void>()
  const setEnabled = vi.fn(async (enabled: boolean) => {
    state = { settings: { settingsNavigation: enabled } }
    listeners.forEach(listener => listener())
  })
  return { snapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, setEnabled }
}

function createFixture() {
  const core = new SlotCore()
  const rawRegister = core.register.bind(core) as unknown as Register
  const registrations: string[] = []
  const register: Register = (options, component) => {
    registrations.push(String(options.name))
    return rawRegister(options, component)
  }
  register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.action': { kind: 'list', scope: 'root' },
  } }, () => null)
  const preference = createPreference()
  const locale = new Locale()
  const effects: Array<() => void> = []
  const ctx = {
    slots: {
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core),
      inject: (_name: string, callback: () => () => void) => callback(),
      register,
    },
    locale,
    effect: (callback: () => () => void) => {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
  } as unknown as Context
  const section = (id: string, label: string | (() => string), order = 0) => register({ name: 'settings.section', id, label, order }, () => null)
  return {
    core,
    ctx,
    locale,
    preference,
    registrations,
    section,
    dispose: () => { effects.splice(0).reverse().forEach(dispose => dispose()) },
  }
}

function addNativeNavButton(nav: HTMLElement, label: string, listener = vi.fn()): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', listener)
  nav.append(button)
  return button
}

async function renderAction(fixture: ReturnType<typeof createFixture>, labels: Array<{ label: string, listener?: ReturnType<typeof vi.fn> }> = []) {
  installSettingsNavigation(fixture.ctx, fixture.preference)
  const Action = fixture.core.entriesOfSlot('settings.action').find(entry => entry.options.id === SETTINGS_NAVIGATION_ACTION_ID)?.component as ComponentType
  if (!Action) throw new Error('expected grouped settings action')
  const launcher = document.createElement('button')
  launcher.setAttribute('data-account-launcher', 'unchanged')
  launcher.setAttribute('aria-label', '账户启动器')
  launcher.textContent = '账户启动器'
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  const nav = document.createElement('nav')
  const native = labels.map(({ label, listener }) => addNativeNavButton(nav, label, listener))
  const actionHost = document.createElement('div')
  dialog.append(nav, actionHost)
  document.body.append(launcher, dialog)
  const root = createRoot(actionHost)
  await act(async () => { root.render(createElement(Action)) })
  return {
    dialog,
    launcher,
    nav,
    native,
    root,
    actionHost,
    async cleanup() {
      await act(async () => { root.unmount() })
      fixture.dispose()
      dialog.remove()
      launcher.remove()
    },
  }
}

async function openCategory(host: HTMLElement, id = 'models-and-accounts') {
  const button = host.querySelector<HTMLButtonElement>(`button[data-navigation-category="${id}"]`)
  if (!button) throw new Error('expected persistent category '+id)
  await click(button)
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

function actionTrigger(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(candidate => ['分类导航', '取消分类导航'].includes(candidate.textContent ?? ''))
  if (!button) throw new Error('expected grouped navigation trigger')
  return button
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('grouped settings navigation metadata', () => {
  it('matches labels across whitespace and keeps core pages in their semantic categories', () => {
    expect(normalizeSettingsLabel('  模型\n \t设置  ')).toBe('模型 设置')
    expect(groupForSettingsSection('general')).toBe('appearance-and-display')
    expect(groupForSettingsSection('cost-meter')).toBe('models-and-accounts')
    expect(groupForSettingsSection('market')).toBe('plugins')
    expect(groupForSettingsSection('future-section')).toBe('other')
  })

  it('retains every known and future section exactly once in sorted groups', () => {
    const ids = [
      'account', 'general', 'models', 'dream-skin', 'plugins', 'model-subscriptions', 'dsh-imagegen', 'agent-presets', 'agent-persona', 'cost-meter',
      'market', 'solar-rlm', 'solar-native-collaboration', 'deepseek-web-login', 'solar-chatgpt-web', 'solar-model-radar', 'solar-intelligent-experience',
      'solar-quant-research', 'bili', 'session-prefix', 'future-section',
    ]
    const rows = readSettingsSections(ids.map((id, index) => storedEntry(id, `  标签 ${index}  `, ids.length - index)))
    const grouped = groupSettingsSections(rows)
    const flattened = grouped.flatMap(group => group.sections)
    expect(flattened).toHaveLength(ids.length)
    expect(new Set(flattened.map(row => row.id))).toEqual(new Set(ids))
    for (const group of grouped) {
      expect(group.sections.map(row => row.order)).toEqual([...group.sections.map(row => row.order)].sort((left, right) => left - right))
    }
    expect(groupForSettingsSection('future-section')).toBe('other')
    expect(grouped.find(group => group.id === 'other')?.sections.map(row => row.id)).toContain('future-section')
    expect(rows[0]?.label).toBe(`标签 ${ids.length - 1}`)
  })
})

describe('grouped settings navigation action', () => {
  it('refreshes both slot rows and localized labels without replacing native navigation', async () => {
    const fixture = createFixture()
    let modelsLabel = '模型'
    fixture.section('models', () => modelsLabel, 10)
    const mounted = await renderAction(fixture, [{ label: '模型' }])
    try {
      const beforeNav = mounted.nav.outerHTML
      const beforeLauncher = mounted.launcher.outerHTML
      await click(actionTrigger(mounted.actionHost))
      await openCategory(mounted.actionHost)
      expect(mounted.actionHost.textContent).toContain('模型')
      modelsLabel = 'Models'
      await act(async () => { fixture.locale.emit() })
      expect(mounted.actionHost.textContent).toContain('Models')
      fixture.section('future-section', () => '未来功能', 20)
      await act(async () => { await Promise.resolve() })
      await openCategory(mounted.actionHost, 'other')
      expect(mounted.actionHost.textContent).toContain('未来功能')
      expect(mounted.nav.outerHTML).toBe(beforeNav)
      expect(mounted.launcher.outerHTML).toBe(beforeLauncher)
      expect(mounted.native).toHaveLength(1)
      expect(mounted.nav.querySelectorAll('button')).toHaveLength(1)
      expect(fixture.registrations.filter(name => name === 'sidebar.settings')).toHaveLength(0)
    } finally {
      await mounted.cleanup()
    }
  })

  it('uses the one native button with an exact normalized label and its existing click handler', async () => {
    const fixture = createFixture()
    fixture.section('models', () => '模型', 10)
    const nativeClick = vi.fn()
    const mounted = await renderAction(fixture, [{ label: '  模型\n', listener: nativeClick }])
    try {
      await click(actionTrigger(mounted.actionHost))
      await openCategory(mounted.actionHost)
      const groupedButton = mounted.actionHost.querySelector<HTMLButtonElement>('button[data-section-id="models"]')
      if (!groupedButton) throw new Error('expected model group button')
      await click(groupedButton)
      expect(nativeClick).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(mounted.native[0])
      expect(mounted.actionHost.querySelector('[role="region"]')).toBeNull()
      expect(actionTrigger(mounted.actionHost).textContent).toBe('取消分类导航')
      expect(mounted.actionHost.querySelector('nav[aria-label="分类导航"]')).not.toBeNull()
      expect(fixture.preference.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
      await openCategory(mounted.actionHost)
      await click(mounted.actionHost.querySelector<HTMLButtonElement>('button[data-section-id="models"]')!)
      expect(nativeClick).toHaveBeenCalledTimes(2)
      expect(fixture.preference.setEnabled).toHaveBeenCalledTimes(1)
      await click(actionTrigger(mounted.actionHost))
      expect(fixture.preference.setEnabled).toHaveBeenLastCalledWith(false)
      expect(mounted.actionHost.querySelector('nav[aria-label="分类导航"]')).toBeNull()
    } finally {
      await mounted.cleanup()
    }
  })

  it('keeps the original Settings menu usable and reports missing or ambiguous native targets', async () => {
    const fixture = createFixture()
    fixture.section('models', () => '模型', 10)
    const mounted = await renderAction(fixture)
    try {
      await click(actionTrigger(mounted.actionHost))
      await openCategory(mounted.actionHost)
      const groupedButton = mounted.actionHost.querySelector<HTMLButtonElement>('button[data-section-id="models"]')
      if (!groupedButton) throw new Error('expected model group button')
      await click(groupedButton)
      expect(mounted.actionHost.querySelector('[role="status"]')?.textContent).toContain('未找到原生设置项')
      const first = addNativeNavButton(mounted.nav, '模型')
      const second = addNativeNavButton(mounted.nav, '模型')
      await click(groupedButton)
      expect(mounted.actionHost.querySelector('[role="status"]')?.textContent).toContain('多个匹配项')
      expect(first.isConnected).toBe(true)
      expect(second.isConnected).toBe(true)
      mounted.dialog.remove()
      await click(groupedButton)
      expect(mounted.actionHost.querySelector('[role="status"]')?.textContent).toContain('不在当前设置窗口')
    } finally {
      await mounted.cleanup()
    }
  })

  it('reports save failures without pretending that mode changed', async () => {
    const fixture = createFixture()
    fixture.section('models', () => '模型')
    fixture.preference.setEnabled.mockRejectedValueOnce(new Error('disk unavailable'))
    const mounted = await renderAction(fixture, [{ label: '模型' }])
    try {
      await click(actionTrigger(mounted.actionHost))
      expect(actionTrigger(mounted.actionHost).textContent).toBe('分类导航')
      expect(mounted.actionHost.querySelector('[role="status"]')?.textContent).toContain('disk unavailable')
      expect(mounted.native[0]?.isConnected).toBe(true)
    } finally { await mounted.cleanup() }
  })

  it('Escape only collapses choices; saved mode survives remount and cancels explicitly', async () => {
    const fixture = createFixture()
    fixture.section('models', () => '模型', 10)
    const mounted = await renderAction(fixture, [{ label: '模型' }])
    try {
      const trigger = actionTrigger(mounted.actionHost)
      await click(trigger)
      await openCategory(mounted.actionHost)
      const region = mounted.actionHost.querySelector<HTMLElement>('[role="region"]')
      expect(region).not.toBeNull()
      expect(document.activeElement).toBe(region)
      await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(mounted.actionHost.querySelector('[role="region"]')).toBeNull()
      expect(document.activeElement).toBe(mounted.actionHost.querySelector('button[data-navigation-category="models-and-accounts"]'))
      expect(trigger.textContent).toBe('取消分类导航')
      await act(async () => { mounted.root.render(null) })
      const Action = fixture.core.entries('settings.action')[0]!.component as ComponentType
      await act(async () => { mounted.root.render(createElement(Action)) })
      expect(actionTrigger(mounted.actionHost).textContent).toBe('取消分类导航')
      await click(actionTrigger(mounted.actionHost))
      expect(fixture.preference.snapshot().settings.settingsNavigation).toBe(false)
      expect(mounted.dialog.isConnected).toBe(true)
      expect(fixture.locale.count).toBe(1)
    } finally {
      await act(async () => { mounted.root.unmount() })
      expect(fixture.locale.count).toBe(0)
      fixture.dispose()
      expect(fixture.core.entries('settings.action')).toHaveLength(0)
      mounted.dialog.remove()
      mounted.launcher.remove()
    }
  })
})

describe('native target validation', () => {
  it('rejects a stale or disconnected action root without clicking any native button', () => {
    const root = document.createElement('div')
    const result = activateNativeSettingsSection({ root, label: '模型' })
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('不在当前设置窗口')
  })
})
