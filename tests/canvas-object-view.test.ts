// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn(), destroy: vi.fn() }))
vi.mock('../src/canvas-runtime-client.js', () => ({
  loadCanvasEffect: runtime.load,
  acquireCanvasSlot: (activate: () => void) => { activate(); return runtime.release },
}))
import { CanvasObjectView, glbSource, isGlb, modelDomain, readGlbResponse } from '../src/canvas-object-view.js'
import { ContentView } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fixtureGlb(): Uint8Array {
  const bytes = new Uint8Array(20)
  bytes.set([0x67, 0x6c, 0x54, 0x46])
  const header = new DataView(bytes.buffer); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true)
  return bytes
}

describe('source-bound Canvas object display', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

  it('only recognizes explicit GLB records and verifies the binary header and length', () => {
    expect(glbSource({ type: 'model/gltf-binary', url: '/model.glb' })).toEqual({ field: 'url', reference: '/model.glb' })
    expect(glbSource({ type: 'image/png', url: '/photo.png' })).toBeUndefined()
    expect(glbSource({ url: '/model.glb' })).toBeUndefined()
    expect(modelDomain({ domain: 'coding' })).toBe('coding')
    expect(modelDomain({ domain: 'invented' })).toBe('general')
    const bytes = fixtureGlb()
    expect(isGlb(bytes)).toBe(true)
    bytes[8] = 21
    expect(isGlb(bytes)).toBe(false)
  })

  it('cancels an oversized streamed model even when Content-Length is absent', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4)) }, cancel })
    await expect(readGlbResponse(new Response(stream), 5)).rejects.toThrow('模型超出可处理大小')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('uses a verified source model, releases the effect and retains the original object', async () => {
    const bytes = fixtureGlb(), value = { type: 'model/gltf-binary', url: 'https://example.test/model.glb', caption: '源模型' }
    const original = JSON.stringify(value)
    const setOptions = vi.fn()
    runtime.load.mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy, setOptions } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(host.querySelector('canvas')).not.toBeNull()
      expect(JSON.stringify(value)).toBe(original)
      const rotate = host.querySelector<HTMLButtonElement>('button[aria-label="向左旋转模型"]')
      expect(rotate).not.toBeNull()
      await act(async () => { rotate!.focus(); rotate!.click() })
      expect(document.activeElement).toBe(rotate)
      expect(setOptions).toHaveBeenCalledWith({ autoRotate: true, autoRotateSpeed: -6 })
    } finally { await act(async () => root.unmount()); host.remove() }
    expect(runtime.destroy).toHaveBeenCalledTimes(1)
    expect(runtime.release).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fixture')
  })

  it('recognizes an explicit model in the normal content path while retaining the source text', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const value = { type: 'model/gltf-binary', url: '/fixture.glb', caption: '源模型' }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ContentView, { value })))
      expect(host.querySelector('.iexp-canvas-object')).not.toBeNull()
      expect(host.querySelector<HTMLDivElement>('.iexp-canvas-object')?.hidden).toBe(true)
      expect(host.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(new URL('/fixture.glb', location.href).href)
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('releases its slot immediately if WebGL is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const value = { type: 'glb', src: '/fixture.glb' }, host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: false })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.querySelector('[role="status"]')?.textContent).toContain('WebGL 2')
      expect(runtime.release).toHaveBeenCalled()
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('selects the ASCII object for a source that explicitly identifies a coding context', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb', domain: 'coding' }
    const factory = vi.fn((_elements: unknown, _options: Record<string, unknown>) => ({ destroy: runtime.destroy }))
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledWith('ascii-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ colored: false, color: '#d5e2e9' })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('uses the legible Ink fallback for an explicitly quantitative model', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb', domain: 'quantitative' }
    const factory = vi.fn((_elements: unknown, _options: Record<string, unknown>) => ({ destroy: runtime.destroy }))
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ inkColor: '#d5e2e9' })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the original model available and permits retry after a component download fails', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb' }
    runtime.load.mockReset().mockRejectedValueOnce(new Error('internal module address')).mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: false })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.textContent).toContain('请检查网络后重试')
      expect(host.textContent).not.toContain('internal module address')
      expect(host.querySelector('a')?.textContent).toBe('打开原始模型')
      const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
      await act(async () => { retry.click(); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledTimes(2)
      expect(host.textContent).not.toContain('组件加载失败')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
