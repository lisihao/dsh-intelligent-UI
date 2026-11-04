import { createElement as h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { settingsNavigationControlCss } from './settings-navigation-style.js'
import { SettingsLayoutController, type SettingsLayoutSnapshot } from './settings-navigation-layout.js'
import type { ExperienceSettings } from './contracts.js'
import type { Context } from '@deepseek-ai/cordis'
import { resolveSlotLabel, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

export const SETTINGS_NAVIGATION_ACTION_ID = 'solar-grouped-settings-navigation'

export type SettingsNavigationGroupId = 'models-and-accounts' | 'appearance-and-display' | 'solar-and-workflows' | 'plugins' | 'other'

export interface SettingsSectionRow {
  readonly id: string
  /** The current resolved human label. It is never derived from an id. */
  readonly label: string
  /** The normalized native-nav label required for safe activation. */
  readonly targetLabel?: string
  readonly order: number
  readonly index: number
}

export interface SettingsNavigationGroup {
  readonly id: SettingsNavigationGroupId
  readonly label: string
  readonly sections: readonly SettingsSectionRow[]
}

const navigationGroups: ReadonlyArray<Pick<SettingsNavigationGroup, 'id' | 'label'>> = [
  { id: 'models-and-accounts', label: '模型与账号' },
  { id: 'appearance-and-display', label: '界面与显示' },
  { id: 'solar-and-workflows', label: 'Solar 与工作流' },
  { id: 'plugins', label: '插件管理' },
  { id: 'other', label: '其他' },
]

/*
 * Only source- or runtime-confirmed ids belong here. Future and unverified
 * ids intentionally fall through to Other instead of being guessed from a
 * localized label.
 */
const groupByConfirmedId: Readonly<Record<string, SettingsNavigationGroupId>> = {
  account: 'models-and-accounts',
  'cost-meter': 'models-and-accounts',
  'cost-meter-usage': 'models-and-accounts',
  general: 'appearance-and-display',
  models: 'models-and-accounts',
  'model-subscriptions': 'models-and-accounts',
  'dsh-imagegen': 'models-and-accounts',
  'agent-presets': 'models-and-accounts',
  'agent-persona': 'models-and-accounts',
  'deepseek-web-login': 'models-and-accounts',
  'solar-model-radar': 'models-and-accounts',
  'grok-subscription': 'models-and-accounts',
  'codex-subscription': 'models-and-accounts',
  'dream-skin': 'appearance-and-display',
  'solar-intelligent-experience': 'appearance-and-display',
  'session-prefix': 'appearance-and-display',
  bili: 'solar-and-workflows',
  'solar-chatgpt-web': 'solar-and-workflows',
  'solar-native-collaboration': 'solar-and-workflows',
  'solar-quant-research': 'solar-and-workflows',
  'solar-rlm': 'solar-and-workflows',
  plugins: 'plugins',
  market: 'plugins',
}

type SettingsSlots = {
  entries(name: string): readonly StoredEntry[]
  subscribe(name: string, listener: () => void): () => void
  inject(name: 'settings.action', register: () => () => void): () => void
  register(options: { name: 'settings.action', id: string, order?: number }, component: () => ReactElement): () => void
}

type LocaleObserver = {
  subscribe(listener: () => void): () => void
}

export interface SettingsSectionSource {
  getSnapshot(): readonly SettingsSectionRow[]
  subscribe(listener: () => void): () => void
}

export interface NativeSettingsNavigationResult {
  readonly ok: boolean
  readonly message?: string
}

export function normalizeSettingsLabel(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim()
}

export function groupForSettingsSection(id: string): SettingsNavigationGroupId {
  return Object.hasOwn(groupByConfirmedId, id) ? groupByConfirmedId[id]! : 'other'
}

/** Resolves the public metadata the Settings shell itself uses, then preserves its sorted order. */
export function readSettingsSections(entries: readonly StoredEntry[]): readonly SettingsSectionRow[] {
  return entries.map((entry, index) => {
    const resolved = resolveSlotLabel(entry.options.label)
    const targetLabel = normalizeSettingsLabel(resolved)
    const order = entry.options.order
    return {
      id: entry.options.id ?? '',
      label: targetLabel || '未命名设置项',
      ...(targetLabel ? { targetLabel } : {}),
      order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
      index,
    }
  }).sort((left, right) => left.order - right.order || left.index - right.index)
}

export function groupSettingsSections(sections: readonly SettingsSectionRow[]): readonly SettingsNavigationGroup[] {
  return navigationGroups.map(group => ({
    ...group,
    sections: sections.filter(section => groupForSettingsSection(section.id) === group.id),
  })).filter(group => group.sections.length > 0)
}

export function createSettingsSectionSource(slots: Pick<SettingsSlots, 'entries' | 'subscribe'>, locale: LocaleObserver): SettingsSectionSource {
  let snapshot = readSettingsSections(slots.entries('settings.section'))
  const refresh = (): boolean => {
    const next = readSettingsSections(slots.entries('settings.section'))
    const changed = next.length !== snapshot.length || next.some((section, index) => {
      const previous = snapshot[index]
      return previous?.id !== section.id || previous.label !== section.label || previous.targetLabel !== section.targetLabel || previous.order !== section.order || previous.index !== section.index
    })
    if (changed) snapshot = next
    return changed
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      const notify = () => { if (refresh()) listener() }
      const removeSlots = slots.subscribe('settings.section', notify)
      let removeLocale: (() => void) | undefined
      try {
        removeLocale = locale.subscribe(notify)
      } catch (error) {
        removeSlots()
        throw error
      }
      notify()
      return () => {
        removeLocale?.()
        removeSlots()
      }
    },
  }
}

function accessibleButtonName(button: HTMLButtonElement): string {
  const labelledBy = button.getAttribute('aria-labelledby')
  if (labelledBy) {
    const label = labelledBy.split(/\s+/u)
      .map(id => button.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (normalizeSettingsLabel(label)) return label
  }
  return button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent ?? ''
}

function isVisibleNativeButton(button: HTMLButtonElement, dialog: HTMLElement): boolean {
  if (!button.isConnected || button.disabled) return false
  const view = button.ownerDocument.defaultView
  let current: HTMLElement | null = button
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false
    if (view) {
      const style = view.getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden' || style.getPropertyValue('content-visibility') === 'hidden') return false
    }
    if (current === dialog) return true
    current = current.parentElement
  }
  return false
}

function hasExactNativeLabel(button: HTMLButtonElement, label: string): boolean {
  return [button.textContent, accessibleButtonName(button)].some(value => normalizeSettingsLabel(value) === label)
}

/**
 * Only activates a unique, currently visible native Settings navigation button.
 * It does not infer a target from DOM order, ids, styles, or any foreign state.
 */
export function activateNativeSettingsSection(input: { root: HTMLElement | null, label: string | undefined, focus?: boolean, target?: HTMLButtonElement }): NativeSettingsNavigationResult {
  const label = normalizeSettingsLabel(input.label)
  if (!label) return { ok: false, message: '该设置项没有可用的原生标签，未执行跳转。' }
  const root = input.root
  if (!root?.isConnected) return { ok: false, message: `分类导航已不在当前设置窗口中，未打开“${label}”。` }
  const dialog = root.closest<HTMLElement>('[role="dialog"]')
  if (!dialog?.isConnected) return { ok: false, message: `未找到当前设置窗口，未打开“${label}”。` }
  const nativeNav = [...dialog.children].find(element => element.tagName === 'NAV')
  const nativeList = nativeNav?.lastElementChild
  const buttons = [...(nativeList?.children ?? [])].filter(element => element.tagName === 'BUTTON') as HTMLButtonElement[]
  const matches = buttons.filter(button => (!input.target || button === input.target) && isVisibleNativeButton(button, dialog) && hasExactNativeLabel(button, label))
  if (matches.length === 0) return { ok: false, message: `未找到原生设置项“${label}”。请直接使用左侧原始导航。` }
  if (matches.length !== 1) return { ok: false, message: `原生设置项“${label}”有多个匹配项，未执行跳转。请直接使用左侧原始导航。` }
  const target = matches[0]!
  try {
    target.click()
    if (input.focus !== false) { try { target.focus({ preventScroll: true }) } catch { target.focus() } }
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `无法打开原生设置项“${label}”：${detail}` }
  }
}

export interface SettingsNavigationPreference {
  snapshot(): { settings?: Pick<ExperienceSettings, 'settingsNavigation' | 'appearance' | 'theme'>, error?: string }
  subscribe(listener: () => void): () => void
  setEnabled(enabled: boolean): Promise<void>
}

function categoryIcon(group: SettingsNavigationGroupId): ReactElement {
  const paths: Record<SettingsNavigationGroupId, string> = {
    'models-and-accounts': 'M4 4h12v12H4z M8 4v12 M4 8h12',
    'appearance-and-display': 'M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M7 17h6 M10 14v3',
    'solar-and-workflows': 'M4 3h4v4H4z M12 8h4v4h-4z M4 13h4v4H4z M8 5h1a3 3 0 0 1 3 3v2 M8 15h1a3 3 0 0 0 3-3v-2',
    plugins: 'M7 3v4 M13 3v4 M5 7h10v3a5 5 0 0 1-5 5v3 M5 7V5h10v2',
    other: 'M4 5h12 M4 10h12 M4 15h12',
  }
  return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: paths[group] }))
}

function SettingsNavigationAction({ source, preference }: { source: SettingsSectionSource, preference: SettingsNavigationPreference }): ReactElement {
  const sections = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const saved = useSyncExternalStore(preference.subscribe, preference.snapshot, preference.snapshot)
  const enabled = saved.settings?.settingsNavigation ?? false
  const groups = groupSettingsSections(sections)
  const root = useRef<HTMLDivElement>(null)
  const controller = useRef<SettingsLayoutController>()
  const [layout, setLayout] = useState<SettingsLayoutSnapshot>({})
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useLayoutEffect(() => {
    if (!enabled || !root.current) { setLayout({}); return }
    const current = new SettingsLayoutController(root.current, source.getSnapshot(), preference.snapshot().settings)
    controller.current = current
    const remove = current.subscribe(() => setLayout(current.snapshot()))
    setLayout(current.snapshot())
    return () => { remove(); current.dispose(); if (controller.current === current) controller.current = undefined }
  }, [enabled, source, preference])
  useLayoutEffect(() => { controller.current?.updateSections(sections) }, [sections])
  useLayoutEffect(() => { controller.current?.updateAppearance(saved.settings) }, [saved.settings])
  const toggle = async () => {
    setBusy(true)
    setStatus('')
    try { await preference.setEnabled(!enabled) }
    catch (error) { setStatus(`无法保存分类导航模式：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  const choose = (group: SettingsNavigationGroupId) => {
    const result = controller.current?.selectGroup(group)
    setStatus(result && !result.ok ? result.message ?? '无法打开该设置分类。' : '')
  }
  useEffect(() => { if (!layout.error) setStatus('') }, [layout.activeId, layout.activeGroup, layout.error])
  const message = layout.error || status || saved.error
  return h('div', { ref: root, className: 'solar-settings-navigation-control', 'data-solar-settings-navigation': '', style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
    h('style', { 'data-solar-settings-control': '' }, settingsNavigationControlCss),
    h('button', { type: 'button', className: 'solar-settings-navigation-trigger', disabled: busy || !saved.settings, 'aria-pressed': enabled, onClick: () => { void toggle() },
      style: { minHeight: layout.mount ? 36 : 26, padding: '2px 8px', border: layout.mount ? '0' : '1px solid var(--dsw-alias-border-l2, currentColor)', borderRadius: layout.mount ? 10 : 6, color: 'inherit', background: 'transparent', font: 'inherit', cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' },
    }, busy ? '正在保存…' : enabled ? '取消分类导航' : '分类导航'),
    message && h('span', { role: 'status', title: message, className: 'solar-settings-navigation-error', style: { fontSize: 12 } }, message),
    enabled && layout.mount && createPortal(h('nav', { 'aria-label': '设置分类', className: 'solar-settings-categories' },
      ...groups.map(group => h('button', {
        key: group.id, type: 'button', className: 'solar-settings-category', 'data-navigation-category': group.id,
        'aria-pressed': layout.activeGroup === group.id,
        onClick: () => choose(group.id),
        onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          const index = groups.findIndex(candidate => candidate.id === group.id)
          const next = event.key === 'ArrowRight' ? (index + 1) % groups.length : event.key === 'ArrowLeft' ? (index - 1 + groups.length) % groups.length : event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : undefined
          if (next === undefined) return
          event.preventDefault()
          const destination = groups[next]!
          choose(destination.id)
          layout.mount?.querySelector<HTMLButtonElement>(`button[data-navigation-category="${destination.id}"]`)?.focus()
        },
      }, categoryIcon(group.id), h('span', null, group.label)))), layout.mount),
  )
}

/** Installs the owned action and reversible layout while retaining native page ownership. */
export function installSettingsNavigation(ctx: Context, preference: SettingsNavigationPreference): void {
  const slots = (ctx as unknown as { slots?: SettingsSlots }).slots
  const locale = (ctx as unknown as { locale?: LocaleObserver }).locale
  if (!slots?.entries || !slots.subscribe || !slots.inject || !slots.register) throw new Error('分类导航需要公开 slots 服务。')
  if (!locale?.subscribe) throw new Error('分类导航需要公开 locale 服务。')
  const source = createSettingsSectionSource(slots, locale)
  const Action = () => h(SettingsNavigationAction, { source, preference })
  ctx.effect(() => slots.inject('settings.action', () => slots.register({ name: 'settings.action', id: SETTINGS_NAVIGATION_ACTION_ID, order: 100 }, Action)), 'intelligent-experience: grouped settings navigation')
}
