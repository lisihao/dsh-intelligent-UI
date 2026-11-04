import { createElement as h, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react'
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
  return groupByConfirmedId[id] ?? 'other'
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
export function activateNativeSettingsSection(input: { root: HTMLElement | null, label: string | undefined }): NativeSettingsNavigationResult {
  const label = normalizeSettingsLabel(input.label)
  if (!label) return { ok: false, message: '该设置项没有可用的原生标签，未执行跳转。' }
  const root = input.root
  if (!root?.isConnected) return { ok: false, message: `分类导航已不在当前设置窗口中，未打开“${label}”。` }
  const dialog = root.closest<HTMLElement>('[role="dialog"]')
  if (!dialog?.isConnected) return { ok: false, message: `未找到当前设置窗口，未打开“${label}”。` }
  const matches = [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
    .filter(button => !root.contains(button) && isVisibleNativeButton(button, dialog) && hasExactNativeLabel(button, label))
  if (matches.length === 0) return { ok: false, message: `未找到原生设置项“${label}”。请直接使用左侧原始导航。` }
  if (matches.length !== 1) return { ok: false, message: `原生设置项“${label}”有多个匹配项，未执行跳转。请直接使用左侧原始导航。` }
  const target = matches[0]!
  try {
    target.click()
    try { target.focus({ preventScroll: true }) } catch { target.focus() }
    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `无法打开原生设置项“${label}”：${detail}` }
  }
}

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', display: 'inline-flex', minWidth: 0 },
  trigger: { minHeight: 32, padding: '4px 9px', borderRadius: 'var(--dsw-radius-sm, 6px)', border: '1px solid var(--dsw-alias-border-l2, currentColor)', background: 'var(--dsw-alias-bg-layer-3, ButtonFace)', color: 'var(--dsw-alias-label-primary, ButtonText)', font: 'inherit', cursor: 'pointer' },
  panel: { position: 'absolute', zIndex: 2, top: 'calc(100% + 8px)', right: 0, boxSizing: 'border-box', width: 'min(44rem, calc(100vw - 64px))', maxWidth: 'calc(100vw - 64px)', maxHeight: 'min(75vh, 38rem)', overflowY: 'auto', display: 'grid', gap: 12, padding: 12, border: '1px solid var(--dsw-alias-border-l2, currentColor)', borderRadius: 'var(--dsw-radius-md, 8px)', background: 'var(--dsw-alias-bg-layer-2, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', font: 'inherit' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { margin: 0, fontSize: 14, lineHeight: 1.4, fontWeight: 600 },
  close: { minHeight: 32, padding: '4px 8px', borderRadius: 'var(--dsw-radius-sm, 6px)', border: '1px solid var(--dsw-alias-border-l2, currentColor)', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
  groups: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 },
  group: { minWidth: 0, display: 'grid', alignContent: 'start', gap: 4 },
  groupLabel: { margin: 0, fontSize: 13, lineHeight: 1.4, fontWeight: 600 },
  sectionButton: { minWidth: 0, minHeight: 36, padding: '6px 8px', borderRadius: 'var(--dsw-radius-sm, 6px)', border: '1px solid var(--dsw-alias-border-l2, currentColor)', background: 'var(--dsw-alias-bg-layer-3, ButtonFace)', color: 'inherit', font: 'inherit', textAlign: 'left', overflowWrap: 'anywhere', cursor: 'pointer' },
  status: { margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--dsw-alias-label-secondary, CanvasText)' },
}

function SettingsNavigationAction({ source }: { source: SettingsSectionSource }): ReactElement {
  const sections = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const groups = groupSettingsSections(sections)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const panelId = useId()
  const titleId = `${panelId}-title`
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus && trigger.current?.isConnected) {
      try { trigger.current.focus({ preventScroll: true }) } catch { trigger.current.focus() }
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const document = root.current?.ownerDocument
    if (!document) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [close, open])
  useEffect(() => {
    if (!open || !panel.current) return
    try { panel.current.focus({ preventScroll: true }) } catch { panel.current.focus() }
  }, [open])
  const select = (section: SettingsSectionRow) => {
    const result = activateNativeSettingsSection({ root: root.current, label: section.targetLabel })
    if (result.ok) {
      setStatus('')
      close(false)
    } else {
      setStatus(result.message ?? '无法打开原生设置项。')
    }
  }
  return h('div', { ref: root, className: 'dsh-experience', 'data-solar-settings-navigation': '', style: styles.root },
    h('button', { ref: trigger, type: 'button', style: styles.trigger, 'aria-expanded': open, 'aria-controls': panelId, onClick: () => { setStatus(''); setOpen(value => !value) } }, '分类导航'),
    open && h('section', { ref: panel, id: panelId, role: 'region', tabIndex: -1, 'aria-labelledby': titleId, style: styles.panel },
      h('div', { style: styles.panelHeader }, h('h2', { id: titleId, style: styles.title }, '分类导航'), h('button', { type: 'button', style: styles.close, onClick: () => close(true) }, '关闭')),
      groups.length > 0 ? h('div', { style: styles.groups }, ...groups.map(group => h('section', { key: group.id, 'aria-label': group.label, style: styles.group },
        h('h3', { style: styles.groupLabel }, group.label),
        ...group.sections.map(section => h('button', {
          key: `${section.id}:${section.index}`,
          type: 'button',
          style: styles.sectionButton,
          ...(section.id ? { 'data-section-id': section.id } : {}),
          onClick: () => select(section),
        }, section.label)),
      ))) : h('p', { role: 'status', style: styles.status }, '当前没有可分类的设置项。'),
      status && h('p', { role: 'status', 'aria-live': 'polite', style: styles.status }, status),
    ),
  )
}

/** Adds one compact action to the host-owned Settings panel; all host navigation remains untouched. */
export function installSettingsNavigation(ctx: Context): void {
  const slots = (ctx as unknown as { slots?: SettingsSlots }).slots
  const locale = (ctx as unknown as { locale?: LocaleObserver }).locale
  if (!slots?.entries || !slots.subscribe || !slots.inject || !slots.register) throw new Error('分类导航需要公开 slots 服务。')
  if (!locale?.subscribe) throw new Error('分类导航需要公开 locale 服务。')
  const source = createSettingsSectionSource(slots, locale)
  const Action = () => h(SettingsNavigationAction, { source })
  ctx.effect(() => slots.inject('settings.action', () => slots.register({ name: 'settings.action', id: SETTINGS_NAVIGATION_ACTION_ID, order: 100 }, Action)), 'intelligent-experience: grouped settings navigation')
}
