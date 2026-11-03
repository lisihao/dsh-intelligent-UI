// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const frames = vi.hoisted(() => ({ publish: vi.fn(), release: vi.fn() }))
vi.mock('../src/ascii-visual-frames.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/ascii-visual-frames.js')>(), publishAsciiVisualFrame: frames.publish, releaseAsciiVisualFrame: frames.release }))
import { installFlowParticles as install, type FlowParticleOptions, type FlowParticles } from '../src/flow-particles.js'
const controllers: FlowParticles[] = []
function installFlowParticles(options: FlowParticleOptions) { const controller = install(options); controllers.push(controller); return controller }
function glContext() {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, COLOR_BUFFER_BIT: 5, ARRAY_BUFFER: 6, DYNAMIC_DRAW: 7, FLOAT: 8, BLEND: 9, SRC_ALPHA: 10, ONE_MINUS_SRC_ALPHA: 11, POINTS: 12,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true), getShaderInfoLog: vi.fn(), deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), getProgramInfoLog: vi.fn(), deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), deleteBuffer: vi.fn(), viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), getUniformLocation: vi.fn(() => ({})), uniform2f: vi.fn(), uniform1f: vi.fn(), enable: vi.fn(), blendFunc: vi.fn(), drawArrays: vi.fn(), isContextLost: vi.fn(() => false), getExtension: vi.fn(() => null),
  }
  return gl
}
function setup(options: { fallback?: boolean, unavailable?: boolean, width?: number, height?: number } = {}) {
  const viewport = document.createElement('div'); viewport.style.position = 'relative'
  viewport.innerHTML = '<svg><g data-id="relation-0"><path class="react-flow__edge-path" d="M0 40 L200 40" style="stroke:rgb(120,180,230)"></path></g><g data-id="relation-1"><path class="react-flow__edge-path" d="M0 80 L200 80" style="stroke:rgb(210,150,170)"></path></g></svg>'
  document.body.append(viewport)
  const width = options.width ?? 400, height = options.height ?? 200
  Object.defineProperty(viewport, 'clientWidth', { value: width }); Object.defineProperty(viewport, 'clientHeight', { value: height })
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
  const paths = [...viewport.querySelectorAll<SVGPathElement>('path')]
  const measures = paths.map((path, index) => {
    const length = vi.fn(() => 200), point = vi.fn((distance: number) => ({ x: distance, y: 40 + index * 40 }))
    Object.assign(path, { getTotalLength: length, getPointAtLength: point, getScreenCTM: vi.fn(() => matrix) })
    return { length, point }
  })
  const gl = glContext(), context = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => (options.unavailable ? null : kind === 'webgl2' ? options.fallback ? null : gl : context) as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 10, y: 20, left: 10, top: 20, right: 10 + width, bottom: 20 + height, width, height, toJSON() {} }))
  const queue = new Map<number, FrameRequestCallback>(); let request = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queue.set(++request, callback); return request })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { queue.delete(id) })
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  let mediaChange: (() => void) | undefined
  const media = { matches: false, addEventListener: vi.fn((_name: string, callback: () => void) => { mediaChange = callback }), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', () => media)
  let intersectionChange: IntersectionObserverCallback | undefined
  const disconnectIntersection = vi.fn(), disconnectResize = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { intersectionChange = callback } observe() {} disconnect = disconnectIntersection })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnectResize })
  return { viewport, paths, measures, gl, context, matrix, queue, media, disconnectIntersection, disconnectResize,
    canvas: () => viewport.querySelector<HTMLCanvasElement>('canvas')!,
    step(time: number) { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback(time)) },
    visibility(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) },
    reduced(value: boolean) { media.matches = value; mediaChange?.() },
    intersect(value: boolean) { intersectionChange?.([{ target: viewport, isIntersecting: value, intersectionRatio: value ? 1 : 0, boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(), rootBounds: null, time: 0 }], {} as IntersectionObserver) },
  }
}
beforeEach(() => { frames.publish.mockClear(); frames.release.mockClear() })
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })
describe('actual-path particle projection', () => {
  it('uses one GL context and real sampled paths, draws actual frames without lossy ASCII readback and does not inherit the private ASCII opacity mask', () => {
    const env = setup(); env.paths[0]!.style.opacity = '0'; env.paths[0]!.setAttribute('data-iexp-ascii-paint', 'true')
    const controller = installFlowParticles({ viewport: env.viewport, activeEdgeIds: new Set(['relation-0']) })
    const canvas = env.canvas()
    expect(canvas.getAttribute('aria-hidden')).toBe('true'); expect(canvas.style.pointerEvents).toBe('none')
    expect(canvas.dataset.iexpContinuousVisual).toBe('true'); expect(canvas.dataset.renderer).toBe('webgl2')
    env.step(0)
    expect(env.gl.drawArrays).toHaveBeenCalledOnce(); expect(frames.publish).not.toHaveBeenCalled(); expect(canvas.dataset.iexpAsciiOriginal).toBe('true')
    expect(env.measures[0]!.length).toHaveBeenCalledOnce(); expect(env.measures[1]!.length).not.toHaveBeenCalled()
    expect(env.measures[0]!.point.mock.calls.length).toBeLessThanOrEqual(193)
    const first = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    expect(first[2]).toBeCloseTo(120 / 255); expect(first[3]).toBeCloseTo(180 / 255)
    env.step(20); expect(env.gl.drawArrays).toHaveBeenCalledOnce()
    env.step(40); expect(env.gl.drawArrays).toHaveBeenCalledTimes(2)
    const second = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    expect(second[0]).not.toBe(first[0]); expect(canvas.dataset.drawnFrames).toBe('2')
    controller.dispose()
  })
  it('treats an explicit empty active set as no activity and pauses/releases frames without changing the source', () => {
    const env = setup(), original = env.viewport.querySelector('svg')!.outerHTML
    const controller = installFlowParticles({ viewport: env.viewport, activeEdgeIds: new Set() })
    expect(env.queue.size).toBe(0); env.step(0); expect(env.gl.drawArrays).not.toHaveBeenCalled(); expect(frames.publish).not.toHaveBeenCalled()
    controller.setActiveEdges(null); env.step(0); expect(env.gl.drawArrays).toHaveBeenCalledOnce()
    controller.setMotion(false); expect(env.queue.size).toBe(0); expect(env.canvas().hidden).toBe(true); expect(frames.release).toHaveBeenCalledWith(env.canvas())
    controller.setMotion(true); expect(env.canvas().hidden).toBe(false); env.step(40); expect(env.gl.drawArrays).toHaveBeenCalledTimes(2)
    controller.setActiveEdges(new Set()); expect(env.queue.size).toBe(0)
    controller.dispose(); controller.dispose(); controller.setMotion(true)
    expect(env.viewport.querySelector('canvas')).toBeNull(); expect(env.viewport.querySelector('svg')!.outerHTML).toBe(original)
    expect(env.gl.deleteBuffer).toHaveBeenCalledOnce(); expect(env.gl.deleteProgram).toHaveBeenCalledOnce()
    expect(env.disconnectIntersection).toHaveBeenCalledOnce(); expect(env.disconnectResize).toHaveBeenCalledOnce()
    expect(env.media.removeEventListener).toHaveBeenCalledOnce(); expect(env.queue.size).toBe(0)
  })
  it('resamples only changed path geometry and maps current screen transforms without resampling during pan', async () => {
    const env = setup(), controller = installFlowParticles({ viewport: env.viewport, activeEdgeIds: new Set(['relation-0']) })
    env.step(0); const first = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    env.matrix.e += 40; env.step(40); const moved = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    expect(moved[moved.length - 7]! - first[first.length - 7]!).toBeCloseTo(42.88, 2); expect(env.measures[0]!.length).toHaveBeenCalledOnce()
    env.paths[0]!.setAttribute('d', 'M0 40 Q100 60 200 40')
    env.canvas().dispatchEvent(new Event('iexp:visual-frame-request')); expect(env.measures[0]!.length).toHaveBeenCalledTimes(2)
    await Promise.resolve(); env.step(80); expect(env.measures[0]!.length).toHaveBeenCalledTimes(2)
    env.paths[0]!.setAttribute('data-iexp-ascii-paint', 'false'); await Promise.resolve()
    env.step(120); expect(env.measures[0]!.length).toHaveBeenCalledTimes(2)
    env.matrix.e = 10000; const draws = env.gl.drawArrays.mock.calls.length, publications = frames.publish.mock.calls.length
    env.step(160); expect(env.gl.drawArrays).toHaveBeenCalledTimes(draws); expect(frames.publish).toHaveBeenCalledTimes(publications)
    controller.dispose()
  })
  it('maps zoom through the actual screen matrix without resampling unchanged source geometry', () => {
    const env = setup(); env.measures[0]!.length.mockReturnValue(80)
    const controller = installFlowParticles({ viewport: env.viewport, activeEdgeIds: new Set(['relation-0']) })
    env.step(0); const first = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    env.matrix.a = 2; env.matrix.d = 2; env.step(40)
    const zoomed = env.gl.bufferData.mock.calls.at(-1)![1] as Float32Array
    expect(zoomed[zoomed.length - 7]!).toBeCloseTo(first[first.length - 7]! * 2 + 2.88, 2)
    expect(zoomed[zoomed.length - 6]!).toBeCloseTo(80)
    expect(env.measures[0]!.length).toHaveBeenCalledOnce(); controller.dispose()
  })
  it('stops RAF for reduced motion, document hiding and offscreen state, then resumes only when eligible', () => {
    const env = setup(), controller = installFlowParticles({ viewport: env.viewport })
    env.step(0); env.reduced(true); expect(env.queue.size).toBe(0); expect(env.canvas().dataset.particleState).toBe('reduced-motion')
    env.visibility(true); env.reduced(false); expect(env.queue.size).toBe(0)
    env.visibility(false); expect(env.queue.size).toBe(1)
    env.intersect(false); expect(env.queue.size).toBe(0); expect(env.canvas().dataset.particleState).toBe('offscreen')
    env.intersect(true); expect(env.queue.size).toBe(1); env.step(40)
    expect(env.gl.drawArrays).toHaveBeenCalledTimes(2); controller.dispose()
  })
  it('names context loss, stops publishing, recreates its resources on restoration and cleans up', () => {
    const env = setup(), onError = vi.fn(), onRecovery = vi.fn(), controller = installFlowParticles({ viewport: env.viewport, onError, onRecovery })
    env.step(0); env.canvas().dispatchEvent(new Event('webglcontextrestored')); expect(onRecovery).not.toHaveBeenCalled()
    env.gl.isContextLost.mockReturnValue(true)
    const event = new Event('webglcontextlost', { cancelable: true }); env.canvas().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true); expect(env.queue.size).toBe(0); expect(onError.mock.calls.at(-1)![0].name).toBe('FlowParticlesContextLost')
    const publications = frames.publish.mock.calls.length; env.step(40); expect(frames.publish).toHaveBeenCalledTimes(publications)
    env.gl.isContextLost.mockReturnValue(false); env.canvas().dispatchEvent(new Event('webglcontextrestored')); env.step(80)
    expect(env.gl.createProgram).toHaveBeenCalledTimes(2); expect(env.canvas().dataset.renderError).toBeUndefined(); expect(onRecovery).toHaveBeenCalledOnce()
    env.gl.isContextLost.mockReturnValue(true); env.canvas().dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(onError.mock.calls.filter(call => call[0].name === 'FlowParticlesContextLost')).toHaveLength(2)
    controller.setMotion(false); env.gl.isContextLost.mockReturnValue(false); env.canvas().dispatchEvent(new Event('webglcontextrestored'))
    expect(onRecovery).toHaveBeenCalledTimes(2); expect(env.queue.size).toBe(0)
    controller.dispose(); env.canvas()?.dispatchEvent(new Event('webglcontextrestored')); expect(onRecovery).toHaveBeenCalledTimes(2); expect(env.queue.size).toBe(0)
  })
  it('uses an explicitly named Canvas2D fallback and keeps backing pixels within the shared budget', () => {
    const env = setup({ fallback: true, width: 10000, height: 10000 }), onError = vi.fn()
    const controller = installFlowParticles({ viewport: env.viewport, onError }); env.step(0)
    expect(env.canvas().dataset.renderer).toBe('canvas2d'); expect(onError.mock.calls[0]![0].name).toBe('FlowParticlesCanvas2DFallback')
    expect(env.context.fill).toHaveBeenCalled(); expect(env.canvas().width * env.canvas().height).toBeLessThanOrEqual(4_000_000)
    expect(frames.publish).not.toHaveBeenCalled(); expect(env.canvas().dataset.drawnFrames).toBe('1'); controller.dispose()
  })
  it('names a real draw initialization failure, stops the loop and publishes no fictitious frame', () => {
    const env = setup(); env.gl.getShaderParameter.mockReturnValue(false); env.gl.getShaderInfoLog.mockReturnValue('actual shader diagnostic')
    const onError = vi.fn(), controller = installFlowParticles({ viewport: env.viewport, onError }); env.step(0)
    expect(onError.mock.calls.at(-1)![0].name).toBe('FlowParticlesDrawError')
    expect(onError.mock.calls.at(-1)![0].message).toContain('actual shader diagnostic')
    expect(env.queue.size).toBe(0); expect(frames.publish).not.toHaveBeenCalled(); expect(env.gl.deleteShader).toHaveBeenCalled()
    controller.dispose()
  })
  it('does not publish fake frames when no renderer is available', () => {
    const env = setup({ unavailable: true }), onError = vi.fn(), controller = installFlowParticles({ viewport: env.viewport, onError })
    expect(env.canvas().dataset.renderer).toBe('unavailable'); expect(env.queue.size).toBe(0)
    expect(onError.mock.calls[0]![0].name).toBe('FlowParticlesRendererUnavailable'); expect(frames.publish).not.toHaveBeenCalled()
    controller.dispose()
  })
})
