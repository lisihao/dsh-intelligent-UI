import { CanvasHtmlTextureError, createCanvasHtmlTextureBridge, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from './canvas-html-texture.js'
import { loadCanvasEffect, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { createCanvasParticleScrollBridge, type CanvasParticleScrollBridge, type CanvasParticleScrollOptions } from './canvas-scroll-texture.js'
import { createCanvasIsolatedEffect, type CanvasIsolatedEffect, type CanvasIsolatedOptions } from './canvas-isolated-client.js'

export type CanvasParticleScrollClientOptions = Omit<CanvasParticleScrollOptions, 'factory' | 'createTextureBridge'>

/** Own public consumers' effects so disabling this plugin releases their resources. */
export function createCanvasClientScope(dependencies: {
  load?: typeof loadCanvasEffect
  bridge?: typeof createCanvasHtmlTextureBridge
  particleScroll?: typeof createCanvasParticleScrollBridge
  isolated?: typeof createCanvasIsolatedEffect
} = {}) {
  const load = dependencies.load ?? loadCanvasEffect
  const makeBridge = dependencies.bridge ?? createCanvasHtmlTextureBridge
  const makeParticleScroll = dependencies.particleScroll ?? createCanvasParticleScrollBridge
  const makeIsolated = dependencies.isolated ?? createCanvasIsolatedEffect
  const effects = new Set<CanvasEffectInstance>()
  const bridges = new Set<CanvasHtmlTextureBridge>()
  const scrollBridges = new Set<CanvasParticleScrollBridge>()
  const isolatedEffects = new Set<CanvasIsolatedEffect>()
  const isolatedLoads = new Set<AbortController>()
  const pendingFactories = new Set<() => void>()
  const bridgesBySource = new Map<unknown, CanvasHtmlTextureBridge>()
  const effectsByBridge = new Map<CanvasHtmlTextureBridge, Set<CanvasEffectInstance>>()
  const listeners = new Set<() => void>()
  let active = true
  const assertActive = () => { if (!active) throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  const getSnapshot = () => active

  async function loadEffect(slug: string): Promise<CanvasEffectFactory> {
    assertActive()
    let cancel!: () => void
    const stopped = new Promise<never>((_resolve, reject) => { cancel = () => reject(new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。')) })
    pendingFactories.add(cancel)
    let factory: CanvasEffectFactory
    try { factory = await Promise.race([load(slug), stopped]) }
    finally { pendingFactories.delete(cancel) }
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

  function createBridge(options: CanvasHtmlTextureOptions, ownerManagesReducedMotion = false): CanvasHtmlTextureBridge {
    assertActive()
    if (bridgesBySource.has(options.source)) throw new Error('CANVAS_BRIDGE_ALREADY_ATTACHED: 此画布已有纹理桥。')
    let wrapped: CanvasHtmlTextureBridge | undefined
    const bridge = makeBridge({ ...options, onError: error => {
      // Particle Scroll owns a proxy source and stops its effect in onError;
      // other bound effects must stop before the bridge removes requestPaint.
      try { if (error.code === 'reduced-motion' && !ownerManagesReducedMotion) wrapped?.dispose() } finally { options.onError(error) }
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

  async function createParticleScroll(options: CanvasParticleScrollClientOptions): Promise<CanvasParticleScrollBridge> {
    assertActive()
    if (options.scroll?.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      throw new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.')
    }
    const factory = await loadEffect('particle-scroll')
    assertActive()
    let wrapped: CanvasParticleScrollBridge | undefined
    let closed = false
    let failure: CanvasHtmlTextureError | undefined
    const bridge = makeParticleScroll({ ...options, factory, createTextureBridge: textureOptions => createBridge(textureOptions, true), onError: error => {
      closed = true
      failure = error
      if (wrapped) scrollBridges.delete(wrapped)
      options.onError(error)
    } })
    wrapped = {
      refresh: () => bridge.refresh(),
      resize: () => bridge.resize(),
      setOptions: next => bridge.setOptions(next),
      dispose() {
        if (closed) return
        closed = true
        scrollBridges.delete(wrapped!)
        bridge.dispose()
      },
    }
    if (!active) { bridge.dispose(); throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
    if (failure) { bridge.dispose(); throw failure }
    if (!closed) scrollBridges.add(wrapped)
    return wrapped
  }

  async function createIsolated(options: CanvasIsolatedOptions): Promise<CanvasIsolatedEffect> {
    assertActive()
    const controller = new AbortController()
    isolatedLoads.add(controller)
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const unlink = () => { isolatedLoads.delete(controller); options.signal?.removeEventListener('abort', forwardAbort) }
    let wrapped: CanvasIsolatedEffect | undefined
    let failure: Error | undefined
    try {
      const effect = await makeIsolated({ ...options, signal: controller.signal, onError: error => {
        failure = error
        if (wrapped) isolatedEffects.delete(wrapped)
        unlink()
        options.onError(error)
      } })
      if (!active || controller.signal.aborted || failure) {
        effect.destroy()
        throw failure ?? new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用或效果已取消。')
      }
      let closed = false
      wrapped = { destroy() {
        if (closed) return
        closed = true
        isolatedEffects.delete(wrapped!)
        unlink()
        effect.destroy()
      } }
      isolatedEffects.add(wrapped)
      return wrapped
    } catch (error) { unlink(); throw error }
  }

  function dispose() {
    if (!active) return
    active = false
    const errors: unknown[] = []
    for (const cancel of [...pendingFactories]) cancel()
    pendingFactories.clear()
    for (const effect of [...isolatedEffects]) try { effect.destroy() } catch (error) { errors.push(error) }
    for (const controller of [...isolatedLoads]) controller.abort()
    // Scroll adapters own listeners in addition to their effects and textures.
    for (const bridge of [...scrollBridges]) try { bridge.dispose() } catch (error) { errors.push(error) }
    // Upstream effects must stop before their texture bridges are removed.
    for (const effect of [...effects]) try { effect.destroy() } catch (error) { errors.push(error) }
    for (const bridge of [...bridges]) try { bridge.dispose() } catch (error) { errors.push(error) }
    for (const listener of [...listeners]) try { listener() } catch (error) { errors.push(error) }
    listeners.clear()
    if (errors.length) throw new AggregateError(errors, 'Canvas UI resources could not all be released.')
  }
  return { loadCanvasEffect: loadEffect, createCanvasHtmlTextureBridge: (options: CanvasHtmlTextureOptions) => createBridge(options), createCanvasParticleScrollBridge: createParticleScroll, createCanvasIsolatedEffect: createIsolated, subscribe, getSnapshot, dispose }
}
