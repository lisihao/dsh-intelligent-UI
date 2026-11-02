import { afterEach, describe, expect, it } from 'vitest'
import { appearancePreferences, appearanceTokens, type Appearance } from '../src/appearance.js'
import { defaultAppearance } from '../src/contracts.js'
import { resolveTheme } from '../src/theme-contracts.js'

afterEach(() => appearancePreferences.reset())

function channels(value: string): number[] { return value.match(/[\d.]+/g)!.map(Number) }
function luminance(color: number[]): number {
  const linear = color.map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}
function contrast(text: number[], surface: number[], underlay: number): number {
  const alpha = surface[3]!
  const backdrop = surface.slice(0, 3).map((channel) => channel * alpha + underlay * (1 - alpha))
  const a = luminance(text), b = luminance(backdrop)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('appearanceTokens', () => {
  it('defaults to a dark gray translucent content surface', () => {
    const tokens = appearanceTokens()
    expect(tokens.colorScheme).toBe('dark')
    expect(tokens.variables['--iexp-bg']).toBe('rgba(36, 38, 43, 0.72)')
    expect(tokens.variables['--iexp-backdrop']).toBe('blur(4px) saturate(110%)')
    expect(tokens.variables['--iexp-card']).not.toEqual(tokens.variables['--iexp-bg'])
    expect(tokens.variables['--iexp-card-hover']).not.toEqual(tokens.variables['--iexp-card'])
    expect(tokens.variables['--iexp-accent']).not.toBe(tokens.variables['--iexp-text'])
    expect(tokens.variables['--iexp-shadow']).toBe('rgba(0, 0, 0, 0.38)')
    expect(tokens.variables['--iexp-shadow']).toMatch(/^rgba\([\d., ]+\)$/)
    expect(channels(tokens.variables['--iexp-card']!)[0]).toBeGreaterThan(channels(tokens.variables['--iexp-bg']!)[0]!)
    expect(channels(tokens.variables['--iexp-card-hover']!)[0]).toBeGreaterThan(channels(tokens.variables['--iexp-card']!)[0]!)
  })

  it('disables transparency and backdrop blur without discarding the selected color', () => {
    const tokens = appearanceTokens({ backgroundColor: '#a1B2c3', translucent: false })
    expect(tokens.colorScheme).toBe('light')
    expect(tokens.variables['--iexp-bg']).toBe('rgba(161, 178, 195, 1)')
    expect(tokens.variables['--iexp-backdrop']).toBe('none')
    expect(tokens.variables['--iexp-shadow']).toBe('rgba(0, 0, 0, 0.14)')
  })

  it('keeps main and muted text readable over extreme underlays for dark, light, midtone and saturated custom colors', () => {
    for (const backgroundColor of ['#24262b', '#fafafa', '#777777', '#666666', '#818181', '#fe0000', '#00ff00', '#0000ff', '#a174af', '#be3a48', '#3f9165', '#b27d2b', '#98b0c2']) {
      for (const translucent of [true, false]) {
        const { variables } = appearanceTokens({ backgroundColor, translucent })
        for (const surface of ['--iexp-bg', '--iexp-card', '--iexp-card-hover', '--iexp-soft']) {
          for (const text of ['--iexp-text', '--iexp-muted', '--iexp-accent', '--iexp-success', '--iexp-warning', '--iexp-error']) {
            for (const underlay of [0, 255]) expect(contrast(channels(variables[text]!), channels(variables[surface]!), underlay), `${backgroundColor}/${translucent} ${text} on ${surface}/${underlay}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
    expect(channels(appearanceTokens({ backgroundColor: '#777777', translucent: true }).variables['--iexp-bg']!)[3]).toBeGreaterThan(0.86)
  })

  it('protects contrast for custom accents and status colors on the chosen appearance override', () => {
    const selected = resolveTheme()
    if (selected.formatVersion !== 1) throw new Error('The default Empryo fixture must remain V1.')
    const theme = { ...selected, id: 'custom-low-contrast', tokens: { ...selected.tokens, accentDark: '#272727', accentLight: '#eeeeee', success: '#242424', warning: '#222222', error: '#333333', translucentAlpha: 0.3, blur: 24 } }
    for (const backgroundColor of ['#24262b', '#fafafa', '#777777', '#fe0000']) {
      const { variables } = appearanceTokens({ backgroundColor, translucent: true }, theme)
      for (const role of ['--iexp-text','--iexp-muted','--iexp-accent','--iexp-success','--iexp-warning','--iexp-error','--iexp-series-1','--iexp-series-2','--iexp-series-3','--iexp-series-4']) for (const surface of ['--iexp-bg','--iexp-card','--iexp-card-hover','--iexp-soft']) for (const underlay of [0,255]) expect(contrast(channels(variables[role]!), channels(variables[surface]!),underlay)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('rejects untrusted colors and unknown fields instead of emitting injectable CSS', () => {
    for (const backgroundColor of ['red', '#fff', '#123456; color:red', 'url(https://example.com)']) {
      expect(() => appearanceTokens({ backgroundColor, translucent: true })).toThrow()
    }
    expect(() => appearanceTokens({ ...defaultAppearance(), opacity: 0.5 } as Appearance)).toThrow()
  })

  it('preserves text contrast across a representative RGB gamut rather than just neutral themes', () => {
    for (const red of [0, 51, 102, 153, 204, 255]) for (const green of [0, 51, 102, 153, 204, 255]) for (const blue of [0, 51, 102, 153, 204, 255]) {
      const backgroundColor = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
      const { variables } = appearanceTokens({ backgroundColor, translucent: true })
      for (const role of ['--iexp-accent', '--iexp-success', '--iexp-warning', '--iexp-error']) expect(contrast(channels(variables['--iexp-button-text']!), [...channels(variables[role]!), 1], 0)).toBeGreaterThanOrEqual(4.5)
      for (const surface of ['--iexp-bg', '--iexp-card', '--iexp-card-hover', '--iexp-soft']) for (const text of ['--iexp-text', '--iexp-muted', '--iexp-accent', '--iexp-success', '--iexp-warning', '--iexp-error']) for (const underlay of [0, 255]) {
        expect(contrast(channels(variables[text]!), channels(variables[surface]!), underlay), `${backgroundColor}/${surface}/${text}/${underlay}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('appearancePreferences', () => {
  it('exposes stable snapshots, notifies only changes, unsubscribes and restores defaults', () => {
    const initial = appearancePreferences.getSnapshot(), seen: Appearance[] = []
    expect(appearancePreferences.getSnapshot()).toBe(initial)
    const unsubscribe = appearancePreferences.subscribe(() => seen.push(appearancePreferences.getSnapshot()))
    appearancePreferences.set(defaultAppearance())
    expect(appearancePreferences.getSnapshot()).toBe(initial)
    expect(seen).toEqual([])
    appearancePreferences.set({ backgroundColor: '#fafafa', translucent: false })
    const selected = appearancePreferences.getSnapshot()
    appearancePreferences.set({ backgroundColor: '#FAFAFA', translucent: false })
    expect(appearancePreferences.getSnapshot()).toBe(selected)
    expect(seen).toEqual([selected])
    appearancePreferences.reset()
    expect(appearancePreferences.getSnapshot()).toBe(initial)
    expect(seen).toHaveLength(2)
    unsubscribe()
    appearancePreferences.set({ backgroundColor: '#000000', translucent: true })
    expect(seen).toHaveLength(2)
  })

  it('validates the external store boundary and keeps its snapshot after rejection', () => {
    const initial = appearancePreferences.getSnapshot()
    expect(() => appearancePreferences.set({ backgroundColor: 'not-a-color', translucent: true })).toThrow()
    expect(appearancePreferences.getSnapshot()).toBe(initial)
  })
})
