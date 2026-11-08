// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASCII_GLYPH_CELL, ASCII_GLYPH_RAMP, createAsciiGpuEffect } from '../src/ascii-gpu-effect.js'

type Context2D = { font: string, fillText: ReturnType<typeof vi.fn>, owner: HTMLCanvasElement }

function fixture(options: { dpr?: number, shownWidth?: number, webgl?: boolean } = {}) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: options.dpr ?? 1 })
  const stage = document.createElement('div'); document.body.append(stage)
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ width: options.shownWidth ?? 320 } as DOMRect)
  const bitmap = document.createElement('canvas'); bitmap.width = 320; bitmap.height = 160
  const onFrame = vi.fn(), onError = vi.fn(), loseContext = vi.fn()
  const uploads: unknown[] = []
  let error = 0, lost = false
  const gl = new Proxy({
    NO_ERROR: 0, TRIANGLE_STRIP: 5, COMPILE_STATUS: 1, LINK_STATUS: 2, TEXTURE_2D: 3, RGBA: 4, UNSIGNED_BYTE: 5, TEXTURE0: 10,
    ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8, COLOR_BUFFER_BIT: 9, LINEAR: 11, CLAMP_TO_EDGE: 12, VERTEX_SHADER: 13, FRAGMENT_SHADER: 14,
    TEXTURE_MIN_FILTER: 15, TEXTURE_MAG_FILTER: 16, TEXTURE_WRAP_S: 17, TEXTURE_WRAP_T: 18,
    getError: vi.fn(() => { const value = error; error = 0; return value }), isContextLost: vi.fn(() => lost),
    getExtension: vi.fn(() => ({ loseContext })), getShaderParameter: () => true, getProgramParameter: () => true,
    texImage2D: vi.fn((...args: unknown[]) => { uploads.push(args.at(-1)) }), drawArrays: vi.fn(), viewport: vi.fn(), uniform2f: vi.fn(),
  } as Record<string, unknown>, { get: (target, key: string) => key in target ? target[key] : (target[key] = vi.fn(() => ({}))) })
  const contexts: Context2D[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string) {
    if (kind === 'webgl2') return options.webgl === false ? null : gl as unknown as WebGL2RenderingContext
    let fill = '#000000'
    const css = document.createElement('div').style
    const context = {
      owner: this, font: '', textAlign: '', textBaseline: '', fillText: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
      get fillStyle() { return fill },
      set fillStyle(value: string) { css.backgroundColor = ''; css.backgroundColor = value; if (css.backgroundColor) fill = css.backgroundColor },
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([16, 20, 24, /rgba\([^)]*,\s*0(?:\.\d+)?\s*\)/.test(fill) ? 128 : 255]) })),
    }
    contexts.push(context as unknown as Context2D)
    return context as unknown as CanvasRenderingContext2D
  } as typeof HTMLCanvasElement.prototype.getContext)
  const create = (extra: { background?: string, signal?: AbortSignal } = {}) => createAsciiGpuEffect({ stage, width: 320, height: 160, background: extra.background ?? 'rgb(16, 20, 24)', font: 'Menlo, monospace', signal: extra.signal, onFrame, onError })
  return { stage, bitmap, onFrame, onError, loseContext, gl: gl as Record<string, ReturnType<typeof vi.fn>>, uploads, contexts, create, fail: (code: number) => { error = code }, lose: () => { lost = true } }
}

const glyphStrips = (f: ReturnType<typeof fixture>) => f.uploads.filter((value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement && value !== f.bitmap)

beforeEach(() => vi.restoreAllMocks())
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); Reflect.deleteProperty(document, 'fonts') })

describe('GPU ASCII glyph renderer', () => {
  it('starts the ramp with a space so empty cells draw nothing', () => {
    expect(ASCII_GLYPH_RAMP[0]).toBe(' ')
    expect(new Set(ASCII_GLYPH_RAMP).size).toBe(ASCII_GLYPH_RAMP.length)
  })

  it('waits for the theme fonts before drawing any glyph', async () => {
    let release!: () => void
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>(resolve => { release = resolve }) } })
    const f = fixture()
    const pending = f.create()
    await Promise.resolve(); await Promise.resolve()
    expect(f.contexts.some(context => context.fillText.mock.calls.length)).toBe(false)
    expect(f.stage.querySelector('canvas')).toBeNull()
    release()
    const effect = await pending
    expect(f.contexts.some(context => context.fillText.mock.calls.length)).toBe(true)
    effect.dispose()
  })

  it('draws every ramp and line glyph from the theme font into one strip sized in device pixels', async () => {
    const f = fixture({ dpr: 2 })
    const effect = await f.create()
    const [strip] = glyphStrips(f)
    const cellWidth = ASCII_GLYPH_CELL.width * 2, cellHeight = ASCII_GLYPH_CELL.height * 2
    expect(strip!.width).toBe(cellWidth * (ASCII_GLYPH_RAMP.length + 4))
    expect(strip!.height).toBe(cellHeight)
    const writer = f.contexts.find(context => context.owner === strip)!
    expect(writer.font).toContain('Menlo, monospace')
    expect(writer.fillText.mock.calls.map(call => call[0]).join('')).toBe(ASCII_GLYPH_RAMP + '-/|\\')
    effect.dispose()
  })

  it('sizes the output to the stage on screen so a cell is a fixed number of CSS pixels', async () => {
    const f = fixture({ dpr: 2, shownWidth: 640 })
    const effect = await f.create()
    expect(effect.output.width).toBe(320 * 2 * 2)
    expect(effect.output.height).toBe(160 * 2 * 2)
    expect(effect.output.style.width).toBe('320px')
    effect.update(f.bitmap, 1)
    expect(f.gl.uniform2f).toHaveBeenCalledWith(expect.anything(), ASCII_GLYPH_CELL.width * 2, ASCII_GLYPH_CELL.height * 2)
    effect.dispose()
  })

  it('shows a frame only after the atlas upload and draw succeed, with strictly increasing revisions', async () => {
    const f = fixture()
    const effect = await f.create()
    expect(effect.output.style.opacity).toBe('0')
    effect.update(f.bitmap, 1)
    expect(f.uploads).toContain(f.bitmap)
    expect(f.gl.drawArrays).toHaveBeenCalledWith(5, 0, 4)
    expect(f.onFrame).toHaveBeenCalledWith(1)
    expect(effect.output.style.opacity).toBe('1')
    expect(() => effect.update(f.bitmap, 1)).toThrow(/ASCII_GLYPH_REVISION/)
    effect.resize(200, 100)
    expect(effect.output.style.opacity).toBe('0')
    expect(glyphStrips(f)).toHaveLength(2)
    effect.dispose()
    expect(f.loseContext).toHaveBeenCalled()
    expect(f.stage.querySelector('canvas')).toBeNull()
  })

  it('reports a failed draw, hides the output and releases the context', async () => {
    const f = fixture()
    const effect = await f.create()
    f.gl.drawArrays!.mockImplementationOnce(() => f.fail(1282))
    expect(() => effect.update(f.bitmap, 1)).toThrow(/ASCII_GLYPH_OPERATION/)
    expect(f.onFrame).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/ASCII_GLYPH_OPERATION/) }))
    expect(f.stage.querySelector('canvas')).toBeNull()
  })

  it('reports a lost context instead of drawing a stale frame', async () => {
    const f = fixture()
    const effect = await f.create()
    effect.output.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    await Promise.resolve()
    expect(f.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/ASCII_GLYPH_CONTEXT_LOST/) }))
    expect(() => effect.update(f.bitmap, 1)).toThrow(/ASCII_GLYPH_DISPOSED/)
  })

  it('rejects without leaving elements when WebGL 2, the background or the stage is unusable', async () => {
    const noGl = fixture({ webgl: false })
    await expect(noGl.create()).rejects.toThrow(/ASCII_GLYPH_CONTEXT/)
    expect(noGl.stage.querySelector('canvas')).toBeNull()
    const transparent = fixture()
    await expect(transparent.create({ background: 'rgba(0, 0, 0, 0.5)' })).rejects.toThrow(/ASCII_GLYPH_BACKGROUND/)
    expect(transparent.stage.querySelector('canvas')).toBeNull()
    const detached = fixture(); detached.stage.remove()
    await expect(detached.create()).rejects.toThrow(/ASCII_GLYPH_DETACHED/)
    const controller = new AbortController(); controller.abort()
    await expect(fixture().create({ signal: controller.signal })).rejects.toThrow(/ASCII_GLYPH_CANCELLED/)
  })
})
