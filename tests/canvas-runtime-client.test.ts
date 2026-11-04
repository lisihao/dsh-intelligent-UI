import { describe, expect, it, vi } from 'vitest'
import { canvasEffectUrl, createCanvasEffectLoader, createCanvasSlotPool } from '../src/canvas-runtime-client.js'

describe('local Canvas UI runtime', () => {
  it('uses only fixed catalog slugs and changes the URL on a retry', async () => {
    const factory = () => ({ destroy() {} })
    const importer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ createInkObject: factory })
    const load = createCanvasEffectLoader(importer)
    await expect(load('ink-object')).rejects.toThrow('offline')
    await expect(load('ink-object')).resolves.toBe(factory)
    expect(importer).toHaveBeenCalledTimes(2)
    expect(importer.mock.calls[0]![0]).toContain('attempt=0')
    expect(importer.mock.calls[1]![0]).toContain('attempt=1')
    await expect(load('ink-object')).resolves.toBe(factory)
    expect(importer).toHaveBeenCalledTimes(2)
    await expect(load('../outside')).rejects.toThrow('Unknown effect')
    expect(() => canvasEffectUrl('asciify', -1)).toThrow()
  })

  it('rejects an unexpected export and permits a later retry', async () => {
    const load = createCanvasEffectLoader(vi.fn().mockResolvedValueOnce({}).mockResolvedValue({ createVHS() {} }))
    await expect(load('vhs')).rejects.toThrow('CANVAS_EFFECT_EXPORT_MISSING')
    await expect(load('vhs')).resolves.toBeTypeOf('function')
  })

  it.each([['bend', 'createBend'], ['hex-float', 'createHexFloat']])('refuses %s in the shared document even if the factory loads', async (slug, name) => {
    const factory = vi.fn(() => ({ destroy() {} }))
    const load = createCanvasEffectLoader(vi.fn().mockResolvedValue({ [name]: factory }))
    const effect = await load(slug)
    expect(() => effect({ source: {}, content: {}, output: {} })).toThrow('CANVAS_EFFECT_ISOLATION_REQUIRED')
    expect(factory).not.toHaveBeenCalled()
  })

  it('limits concurrent effects and releases waiting surfaces in order', () => {
    const acquire = createCanvasSlotPool(2), calls: number[] = []
    const releaseA = acquire(() => calls.push(1))
    const releaseB = acquire(() => calls.push(2))
    const releaseC = acquire(() => calls.push(3))
    expect(calls).toEqual([1, 2])
    releaseA(); releaseA()
    expect(calls).toEqual([1, 2, 3])
    releaseB(); releaseC()
    expect(calls).toEqual([1, 2, 3])
  })
})
