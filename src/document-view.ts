import { createElement as h, useSyncExternalStore, type ReactElement } from 'react'
import { appearancePreferences, appearanceTokens } from './appearance.js'
import { ContentView, rawText, type DisplayMode } from './presentation.js'
import { safeResearchUrl } from './research-content.js'
import { styles } from './style.js'
import { themePreferences } from './theme-runtime.js'

/** An external document owns its identity and original data; no session is created. */
export interface DocumentViewProps {
  documentId: string
  value: unknown
  raw?: unknown
  source?: { label?: string; url?: string }
  mode?: DisplayMode
  isStreaming?: boolean
}

/** Read-only rendering for a host-owned document. The owner controls the shared mode. */
export function DocumentView({ documentId, value, raw = value, source, mode = 'visual', isStreaming = false }: DocumentViewProps): ReactElement {
  const appearance = useSyncExternalStore(appearancePreferences.subscribe, appearancePreferences.getSnapshot, appearancePreferences.getSnapshot)
  const theme = useSyncExternalStore(themePreferences.subscribe, themePreferences.getSnapshot, themePreferences.getSnapshot)
  const scheme = appearanceTokens(appearance, theme).colorScheme
  const url = source?.url && safeResearchUrl(source.url)
  const label = source?.label?.trim() ? source.label : source?.url
  const sourceNode = label && h('div', { className: 'dsh-experience iexp-source-label' },
    h('span', null, '来源：'),
    url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label)
      : h('span', null, label, source?.url && source.url !== label ? ` · ${source.url}` : ''),
  )
  return h('article', { 'data-iexp-document-id': documentId, style: { minWidth: 0 } },
    sourceNode,
    h('div', { style: mode === 'compare' ? styles.compare : undefined },
      h('div', { hidden: mode === 'raw', style: { minWidth: 0 }, key: documentId }, h(ContentView, { value, isStreaming })),
      mode !== 'visual' && h('div', { className: 'dsh-experience iexp-content iexp-raw-output', 'data-experience-theme': scheme },
        h('strong', null, '原始内容'), h('pre', { style: styles.raw }, rawText(raw)),
      ),
    ),
  )
}
