// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAsciiGpuEffect } from '../src/ascii-gpu-effect.js'
import type { CanvasEffectFactory } from '../src/canvas-runtime-client.js'

type PaintCanvas = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type PaintContext = { drawImage: ReturnType<typeof vi.fn>, drawElementImage?: (node: Element, x: number, y: number) => void, reset: ReturnType<typeof vi.fn>, getImageData: ReturnType<typeof vi.fn> }

function fixture() {
  const stage = document.createElement('div'); stage.style.pointerEvents = 'none'; document.body.append(stage)
  const bitmap = document.createElement('canvas'); bitmap.width = 320; bitmap.height = 160
  const onFrame = vi.fn(), onError = vi.fn(), destroy = vi.fn(), resize = vi.fn(), loseContext = vi.fn()
  let source: PaintCanvas, output: HTMLCanvasElement, content: HTMLElement, dirty = false
  const gl = {
    NO_ERROR: 0, TRIANGLE_STRIP: 5, getError: vi.fn(() => 0), isContextLost: vi.fn(() => false),
    texImage2D: vi.fn(), drawArrays: vi.fn(), getExtension: vi.fn(() => ({ loseContext })),
  }
  const contexts = new WeakMap<HTMLCanvasElement, PaintContext>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') return gl as unknown as WebGL2RenderingContext
    if (!contexts.has(this)) {
      let fill = '#000000'
      const css = document.createElement('div').style
      const context = {
        drawImage: vi.fn(), reset: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
        get fillStyle() { return fill },
        set fillStyle(value: string) { css.backgroundColor = ''; css.backgroundColor = value; if (css.backgroundColor) fill = css.backgroundColor },
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([10, 20, 30, /rgba\([^)]*,\s*0(?:\.\d+)?\s*\)/.test(fill) ? 128 : 255]) })),
      }
      contexts.set(this, context)
    }
    return contexts.get(this) as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
  const factory: CanvasEffectFactory = vi.fn((elements, _options) => {
    source = elements.source as PaintCanvas; output = elements.output as HTMLCanvasElement; content = elements.content as HTMLElement
    source.width = 320; source.height = 160
    source.onpaint = () => { const ctx = contexts.get(source)!; ctx.reset(); ctx.drawElementImage?.(content, 0, 0); dirty = true }
    source.requestPaint?.()
    return { destroy: () => { destroy(); source.onpaint = null }, resize: () => { resize(); source.width = Number.parseInt(source.style.width); source.height = Number.parseInt(source.style.height); source.requestPaint?.() } }
  })
  const loadFactory = vi.fn(async () => factory)
  const create = () => createAsciiGpuEffect({ stage, width: 320, height: 160, background: 'rgb(16, 20, 24)', loadFactory, onFrame, onError })
  const draw = () => {
    if (dirty) {
      dirty = false
      try { gl.texImage2D(3553, 0, 6408, 6408, 5121, source) } catch { /* Matches the pinned factory's caught upload failure. */ }
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  return { stage, bitmap, onFrame, onError, destroy, resize, loseContext, gl, factory, loadFactory, create, draw, contexts, get source() { return source }, get output() { return output }, get content() { return content } }
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('Asciify GPU atlas bridge', () => {
  it('exposes a frame only after the latest private atlas is uploaded and the actual draw call completes', async () => {
    const f = fixture(), originalDraw = f.gl.drawArrays, originalUpload = f.gl.texImage2D
    const effect = await f.create()
    expect(f.loadFactory).toHaveBeenCalledWith('asciify')
    expect(vi.mocked(f.factory).mock.calls[0]![1]).toMatchObject({ charset: 'ascii', baseStrength: 1, strength: 1, background: 'auto', backgroundOpacity: 0, glow: 0, aberration: 0 })
    expect(f.content.textContent).toBe('')
    expect(f.content.parentElement).toBe(f.stage)
    expect(f.content.style.backgroundColor).toBe('rgb(16, 20, 24)')
    expect(effect.output.getAttribute('data-ascii-factory')).toBe('asciify')
    expect(effect.output.style.pointerEvents).toBe('none')
    f.draw(); await Promise.resolve()
    expect(f.onFrame).not.toHaveBeenCalled()
    expect(effect.output.style.opacity).toBe('0')

    effect.update(f.bitmap, 1)
    expect(effect.output.style.opacity).toBe('0')
    expect(f.contexts.get(f.source)!.drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0, 320, 160)
    f.draw(); await Promise.resolve()
    expect(originalUpload).toHaveBeenCalledWith(3553, 0, 6408, 6408, 5121, f.source)
    expect(originalDraw).toHaveBeenCalledWith(5, 0, 4)
    expect(f.onFrame).toHaveBeenCalledTimes(1)
    expect(f.onFrame).toHaveBeenLastCalledWith(1)
    expect(effect.output.style.opacity).toBe('1')
    f.draw(); await Promise.resolve(); expect(f.onFrame).toHaveBeenCalledTimes(1)

    effect.resize(640, 320)
    expect(f.resize).toHaveBeenCalledOnce()
    expect(effect.output.style.opacity).toBe('0')
    f.draw(); await Promise.resolve(); expect(f.onFrame).toHaveBeenCalledTimes(1)
    const next = document.createElement('canvas'); next.width = 640; next.height = 320
    effect.update(next, 2); f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledTimes(2)
    expect(f.onFrame).toHaveBeenLastCalledWith(2)
    expect(effect.output.style.opacity).toBe('1')
    effect.dispose(); effect.dispose()
    expect(f.destroy).toHaveBeenCalledTimes(1)
    expect(f.loseContext).toHaveBeenCalledTimes(1)
    expect(f.gl.drawArrays).toBe(originalDraw)
    expect(f.gl.texImage2D).toBe(originalUpload)
    expect(f.stage.childElementCount).toBe(0)
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('coalesces superseded revisions and never acknowledges a draw without the matching upload', async () => {
    const f = fixture(), effect = await f.create()
    effect.update(f.bitmap, 1)
    f.gl.drawArrays(f.gl.TRIANGLE_STRIP, 0, 4); await Promise.resolve()
    expect(f.onFrame).not.toHaveBeenCalled()
    effect.update(f.bitmap, 2)
    f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledTimes(1)
    expect(f.onFrame).toHaveBeenLastCalledWith(2)
    expect(() => effect.update(f.bitmap, 2)).toThrow('ASCII_GPU_REVISION')
    expect(() => effect.update(f.bitmap, 1)).toThrow('ASCII_GPU_REVISION')
    effect.dispose()
  })

  it('discards an acknowledgement if a newer update arrives before the callback microtask', async () => {
    const f = fixture(), effect = await f.create()
    effect.update(f.bitmap, 1); f.draw()
    effect.update(f.bitmap, 2); await Promise.resolve()
    expect(f.onFrame).not.toHaveBeenCalled()
    expect(effect.output.style.opacity).toBe('0')
    f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledOnce()
    effect.dispose()
  })

  it('does not reveal an old frame when the frame callback synchronously schedules a newer revision', async () => {
    const f = fixture(), effect = await f.create()
    f.onFrame.mockImplementationOnce(() => effect.update(f.bitmap, 2))
    effect.update(f.bitmap, 1); f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledWith(1)
    expect(effect.output.style.opacity).toBe('0')
    f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenLastCalledWith(2)
    expect(effect.output.style.opacity).toBe('1')
    effect.dispose()
  })

  it('reports an upload failure and never exposes a previous frame as the new revision', async () => {
    const f = fixture(), originalDraw = f.gl.drawArrays, originalUpload = f.gl.texImage2D, effect = await f.create()
    effect.update(f.bitmap, 1); f.draw(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledOnce()
    effect.update(f.bitmap, 2)
    originalUpload.mockImplementationOnce(() => { throw new Error('texture upload failed') })
    f.draw(); await Promise.resolve(); await Promise.resolve()
    expect(f.onFrame).toHaveBeenCalledOnce()
    expect(f.onError).toHaveBeenCalledOnce()
    expect(f.destroy).toHaveBeenCalledOnce()
    expect(f.stage.childElementCount).toBe(0)
    expect(f.gl.drawArrays).toBe(originalDraw); expect(f.gl.texImage2D).toBe(originalUpload)
  })

  it('rejects GL errors, context loss and invalid new bitmaps without leaving a stale effect', async () => {
    const f = fixture(), effect = await f.create()
    effect.update(f.bitmap, 1); f.gl.getError.mockReturnValueOnce(1282); f.draw(); await Promise.resolve(); await Promise.resolve()
    expect(f.onFrame).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledOnce(); expect(f.stage.childElementCount).toBe(0)
    const g = fixture(), lost = await g.create()
    g.output.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    await Promise.resolve(); await Promise.resolve()
    expect(g.onError.mock.calls[0]![0].message).toContain('ASCII_GPU_CONTEXT_LOST')
    expect(g.destroy).toHaveBeenCalledOnce(); expect(() => lost.update(g.bitmap, 1)).toThrow('ASCII_GPU_DISPOSED')
    const h = fixture(), bad = await h.create(), mismatched = document.createElement('canvas')
    mismatched.width = 2; mismatched.height = 2
    expect(() => bad.update(mismatched, 1)).toThrow('ASCII_GPU_BITMAP')
    await Promise.resolve(); await Promise.resolve()
    expect(h.onError).toHaveBeenCalledOnce(); expect(h.stage.childElementCount).toBe(0)
  })

  it('does not instantiate after cancellation while the pinned factory is loading', async () => {
    const f = fixture(), controller = new AbortController()
    let finish!: (factory: CanvasEffectFactory) => void
    const pendingFactory = new Promise<CanvasEffectFactory>(resolve => { finish = resolve })
    const pending = createAsciiGpuEffect({ stage: f.stage, width: 320, height: 160, background: '#14181c', loadFactory: () => pendingFactory, signal: controller.signal, onFrame: f.onFrame, onError: f.onError })
    controller.abort()
    await expect(pending).rejects.toThrow('ASCII_GPU_CANCELLED')
    finish(f.factory); await Promise.resolve()
    expect(f.factory).not.toHaveBeenCalled(); expect(f.stage.childElementCount).toBe(0)
  })

  it('does not instantiate after the private stage disappears while loading', async () => {
    const f = fixture()
    let finish!: (factory: CanvasEffectFactory) => void
    const pendingFactory = new Promise<CanvasEffectFactory>(resolve => { finish = resolve })
    const pending = createAsciiGpuEffect({ stage: f.stage, width: 320, height: 160, background: '#14181c', loadFactory: () => pendingFactory, onFrame: f.onFrame, onError: f.onError })
    await Promise.resolve(); f.stage.remove(); finish(f.factory)
    await expect(pending).rejects.toThrow('ASCII_GPU_DETACHED')
    expect(f.factory).not.toHaveBeenCalled(); expect(f.stage.childElementCount).toBe(0)
  })

  it('rejects unsupported size, color and factory initialization without leaving private elements', async () => {
    const f = fixture()
    await expect(createAsciiGpuEffect({ stage: f.stage, width: 4097, height: 1, background: '#14181c', loadFactory: f.loadFactory, onFrame: f.onFrame, onError: f.onError })).rejects.toThrow('ASCII_GPU_SIZE')
    expect(f.loadFactory).not.toHaveBeenCalled()
    await expect(createAsciiGpuEffect({ stage: f.stage, width: 320, height: 160, background: 'invalid-color', loadFactory: f.loadFactory, onFrame: f.onFrame, onError: f.onError })).rejects.toThrow('ASCII_GPU_BACKGROUND')
    await expect(createAsciiGpuEffect({ stage: f.stage, width: 320, height: 160, background: 'rgba(0, 0, 0, 0.5)', loadFactory: f.loadFactory, onFrame: f.onFrame, onError: f.onError })).rejects.toThrow('ASCII_GPU_BACKGROUND')
    await expect(createAsciiGpuEffect({ stage: f.stage, width: 320, height: 160, background: '#14181c', loadFactory: async () => () => null, onFrame: f.onFrame, onError: f.onError })).rejects.toThrow('ASCII_GPU_FACTORY')
    expect(f.stage.childElementCount).toBe(0)
  })
})
