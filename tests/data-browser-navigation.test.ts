// @vitest-environment jsdom
import { act, createElement as h, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DATA_BROWSER_PANEL_ID, installDataBrowserNavigation } from '../src/data-browser-navigation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Slot = 'main' | 'sidebar.footer.action'
type Registration = { name: Slot; id?: string; key?: string }
type Waiting = { live: boolean; create: () => () => void; cleanup?: () => void }

/** A declaration-aware host: entries are visible only while their slot exists. */
function host(available: Slot[] = ['main', 'sidebar.footer.action'], failFooter = false) {
  const declared = new Set(available), waiting = new Map<Slot, Set<Waiting>>()
  const entries = new Map<string, ComponentType<Record<string, unknown>>>()
  const changes: string[] = [], listeners = new Set<() => void>()
  let snapshot: { activePanelId: string | null } = { activePanelId: null }
  const idOf = (slot: Slot, id: string) => `${slot}:${id}`
  const layout = {
    panelInfo: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) } },
    selectPanel: (id: string | null) => {
      if (id !== null && !entries.has(idOf('main', id))) throw new Error('unknown main panel')
      changes.push(`select:${String(id)}`); snapshot = { activePanelId: id }
      for (const listener of listeners) listener()
    },
  }
  const slots = {
    register: (options: Registration, component: ComponentType<Record<string, unknown>>) => {
      const id = options.key ?? options.id!
      const key = idOf(options.name, id)
      if (failFooter && options.name === 'sidebar.footer.action') throw new Error('footer registration failed')
      if (entries.has(key)) throw new Error(`duplicate ${key}`)
      entries.set(key, component); changes.push(`add:${key}`)
      return () => { entries.delete(key); changes.push(`remove:${key}`) }
    },
    inject: (name: Slot, create: () => () => void) => {
      const item: Waiting = { live: true, create }
      const group = waiting.get(name) ?? new Set<Waiting>()
      group.add(item); waiting.set(name, group)
      if (declared.has(name)) {
        try { item.cleanup = create() } catch (error) { group.delete(item); throw error }
      }
      return () => { if (!item.live) return; item.live = false; group.delete(item); item.cleanup?.() }
    },
  }
  const ctx = {
    slots, layout,
    effect: (run: () => () => void) => {
      const cleanup = run(); let live = true
      return async () => { if (live) { live = false; cleanup() } }
    },
  } as unknown as Context
  return {
    ctx, entries, layout, changes,
    declare: (slot: Slot) => {
      declared.add(slot)
      for (const item of waiting.get(slot) ?? []) if (item.live && !item.cleanup) item.cleanup = item.create()
    },
    addOtherPanel: () => slots.register({ name: 'main', key: 'other' }, () => null),
    entry: (slot: Slot) => entries.get(idOf(slot, DATA_BROWSER_PANEL_ID)),
  }
}

describe('data browser navigation', () => {
  it('waits for the main panel before exposing the single footer entry, then restores the conversation on removal', async () => {
    const fixture = host(['sidebar.footer.action'])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => h('p', null, '数据内容'))
    expect(fixture.entry('main')).toBeUndefined()
    expect(fixture.entry('sidebar.footer.action')).toBeUndefined()
    fixture.declare('main')
    expect(fixture.entry('main')).toBeDefined()
    expect(fixture.entry('sidebar.footer.action')).toBeDefined()
    expect(fixture.changes.slice(0, 2)).toEqual([`add:main:${DATA_BROWSER_PANEL_ID}`, `add:sidebar.footer.action:${DATA_BROWSER_PANEL_ID}`])
    fixture.layout.selectPanel(DATA_BROWSER_PANEL_ID)
    await dispose()
    expect(fixture.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(fixture.entry('main')).toBeUndefined()
    expect(fixture.entry('sidebar.footer.action')).toBeUndefined()
    expect(fixture.changes.slice(-3)).toEqual([`remove:sidebar.footer.action:${DATA_BROWSER_PANEL_ID}`, 'select:null', `remove:main:${DATA_BROWSER_PANEL_ID}`])
  })

  it('leaves an unrelated selected panel and its registration alone', async () => {
    const fixture = host()
    fixture.addOtherPanel()
    const dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    fixture.layout.selectPanel('other')
    await dispose()
    expect(fixture.layout.panelInfo.getSnapshot().activePanelId).toBe('other')
    expect(fixture.entries.has('main:other')).toBe(true)
    expect(fixture.changes.filter(change => change === 'select:null')).toHaveLength(0)
  })

  it('provides a named native button with a selected state in wide and compact sidebar modes', async () => {
    const fixture = host(), dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    const Entry = fixture.entry('sidebar.footer.action')!
    const container = document.createElement('div'), root = createRoot(container)
    document.body.append(container)
    await act(async () => root.render(h(Entry, { wide: true })))
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('数据浏览器')
    expect(button.textContent).toBe('数据浏览器')
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(button.getAttribute('aria-current')).toBeNull()
    button.focus(); expect(document.activeElement).toBe(button)
    await act(async () => button.click())
    expect(fixture.layout.panelInfo.getSnapshot().activePanelId).toBe(DATA_BROWSER_PANEL_ID)
    expect(button.getAttribute('aria-current')).toBe('page')
    await act(async () => root.render(h(Entry, { wide: false })))
    expect(button.getAttribute('aria-label')).toBe('数据浏览器')
    expect(button.getAttribute('title')).toBe('数据浏览器')
    expect(button.textContent).toBe('')
    await act(async () => button.click())
    expect(fixture.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(button.getAttribute('aria-current')).toBeNull()
    await act(async () => root.unmount()); container.remove(); await dispose()
  })

  it('passes main-slot props to the owned content and supports repeated install and cleanup', async () => {
    const fixture = host()
    const Browser = (props: Record<string, unknown>) => h('p', null, String(props.marker))
    const dispose = installDataBrowserNavigation(fixture.ctx, Browser as never)
    const Panel = fixture.entry('main')!
    const container = document.createElement('div'), root = createRoot(container)
    await act(async () => root.render(h(Panel, { marker: '原有内容' })))
    expect(container.querySelector('[aria-label="数据浏览器"]')?.textContent).toBe('原有内容')
    await act(async () => root.unmount()); await dispose(); await dispose()
    const second = installDataBrowserNavigation(fixture.ctx, Browser as never)
    expect(fixture.entry('main')).toBeDefined()
    expect(fixture.entry('sidebar.footer.action')).toBeDefined()
    await second()
    expect(fixture.entries.size).toBe(0)
  })

  it('does not register a pending entry after the plugin is disposed', async () => {
    const fixture = host([])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    await dispose(); fixture.declare('main'); fixture.declare('sidebar.footer.action')
    expect(fixture.entries.size).toBe(0)
  })

  it('releases an existing main panel while a footer declaration is still pending', async () => {
    const fixture = host(['main'])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    expect(fixture.entry('main')).toBeDefined()
    expect(fixture.entry('sidebar.footer.action')).toBeUndefined()
    await dispose(); fixture.declare('sidebar.footer.action')
    expect(fixture.entries.size).toBe(0)
  })

  it('removes its main panel if adding the footer entry fails', () => {
    const fixture = host(['main', 'sidebar.footer.action'], true)
    expect(() => installDataBrowserNavigation(fixture.ctx, () => null)).toThrow('footer registration failed')
    expect(fixture.entries.size).toBe(0)
  })
})
