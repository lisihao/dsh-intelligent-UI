// @vitest-environment jsdom
import { act, createElement as h, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DATA_BROWSER_PANEL_ID, DataBrowserIcon, installDataBrowserNavigation } from '../src/data-browser-navigation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Slot = 'main' | 'sidebar.panellist'
type Registration = { name: Slot; id?: string; key?: string; label?: () => string; order?: number }
type Waiting = { live: boolean; create: () => () => void; cleanup?: () => void }

/** A declaration-aware host: entries are visible only while their slot exists. */
function host(available: Slot[] = ['main', 'sidebar.panellist'], failNavigation = false) {
  const declared = new Set(available), waiting = new Map<Slot, Set<Waiting>>()
  const entries = new Map<string, ComponentType<Record<string, unknown>>>()
  const registrations: Registration[] = []
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
      registrations.push(options)
      const id = options.key ?? options.id!
      const key = idOf(options.name, id)
      if (failNavigation && options.name === 'sidebar.panellist') throw new Error('navigation registration failed')
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
    ctx, entries, layout, changes, registrations,
    declare: (slot: Slot) => {
      declared.add(slot)
      for (const item of waiting.get(slot) ?? []) if (item.live && !item.cleanup) item.cleanup = item.create()
    },
    addOtherPanel: () => slots.register({ name: 'main', key: 'other' }, () => null),
    entry: (slot: Slot) => entries.get(idOf(slot, DATA_BROWSER_PANEL_ID)),
  }
}

describe('data browser navigation', () => {
  it('waits for the main panel before exposing the single Tools entry, then restores the conversation on removal', async () => {
    const fixture = host(['sidebar.panellist'])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => h('p', null, '数据内容'))
    expect(fixture.entry('main')).toBeUndefined()
    expect(fixture.entry('sidebar.panellist')).toBeUndefined()
    fixture.declare('main')
    expect(fixture.entry('main')).toBeDefined()
    expect(fixture.entry('sidebar.panellist')).toBeDefined()
    expect(fixture.registrations.find(row => row.name === 'sidebar.panellist')?.label?.()).toBe('数据浏览器')
    expect(fixture.changes.slice(0, 2)).toEqual([`add:main:${DATA_BROWSER_PANEL_ID}`, `add:sidebar.panellist:${DATA_BROWSER_PANEL_ID}`])
    fixture.layout.selectPanel(DATA_BROWSER_PANEL_ID)
    await dispose()
    expect(fixture.layout.panelInfo.getSnapshot().activePanelId).toBeNull()
    expect(fixture.entry('main')).toBeUndefined()
    expect(fixture.entry('sidebar.panellist')).toBeUndefined()
    expect(fixture.changes.slice(-3)).toEqual([`remove:sidebar.panellist:${DATA_BROWSER_PANEL_ID}`, 'select:null', `remove:main:${DATA_BROWSER_PANEL_ID}`])
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

  it('supplies an accessible native panel label and an icon at the requested size', async () => {
    const fixture = host(), dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    const container = document.createElement('div'), root = createRoot(container)
    await act(async () => root.render(h(DataBrowserIcon, { size: 18 })))
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('18')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('button')).toBeNull()
    expect(fixture.entries.has(`sidebar.footer.action:${DATA_BROWSER_PANEL_ID}`)).toBe(false)
    await act(async () => root.unmount()); await dispose()
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
    expect(fixture.entry('sidebar.panellist')).toBeDefined()
    await second()
    expect(fixture.entries.size).toBe(0)
  })

  it('does not register a pending entry after the plugin is disposed', async () => {
    const fixture = host([])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    await dispose(); fixture.declare('main'); fixture.declare('sidebar.panellist')
    expect(fixture.entries.size).toBe(0)
  })

  it('releases an existing main panel while a navigation declaration is still pending', async () => {
    const fixture = host(['main'])
    const dispose = installDataBrowserNavigation(fixture.ctx, () => null)
    expect(fixture.entry('main')).toBeDefined()
    expect(fixture.entry('sidebar.panellist')).toBeUndefined()
    await dispose(); fixture.declare('sidebar.panellist')
    expect(fixture.entries.size).toBe(0)
  })

  it('removes its main panel if adding the navigation entry fails', () => {
    const fixture = host(['main', 'sidebar.panellist'], true)
    expect(() => installDataBrowserNavigation(fixture.ctx, () => null)).toThrow('navigation registration failed')
    expect(fixture.entries.size).toBe(0)
  })
})
