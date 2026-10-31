// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { themePreferences, themeStyleTokens } from '../src/theme-runtime.js'
import { builtInThemes, resolveTheme, type ThemePackage } from '../src/theme-contracts.js'
import { appearanceTokens } from '../src/appearance.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { ExperienceStore } from '../src/client.js'
import { initialSettings } from '../src/contracts.js'

afterEach(() => themePreferences.reset())
const custom = (): ThemePackage => ({ ...resolveTheme(), id: 'custom-forest', name: 'Forest', tokens: { ...resolveTheme().tokens, accentDark: '#80f2a1', paletteDark: ['#80f2a1','#e8c282','#ed9bae','#a4d5ea'], panelRadius: 18, cardRadius: 14, nodeRadius: 10, controlRadius: 8, font: 'serif', density: 'comfortable', hoverLift: 5, translucentAlpha: .9, blur: 12, comparison: 'standard', shadow: 'none' } })

describe('selected theme runtime', () => {
  it('keeps equal refreshes stable and notifies palette/font changes with unchanged appearance', () => {
    const original = themePreferences.getSnapshot(), seen: ThemePackage[] = []
    const dispose = themePreferences.subscribe(() => seen.push(themePreferences.getSnapshot()))
    themePreferences.set({ activeId: 'empryo', installed: [] })
    expect(themePreferences.getSnapshot()).toBe(original)
    const selected = custom(); themePreferences.set({ activeId: selected.id, installed: [selected] })
    const first = themePreferences.getSnapshot()
    themePreferences.set({ activeId: selected.id, installed: [structuredClone(selected)] })
    expect(themePreferences.getSnapshot()).toBe(first)
    themePreferences.set({ activeId: selected.id, installed: [{ ...selected, tokens: { ...selected.tokens, font: 'system' } }] })
    expect(seen).toHaveLength(2)
    expect(themePreferences.getSnapshot().tokens.font).toBe('system')
    dispose(); themePreferences.reset(); expect(seen).toHaveLength(2)
  })
  it('extracts accepted defaults and changes component roles for an imported theme', () => {
    const current = resolveTheme(), base = themeStyleTokens(current, appearanceTokens(undefined,current))
    expect(base['--iexp-panel-radius']).toBe('28px'); expect(base['--iexp-hover-lift']).toBe('-3px')
    expect(base['--iexp-bg']).toBe('rgba(36, 38, 43, 0.72)')
    const selected = custom(), tokens = themeStyleTokens(selected,appearanceTokens(undefined,selected))
    expect(tokens['--iexp-font']).toContain('serif'); expect(tokens['--iexp-font']).not.toContain('Recursive')
    expect(tokens['--iexp-panel-radius']).toBe('18px'); expect(tokens['--iexp-card-radius']).toBe('14px')
    expect(tokens['--iexp-node-radius']).toBe('10px'); expect(tokens['--iexp-control-radius']).toBe('8px')
    expect(tokens['--iexp-density']).toBe('1.18'); expect(tokens['--iexp-backdrop']).toBe('blur(12px) saturate(110%)')
    expect(tokens['--iexp-hover-lift']).toBe('-5px')
    for (const role of ['panel','card','focus','node','flow']) expect(tokens[`--iexp-shadow-${role}`]).toBe('none')
    const plain = builtInThemes.find(t=>t.id==='plain')!, quiet = themeStyleTokens(plain,appearanceTokens(undefined,plain))
    expect(quiet['--iexp-hover-lift']).toBe('0px'); expect(quiet['--iexp-backdrop']).toBe('none')
  })
  it('updates the same stylesheet for theme-only changes and restores all state on disposal', () => {
    const store = new ExperienceStore(), settings = { ...initialSettings(), takeover: true }
    store.update({ settings }); const dispose = installAppearanceStyles(store)
    try {
      const element = document.querySelector('[data-solar-experience-appearance]')!, initialChild = element.firstChild
      const theme = custom()
      store.update({ settings: { ...settings, theme: { activeId: theme.id, installed: [theme] } } })
      expect(document.querySelector('[data-solar-experience-appearance]')).toBe(element)
      expect(element.textContent).toContain('--iexp-font:Georgia')
      expect(element.textContent).toContain('--iexp-panel-radius:18px')
      expect(element.firstChild).not.toBe(initialChild)
      const nextChild = element.firstChild
      store.update({ settings: { ...settings, theme: { activeId: theme.id, installed: [structuredClone(theme)] } } })
      expect(element.firstChild).toBe(nextChild)
      store.update({ settings: { ...settings, takeover: false, theme: { activeId: theme.id, installed: [theme] } } })
      expect(element.textContent).not.toContain('[data-slot="conversation.view"]')
    } finally { dispose() }
    expect(themePreferences.getSnapshot().id).toBe('empryo')
    expect(document.querySelector('[data-solar-experience-appearance]')).toBeNull()
  })
})
