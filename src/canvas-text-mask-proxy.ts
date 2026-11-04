import { CanvasHtmlTextureError, type CanvasHtmlTextRect, type CanvasHtmlTextureSnapshot } from './canvas-html-texture.js'

export interface CanvasTextMaskProxyOptions {
  /** Dedicated, positioned visual stage; never the source content. */
  readonly stage: HTMLElement
  /** The effect's output canvas, directly inside the stage. */
  readonly output: HTMLCanvasElement
}

export interface CanvasTextMaskProxy {
  /** Private, inert geometry for an upstream effect's text-range traversal. */
  readonly content: HTMLElement
  /** Returns true when the owner must tell the effect to rebuild its mask. */
  update(snapshot: CanvasHtmlTextureSnapshot | null | undefined): boolean
  /** Reproject the last snapshot; true means the effect must rebuild its mask. */
  resize(): boolean
  dispose(): void
}

interface Geometry {
  readonly revision: number
  readonly width: number
  readonly height: number
  readonly rects: readonly CanvasHtmlTextRect[]
}

const MAX_DIMENSION = 2048
const MAX_PIXELS = 2_097_152
const MAX_RECTS = 512
const PLACEMENT_TOLERANCE = 0.75

function fail(code: CanvasHtmlTextureError['code'], message: string): never {
  throw new CanvasHtmlTextureError(code, message)
}

function style(element: HTMLElement, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value, 'important')
}

/** Copy bounded geometry only; never retain an input object or its extra fields. */
function geometryOf(snapshot: CanvasHtmlTextureSnapshot): Geometry {
  const { revision, width, height, textRects } = snapshot
  if (!Number.isSafeInteger(revision) || revision < 1
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS
    || !Array.isArray(textRects)) {
    fail('unsafe-content', 'The text mask snapshot has invalid dimensions or revision.')
  }
  if (textRects.length > MAX_RECTS) fail('too-large', 'The text mask contains too many rectangles.')
  const rects: CanvasHtmlTextRect[] = []
  for (const rect of textRects) {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width < 0 || rect.height < 0
      || !Number.isFinite(rect.x + rect.width) || !Number.isFinite(rect.y + rect.height)) {
      fail('unsafe-content', 'The text mask contains invalid geometry.')
    }
    const left = Math.max(0, rect.x), top = Math.max(0, rect.y)
    const right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height)
    if (right > left && bottom > top) rects.push({ x: left, y: top, width: right - left, height: bottom - top })
  }
  return { revision, width, height, rects }
}

/**
 * Recreate text-range bounds in a private shadow tree without copying text.
 * No listeners or observers are installed: the owner calls resize on layout changes.
 */
export function createCanvasTextMaskProxy({ stage, output }: CanvasTextMaskProxyOptions): CanvasTextMaskProxy {
  const doc = stage.ownerDocument, win = doc.defaultView
  if (!win || !stage.isConnected || !output.isConnected || output.ownerDocument !== doc || output.parentElement !== stage) {
    fail('detached', 'The text mask output must be attached directly to its visual stage.')
  }
  const position = win.getComputedStyle(stage).position
  if (!position || position === 'static') fail('unsupported', 'The text mask stage must be positioned.')

  const frame = doc.createElement('div')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('inert', '')
  style(frame, {
    position: 'absolute', display: 'block', margin: '0', padding: '0', border: '0',
    'box-sizing': 'border-box', opacity: '0', visibility: 'visible', overflow: 'hidden',
    'pointer-events': 'none', animation: 'none', transition: 'none',
  })
  const shadow = frame.attachShadow({ mode: 'closed' })
  const content = doc.createElement('div')
  style(content, {
    display: 'block', position: 'relative', width: '100%', height: '100%',
    margin: '0', padding: '0', border: '0', 'box-sizing': 'border-box',
    'pointer-events': 'none', animation: 'none', transition: 'none',
  })
  shadow.append(content)
  stage.append(frame)
  let active = true
  let current: Geometry | undefined
  let invalidatedThrough = 0

  const clear = () => { content.replaceChildren() }
  const placement = () => {
    if (!stage.isConnected || !output.isConnected || output.parentElement !== stage || frame.parentElement !== stage) {
      fail('detached', 'The text mask visual region was removed.')
    }
    const base = stage.getBoundingClientRect(), target = output.getBoundingClientRect()
    const sx = base.width / stage.offsetWidth, sy = base.height / stage.offsetHeight
    if (![base.left, base.top, base.width, base.height, target.left, target.top, target.width, target.height, sx, sy].every(Number.isFinite)
      || base.width <= 0 || base.height <= 0 || target.width <= 0 || target.height <= 0 || sx <= 0 || sy <= 0) {
      fail('unsafe-content', 'The text mask output has invalid dimensions.')
    }
    const left = (target.left - base.left) / sx + stage.scrollLeft - stage.clientLeft
    const top = (target.top - base.top) / sy + stage.scrollTop - stage.clientTop
    const width = target.width / sx, height = target.height / sy
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      fail('too-large', 'The text mask output is too large.')
    }
    style(frame, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
    const actual = frame.getBoundingClientRect()
    if (![actual.left, actual.top, actual.width, actual.height].every(Number.isFinite)
      || Math.abs(actual.left - target.left) > PLACEMENT_TOLERANCE
      || Math.abs(actual.top - target.top) > PLACEMENT_TOLERANCE
      || Math.abs(actual.width - target.width) > PLACEMENT_TOLERANCE
      || Math.abs(actual.height - target.height) > PLACEMENT_TOLERANCE) {
      fail('unsafe-content', 'The text mask cannot be aligned with its visual output.')
    }
    return { width, height, scaleX: sx, scaleY: sy, rect: target }
  }

  const render = (geometry: Geometry) => {
    const area = placement()
    if (!geometry.rects.length) { clear(); return }
    const markerStyle = {
      position: 'absolute', display: 'inline-block', left: '0', top: '0', margin: '0', padding: '0', border: '0',
      font: '16px/normal sans-serif', 'white-space': 'pre', color: 'transparent',
      'transform-origin': '0 0', 'pointer-events': 'none', animation: 'none', transition: 'none',
    }
    const sample = doc.createElement('span')
    sample.textContent = 'M'
    style(sample, markerStyle)
    content.replaceChildren(sample)
    const range = doc.createRange()
    range.selectNodeContents(sample.firstChild!)
    const box = range.getBoundingClientRect()
    const x0 = (box.left - area.rect.left) / area.scaleX, y0 = (box.top - area.rect.top) / area.scaleY
    const w0 = box.width / area.scaleX, h0 = box.height / area.scaleY
    if (![x0, y0, w0, h0].every(Number.isFinite) || w0 <= 0 || h0 <= 0) {
      fail('capture', 'The browser cannot lay out the text mask markers.')
    }
    const fragment = doc.createDocumentFragment()
    for (const rect of geometry.rects) {
      const x = rect.x * area.width / geometry.width, y = rect.y * area.height / geometry.height
      const sx = rect.width * area.width / geometry.width / w0, sy = rect.height * area.height / geometry.height / h0
      const marker = doc.createElement('span')
      marker.textContent = 'M'
      style(marker, { ...markerStyle, transform: `translate(${x - x0 * sx}px, ${y - y0 * sy}px) scale(${sx}, ${sy})` })
      fragment.append(marker)
    }
    content.replaceChildren(fragment)
  }

  return {
    content,
    update(snapshot) {
      if (!active) fail('disposed', 'The text mask has been disposed.')
      if (!snapshot) {
        const changed = !!current
        if (current) invalidatedThrough = Math.max(invalidatedThrough, current.revision)
        current = undefined
        clear()
        return changed
      }
      let next: Geometry
      try { next = geometryOf(snapshot) } catch (error) {
        if (current) invalidatedThrough = Math.max(invalidatedThrough, current.revision)
        current = undefined; clear(); throw error
      }
      if (next.revision <= invalidatedThrough || (current && next.revision < current.revision)) return false
      if (current && next.revision === current.revision && JSON.stringify(next) !== JSON.stringify(current)) {
        fail('unsafe-content', 'The text mask revision does not match its committed geometry.')
      }
      try { render(next); current = next; return true } catch (error) {
        if (current) invalidatedThrough = Math.max(invalidatedThrough, current.revision)
        current = undefined; clear(); throw error
      }
    },
    resize() {
      if (!active) fail('disposed', 'The text mask has been disposed.')
      if (!current) return false
      try { render(current); return true } catch (error) { clear(); throw error }
    },
    dispose() {
      if (!active) return
      active = false
      current = undefined
      clear()
      frame.remove()
    },
  }
}
