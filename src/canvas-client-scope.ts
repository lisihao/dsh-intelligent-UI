import { createCanvasHtmlTextureBridge, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from './canvas-html-texture.js'
import { loadCanvasEffect, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'

/** Own public consumers' effects so disabling this plugin releases their resources. */
export function createCanvasClientScope(dependencies: {
  load?: typeof loadCanvasEffect
  bridge?: typeof createCanvasHtmlTextureBridge
} = {}) {
  const load = dependencies.load ?? loadCanvasEffect
  const makeBridge = dependencies.bridge ?? createCanvasHtmlTextureBridge
  const effects = new Set<CanvasEffectInstance>()
  const bridges = new Set<CanvasHtmlTextureBridge>()
  const bridgesBySource = new Map<unknown, CanvasHtmlTextureBridge>()
  const effectsByBridge = new Map<CanvasHtmlTextureBridge, Set<CanvasEffectInstance>>()
  const listeners = new Set<() => void>()
  let active = true
  const assertActive = () => { if (!active) throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  const getSnapshot = () => active

  async function loadEffect(slug: string): Promise<CanvasEffectFactory> {
    assertActive()
    const factory = await load(slug)
    assertActive()
    return (elements, options) => {
      assertActive()
      const instance = factory(elements, options)
      if (!instance) return null
      if (!active) { instance.destroy(); throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
      let closed = false
      const inputs = [elements.source, ...(Array.isArray(elements.slots) ? elements.slots.map(slot => slot && typeof slot === 'object' ? (slot as { source?: unknown }).source : undefined) : [])]
      const associated = new Set(inputs.map(input => bridgesBySource.get(input)).filter((bridge): bridge is CanvasHtmlTextureBridge => !!bridge))
      const wrapped = new Proxy(instance, {
        get(target, property) {
          if (property === 'destroy') return () => {
            if (closed) return
            closed = true
            effects.delete(wrapped)
            for (const bridge of associated) effectsByBridge.get(bridge)?.delete(wrapped)
            target.destroy()
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      effects.add(wrapped)
      for (const bridge of associated) effectsByBridge.get(bridge)?.add(wrapped)
      return wrapped
    }
  }

  function createBridge(options: CanvasHtmlTextureOptions): CanvasHtmlTextureBridge {
    assertActive()
    if (bridgesBySource.has(options.source)) throw new Error('CANVAS_BRIDGE_ALREADY_ATTACHED: 此画布已有纹理桥。')
    let wrapped: CanvasHtmlTextureBridge | undefined
    const bridge = makeBridge({ ...options, onError: error => {
      // When motion is disabled, stop bound effects before the bridge removes
      // requestPaint; otherwise upstream resize handlers can call a dead API.
      try { if (error.code === 'reduced-motion') wrapped?.dispose() } finally { options.onError(error) }
    } })
    let closed = false
    wrapped = {
      refresh: () => bridge.refresh(),
      dispose() {
        if (closed) return
        closed = true
        bridges.delete(wrapped!)
        bridgesBySource.delete(options.source)
        const bound = effectsByBridge.get(wrapped!)
        effectsByBridge.delete(wrapped!)
        const errors: unknown[] = []
        for (const effect of [...bound ?? []]) try { effect.destroy() } catch (error) { errors.push(error) }
        try { bridge.dispose() } catch (error) { errors.push(error) }
        if (errors.length) throw new AggregateError(errors, 'Canvas UI bridge resources could not all be released.')
      },
    }
    if (!active) { wrapped.dispose(); throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
    bridges.add(wrapped)
    bridgesBySource.set(options.source, wrapped)
    effectsByBridge.set(wrapped, new Set())
    return wrapped
  }

  function dispose() {
    if (!active) return
    active = false
    const errors: unknown[] = []
    // Upstream effects must stop before their texture bridges are removed.
    for (const effect of [...effects]) try { effect.destroy() } catch (error) { errors.push(error) }
    for (const bridge of [...bridges]) try { bridge.dispose() } catch (error) { errors.push(error) }
    for (const listener of [...listeners]) try { listener() } catch (error) { errors.push(error) }
    listeners.clear()
    if (errors.length) throw new AggregateError(errors, 'Canvas UI resources could not all be released.')
  }
  return { loadCanvasEffect: loadEffect, createCanvasHtmlTextureBridge: createBridge, subscribe, getSnapshot, dispose }
}
