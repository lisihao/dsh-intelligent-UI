// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-object-view.js', () => ({
  glbSource: (value: { type?: string, role?: string, url?: string }) => value.role === 'illustration' && value.url
    ? { field: 'url', reference: value.url, kind: 'image', mime: value.type } : undefined,
  CanvasObjectView: ({ originalView }: { originalView?: ReactNode }) => h('div', { 'data-illustration-effect': 'eligible' }, originalView),
}))
import { ContentView, OutputView } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Markdown illustration presentation', () => {
  it('enhances an explicitly identified illustration while retaining the original image and whole raw Markdown', async () => {
    const source = '# Report\n\n![技术插画](/art.png "画作标题")\n\n![Sales chart](/chart.png)'
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(OutputView, { sessionId: 'markdown-check', raw: source, mode: 'compare' }, h(ContentView, { value: source }))))
      const effect = host.querySelector('[data-illustration-effect]')
      expect(effect?.querySelector('img')?.getAttribute('alt')).toBe('技术插画')
      expect(effect?.querySelector('img')?.getAttribute('src')).toBe('/art.png')
      expect(effect?.querySelector('img')?.getAttribute('title')).toBe('画作标题')
      expect(host.querySelectorAll('[data-illustration-effect]')).toHaveLength(1)
      expect(host.querySelector('img[alt="Sales chart"]')?.closest('[data-illustration-effect]')).toBeNull()
      expect(host.querySelector('.iexp-raw-output pre')?.textContent).toBe(source)
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the normal Markdown path while streaming', async () => {
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ContentView, { value: '![illustration](/art.png)', isStreaming: true })))
      expect(host.querySelector('[data-illustration-effect]')).toBeNull()
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/art.png')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
