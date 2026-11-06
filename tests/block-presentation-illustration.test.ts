// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContentView } from '../src/presentation.js'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { compileBlockLayout } from '../src/adaptive-ui/block-compiler.js'
import type { BaseCompositionSelection } from '../src/adaptive-ui/planner.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ComposeInput, CompositionResult } from '../src/adaptive-ui/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), byte => byte.charCodeAt(0))
const imageUrl = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`

function selection(overrides: Partial<BaseCompositionSelection> = {}): BaseCompositionSelection {
  return { themeId: 'plain', surface: 'semantic', chart: 'auto', componentSet: 'native', objectEffect: 'none', layout: 'document', ...overrides }
}
function nativeIllustrationResult(value: unknown): CompositionResult {
  const compiled = compileBlockLayout(value)
  return {
    status: 'selected', reason: 'JEV_SELECTION_ADOPTED', sourceVersion: 'sha256:native-illustration', operationId: 'native-illustration',
    selection: {
      ...selection(),
      blockLayout: {
        version: compiled.version, inspection: 'none',
        blocks: compiled.blocks.map(block => ({
          id: block.id, path: [...block.path], ...(block.start === undefined ? {} : { start: block.start }), ...(block.end === undefined ? {} : { end: block.end }),
          kind: block.kind, presentation: block.evidence.includes('source:illustration') || block.kind === 'structured-record' ? 'illustration-native' : 'reading',
          selection: selection(), evidence: [...block.evidence],
        })),
      },
    },
  } as CompositionResult
}
function settings(): ExperienceSettings {
  return { ...initialSettings(), revision: 1, takeover: true, adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true }, theme: { activeId: 'plain', installed: [] } }
}
function api(): CompositionApi {
  return {
    composition: vi.fn((input: ComposeInput) => Promise.resolve(nativeIllustrationResult(input.value))),
    compositionReceipt: vi.fn(async () => ({ status: 'observed' })),
    compositionCancel: vi.fn(async () => ({ cancelled: true })),
  }
}

async function render(value: unknown): Promise<{ host: HTMLDivElement, root: Root }> {
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(h(CompositionRuntimeContext.Provider, { value: { api: api(), sessionId: 'illustration-session', settings: settings() } }, h(ContentView, { value, documentId: 'illustration-document', sessionId: 'illustration-session' }))))
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()) })
  return { host, root }
}

describe('explicit native illustration blocks', () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each([
    ['Markdown data URI', `![illustration](${imageUrl} "原图标题")`, 'illustration'],
    ['structured image record', { type: 'image/png', role: 'illustration', url: imageUrl, alt: '结构化插画', title: '结构化标题' }, '结构化插画'],
  ] as const)('keeps a validated %s visible through the native image consumer with no object effect', async (_label, value, alt) => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => png.buffer })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/native-illustration')
    URL.revokeObjectURL = vi.fn()
    const item = await render(value)
    try {
      await act(async () => { await vi.waitFor(() => expect(item.host.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)).not.toBeNull()) })
      const image = item.host.querySelector<HTMLImageElement>(`img[alt="${alt}"]`)!
      expect(image.getAttribute('src')).toBe('blob:http://localhost/native-illustration')
      expect(item.host.querySelector('[data-iexp-presentation="illustration-native"]')).not.toBeNull()
      expect(fetchMock).toHaveBeenCalledWith(imageUrl, expect.objectContaining({ redirect: 'error' }))
    } finally {
      await act(async () => item.root.unmount())
    }
  })
})
