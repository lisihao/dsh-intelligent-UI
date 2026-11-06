import { createElement as h, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RuneThemeRegion } from '../../../src/rune/theme-view.js'
import type { ComponentRuntimeInfo } from '../../../src/component-runtime-contracts.js'

declare global {
  interface Window {
    __runeProductionRuntimeInfo: ComponentRuntimeInfo
    __runeProductionProof?: Readonly<Record<string, unknown>>
  }
}

function sourceBody(onAction: () => void) {
  return h('article', { id: 'rune-source-document', 'aria-label': 'Rune source document' },
    h('h1', null, 'Rune owned material keeps this DOM source'),
    h('p', null, 'Source text, units, links, code, focus and local actions remain normal DOM above Rust WebGPU.'),
    h('section', { id: 'native-card', 'data-iexp-block-id': 'native-card', style: { padding: 18, marginTop: 14, background: '#252735', border: '1px solid #70758f', borderRadius: 16 } },
      h('h2', null, 'Native Rune shell'),
      h('p', null, 'A real DOM paragraph over a core Rune surface.'),
    ),
    h('section', { id: 'glass-card', 'data-rune-material': 'fluted-glass', style: { padding: 18, marginTop: 14, background: '#324d6a', border: '1px solid #a8c9e6', borderRadius: 18 } },
      h('h2', null, 'Real FlutedGlass'),
      h('p', null, 'The Rust glass samples only Rune content painted earlier in its owned opaque canvas.'),
    ),
    h('button', { id: 'rune-action', type: 'button', onClick: onAction, style: { marginTop: 14, minHeight: 42, padding: '8px 16px', background: '#2a2d40', color: '#f2f4ff', border: '1px solid #c9d2ff', borderRadius: 12 } }, 'Run local DOM action'),
    h('input', { id: 'rune-input', 'aria-label': 'Rune source input', defaultValue: '42.0 ms', style: { display: 'block', marginTop: 12, padding: 8, background: '#262a38', color: '#f2f4ff', border: '1px solid #8d94af', borderRadius: 10 } }),
    h('pre', { id: 'rune-code', style: { marginTop: 14, padding: 12, background: '#151722', color: '#dce6ff', overflow: 'auto' } }, h('code', null, 'const source = "must stay native";')),
    h('section', { id: 'foreign-card', 'data-iexp-executable-component': 'uiverse:soft-relief:card', style: { marginTop: 14, padding: 16, background: '#593c2e', border: '1px solid #d9a06a', borderRadius: 14 } },
      h('strong', null, 'Foreign Uiverse material remains untouched'),
    ),
  )
}

function App() {
  const [enabled, setEnabled] = useState(true)
  const [epoch, setEpoch] = useState(0)
  const [actions, setActions] = useState(0)
  const getRuntimeInfo = useCallback(async () => window.__runeProductionRuntimeInfo, [])
  useEffect(() => {
    window.__runeProductionProof = Object.freeze({
      snapshot: () => {
        const region = document.querySelector<HTMLElement>('[data-rune-region]')
        const source = document.querySelector<HTMLElement>('[data-rune-source]')
        const frame = document.querySelector<HTMLIFrameElement>('[data-rune-frame]')
        const code = document.querySelector('#rune-code')
        const foreign = document.querySelector('#foreign-card')
        return {
          enabled,
          actions,
          regionState: region?.getAttribute('data-rune-region') ?? null,
          sourceText: source?.textContent ?? null,
          sourcePresent: !!source,
          frame: frame ? { sandbox: frame.getAttribute('sandbox'), src: frame.src, width: frame.style.width, height: frame.style.height, transform: frame.style.transform, visibility: frame.style.visibility } : null,
          sourceMarkers: [...document.querySelectorAll('[data-rune-surface]')].map(element => ({ id: element.getAttribute('data-rune-surface'), role: element.getAttribute('data-rune-surface-role'), material: element.getAttribute('data-rune-rendered-material') })),
          codeMarked: code?.hasAttribute('data-rune-surface') ?? false,
          foreignMarked: foreign?.hasAttribute('data-rune-surface') ?? false,
          foreignBackground: foreign instanceof HTMLElement ? getComputedStyle(foreign).backgroundColor : null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      },
      dispose: () => setEnabled(false),
      remount: () => { setEnabled(true); setEpoch(value => value + 1) },
    })
  }, [actions, enabled, epoch])
  return h('main', { id: 'rune-production-fixture' },
    h('div', { id: 'proof-controls' },
      h('output', { id: 'action-count', 'aria-live': 'polite' }, `Local actions: ${String(actions)}`),
      h('button', { id: 'proof-remount', type: 'button', onClick: () => { setEnabled(true); setEpoch(value => value + 1) } }, 'Remount Rune region'),
      h('button', { id: 'proof-dispose', type: 'button', onClick: () => setEnabled(false) }, 'Dispose Rune region'),
    ),
    h(RuneThemeRegion, { key: epoch, getRuntimeInfo: enabled ? getRuntimeInfo : undefined }, sourceBody(() => setActions(value => value + 1))),
  )
}

createRoot(document.querySelector('#app')!).render(h(App))
