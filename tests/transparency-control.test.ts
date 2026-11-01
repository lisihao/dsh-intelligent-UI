// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperienceStore as ClientStore, HeaderControls, Settings } from '../src/client.js'
import { ExperienceStore as HostStore } from '../src/store.js'
import { initialSettings, type ExperienceSettings, type ExperienceApi, type SaveSettingsInput } from '../src/contracts.js'
import { appearancePreferences, appearanceTokens, type Appearance } from '../src/appearance.js'
import { installAppearanceStyles } from '../src/appearance-style.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root, element: HTMLElement, dispose(): void }> = []
const temporary: string[] = []
const popovers = new WeakSet<Element>()
let showDescriptor: PropertyDescriptor | undefined, hideDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  showDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
  hideDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover')
  // jsdom lacks the top-layer API; this shim models open/close only, not position or rendering.
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value(this: HTMLElement) { popovers.add(this) } })
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value(this: HTMLElement) { popovers.delete(this) } })
  const matches = HTMLElement.prototype.matches
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) { return selector === ':popover-open' ? popovers.has(this) : matches.call(this, selector) })
})
afterEach(async () => {
  for (const view of mounted.splice(0)) { await act(async () => view.root.unmount()); view.dispose(); view.element.remove() }
  vi.restoreAllMocks()
  if (showDescriptor) Object.defineProperty(HTMLElement.prototype, 'showPopover', showDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
  if (hideDescriptor) Object.defineProperty(HTMLElement.prototype, 'hidePopover', hideDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover')
  appearancePreferences.reset()
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const flags = { takeover: true, openui: false, mcpApps: true }
const base = (): ExperienceSettings => ({ ...initialSettings(), ...flags, revision: 4, appearance: { backgroundColor: '#344556', translucent: true } })
function client(settings: ExperienceSettings, saveSettings: ExperienceApi['saveSettings'], readSettings: ExperienceApi['settings'] = async () => settings) {
  const store = new ClientStore()
  store.update({ settings, api: { settings: readSettings, saveSettings, artifacts: async () => [], publish: async () => { throw new Error('not used') } } })
  return store
}
async function mount(store: ClientStore) {
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element), dispose = installAppearanceStyles(store)
  mounted.push({ root, element, dispose })
  await act(async () => root.render(h('div', null, h(HeaderControls, { store, sessionId: 'local-test' }), h(Settings, { store }))))
  const range = element.querySelector<HTMLInputElement>('input[type="range"]')!
  expect(range).not.toBeNull()
  return { element, range, sheet: () => document.querySelector<HTMLStyleElement>('[data-solar-experience-appearance]')!.textContent! }
}
async function input(range: HTMLInputElement, percent: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(range, String(percent)); range.dispatchEvent(new Event('input', { bubbles: true })) })
}
const pointerUp = (range: HTMLInputElement) => range.dispatchEvent(new Event('pointerup', { bubbles: true }))

describe('header transparency gestures', () => {
  it('uses a native range to preview the actual appearance sheet/preferences without a settings write', async () => {
    const settings = base(), save = vi.fn<ExperienceApi['saveSettings']>(), store = client(settings, save), view = await mount(store)
    await act(async () => view.range.focus())
    expect(popovers.has(view.element.querySelector('.iexp-opacity-popover')!)).toBe(true)
    const before = view.sheet()
    await input(view.range, 35)
    await input(view.range, 60)
    expect(view.range.value).toBe('60')
    expect(view.range.getAttribute('aria-valuetext')).toBe('60% 透明')
    expect(store.snapshot().appearancePreview).toEqual({ backgroundColor: '#344556', translucent: true, backgroundOpacity: 0.4 })
    expect(appearancePreferences.getSnapshot()).toEqual(store.snapshot().appearancePreview)
    expect(view.sheet()).not.toBe(before)
    expect(view.sheet()).toContain('--iexp-bg:rgba(52, 69, 86, 0.4)')
    expect(view.sheet()).not.toMatch(/(?:^|[;{])opacity:/)
    expect(store.snapshot().settings).toEqual(settings)
    expect(save).not.toHaveBeenCalled()
  })

  it('commits the latest preview once with the fresh settings revision and preserves the current color and plugin flags', async () => {
    let acknowledged = base(), release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const save = vi.fn(async (value: SaveSettingsInput) => { await gate; acknowledged = { ...acknowledged, ...value, revision: value.expectedRevision + 1 }; return acknowledged })
    const store = client(acknowledged, save, async () => acknowledged), view = await mount(store)
    await input(view.range, 20); await input(view.range, 55)
    const fresh = { ...acknowledged, revision: 9, takeover: false, openui: true, mcpApps: false }
    await act(async () => {
      acknowledged = fresh
      store.update({ ...store.snapshot(), settings: fresh })
      pointerUp(view.range); pointerUp(view.range)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ expectedRevision: 9, takeover: false, openui: true, mcpApps: false, appearance: { backgroundColor: '#344556', translucent: true, backgroundOpacity: 0.45 } })
    await act(async () => { release(); await gate })
    expect(store.snapshot().settings?.revision).toBe(10)
    expect(store.snapshot().appearancePreview).toBeUndefined()
    expect(appearancePreferences.getSnapshot().backgroundOpacity).toBe(0.45)
    await act(async () => pointerUp(view.range))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('rolls back a failed commit to the acknowledged preference and shows the actual error', async () => {
    const settings = base(), save = vi.fn(async () => { throw new Error('REVISION_CONFLICT: changed elsewhere') })
    const store = client(settings, save), view = await mount(store), before = view.sheet()
    await input(view.range, 65)
    expect(view.sheet()).not.toBe(before)
    await act(async () => pointerUp(view.range))
    expect(save).toHaveBeenCalledTimes(1)
    expect(store.snapshot().appearancePreview).toBeUndefined()
    expect(store.snapshot().settings).toEqual(settings)
    expect(appearancePreferences.getSnapshot()).toEqual(settings.appearance)
    expect(view.sheet()).toBe(before)
    expect(view.element.querySelector('[role="alert"]')?.textContent).toContain('REVISION_CONFLICT: changed elsewhere')
  })

  it('Escape cancels a dirty preview so pointer release and blur cannot save it later', async () => {
    const settings = base(), save = vi.fn<ExperienceApi['saveSettings']>(), store = client(settings, save), view = await mount(store)
    await act(async () => view.range.focus())
    await input(view.range, 70)
    expect(store.snapshot().appearancePreview?.backgroundOpacity).toBe(0.3)
    await act(async () => view.range.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(store.snapshot().appearancePreview).toBeUndefined()
    expect(appearancePreferences.getSnapshot()).toEqual(settings.appearance)
    expect(popovers.has(view.element.querySelector('.iexp-opacity-popover')!)).toBe(false)
    await act(async () => { pointerUp(view.range); view.range.blur() })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('transparent background persistence', () => {
  it.each([false, true])('keeps legacy translucent=%s preferences without inventing an opacity field across HostStore restarts', async translucent => {
    const path = await mkdtemp(join(tmpdir(), 'iexp-opacity-legacy-')); temporary.push(path)
    const host = new HostStore(path), appearance = { backgroundColor: '#344556', translucent }
    const saved = await host.saveSettings({ expectedRevision: 0, ...flags, appearance })
    const bytes = await readFile(join(path, 'settings.json'), 'utf8')
    expect(await new HostStore(path).settings()).toEqual(saved)
    expect(JSON.parse(bytes).appearance).toEqual(appearance)
    expect(bytes).not.toContain('backgroundOpacity')
    expect(appearanceTokens(saved.appearance).backgroundOpacity).toBe(translucent ? appearanceTokens(appearance).backgroundOpacity : 1)
  })

  it('persists a slider commit through the real HostStore and keeps the selected opacity while toggling off and on in Settings', async () => {
    const path = await mkdtemp(join(tmpdir(), 'iexp-opacity-persist-')); temporary.push(path)
    const host = new HostStore(path)
    const acknowledged = await host.saveSettings({ expectedRevision: 0, ...flags, appearance: { backgroundColor: '#809090', translucent: false } })
    const pending: Promise<unknown>[] = []
    const save = vi.fn((value: SaveSettingsInput) => { const result = host.saveSettings(value); pending.push(result); return result })
    const store = client(acknowledged, save, () => host.settings()), view = await mount(store)
    const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)) }
    await input(view.range, 70)
    await act(async () => { pointerUp(view.range); await flush() })
    const expected: Appearance = { backgroundColor: '#809090', translucent: true, backgroundOpacity: 0.3 }
    expect((await new HostStore(path).settings()).appearance).toEqual(expected)
    expect(appearanceTokens(expected).backgroundOpacity).toBe(0.3)
    const settingToggle = view.element.querySelector<HTMLInputElement>('.iexp-appearance-controls input[type="checkbox"]')!
    await act(async () => { settingToggle.click(); await flush() })
    const opaque = await new HostStore(path).settings()
    expect(opaque.appearance).toEqual({ ...expected, translucent: false })
    expect(appearanceTokens(opaque.appearance).backgroundOpacity).toBe(1)
    expect(view.sheet()).toContain('--iexp-bg:rgba(128, 144, 144, 1)')
    await act(async () => { settingToggle.click(); await flush() })
    const restarted = await new HostStore(path).settings()
    expect(restarted.appearance).toEqual(expected)
    expect(restarted).toMatchObject(flags)
    expect(appearanceTokens(restarted.appearance).backgroundOpacity).toBe(0.3)
    expect(save).toHaveBeenCalledTimes(3)
  })
})
