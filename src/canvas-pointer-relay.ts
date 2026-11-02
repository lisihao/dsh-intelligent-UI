export interface CanvasPointerRelayOptions {
  /** The dedicated visual copy, never the original content. */
  readonly stage: HTMLElement
  /** The current input target in a private closed shadow root, absent while inactive. */
  readonly getProxy: () => HTMLElement | null | undefined
}

const POINTER_EVENTS = ['pointermove', 'pointerdown', 'pointerleave'] as const

/** Forward stage input to a private proxy without changing the original event. */
export function createCanvasPointerRelay({ stage, getProxy }: CanvasPointerRelayOptions): () => void {
  const doc = stage.ownerDocument
  const view = doc.defaultView
  const PointerEventConstructor = view?.PointerEvent
  const ShadowRootConstructor = view?.ShadowRoot
  if (!view || typeof PointerEventConstructor !== 'function' || typeof ShadowRootConstructor !== 'function') {
    throw new Error('CANVAS_POINTER_UNSUPPORTED: Isolated pointer events are unavailable in this document.')
  }

  let active = true
  const forward = (event: PointerEvent) => {
    if (!active || !stage.isConnected || stage.ownerDocument !== doc) return
    const proxy = getProxy()
    if (!proxy || !proxy.isConnected || proxy.ownerDocument !== doc || proxy === stage) return
    const root = proxy.getRootNode()
    // A non-bubbling DOM event still reaches document capture listeners. A
    // separate closed shadow root and composed:false keep it in the private
    // effect, including the capture phase.
    if (!(root instanceof ShadowRootConstructor) || root.mode !== 'closed' || root === stage.getRootNode()) return

    // The real stage event continues normally and is never cancelled or stopped.
    const forwarded = new PointerEventConstructor(event.type, {
      bubbles: false, cancelable: false, composed: false, view: event.view,
      detail: event.detail,
      clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY,
      movementX: event.movementX, movementY: event.movementY,
      button: event.button, buttons: event.buttons,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary,
      width: event.width, height: event.height, pressure: event.pressure,
      tangentialPressure: event.tangentialPressure, tiltX: event.tiltX, tiltY: event.tiltY,
      twist: event.twist, altitudeAngle: event.altitudeAngle, azimuthAngle: event.azimuthAngle,
    })
    proxy.dispatchEvent(forwarded)
  }

  for (const type of POINTER_EVENTS) stage.addEventListener(type, forward, { passive: true })
  return () => {
    if (!active) return
    active = false
    for (const type of POINTER_EVENTS) stage.removeEventListener(type, forward)
  }
}
