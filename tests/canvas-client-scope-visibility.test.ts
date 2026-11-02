// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasClientScope, type CanvasHtmlEffectClientOptions } from '../src/canvas-client-scope.js'

class ControlledIntersectionObserver {
  static instances: ControlledIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  disconnected = false
  constructor(private readonly callback: IntersectionObserverCallback) { ControlledIntersectionObserver.instances.push(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.disconnected = true; this.targets.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
  emit(target: Element, visible: boolean) {
    this.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function fixture() {
  const parent = document.createElement('div'), content = document.createElement('div'), host = document.createElement('div')
  parent.append(content, host); document.body.append(parent)
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) }
  content.getBoundingClientRect = () => rect
  host.getBoundingClientRect = () => ({ ...rect, left: 150, right: 250, x: 150 })
  const dispose = vi.fn()
  const htmlEffect = vi.fn().mockResolvedValue({ refresh: async () => {}, resize() {}, setOptions() {}, splash() {}, melt() {}, burst() {}, dispose })
  const load = vi.fn().mockResolvedValue(() => null)
  const scope = createCanvasClientScope({ load, htmlEffect })
  const options: CanvasHtmlEffectClientOptions = { component: 'ripple', host, content, scope: 'visual-only', sourceRemainsVisible: true, onError: vi.fn() }
  return { parent, host, content, load, htmlEffect, dispose, scope, options }
}

beforeEach(() => {
  ControlledIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('HTML effect visibility before loading', () => {
  it('does not load until both original and effect regions intersect', async () => {
    const f = fixture(), pending = f.scope.createCanvasHtmlEffect(f.options)
    const observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, false)
    await Promise.resolve()
    expect(f.load).not.toHaveBeenCalled()
    observer.emit(f.content, true)
    const effect = await pending
    expect(f.load).toHaveBeenCalledOnce()
    expect(f.htmlEffect).toHaveBeenCalledOnce()
    expect(observer.disconnected).toBe(true)
    effect.dispose(); f.scope.dispose()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('waits when the original mode hides the parent, including stale intersection events', async () => {
    const f = fixture(); f.parent.hidden = true
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    await Promise.resolve()
    expect(f.load).not.toHaveBeenCalled()
    f.parent.hidden = false
    await Promise.resolve()
    observer.emit(f.host, true); observer.emit(f.content, true)
    await pending
    expect(f.load).toHaveBeenCalledOnce()
    f.scope.dispose()
  })

  it('rechecks visibility if raw mode is activated before the loading microtask', async () => {
    const f = fixture(), pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    f.parent.hidden = true
    await Promise.resolve(); await Promise.resolve()
    expect(f.load).not.toHaveBeenCalled()
    f.parent.hidden = false
    await Promise.resolve()
    observer.emit(f.host, true); observer.emit(f.content, true)
    await pending
    expect(f.load).toHaveBeenCalledOnce()
    f.scope.dispose()
  })

  it('waits while the document is hidden and re-observes after it returns', async () => {
    const f = fixture()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    await Promise.resolve()
    expect(f.load).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    observer.emit(f.host, true); observer.emit(f.content, true)
    await pending
    expect(f.load).toHaveBeenCalledOnce()
    f.scope.dispose()
  })

  it('removes observers and stops waiting when the caller cancels', async () => {
    const f = fixture(), controller = new AbortController()
    const pending = f.scope.createCanvasHtmlEffect({ ...f.options, signal: controller.signal })
    const observer = ControlledIntersectionObserver.instances[0]!
    controller.abort()
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_CANCELLED')
    expect(observer.disconnected).toBe(true)
    observer.emit(f.host, true); observer.emit(f.content, true)
    expect(f.load).not.toHaveBeenCalled()
    f.scope.dispose()
  })

  it('removes observers and stops waiting when the plugin is disabled', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const f = fixture(), pending = f.scope.createCanvasHtmlEffect(f.options)
    const observer = ControlledIntersectionObserver.instances[0]!
    const initialDisconnects = disconnect.mock.calls.length
    f.scope.dispose()
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
    expect(observer.disconnected).toBe(true)
    expect(disconnect.mock.calls.length).toBeGreaterThan(initialDisconnects)
    expect(f.load).not.toHaveBeenCalled()
  })

  it('fails promptly if either waiting element is removed', async () => {
    const f = fixture(), pending = f.scope.createCanvasHtmlEffect(f.options)
    const observer = ControlledIntersectionObserver.instances[0]!
    f.parent.remove()
    await expect(pending).rejects.toMatchObject({ code: 'detached' })
    expect(observer.disconnected).toBe(true)
    expect(f.load).not.toHaveBeenCalled()
    f.scope.dispose()
  })

  it('rejects missing elements immediately rather than waiting or loading', async () => {
    const f = fixture()
    await expect(f.scope.createCanvasHtmlEffect({ component: 'ripple', onError: vi.fn() } as unknown as CanvasHtmlEffectClientOptions)).rejects.toMatchObject({ code: 'detached' })
    expect(f.load).not.toHaveBeenCalled()
    expect(ControlledIntersectionObserver.instances).toHaveLength(0)
    f.scope.dispose()
  })

  it('rejects a visible zero-sized region immediately rather than waiting forever', async () => {
    const f = fixture()
    f.host.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    await expect(pending).rejects.toMatchObject({ code: 'detached' })
    expect(observer.disconnected).toBe(true)
    expect(f.load).not.toHaveBeenCalled()
    f.scope.dispose()
  })

  it('does not create an adapter in the background when a visible source exits during loading', async () => {
    const f = fixture(); let finish!: (factory: () => null) => void
    f.load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
    observer.emit(f.host, false); observer.emit(f.content, false)
    finish(() => null)
    await Promise.resolve(); await Promise.resolve()
    expect(f.htmlEffect).not.toHaveBeenCalled()
    observer.emit(f.host, true); observer.emit(f.content, true)
    await pending
    expect(f.htmlEffect).toHaveBeenCalledOnce()
    f.scope.dispose()
  })

  it('cancels an in-flight import promptly if the source is detached', async () => {
    const f = fixture(); f.load.mockImplementation(() => new Promise(() => {}))
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
    f.parent.remove()
    await expect(pending).rejects.toMatchObject({ code: 'detached' })
    expect(observer.disconnected).toBe(true)
    expect(f.htmlEffect).not.toHaveBeenCalled()
    f.scope.dispose()
  })

  it('waits again when raw mode hides the source during the factory import', async () => {
    const f = fixture(); let finish!: (factory: () => null) => void
    f.load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.scope.createCanvasHtmlEffect(f.options), observer = ControlledIntersectionObserver.instances[0]!
    observer.emit(f.host, true); observer.emit(f.content, true)
    await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
    f.parent.hidden = true; finish(() => null)
    await Promise.resolve(); await Promise.resolve()
    expect(f.htmlEffect).not.toHaveBeenCalled()
    f.parent.hidden = false
    await Promise.resolve()
    observer.emit(f.host, true); observer.emit(f.content, true)
    await pending
    expect(f.htmlEffect).toHaveBeenCalledOnce()
    f.scope.dispose()
  })
})
