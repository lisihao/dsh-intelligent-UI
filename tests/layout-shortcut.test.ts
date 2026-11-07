// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ExperienceStore, Settings, installBlockLayoutShortcut } from '../src/client.js'
import { initialSettings, type ExperienceApi, type ExperienceSettings, type SaveSettingsInput } from '../src/contracts.js'
import { DEFAULT_BLOCK_LAYOUT_SHORTCUT, blockLayoutShortcutLabel, matchesBlockLayoutShortcut, normalizeBlockLayoutShortcut } from '../src/layout-shortcut.js'

const mounted: Array<{ root: Root, host: HTMLElement }> = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  document.body.replaceChildren()
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fixture(settings: ExperienceSettings) {
  let current = clone(settings)
  const saveSettings = vi.fn(async (input: SaveSettingsInput) => {
    if (input.expectedRevision !== current.revision) throw new Error('revision conflict')
    current = {
      ...current,
      revision: current.revision + 1,
      takeover: input.takeover,
      openui: input.openui,
      mcpApps: input.mcpApps,
      ...(input.adaptive === undefined ? {} : { adaptive: input.adaptive }),
    }
    return current
  })
  const api: ExperienceApi = {
    settings: async () => current,
    saveSettings,
    artifacts: async () => [],
    publish: async () => { throw new Error('not used') },
  }
  const store = new ExperienceStore()
  store.update({ api, settings: current })
  return { store, saveSettings, current: () => current }
}

function adaptiveFixture(): ExperienceSettings {
  return {
    ...initialSettings(),
    takeover: true,
    adaptive: { enabled: true, styleMode: 'automatic', blockLayout: false, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT },
  }
}

function keydown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('experimental block-layout shortcut format', () => {
  it('canonicalizes human aliases to physical-code storage and displays the default as ⌥⌘I', () => {
    expect(normalizeBlockLayoutShortcut('opt+cmd+i')).toBe(DEFAULT_BLOCK_LAYOUT_SHORTCUT)
    expect(normalizeBlockLayoutShortcut('Option+Command+I')).toBe(DEFAULT_BLOCK_LAYOUT_SHORTCUT)
    expect(normalizeBlockLayoutShortcut('Meta+Alt+KeyI')).toBe(DEFAULT_BLOCK_LAYOUT_SHORTCUT)
    expect(normalizeBlockLayoutShortcut('cmd+shift+k')).toBe('Shift+Meta+KeyK')
    expect(blockLayoutShortcutLabel(undefined)).toBe('⌥⌘I')
    expect(normalizeBlockLayoutShortcut('')).toBe('')
    expect(() => normalizeBlockLayoutShortcut('Shift+I')).toThrow(/BLOCK_LAYOUT_SHORTCUT_INVALID/)
  })

  it('matches exact physical modifiers and ignores repeats, composition, and handled events', () => {
    const match = new KeyboardEvent('keydown', { code: 'KeyI', altKey: true, metaKey: true, cancelable: true })
    expect(matchesBlockLayoutShortcut(match, DEFAULT_BLOCK_LAYOUT_SHORTCUT)).toBe(true)
    expect(matchesBlockLayoutShortcut(new KeyboardEvent('keydown', { code: 'KeyI', altKey: true, metaKey: true, shiftKey: true }), DEFAULT_BLOCK_LAYOUT_SHORTCUT)).toBe(false)
    expect(matchesBlockLayoutShortcut(new KeyboardEvent('keydown', { code: 'KeyI', altKey: true, metaKey: true, repeat: true }), DEFAULT_BLOCK_LAYOUT_SHORTCUT)).toBe(false)
    const composing = new KeyboardEvent('keydown', { code: 'KeyI', altKey: true, metaKey: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    expect(matchesBlockLayoutShortcut(composing, DEFAULT_BLOCK_LAYOUT_SHORTCUT)).toBe(false)
    match.preventDefault()
    expect(matchesBlockLayoutShortcut(match, DEFAULT_BLOCK_LAYOUT_SHORTCUT)).toBe(false)
  })
})

describe('experimental block-layout shortcut lifecycle', () => {
  it('works from the conversation composer, changes only blockLayout, and installs once', async () => {
    const { store, saveSettings, current } = fixture(adaptiveFixture())
    const composer = document.createElement('textarea')
    document.body.append(composer)
    composer.focus()
    const dispose = installBlockLayoutShortcut(store)
    expect(installBlockLayoutShortcut(store)).toBe(dispose)
    const event = keydown(composer, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(saveSettings).toHaveBeenCalledOnce()
    expect(current().takeover).toBe(true)
    expect(current().adaptive).toEqual({ enabled: true, styleMode: 'automatic', blockLayout: true, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT })
    dispose()
  })

  it('does not save from its own capture field and cancels a queued toggle after cleanup', async () => {
    const { store, saveSettings } = fixture(adaptiveFixture())
    const capture = document.createElement('input')
    capture.dataset.iexpLayoutShortcutCapture = 'true'
    document.body.append(capture)
    const dispose = installBlockLayoutShortcut(store)
    keydown(capture, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    await settle()
    expect(saveSettings).not.toHaveBeenCalled()
    keydown(window, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    dispose()
    await settle()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('reports unmet prerequisites without enabling a model-related setting', async () => {
    const settings: ExperienceSettings = { ...adaptiveFixture(), takeover: false, adaptive: { enabled: false, styleMode: 'automatic', blockLayout: false, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT } }
    const { store, saveSettings } = fixture(settings)
    const dispose = installBlockLayoutShortcut(store)
    keydown(window, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    await settle()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(store.snapshot().shortcutError).toContain('快捷键不会自动开启')
    dispose()
  })

  it('enables the experiment with takeover on while leaving Jev disabled', async () => {
    const settings: ExperienceSettings = { ...adaptiveFixture(), adaptive: { enabled: false, styleMode: 'automatic', blockLayout: false, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT } }
    const { store, saveSettings, current } = fixture(settings)
    const dispose = installBlockLayoutShortcut(store)
    keydown(window, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    await settle()
    expect(saveSettings).toHaveBeenCalledOnce()
    expect(current().takeover).toBe(true)
    expect(current().adaptive).toEqual({ enabled: false, styleMode: 'automatic', blockLayout: true, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT })
    dispose()
  })

  it('always lets an enabled experiment turn off after takeover and Jev are both disabled', async () => {
    const settings: ExperienceSettings = { ...adaptiveFixture(), takeover: false, adaptive: { enabled: false, styleMode: 'automatic', blockLayout: true, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT } }
    const { store, saveSettings, current } = fixture(settings)
    const dispose = installBlockLayoutShortcut(store)
    keydown(window, { code: 'KeyI', key: 'i', altKey: true, metaKey: true })
    await settle()
    expect(saveSettings).toHaveBeenCalledOnce()
    expect(current().takeover).toBe(false)
    expect(current().adaptive).toEqual({ enabled: false, styleMode: 'automatic', blockLayout: false, blockLayoutShortcut: DEFAULT_BLOCK_LAYOUT_SHORTCUT })
    dispose()
  })

  it('rebases separate queued adaptive edits by field rather than overwriting the block toggle', async () => {
    const { store, current } = fixture(adaptiveFixture())
    const settings = current()
    const first = store.save({
      expectedRevision: settings.revision,
      takeover: settings.takeover,
      openui: settings.openui,
      mcpApps: settings.mcpApps,
      adaptive: { ...settings.adaptive!, blockLayout: true },
    })
    const second = store.save({
      expectedRevision: settings.revision,
      takeover: settings.takeover,
      openui: settings.openui,
      mcpApps: settings.mcpApps,
      adaptive: { ...settings.adaptive!, blockLayoutShortcut: '' },
    })
    await Promise.all([first, second])
    expect(current().adaptive).toEqual({ enabled: true, styleMode: 'automatic', blockLayout: true, blockLayoutShortcut: '' })
  })

  it('captures a real chord without trapping Tab or Escape in the settings editor', async () => {
    const { store, saveSettings, current } = fixture(adaptiveFixture())
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ root, host })
    await act(async () => root.render(createElement(Settings, { store })))
    const editor = host.querySelector<HTMLInputElement>('[data-iexp-layout-shortcut-capture="true"]')!
    let tab!: KeyboardEvent, chord!: KeyboardEvent, escape!: KeyboardEvent
    await act(async () => {
      editor.focus()
      tab = keydown(editor, { code: 'Tab', key: 'Tab' })
      keydown(editor, { code: 'AltLeft', key: 'Alt', altKey: true })
      keydown(editor, { code: 'MetaLeft', key: 'Meta', altKey: true, metaKey: true })
      chord = keydown(editor, { code: 'KeyB', key: 'b', altKey: true, metaKey: true })
      await settle()
      editor.focus()
      escape = keydown(editor, { code: 'Escape', key: 'Escape' })
    })
    expect(tab.defaultPrevented).toBe(false)
    expect(chord.defaultPrevented).toBe(true)
    expect(saveSettings).toHaveBeenCalledOnce()
    expect(current().adaptive?.blockLayoutShortcut).toBe('Alt+Meta+KeyB')
    expect(escape.defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(editor)
  })
})
