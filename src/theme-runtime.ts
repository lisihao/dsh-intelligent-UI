import { createContext, useContext, useSyncExternalStore } from 'react'
import { isAsciiTheme, resolveTheme, type ThemePackage, type ThemePreference } from './theme-contracts.js'

/** Selected theme only. Catalog/revision refreshes never remount existing content. */
const initial = resolveTheme()
let snapshot: ThemePackage = initial
let fingerprint = JSON.stringify(initial)
const listeners = new Set<() => void>()
export const themePreferences = {
  set(preference?: ThemePreference): void {
    const next = resolveTheme(preference), key = JSON.stringify(next)
    if (key === fingerprint) return
    fingerprint = key; snapshot = next
    for (const listener of [...listeners]) listener()
  },
  getSnapshot: (): ThemePackage => snapshot,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  reset(): void { themePreferences.set() },
}

/** A decision changes only this output; the user's persisted/global theme remains intact. */
export const PresentationThemeContext = createContext<ThemePackage | undefined>(undefined)
export function usePresentationTheme(): ThemePackage {
  const global = useSyncExternalStore(themePreferences.subscribe, themePreferences.getSnapshot, themePreferences.getSnapshot)
  return useContext(PresentationThemeContext) ?? global
}

/** Fixed-unit component vocabulary shared by output, graphs and compatible owner pages. */
export function themeStyleTokens(theme: ThemePackage, appearance: { variables: Record<string, string> }): Record<string, string> {
  const t = theme.tokens, px = (value: number) => `${value}px`
  const depth = (value: string) => t.shadow === 'none' ? 'none' : value
  const mono = t.font === 'mono'
  const terminalFont = 'Menlo, "SFMono-Regular", Consolas, "Liberation Mono", "DSH Recursive", "Noto Sans Mono CJK SC", "Sarasa Mono SC", "Heiti SC", monospace'
  const font = mono ? terminalFont
    : t.font === 'system' ? '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    : t.font === 'serif' ? 'Georgia, "Songti SC", "Noto Serif CJK SC", serif'
    : '"DSH Recursive", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
  return { ...appearance.variables,
    '--iexp-presentation': isAsciiTheme(theme) ? 'ascii' : 'standard', '--iexp-font-mono': mono ? '1' : '0',
    '--iexp-font': font, '--iexp-code-font': mono ? terminalFont : t.font === 'recursive' ? '"DSH Recursive", "SF Mono", monospace' : '"SF Mono", Consolas, monospace', '--iexp-density': t.density === 'compact' ? '1' : '1.18',
    '--iexp-panel-radius': px(t.panelRadius), '--iexp-panel-radius-narrow': px(Math.min(t.panelRadius, 24)),
    '--iexp-page-card-radius': px(Math.max(0,t.cardRadius - 2)), '--iexp-card-radius': px(t.cardRadius), '--iexp-node-radius': px(t.nodeRadius),
    '--iexp-small-control-radius': px(t.controlRadius / 2), '--iexp-control-radius': px(t.controlRadius), '--iexp-canvas-radius': px(Math.max(0, t.panelRadius - 4)),
    '--iexp-source-radius': px(Math.max(0, t.cardRadius - 4)), '--iexp-list-radius': px(Math.max(0, t.cardRadius - 6)),
    '--iexp-field-radius': px(Math.max(0, t.controlRadius - 2)), '--iexp-code-radius': px(t.controlRadius),
    '--iexp-hover-lift': px(-t.hoverLift), '--iexp-canvas-lift': px(-Math.max(0, t.hoverLift - 1)),
    '--iexp-shadow-panel': depth('0 16px 42px -24px var(--iexp-shadow)'),
    '--iexp-shadow-card': depth('0 10px 28px -14px var(--iexp-shadow), inset 0 1px 0 color-mix(in srgb,var(--iexp-text) 7%,transparent)'),
    '--iexp-shadow-focus': depth('0 18px 38px -18px var(--iexp-shadow), inset 0 1px 0 color-mix(in srgb,var(--iexp-text) 9%,transparent)'),
    '--iexp-shadow-node': depth('0 8px 22px -12px var(--iexp-shadow), inset 0 1px 0 color-mix(in srgb,var(--iexp-text) 7%,transparent)'),
    '--iexp-shadow-flow': depth('0 10px 28px -14px var(--iexp-shadow)'),
  }
}
