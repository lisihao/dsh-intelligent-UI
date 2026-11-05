// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import type { AsciiGpuEffect, AsciiGpuEffectOptions } from '../src/ascii-gpu-effect.js'
import type { AsciiVisualCapture } from '../src/ascii-visual-capture.js'

const mocks = vi.hoisted(() => ({ createEffect: vi.fn(), capture: vi.fn(), release: vi.fn() }))
vi.mock('../src/ascii-gpu-effect.js', () => ({ createAsciiGpuEffect: mocks.createEffect }))
vi.mock('../src/ascii-visual-capture.js', () => ({
  captureAsciiVisual: mocks.capture,
  measureAsciiVisualBounds: (source: Element) => source.getBoundingClientRect(),
}))
vi.mock('../src/canvas-runtime-client.js', () => ({ acquireCanvasSlot: (start: () => void) => { start(); return mocks.release } }))

import { installAsciiVisualTheme } from '../src/ascii-visual-theme.js'

type AdaptiveSettings = ExperienceSettings & { adaptive?: { enabled?: boolean } }
type Gpu = { options: AsciiGpuEffectOptions; effect: AsciiGpuEffect; update: ReturnType<typeof vi.fn> }

const rect = (left = 10, top = 10, width = 200, height = 100) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
}) as DOMRect

function capture(): AsciiVisualCapture {
  const bitmap = document.createElement('canvas')
  bitmap.width = 200; bitmap.height = 100
  return { bitmap, width: 200, height: 100, textRects: [], dispose: vi.fn() }
}

function store(initial: AdaptiveSettings) {
  let settings = initial
  const listeners = new Set<() => void>()
  return {
    snapshot: () => ({ settings }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: AdaptiveSettings) => { settings = next; listeners.forEach(listener => listener()) },
  }
}

function settings(theme: 'empryo' | 'ascii-gpu', adaptiveEnabled: boolean): AdaptiveSettings {
  return { ...initialSettings(), takeover: true, theme: { activeId: theme, installed: [] }, adaptive: { enabled: adaptiveEnabled, styleMode: 'automatic' as const } }
}

function visual(scope?: 'true' | 'false') {
  const host = document.createElement('div')
  host.className = 'dsh-experience'
  const wrapper = document.createElement('div')
  if (scope) {
    wrapper.dataset.iexpAdaptiveTheme = scope === 'true' ? 'ascii-gpu' : 'empryo'
    wrapper.dataset.iexpAdaptiveGpu = scope
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 200 100')
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line.dataset.source = scope ?? 'global'
  line.setAttribute('d', 'M0 75L100 20')
  svg.append(line); wrapper.append(svg); host.append(wrapper); document.body.append(host)
  svg.getBoundingClientRect = () => rect()
  return { host, wrapper, svg, line }
}

let gpu: Gpu[]
let autoPaint: boolean
let cleanup: (() => void)[]

beforeEach(() => {
  gpu = []; autoPaint = true; cleanup = []
  mocks.createEffect.mockReset(); mocks.capture.mockReset(); mocks.release.mockReset()
  mocks.capture.mockImplementation(async () => capture())
  mocks.createEffect.mockImplementation(async (options: AsciiGpuEffectOptions) => {
    const update = vi.fn((_bitmap: HTMLCanvasElement, revision: number) => { if (autoPaint) options.onFrame(revision) })
    const effect = { output: document.createElement('canvas'), update, resize: vi.fn(), dispose: vi.fn() }
    gpu.push({ options, effect, update })
    return effect
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 0))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const value = computed(element)
    return new Proxy(value, { get(target, property, receiver) {
      if (property === 'opacity' && !target.opacity) return '1'
      return Reflect.get(target, property, receiver)
    } })
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn(),
  })) as never)
})

afterEach(() => {
  cleanup.forEach(dispose => dispose())
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren()
})

describe('adaptive ASCII GPU scopes', () => {
  it('projects only a mounted GPU scope when the global settings theme is non-GPU', async () => {
    const local = visual('true'), global = visual()
    global.line.setAttribute('data-iexp-ascii-paint', 'existing')
    const stop = installAsciiVisualTheme(store(settings('empryo', true))); cleanup.push(stop)

    await vi.waitFor(() => expect(local.line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    expect(global.line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(mocks.capture).toHaveBeenCalledWith(local.svg, expect.any(AbortSignal), expect.any(Object))
    expect(mocks.capture.mock.calls.some(args => args[0] === global.svg)).toBe(false)
  })

  it('requires adaptive.enabled before a local GPU scope can activate projection', async () => {
    const local = visual('true'), state = store(settings('empryo', false))
    const stop = installAsciiVisualTheme(state); cleanup.push(stop)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
    expect(local.line.hasAttribute('data-iexp-ascii-paint')).toBe(false)

    state.set(settings('empryo', true))
    await vi.waitFor(() => expect(local.line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    state.set(settings('empryo', false))
    await vi.waitFor(() => expect(local.line.hasAttribute('data-iexp-ascii-paint')).toBe(false))
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
  })

  it('lets a local non-GPU scope opt out even when the global settings theme is GPU', async () => {
    const local = visual('false'), global = visual()
    const stop = installAsciiVisualTheme(store(settings('ascii-gpu', true))); cleanup.push(stop)
    await vi.waitFor(() => expect(global.line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    expect(local.line.hasAttribute('data-iexp-ascii-paint')).toBe(false)

    local.wrapper.removeAttribute('data-iexp-adaptive-gpu')
    await vi.waitFor(() => expect(local.line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
  })

  it('starts and stops when a GPU scope is mounted or removed', async () => {
    const root = document.createElement('div')
    root.className = 'dsh-experience'
    document.body.append(root)
    const state = store(settings('empryo', true)), stop = installAsciiVisualTheme(state); cleanup.push(stop)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()

    const mounted = visual('true')
    root.append(mounted.host)
    await vi.waitFor(() => expect(mounted.line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    mounted.host.remove()
    await vi.waitFor(() => expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull())
    expect(mounted.line.hasAttribute('data-iexp-ascii-paint')).toBe(false)
  })
})
