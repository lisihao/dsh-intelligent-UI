import { appearancePreferences, appearanceTokens } from './appearance.js'
import type { ExperienceSettings } from './contracts.js'
import { pageAppearanceCss } from './page-appearance.js'
import { resolveTheme } from './theme-contracts.js'
import { themePreferences, themeStyleTokens } from './theme-runtime.js'
import { installThoughtDagThemeBridge } from './thoughtdag-theme.js'

/** One disposable, plugin-scoped stylesheet; equal refreshes leave CSS and animations intact. */
export function installAppearanceStyles(source: { snapshot(): { settings?: ExperienceSettings }; subscribe(listener: () => void): () => void }): () => void {
  const element = document.createElement('style')
  element.dataset.solarExperienceAppearance = 'true'
  let last = ''
  const variables = (settings?: ExperienceSettings) => { const theme = resolveTheme(settings?.theme); return themeStyleTokens(theme, appearanceTokens(settings?.appearance, theme)) }
  const sync = () => {
    const settings = source.snapshot().settings
    const preference = settings?.appearance
    const theme = resolveTheme(settings?.theme)
    themePreferences.set(settings?.theme)
    appearancePreferences.set(preference ?? theme.appearance)
    const declarations = Object.entries(variables(settings)).map(([name, value]) => `${name}:${value}`).join(';')
    const css = `.dsh-experience,.dsh-experience.iexp-content[data-experience-theme]{${declarations}}` + (settings?.takeover ? `[data-slot="conversation.view"],[data-dsh-thoughtdag]{${declarations}}` : '') + pageAppearanceCss(!!settings?.takeover)
    if (last !== css) { element.textContent = css; last = css }
  }
  sync(); document.head.append(element)
  const unsubscribe = source.subscribe(sync)
  const disposeFrames = installThoughtDagThemeBridge(source, variables)
  return () => { unsubscribe(); disposeFrames(); element.remove(); themePreferences.reset(); appearancePreferences.reset() }
}
