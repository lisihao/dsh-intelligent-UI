// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/canvas-html-texture.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/canvas-html-texture.js')>()
  return { ...original, readCanvasHtmlTextureSource: vi.fn(() => ({})) }
})

import {
  CANVAS_EXTENDED_HTML_EFFECTS,
  createCanvasExtendedHtmlEffect,
} from '../src/canvas-extended-adapter.js'
import { CanvasHtmlTextureError, type CanvasHtmlTextureBridge, type CanvasHtmlTextureOptions } from '../src/canvas-html-texture.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

type Paint = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type Context = {
  drawImage: ReturnType<typeof vi.fn>
  clearRect: ReturnType<typeof vi.fn>
  drawElementImage?: (element: Element, x: number, y: number) => void
}

const contexts = new WeakMap<HTMLCanvasElement, Context>()
const gl = { clearColor: vi.fn(), clear: vi.fn(), isContextLost: () => false, getExtension: () => null, COLOR_BUFFER_BIT: 16384 }
let resizeCallback: (() => void) | undefined

class ResizeStub {
  constructor(callback: () => void) { resizeCallback = callback }
  observe() {}
  disconnect() {}
}

function rectangle(left: number, top: number, width = 320, height = 180): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

function region(left: number, top: number, text: string): HTMLDivElement {
  const element = document.createElement('div')
  element.textContent = text
  document.body.append(element)
  Object.defineProperties(element, { clientWidth: { configurable: true, value: 320 }, clientHeight: { configurable: true, value: 180 } })
  element.getBoundingClientRect = () => rectangle(left, top)
  return element
}

function textureFactory() {
  const attached: CanvasHtmlTextureOptions[] = []
  const refresh = vi.fn(async () => {
    for (const options of attached) (options.source as Paint).onpaint?.()
  })
  const dispose = vi.fn()
  const create = vi.fn<(options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge>(options => {
    attached.push(options)
    const context = options.source.getContext('2d') as unknown as Context
    context.drawElementImage = vi.fn()
    return { refresh, dispose, whenDisposed: () => Promise.resolve() }
  })
  return { create, refresh, dispose }
}

beforeEach(() => {
  resizeCallback = undefined
  vi.stubGlobal('ResizeObserver', ResizeStub)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') return gl as unknown as WebGL2RenderingContext
    if (!contexts.has(this)) contexts.set(this, { drawImage: vi.fn(), clearRect: vi.fn() })
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function options(component: Parameters<typeof createCanvasExtendedHtmlEffect>[0]['component'], factory: CanvasEffectFactory, texture = textureFactory()) {
  const content = region(0, 0, 'Retained source')
  const host = region(400, 0, '')
  return {
    value: { component, content, host, factory, texture, options: {
      component, content, host, factory, createTextureBridge: texture.create,
      scope: 'visual-only' as const, sourceRemainsVisible: true as const, pointer: false,
      onError: vi.fn(), acquireSlot: (activate: () => void) => { activate(); return vi.fn() },
    } },
  }
}

describe('extended Canvas UI HTML adapters', () => {
  it('keeps the original source separate while the real factory receives a private texture proxy', async () => {
    const destroy = vi.fn(), resize = vi.fn(), setOptions = vi.fn(), impact = vi.fn()
    const factory: CanvasEffectFactory = vi.fn((elements) => {
      const source = elements.source as Paint
      source.onpaint = () => (source.getContext('2d') as unknown as Context).drawElementImage?.(elements.content as Element, 0, 0)
      source.requestPaint?.()
      return { destroy, resize, setOptions, impact }
    })
    const f = options('force-field', factory)
    const before = f.value.content.outerHTML
    const adapter = await createCanvasExtendedHtmlEffect(f.value.options)
    const elements = vi.mocked(factory).mock.calls[0]![0]
    const proxy = elements.content as HTMLElement

    expect(elements.source).not.toBe(f.value.content)
    expect(proxy).not.toBe(f.value.content)
    expect(proxy.getRootNode()).toBeInstanceOf(ShadowRoot)
    expect((proxy.getRootNode() as ShadowRoot).mode).toBe('closed')
    expect(f.value.content.outerHTML).toBe(before)
    expect(f.value.texture.create).toHaveBeenCalledWith(expect.objectContaining({ content: f.value.content, sourceRemainsVisible: true, scope: 'visual-only' }))
    expect(f.value.texture.refresh).toHaveBeenCalled()
    adapter.impact(12, 18)
    adapter.setOptions({ intensity: 2 })
    expect(impact).toHaveBeenCalledWith(12, 18)
    expect(setOptions).toHaveBeenCalledWith({ intensity: 2 })
    resizeCallback?.()
    expect(resize).toHaveBeenCalled()
    expect(adapter.getSnapshot()).toMatchObject({ component: 'force-field', sourcePanels: 1, captures: expect.any(Number), updates: 1, resizes: 1, destroyed: false })
    expect(adapter.getSnapshot().captures).toBeGreaterThan(0)
    adapter.dispose()
    expect(adapter.getSnapshot()).toMatchObject({ destroyed: true, captures: expect.any(Number) })
    expect(destroy).toHaveBeenCalledOnce()
    expect(f.value.texture.dispose).toHaveBeenCalledOnce()
    expect(f.value.host.children).toHaveLength(0)
  })

  it('supplies two independently retained source slots to ASCII Sweep and forwards its actual sweep method', async () => {
    const sweep = vi.fn(), destroy = vi.fn()
    const factory: CanvasEffectFactory = vi.fn(elements => {
      for (const slot of elements.slots as Array<{ source: Paint, content: HTMLElement }>) {
        slot.source.onpaint = () => (slot.source.getContext('2d') as unknown as Context).drawElementImage?.(slot.content, 0, 0)
        slot.source.requestPaint?.()
      }
      return { sweep, destroy }
    })
    const f = options('ascii-sweep', factory)
    const alternate = region(0, 220, 'Second retained source')
    const adapter = await createCanvasExtendedHtmlEffect({ ...f.value.options, alternateContent: alternate })
    const slots = vi.mocked(factory).mock.calls[0]![0].slots as Array<{ source: HTMLCanvasElement, content: HTMLElement }>
    expect(slots).toHaveLength(2)
    expect(slots[0]!.content).not.toBe(f.value.content)
    expect(slots[1]!.content).not.toBe(alternate)
    expect(f.value.texture.create).toHaveBeenCalledTimes(2)
    adapter.sweep(1, { angle: 90 })
    expect(sweep).toHaveBeenCalledWith(1, { angle: 90 })
    adapter.dispose()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('requires the second retained panel for ASCII Sweep and directs Liquid to its isolated runner', async () => {
    const factory = vi.fn()
    const sweep = options('ascii-sweep', factory)
    await expect(createCanvasExtendedHtmlEffect(sweep.value.options)).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('second retained') })
    const liquid = options('liquid', factory)
    await expect(createCanvasExtendedHtmlEffect(liquid.value.options)).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('USE_ISOLATED_RUNNER') })
    expect(factory).not.toHaveBeenCalled()
  })

  it('gives Peel its own captured under-layer rather than an original DOM node', async () => {
    const destroy = vi.fn()
    const factory: CanvasEffectFactory = vi.fn(elements => {
      const source = elements.source as Paint
      source.onpaint = () => (source.getContext('2d') as unknown as Context).drawElementImage?.(elements.content as Element, 0, 0)
      source.requestPaint?.()
      return { destroy }
    })
    const f = options('peel', factory)
    const adapter = await createCanvasExtendedHtmlEffect(f.value.options)
    const elements = vi.mocked(factory).mock.calls[0]![0]
    expect(elements.under).toBeInstanceOf(HTMLCanvasElement)
    expect(elements.under).not.toBe(f.value.content)
    adapter.dispose()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects callback-shaped options instead of passing executable values to upstream code', async () => {
    const f = options('bubble', vi.fn(() => ({ destroy: vi.fn() })))
    await expect(createCanvasExtendedHtmlEffect({ ...f.value.options, effectOptions: { onSweepStart: () => undefined } })).rejects.toMatchObject({
      code: 'unsupported', message: expect.stringContaining('option names'),
    })
  })

  it('records a complete fixed adapter inventory with exactly one named isolated runner', () => {
    expect(CANVAS_EXTENDED_HTML_EFFECTS).toHaveLength(12)
    expect(CANVAS_EXTENDED_HTML_EFFECTS.filter(entry => entry.availability === 'isolated-runner')).toEqual([
      expect.objectContaining({ component: 'liquid' }),
    ])
    expect(CANVAS_EXTENDED_HTML_EFFECTS.find(entry => entry.component === 'ascii-sweep')).toMatchObject({ sourceRequirement: 'two-visible-sources' })
  })
})
