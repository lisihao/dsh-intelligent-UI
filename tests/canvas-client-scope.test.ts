// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasClientScope } from '../src/canvas-client-scope.js'
import { CanvasHtmlTextureError, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'
import type { CanvasParticleScrollOptions } from '../src/canvas-scroll-texture.js'
import type { CanvasHtmlEffectClientOptions, CanvasParticleScrollClientOptions } from '../src/canvas-client-scope.js'
import type { CanvasIsolatedOptions } from '../src/canvas-isolated-client.js'
import type { CanvasHtmlEffectAdapter } from '../src/canvas-html-effect-adapter.js'

class VisibleIntersectionObserver {
  private disconnected = false
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) { queueMicrotask(() => { if (!this.disconnected) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }) }
  unobserve() {}
  disconnect() { this.disconnected = true }
}

function htmlOptions(overrides: Partial<CanvasHtmlEffectClientOptions> = {}): CanvasHtmlEffectClientOptions {
  const content = document.createElement('div'), host = document.createElement('div')
  document.body.append(content, host)
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) }
  content.getBoundingClientRect = () => rect
  host.getBoundingClientRect = () => ({ ...rect, left: 150, right: 250, x: 150 })
  return { component: 'ripple', host, content, scope: 'visual-only', sourceRemainsVisible: true, onError: vi.fn(), ...overrides }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('Canvas UI public client lifetime', () => {
  it('disposes effects before visual bridges and rejects use after plugin shutdown', async () => {
    const order: string[] = []
    const factory = vi.fn(() => ({ setOptions: vi.fn(), destroy: () => order.push('effect') }))
    const load = vi.fn().mockResolvedValue(factory)
    const bridge = vi.fn(() => ({ refresh: async () => {}, dispose: () => order.push('bridge') }))
    const scope = createCanvasClientScope({ load, bridge })
    const make = await scope.loadCanvasEffect('glass')
    const view = make({ canvas: {} })!
    const texture = scope.createCanvasHtmlTextureBridge({} as CanvasHtmlTextureOptions)
    scope.dispose(); scope.dispose(); view.destroy(); texture.dispose()
    expect(order).toEqual(['effect', 'bridge'])
    expect(() => make({})).toThrow('CANVAS_CLIENT_DISPOSED')
    expect(() => scope.createCanvasHtmlTextureBridge({} as CanvasHtmlTextureOptions)).toThrow('CANVAS_CLIENT_DISPOSED')
    await expect(scope.loadCanvasEffect('glass')).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
  })

  it('does not hand out a factory if shutdown occurs while the source is loading', async () => {
    let resolve!: (value: ReturnType<typeof vi.fn>) => void
    const load = vi.fn(() => new Promise<ReturnType<typeof vi.fn>>(done => { resolve = done }))
    const scope = createCanvasClientScope({ load: load as never })
    const pending = scope.loadCanvasEffect('glass')
    scope.dispose()
    resolve(vi.fn())
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
  })

  it('continues cleaning other resources when an effect teardown fails', async () => {
    const disposeBridge = vi.fn()
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => ({ destroy: () => { throw new Error('effect cleanup') } })),
      bridge: vi.fn(() => ({ refresh: async () => {}, dispose: disposeBridge })),
    })
    ;(await scope.loadCanvasEffect('glass'))({})
    scope.createCanvasHtmlTextureBridge({} as CanvasHtmlTextureOptions)
    expect(() => scope.dispose()).toThrow(AggregateError)
    expect(disposeBridge).toHaveBeenCalledOnce()
  })

  it('stops a bound effect before the bridge on reduced motion, including sweep slots', async () => {
    const order: string[] = [], source = {} as HTMLCanvasElement
    let onError!: CanvasHtmlTextureOptions['onError']
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') })),
      bridge: vi.fn(options => { onError = options.onError; return { refresh: async () => {}, dispose: () => order.push('bridge') } }),
    })
    const texture = scope.createCanvasHtmlTextureBridge({ source, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: () => order.push('notification') })
    const effect = (await scope.loadCanvasEffect('ascii-sweep'))({ slots: [{ source }, {}] })!
    onError(new CanvasHtmlTextureError('reduced-motion', 'reduced'))
    expect(order).toEqual(['effect', 'bridge', 'notification'])
    effect.destroy(); texture.dispose(); scope.dispose()
    expect(order).toEqual(['effect', 'bridge', 'notification'])
  })

  it('stops a bound effect before explicit bridge disposal', async () => {
    const order: string[] = [], source = {} as HTMLCanvasElement
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') })),
      bridge: vi.fn(() => ({ refresh: async () => {}, dispose: () => order.push('bridge') })),
    })
    const options: CanvasHtmlTextureOptions = { source, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: () => {} }
    const texture = scope.createCanvasHtmlTextureBridge(options)
    expect(() => scope.createCanvasHtmlTextureBridge(options)).toThrow('CANVAS_BRIDGE_ALREADY_ATTACHED')
    ;(await scope.loadCanvasEffect('glass'))({ source })
    texture.dispose(); scope.dispose()
    expect(order).toEqual(['effect', 'bridge'])
  })

  it('forwards the texture snapshot getter through the public scope', () => {
    const snapshot = { revision: 4, width: 100, height: 80, textRects: [{ x: 1, y: 2, width: 3, height: 4 }] }
    let active = true
    const scope = createCanvasClientScope({
      bridge: vi.fn(() => ({ refresh: async () => {}, getSnapshot: () => active ? snapshot : undefined, dispose: () => { active = false } })),
    })
    const texture = scope.createCanvasHtmlTextureBridge({ source: {} as HTMLCanvasElement, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, captureTextRects: true, onError: () => {} })
    expect(texture.getSnapshot?.()).toBe(snapshot)
    scope.dispose()
    expect(texture.getSnapshot?.()).toBeUndefined()
  })

  it('does not expose the private reduced-motion disposal flag to callers', async () => {
    const order: string[] = [], source = {} as HTMLCanvasElement
    let onError!: CanvasHtmlTextureOptions['onError']
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') })),
      bridge: vi.fn(options => { onError = options.onError; return { refresh: async () => {}, dispose: () => order.push('texture') } }),
    })
    const options: CanvasHtmlTextureOptions = { source, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: () => order.push('notification') }
    ;(scope.createCanvasHtmlTextureBridge as (...args: unknown[]) => unknown)(options, true)
    ;(await scope.loadCanvasEffect('glass'))({ source })
    onError(new CanvasHtmlTextureError('reduced-motion', 'reduced'))
    expect(order).toEqual(['effect', 'texture', 'notification'])
    scope.dispose()
  })

  it('rejects a scroll adapter that reports an error during construction', async () => {
    const failure = new CanvasHtmlTextureError('capture', 'cannot start'), dispose = vi.fn(), notify = vi.fn()
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => null),
      particleScroll: vi.fn(options => { options.onError(failure); return { refresh: async () => {}, resize: () => {}, setOptions: () => {}, dispose } }),
    })
    await expect(scope.createCanvasParticleScrollBridge({ onError: notify } as unknown as CanvasParticleScrollClientOptions)).rejects.toBe(failure)
    expect(notify).toHaveBeenCalledWith(failure)
    expect(dispose).toHaveBeenCalledOnce()
    scope.dispose()
  })

  it('owns Particle Scroll listeners, effect and texture through plugin shutdown', async () => {
    const order: string[] = []
    const source = {} as HTMLCanvasElement
    const load = vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') }))
    const bridge = vi.fn(() => ({ refresh: async () => {}, dispose: () => order.push('texture') }))
    const particleScroll = vi.fn((options: CanvasParticleScrollOptions) => {
      const effect = options.factory({})!
      const texture = options.createTextureBridge!({ source, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: options.onError })
      return { refresh: async () => {}, resize: () => {}, setOptions: () => {}, dispose: () => { order.push('scroll'); effect.destroy(); texture.dispose() } }
    })
    const scope = createCanvasClientScope({ load, bridge, particleScroll })
    const options = { onError: vi.fn() } as unknown as CanvasParticleScrollClientOptions
    const instance = await scope.createCanvasParticleScrollBridge(options)
    expect(load).toHaveBeenCalledWith('particle-scroll')
    expect(particleScroll).toHaveBeenCalledOnce()
    scope.dispose(); instance.dispose()
    expect(order).toEqual(['scroll', 'effect', 'texture'])
    await expect(scope.createCanvasParticleScrollBridge(options)).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
  })

  it('stops a Particle Scroll effect before its scoped texture when motion is reduced', async () => {
    const order: string[] = [], capture = {} as HTMLCanvasElement
    let onTextureError!: CanvasHtmlTextureOptions['onError']
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') })),
      bridge: vi.fn(options => { onTextureError = options.onError; return { refresh: async () => {}, dispose: () => order.push('texture') } }),
      particleScroll: vi.fn(options => {
        const effect = options.factory({ source: {} })!
        const texture = options.createTextureBridge!({ source: capture, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: (error: CanvasHtmlTextureError) => { effect.destroy(); texture.dispose(); options.onError(error) } })
        return { refresh: async () => {}, resize: () => {}, setOptions: () => {}, dispose: () => { effect.destroy(); texture.dispose() } }
      }),
    })
    await scope.createCanvasParticleScrollBridge({ onError: () => order.push('notification') } as unknown as CanvasParticleScrollClientOptions)
    onTextureError(new CanvasHtmlTextureError('reduced-motion', 'reduced'))
    expect(order).toEqual(['effect', 'texture', 'notification'])
    scope.dispose()
    expect(order).toEqual(['effect', 'texture', 'notification'])
  })

  it('does not create a Particle Scroll adapter after shutdown while loading', async () => {
    let resolve!: (value: ReturnType<typeof vi.fn>) => void
    const load = vi.fn(() => new Promise<ReturnType<typeof vi.fn>>(done => { resolve = done }))
    const particleScroll = vi.fn()
    const scope = createCanvasClientScope({ load: load as never, particleScroll: particleScroll as never })
    const pending = scope.createCanvasParticleScrollBridge({ onError: vi.fn() } as unknown as CanvasParticleScrollClientOptions)
    scope.dispose()
    resolve(vi.fn())
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
    expect(particleScroll).not.toHaveBeenCalled()
  })

  it('rejects an unresolved factory load promptly when the plugin stops', async () => {
    const scope = createCanvasClientScope({ load: vi.fn(() => new Promise(() => {})) as never })
    const pending = scope.createCanvasParticleScrollBridge({ onError: vi.fn() } as unknown as CanvasParticleScrollClientOptions)
    scope.dispose()
    const result = await Promise.race([pending.then(() => 'resolved', error => String(error)), new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 30))])
    expect(result).toContain('CANVAS_CLIENT_DISPOSED')
  })

  it('does not load Particle Scroll when reduced motion is already enabled', async () => {
    const load = vi.fn()
    const scope = createCanvasClientScope({ load })
    const scroll = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } } as unknown as HTMLElement
    await expect(scope.createCanvasParticleScrollBridge({ scroll, onError: vi.fn() } as unknown as CanvasParticleScrollClientOptions)).rejects.toMatchObject({ code: 'reduced-motion' })
    expect(load).not.toHaveBeenCalled()
    scope.dispose()
  })

  it('forgets an adapter after its own error cleanup', async () => {
    let report!: CanvasParticleScrollOptions['onError']
    const dispose = vi.fn(), notify = vi.fn()
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => null),
      particleScroll: vi.fn(options => { report = options.onError; return { refresh: async () => {}, resize: () => {}, setOptions: () => {}, dispose } }),
    })
    const instance = await scope.createCanvasParticleScrollBridge({ onError: notify } as unknown as CanvasParticleScrollClientOptions)
    report(new CanvasHtmlTextureError('reduced-motion', 'reduced'))
    scope.dispose(); instance.dispose()
    expect(dispose).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('cancels a queued isolated effect and retires a late result on plugin shutdown', async () => {
    let signal!: AbortSignal
    let finish!: (value: { destroy: () => void }) => void
    const destroy = vi.fn()
    const isolated = vi.fn((options: CanvasIsolatedOptions) => {
      signal = options.signal!
      return new Promise<{ destroy: () => void }>(resolve => { finish = resolve })
    })
    const scope = createCanvasClientScope({ isolated })
    const pending = scope.createCanvasIsolatedEffect({ slug: 'bend', onError: vi.fn() } as unknown as CanvasIsolatedOptions)
    scope.dispose()
    expect(signal.aborted).toBe(true)
    finish({ destroy })
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('destroys a started isolated effect exactly once when the plugin stops', async () => {
    const destroy = vi.fn()
    const scope = createCanvasClientScope({ isolated: vi.fn().mockResolvedValue({ destroy }) })
    const effect = await scope.createCanvasIsolatedEffect({ slug: 'hex-float', onError: vi.fn() } as unknown as CanvasIsolatedOptions)
    scope.dispose(); effect.destroy(); scope.dispose()
    expect(destroy).toHaveBeenCalledOnce()
    await expect(scope.createCanvasIsolatedEffect({} as CanvasIsolatedOptions)).rejects.toThrow('CANVAS_CLIENT_DISPOSED')
  })

  it('forwards caller cancellation and retires errored isolated effects', async () => {
    let options!: CanvasIsolatedOptions
    const destroy = vi.fn(), notify = vi.fn(), controller = new AbortController()
    const scope = createCanvasClientScope({ isolated: vi.fn((input: CanvasIsolatedOptions) => { options = input; return Promise.resolve({ destroy }) }) })
    const effect = await scope.createCanvasIsolatedEffect({ slug: 'bend', signal: controller.signal, onError: notify } as unknown as CanvasIsolatedOptions)
    controller.abort()
    expect(options.signal?.aborted).toBe(true)
    options.onError(new Error('cancelled'))
    expect(notify).toHaveBeenCalledOnce()
    scope.dispose(); effect.destroy()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('owns an HTML visual effect and its texture until plugin shutdown', async () => {
    const order: string[] = [], capture = {} as HTMLCanvasElement
    const burst = vi.fn()
    const load = vi.fn().mockResolvedValue(() => ({ destroy: () => order.push('effect') }))
    const bridge = vi.fn(() => ({ refresh: async () => {}, dispose: () => order.push('texture') }))
    const htmlEffect = vi.fn(options => {
      const effect = options.factory({})!
      const texture = options.createTextureBridge!({ source: capture, content: {} as HTMLElement, scope: 'visual-only', sourceRemainsVisible: true, onError: options.onError })
      return Promise.resolve({ refresh: async () => {}, resize: () => {}, setOptions: () => {}, splash: () => {}, melt: () => {}, burst, dispose: () => { order.push('visual'); effect.destroy(); texture.dispose() } })
    })
    const scope = createCanvasClientScope({ load, bridge, htmlEffect })
    const injected = vi.fn()
    const effect = await scope.createCanvasHtmlEffect({ ...htmlOptions(), factory: injected, createTextureBridge: injected, acquireSlot: injected } as unknown as CanvasHtmlEffectClientOptions)
    expect(load).toHaveBeenCalledWith('ripple')
    expect(htmlEffect.mock.calls[0]![0].factory).not.toBe(injected)
    expect(htmlEffect.mock.calls[0]![0].createTextureBridge).not.toBe(injected)
    expect(htmlEffect.mock.calls[0]![0].acquireSlot).not.toBe(injected)
    effect.burst(); expect(burst).toHaveBeenCalledOnce()
    scope.dispose(); effect.dispose()
    expect(order).toEqual(['visual', 'effect', 'texture'])
  })

  it.each(['grid', 'displacement', 'glitch', 'blaze', 'particle-reveal', 'canvas', 'vhs', 'decrypt-reveal', 'magnify', 'clouds', 'asciify'] as const)('loads the verified %s adapter through the owned client service', async component => {
    const load = vi.fn().mockResolvedValue(() => null), dispose = vi.fn()
    const scope = createCanvasClientScope({ load, htmlEffect: vi.fn().mockResolvedValue({ refresh: async () => {}, resize() {}, setOptions() {}, splash() {}, melt() {}, burst() {}, dispose }) })
    await scope.createCanvasHtmlEffect(htmlOptions({ component }))
    expect(load).toHaveBeenCalledWith(component)
    scope.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('loads a visible decorative host hidden only from assistive technology, while requiring an exposed source', async () => {
    const load = vi.fn().mockResolvedValue(() => null)
    const htmlEffect = vi.fn().mockResolvedValue({ refresh: async () => {}, resize() {}, setOptions() {}, splash() {}, melt() {}, burst() {}, dispose() {} })
    const scope = createCanvasClientScope({ load, htmlEffect })
    const options = htmlOptions()
    options.host.setAttribute('aria-hidden', 'true')
    options.content.setAttribute('aria-hidden', 'true')
    const pending = scope.createCanvasHtmlEffect(options)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(load).not.toHaveBeenCalled()
    options.content.removeAttribute('aria-hidden')
    await pending
    expect(load).toHaveBeenCalledWith('ripple')
    expect(options.host.getAttribute('aria-hidden')).toBe('true')
    scope.dispose()
  })

  it('cancels an HTML effect while its factory is still loading', async () => {
    const load = vi.fn(() => new Promise(() => {})), htmlEffect = vi.fn()
    const scope = createCanvasClientScope({ load: load as never, htmlEffect: htmlEffect as never })
    const controller = new AbortController()
    const pending = scope.createCanvasHtmlEffect(htmlOptions({ signal: controller.signal }))
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toThrow('CANVAS_CLIENT_CANCELLED')
    expect(htmlEffect).not.toHaveBeenCalled()
    scope.dispose()
  })

  it('aborts an HTML adapter waiting for visibility when the plugin stops', async () => {
    let adapterSignal!: AbortSignal
    const scope = createCanvasClientScope({
      load: vi.fn().mockResolvedValue(() => null),
      htmlEffect: vi.fn(options => new Promise<CanvasHtmlEffectAdapter>((_resolve, reject) => {
        adapterSignal = options.signal!
        adapterSignal.addEventListener('abort', () => reject(new Error('adapter cancelled')), { once: true })
      })),
    })
    const pending = scope.createCanvasHtmlEffect(htmlOptions({ component: 'frost' }))
    await vi.waitFor(() => expect(adapterSignal).toBeDefined())
    scope.dispose()
    await expect(pending).rejects.toThrow('adapter cancelled')
    expect(adapterSignal.aborted).toBe(true)
  })

  it('does not download an unsupported or reduced-motion HTML effect', async () => {
    const load = vi.fn(), scope = createCanvasClientScope({ load })
    const content = { ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } } as unknown as HTMLElement
    await expect(scope.createCanvasHtmlEffect({ component: 'ripple', content } as CanvasHtmlEffectClientOptions)).rejects.toMatchObject({ code: 'reduced-motion' })
    await expect(scope.createCanvasHtmlEffect({ component: 'bend' } as unknown as CanvasHtmlEffectClientOptions)).rejects.toMatchObject({ code: 'unsupported' })
    expect(load).not.toHaveBeenCalled()
    scope.dispose()
  })
})
