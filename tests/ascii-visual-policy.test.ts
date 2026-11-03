// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import type { AsciiGpuEffectOptions } from '../src/ascii-gpu-effect.js'
import type { AsciiVisualCapture } from '../src/ascii-visual-capture.js'

const mocks = vi.hoisted(() => ({ createEffect: vi.fn(), capture: vi.fn(), release: vi.fn() }))
vi.mock('../src/ascii-gpu-effect.js', () => ({ createAsciiGpuEffect: mocks.createEffect }))
vi.mock('../src/ascii-visual-capture.js', () => ({ captureAsciiVisual: mocks.capture, measureAsciiVisualBounds: (source: Element) => source.getBoundingClientRect() }))
vi.mock('../src/canvas-runtime-client.js', () => ({ acquireCanvasSlot: (start: () => void) => { start(); return mocks.release } }))
import { publishAsciiVisualFrame, releaseAsciiVisualFrame } from '../src/ascii-visual-frames.js'
import { installAsciiVisualTheme } from '../src/ascii-visual-theme.js'

const MARK = 'data-iexp-ascii-paint'
const rect = (left = 10, top = 10, width = 200, height = 100) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
const ascii = (): ExperienceSettings => ({ ...initialSettings(), takeover: true, theme: { activeId: 'ascii', installed: [] } })
const stopFunctions: Array<() => void> = []
let frames: string[], sourceFrame: string, paints: Array<{ options: AsciiGpuEffectOptions; update: ReturnType<typeof vi.fn> }>, autoPaint: boolean
function store() {
  let settings = ascii()
  const listeners = new Set<() => void>()
  return { snapshot: () => ({ settings }), subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: (value: ExperienceSettings) => { settings = value; listeners.forEach(listener => listener()) } }
}
function image() {
  const host = document.createElement('div'); host.className = 'dsh-experience'
  const element = document.createElement('img'); element.alt = 'Original graph'; element.getBoundingClientRect = () => rect()
  host.append(element); document.body.append(host)
  return { element, host }
}
function svg(animated: boolean) {
  const host = document.createElement('div'); host.className = 'dsh-experience'
  host.innerHTML = '<svg viewBox="0 0 200 100"><path d="M0 0L20 20"></path></svg>'
  document.body.append(host)
  const element = host.querySelector('svg')!, path = element.querySelector('path')!
  element.getBoundingClientRect = () => rect()
  if (animated) path.style.animationName = 'drift'
  return { element, path }
}
async function tick(milliseconds: number) { await vi.advanceTimersByTimeAsync(milliseconds); await Promise.resolve() }
function activate(state = store()) { const stop = installAsciiVisualTheme(state); stopFunctions.push(stop); return { state, stop } }

beforeEach(() => {
  vi.useFakeTimers(); frames = []; sourceFrame = 'frame-0'; paints = []; autoPaint = true
  mocks.createEffect.mockReset(); mocks.capture.mockReset(); mocks.release.mockReset()
  mocks.capture.mockImplementation(async (source: Element) => {
    const bitmap = document.createElement('canvas'); bitmap.width = 200; bitmap.height = 100; bitmap.dataset.frame = sourceFrame
    const bounds = source.getBoundingClientRect()
    return { bitmap, width: 200, height: 100, bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, textRects: [], dispose: vi.fn() } satisfies AsciiVisualCapture
  })
  mocks.createEffect.mockImplementation(async (options: AsciiGpuEffectOptions) => {
    const update = vi.fn((_bitmap: HTMLCanvasElement, revision: number) => { if (autoPaint) options.onFrame(revision) })
    paints.push({ options, update })
    return { output: document.createElement('canvas'), update, resize: vi.fn(), dispose: vi.fn() }
  })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 1))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const value = computed(element)
    return new Proxy(value, { get(target, property, receiver) {
      // Model the actual injected hide rule as well as the unmodified opacity.
      if (property === 'opacity') return element.getAttribute(MARK) === 'true' ? '0' : target.opacity || '1'
      return Reflect.get(target, property, receiver)
    } })
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    clearRect: vi.fn(), getImageData: vi.fn(() => ({data: new Uint8ClampedArray(4)})), fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(),
    drawImage: vi.fn((bitmap: HTMLCanvasElement) => { if (bitmap.dataset.frame) frames.push(bitmap.dataset.frame) }),
  })) as never)
})
afterEach(() => {
  stopFunctions.splice(0).forEach(stop => stop())
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren()
})

describe('ASCII visual source policy', () => {
  it('restores sources for a visible dialog and rejects a late GPU frame until the dialog closes', async () => {
    const { element } = image(); activate(); await tick(10)
    expect(element.getAttribute(MARK)).toBe('true')
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.getBoundingClientRect = () => rect(20, 20, 100, 70)
    autoPaint = false
    document.dispatchEvent(new Event('scroll')); await tick(10)
    const last = paints[0]!.update.mock.calls.at(-1)![1] as number
    document.body.append(dialog)
    // Simulate GPU completion before MutationObserver has processed dialog insertion.
    paints[0]!.options.onFrame(last)
    expect(element.hasAttribute(MARK)).toBe(false)
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
    await tick(10)
    dialog.remove(); await tick(10)
    const latest = paints[0]!.update.mock.calls.at(-1)![1] as number
    paints[0]!.options.onFrame(latest)
    expect(element.getAttribute(MARK)).toBe('true')
  })

  it('does not resurrect sources with zero or partial opacity on the element or ancestor', async () => {
    const zero = image(), partial = image(), ancestor = image(), opaque = image()
    zero.element.style.opacity = '0'; partial.element.style.opacity = '0.4'; ancestor.host.style.opacity = '0.5'
    activate(); await tick(10)
    const sources = mocks.capture.mock.calls.map(([element]) => element)
    expect(sources).not.toContain(zero.element)
    expect(sources).not.toContain(partial.element)
    expect(sources).not.toContain(ancestor.element)
    expect(sources).toContain(opaque.element)
    expect(zero.element.hasAttribute(MARK)).toBe(false)
    expect(partial.element.hasAttribute(MARK)).toBe(false)
    expect(ancestor.element.hasAttribute(MARK)).toBe(false)
    expect(opaque.element.getAttribute(MARK)).toBe('true')
  })

  it('continues to refresh an image hidden by its own ASCII mark, then respects native opacity changes', async () => {
    const { element } = image(); activate(); await tick(10)
    expect(element.getAttribute(MARK)).toBe('true')
    expect(window.getComputedStyle(element).opacity).toBe('0')
    sourceFrame = 'frame-1'; await tick(205)
    expect(mocks.capture.mock.calls.filter(([source]) => source === element).length).toBeGreaterThanOrEqual(2)
    expect(frames).toContain('frame-1')
    expect(element.getAttribute(MARK)).toBe('true')
    element.style.opacity = '0'; await tick(10)
    expect(element.hasAttribute(MARK)).toBe(false)
    expect(element.style.opacity).toBe('0')
  })

  it('refreshes visible image frames and stops recapturing after offscreen and theme disable', async () => {
    const { element } = image(), { state } = activate(); await tick(10)
    expect(frames).toContain('frame-0')
    sourceFrame = 'frame-1'; await tick(205)
    expect(frames).toContain('frame-1')
    sourceFrame = 'frame-2'; await tick(205)
    expect(frames).toContain('frame-2')
    element.getBoundingClientRect = () => rect(-400, 10, 200, 100)
    document.dispatchEvent(new Event('scroll')); await tick(10)
    const offscreenCalls = mocks.capture.mock.calls.length
    await tick(650)
    expect(mocks.capture).toHaveBeenCalledTimes(offscreenCalls)
    expect(element.hasAttribute(MARK)).toBe(false)
    element.getBoundingClientRect = () => rect()
    document.dispatchEvent(new Event('scroll')); await tick(205)
    expect(mocks.capture.mock.calls.length).toBeGreaterThan(offscreenCalls)
    state.set({ ...ascii(), takeover: false })
    const disabledCalls = mocks.capture.mock.calls.length
    await tick(650)
    expect(mocks.capture).toHaveBeenCalledTimes(disabledCalls)
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
  })

  it('does not keep redrawing static SVGs but refreshes CSS-animated SVG sources', async () => {
    const stationary = svg(false), moving = svg(true)
    activate(); await tick(10)
    const count = (source: Element) => mocks.capture.mock.calls.filter(([value]) => value === source).length
    expect(count(stationary.element)).toBe(1)
    expect(count(moving.element)).toBe(1)
    await tick(650)
    expect(count(stationary.element)).toBe(1)
    expect(count(moving.element)).toBeGreaterThanOrEqual(3)
    expect(count(moving.element)).toBeLessThanOrEqual(5)
  })
  it('coalesces owned continuous frames without restoring the original on draw counters, and treats pause as normal', async () => {
    const {host} = image(); host.replaceChildren()
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100
    canvas.getBoundingClientRect = () => rect(); canvas.dataset.iexpContinuousVisual = 'true'; host.append(canvas)
    activate(); publishAsciiVisualFrame(canvas); await tick(10)
    expect(canvas.getAttribute(MARK)).toBe('true')
    autoPaint = false
    canvas.dataset.drawnFrames = '2'; publishAsciiVisualFrame(canvas); await Promise.resolve()
    expect(canvas.getAttribute(MARK)).toBe('true')
    await tick(10)
    expect(canvas.getAttribute(MARK)).toBe('true')
    releaseAsciiVisualFrame(canvas); await tick(10)
    expect(canvas.hasAttribute(MARK)).toBe(false)
    const status = document.querySelector<HTMLElement>('[data-iexp-ascii-status]')!
    expect(status.textContent).toBe(''); expect(status.style.display).toBe('none')
  })

  it('retains native fine flow connections beneath the transparent glyph projection', async () => {
    const {element,path} = svg(false); element.parentElement!.classList.add('iexp-flow')
    path.classList.add('react-flow__edge-path'); const {stop} = activate(); await tick(10)
    expect(path.getAttribute(MARK)).toBe('flow-underlay')
    document.dispatchEvent(new Event('scroll')); await tick(10)
    expect(path.getAttribute(MARK)).toBe('flow-underlay')
    stop(); expect(path.hasAttribute(MARK)).toBe(false)
  })

})
