// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { themePreferences, themeStyleTokens } from '../src/theme-runtime.js'
import { builtInThemes, resolveTheme, type ThemePackage } from '../src/theme-contracts.js'
import { appearanceTokens } from '../src/appearance.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { ExperienceStore } from '../src/client.js'
import { initialSettings } from '../src/contracts.js'

afterEach(() => themePreferences.reset())
const custom = (): Extract<ThemePackage, { formatVersion: 1 }> => {
  const base = resolveTheme()
  if (base.formatVersion !== 1) throw new Error('The default theme must remain a V1 package.')
  return { ...base, id: 'custom-forest', name: 'Forest', tokens: { ...base.tokens, accentDark: '#80f2a1', paletteDark: ['#80f2a1','#e8c282','#ed9bae','#a4d5ea'], panelRadius: 18, cardRadius: 14, nodeRadius: 10, controlRadius: 8, font: 'serif', density: 'comfortable', hoverLift: 5, translucentAlpha: .9, blur: 12, comparison: 'standard', shadow: 'none' } }
}

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
  it('switches ASCII tokens on and restores every presentation/font token when switching back', () => {
    themePreferences.set({ activeId: 'ascii', installed: [] })
    const ascii = themePreferences.getSnapshot(), tokens = themeStyleTokens(ascii, appearanceTokens(undefined, ascii))
    expect(tokens['--iexp-presentation']).toBe('ascii')
    expect(tokens['--iexp-font-mono']).toBe('1')
    expect(tokens['--iexp-font']).toContain('"DSH Recursive"')
    expect(tokens['--iexp-font']).toContain('monospace')
    expect(tokens['--iexp-code-font']).toContain('"DSH Recursive"')
    expect(tokens['--iexp-bg']).toBe('rgba(25, 28, 25, 0.85)')
    expect(tokens['--iexp-panel-radius']).toBe('12px')
    expect(tokens['--iexp-hover-lift']).toBe('-2px')
    themePreferences.set({ activeId: 'empryo', installed: [] })
    const restored = themePreferences.getSnapshot(), other = themeStyleTokens(restored, appearanceTokens(undefined, restored))
    expect(other['--iexp-presentation']).toBe('standard')
    expect(other['--iexp-font-mono']).toBe('0')
    expect(other['--iexp-font']).not.toContain('monospace')
    expect(other['--iexp-bg']).toBe('rgba(36, 38, 43, 0.72)')
    expect(other['--iexp-panel-radius']).toBe('28px')
    expect(other['--iexp-hover-lift']).toBe('-3px')
  })
  it('keeps the four ASCII chart colors distinct and readable in dark and light appearances', () => {
    const ascii = resolveTheme({ activeId: 'ascii', installed: [] })
    const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number)
    const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, c, index) => {
      const channel = c / 255
      return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]!
    }, 0)
    for (const preference of [undefined, { backgroundColor: '#f5f7f1', translucent: false }]) {
      const variables = appearanceTokens(preference, ascii).variables
      const colors = [1, 2, 3, 4].map(index => variables[`--iexp-series-${index}`]!)
      expect(new Set(colors).size).toBe(4)
      for (const color of colors) for (const surface of ['--iexp-bg', '--iexp-card', '--iexp-card-hover', '--iexp-soft']) {
        const bg = channels(variables[surface]!), fg = luminance(channels(color)), opacity = bg[3]!
        for (const underlay of [0, 255]) {
          const blended = bg.slice(0, 3).map(channel => channel * opacity + underlay * (1 - opacity))
          const back = luminance(blended)
          expect((Math.max(fg, back) + .05) / (Math.min(fg, back) + .05)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
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
