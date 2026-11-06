// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test } from 'vitest'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import { UiverseBlockView, UiverseHostEventPortContext } from '../src/uiverse/runtime-view.js'
import type { ExecutableComponentDispatch } from '../src/adaptive-ui/executable-registry.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root, host: HTMLDivElement }> = []
function selection(): ExecutableComponentDispatch {
  return { id: 'uiverse:Cards/demo-card', family: 'uiverse-cards', rendererKey: 'uiverse-shadow-v1', actionIds: [], input: { componentId: 'Cards/demo-card', values: { mode: 'read-only', projectedTextIds: ['fragment/article[0]#text[0]'] } } }
}
const component = {
  id: 'Cards/demo-card', title: 'Card', category: 'Cards', sourceSha256: 'a'.repeat(64), source: '<article class="card">Author demo</article>', availability: 'interactive', selectableWhenBound: true, capabilities: ['content', 'decoration'],
  visualCharacteristics: { basis: 'source-declared-css-and-markup', rootTags: ['article'], elementCount: 1, declared: { shadows: false, rounded: false, borders: false, gradients: false, transparency: false, blur: false, transform3d: false, motion: false, keyframes: false, pseudoElements: false, layouts: [] }, colorTokens: [] },
  inputSchema: { requiredReadOnly: ['fragment/article[0]#text[0]'], requiredInteractive: ['fragment/article[0]#text[0]'], textIds: ['fragment/article[0]#text[0]'], fieldIds: [], actionIds: [], imageIds: [] },
  targets: [{ id: 'fragment/article[0]#text[0]', path: 'fragment/article[0]', tag: 'article', kind: 'text', textIndex: 0, semanticRole: 'content' }], blockers: [], notes: [],
}
afterEach(async () => { for (const item of mounted.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }; document.body.replaceChildren() })

describe('UiverseBlockView', () => {
  test('fetches same-ID fixed component and projects trusted light DOM into its native slot', async () => {
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host); mounted.push({ host, root })
    const api = { uiverseRuntimeComponent: async () => ({ component, sharedCss: '.card{border-radius:12px}' }) } as unknown as CompositionApi
    await act(async () => { root.render(h(CompositionRuntimeContext.Provider, { value: { api, sessionId: 'session' } }, h(UiverseHostEventPortContext.Provider, { value: () => {} }, h(UiverseBlockView, { selection: selection(), renderMarkdown: source => source }, h('code', null, 'trusted-code'))))) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const runtimeHost = host.querySelector('[data-uiverse-runtime-host]') as HTMLElement
    expect(runtimeHost.shadowRoot?.querySelector('slot')).not.toBeNull()
    expect(runtimeHost.shadowRoot?.textContent).not.toContain('Author demo')
    expect(runtimeHost.querySelector('[data-uiverse-runtime-light-dom] code')?.textContent).toBe('trusted-code')
  })

  test('refuses an interactive mount before source DOM is fetched when no Host event port exists', async () => {
    const button = {
      ...component, id: 'Buttons/demo-button', category: 'Buttons', source: '<button>Author action</button>', capabilities: ['action', 'content', 'decoration'],
      inputSchema: { requiredReadOnly: ['fragment/button[0]#text[0]'], requiredInteractive: ['fragment/button[0]#text[0]', 'fragment/button[0]'], textIds: ['fragment/button[0]#text[0]'], fieldIds: [], actionIds: ['fragment/button[0]'], imageIds: [] },
      targets: [{ id: 'fragment/button[0]#text[0]', path: 'fragment/button[0]', tag: 'button', kind: 'text', textIndex: 0, semanticRole: 'label' }, { id: 'fragment/button[0]', path: 'fragment/button[0]', tag: 'button', kind: 'action' }],
    }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host); mounted.push({ host, root })
    const api = { uiverseRuntimeComponent: async () => ({ component: button }) } as unknown as CompositionApi
    const interactive: ExecutableComponentDispatch = { id: 'uiverse:Buttons/demo-button', family: 'uiverse-buttons', rendererKey: 'uiverse-shadow-v1', actionIds: ['open-evidence'], input: { componentId: 'Buttons/demo-button', values: { mode: 'interactive', text: { 'fragment/button[0]#text[0]': '查看依据' }, actions: { 'fragment/button[0]': { actionId: 'open-evidence' } } } } }
    await act(async () => { root.render(h(CompositionRuntimeContext.Provider, { value: { api, sessionId: 'session' } }, h(UiverseBlockView, { selection: interactive, renderMarkdown: source => source }))) })
    expect(host.querySelector('[data-uiverse-runtime-failure="UIVERSE_HOST_EVENT_PORT_MISSING"]')).not.toBeNull()
  })

  test.each([undefined, null, ''])('refuses a projected content slot without actual Root Host children (%p)', async children => {
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host); mounted.push({ host, root })
    const api = { uiverseRuntimeComponent: async () => ({ component, sharedCss: '.card{border-radius:12px}' }) } as unknown as CompositionApi
    await act(async () => { root.render(h(CompositionRuntimeContext.Provider, { value: { api, sessionId: 'session' } }, h(UiverseHostEventPortContext.Provider, { value: () => {} }, h(UiverseBlockView, { selection: selection(), renderMarkdown: source => source }, children)))) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.querySelector('[data-uiverse-runtime-failure="UIVERSE_CONTENT_PROJECTION_CHILDREN_MISSING"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Author demo')
    expect(host.querySelector('[data-uiverse-runtime-host]')).toBeNull()
  })
})
