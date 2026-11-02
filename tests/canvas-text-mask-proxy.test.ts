// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCanvasTextMaskProxy } from '../src/canvas-text-mask-proxy.js'
import type { CanvasHtmlTextureSnapshot } from '../src/canvas-html-texture.js'

type Box = { left: number, top: number, width: number, height: number }
const rect = ({ left, top, width, height }: Box) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
}) as DOMRect

function fixture() {
  const stage = document.createElement('div'), output = document.createElement('canvas')
  stage.style.position = 'relative'
  stage.append(output); document.body.append(stage)
  let stageBox: Box = { left: 20, top: 30, width: 500, height: 300 }
  let outputBox: Box = { left: 70, top: 60, width: 240, height: 130 }
  Object.defineProperties(stage, {
    offsetWidth: { configurable: true, get: () => 500 },
    offsetHeight: { configurable: true, get: () => 300 },
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === stage) return rect(stageBox)
    if (this === output) return rect(outputBox)
    if (this.parentElement === stage) {
      const scaleX = stageBox.width / 500, scaleY = stageBox.height / 300
      return rect({
        left: stageBox.left + parseFloat(this.style.left) * scaleX,
        top: stageBox.top + parseFloat(this.style.top) * scaleY,
        width: parseFloat(this.style.width) * scaleX,
        height: parseFloat(this.style.height) * scaleY,
      })
    }
    return rect({ left: 0, top: 0, width: 0, height: 0 })
  })
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents() {},
    getBoundingClientRect() { return rect({ left: outputBox.left + 2, top: outputBox.top + 3, width: 10, height: 20 }) },
  }) as unknown as Range)
  return {
    stage, output,
    setOutput(value: Box) { outputBox = value },
    setStage(value: Box) { stageBox = value },
  }
}

function snapshot(revision = 1, rects: CanvasHtmlTextureSnapshot['textRects'] = [{ x: 10, y: 20, width: 50, height: 30 }]): CanvasHtmlTextureSnapshot {
  return { revision, width: 100, height: 100, textRects: rects }
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('private canvas text mask proxy', () => {
  it('maps only snapshot rectangles into an inert, closed shadow tree', () => {
    const f = fixture(), add = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const proxy = createCanvasTextMaskProxy(f)
    const extra = { ...snapshot(), secret: 'Revenue 24% in 2026' }
    expect(proxy.update(extra)).toBe(true)
    const root = proxy.content.getRootNode() as ShadowRoot, frame = root.host as HTMLElement
    expect(root.mode).toBe('closed')
    expect(frame.shadowRoot).toBeNull()
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(frame.hasAttribute('inert')).toBe(true)
    expect(frame.style.opacity).toBe('0')
    expect(frame.style.pointerEvents).toBe('none')
    expect(frame.style.left).toBe('50px')
    expect(frame.style.top).toBe('30px')
    expect(frame.style.width).toBe('240px')
    expect(frame.style.height).toBe('130px')
    expect(proxy.content.textContent).toBe('M')
    expect(proxy.content.innerHTML).not.toContain('Revenue')
    expect(proxy.content.firstElementChild!.getAttribute('style')).toContain('scale(12, 1.95)')
    expect(add.mock.calls.filter(([type]) => /^(pointer|mouse|wheel|key|scroll)/u.test(type) && !['mouseover', 'mouseout'].includes(type))).toEqual([])
    proxy.dispose()
    expect(frame.isConnected).toBe(false)
    expect(f.output.isConnected).toBe(true)
  })

  it('clips partially visible rectangles and drops those outside the bitmap', () => {
    const proxy = createCanvasTextMaskProxy(fixture())
    expect(proxy.update(snapshot(1, [
      { x: -10, y: 20, width: 30, height: 20 },
      { x: 120, y: 20, width: 5, height: 5 },
      { x: 70, y: 95, width: 40, height: 20 },
      { x: 3, y: 3, width: 0, height: 5 },
    ]))).toBe(true)
    expect(proxy.content.children).toHaveLength(2)
    expect(proxy.content.textContent).toBe('MM')
    expect(proxy.content.children[0]!.getAttribute('style')).toContain('scale(4.8, 1.3)')
    expect(proxy.content.children[1]!.getAttribute('style')).toContain('scale(7.2, 0.325)')
    proxy.dispose()
  })

  it('reprojects on resize and supports repeated updates, clears and stale revisions', () => {
    const f = fixture(), proxy = createCanvasTextMaskProxy(f)
    const first = snapshot(2)
    expect(proxy.update(first)).toBe(true)
    const oldTransform = proxy.content.firstElementChild!.getAttribute('style')
    f.setOutput({ left: 95, top: 85, width: 120, height: 260 })
    expect(proxy.resize()).toBe(true)
    expect(proxy.content.firstElementChild!.getAttribute('style')).not.toBe(oldTransform)
    expect(proxy.update(first)).toBe(true)
    expect(proxy.update(snapshot(1))).toBe(false)
    expect(proxy.content.children).toHaveLength(1)
    expect(proxy.update(undefined)).toBe(true)
    expect(proxy.content.children).toHaveLength(0)
    expect(proxy.resize()).toBe(false)
    expect(proxy.update(first)).toBe(false)
    expect(proxy.update(snapshot(3))).toBe(true)
    proxy.dispose()
  })

  it('fails closed for invalid geometry and keeps a committed revision immutable', () => {
    const proxy = createCanvasTextMaskProxy(fixture())
    proxy.update(snapshot())
    expect(() => proxy.update(snapshot(1, [{ x: 1, y: 1, width: 4, height: 4 }]))).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    expect(proxy.content.children).toHaveLength(1)
    for (const bad of [
      { ...snapshot(2), width: 0 },
      { ...snapshot(2), height: Infinity },
      { ...snapshot(2), width: 2049 },
      { ...snapshot(2), textRects: [{ x: NaN, y: 0, width: 1, height: 1 }] },
      { ...snapshot(2), textRects: [{ x: 0, y: 0, width: -1, height: 1 }] },
    ]) {
      expect(() => proxy.update(bad)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
      expect(proxy.content.children).toHaveLength(0)
    }
    expect(proxy.update(snapshot(1))).toBe(false)
    expect(() => proxy.update(snapshot(2, Array.from({ length: 513 }, () => ({ x: 0, y: 0, width: 1, height: 1 }))))).toThrowError(expect.objectContaining({ code: 'too-large' }))
    expect(proxy.content.children).toHaveLength(0)
    proxy.dispose()
  })

  it('clears geometry when the output cannot be laid out and releases idempotently', () => {
    const f = fixture(), proxy = createCanvasTextMaskProxy(f)
    proxy.update(snapshot())
    f.setOutput({ left: 70, top: 60, width: 0, height: 130 })
    expect(() => proxy.resize()).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
    expect(proxy.content.children).toHaveLength(0)
    f.setOutput({ left: 70, top: 60, width: 240, height: 130 })
    expect(proxy.resize()).toBe(true)
    f.setOutput({ left: 70, top: 60, width: 2049, height: 130 })
    expect(() => proxy.resize()).toThrowError(expect.objectContaining({ code: 'too-large' }))
    expect(proxy.content.children).toHaveLength(0)
    f.setOutput({ left: 70, top: 60, width: 240, height: 130 })
    expect(proxy.resize()).toBe(true)
    proxy.dispose(); proxy.dispose()
    expect(f.stage.children).toHaveLength(1)
    expect(() => proxy.update(snapshot(2))).toThrowError(expect.objectContaining({ code: 'disposed' }))
    expect(() => proxy.resize()).toThrowError(expect.objectContaining({ code: 'disposed' }))
  })

  it('rejects detached, foreign and unpositioned visual stages', () => {
    const stage = document.createElement('div'), output = document.createElement('canvas')
    expect(() => createCanvasTextMaskProxy({ stage, output })).toThrowError(expect.objectContaining({ code: 'detached' }))
    stage.append(output); document.body.append(stage)
    expect(() => createCanvasTextMaskProxy({ stage, output })).toThrowError(expect.objectContaining({ code: 'unsupported' }))
    stage.style.position = 'relative'; output.remove()
    expect(() => createCanvasTextMaskProxy({ stage, output })).toThrowError(expect.objectContaining({ code: 'detached' }))
  })
})
