// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExperienceStore, HeaderControls, Settings } from '../src/client.js'
import { ExperienceStore as HostStore } from '../src/store.js'
import { initialSettings, type ExperienceSettings, type SaveSettingsInput } from '../src/contracts.js'
import { builtInThemes, resolveTheme, type ThemePackage } from '../src/theme-contracts.js'
import { installAppearanceStyles } from '../src/appearance-style.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const theme = (id: string) => builtInThemes.find(item => item.id === id)!
const imported: ThemePackage = { ...clone(theme('empryo')), id: 'imported-test', name: 'Imported Test' }
function backend(initial: ExperienceSettings) {
  let state = clone(initial)
  let beforeSave: (input: SaveSettingsInput, n: number) => Promise<void> = async () => {}
  let calls = 0
  const api = {
    settings: vi.fn(async () => clone(state)),
    saveSettings: vi.fn(async (input: SaveSettingsInput) => {
      await beforeSave(input, ++calls)
      if (input.expectedRevision !== state.revision) throw new Error('REVISION_CONFLICT')
      state = {
        ...state, revision: state.revision + 1,
        takeover: input.takeover, openui: input.openui, mcpApps: input.mcpApps,
        ...(input.appearance ? { appearance: clone(input.appearance) } : {}),
        ...(input.themeId ? { theme: { activeId: input.themeId, installed: state.theme?.installed ?? [] } } : {}),
      }
      return clone(state)
    }),
    artifacts: async () => [],
    publish: async () => { throw new Error('unused') },
  }
  return { api, get: () => clone(state), set: (value: ExperienceSettings) => { state = clone(value) }, before: (fn: typeof beforeSave) => { beforeSave = fn } }
}
function setup() {
  const initial = { ...initialSettings(), takeover: true, theme: { activeId: 'empryo', installed: [imported] } }
  const service = backend(initial), store = new ExperienceStore()
  store.update({ api: service.api, settings: initial })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  return { service, store, host, root }
}
function select(host: HTMLElement): HTMLSelectElement { return host.querySelector('select[aria-label="界面主题"]')! }
function choose(host: HTMLElement, id: string) {
  const input = select(host); input.value = id; input.dispatchEvent(new Event('change', { bubbles: true }))
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe('header theme shortcut', () => {
  it('is unavailable until settings load and follows remote updates with built-in and imported themes', async () => {
    const { service, store, host, root } = setup()
    store.update({ api: service.api })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      expect(select(host).disabled).toBe(true)
      await act(async () => store.refresh())
      expect(select(host).disabled).toBe(false)
      expect([...select(host).options].map(option => option.value)).toEqual([...builtInThemes.map(item => item.id), imported.id])
      expect(select(host).value).toBe('empryo')
      service.set({ ...service.get(), revision: 1, theme: { activeId: imported.id, installed: [imported] } })
      await act(async () => store.refresh())
      expect(select(host).value).toBe(imported.id)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('saves imported appearance and preserves flags and installed themes', async () => {
    const { service, store, host, root } = setup()
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => choose(host, imported.id))
      expect(service.api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, themeId: imported.id, appearance: imported.appearance }))
      expect(service.get().theme).toEqual({ activeId: imported.id, installed: [imported] })
      expect(service.get()).toMatchObject({ takeover: true, openui: true, mcpApps: false })
      expect(select(host).value).toBe(imported.id)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('persists a header choice to the real store and updates the existing style and content in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iexp-quick-theme-'))
    const service = new HostStore(dir), store = new ExperienceStore()
    const initial = await service.settings()
    const api = { settings: () => service.settings(), saveSettings: (input: SaveSettingsInput) => service.saveSettings(input), artifacts: async () => [], publish: async () => { throw new Error('unused') } }
    store.update({ api, settings: initial })
    const dispose = installAppearanceStyles(store)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(h('div', null, h(HeaderControls, { store, sessionId: 'test' }), h('article', { 'data-original': true }, 'Original content'))))
      const sheet = document.querySelector<HTMLStyleElement>('[data-solar-experience-appearance]')!
      const before = sheet.textContent, original = host.querySelector('[data-original]')
      await act(async () => choose(host, 'ascii'))
      for (let i = 0; i < 30 && store.snapshot().settings?.revision === initial.revision; i++) await flush()
      expect(resolveTheme((await new HostStore(dir).settings()).theme).id).toBe('ascii')
      expect(document.querySelector('[data-solar-experience-appearance]')).toBe(sheet)
      expect(sheet.textContent).not.toBe(before)
      expect(host.querySelector('[data-original]')).toBe(original)
      expect(original?.textContent).toBe('Original content')
    } finally { await act(async () => root.unmount()); host.remove(); dispose(); await rm(dir, { recursive: true, force: true }) }
  })

  it('serializes rapid choices and retains the last intent', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) await gate.promise })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => { choose(host, 'ascii'); choose(host, 'plain') })
      expect(select(host).value).toBe('plain')
      expect(service.api.saveSettings).toHaveBeenCalledTimes(1)
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings.mock.calls.map(([input]) => [input.expectedRevision, input.themeId])).toEqual([[0, 'ascii'], [1, 'plain']])
      expect(resolveTheme(service.get().theme).id).toBe('plain')
      expect(select(host).value).toBe('plain')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('merges a queued transparency toggle onto the selected theme', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) await gate.promise })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => { choose(host, 'ascii'); host.querySelector<HTMLInputElement>('.iexp-transparency-control input')!.click() })
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings.mock.calls.map(([input]) => input.expectedRevision)).toEqual([0, 1])
      expect(service.get().theme?.activeId).toBe('ascii')
      expect(service.get().appearance).toEqual({ ...theme('ascii').appearance, translucent: false })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('applies a later theme after a transparency save has completed', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) await gate.promise })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => { host.querySelector<HTMLInputElement>('.iexp-transparency-control input')!.click(); choose(host, 'ascii') })
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings.mock.calls.map(([input]) => input.expectedRevision)).toEqual([0, 1])
      expect(service.get().theme?.activeId).toBe('ascii')
      expect(service.get().appearance).toEqual(theme('ascii').appearance)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('preserves a slider preview across a same-revision refresh and ignores an older read after commit', async () => {
    const { service, store, host, root } = setup(), beforeCommit = deferred(), afterCommit = deferred()
    const stale = service.get()
    service.api.settings.mockImplementationOnce(async () => { await beforeCommit.promise; return clone(stale) })
      .mockImplementationOnce(async () => { await afterCommit.promise; return clone(stale) })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      const slider = host.querySelector<HTMLInputElement>('input[type=range]')!
      const readDuringPreview = store.refresh()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => { setter.call(slider, '53'); slider.dispatchEvent(new Event('input', { bubbles: true })) })
      expect(store.snapshot().appearancePreview?.backgroundOpacity).toBe(0.47)
      await act(async () => { beforeCommit.resolve(); await readDuringPreview })
      expect(store.snapshot().appearancePreview?.backgroundOpacity).toBe(0.47)
      const readBeforeCommit = store.refresh()
      await act(async () => {
        slider.dispatchEvent(new Event('pointerup', { bubbles: true }))
        await vi.waitFor(() => expect(store.snapshot().settings?.revision).toBe(1), { interval: 10, timeout: 5000 })
      })
      expect(service.get().appearance?.backgroundOpacity).toBe(0.47)
      await act(async () => { afterCommit.resolve(); await readBeforeCommit })
      expect(store.snapshot().settings).toMatchObject({ revision: 1, appearance: { backgroundOpacity: 0.47 } })
      expect(store.snapshot().appearancePreview).toBeUndefined()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('uses the same queue for Settings and the header without dropping either change', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) await gate.promise })
    try {
      await act(async () => root.render(h('div', null, h(HeaderControls, { store, sessionId: 'test' }), h(Settings, { store }))))
      await act(async () => {
        choose(host, 'ascii')
        const checkboxes = host.querySelectorAll<HTMLInputElement>('.iexp-settings input[type=checkbox]')
        checkboxes[0]!.click()
      })
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings.mock.calls.map(([input]) => input.expectedRevision)).toEqual([0, 1])
      expect(service.get()).toMatchObject({ takeover: false, openui: true, mcpApps: false, theme: { activeId: 'ascii' } })
      expect(service.get().appearance).toEqual(theme('ascii').appearance)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('rolls back a failed selection and reports the error', async () => {
    const { service, store, host, root } = setup()
    service.before(async () => { throw new Error('offline') })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => choose(host, 'ascii'))
      expect(select(host).value).toBe('empryo')
      expect(host.querySelector('[role=alert]')?.textContent).toContain('offline')
      expect(service.get().revision).toBe(0)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('continues a queued selection at the confirmed revision after a failure', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) { await gate.promise; throw new Error('offline') } })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => { choose(host, 'ascii'); choose(host, 'plain') })
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings.mock.calls.map(([input]) => [input.expectedRevision, input.themeId])).toEqual([[0, 'ascii'], [0, 'plain']])
      expect(service.get().theme?.activeId).toBe('plain')
      expect(select(host).value).toBe('plain')
      expect(host.querySelector('[role=alert]')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('preserves an external revision and rejects queued stale intent without a blind retry', async () => {
    const { service, store, host, root } = setup(), gate = deferred()
    service.before(async (_, n) => { if (n === 1) await gate.promise })
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
      await act(async () => { choose(host, 'ascii'); choose(host, 'plain') })
      service.set({ ...service.get(), revision: 1, mcpApps: true, theme: { activeId: imported.id, installed: [imported] } })
      await act(async () => { gate.resolve(); await gate.promise })
      await flush()
      expect(service.api.saveSettings).toHaveBeenCalledTimes(1)
      expect(service.get()).toMatchObject({ revision: 1, mcpApps: true, theme: { activeId: imported.id } })
      expect(select(host).value).toBe(imported.id)
      expect(host.querySelector('[role=alert]')?.textContent).toContain('其他位置更改')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
