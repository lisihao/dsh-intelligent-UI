import { CanvasHtmlTextureError, createCanvasHtmlTextureBridge, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from './canvas-html-texture.js'
import { acquireCanvasSlot, loadCanvasEffect, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { createCanvasParticleScrollBridge, type CanvasParticleScrollBridge, type CanvasParticleScrollOptions } from './canvas-scroll-texture.js'
import { createCanvasIsolatedEffect, type CanvasIsolatedEffect, type CanvasIsolatedOptions } from './canvas-isolated-client.js'
import { createCanvasHtmlEffectAdapter, type CanvasHtmlEffectAdapter, type CanvasHtmlEffectOptions } from './canvas-html-effect-adapter.js'
import { isCanvasHtmlEffectName } from './canvas-html-names.js'

export type CanvasParticleScrollClientOptions = Omit<CanvasParticleScrollOptions, 'factory' | 'createTextureBridge'>
export type CanvasHtmlEffectClientOptions = Omit<CanvasHtmlEffectOptions, 'factory' | 'createTextureBridge' | 'acquireSlot'>

/** Observe both real regions before asking the host to download/build a factory. */
function htmlVisibilityGate(host: HTMLElement, content: HTMLElement, signal: AbortSignal, cancelled: () => Error) {
  if (signal.aborted) throw cancelled()
  const doc = host?.ownerDocument, win = doc?.defaultView
  if (!host || !content || !doc || !win || !(host instanceof win.HTMLElement) || !(content instanceof win.HTMLElement)
    || content.ownerDocument !== doc || !host.isConnected || !content.isConnected
    || !doc.body?.isConnected || typeof host.contains !== 'function' || typeof content.contains !== 'function'
    || typeof host.getBoundingClientRect !== 'function' || typeof content.getBoundingClientRect !== 'function') {
    throw new CanvasHtmlTextureError('detached', 'The source and visual region must remain in the same document.')
  }
  if (host === content || host.contains(content) || content.contains(host)) {
    throw new CanvasHtmlTextureError('unsafe-content', 'The visual region must be separate from the original source.')
  }
  if (typeof win.IntersectionObserver !== 'function' || typeof win.MutationObserver !== 'function') {
    throw new CanvasHtmlTextureError('unsupported', 'The browser cannot monitor this visual effect.')
  }
  let live = true, hostVisible = false, contentVisible = false, failure: unknown
  let rejectFailure!: (reason: unknown) => void
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  // The gate can fail before a caller starts racing the factory load.
  void failed.catch(() => {})
  const waiters = new Set<{ resolve: () => void, reject: (reason: unknown) => void }>()
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  let intersection: IntersectionObserver | undefined, mutations: MutationObserver | undefined

  const cleanup = () => {
    if (!live) return
    live = false
    intersection?.disconnect(); mutations?.disconnect()
    doc.removeEventListener('visibilitychange', onDocumentVisibility)
    media?.removeEventListener?.('change', onMotion)
    signal.removeEventListener('abort', onAbort)
  }
  const fail = (error: unknown) => {
    if (!live) return
    failure = error
    cleanup()
    for (const waiter of waiters) waiter.reject(error)
    waiters.clear()
    rejectFailure(error)
  }
  function onAbort() { fail(cancelled()) }
  function onMotion() { if (media?.matches) fail(new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.')) }
  const rendered = (root: HTMLElement): boolean => {
    let opacity = 1
    for (let element: HTMLElement | null = root; element; element = element.parentElement) {
      const style = win.getComputedStyle(element), value = Number(style.opacity || 1)
      if (element.hidden || element.hasAttribute('inert') || element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true'
        || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden' || !Number.isFinite(value)) return false
      opacity *= value
    }
    return opacity >= 0.5
  }
  const exposed = (root: HTMLElement): boolean => {
    if (!rendered(root)) return false
    const rect = root.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
      && rect.left < win.innerWidth && rect.top < win.innerHeight
  }
  const checkGeometry = () => {
    for (const root of [host, content]) {
      if (!rendered(root)) continue
      const rect = root.getBoundingClientRect()
      if (![rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        fail(new CanvasHtmlTextureError('detached', 'The source and visual region must be visible.'))
        return
      }
    }
  }
  const isVisible = () => {
    if (!live) return false
    if (!host.isConnected || !content.isConnected) { fail(new CanvasHtmlTextureError('detached', 'The source or visual region was removed.')); return false }
    checkGeometry()
    if (!live) return false
    return doc.visibilityState === 'visible' && hostVisible && contentVisible && exposed(host) && exposed(content)
  }
  const flush = () => {
    if (!live) return
    if (!isVisible()) return
    for (const waiter of waiters) waiter.resolve()
    waiters.clear()
  }
  const watchAncestors = () => {
    mutations!.disconnect()
    const nodes = new Set<HTMLElement>()
    for (const root of [host, content]) for (let node: HTMLElement | null = root; node; node = node.parentElement) nodes.add(node)
    for (const node of nodes) mutations!.observe(node, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'] })
  }
  const refreshIntersection = () => {
    hostVisible = false; contentVisible = false
    intersection!.unobserve(host); intersection!.unobserve(content)
    intersection!.observe(host); intersection!.observe(content)
  }
  function onDocumentVisibility() { if (live) { refreshIntersection(); flush() } }
  try {
    intersection = new win.IntersectionObserver(entries => {
      if (!live) return
      for (const entry of entries) {
        if (entry.target === host) hostVisible = entry.isIntersecting
        if (entry.target === content) contentVisible = entry.isIntersecting
      }
      flush()
    })
    mutations = new win.MutationObserver(() => {
      if (!live) return
      if (!host.isConnected || !content.isConnected) { fail(new CanvasHtmlTextureError('detached', 'The source or visual region was removed.')); return }
      watchAncestors(); refreshIntersection(); flush()
    })
    watchAncestors()
    doc.addEventListener('visibilitychange', onDocumentVisibility)
    media?.addEventListener?.('change', onMotion)
    signal.addEventListener('abort', onAbort, { once: true })
    intersection.observe(host); intersection.observe(content)
    if (signal.aborted) onAbort()
    else if (media?.matches) onMotion()
    else checkGeometry()
  } catch (error) { cleanup(); throw error }
  return {
    failed,
    isVisible,
    wait(): Promise<void> {
      if (failure !== undefined) return Promise.reject(failure)
      if (!live) return Promise.reject(cancelled())
      return new Promise<void>((resolve, reject) => { waiters.add({ resolve, reject }); flush() })
    },
    dispose: cleanup,
  }
}

/** Own public consumers' effects so disabling this plugin releases their resources. */
export function createCanvasClientScope(dependencies: {
  load?: typeof loadCanvasEffect
  bridge?: typeof createCanvasHtmlTextureBridge
  particleScroll?: typeof createCanvasParticleScrollBridge
  isolated?: typeof createCanvasIsolatedEffect
  htmlEffect?: typeof createCanvasHtmlEffectAdapter
} = {}) {
  const load = dependencies.load ?? loadCanvasEffect
  const makeBridge = dependencies.bridge ?? createCanvasHtmlTextureBridge
  const makeParticleScroll = dependencies.particleScroll ?? createCanvasParticleScrollBridge
  const makeIsolated = dependencies.isolated ?? createCanvasIsolatedEffect
  const makeHtmlEffect = dependencies.htmlEffect ?? createCanvasHtmlEffectAdapter
  const effects = new Set<CanvasEffectInstance>()
  const bridges = new Set<CanvasHtmlTextureBridge>()
  const scrollBridges = new Set<CanvasParticleScrollBridge>()
  const isolatedEffects = new Set<CanvasIsolatedEffect>()
  const isolatedLoads = new Set<AbortController>()
  const htmlEffects = new Set<CanvasHtmlEffectAdapter>()
  const htmlLoads = new Set<AbortController>()
  const pendingFactories = new Set<() => void>()
  const bridgesBySource = new Map<unknown, CanvasHtmlTextureBridge>()
  const effectsByBridge = new Map<CanvasHtmlTextureBridge, Set<CanvasEffectInstance>>()
  const listeners = new Set<() => void>()
  let active = true
  const assertActive = () => { if (!active) throw new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。') }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  const getSnapshot = () => active

  async function loadEffect(slug: string, signal?: AbortSignal): Promise<CanvasEffectFactory> {
    assertActive()
    if (signal?.aborted) throw new Error('CANVAS_CLIENT_CANCELLED: 效果已取消。')
    let cancel!: () => void
    let cancelBySignal!: () => void
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。'))
      cancelBySignal = () => reject(new Error('CANVAS_CLIENT_CANCELLED: 效果已取消。'))
    })
    pendingFactories.add(cancel)
    signal?.addEventListener('abort', cancelBySignal, { once: true })
    let factory: CanvasEffectFactory
    try { factory = await Promise.race([load(slug), stopped]) }
    finally { pendingFactories.delete(cancel); signal?.removeEventListener('abort', cancelBySignal) }
    assertActive()
    if (signal?.aborted) throw new Error('CANVAS_CLIENT_CANCELLED: 效果已取消。')
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
      ...(bridge.getSnapshot ? { getSnapshot: () => bridge.getSnapshot!() } : {}),
      ...(bridge.whenDisposed ? { whenDisposed: () => bridge.whenDisposed!() } : {}),
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

  async function createHtmlEffect(options: CanvasHtmlEffectClientOptions): Promise<CanvasHtmlEffectAdapter> {
    assertActive()
    if (!isCanvasHtmlEffectName(options.component)) throw new CanvasHtmlTextureError('unsupported', 'This visual effect has not been verified.')
    if (options.content?.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      throw new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.')
    }
    const controller = new AbortController()
    htmlLoads.add(controller)
    const forwardAbort = () => controller.abort()
    if (options.signal?.aborted) controller.abort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const unlink = () => { htmlLoads.delete(controller); options.signal?.removeEventListener('abort', forwardAbort) }
    let wrapped: CanvasHtmlEffectAdapter | undefined
    let failure: CanvasHtmlTextureError | undefined
    let visibility: ReturnType<typeof htmlVisibilityGate> | undefined
    try {
      const cancelled = () => active ? new Error('CANVAS_CLIENT_CANCELLED: 效果已取消。') : new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用。')
      visibility = htmlVisibilityGate(options.host, options.content, controller.signal, cancelled)
      do { await visibility.wait() } while (!visibility.isVisible())
      const factory = await Promise.race([loadEffect(options.component, controller.signal), visibility.failed])
      // Visibility may have changed while the shared import was in flight.
      do { await visibility.wait() } while (!visibility.isVisible())
      visibility.dispose(); visibility = undefined
      const effect = await makeHtmlEffect({ ...options, factory, signal: controller.signal,
        acquireSlot: acquireCanvasSlot, createTextureBridge: textureOptions => createBridge(textureOptions, true), onError: error => {
          failure = error
          if (wrapped) htmlEffects.delete(wrapped)
          unlink()
          options.onError(error)
        },
      })
      if (!active || controller.signal.aborted || failure) {
        effect.dispose()
        throw failure ?? new Error('CANVAS_CLIENT_DISPOSED: 智能 UI 已停用或效果已取消。')
      }
      let closed = false
      wrapped = {
        refresh: () => effect.refresh(), resize: () => effect.resize(), setOptions: next => effect.setOptions(next),
        splash: (x, y, strength) => effect.splash(x, y, strength), melt: (x, y) => effect.melt(x, y), burst: () => effect.burst(),
        dispose() {
          if (closed) return
          closed = true
          htmlEffects.delete(wrapped!)
          unlink()
          effect.dispose()
        },
      }
      htmlEffects.add(wrapped)
      return wrapped
    } catch (error) { controller.abort(); unlink(); throw error }
    finally { visibility?.dispose() }
  }

  function dispose() {
    if (!active) return
    active = false
    const errors: unknown[] = []
    for (const cancel of [...pendingFactories]) cancel()
    pendingFactories.clear()
    for (const effect of [...isolatedEffects]) try { effect.destroy() } catch (error) { errors.push(error) }
    for (const controller of [...isolatedLoads]) controller.abort()
    for (const effect of [...htmlEffects]) try { effect.dispose() } catch (error) { errors.push(error) }
    for (const controller of [...htmlLoads]) controller.abort()
    // Scroll adapters own listeners in addition to their effects and textures.
    for (const bridge of [...scrollBridges]) try { bridge.dispose() } catch (error) { errors.push(error) }
    // Upstream effects must stop before their texture bridges are removed.
    for (const effect of [...effects]) try { effect.destroy() } catch (error) { errors.push(error) }
    for (const bridge of [...bridges]) try { bridge.dispose() } catch (error) { errors.push(error) }
    for (const listener of [...listeners]) try { listener() } catch (error) { errors.push(error) }
    listeners.clear()
    if (errors.length) throw new AggregateError(errors, 'Canvas UI resources could not all be released.')
  }
  return { loadCanvasEffect: (slug: string) => loadEffect(slug), createCanvasHtmlTextureBridge: (options: CanvasHtmlTextureOptions) => createBridge(options), createCanvasParticleScrollBridge: createParticleScroll, createCanvasIsolatedEffect: createIsolated, createCanvasHtmlEffect: createHtmlEffect, subscribe, getSnapshot, dispose }
}
