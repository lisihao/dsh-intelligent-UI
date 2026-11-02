import { describe, expect, it, vi } from 'vitest'
import { createCanvasClientScope } from '../src/canvas-client-scope.js'
import { CanvasHtmlTextureError, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'

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
})
