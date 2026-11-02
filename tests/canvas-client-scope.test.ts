import { describe, expect, it, vi } from 'vitest'
import { createCanvasClientScope } from '../src/canvas-client-scope.js'
import { CanvasHtmlTextureError, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'
import type { CanvasParticleScrollOptions } from '../src/canvas-scroll-texture.js'
import type { CanvasParticleScrollClientOptions } from '../src/canvas-client-scope.js'
import type { CanvasIsolatedOptions } from '../src/canvas-isolated-client.js'

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
})
