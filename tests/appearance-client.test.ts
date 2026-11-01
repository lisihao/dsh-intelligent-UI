// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Settings, ExperienceStore, HeaderControls } from '../src/client.js'
import { initialSettings, type ExperienceSettings, type SaveSettingsInput } from '../src/contracts.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { appearancePreferences } from '../src/appearance.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
