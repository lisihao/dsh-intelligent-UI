import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { appearanceTokens } from '../src/appearance.js'
import { themePackageSchema } from '../src/theme-contracts.js'
import { themeCatalogSchema } from '../src/theme-source.js'
import { themeStyleTokens } from '../src/theme-runtime.js'

const catalog = themeCatalogSchema.parse(JSON.parse(await readFile(new URL('../theme/index.json', import.meta.url), 'utf8')))
const entries = catalog.themes.filter(entry => entry.id.startsWith('unslop-'))
const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number)
function luminance(color: number[]): number {
  return color.slice(0, 3).reduce((sum, channel, index) => {
    const s = channel / 255
    return sum + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [ .2126, .7152, .0722 ][index]!
  }, 0)
}
function contrast(foreground: number[], surface: number[], underlay: number): number {
  const a = luminance(foreground), alpha = surface[3]!
  const b = luminance(surface.slice(0, 3).map(channel => channel * alpha + underlay * (1 - alpha)))
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

describe('downloadable reference themes', () => {
  it.each(entries)('$id keeps text, status and chart series readable on default and hover surfaces', async entry => {
    const theme = themePackageSchema.parse(JSON.parse(await readFile(new URL(`../theme/${entry.file}`, import.meta.url), 'utf8')))
    const rendered = appearanceTokens(theme.appearance, theme), roles = rendered.variables
    for (const [role, color] of Object.entries(roles).filter(([key]) => /^--iexp-(text|muted|accent|success|warning|error|series-\d+)$/.test(key))) {
      for (const surface of ['--iexp-bg', '--iexp-card', '--iexp-card-hover', '--iexp-soft']) for (const underlay of [0, 255]) {
        expect(contrast(channels(color), channels(roles[surface]!), underlay), `${entry.id}/${role}/${surface}/${underlay}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    const tokens = themeStyleTokens(theme, rendered)
    expect(Number.parseFloat(tokens['--iexp-hover-lift']!)).toBeLessThan(0)
    expect(tokens['--iexp-shadow-card']).not.toBe('none')
    expect(theme.license).toBe('CC-BY-4.0')
    expect(theme.description).toContain('https://github.com/heydamir/unslop')
  })
})
