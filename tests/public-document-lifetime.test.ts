// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

const runtime = vi.hoisted(() => ({ load: vi.fn(), destroy: vi.fn() }))
vi.mock('../src/canvas-runtime-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/canvas-runtime-client.js')>(), loadCanvasEffect: runtime.load,
}))
import { apply } from '../src/client.js'
import type { IntelligentUiClient } from '../src/public-api.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function glb(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }))
  const length = Math.ceil(json.length / 4) * 4
  const bytes = new Uint8Array(20 + length)
  bytes.set([0x67, 0x6c, 0x54, 0x46])
  const header = new DataView(bytes.buffer); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true)
  header.setUint32(12, length, true); header.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20); bytes.set(json, 20)
  return bytes
}
function fixture() {
  const cleanups: Array<() => void> = [], services = new Map<string, unknown>()
  const ctx = {
    effect: (callback: () => () => void) => { const cleanup = callback(); cleanups.push(cleanup); return cleanup },
    provide: (key: string, service: unknown) => { services.set(key, service); return () => services.delete(key) },
    get: (key: string) => key === 'sessions' ? { using: vi.fn() } : key === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : services.get(key),
    on: () => () => {},
    slots: { register: () => () => {}, inject: (_name: string, callback: () => () => void) => callback(), entriesOfSlot: () => [], subscribe: () => () => {} },
    remote: { $mount: async () => async () => {} },
  } as unknown as Context
  apply(ctx)
  return { service: services.get('solarExperienceUi') as IntelligentUiClient, dispose: () => { for (const cleanup of cleanups.reverse()) cleanup() } }
}
function prepareBrowser() {
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => glb().buffer }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
  URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/model')
  URL.revokeObjectURL = vi.fn()
}

describe('public DocumentView lifetime', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

  it('destroys a live effect and returns to raw content when an external view outlives the plugin', async () => {
    prepareBrowser()
    runtime.load.mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy } })
    const { service, dispose } = fixture(), value = { type: 'model/gltf-binary', url: '/model.glb', caption: '原始模型' }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(service.DocumentView, { documentId: 'source', value, source: { url: 'https://example.test/research/source' } })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(host.querySelector('canvas')).not.toBeNull()
      await act(async () => dispose())
      expect(runtime.destroy).toHaveBeenCalledOnce()
      expect(host.querySelector('canvas')).toBeNull()
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
      expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.test/research/source')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('retains an explicitly null raw value after shutdown', async () => {
    const { service, dispose } = fixture()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(service.DocumentView, { documentId: 'source', value: 'visual', raw: null, source: { label: '原始来源', url: 'javascript:alert(1)' } })); dispose() })
      expect(host.querySelector('pre')?.textContent).toBe('null')
      expect(host.textContent).toContain('原始来源 · javascript:alert(1)')
      expect(host.querySelector('a')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('never creates an effect if plugin shutdown happens while a factory is loading', async () => {
    prepareBrowser()
    let finish!: (factory: (...args: unknown[]) => unknown) => void
    runtime.load.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { service, dispose } = fixture(), value = { type: 'model/gltf-binary', url: '/model.glb' }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    const factory = vi.fn(() => ({ destroy: runtime.destroy }))
    try {
      await act(async () => { root.render(h(service.DocumentView, { documentId: 'source', value })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalled()
      await act(async () => { dispose(); finish(factory); await Promise.resolve() })
      expect(factory).not.toHaveBeenCalled()
      expect(host.querySelector('canvas')).toBeNull()
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
