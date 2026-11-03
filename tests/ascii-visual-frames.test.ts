// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASCII_DOCUMENT_FRAME_LIMIT, publishAsciiVisualFrame, readAsciiVisualFrame, releaseAsciiVisualFrame, subscribeAsciiVisualFrames } from '../src/ascii-visual-frames.js'
import { createGraphOverviewRenderer } from '../src/graph-overview-renderer.js'
import type { FlowGeometry, FlowViewPlan } from '../src/flow-layout.js'

const subscriptions: Array<() => void> = []
afterEach(() => { for (const dispose of subscriptions.splice(0)) dispose(); vi.restoreAllMocks(); document.body.replaceChildren() })
function subscribe(doc = document) { const dispose = subscribeAsciiVisualFrames(doc); subscriptions.push(dispose); return dispose }
function canvas(width = 100, height = 50) {
  const value = document.createElement('canvas'); value.width = width; value.height = height; document.body.append(value); return value
}
function snapshots() {
  let mode: 'normal' | 'missing' | 'tainted' | 'failure' = 'normal'
  const operations: string[] = []
  const context = { clearRect: vi.fn(), drawImage: vi.fn(() => { operations.push('copy'); if (mode === 'failure') throw new Error('copy failed') }),
    getImageData: vi.fn(() => { if (mode === 'tainted') throw new DOMException('tainted', 'SecurityError'); return { data: new Uint8ClampedArray(4) } }) }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return mode === 'missing' ? null : context as unknown as CanvasRenderingContext2D })
  return { context, operations, mode(value: typeof mode) { mode = value } }
}
const plan: FlowViewPlan = { nodes: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], edges: [{ source: 'one', target: 'two' }] }
const geometry: FlowGeometry = { kind: 'overview', nodes: [{ id: 'one', x: 0, y: 0, width: 30, height: 20 }, { id: 'two', x: 80, y: 40, width: 30, height: 20 }], routes: [] }

describe('ASCII owned visual frames', () => {
  it('does no snapshot work without a subscriber', () => {
    const source = canvas(), snapshot = snapshots(), event = vi.fn()
    source.addEventListener('iexp:visual-frame', event)
    publishAsciiVisualFrame(source)
    expect(snapshot.context.drawImage).not.toHaveBeenCalled()
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(event).not.toHaveBeenCalled()
  })

  it('copies synchronously, bubbles only a revision, and releases on the last subscriber', () => {
    const source = canvas(), snapshot = snapshots(), first = subscribe(), second = subscribe(), events: unknown[] = []
    const record = (event: Event) => events.push((event as CustomEvent).detail)
    document.addEventListener('iexp:visual-frame', record)
    publishAsciiVisualFrame(source)
    const initial = readAsciiVisualFrame(source)!
    expect(initial).toMatchObject({ revision: 1, width: 100, height: 50 })
    expect(initial.bitmap).not.toBe(source)
    expect(snapshot.context.drawImage).toHaveBeenCalledWith(source, 0, 0)
    expect(snapshot.context.getImageData).toHaveBeenCalledWith(0, 0, 1, 1)
    expect(events).toEqual([{ revision: 1 }])
    first(); first()
    publishAsciiVisualFrame(source)
    expect(readAsciiVisualFrame(source)).toMatchObject({ revision: 2, bitmap: initial.bitmap })
    expect(events).toEqual([{ revision: 1 }, { revision: 2 }])
    second(); second()
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(initial.bitmap.width).toBe(0)
    expect(initial.bitmap.height).toBe(0)
    publishAsciiVisualFrame(source)
    expect(snapshot.context.drawImage).toHaveBeenCalledTimes(2)
    document.removeEventListener('iexp:visual-frame', record)
  })

  it('invalidates stale snapshots and reports empty, oversized, tainted and failed captures', () => {
    const source = canvas(), snapshot = snapshots(), failures: unknown[] = []
    source.addEventListener('iexp:visual-frame-error', event => failures.push((event as CustomEvent).detail))
    subscribe()
    publishAsciiVisualFrame(source)
    const previous = readAsciiVisualFrame(source)!.bitmap
    source.width = 2001; source.height = 2000
    publishAsciiVisualFrame(source)
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(previous.width).toBe(0)
    expect(failures.at(-1)).toEqual({ revision: 2, code: 'FRAME_TOO_LARGE' })
    source.width = 0; source.height = 50
    publishAsciiVisualFrame(source)
    expect(failures.at(-1)).toEqual({ revision: 3, code: 'EMPTY_SOURCE' })
    source.width = 100
    snapshot.mode('tainted'); publishAsciiVisualFrame(source)
    expect(failures.at(-1)).toEqual({ revision: 4, code: 'SNAPSHOT_TAINTED' })
    snapshot.mode('missing'); publishAsciiVisualFrame(source)
    expect(failures.at(-1)).toEqual({ revision: 5, code: 'SNAPSHOT_UNAVAILABLE' })
    snapshot.mode('failure'); publishAsciiVisualFrame(source)
    expect(failures.at(-1)).toEqual({ revision: 6, code: 'SNAPSHOT_FAILED' })
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    snapshot.mode('normal'); publishAsciiVisualFrame(source)
    expect(readAsciiVisualFrame(source)?.revision).toBe(7)
    expect(source.width).toBe(100); expect(source.height).toBe(50)
  })

  it('enforces both the per-document memory and count budgets', () => {
    snapshots(); subscribe()
    const large = Array.from({ length: 5 }, () => canvas(2000, 2000))
    const failures: unknown[] = []
    large[4]!.addEventListener('iexp:visual-frame-error', event => failures.push((event as CustomEvent).detail))
    large.forEach(publishAsciiVisualFrame)
    expect(large.slice(0, 4).every(value => !!readAsciiVisualFrame(value))).toBe(true)
    expect(readAsciiVisualFrame(large[4]!)).toBeUndefined()
    expect(failures).toEqual([{ revision: 1, code: 'FRAME_BUDGET_EXCEEDED' }])
    large.slice(0, 4).forEach(releaseAsciiVisualFrame)
    const small = Array.from({ length: ASCII_DOCUMENT_FRAME_LIMIT + 1 }, () => canvas(1, 1))
    const countFailures: unknown[] = []
    small.at(-1)!.addEventListener('iexp:visual-frame-error', event => countFailures.push((event as CustomEvent).detail))
    small.forEach(publishAsciiVisualFrame)
    expect(readAsciiVisualFrame(small.at(-1)!)).toBeUndefined()
    expect(countFailures).toEqual([{ revision: 1, code: 'FRAME_BUDGET_EXCEEDED' }])
  })

  it('drops an existing bitmap if a later same-sized source becomes tainted', () => {
    const source = canvas(), snapshot = snapshots(), errors: unknown[] = []
    source.addEventListener('iexp:visual-frame-error', event => errors.push((event as CustomEvent).detail))
    subscribe(); publishAsciiVisualFrame(source)
    const previous = readAsciiVisualFrame(source)!.bitmap
    snapshot.mode('tainted'); publishAsciiVisualFrame(source)
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(previous.width).toBe(0)
    expect(errors).toEqual([{ revision: 2, code: 'SNAPSHOT_TAINTED' }])
  })

  it('keeps subscriptions and invalidation isolated by owner document', () => {
    const original = canvas(), other = document.implementation.createHTMLDocument('other')
    const foreign = other.createElement('canvas'); foreign.width = 20; foreign.height = 20; other.body.append(foreign)
    snapshots(); subscribe()
    publishAsciiVisualFrame(original); publishAsciiVisualFrame(foreign)
    const old = readAsciiVisualFrame(original)!.bitmap
    expect(readAsciiVisualFrame(foreign)).toBeUndefined()
    subscribe(other); publishAsciiVisualFrame(foreign)
    expect(readAsciiVisualFrame(foreign)?.width).toBe(20)
    other.adoptNode(original)
    expect(readAsciiVisualFrame(original)).toBeUndefined()
    expect(old.width).toBe(0)
  })

  it('invalidates and notifies when a source is released or changes dimensions', () => {
    const source = canvas(), failures: unknown[] = []
    snapshots(); subscribe()
    source.addEventListener('iexp:visual-frame-error', event => failures.push((event as CustomEvent).detail))
    publishAsciiVisualFrame(source)
    source.width = 101
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(failures.at(-1)).toEqual({ revision: 2, code: 'SOURCE_RELEASED' })
    publishAsciiVisualFrame(source)
    releaseAsciiVisualFrame(source); releaseAsciiVisualFrame(source)
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(failures.at(-1)).toEqual({ revision: 4, code: 'SOURCE_RELEASED' })
    expect(failures).toHaveLength(2)
  })

  it('captures the WebGL buffer in the draw task, supports a late request and clears on loss/dispose', () => {
    const source = canvas(), snapshot = snapshots(), order = snapshot.operations
    const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, FLOAT: 6, BLEND: 7, SRC_ALPHA: 8, ONE_MINUS_SRC_ALPHA: 9, DYNAMIC_DRAW: 10, LINES: 11, TRIANGLES: 12, LINE_LOOP: 13, COLOR_BUFFER_BIT: 14,
      createShader: () => ({}), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: () => true, deleteShader: vi.fn(),
      createProgram: () => ({}), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: () => true, createBuffer: () => ({}),
      isContextLost: vi.fn(() => false), viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), useProgram: vi.fn(), bindBuffer: vi.fn(),
      getAttribLocation: () => 0, enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), getUniformLocation: () => ({}), uniform2f: vi.fn(),
      enable: vi.fn(), blendFunc: vi.fn(), bufferData: vi.fn(), uniform4f: vi.fn(), drawArrays: vi.fn(() => order.push('draw')),
      deleteBuffer: vi.fn(), deleteProgram: vi.fn(), getExtension: () => null }
    const getContext = vi.fn((kind: string) => kind === 'webgl2' ? gl : null)
    Object.defineProperty(source, 'getContext', { configurable: true, value: getContext })
    const renderer = createGraphOverviewRenderer(source)
    expect(getContext).toHaveBeenCalledWith('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false })
    renderer.draw(geometry, plan, 'one')
    expect(order).toEqual(['draw', 'draw', 'draw'])
    subscribe()
    source.addEventListener('iexp:visual-frame', () => order.push('event'))
    source.dispatchEvent(new Event('iexp:visual-frame-request'))
    expect(order.slice(-5)).toEqual(['draw', 'draw', 'draw', 'copy', 'event'])
    expect(readAsciiVisualFrame(source)?.revision).toBe(1)
    gl.isContextLost.mockReturnValueOnce(true)
    renderer.draw(geometry, plan, 'one')
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    renderer.draw(geometry, plan, 'one')
    expect(readAsciiVisualFrame(source)?.revision).toBe(3)
    const lost = new Event('webglcontextlost', { cancelable: true })
    source.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    source.dispatchEvent(new Event('webglcontextrestored'))
    expect(readAsciiVisualFrame(source)?.revision).toBe(5)
    const failedBitmap = readAsciiVisualFrame(source)!.bitmap
    gl.drawArrays.mockImplementationOnce(() => { throw new Error('GPU draw failed') })
    expect(() => renderer.draw(geometry, plan, 'one')).toThrow('GPU draw failed')
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(failedBitmap.width).toBe(0)
    renderer.draw(geometry, plan, 'one')
    const lastBitmap = readAsciiVisualFrame(source)!.bitmap
    renderer.dispose(); renderer.dispose()
    expect(readAsciiVisualFrame(source)).toBeUndefined()
    expect(lastBitmap.width).toBe(0)
    const drawCount = gl.drawArrays.mock.calls.length
    source.dispatchEvent(new Event('iexp:visual-frame-request'))
    expect(gl.drawArrays).toHaveBeenCalledTimes(drawCount)
  })

  it('copies after the Canvas2D drawing completes and leaves the original renderer usable', () => {
    const source = canvas(), snapshot = snapshots(), order = snapshot.operations
    const context = { setTransform: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(() => order.push('fill')), strokeRect: vi.fn() }
    Object.defineProperty(source, 'getContext', { configurable: true, value: (kind: string) => kind === '2d' ? context : null })
    const renderer = createGraphOverviewRenderer(source)
    subscribe()
    renderer.draw(geometry, plan)
    expect(order).toEqual(['fill', 'fill', 'copy'])
    expect(readAsciiVisualFrame(source)).toMatchObject({ width: source.width, height: source.height })
    renderer.dispose()
    expect(readAsciiVisualFrame(source)).toBeUndefined()
  })
})
