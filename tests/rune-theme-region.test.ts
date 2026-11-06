// @vitest-environment jsdom
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const slot = vi.hoisted(() => {
  const releases: ReturnType<typeof vi.fn>[] = []
  return { releases, acquire: vi.fn((activate: () => void) => { activate(); const release = vi.fn(); releases.push(release); return release }) }
})
vi.mock('../src/canvas-runtime-client.js', () => ({ acquireCanvasSlot: slot.acquire }))

import { RuneThemeRegion } from '../src/rune/theme-view.js'

class Port {
  readonly messages: unknown[] = []
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  readonly close = vi.fn()
  postMessage(message: unknown): void { this.messages.push(message) }
  start(): void {}
}
let channel: { port1: Port, port2: Port } | undefined
class Channel {
  readonly port1 = new Port()
  readonly port2 = new Port()
  constructor() { channel = this }
}
let observer: Observer | undefined
class Observer {
  disconnect = vi.fn()
  observe = vi.fn()
  constructor(private readonly callback: IntersectionObserverCallback) { observer = this }
  emit(target: Element, visible: boolean): void {
    this.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}
class Resizer {
  disconnect = vi.fn()
  observe = vi.fn()
  constructor(_callback: ResizeObserverCallback) {}
}
const frames: FrameRequestCallback[] = []

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
function setRect(element: HTMLElement, value: DOMRect): void { element.getBoundingClientRect = () => value }
async function settle(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
async function flushFrames(): Promise<void> {
  await act(async () => { const queued = frames.splice(0); queued.forEach(callback => callback(0)); await Promise.resolve() })
}
const info = { protocolVersion: 1 as const, library: 'rune' as const, sourceCommit: '4ca683561a100e16b1ce32f3576f4ade61bd2924', frameUrl: 'http://127.0.0.1:48765/component-assets/rune/frame.html' }

beforeEach(() => {
  channel = undefined; observer = undefined; frames.splice(0); slot.acquire.mockClear(); slot.releases.splice(0)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('ResizeObserver', Resizer)
  vi.stubGlobal('MessageChannel', Channel)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
})
afterEach(() => { document.body.replaceChildren(); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('RuneThemeRegion', () => {
  it('keeps source content when the host cannot provide the fixed Rune asset service', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(h(RuneThemeRegion, null, h('pre', null, 'const untouched = true'))))
    await act(async () => observer!.emit(host.querySelector('[data-rune-region]')!, true)); await settle()
    expect(host.textContent).toContain('RUNE_RUNTIME_SOURCE_SERVICE_UNAVAILABLE')
    expect(host.textContent).toContain('const untouched = true')
    expect(host.querySelector('iframe')).toBeNull()
    await act(async () => root.unmount())
  })

  it('mounts the fixed opaque Rust frame under source DOM, sends only geometry, updates hover, and disposes offscreen', async () => {
    const clicked = vi.fn()
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => root.render(h(RuneThemeRegion, { getRuntimeInfo: async () => info },
      h('section', { 'data-iexp-block-id': 'card' }, h('button', { onClick: clicked }, '保存'), h('pre', null, 'const source = 1')),
      h('section', { 'data-iexp-executable-component': 'uiverse:soft-relief:card' }, h('button', null, 'Foreign')),
    )))
    const region = host.querySelector<HTMLElement>('[data-rune-region]')!, source = host.querySelector<HTMLElement>('[data-rune-source]')!
    const card = source.querySelector<HTMLElement>('[data-iexp-block-id]')!, button = source.querySelector<HTMLButtonElement>('button')!, code = source.querySelector('pre')!, foreign = source.querySelector<HTMLElement>('[data-iexp-executable-component]')!
    setRect(region, rect(20, -40, 390, 720)); setRect(source, rect(20, -40, 390, 720)); setRect(card, rect(36, 12, 358, 160)); setRect(button, rect(48, 124, 88, 36)); setRect(foreign, rect(36, 210, 358, 100))
    await act(async () => observer!.emit(region, true)); await settle(); await flushFrames(); await settle(); await flushFrames(); await settle()
    const iframe = host.querySelector<HTMLIFrameElement>('iframe')!
    expect(iframe.style.visibility).toBe('visible')
    const frame = { postMessage: vi.fn() }
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: frame })
    await act(async () => iframe.dispatchEvent(new Event('load'))); await settle()
    expect(frame.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'rune/connect' }), '*', expect.any(Array))
    const connect = frame.postMessage.mock.calls[0]![0] as { nonce: string }
    await act(async () => channel!.port1.onmessage?.({ data: { type: 'rune/ready', protocolVersion: 1, nonce: connect.nonce, revision: 0 } }))
    const mount = channel!.port1.messages.find((message: any) => message.type === 'rune/mount') as { revision: number, payload: { reducedMotion: boolean, surfaces: Array<{ id: string }> } }
    expect(mount.payload.reducedMotion).toBe(true)
    expect(mount.payload.surfaces.every(surface => !String(surface.id).includes('source'))).toBe(true)
    await act(async () => channel!.port1.onmessage?.({ data: { type: 'rune/mounted', protocolVersion: 1, nonce: connect.nonce, revision: mount.revision } }))
    await settle()
    expect(region.getAttribute('data-rune-region')).toBe('mounted')
    expect(button.getAttribute('data-rune-surface')).toBeTruthy()
    expect(code.getAttribute('data-rune-surface')).toBeNull()
    expect(foreign.getAttribute('data-rune-surface')).toBeNull()
    expect(iframe.style.transform).toBe('translateY(40px)')
    await act(async () => button.click())
    expect(clicked).toHaveBeenCalledTimes(1)
    await act(async () => button.dispatchEvent(new Event('pointerover', { bubbles: true }))); await flushFrames(); await settle()
    expect(channel!.port1.messages.some((message: any) => message.type === 'rune/update')).toBe(true)
    await act(async () => observer!.emit(region, false)); await settle()
    expect(channel!.port1.messages.some((message: any) => message.type === 'rune/dispose')).toBe(true)
    expect(button.getAttribute('data-rune-surface')).toBeNull()
    expect(slot.releases[0]).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })
})
