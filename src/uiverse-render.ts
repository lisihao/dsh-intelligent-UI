import { createContext, createElement as h, useContext, type ReactNode } from 'react'
import type { ComponentSet, ThemePackage } from './theme-contracts.js'
import sources from './uiverse-sources.json' with { type: 'json' }

/** Deterministic semantic roles already established by the content analyzers, never inferred from arbitrary HTML. */
export type UiverseRenderRole = 'content' | 'chart' | 'task' | 'record' | 'flow'
export type UiverseElementRole = 'button' | 'input' | 'toggle' | 'card' | 'loader'
const roleSets: Record<UiverseRenderRole, ComponentSet> = { content: 'soft-relief', chart: 'clear-glass', task: 'soft-relief', record: 'clear-glass', flow: 'soft-relief' }
const RenderRole = createContext<UiverseRenderRole | undefined>(undefined)
export function UiverseRenderScope({ role, children }: { role: UiverseRenderRole; children?: ReactNode }) { return h(RenderRole.Provider, { value: role }, children) }
export const useUiverseRenderRole = () => useContext(RenderRole)

/** V2 is authoritative. V1 reuses its own tokens with a bounded compiled adapter only inside owned content. */
export function resolveUiverseAdapter(theme: ThemePackage, element: UiverseElementRole, role?: UiverseRenderRole, explicit?: ComponentSet | 'native') {
  const set = explicit ?? (theme.formatVersion === 2 ? theme.componentSet : role ? roleSets[role] : 'native')
  if (set === 'native') return undefined
  const source = sources.sets[set].find(item => item.role === element)!
  return { componentSet: set, mode: theme.formatVersion === 1 && explicit === undefined ? 'contextual' as const : 'theme' as const, role: role ?? 'theme', sourceId: source.file.replace(/\.html$/, ''), sha256: source.sha256 }
}
export function uiverseAdapterAttributes(choice: ReturnType<typeof resolveUiverseAdapter>) {
  return choice ? {
    'data-iexp-component-set': choice.componentSet,
    'data-iexp-component-mode': choice.mode,
    'data-iexp-uiverse-role': choice.role,
    'data-iexp-uiverse-source': choice.sourceId,
    'data-iexp-uiverse-sha256': choice.sha256,
  } : {}
}
