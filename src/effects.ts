import { Component, createElement as h, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type ReactElement } from 'react'
import { visualEffectSchema, type VisualEffectId } from './effect-contracts.js'
export { visualEffectSchema, type VisualEffectId } from './effect-contracts.js'

/**
 * An effect is presentation-only. Requests are data, and third-party executable
 * code can be registered only by an installed frontend integration.
 */
export interface VisualEffectManifest {
  id: VisualEffectId
  version: string
  component: ComponentType<{ children?: ReactNode }>
  gpu: boolean
}

export class VisualEffectRegistry {
  private entries: ReadonlyMap<VisualEffectId, VisualEffectManifest> = new Map()
  private listeners = new Set<() => void>()
  getSnapshot = (): ReadonlyMap<VisualEffectId, VisualEffectManifest> => this.entries
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  register(manifest: VisualEffectManifest): () => void {
    visualEffectSchema.parse(manifest.id)
    if (!manifest.version.trim() || typeof manifest.component !== 'function')
      throw new Error('EXPERIENCE_EFFECT_INVALID_PROVIDER: Effect requires a version and a React component')
    if (this.entries.has(manifest.id))
      throw new Error('EXPERIENCE_EFFECT_REGISTRATION_CONFLICT: ' + manifest.id)
    const entry = Object.freeze({ ...manifest })
    const next = new Map(this.entries)
    next.set(entry.id, entry)
    this.entries = next
    this.emit()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.entries.get(entry.id) !== entry) return
      const remaining = new Map(this.entries)
      remaining.delete(entry.id)
      this.entries = remaining
      this.emit()
    }
  }

  private emit() { for (const listener of [...this.listeners]) listener() }
}
export const visualEffects = new VisualEffectRegistry()

/** A license-independent native fallback; this is not Canvas UI source code. */
function NativeHeadlineReveal({ children }: { children?: ReactNode }): ReactElement {
  return h('div', { className: 'iexp-headline-reveal' }, children)
}
export function installBuiltInVisualEffects(): () => void {
  return visualEffects.register({ id: 'iexp.headline-reveal', version: '1.0.0', component: NativeHeadlineReveal, gpu: false })
}

class EffectBoundary extends Component<{ children?: ReactNode, fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

/**
 * Isolate the effect to one heading. Source content stays in the DOM on failure,
 * reduced motion, unsupported providers, hidden pages, and streaming updates.
 * The provider owns the GPU lifecycle; unmounting the component triggers cleanup.
 */
export function VisualEffectSlot({ id, children }: { id: VisualEffectId, children?: ReactNode }): ReactElement {
  const entries = useSyncExternalStore(visualEffects.subscribe, visualEffects.getSnapshot, visualEffects.getSnapshot)
  const manifest = entries.get(id)
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [reducedMotion, setReducedMotion] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !container.current) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    media.addEventListener?.('change', update)
    update()
    return () => media.removeEventListener?.('change', update)
  }, [])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const enabled = !!manifest && visible && pageVisible && !reducedMotion
  const status = !manifest ? 'unavailable' : reducedMotion ? 'reduced-motion' : enabled ? 'active' : 'inactive'
  return h('div', { ref: container, className: 'iexp-effect-slot', 'data-iexp-effect-id': id, 'data-iexp-effect-status': status },
    enabled && manifest
      ? h(EffectBoundary, { key: id, fallback: children }, h(manifest.component, null, children))
      : children)
}

export const visualEffectCss = `
.iexp-content .iexp-effect-slot { min-width: 0; }
.iexp-content .iexp-headline-reveal > h1 { animation: iexp-headline-reveal 520ms ease-out both; }
@keyframes iexp-headline-reveal {
  from { opacity: .55; filter: blur(3px); transform: translateY(5px); }
  to { opacity: 1; filter: blur(0); transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .iexp-content .iexp-headline-reveal > h1 { animation: none; }
}
`
