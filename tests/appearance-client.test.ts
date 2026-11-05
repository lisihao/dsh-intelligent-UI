// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Settings, ExperienceStore, HeaderControls } from '../src/client.js'
import { initialSettings, type ExperienceSettings, type SaveSettingsInput } from '../src/contracts.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { appearancePreferences } from '../src/appearance.js'
import { TransparencyControl } from '../src/transparency-control.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

const noopArtifacts = async () => [] as never[]
const noopPublish = async () => { throw new Error('not used') }

describe('appearance settings through the normal client service', () => {
  it('saves color/transparency with CAS, rejects malformed colors and restores defaults', async () => {
    let settings: ExperienceSettings = { ...initialSettings(), takeover: true }
    const save = vi.fn(async (input: SaveSettingsInput) => {
      expect(input.expectedRevision).toBe(settings.revision)
      settings = { formatVersion: 1, revision: settings.revision + 1, takeover: input.takeover, openui: input.openui, mcpApps: input.mcpApps, appearance: input.appearance }
      return settings
    })
    const store = new ExperienceStore()
    store.update({ settings, api: { settings: async () => settings, saveSettings: save, artifacts: async () => [], publish: async () => { throw new Error('not used') } } })
    const dispose = installAppearanceStyles(store)
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(h(Settings, { store })))
      const toggle = host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[3]!
      expect(toggle.checked).toBe(true)
      expect(appearancePreferences.getSnapshot().backgroundColor).toBe('#24262b')
      await act(async () => toggle.click())
      expect(settings.appearance?.translucent).toBe(false)
      expect(document.querySelector('[data-solar-experience-appearance]')?.textContent).toContain('--iexp-backdrop:none')
      const field = host.querySelector<HTMLInputElement>('input[aria-label="背景颜色值"]')!
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      await act(async () => { set.call(field, '#eef2f5'); field.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => host.querySelector('form.iexp-appearance-color')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(settings.appearance).toEqual({ backgroundColor: '#eef2f5', translucent: false })
      expect(settings.takeover).toBe(true); expect(settings.openui).toBe(true); expect(settings.mcpApps).toBe(false)
      expect(appearancePreferences.getSnapshot().backgroundColor).toBe('#eef2f5')
      const calls = save.mock.calls.length
      await act(async () => { set.call(field, '#bad'); field.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => host.querySelector('form.iexp-appearance-color')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(host.textContent).toContain('请输入 #RRGGBB')
      expect(save).toHaveBeenCalledTimes(calls)
      await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '恢复默认外观')!.click())
      expect(settings.appearance).toEqual({ backgroundColor: '#24262b', translucent: true })
      const sheet = document.querySelector('[data-solar-experience-appearance]')!
      const first = sheet.firstChild
      await act(async () => store.update({ settings: { ...settings } }))
      expect(sheet.firstChild).toBe(first)
    } finally { await act(async () => root.unmount()); host.remove(); dispose() }
    expect(document.querySelector('[data-solar-experience-appearance]')).toBeNull()
  })
})


describe('header transparency shortcut', () => {
  it('synchronizes all mounted headers with settings and preserves color and plugin flags', async () => {
    let settings: ExperienceSettings = { ...initialSettings(), takeover: true, appearance: { backgroundColor: '#36404f', translucent: true } }
    const store = new ExperienceStore()
    store.update({ settings, api: { settings: async () => settings, saveSettings: async input => {
      expect(input.expectedRevision).toBe(settings.revision)
      settings = { ...settings, ...input, revision: settings.revision + 1 }; return settings
    }, artifacts: async () => [], publish: async () => { throw new Error('not used') } } })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(h('div', null, h(HeaderControls, { store, sessionId: 'one' }), h(HeaderControls, { store, sessionId: 'two' }), h(Settings, { store }))))
      const toggles = () => host.querySelectorAll<HTMLInputElement>('.iexp-transparency-control input')
      await act(async () => toggles()[0]!.click())
      expect([...toggles()].map(input => input.checked)).toEqual([false, false])
      expect(settings.appearance).toEqual({ backgroundColor: '#36404f', translucent: false })
      expect(host.querySelector<HTMLInputElement>('.iexp-appearance-controls input[type=checkbox]')!.checked).toBe(false)
      const settingsToggle = host.querySelector<HTMLInputElement>('.iexp-appearance-controls input[type=checkbox]')!
      await act(async () => settingsToggle.click())
      expect([...toggles()].map(input => input.checked)).toEqual([true, true])
      expect(settings.takeover).toBe(true); expect(settings.openui).toBe(true); expect(settings.mcpApps).toBe(false)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the acknowledged preference and exposes a failed save', async () => {
    const settings = initialSettings(), store = new ExperienceStore()
    store.update({ settings, api: { settings: async () => settings, saveSettings: async () => { throw new Error('REVISION_CONFLICT') }, artifacts: async () => [], publish: async () => { throw new Error('not used') } } })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(h(HeaderControls, { store, sessionId: 'one' })))
      await act(async () => host.querySelector<HTMLInputElement>('input')!.click())
      expect(host.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
      expect(host.querySelector('[role=alert]')?.textContent).toContain('REVISION_CONFLICT')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})

describe('settings fetch and save recovery', () => {
  it('does not save on a transient settings read failure and clears the connection error after refresh succeeds', async () => {
    const settings = initialSettings()
    let available = false
    const saveSettings = vi.fn(async () => { throw new Error('save must not run') })
    const api = {
      settings: vi.fn(async () => { if (!available) throw new Error('Failed to fetch'); return settings }),
      saveSettings,
      artifacts: noopArtifacts,
      publish: noopPublish,
    }
    const store = new ExperienceStore()
    store.update({ api })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => { root.render(h(TransparencyControl, { store })); await store.refresh() })
      expect(saveSettings).not.toHaveBeenCalled()
      expect(host.querySelector('[role=alert]')?.textContent).toContain('设置连接暂时不可用')
      expect(host.querySelector('[role=alert]')?.textContent).not.toContain('透明设置未保存')

      available = true
      await act(async () => { await store.refresh() })
      expect(store.snapshot().settings).toEqual(settings)
      expect(store.snapshot().error).toBeUndefined()
      expect(host.querySelector('[role=alert]')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('ignores a late failure from an older refresh after a newer save succeeds', async () => {
    const before = initialSettings()
    const after: ExperienceSettings = { ...before, revision: before.revision + 1, takeover: true }
    const oldRead = deferred<ExperienceSettings>()
    const saveSettings = vi.fn(async (input: SaveSettingsInput) => {
      expect(input.expectedRevision).toBe(before.revision)
      return after
    })
    const store = new ExperienceStore()
    const api = { settings: vi.fn(() => oldRead.promise), saveSettings, artifacts: noopArtifacts, publish: noopPublish }
    store.update({ api, settings: before })

    const oldRefresh = store.refresh()
    await store.save({ expectedRevision: before.revision, takeover: true, openui: before.openui, mcpApps: before.mcpApps, appearance: before.appearance })
    expect(store.snapshot().settings).toEqual(after)

    oldRead.reject(new Error('late read failure'))
    await oldRefresh
    expect(store.snapshot().settings).toEqual(after)
    expect(store.snapshot().error).toBeUndefined()
  })

  it('keeps a newer successful refresh when an older read fails later', async () => {
    const oldRead = deferred<ExperienceSettings>()
    const settings = initialSettings()
    const store = new ExperienceStore()
    const api = { settings: vi.fn().mockImplementationOnce(() => oldRead.promise).mockResolvedValue(settings), saveSettings: vi.fn(), artifacts: noopArtifacts, publish: noopPublish }
    store.update({ api })
    const older = store.refresh()
    await store.refresh()
    oldRead.reject(new Error('obsolete read failure'))
    await older
    expect(store.snapshot().settings).toEqual(settings)
    expect(store.snapshot().error).toBeUndefined()
  })

  it('clears a prior read error when an explicit save succeeds', async () => {
    const before = initialSettings()
    const after: ExperienceSettings = { ...before, revision: before.revision + 1, openui: false }
    const saveSettings = vi.fn(async () => after)
    const store = new ExperienceStore()
    const api = {
      settings: vi.fn(async () => { throw new Error('Failed to fetch') }),
      saveSettings,
      artifacts: noopArtifacts,
      publish: noopPublish,
    }
    store.update({ api, settings: before })
    await store.refresh()
    expect(store.snapshot().error).toBe('Failed to fetch')

    await store.save({ expectedRevision: before.revision, takeover: before.takeover, openui: false, mcpApps: before.mcpApps, appearance: before.appearance })
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(store.snapshot().settings).toEqual(after)
    expect(store.snapshot().error).toBeUndefined()
  })

  it('keeps a failed save visible after a successful read and does not retry or change the acknowledged preference', async () => {
    const settings: ExperienceSettings = { ...initialSettings(), appearance: { backgroundColor: '#24262b', translucent: false } }
    const saveSettings = vi.fn(async () => { throw new Error('SAVE_FAILED') })
    const api = {
      settings: vi.fn(async () => settings),
      saveSettings,
      artifacts: noopArtifacts,
      publish: noopPublish,
    }
    const store = new ExperienceStore()
    store.update({ api, settings })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(h(TransparencyControl, { store })))
      const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
      expect(checkbox.checked).toBe(false)

      await act(async () => {
        checkbox.click()
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      })
      expect(saveSettings).toHaveBeenCalledTimes(1)
      expect(api.settings).toHaveBeenCalled()
      expect(store.snapshot().settings).toEqual(settings)
      expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
      expect(host.querySelector('[role=alert]')?.textContent).toContain('透明设置未保存：SAVE_FAILED')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
