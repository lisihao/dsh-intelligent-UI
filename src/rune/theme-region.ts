import {
  createElement as h,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { acquireCanvasSlot } from '../canvas-runtime-client.js'
import type { ComponentRuntimeInfo } from '../component-runtime-contracts.js'
import { parseRuneRuntimeInfo, type RuneSurfaceState } from './contracts.js'
import { createBrowserRuneChannel, RuneFrameHost, type RuneFrameEvent, type RuneFrameWindowLike } from './frame-host.js'
import { RuneSurfaceIds, collectRuneRegionGeometry, type RuneRegionGeometry } from './geometry.js'

export type RuneThemeRegionProps = Readonly<{
  readonly children?: ReactNode
  /** A fixed Host asset route, never model-provided HTML or JavaScript. */
  readonly getRuntimeInfo?: () => Promise<ComponentRuntimeInfo>
  readonly className?: string
}>

type RuntimeState =
  | Readonly<{ readonly kind: 'pending' }>
  | Readonly<{ readonly kind: 'ready', readonly value: ComponentRuntimeInfo }>
  | Readonly<{ readonly kind: 'failure', readonly code: string }>

type MarkerSnapshot = Readonly<{
  readonly surface: string | null
  readonly role: string | null
  readonly material: string | null
}>

const DISPOSE_GRACE_MS = 250

/**
 * Rune has no CSS material fallback. These rules merely remove a selected
 * source shell's old paint after Rust reports that it mounted; padding, flow,
 * text, code, math, focus outlines and DOM event handlers remain native.
 */
export const runeThemeRegionCss = `
[data-rune-region]{position:relative;isolation:isolate;min-width:0;max-width:100%;--rune-metal-label-ink:#ededef;--rune-metal-label-outline:#0b0b0d;--rune-metal-label-shadow:rgb(11 11 13 / .72)}
[data-rune-region] [data-rune-frame]{position:absolute;inset-inline-start:0;inset-block-start:0;z-index:0;display:block;border:0;pointer-events:none}
[data-rune-region] [data-rune-source]{position:relative;z-index:1;min-width:0;max-width:100%}
[data-rune-region="mounted"] [data-rune-surface]{background:transparent!important;background-image:none!important}
[data-rune-region="mounted"] [data-rune-surface]:not(:focus-visible){border-color:transparent!important;box-shadow:none!important}
[data-rune-region="mounted"] [data-rune-surface]:hover:not(:focus-visible){transform:none!important}
/* Rune paints the metal only; this retains a readable native DOM label across chrome highlights. */
[data-rune-region="mounted"] [data-rune-surface-role="button"][data-rune-rendered-material="liquid-metal"],[data-rune-region="mounted"] [data-rune-surface-role="toggle"][data-rune-rendered-material="liquid-metal"]{color:var(--rune-metal-label-ink)!important;font-weight:700;-webkit-text-stroke:.65px var(--rune-metal-label-outline);text-shadow:0 1px 1px var(--rune-metal-label-shadow)}
[data-rune-region] [data-rune-status]{position:relative;z-index:2;margin:8px 0 0;font:inherit;font-size:.875em;line-height:1.5}
@media (prefers-reduced-motion:reduce){[data-rune-region] [data-rune-frame]{animation:none}}
`

function codeOf(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message : String(error)
  return /^[A-Z][A-Z0-9_]{2,119}$/u.test(value) ? value : fallback
}

function parentOrigin(): string {
  const origin = window.location.origin
  if (!/^https?:\/\/[^/]+$/u.test(origin)) throw new Error('RUNE_FRAME_PARENT_ORIGIN_UNAVAILABLE')
  return origin
}

function restoreMarkers(markers: Map<HTMLElement, MarkerSnapshot>): void {
  for (const [element, prior] of markers) {
    if (prior.surface === null) element.removeAttribute('data-rune-surface')
    else element.setAttribute('data-rune-surface', prior.surface)
    if (prior.role === null) element.removeAttribute('data-rune-surface-role')
    else element.setAttribute('data-rune-surface-role', prior.role)
    if (prior.material === null) element.removeAttribute('data-rune-rendered-material')
    else element.setAttribute('data-rune-rendered-material', prior.material)
  }
  markers.clear()
}

function reconcileMarkers(markers: Map<HTMLElement, MarkerSnapshot>, geometry: RuneRegionGeometry): void {
  const wanted = new Set(geometry.surfaces.map(item => item.element))
  for (const [element, prior] of [...markers]) {
    if (wanted.has(element)) continue
    if (prior.surface === null) element.removeAttribute('data-rune-surface')
    else element.setAttribute('data-rune-surface', prior.surface)
    if (prior.role === null) element.removeAttribute('data-rune-surface-role')
    else element.setAttribute('data-rune-surface-role', prior.role)
    if (prior.material === null) element.removeAttribute('data-rune-rendered-material')
    else element.setAttribute('data-rune-rendered-material', prior.material)
    markers.delete(element)
  }
  for (const { element, surface } of geometry.surfaces) {
    if (!markers.has(element)) markers.set(element, {
      surface: element.getAttribute('data-rune-surface'),
      role: element.getAttribute('data-rune-surface-role'),
      material: element.getAttribute('data-rune-rendered-material'),
    })
    if (element.getAttribute('data-rune-surface') !== surface.id) element.setAttribute('data-rune-surface', surface.id)
    if (element.getAttribute('data-rune-surface-role') !== surface.role) element.setAttribute('data-rune-surface-role', surface.role)
    if (element.getAttribute('data-rune-rendered-material') !== surface.material) element.setAttribute('data-rune-rendered-material', surface.material)
  }
}

function stateFor(states: WeakMap<HTMLElement, RuneSurfaceState>, element: HTMLElement): RuneSurfaceState {
  return states.get(element) ?? 'idle'
}

function targetSurface(root: HTMLElement, candidates: ReadonlyMap<HTMLElement, unknown>, target: EventTarget | null): HTMLElement | undefined {
  let element = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  while (element) {
    if (candidates.has(element)) return element
    if (element === root) return undefined
    element = element.parentElement
  }
  return undefined
}

/**
 * A bounded opaque Rune-owned canvas underneath real source DOM. It does not
 * project or clone content into Rust: the iframe gets only validated geometry,
 * states and one of the three material names.
 */
export function RuneThemeRegion({ children, getRuntimeInfo, className }: RuneThemeRegionProps): ReactElement {
  const root = useRef<HTMLElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useRef<RuneFrameHost>()
  const markers = useRef(new Map<HTMLElement, MarkerSnapshot>())
  const ids = useRef(new RuneSurfaceIds())
  const states = useRef(new WeakMap<HTMLElement, RuneSurfaceState>())
  const candidates = useRef(new Map<HTMLElement, unknown>())
  const geometry = useRef<RuneRegionGeometry>()
  const sent = useRef<string>()
  const layoutFingerprint = useRef<string>()
  const raf = useRef<number>()
  const disposeTimer = useRef<number>()
  const mountedRef = useRef(false)
  const scheduleRef = useRef<() => void>(() => {})
  const [visible, setVisible] = useState(false)
  const [runtime, setRuntime] = useState<RuntimeState>({ kind: 'pending' })
  const [slotActive, setSlotActive] = useState(false)
  const [frameGeneration, setFrameGeneration] = useState(0)
  const [frameLoaded, setFrameLoaded] = useState(0)
  const [painted, setPainted] = useState(false)
  const [layout, setLayout] = useState<RuneRegionGeometry>()
  const [runtimeError, setRuntimeError] = useState<string>()

  const teardownHost = useCallback(() => {
    const current = host.current
    if (!current) return
    current.requestDispose()
    const close = () => {
      if (host.current !== current) return
      current.close()
      host.current = undefined
    }
    if (disposeTimer.current !== undefined) window.clearTimeout(disposeTimer.current)
    disposeTimer.current = window.setTimeout(close, DISPOSE_GRACE_MS)
  }, [])

  const flushGeometry = useCallback(() => {
    raf.current = undefined
    const element = root.current
    if (!element || !slotActive) return
    const next = collectRuneRegionGeometry(element, ids.current, node => stateFor(states.current, node))
    if (!next) {
      geometry.current = undefined
      candidates.current = new Map()
      layoutFingerprint.current = undefined
      restoreMarkers(markers.current)
      setLayout(undefined)
      return
    }
    geometry.current = next
    candidates.current = new Map(next.surfaces.map(item => [item.element, true]))
    const nextLayoutFingerprint = JSON.stringify([next.visibleYOffset, next.payload])
    if (layoutFingerprint.current !== nextLayoutFingerprint) {
      layoutFingerprint.current = nextLayoutFingerprint
      setLayout(next)
    }
    if (painted) reconcileMarkers(markers.current, next)
    const active = host.current
    if (!active) return
    const fingerprint = JSON.stringify(next.payload)
    if (!mountedRef.current || fingerprint === sent.current) return
    try {
      active.update(next.payload)
      sent.current = fingerprint
    } catch (error) {
      setRuntimeError(codeOf(error, 'RUNE_FRAME_UPDATE_FAILED'))
    }
  }, [painted, slotActive])

  scheduleRef.current = () => {
    if (raf.current !== undefined) return
    const view = root.current?.ownerDocument.defaultView
    const request = view?.requestAnimationFrame?.bind(view)
    if (request) {
      raf.current = request(() => flushGeometry())
      return
    }
    flushGeometry()
  }

  useEffect(() => {
    const element = root.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === element)
      setVisible(entry?.isIntersecting === true)
    }, { rootMargin: '0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    if (!getRuntimeInfo) {
      setRuntime({ kind: 'failure', code: 'RUNE_RUNTIME_SOURCE_SERVICE_UNAVAILABLE' })
      return
    }
    let live = true
    setRuntime({ kind: 'pending' })
    setRuntimeError(undefined)
    void getRuntimeInfo().then(value => parseRuneRuntimeInfo(value)).then(value => {
      if (live) setRuntime({ kind: 'ready', value })
    }).catch(error => {
      if (live) setRuntime({ kind: 'failure', code: codeOf(error, 'RUNE_RUNTIME_INFO_UNAVAILABLE') })
    })
    return () => { live = false }
  }, [getRuntimeInfo, visible])

  const runnable = visible && runtime.kind === 'ready' && !runtimeError
  useLayoutEffect(() => {
    if (!runnable) {
      setSlotActive(false)
      return
    }
    let released = false
    const release = acquireCanvasSlot(() => {
      if (released) return
      mountedRef.current = false
      sent.current = undefined
      setPainted(false)
      setFrameLoaded(0)
      setFrameGeneration(value => value + 1)
      setSlotActive(true)
    })
    return () => {
      released = true
      setSlotActive(false)
      mountedRef.current = false
      setPainted(false)
      restoreMarkers(markers.current)
      teardownHost()
      release()
    }
  }, [runnable, teardownHost])

  const connectIfReady = useCallback(() => {
    if (host.current || !slotActive || runtime.kind !== 'ready' || frameLoaded !== frameGeneration || !geometry.current) return
    const element = frame.current
    if (!element?.contentWindow) {
      setRuntimeError('RUNE_FRAME_WINDOW_UNAVAILABLE')
      return
    }
    try {
      const info = runtime.value
      const targetOrigin = new URL(info.frameUrl).origin
      const instance = new RuneFrameHost(
        element.contentWindow as unknown as RuneFrameWindowLike,
        parentOrigin(),
        targetOrigin,
        createBrowserRuneChannel,
        (event: RuneFrameEvent) => {
          if (event.kind === 'mounted') {
            mountedRef.current = true
            setPainted(true)
            const latest = geometry.current
            if (latest) {
              sent.current = JSON.stringify(latest.payload)
              reconcileMarkers(markers.current, latest)
            }
            scheduleRef.current()
            return
          }
          if (event.kind === 'disposed') {
            if (disposeTimer.current !== undefined) window.clearTimeout(disposeTimer.current)
            instance.close()
            if (host.current === instance) host.current = undefined
            return
          }
          if (event.kind === 'error') {
            mountedRef.current = false
            restoreMarkers(markers.current)
            setPainted(false)
            setRuntimeError(event.code)
          }
        },
      )
      host.current = instance
      instance.connect()
      sent.current = JSON.stringify(geometry.current.payload)
      instance.mount(geometry.current.payload)
    } catch (error) {
      setRuntimeError(codeOf(error, 'RUNE_FRAME_CONNECT_FAILED'))
    }
  }, [frameGeneration, frameLoaded, runtime, slotActive])

  useLayoutEffect(() => {
    if (slotActive) {
      const view = root.current?.ownerDocument.defaultView
      if (raf.current !== undefined && view?.cancelAnimationFrame) view.cancelAnimationFrame(raf.current)
      raf.current = undefined
      scheduleRef.current()
    }
    else {
      geometry.current = undefined
      candidates.current = new Map()
      layoutFingerprint.current = undefined
      setLayout(undefined)
    }
  }, [slotActive])

  useLayoutEffect(() => {
    connectIfReady()
  }, [connectIfReady, layout])

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const schedule = () => scheduleRef.current()
    const view = element.ownerDocument.defaultView
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    resize?.observe(element)
    const mutations = new MutationObserver(schedule)
    mutations.observe(element, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: [
        'class', 'style', 'disabled', 'aria-disabled', 'aria-pressed',
        'data-iexp-block-theme', 'data-iexp-block-id', 'data-iexp-executable-component',
        'data-canvas-component', 'data-tuffui-component', 'data-dil-library-component',
        'data-rune-material', 'data-rune-surface-role',
      ],
    })
    const setState = (event: Event, value: RuneSurfaceState) => {
      const target = targetSurface(element, candidates.current, event.target)
      if (!target) return
      states.current.set(target, value)
      schedule()
    }
    const pointerOut = (event: PointerEvent) => {
      const target = targetSurface(element, candidates.current, event.target)
      if (!target) return
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null
      if (related && target.contains(related)) return
      states.current.set(target, 'idle')
      schedule()
    }
    const pointerOver = (event: PointerEvent) => setState(event, 'hover')
    const pointerDown = (event: PointerEvent) => setState(event, 'pressed')
    const pointerUp = (event: PointerEvent) => setState(event, 'hover')
    const pointerCancel = (event: PointerEvent) => setState(event, 'idle')
    const focusIn = (event: FocusEvent) => setState(event, 'focus')
    const focusOut = (event: FocusEvent) => setState(event, 'idle')
    element.addEventListener('pointerover', pointerOver, true)
    element.addEventListener('pointerout', pointerOut, true)
    element.addEventListener('pointerdown', pointerDown, true)
    element.addEventListener('pointerup', pointerUp, true)
    element.addEventListener('pointercancel', pointerCancel, true)
    element.addEventListener('focusin', focusIn, true)
    element.addEventListener('focusout', focusOut, true)
    view?.addEventListener('resize', schedule)
    element.ownerDocument.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      resize?.disconnect()
      mutations.disconnect()
      element.removeEventListener('pointerover', pointerOver, true)
      element.removeEventListener('pointerout', pointerOut, true)
      element.removeEventListener('pointerdown', pointerDown, true)
      element.removeEventListener('pointerup', pointerUp, true)
      element.removeEventListener('pointercancel', pointerCancel, true)
      element.removeEventListener('focusin', focusIn, true)
      element.removeEventListener('focusout', focusOut, true)
      view?.removeEventListener('resize', schedule)
      element.ownerDocument.removeEventListener('scroll', schedule, true)
      if (raf.current !== undefined && view?.cancelAnimationFrame) view.cancelAnimationFrame(raf.current)
      raf.current = undefined
      restoreMarkers(markers.current)
    }
  }, [])

  useEffect(() => () => {
    if (disposeTimer.current !== undefined) window.clearTimeout(disposeTimer.current)
    const current = host.current
    current?.requestDispose()
    current?.close()
    host.current = undefined
    restoreMarkers(markers.current)
  }, [])

  const status = runtime.kind === 'failure'
    ? `Rune 材质服务不可用：${runtime.code}；已保留原始来源。`
    : runtimeError
      ? `Rune Rust 材质未能启动：${runtimeError}；已保留原始来源。`
      : visible && runtime.kind === 'pending'
        ? '正在准备 Rune Rust 材质…'
        : visible && slotActive && !painted
          ? '正在启动 Rune Rust 材质…'
          : undefined
  const current = layout
  const frameStyle: CSSProperties = {
    width: current?.frameWidth ?? 1,
    height: current?.frameHeight ?? 1,
    transform: `translateY(${String(current?.visibleYOffset ?? 0)}px)`,
    visibility: slotActive && current ? 'visible' : 'hidden',
  }
  const regionState = painted ? 'mounted' : runtime.kind === 'failure' || runtimeError ? 'failure' : 'pending'

  return h('section', {
    ref: root,
    className,
    'data-rune-region': regionState,
    'data-iexp-block-theme': 'rune',
    style: { minWidth: 0, maxWidth: '100%' } as CSSProperties,
  },
  h('style', { 'data-rune-region-style': true }, runeThemeRegionCss),
  slotActive && runtime.kind === 'ready' ? h('iframe', {
    key: `rune-${String(frameGeneration)}`,
    ref: frame,
    src: runtime.value.frameUrl,
    title: 'Rune Rust material renderer',
    tabIndex: -1,
    'aria-hidden': true,
    sandbox: 'allow-scripts',
    referrerPolicy: 'no-referrer',
    'data-rune-frame': true,
    onLoad: () => setFrameLoaded(frameGeneration),
    style: frameStyle,
  }) : null,
  h('div', { 'data-rune-source': true }, children),
  status ? h('p', { 'data-rune-status': regionState, role: runtime.kind === 'failure' || runtimeError ? 'status' : undefined }, status) : null)
}
