// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { openOriginalSettingsSection } from '../src/settings-navigation-layout.js'
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
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('data-shortcut-modal', 'settings')
  const nav = document.createElement('nav'), title = document.createElement('div'), list = document.createElement('div')
  title.textContent = '设置'
  const native = labels.map(({ label, listener }, index) => {
    const button = addNativeNavButton(list, label, listener)
    if (index === 0) button.setAttribute('aria-current', 'true')
    button.addEventListener('click', () => { native.forEach(row => row.removeAttribute('aria-current')); button.setAttribute('aria-current', 'true') })
    return button
  })
  nav.append(title, list)
  const content = document.createElement('div'), header = document.createElement('div'), actions = document.createElement('div'), options = document.createElement('div'), close = document.createElement('button')
  close.textContent = '关闭'
  const field = document.createElement('input');field.setAttribute('aria-label', '原设置字段');options.append(field)
  const actionHost = document.createElement('div');actions.append(actionHost);header.append(actions, close);content.append(header, options);dialog.append(nav, content)
  document.body.append(launcher, dialog)
  const root = createRoot(actionHost)
  await act(async () => { root.render(createElement(Action)) })
  return { dialog, launcher, nav, list, native, root, actionHost, field, Action,
    async cleanup() { await act(async () => { root.unmount() }); fixture.dispose(); dialog.remove(); launcher.remove() },
  }
}
async function click(element: HTMLElement) { await act(async () => { element.click(); await Promise.resolve() }) }
function actionTrigger(host: HTMLElement): HTMLButtonElement { const b=host.querySelector<HTMLButtonElement>('button');if(!b)throw new Error('expected navigation trigger');return b }
function category(dialog: HTMLElement,id: string) { const b=dialog.querySelector<HTMLButtonElement>(`[data-navigation-category="${id}"]`);if(!b)throw new Error('Missing category '+id);return b }

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
    expect(groupForSettingsSection('constructor')).toBe('other')
    expect(groupForSettingsSection('toString')).toBe('other')
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

describe('tabbed settings navigation action', () => {
  it('uses original handlers, keeps all nodes and mode, and restores the original shell on cancellation', async () => {
    const fixture = createFixture()
    fixture.section('models', '模型');fixture.section('dream-skin', 'Theme / 外观')
    const called = vi.fn()
    const mounted = await renderAction(fixture, [{ label: '模型' }, { label: 'Theme / 外观', listener: called }])
    try {
      const original = mounted.nav.outerHTML, launcher = mounted.launcher.outerHTML
      await click(actionTrigger(mounted.actionHost))
      expect(category(mounted.dialog,'models-and-accounts').getAttribute('aria-pressed')).toBe('true')
      await click(category(mounted.dialog,'appearance-and-display'))
      expect(called).toHaveBeenCalledOnce()
      expect(category(mounted.dialog,'appearance-and-display').getAttribute('aria-pressed')).toBe('true')
      expect(mounted.native.every(button=>button.isConnected)).toBe(true)
      expect(mounted.nav.querySelectorAll('button')).toHaveLength(2)
      expect(mounted.dialog.querySelectorAll('select')).toHaveLength(0)
      expect(actionTrigger(mounted.actionHost).textContent).toBe('取消分类导航')
      expect(fixture.preference.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
      expect(mounted.launcher.outerHTML).toBe(launcher)
      await click(actionTrigger(mounted.actionHost))
      expect(mounted.dialog.querySelector('[data-solar-settings-categories]')).toBeNull()
      expect(document.querySelector('style[data-solar-settings-layout]')).toBeNull()
      expect(mounted.nav.outerHTML.replace(/ aria-current="true"/g,'')).toBe(original.replace(/ aria-current="true"/g,''))
    } finally { await mounted.cleanup() }
  })

  it('refreshes locale, follows original navigation and preserves the focused original form across settings polling', async () => {
    const fixture=createFixture();let label='模型';fixture.section('models',()=>label);fixture.section('dream-skin','Theme / 外观')
    const mounted=await renderAction(fixture,[{label:'模型'},{label:'Theme / 外观'}])
    try {
      await click(actionTrigger(mounted.actionHost));await click(mounted.native[1]!)
      expect(category(mounted.dialog,'appearance-and-display').getAttribute('aria-pressed')).toBe('true')
      mounted.field.focus()
      await act(async()=>{fixture.locale.emit();await Promise.resolve()})
      expect(document.activeElement).toBe(mounted.field)
      label='Models'
      await act(async()=>{mounted.native[0]!.textContent=label;fixture.locale.emit();await Promise.resolve()})
      await click(category(mounted.dialog,'models-and-accounts'))
      expect(mounted.native[0]!.getAttribute('aria-current')).toBe('true')
      expect(mounted.native[0]!.textContent).toBe('Models')
    }finally{await mounted.cleanup()}
  })

  it('puts future pages in Other and removes stale positional maps before returning to the original navigation on mismatch', async()=>{
    const fixture=createFixture();fixture.section('models','模型')
    const mounted=await renderAction(fixture,[{label:'模型'}])
    try{
      await click(actionTrigger(mounted.actionHost))
      await act(async()=>{fixture.section('future-page','未来功能');addNativeNavButton(mounted.list,'未来功能');await Promise.resolve()})
      expect(category(mounted.dialog,'other')).not.toBeNull()
      const original=mounted.nav
      await act(async()=>{addNativeNavButton(mounted.list,'重复多余项');await Promise.resolve();await Promise.resolve()})
      expect(mounted.dialog.querySelector('[data-solar-settings-categories]')).toBeNull()
      expect(mounted.actionHost.querySelector('[role=status]')?.textContent).toContain('原始导航')
      expect((document.querySelector('style[data-solar-settings-layout]') as HTMLStyleElement).disabled).toBe(true)
      expect(mounted.nav).toBe(original)
      expect(mounted.nav.querySelectorAll('button')).toHaveLength(3)
    }finally{await mounted.cleanup()}
  })

  it('rejects disabled native destinations and ambiguous labels without replacing any original node', async()=>{
    const fixture=createFixture();fixture.section('models','模型');fixture.section('dream-skin','Theme / 外观')
    const mounted=await renderAction(fixture,[{label:'模型'},{label:'Theme / 外观'}])
    try{
      await click(actionTrigger(mounted.actionHost));mounted.native[1]!.disabled=true
      await click(category(mounted.dialog,'appearance-and-display'))
      expect(mounted.actionHost.querySelector('[role=status]')?.textContent).toContain('原生设置项')
      expect(mounted.native[0]!.getAttribute('aria-current')).toBe('true')
      await act(async()=>{mounted.native[1]!.textContent='模型';await Promise.resolve()})
      expect(mounted.dialog.querySelector('[data-solar-settings-categories]')).toBeNull()
      expect(mounted.actionHost.querySelector('[role=status]')?.textContent).toContain('重复')
      expect(mounted.native.every(x=>x.isConnected)).toBe(true)
    }finally{await mounted.cleanup()}
  })

  it('never activates a same-labelled button in a settings page when the original destination is disabled',async()=>{
    const fixture=createFixture();fixture.section('models','模型');fixture.section('dream-skin','Theme / 外观');const mounted=await renderAction(fixture,[{label:'模型'},{label:'Theme / 外观'}]);const foreignClick=vi.fn()
    try{
      const pageNav=document.createElement('nav');addNativeNavButton(pageNav,'Theme / 外观',foreignClick);mounted.field.parentElement!.append(pageNav)
      await click(actionTrigger(mounted.actionHost));mounted.native[1]!.disabled=true
      await click(category(mounted.dialog,'appearance-and-display'))
      expect(foreignClick).not.toHaveBeenCalled()
      expect(mounted.native[0]!.getAttribute('aria-current')).toBe('true')
      expect(mounted.actionHost.querySelector('[role=status]')?.textContent).toContain('原生设置项')
    }finally{await mounted.cleanup()}
  })

  it('keeps category focus on keyboard navigation and does not disturb a native field when preferences refresh',async()=>{
    const fixture=createFixture();fixture.section('models','模型');fixture.section('dream-skin','Theme / 外观');const mounted=await renderAction(fixture,[{label:'模型'},{label:'Theme / 外观'}])
    try{
      await click(actionTrigger(mounted.actionHost));category(mounted.dialog,'models-and-accounts').focus()
      await act(async()=>{category(mounted.dialog,'models-and-accounts').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await Promise.resolve()})
      expect(document.activeElement).toBe(category(mounted.dialog,'appearance-and-display'))
      expect(mounted.native[1]!.getAttribute('aria-current')).toBe('true')
      mounted.field.focus();mounted.field.value='unsaved native draft'
      await act(async()=>{await fixture.preference.setEnabled(true)})
      expect(document.activeElement).toBe(mounted.field)
      expect(mounted.field.value).toBe('unsaved native draft')
      const mount=mounted.dialog.querySelector('[data-solar-settings-categories]')!
      expect([...mounted.dialog.children].indexOf(mount)).toBeLessThan([...mounted.dialog.children].indexOf(mounted.nav))
    }finally{await mounted.cleanup()}
  })

  it('preserves saved mode across remount and disposes its portal, style and subscriptions on unload',async()=>{
    const fixture=createFixture();fixture.section('models','模型');const mounted=await renderAction(fixture,[{label:'模型'}])
    try{
      await click(actionTrigger(mounted.actionHost))
      await act(async()=>{mounted.root.render(null)})
      expect(document.querySelector('[data-solar-settings-categories]')).toBeNull()
      expect(document.querySelector('style[data-solar-settings-layout]')).toBeNull()
      await act(async()=>{mounted.root.render(createElement(mounted.Action))})
      expect(actionTrigger(mounted.actionHost).textContent).toBe('取消分类导航')
      expect(category(mounted.dialog,'models-and-accounts')).not.toBeNull()
      expect(fixture.registrations.filter(name=>name==='sidebar.settings')).toHaveLength(0)
    }finally{await mounted.cleanup()}
    expect(fixture.locale.count).toBe(0)
  })

  it('reports save failures without pretending that mode changed',async()=>{
    const fixture=createFixture();fixture.section('models','模型');fixture.preference.setEnabled.mockRejectedValueOnce(new Error('disk unavailable'))
    const mounted=await renderAction(fixture,[{label:'模型'}])
    try{await click(actionTrigger(mounted.actionHost));expect(actionTrigger(mounted.actionHost).textContent).toBe('分类导航');expect(mounted.actionHost.querySelector('[role=status]')?.textContent).toContain('disk unavailable')}finally{await mounted.cleanup()}
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


describe('model center original settings path', () => {
 it('keeps native owner actions reachable and returns to the consolidated entry without changing the saved mode', async () => {
  const fixture=createFixture()
  fixture.section('solar-model-center','模型中心',-100)
  fixture.section('models','模型',0)
  fixture.section('cost-meter','费用',10)
  fixture.section('general','通用设置',20)
  const models=vi.fn()
  const view=await renderAction(fixture,[{label:'模型中心'},{label:'模型',listener:models},{label:'费用'},{label:'通用设置'}])
  await click(actionTrigger(view.actionHost))
  expect(document.querySelector('style[data-solar-settings-layout]')?.textContent).toContain('button:nth-child(2){display:none;}')
  await act(async()=>{expect(openOriginalSettingsSection(view.actionHost,'models')).toEqual({ok:true});await Promise.resolve()})
  expect(models).toHaveBeenCalledOnce()
  expect(fixture.preference.snapshot().settings.settingsNavigation).toBe(true)
  expect(view.native[1]?.getAttribute('aria-current')).toBe('true')
  await click(view.native[0]!)
  expect(document.querySelector('style[data-solar-settings-layout]')?.textContent).toContain('button:nth-child(2){display:none;}')
  expect(view.native.every(row=>row.parentElement===view.list)).toBe(true)
  await view.cleanup()
  expect(openOriginalSettingsSection(view.actionHost,'models')).toBeUndefined()
 })
})
