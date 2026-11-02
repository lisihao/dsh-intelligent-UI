import { appearanceSchema, defaultAppearance } from './contracts.js'
import { resolveTheme, type ThemePackage } from './theme-contracts.js'

export type Appearance = ReturnType<typeof defaultAppearance>
type RGB = [number, number, number]

const black: RGB = [0, 0, 0]
const white: RGB = [255, 255, 255]
const mix = (from: RGB, to: RGB, amount: number): RGB => from.map((channel, index) => Math.round(channel + (to[index]! - channel) * amount)) as RGB
const luminance = (color: RGB): number => color.reduce((sum, channel, index) => {
  const srgb = channel / 255
  return sum + (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!
}, 0)
const contrast = (a: RGB, b: RGB): number => {
  const first = luminance(a), second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}
const rgb = (color: RGB): string => `rgb(${color.join(', ')})`
const rgba = (color: RGB, alpha: number): string => `rgba(${color.join(', ')}, ${alpha})`

export function appearanceTokens(preference?: Appearance, theme: ThemePackage = resolveTheme()): { colorScheme: 'light' | 'dark'; backgroundOpacity: number; variables: Record<string, string> } {
  const appearance = appearanceSchema.parse(preference ?? theme.appearance)
  const base = [1, 3, 5].map((start) => Number.parseInt(appearance.backgroundColor.slice(start, start + 2), 16)) as RGB
  const minimumContrast = (foreground: RGB, surfaces: RGB[], alpha: number): number => Math.min(...surfaces.flatMap((surface) =>
    [black, white].map((underlay) => contrast(foreground, surface.map((channel, index) => channel * alpha + underlay[index]! * (1 - alpha)) as RGB))))
  let alpha = appearance.translucent ? (appearance.backgroundOpacity ?? theme.tokens.translucentAlpha) : 1
  const candidates = [black, white].filter((color) => contrast(color, base) >= 4.5)
  const foreground = candidates.sort((a, b) => minimumContrast(b, [base], alpha) - minimumContrast(a, [base], alpha))[0]!
  const colorScheme = foreground === white ? 'dark' : 'light'
  const raised = (amount: number): RGB => {
    let candidate = mix(base, foreground, amount)
    // Near a midtone contrast boundary, keep the raised tone within the readable range.
    while (amount > 0 && contrast(foreground, candidate) < 4.5) {
      amount = Math.max(0, Math.round((amount - 0.001) * 1000) / 1000)
      candidate = mix(base, foreground, amount)
    }
    return candidate
  }
  const card = raised(0.035), hover = raised(0.065), soft = raised(0.025)
  const surfaces = [base, card, hover, soft]
  // Theme defaults protect contrast over either extreme underlay. An explicit slider choice honors the chosen background opacity; text itself remains solid.
  while (appearance.backgroundOpacity === undefined && alpha < 1 && minimumContrast(foreground, surfaces, alpha) < 4.5) alpha = Math.min(1, Math.round((alpha + 0.001) * 1000) / 1000)
  let muted = foreground
  for (let amount = 64; amount <= 100; amount++) {
    const candidate = mix(base, foreground, amount / 100)
    if (minimumContrast(candidate, surfaces, alpha) >= 4.5) { muted = candidate; break }
  }
  const buttonText = foreground === white ? black : white
  const readableRole = (reference: RGB): RGB => {
    for (let amount = 0; amount <= 100; amount++) {
      const candidate = mix(reference, foreground, amount / 100)
      if (minimumContrast(candidate, surfaces, alpha) >= 4.5 && contrast(buttonText, candidate) >= 4.5) return candidate
    }
    return foreground
  }
  const fromHex = (hex: string): RGB => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16)) as RGB
  const accent = readableRole(fromHex(colorScheme === 'dark' ? theme.tokens.accentDark : theme.tokens.accentLight))
  const success = readableRole(fromHex(theme.tokens.success)), warning = readableRole(fromHex(theme.tokens.warning)), error = readableRole(fromHex(theme.tokens.error))
  return { colorScheme, backgroundOpacity: alpha, variables: {
    '--iexp-color-scheme': colorScheme,
    '--iexp-bg': rgba(base, alpha),
    '--iexp-card': rgba(card, alpha),
    // Reading overlays need an opaque local surface without changing report transparency.
    '--iexp-solid-bg': rgb(base),
    '--iexp-solid-card': rgb(card),
    '--iexp-card-hover': rgba(hover, alpha),
    '--iexp-line': rgba(foreground, colorScheme === 'dark' ? 0.18 : 0.16),
    '--iexp-text': rgb(foreground),
    '--iexp-muted': rgb(muted),
    '--iexp-accent': rgb(accent),
    '--iexp-soft': rgba(soft, alpha),
    '--iexp-success': rgb(success),
    '--iexp-warning': rgb(warning),
    '--iexp-error': rgb(error),
    '--iexp-button-text': rgb(buttonText),
    ...Object.fromEntries((colorScheme === 'dark' ? theme.tokens.paletteDark : theme.tokens.paletteLight).map((color,index) => [`--iexp-series-${index + 1}`, theme.id === 'empryo' ? color : rgb(readableRole(fromHex(color)))])),
    '--iexp-shadow': rgba(black, colorScheme === 'dark' ? 0.38 : 0.14),
    '--iexp-backdrop': appearance.translucent && theme.tokens.blur > 0 ? `blur(${theme.tokens.blur}px) saturate(110%)` : 'none',
  } }
}

const initial = Object.freeze(defaultAppearance())
let snapshot: Appearance = initial
const listeners = new Set<() => void>()
export const appearancePreferences = {
  set(value?: Appearance): void {
    const next = value === undefined ? initial : Object.freeze(appearanceSchema.parse(value))
    if (next.backgroundColor.toLowerCase() === snapshot.backgroundColor.toLowerCase() && next.translucent === snapshot.translucent && next.backgroundOpacity === snapshot.backgroundOpacity) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  },
  getSnapshot: (): Appearance => snapshot,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  reset(): void { appearancePreferences.set() },
}
