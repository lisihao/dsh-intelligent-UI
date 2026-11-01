// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sources from '../src/uiverse-sources.json' with { type: 'json' }
import selectedPin from './fixtures/uiverse-selected-pin.json' with { type: 'json' }
import { builtInThemes, resolveTheme, themePackageSchema } from '../src/theme-contracts.js'
import { ThemeComponentPreview, ThemeToggle, themeComponentSet } from '../src/theme-components.js'
import { themePreferences } from '../src/theme-runtime.js'
import { ExperienceStore } from '../src/store.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const components = builtInThemes.filter(theme => theme.formatVersion === 2)
afterEach(() => themePreferences.reset())

describe('source-backed component packages', () => {
  it('retains fifteen complete unchanged originals, stable provenance and all five roles', () => {
    expect(sources.commit).toBe('adbd2adde0a299a3956ea288fb444ec01891ca41')
    expect(components).toHaveLength(3)
    for (const set of Object.values(sources.sets)) {
      expect(set.map(record => record.role)).toEqual(['button', 'input', 'toggle', 'card', 'loader'])
      for (const record of set) {
        expect(createHash('sha256').update(record.html).digest('hex')).toBe(record.sha256)
        expect(record.html).toContain('From Uiverse.io by')
        expect(record.html).toContain('</style>')
        expect(record.sourceUrl).toContain(sources.commit + '/' + record.file)
        expect(record.url).toContain('/' + record.author + '/')
      }
    }
  })
  it('matches every selected source against exact case-sensitive paths and hashes from the pinned catalog', () => {
    expect(selectedPin.commit).toBe(sources.commit)
    const pinned = new Map(selectedPin.files.map(file => [file.file, file]))
    expect(pinned.size).toBe(15)
    for (const record of Object.values(sources.sets).flat()) {
      const original = pinned.get(record.file)
      expect(original, `Case-sensitive pinned path missing: ${record.file}`).toBeDefined()
      expect(original?.sha256).toBe(record.sha256)
      expect(original?.framework).toBe('css')
      expect(record.sourceUrl).toBe(`https://github.com/uiverse-io/galaxy/blob/${selectedPin.commit}/${record.file}`)
      expect(record.html).not.toMatch(/<script\b/i)
      expect(record.html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
    }
  })
  it('keeps v1 native and visibly rejects unsupported component sets/executable payloads', () => {
    expect(themeComponentSet(resolveTheme())).toBe('native')
    for (const theme of components) expect(themePackageSchema.parse(theme)).toEqual(theme)
    expect(themePackageSchema.safeParse({ ...components[0], componentSet: 'uninstalled' }).success).toBe(false)
    expect(themePackageSchema.safeParse({ ...components[0], css: 'body{display:none}' }).success).toBe(false)
    expect(themePackageSchema.safeParse({ ...resolveTheme(), componentSet: 'soft-relief' }).success).toBe(false)
  })
  it('persists a v2 component choice across store restart and restores Empryo after active removal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uiverse-theme-'))
    try {
      const store = new ExperienceStore(dir), theme = { ...components[0]!, id: 'local-uiverse' }
      await store.installTheme({ expectedRevision: 0, theme })
      await store.saveSettings({ expectedRevision: 1, takeover: true, openui: true, mcpApps: false, themeId: theme.id })
      const restored = await new ExperienceStore(dir).settings()
      expect(themeComponentSet(resolveTheme(restored.theme))).toBe('soft-relief')
      const removed = await store.removeTheme({ expectedRevision: 2, id: theme.id })
      expect(themeComponentSet(resolveTheme(removed.theme))).toBe('native')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('compiled controls preserve native interaction and source boundaries', () => {
  it('keeps user input, checked state and focus while switching all three component sets', async () => {
    const element = document.createElement('div'); document.body.append(element)
    const root = createRoot(element)
    try {
      await act(async () => root.render(h(ThemeComponentPreview, { theme: components[0]! })))
      const input = element.querySelector<HTMLInputElement>('input:not([type=checkbox])')!
      const checkbox = element.querySelector<HTMLInputElement>('input[type=checkbox]')!
      await act(async () => { input.value = '必须保留的原始输入'; Simulate.change(input) })
      await act(async () => checkbox.click())
      input.focus()
      for (const theme of components.slice(1)) {
        await act(async () => root.render(h(ThemeComponentPreview, { theme })))
        expect(element.querySelector('input:not([type=checkbox])')).toBe(input)
        expect(input.value).toBe('必须保留的原始输入')
        expect(document.activeElement).toBe(input)
        expect(checkbox.checked).toBe(false)
        expect(element.querySelector('.iexp-uiv-card')?.getAttribute('data-iexp-component-set')).toBe(themeComponentSet(theme))
      }
      const disabled = [...element.querySelectorAll('button')].find(button => button.disabled)!
      expect(disabled.textContent).toBe('不可用按钮')
      await act(async () => element.querySelector<HTMLButtonElement>('button:not([disabled])')!.click())
      expect(element.querySelector('[role=status]')?.textContent).toContain('预览加载中')
      await act(async () => { input.value = ''; Simulate.change(input) })
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(element.querySelector('[role=alert]')?.textContent).toContain('不能为空')
      const details = element.querySelector<HTMLDetailsElement>('details')!
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: false })) })
      const frame = element.querySelector<HTMLIFrameElement>('iframe')!
      expect(frame.getAttribute('sandbox')).toBe('')
      expect(frame.srcdoc).toContain("default-src 'none'")
      expect(frame.srcdoc).toContain("form-action 'none'")
      expect(element.textContent).toContain(sources.sets['mechanical-outline'][0]!.html)
      await act(async () => root.render(h(ThemeComponentPreview, { theme: resolveTheme() })))
      expect(element.textContent).toBe('')
    } finally { await act(async () => root.unmount()); element.remove() }
  })
  it('native checkbox still calls the original handler and honors disabled without imperative mutation', async () => {
    const element = document.createElement('div'), root = createRoot(element); document.body.append(element)
    let calls = 0
    try {
      for (const theme of components) {
        await act(async () => { themePreferences.set({ activeId: theme.id, installed: [] }); root.render(h('label', null, h(ThemeToggle, { checked: false, disabled: true, onChange: () => calls++ }), '操作')) })
        const input = element.querySelector<HTMLInputElement>('input')!
        input.click()
        expect(calls).toBe(0)
        expect(input.disabled).toBe(true)
      }
    } finally { await act(async () => root.unmount()); element.remove() }
  })
})
