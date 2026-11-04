import type { ExperienceSettings } from './contracts.js'
import { activateNativeSettingsSection, groupForSettingsSection, normalizeSettingsLabel, type NativeSettingsNavigationResult, type SettingsNavigationGroupId, type SettingsSectionRow } from './settings-navigation.js'
import { buildSettingsNavigationCss } from './settings-navigation-style.js'

export interface NativeSettingsLayout {
  dialog: HTMLElement
  nav: HTMLElement
  list: HTMLElement
  options: HTMLElement
  buttons: readonly HTMLButtonElement[]
  rows: readonly { section: SettingsSectionRow, button: HTMLButtonElement, position: number }[]
  activeId?: string
}
export type SettingsLayoutInspection = { ok: true, value: NativeSettingsLayout } | { ok: false, message: string }

/** rc.2 layout contract: original shell, nodes and handlers remain owned by DSH. */
export function inspectSettingsLayout(root: HTMLElement | null, sections: readonly SettingsSectionRow[]): SettingsLayoutInspection {
  const fail = (message: string): SettingsLayoutInspection => ({ ok: false, message })
  const dialog = root?.closest<HTMLElement>('[role="dialog"][data-shortcut-modal="settings"]')
  if (!root?.isConnected || !dialog?.isConnected) return fail('未找到当前设置窗口，已保留原始导航。')
  const navs = [...dialog.children].filter(element => element.tagName === 'NAV') as HTMLElement[]
  if (navs.length !== 1) return fail('设置窗口结构与已验证版本不同，已恢复原始导航。')
  const nav = navs[0]!
  const content = nav.nextElementSibling
  if (nav.children.length !== 2 || !content || content.tagName !== 'DIV' || content.children.length !== 2) return fail('设置窗口结构与已验证版本不同，已恢复原始导航。')
  const [title, list] = [...nav.children]
  const [header, options] = [...content.children]
  if (title?.tagName !== 'DIV' || list?.tagName !== 'DIV' || header?.tagName !== 'DIV' || options?.tagName !== 'DIV' || header.children.length !== 2 || header.children[0]?.tagName !== 'DIV' || header.children[1]?.tagName !== 'BUTTON' || !header.contains(root)) return fail('设置窗口结构与已验证版本不同，已恢复原始导航。')
  if ([...list.children].some(element => element.tagName !== 'BUTTON')) return fail('原设置导航结构已变化，已恢复原始导航。')
  const buttons = [...list.children] as HTMLButtonElement[]
  if (buttons.length !== sections.length || new Set(sections.map(row => row.id)).size !== sections.length || sections.some(row => !row.id || !row.targetLabel)) return fail('设置目录尚未与原窗口对应，已恢复原始导航。')
  const matches = sections.map(section => ({ section, matches: buttons.filter(button => [button.textContent, button.getAttribute('aria-label')].some(value => normalizeSettingsLabel(value) === section.targetLabel)) }))
  if (matches.some(row => row.matches.length !== 1) || new Set(matches.map(row => row.matches[0])).size !== buttons.length) return fail('设置项标签缺失或重复，已恢复原始导航。')
  const rows = matches.map(({ section, matches }) => ({ section, button: matches[0]!, position: buttons.indexOf(matches[0]!) + 1 }))
  const selected = rows.filter(row => ['true', 'page'].includes(row.button.getAttribute('aria-current') ?? ''))
  if (selected.length !== 1 && rows.length > 0) return fail('无法确认当前设置页，已恢复原始导航。')
  return { ok: true, value: { dialog, nav, list: list as HTMLElement, options: options as HTMLElement, buttons, rows, ...(selected[0] ? { activeId: selected[0].section.id } : {}) } }
}

export interface SettingsLayoutSnapshot {
  mount?: HTMLElement
  activeId?: string
  activeGroup?: SettingsNavigationGroupId
  error?: string
}
let occurrence = 0

/** Owns only its portal mount, stylesheet and observers. No host node is moved or rewritten. */
export class SettingsLayoutController {
  private sections: readonly SettingsSectionRow[]
  private settings?: Pick<ExperienceSettings, 'appearance' | 'theme'>
  private readonly listeners = new Set<() => void>()
  private readonly remembered = new Map<SettingsNavigationGroupId, string>()
  private value: SettingsLayoutSnapshot = {}
  private layout?: NativeSettingsLayout
  private style?: HTMLStyleElement
  private mount?: HTMLDivElement
  private observer?: MutationObserver
  private stopped = false
  private queued = false
  private readonly token = `solar-settings-tabs-${++occurrence}`
  constructor(private readonly root: HTMLElement, sections: readonly SettingsSectionRow[], settings?: Pick<ExperienceSettings, 'appearance' | 'theme'>) {
    this.sections = sections
    this.settings = settings
    try { this.reconcile() } catch (error) { this.dispose(); throw error }
    const dialog = root.closest('[role="dialog"]')
    const Observer = root.ownerDocument.defaultView?.MutationObserver
    if (dialog && Observer) {
      this.observer = new Observer(records => {
        if (records.some(record => {
          if (this.mount?.contains(record.target)) return false
          if (record.target === dialog) return [...record.addedNodes, ...record.removedNodes].some(node => node !== this.mount && !(node instanceof Element && node.hasAttribute('data-solar-settings-categories')))
          return this.layout?.nav.contains(record.target) ?? true
        })) this.schedule()
      })
      this.observer.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'disabled', 'hidden', 'aria-hidden', 'aria-label'] })
    }
  }
  snapshot = (): SettingsLayoutSnapshot => this.value
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(next: SettingsLayoutSnapshot) {
    if (this.value.mount === next.mount && this.value.activeId === next.activeId && this.value.activeGroup === next.activeGroup && this.value.error === next.error) return
    this.value = next
    this.listeners.forEach(listener => listener())
  }
  private schedule() {
    if (this.queued || this.stopped) return
    this.queued = true
    queueMicrotask(() => { this.queued = false; if (!this.stopped) this.reconcile() })
  }
  updateSections(sections: readonly SettingsSectionRow[]) { this.sections = sections; this.reconcile() }
  updateAppearance(settings?: Pick<ExperienceSettings, 'appearance' | 'theme'>) { this.settings = settings; if (this.layout) this.writeStyle(this.value.activeGroup) }
  private writeStyle(group?: SettingsNavigationGroupId) {
    if (!this.layout || !this.style || !this.mount) return
    const hidden = this.layout.rows.filter(row => group && groupForSettingsSection(row.section.id) !== group).map(row => row.position)
    const scope = `[role="dialog"][data-shortcut-modal="settings"]:has(> [data-solar-settings-categories="${this.token}"])`
    this.style.textContent = buildSettingsNavigationCss(scope, hidden, this.settings)
    this.style.disabled = false
  }
  private reconcile() {
    if (this.stopped) return
    // Invalidate the old positional mapping before inspecting the new native directory.
    if (this.style) this.style.disabled = true
    const result = inspectSettingsLayout(this.root, this.sections)
    if (!result.ok) {
      if (this.mount?.contains(this.root.ownerDocument.activeElement)) {
        const active = this.layout?.rows.find(row => row.section.id === this.value.activeId)?.button
        if (active?.isConnected && !active.disabled) active.focus({ preventScroll: true })
        else this.root.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
      }
      this.mount?.remove()
      this.layout = undefined
      this.publish({ error: result.message })
      return
    }
    this.layout = result.value
    const document = this.root.ownerDocument
    if (!this.style) { this.style = document.createElement('style'); this.style.setAttribute('data-solar-settings-layout', this.token); document.head.append(this.style) }
    if (!this.mount) { this.mount = document.createElement('div'); this.mount.setAttribute('data-solar-settings-categories', this.token); }
    if (!this.mount.isConnected) this.layout.dialog.insertBefore(this.mount, this.layout.nav)
    const active = this.sections.find(row => row.id === this.layout?.activeId)
    const activeGroup = active ? groupForSettingsSection(active.id) : undefined
    if (active && activeGroup) this.remembered.set(activeGroup, active.id)
    this.writeStyle(activeGroup)
    this.publish({ mount: this.mount, ...(active ? { activeId: active.id, activeGroup } : {}) })
  }
  selectGroup(group: SettingsNavigationGroupId): NativeSettingsNavigationResult {
    this.reconcile()
    if (!this.layout) return { ok: false, message: this.value.error ?? '分类布局不可用，请使用原始导航。' }
    const candidates = this.layout.rows.filter(row => groupForSettingsSection(row.section.id) === group)
    const destination = candidates.find(row => row.section.id === this.remembered.get(group)) ?? candidates[0]
    if (!destination) return { ok: false, message: '该分类当前没有可用的设置项。' }
    const previous = this.value.activeGroup
    this.writeStyle(group)
    const result = activateNativeSettingsSection({ root: this.root, label: destination.section.targetLabel, focus: false, target: destination.button })
    if (!result.ok) this.writeStyle(previous)
    this.schedule()
    return result
  }
  dispose() {
    if (this.stopped) return
    this.stopped = true
    this.observer?.disconnect()
    this.style?.remove()
    if (this.mount?.contains(this.root.ownerDocument.activeElement)) {
      const active = this.layout?.rows.find(row => row.section.id === this.value.activeId)?.button
      if (active?.isConnected && !active.disabled) active.focus({ preventScroll: true })
    }
    this.mount?.remove()
    this.listeners.clear()
  }
}
