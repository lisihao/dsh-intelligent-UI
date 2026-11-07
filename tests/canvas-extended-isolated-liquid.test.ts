// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return { ...original, readCanvasHtmlTextureSource: vi.fn(() => ({ width: 320, height: 180 })) }
})

import { canvasExtendedLiquidFrameDocument, CANVAS_EXTENDED_LIQUID_FRAME_CSP } from '../src/canvas-extended-isolated-frame.js'
import { createCanvasExtendedLiquidEffect } from '../src/canvas-extended-isolated-liquid.js'
import type { CanvasHtmlTextureBridge, CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'

type Paint = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type Context = { clearRect: ReturnType<typeof vi.fn>, drawElementImage?: (element: Element, x: number, y: number) => void }
const contexts = new WeakMap<HTMLCanvasElement, Context>()

class ChannelStub {
  port1 = { close: vi.fn(), postMessage: vi.fn(), onmessage: null as unknown }
  port2 = {}
}

class ResizeStub {
  constructor(private readonly callback: () => void) {}
  observe() { this.callback() }
  disconnect() {}
}

class IntersectionStub {
  observe() {}
  disconnect() {}
}

function rect(left: number, top: number): DOMRect {
  return { x: left, y: top, left, top, width: 320, height: 180, right: left + 320, bottom: top + 180, toJSON: () => ({}) } as DOMRect
}

function fixture() {
  const content = document.createElement('div'), host = document.createElement('div')
  content.textContent = 'Retained source remains outside the iframe.'
  content.getBoundingClientRect = () => rect(0, 0)
  host.getBoundingClientRect = () => rect(400, 0)
  document.body.append(content, host)
  return { content, host, onError: vi.fn() }
}

function textureFactory() {
  let supplied: CanvasHtmlTextureOptions | undefined
  const refresh = vi.fn(async () => { (supplied?.source as Paint | undefined)?.onpaint?.() })
  const dispose = vi.fn()
  const create = vi.fn<(options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge>(options => {
    supplied = options
    const context = options.source.getContext('2d') as unknown as Context
    context.drawElementImage = vi.fn()
    Object.defineProperty(options.source, 'requestPaint', { configurable: true, value: () => { void refresh() } })
    return { refresh, dispose }
  })
  return { create, refresh, dispose, get supplied() { return supplied } }
}

function bootstrap(frame: HTMLIFrameElement) {
  const channel = new ChannelStub()
  window.dispatchEvent(new MessageEvent('message', {
    origin: 'null', source: frame.contentWindow,
    data: { type: 'canvas-extended-liquid-bootstrap', nonce: '01'.repeat(16) },
    ports: [channel.port1 as unknown as MessagePort],
  }))
  return channel
}

beforeEach(() => {
  class UrlStub extends URL {
    static createObjectURL = vi.fn(() => 'blob:http://localhost/fixed-liquid-frame')
    static revokeObjectURL = vi.fn()
  }
  const matchMedia = () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const createImageBitmap = vi.fn(async () => ({ width: 320, height: 180, close: vi.fn() }))
  for (const [key, value] of Object.entries({ URL: UrlStub, MessageChannel: ChannelStub, ResizeObserver: ResizeStub, IntersectionObserver: IntersectionStub, matchMedia, createImageBitmap })) {
    Object.defineProperty(window, key, { configurable: true, writable: true, value })
    vi.stubGlobal(key, value)
  }
  const deterministicRandom = ((value: ArrayBufferView) => {
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(1)
    return value
  }) as typeof window.crypto.getRandomValues
  vi.spyOn(window.crypto, 'getRandomValues').mockImplementation(deterministicRandom)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, { clearRect: vi.fn() })
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isolated Liquid Canvas runner', () => {
  it('uses a fixed opaque document which accepts only a fixed Liquid factory, JSON options and ImageBitmap input', () => {
    const html = canvasExtendedLiquidFrameDocument('01'.repeat(16))
    expect(CANVAS_EXTENDED_LIQUID_FRAME_CSP).toContain("connect-src 'none'")
    expect(CANVAS_EXTENDED_LIQUID_FRAME_CSP).toContain("frame-src 'none'")
    expect(html).toContain("data.factory !== 'createLiquid'")
    expect(html).toContain('value.bitmap instanceof ImageBitmap')
    expect(html).toContain("type: 'mounted'")
    expect(html).toContain("type: 'updated'")
    expect(html).toContain("type: 'resized'")
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|eval\(/u)
    expect(() => canvasExtendedLiquidFrameDocument('</script>')).toThrow('CANVAS_EXTENDED_LIQUID_NONCE')
  })

  it('sends the integrity-route module and a bitmap to an opaque frame while retaining source DOM outside it', async () => {
    const source = fixture(), textures = textureFactory()
    const fetchModule = vi.fn(async () => new Response('export function createLiquid(){ return { destroy(){} } }', { headers: { 'content-type': 'text/javascript' } }))
    const pending = createCanvasExtendedLiquidEffect({
      ...source,
      effectOptions: { density: 0.5 },
      fetchModule,
      createTextureBridge: textures.create,
      acquireSlot: (activate: () => void) => { activate(); return vi.fn() },
    })
    await Promise.resolve()
    const frame = source.host.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toBe('/api/intelligent-ui-canvas-liquid-frame?nonce=01010101010101010101010101010101')
    const channel = bootstrap(frame)
    await vi.waitFor(() => expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'canvas-extended-liquid-start', factory: 'createLiquid', options: { density: 0.5 },
    })))
    const deliver = channel.port1.onmessage as (message: { data: { type: string } }) => void
    deliver({ data: { type: 'ready' } })
    deliver({ data: { type: 'paint' } })
    await vi.waitFor(() => expect(channel.port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'bitmap', revision: 1 }), expect.any(Array)))
    deliver({ data: { type: 'mounted' } })
    deliver({ data: { type: 'drawn' } })
    const effect = await pending
    expect(fetchModule).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/intelligent-ui-canvas-effect\?slug=liquid&revision=/u), expect.any(AbortSignal))
    expect(source.content.textContent).toBe('Retained source remains outside the iframe.')
    effect.setOptions({ pressure: 2 })
    effect.resize()
    expect(channel.port1.postMessage).toHaveBeenCalledWith({ type: 'options', options: { pressure: 2 } })
    expect(channel.port1.postMessage).toHaveBeenCalledWith({ type: 'resize' })
    deliver({ data: { type: 'updated' } }); deliver({ data: { type: 'resized' } })
    expect(effect.getSnapshot()).toEqual({ mounted: true, bitmaps: 1, updates: 1, resizes: 1, destroyed: false })
    effect.destroy()
    expect(effect.getSnapshot()).toMatchObject({ destroyed: true })
    expect(channel.port1.postMessage).toHaveBeenCalledWith({ type: 'destroy' })
    deliver({ data: { type: 'destroyed' } })
    expect(source.host.querySelector('iframe')).toBeNull()
    expect(textures.dispose).toHaveBeenCalledOnce()
  })

  it('rejects overlap, non-JSON options and invalid module responses before exposing a visual frame', async () => {
    const overlap = fixture()
    overlap.host.getBoundingClientRect = overlap.content.getBoundingClientRect
    await expect(createCanvasExtendedLiquidEffect(overlap)).rejects.toThrow('CANVAS_EXTENDED_LIQUID_OVERLAP')
    expect(overlap.host.querySelector('iframe')).toBeNull()

    const invalidOptions = fixture()
    await expect(createCanvasExtendedLiquidEffect({ ...invalidOptions, effectOptions: { onLoad: () => undefined } })).rejects.toThrow('CANVAS_EXTENDED_LIQUID_OPTIONS_KEY')
    expect(invalidOptions.host.querySelector('iframe')).toBeNull()

    const badModule = fixture(), textures = textureFactory()
    const pending = createCanvasExtendedLiquidEffect({
      ...badModule,
      fetchModule: async () => new Response('not module', { headers: { 'content-type': 'text/plain' } }),
      createTextureBridge: textures.create,
      acquireSlot: (activate: () => void) => { activate(); return vi.fn() },
    })
    await Promise.resolve()
    bootstrap(badModule.host.querySelector('iframe')!)
    await expect(pending).rejects.toThrow('CANVAS_EXTENDED_LIQUID_MODULE')
    expect(badModule.host.querySelector('iframe')).toBeNull()
  })
})
