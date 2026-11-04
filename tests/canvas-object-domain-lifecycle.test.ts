// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const classifier = vi.hoisted(() => vi.fn(() => ({ status: 'unclassified' as const })))
vi.mock('../src/canvas-auto-plan-domain.js', () => ({ classifyCanvasAutoDomain: classifier }))
import { CanvasObjectView } from '../src/canvas-object-view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('model domain inference lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); classifier.mockClear() })

  it('does not infer or fetch while the user prefers reduced motion, then infers when effects can run', async () => {
    let reduced = true
    let onChange: (() => void) | undefined
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return reduced },
      addEventListener(_type: string, callback: () => void) { onChange = callback },
      removeEventListener() { onChange = undefined },
    }))
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      disconnect() {}
    })
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    const value = { type: 'glb', src: '/fixture.glb', text: '```ts\nconst x = 1\n```' }
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: { field: 'src', reference: '/fixture.glb' }, dark: true })) })
      expect(classifier).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      await act(async () => { reduced = false; onChange?.() })
      expect(classifier).toHaveBeenCalledOnce()
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
