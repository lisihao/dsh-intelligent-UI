// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasPointerRelay } from '../src/canvas-pointer-relay.js'

// jsdom does not provide PointerEvent; browsers use their own constructor.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly width: number
  readonly height: number
  readonly pressure: number
  readonly tangentialPressure: number
  readonly tiltX: number
  readonly tiltY: number
  readonly twist: number
  readonly altitudeAngle: number
  readonly azimuthAngle: number

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
    this.pointerType = init.pointerType ?? ''
    this.isPrimary = init.isPrimary ?? false
    this.width = init.width ?? 1
    this.height = init.height ?? 1
    this.pressure = init.pressure ?? 0
    this.tangentialPressure = init.tangentialPressure ?? 0
    this.tiltX = init.tiltX ?? 0
    this.tiltY = init.tiltY ?? 0
    this.twist = init.twist ?? 0
    this.altitudeAngle = init.altitudeAngle ?? 0
    this.azimuthAngle = init.azimuthAngle ?? 0
    Object.defineProperties(this, {
      movementX: { value: init.movementX ?? 0 }, movementY: { value: init.movementY ?? 0 },
    })
  }
}

function fixture() {
  const stageParent = document.createElement('div'), proxyParent = document.createElement('div')
  const stage = document.createElement('div'), proxy = document.createElement('div')
  stageParent.append(stage); proxyParent.attachShadow({ mode: 'closed' }).append(proxy); document.body.append(stageParent, proxyParent)
  return { stageParent, proxyParent, stage, proxy }
}

beforeEach(() => { vi.stubGlobal('PointerEvent', TestPointerEvent) })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('private stage pointer relay', () => {
  it('forwards supported pointer events and preserves coordinates, buttons and modifiers', () => {
    const { stageParent, proxyParent, stage, proxy } = fixture()
    const onStageAncestor = vi.fn(), onProxyAncestor = vi.fn(), onDocumentCapture = vi.fn(), onWindowCapture = vi.fn(), received: PointerEvent[] = []
    stageParent.addEventListener('pointerdown', onStageAncestor)
    proxyParent.addEventListener('pointerdown', onProxyAncestor)
    document.addEventListener('pointerdown', onDocumentCapture, true)
    window.addEventListener('pointerdown', onWindowCapture, true)
    for (const type of ['pointermove', 'pointerdown', 'pointerleave']) {
      proxy.addEventListener(type, event => received.push(event as PointerEvent))
    }
    const dispose = createCanvasPointerRelay({ stage, getProxy: () => proxy })
    const input = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, clientX: 129, clientY: 47, screenX: 342, screenY: 159,
      movementX: -4, movementY: 5, button: 2, buttons: 4, ctrlKey: true, shiftKey: true,
      pointerId: 17, pointerType: 'pen', isPrimary: true, width: 3, height: 5, pressure: 0.7,
      tangentialPressure: 0.2, tiltX: 10, tiltY: -20, twist: 40, altitudeAngle: 0.8, azimuthAngle: 0.3,
    })
    stage.dispatchEvent(new PointerEvent('pointermove', { clientX: 7, clientY: 8 }))
    stage.dispatchEvent(input)
    stage.dispatchEvent(new PointerEvent('pointerleave', { clientX: 9, clientY: 10 }))

    expect(received.map(event => event.type)).toEqual(['pointermove', 'pointerdown', 'pointerleave'])
    expect(received[1]).not.toBe(input)
    expect(received[1]).toMatchObject({
      clientX: 129, clientY: 47, screenX: 342, screenY: 159, movementX: -4, movementY: 5,
      button: 2, buttons: 4, ctrlKey: true, shiftKey: true, pointerId: 17, pointerType: 'pen',
      isPrimary: true, width: 3, height: 5, pressure: 0.7, tangentialPressure: 0.2,
      tiltX: 10, tiltY: -20, twist: 40, altitudeAngle: 0.8, azimuthAngle: 0.3,
      bubbles: false, cancelable: false,
    })
    expect(onStageAncestor).toHaveBeenCalledOnce()
    expect(onStageAncestor).toHaveBeenCalledWith(input)
    expect(onProxyAncestor).not.toHaveBeenCalled()
    expect(onDocumentCapture).toHaveBeenCalledOnce()
    expect(onDocumentCapture).toHaveBeenCalledWith(input)
    expect(onWindowCapture).toHaveBeenCalledOnce()
    expect(onWindowCapture).toHaveBeenCalledWith(input)
    expect(input.defaultPrevented).toBe(false)
    document.removeEventListener('pointerdown', onDocumentCapture, true)
    window.removeEventListener('pointerdown', onWindowCapture, true)
    dispose()
  })

  it('looks up the active proxy per event and ignores detached or invalid targets', () => {
    const { stage, proxy } = fixture()
    const replacementHost = document.createElement('div'), replacement = document.createElement('div')
    replacementHost.attachShadow({ mode: 'closed' }).append(replacement); document.body.append(replacementHost)
    const first = vi.fn(), second = vi.fn()
    proxy.addEventListener('pointermove', first); replacement.addEventListener('pointermove', second)
    let current: HTMLElement | null = proxy
    const dispose = createCanvasPointerRelay({ stage, getProxy: () => current })
    const move = () => stage.dispatchEvent(new PointerEvent('pointermove', { clientX: 20 }))
    move(); current = replacement; move(); current = null; move()
    replacement.remove(); current = replacement; move()
    current = stage; move()
    const frame = document.createElement('iframe'); document.body.append(frame)
    const other = frame.contentDocument!.createElement('div'), otherHost = frame.contentDocument!.createElement('div')
    otherHost.attachShadow({ mode: 'closed' }).append(other); frame.contentDocument!.body.append(otherHost)
    current = other; move()
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    stage.remove(); current = proxy; move()
    expect(first).toHaveBeenCalledOnce()
    dispose()
  })

  it('does not forward into ordinary DOM, an open shadow root, or the stage root', () => {
    const { stage } = fixture()
    const ordinary = document.createElement('div'); document.body.append(ordinary)
    const openHost = document.createElement('div'), openProxy = document.createElement('div')
    openHost.attachShadow({ mode: 'open' }).append(openProxy); document.body.append(openHost)
    const sharedHost = document.createElement('div'), sharedProxy = document.createElement('div')
    const sharedRoot = sharedHost.attachShadow({ mode: 'closed' }); document.body.append(sharedHost)
    const received = vi.fn()
    ordinary.addEventListener('pointermove', received); openProxy.addEventListener('pointermove', received); sharedProxy.addEventListener('pointermove', received)
    let current = ordinary
    const dispose = createCanvasPointerRelay({ stage, getProxy: () => current })
    stage.dispatchEvent(new PointerEvent('pointermove'))
    current = openProxy; stage.dispatchEvent(new PointerEvent('pointermove'))
    sharedRoot.append(stage, sharedProxy); current = sharedProxy; stage.dispatchEvent(new PointerEvent('pointermove'))
    expect(received).not.toHaveBeenCalled()
    dispose()
  })

  it('disposes idempotently without removing other listeners or touching the source', () => {
    const { stageParent, stage, proxy } = fixture()
    const source = document.createElement('p'); source.textContent = 'Original source'; document.body.append(source)
    const original = source.outerHTML, own = vi.fn(), thirdParty = vi.fn()
    proxy.addEventListener('pointerdown', own); stageParent.addEventListener('pointerdown', thirdParty)
    const dispose = createCanvasPointerRelay({ stage, getProxy: () => proxy })
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    dispose(); dispose()
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(own).toHaveBeenCalledOnce()
    expect(thirdParty).toHaveBeenCalledTimes(2)
    expect(source.outerHTML).toBe(original)
  })

  it('uses the stage document PointerEvent constructor', () => {
    const frame = document.createElement('iframe'); document.body.append(frame)
    const frameWindow = frame.contentWindow as Window & typeof globalThis
    const frameDocument = frame.contentDocument!
    let constructions = 0
    class FramePointerEvent extends TestPointerEvent {
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); constructions++ }
    }
    Object.defineProperty(frameWindow, 'PointerEvent', { configurable: true, value: FramePointerEvent })
    const stage = frameDocument.createElement('div'), proxy = frameDocument.createElement('div'), proxyHost = frameDocument.createElement('div')
    proxyHost.attachShadow({ mode: 'closed' }).append(proxy); frameDocument.body.append(stage, proxyHost)
    const received = vi.fn(); proxy.addEventListener('pointermove', received)
    const dispose = createCanvasPointerRelay({ stage, getProxy: () => proxy })
    const input = new FramePointerEvent('pointermove', { clientX: 32 }); constructions = 0
    stage.dispatchEvent(input)
    expect(constructions).toBe(1)
    expect(received).toHaveBeenCalledOnce()
    expect(received.mock.calls[0]![0]).toBeInstanceOf(FramePointerEvent)
    dispose()
  })

  it('fails clearly before attaching listeners when the document lacks PointerEvent', () => {
    const { stage, proxy } = fixture()
    vi.stubGlobal('PointerEvent', undefined)
    const add = vi.spyOn(stage, 'addEventListener')
    expect(() => createCanvasPointerRelay({ stage, getProxy: () => proxy })).toThrow('CANVAS_POINTER_UNSUPPORTED')
    expect(add).not.toHaveBeenCalled()
  })
})
