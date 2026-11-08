// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import type { AsciiGpuEffect, AsciiGpuEffectOptions } from '../src/ascii-gpu-effect.js'
import type { AsciiVisualCapture } from '../src/ascii-visual-capture.js'

const mocks = vi.hoisted(() => ({ createEffect: vi.fn(), capture: vi.fn(), release: vi.fn() }))
vi.mock('../src/ascii-gpu-effect.js', () => ({ createAsciiGpuEffect: mocks.createEffect }))
vi.mock('../src/ascii-visual-capture.js', () => ({ captureAsciiVisual: mocks.capture, measureAsciiVisualBounds: (source: Element) => source.getBoundingClientRect() }))
vi.mock('../src/canvas-runtime-client.js', () => ({ acquireCanvasSlot: (start: () => void) => { start(); return mocks.release } }))

import { asciiFailureCode, installAsciiVisualTheme } from '../src/ascii-visual-theme.js'

const rect = (left = 10, top = 10, width = 200, height = 100) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
}) as DOMRect

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function capture(): AsciiVisualCapture {
  const bitmap = document.createElement('canvas')
  bitmap.width = 200; bitmap.height = 100
  return { bitmap, width: 200, height: 100, textRects: [{ x: 20, y: 20, width: 40, height: 12 }], dispose: vi.fn() }
}

type Gpu = { options: AsciiGpuEffectOptions, effect: AsciiGpuEffect, update: ReturnType<typeof vi.fn> }
let gpu: Gpu[]
let autoPaint: boolean
let cleanup: (() => void)[]

function store(initial: ExperienceSettings) {
  let settings = initial
  const listeners = new Set<() => void>()
  return {
    snapshot: () => ({ settings }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: ExperienceSettings) => { settings = next; listeners.forEach(listener => listener()) },
  }
}

const asciiSettings = (): ExperienceSettings => ({ ...initialSettings(), takeover: true, theme: { activeId: 'ascii-gpu', installed: [] } })
function source() {
  const host = document.createElement('div')
  host.className = 'dsh-experience'
  host.innerHTML = '<svg viewBox="0 0 200 100"><defs><marker id="tip"><path d="M0 0L1 1"/></marker></defs><path data-source="series" d="M0 75L100 20" data-iexp-ascii-paint="existing"/><text x="20" y="20">Revenue 42 USD</text></svg>'
  document.body.append(host)
  const svg = host.querySelector('svg')!
  svg.getBoundingClientRect = () => rect()
  return { host, svg, line: svg.querySelector('[data-source]')!, text: svg.querySelector('text')!, marker: svg.querySelector('marker path')! }
}

function imageSource() {
  const host = document.createElement('div')
  host.className = 'dsh-experience'
  host.innerHTML = '<img alt="Original figure" tabindex="0">'
  document.body.append(host)
  const image = host.querySelector('img')!
  image.getBoundingClientRect = () => rect()
  return image
}

beforeEach(() => {
  cleanup = []; gpu = []; autoPaint = true
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

describe('ASCII visual theme lifecycle', () => {
  it('activates only for takeover and ASCII and restores pre-existing attributes on disable', async () => {
    const { svg, line, text, marker } = source()
    const before = svg.outerHTML
    const settings = asciiSettings(), modelBefore = JSON.stringify(settings), state = store({ ...settings, takeover: false })
    const stop = installAsciiVisualTheme(state); cleanup.push(stop)
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
    state.set(settings)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    expect(text.textContent).toBe('Revenue 42 USD')
    expect(text.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    expect(marker.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    expect(document.querySelector('[data-iexp-ascii-overlay]')?.getAttribute('aria-hidden')).toBe('true')
    state.set({ ...settings, theme: { activeId: 'empryo', installed: [] } })
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(svg.outerHTML).toBe(before)
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
    expect(JSON.stringify(settings)).toBe(modelBefore)
    expect(gpu[0]!.effect.dispose).toHaveBeenCalledOnce()
  })

  it('leaves an explicitly labeled original image unprojected and responds when that designation changes', async () => {
    const image = imageSource(), { line } = source()
    image.parentElement!.setAttribute('data-iexp-ascii-original', 'true')
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    expect(mocks.capture.mock.calls.some(args => args[0] === image)).toBe(false)
    expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    image.parentElement!.removeAttribute('data-iexp-ascii-original')
    await vi.waitFor(() => expect(image.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    image.parentElement!.setAttribute('data-iexp-ascii-original', 'true')
    await vi.waitFor(() => expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false))
  })

  it('retries a capture invalidated by layout without permanently disabling that source', async () => {
    const { line } = source()
    const error = Object.assign(new Error('layout changed'), { name: 'AsciiVisualCaptureError', code: 'changed' })
    mocks.capture.mockRejectedValueOnce(error).mockResolvedValue(capture())
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    expect(mocks.capture).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-iexp-ascii-status]')?.textContent).toBe('')
  })

  it('moves a cached capture with its source after scrolling instead of reusing absolute capture coordinates', async () => {
    const { svg, line } = source()
    let box = rect()
    svg.getBoundingClientRect = () => box
    mocks.capture.mockResolvedValue({ ...capture(), bounds: { left: 10, top: 10, width: 200, height: 100 } })
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    box = rect(60, 70)
    document.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    const contexts = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results.map(result => result.value as unknown as {drawImage: ReturnType<typeof vi.fn>})
    expect(contexts.some(context => context.drawImage.mock.calls.some(args => JSON.stringify(args.slice(1)) === JSON.stringify([60, 70, 200, 100])))).toBe(true)
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('immediately restores the source after a mutation and discards an older in-flight capture', async () => {
    const { svg, line, text } = source()
    const old = deferred<AsciiVisualCapture>(), newer = deferred<AsciiVisualCapture>()
    mocks.capture.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise)
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1))
    line.setAttribute('d', 'M0 75L100 35')
    await Promise.resolve() // Deliver the MutationObserver before the older capture resolves.
    const stale = capture(); old.resolve(stale)
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2))
    expect(stale.dispose).toHaveBeenCalledOnce()
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(text.textContent).toBe('Revenue 42 USD')
    expect(svg.querySelector('path[data-source]')?.getAttribute('d')).toBe('M0 75L100 35')
    newer.resolve(capture())
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
  })

  it('restores a committed original before recapturing a changed source', async () => {
    const { line } = source(), newer = deferred<AsciiVisualCapture>()
    mocks.capture.mockResolvedValueOnce(capture()).mockReturnValueOnce(newer.promise)
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    line.setAttribute('d', 'M2 2L3 3')
    await Promise.resolve()
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2))
    newer.resolve(capture())
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
  })

  it('restores a committed source synchronously on scroll or viewport resize', async () => {
    const { line } = source()
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    document.dispatchEvent(new Event('scroll'))
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
    await vi.waitFor(() => expect(line.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    window.dispatchEvent(new Event('resize'))
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
  })

  it('does not commit a frame captured before a viewport change', async () => {
    const { line } = source()
    autoPaint = false
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(gpu[0]?.update).toHaveBeenCalled())
    const staleRevision = gpu[0]!.update.mock.calls[0]![1] as number
    document.dispatchEvent(new Event('scroll'))
    gpu[0]!.options.onFrame(staleRevision)
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
  })

  it('disposes a late capture after the theme is turned off', async () => {
    const { svg, line } = source(), before = svg.outerHTML
    const late = deferred<AsciiVisualCapture>()
    mocks.capture.mockReturnValueOnce(late.promise)
    const settings = asciiSettings(), state = store(settings)
    const stop = installAsciiVisualTheme(state); cleanup.push(stop)
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
    state.set({ ...settings, takeover: false })
    const stale = capture(); late.resolve(stale)
    await vi.waitFor(() => expect(stale.dispose).toHaveBeenCalledOnce())
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(svg.outerHTML).toBe(before)
    expect(document.querySelector('[data-iexp-ascii-overlay]')).toBeNull()
  })

  it('keeps the original image revealed while the pointer remains over it', async () => {
    const image = imageSource()
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(image.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    image.dispatchEvent(new Event('pointerover', { bubbles: true }))
    expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    expect(image.alt).toBe('Original figure')
    image.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
    await vi.waitFor(() => expect(image.getAttribute('data-iexp-ascii-paint')).toBe('true'))
  })

  it('keeps a focused original image visible after the pointer leaves it', async () => {
    const image = imageSource()
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(image.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    image.focus()
    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    image.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(image)
    expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false)
  })

  it('keeps a hovered original image visible after focus leaves it', async () => {
    const image = imageSource()
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(image.getAttribute('data-iexp-ascii-paint')).toBe('true'))
    image.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    image.focus()
    image.blur()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(image.hasAttribute('data-iexp-ascii-paint')).toBe(false)
  })

  it('does not hide the original when the graphics loader fails', async () => {
    const { svg, line } = source(), before = svg.outerHTML
    mocks.createEffect.mockRejectedValueOnce(new Error('ASCII_GLYPH_CONTEXT: WebGL 2 is unavailable.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(document.querySelector('[data-iexp-ascii-status]')?.textContent).toContain('已保留原图'))
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(svg.outerHTML).toBe(before)
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
    expect(document.querySelector('[data-iexp-ascii-status]')?.textContent).toContain('（代码：ASCII_GLYPH_CONTEXT）')
  })

  it('names the failure with a message code or the error name, and nothing else', () => {
    expect(asciiFailureCode(new Error('ASCII_GLYPH_OPERATION: Frame draw failed (1282).'))).toBe('ASCII_GLYPH_OPERATION')
    expect(asciiFailureCode(new DOMException('The canvas has been tainted.', 'SecurityError'))).toBe('SecurityError')
    expect(asciiFailureCode(new Error('plain message'))).toBe('Error')
    expect(asciiFailureCode({ secret: 'value' })).toBeUndefined()
  })

  it('cancels outstanding captures when a graphics failure releases its resources', async () => {
    const { line } = source(), late = deferred<AsciiVisualCapture>()
    mocks.capture.mockReturnValueOnce(late.promise)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce())
    const captureSignal = mocks.capture.mock.calls[0]![1] as AbortSignal
    gpu[0]!.options.onError(new Error('WebGL context lost'))
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(gpu[0]!.effect.dispose).toHaveBeenCalledOnce()
    expect(captureSignal.aborted).toBe(true)
    const stale = capture(); late.resolve(stale)
    await vi.waitFor(() => expect(stale.dispose).toHaveBeenCalledOnce())
    expect(gpu[0]!.update).not.toHaveBeenCalled()
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
  })

  it('keeps original content visible when its individual capture fails', async () => {
    const { svg, line } = source(), before = svg.outerHTML
    mocks.capture.mockRejectedValueOnce(new Error('unsupported SVG'))
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(document.querySelector('[data-iexp-ascii-status]')?.textContent).toContain('已保留原图'))
    expect(line.getAttribute('data-iexp-ascii-paint')).toBe('existing')
    expect(svg.outerHTML).toBe(before)
    expect((document.querySelector('[data-iexp-ascii-overlay]') as HTMLElement).style.visibility).toBe('hidden')
  })

  it('does not repeatedly request failed canvas frames; a size change permits one fresh request', async () => {
    const host = document.createElement('div')
    host.className = 'dsh-experience'
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () => rect()
    host.append(canvas); document.body.append(host)
    let requests = 0
    canvas.addEventListener('iexp:visual-frame-request', () => {
      requests++
      canvas.dispatchEvent(new CustomEvent('iexp:visual-frame-error', { bubbles: true, detail: { revision: requests, code: 'FRAME_BUDGET_EXCEEDED' } }))
    })
    const stop = installAsciiVisualTheme(store(asciiSettings())); cleanup.push(stop)
    await vi.waitFor(() => expect(requests).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(requests).toBe(1)
    expect(canvas.hasAttribute('data-iexp-ascii-paint')).toBe(false)
    expect(document.querySelector('[data-iexp-ascii-status]')?.textContent).toContain('已保留原图')
    canvas.width++
    await vi.waitFor(() => expect(requests).toBe(2))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(requests).toBe(2)
  })
})
