// ai-design-check-ignore-file locale-aware-case -- SVG element and attribute tokens use ASCII protocol case, not localized UI text.
/** Capture an existing visual for a decorative renderer without changing its source DOM. */
export type AsciiVisualRect = Readonly<{ x: number, y: number, width: number, height: number }>
export interface AsciiVisualCapture {
  bitmap: HTMLCanvasElement
  width: number
  height: number
  /** Screen-space destination. Different from the SVG viewport for visible overflow. */
  bounds?: Readonly<{ left: number, top: number, width: number, height: number }>
  textRects: ReadonlyArray<AsciiVisualRect>
  dispose(): void
}

export class AsciiVisualCaptureError extends Error {
  constructor(readonly code: 'unsafe' | 'too-large' | 'unavailable' | 'changed' | 'capture', message: string) {
    super(message)
    this.name = 'AsciiVisualCaptureError'
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_MAX_PIXELS = 16_777_216
const MAX_SIDE = 8192
const UNSAFE_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard', 'mpath'])
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textpath'])
const PAINT_ELEMENTS = 'path,rect,circle,ellipse,line,polyline,polygon,use,image'
// Only paint-related computed styles are copied: layout, animations, and unrelated
// page CSS must not be allowed to change the isolated SVG or fetch resources.
const VISUAL_PROPERTIES = [
  'display', 'visibility', 'opacity', 'color', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'vector-effect',
  'shape-rendering', 'paint-order', 'overflow', 'clip-path', 'clip-rule', 'mask',
  'mask-image', 'mask-type', 'filter', 'stop-color', 'stop-opacity', 'flood-color',
  'flood-opacity', 'lighting-color', 'marker-start', 'marker-mid', 'marker-end',
  'transform', 'transform-origin', 'transform-box', 'mix-blend-mode', 'isolation',
] as const

const fail = (code: AsciiVisualCaptureError['code'], message: string): never => { throw new AsciiVisualCaptureError(code, message) }
const abortError = () => new DOMException('Capture aborted', 'AbortError')
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw abortError() }

function dimensions(rect: DOMRect, maxPixels: number): { width: number, height: number } {
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || width < 1 || height < 1) {
    return fail('unavailable', 'The visual has no measurable size')
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > maxPixels) {
    return fail('too-large', 'The visual exceeds the capture size limit')
  }
  return { width, height }
}

type AxisMatrix = { a: number, b: number, c: number, d: number, e: number, f: number }
function axisMatrix(svg: SVGSVGElement): AxisMatrix {
  const matrix = svg.getScreenCTM?.()
  if (!matrix || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
      matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.b) > 1e-8 || Math.abs(matrix.c) > 1e-8) {
    return fail('unavailable', 'The SVG coordinate transform cannot be captured faithfully')
  }
  return matrix
}

function localMarker(svg: SVGSVGElement, value: string): SVGMarkerElement {
  const match = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)$/i.exec(value)
  if (!match) return fail('unavailable', 'The SVG marker reference is unsupported')
  const id = fragment(match[1] ?? match[2] ?? match[3] ?? '', svg.ownerDocument.URL)
  const own = Array.from(svg.querySelectorAll('defs [id]')).filter(node => node.id === id)
  const diagram = svg.closest('.react-flow')
  const candidates = own.length ? own : diagram
    ? Array.from(diagram.querySelectorAll('svg defs [id]')).filter(node => node.id === id && node.closest('.react-flow') === diagram)
    : []
  if (candidates.length !== 1 || candidates[0]!.localName.toLowerCase() !== 'marker') return fail('unavailable', 'The SVG marker is unavailable')
  return candidates[0] as SVGMarkerElement
}

function numberAttribute(element: Element, name: string, fallback: number): number {
  const raw = element.getAttribute(name)
  if (raw === null || raw === '') return fallback
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(raw.trim())) return fail('unavailable', 'The SVG marker dimensions are unsupported')
  const result = parseFloat(raw)
  if (!Number.isFinite(result)) return fail('unavailable', 'The SVG marker dimensions are invalid')
  return result
}

function markerPadding(svg: SVGSVGElement, reference: string, strokeWidth: number, scale: number): number {
  const marker = localMarker(svg, reference)
  const width = numberAttribute(marker, 'markerWidth', 3), height = numberAttribute(marker, 'markerHeight', 3)
  if (width <= 0 || height <= 0) return fail('unavailable', 'The SVG marker has no measurable size')
  const viewBox = marker.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (viewBox && (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2]! <= 0 || viewBox[3]! <= 0)) return fail('unavailable', 'The SVG marker viewBox is unsupported')
  if (marker.ownerDocument.defaultView?.getComputedStyle(marker).overflow === 'visible') return fail('unavailable', 'Visible overflow inside a marker is unsupported')
  const refX = numberAttribute(marker, 'refX', 0), refY = numberAttribute(marker, 'refY', 0)
  // A reference far outside its own viewBox can put the marker arbitrarily far
  // from the path. Do not guess in that case.
  const range = viewBox ?? [0, 0, width, height]
  if (refX < range[0]! || refX > range[0]! + range[2]! || refY < range[1]! || refY > range[1]! + range[3]!) {
    return fail('unavailable', 'The SVG marker reference point is unsupported')
  }
  const units = marker.getAttribute('markerUnits') || 'strokeWidth'
  if (units !== 'strokeWidth' && units !== 'userSpaceOnUse') return fail('unavailable', 'The SVG marker units are unsupported')
  return Math.hypot(width, height) * (units === 'strokeWidth' ? strokeWidth : 1) * scale
}

/** Returns a screen-space rectangle for the source's actual, visible SVG paint. */
export function measureAsciiVisualBounds(element: SVGSVGElement | HTMLImageElement | HTMLCanvasElement): DOMRect {
  const root = element.getBoundingClientRect()
  if (element.namespaceURI !== SVG_NS || element.localName.toLowerCase() !== 'svg') return root
  const svg = element as SVGSVGElement, view = svg.ownerDocument.defaultView
  if (!view) return fail('unavailable', 'The source document has no window')
  const shapes = Array.from(svg.querySelectorAll<SVGGraphicsElement>(PAINT_ELEMENTS)).filter(shape => {
    if (shape.closest('defs,clipPath,mask,marker,symbol,pattern') || shape.classList.contains('react-flow__edge-interaction')) return false
    for (let current: Element | null = shape; current && current !== svg; current = current.parentElement) {
      const style = view.getComputedStyle(current)
      if (style.display === 'none' || Number(style.opacity || 1) === 0) return false
    }
    const style = view.getComputedStyle(shape)
    return style.visibility !== 'hidden' && style.visibility !== 'collapse'
  })
  if (!shapes.length) return fail('unavailable', 'The SVG contains no visible graphics')
  const rootStyle = view.getComputedStyle(svg)
  const overflow = rootStyle.overflow || rootStyle.getPropertyValue('overflow')
  // A clipped viewport has its own, already correct coordinate system.
  if (overflow !== 'visible') return root
  const matrix = axisMatrix(svg)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const shape of shapes) {
    for (let current: Element | null = shape; current && current !== svg; current = current.parentElement) {
      const filter = view.getComputedStyle(current).getPropertyValue('filter').trim()
      if (filter && filter !== 'none') return fail('unavailable', 'Filtered SVG overflow cannot be measured faithfully')
    }
    const style = view.getComputedStyle(shape)
    const transparent = (value: string) => value === 'none' || value === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(value)
    const fill = style.fill || shape.getAttribute('fill') || 'black'
    const stroke = style.stroke || shape.getAttribute('stroke') || 'none'
    const fillVisible = !transparent(fill) && Number(style.fillOpacity || 1) > 0
    const strokeVisible = !transparent(stroke) && Number(style.strokeOpacity || 1) > 0
    const markerRefs = ['marker-start', 'marker-mid', 'marker-end'].map(key => style.getPropertyValue(key).trim() || shape.getAttribute(key) || '').filter(reference => reference && reference !== 'none')
    if (!fillVisible && !strokeVisible && !markerRefs.length) continue
    const box = shape.getBoundingClientRect()
    if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite) || box.width < 0 || box.height < 0) return fail('unavailable', 'The SVG paint geometry is unavailable')
    const transform = shape.getScreenCTM?.()
    if (!transform || ![transform.a, transform.b, transform.c, transform.d].every(Number.isFinite)) return fail('unavailable', 'The SVG shape transform is unavailable')
    const scale = Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))
    if (!(scale > 0)) return fail('unavailable', 'The SVG shape transform is unavailable')
    const rawWidth = style.strokeWidth || shape.getAttribute('stroke-width') || '1'
    const strokeWidth = parseFloat(rawWidth)
    if (strokeVisible && (!Number.isFinite(strokeWidth) || strokeWidth < 0)) return fail('unavailable', 'The SVG stroke size is unavailable')
    const strokeScale = style.vectorEffect === 'non-scaling-stroke' ? 1 : scale
    const miter = style.strokeLinejoin === 'miter' ? Math.max(1, parseFloat(style.strokeMiterlimit || '4')) : 1
    if (!Number.isFinite(miter)) return fail('unavailable', 'The SVG stroke join is unsupported')
    let pad = strokeVisible ? strokeWidth * strokeScale * miter / 2 : 0
    for (const reference of markerRefs) pad = Math.max(pad, markerPadding(svg, reference, strokeWidth, strokeScale))
    left = Math.min(left, box.left - pad); top = Math.min(top, box.top - pad)
    right = Math.max(right, box.right + pad); bottom = Math.max(bottom, box.bottom + pad)
  }
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return fail('unavailable', 'The SVG contains no measurable graphics')
  if (left >= root.left && top >= root.top && right <= root.right && bottom <= root.bottom) return root
  for (const name of ['clip-path', 'mask', 'filter']) {
    const value = rootStyle.getPropertyValue(name).trim()
    if (value && value !== 'none') return fail('unavailable', 'Clipped SVG overflow cannot be captured faithfully')
  }
  void matrix // A validated root matrix is required for the expanded viewBox.
  return new view.DOMRect(left, top, right - left, bottom - top)
}

function fragment(value: string, documentUrl: string): string {
  let url: URL
  try { url = new URL(value, documentUrl) } catch { return fail('unsafe', 'Invalid SVG reference') }
  const current = new URL(documentUrl)
  const hash = url.hash
  url.hash = ''
  current.hash = ''
  if (!hash || url.href !== current.href) return fail('unsafe', 'External SVG references are unsupported')
  let id: string
  try { id = decodeURIComponent(hash.slice(1)) } catch { return fail('unsafe', 'Invalid SVG fragment') }
  if (!id || /[\s"'\\]/.test(id)) return fail('unsafe', 'Invalid SVG fragment')
  return id
}

function localResourceValue(value: string, documentUrl: string, refs: Set<string>): string {
  if (/\\|@import|expression\s*\(|image-set\s*\(|javascript\s*:/i.test(value)) {
    return fail('unsafe', 'Unsupported SVG resource')
  }
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi
  const result = value.replace(pattern, (_match, double: string | undefined, single: string | undefined, plain: string | undefined) => {
    const id = fragment((double ?? single ?? plain ?? '').trim(), documentUrl)
    refs.add(id)
    return `url("#${id}")`
  })
  if (/url\s*\(/i.test(result.replace(pattern, ''))) return fail('unsafe', 'Invalid SVG resource')
  return result
}

function textRects(svg: SVGSVGElement, viewport: DOMRect): ReadonlyArray<AsciiVisualRect> {
  const doc = svg.ownerDocument
  const view = doc.defaultView
  if (!view) return fail('unavailable', 'The source document has no window')
  const rects: AsciiVisualRect[] = []
  const walker = doc.createTreeWalker(svg, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    let parent: Element | null = node.parentNode as Element | null
    let insideText = false
    let visible = true
    while (parent && parent !== svg) {
      const name = parent.localName.toLowerCase()
      if (TEXT_ELEMENTS.has(name)) insideText = true
      const style = view.getComputedStyle(parent)
      if (style.display === 'none' || Number(style.opacity || 1) === 0) visible = false
      parent = parent.parentElement
    }
    if (!insideText || !visible || !node.parentElement || view.getComputedStyle(node.parentElement).visibility === 'hidden') continue
    const range = doc.createRange()
    range.selectNodeContents(node)
    for (const rect of Array.from(range.getClientRects())) {
      const left = Math.max(viewport.left, rect.left)
      const top = Math.max(viewport.top, rect.top)
      const right = Math.min(viewport.right, rect.right)
      const bottom = Math.min(viewport.bottom, rect.bottom)
      if (right > left && bottom > top) rects.push(Object.freeze({ x: left - viewport.left, y: top - viewport.top, width: right - left, height: bottom - top }))
    }
    range.detach()
  }
  return Object.freeze(rects)
}

function cloneSvg(svg: SVGSVGElement, width: number, height: number, observer: MutationObserver, expanded?: DOMRect): SVGSVGElement {
  const doc = svg.ownerDocument
  const view = doc.defaultView
  if (!view) return fail('unavailable', 'The source document has no window')
  const url = doc.URL
  const clone = svg.cloneNode(true) as SVGSVGElement
  const ids = new Set<string>()
  const refs = new Set<string>()
  const copyTree = (source: Element, target: Element) => {
    const originals = [source, ...Array.from(source.querySelectorAll('*'))]
    const copies = [target, ...Array.from(target.querySelectorAll('*'))]
    // Inspect even nodes that will subsequently be omitted.
    originals.forEach((original, index) => {
      const copy = copies[index]
    if (!copy || original.namespaceURI !== SVG_NS || UNSAFE_ELEMENTS.has(original.localName.toLowerCase())) return fail('unsafe', 'Unsupported SVG element')
    const id = original.getAttribute('id')
    if (id) {
      if (ids.has(id)) return fail('unsafe', 'Duplicate SVG id')
      ids.add(id)
    }
    for (const attr of Array.from(original.attributes)) {
      const name = attr.localName.toLowerCase()
      if (name.startsWith('on')) return fail('unsafe', 'SVG event attributes are unsupported')
      if (name === 'href') {
        const ref = fragment(attr.value.trim(), url)
        refs.add(ref)
        copy.setAttributeNS(attr.namespaceURI, attr.name, `#${ref}`)
      } else {
        const safeValue = localResourceValue(attr.value, url, refs)
        if (safeValue !== attr.value) copy.setAttributeNS(attr.namespaceURI, attr.name, safeValue)
      }
    }
    const computed = view.getComputedStyle(original)
    const style = (copy as SVGElement).style
    for (const name of VISUAL_PROPERTIES) {
      const value = computed.getPropertyValue(name).trim()
      if (value) style.setProperty(name, localResourceValue(value, url, refs))
    }
    })
  }
  copyTree(svg, clone)
  // React Flow puts edge markers in a sibling SVG. Only copy definitions from
  // this very diagram, never arbitrary document/HTML or external resources.
  const diagram = svg.closest('.react-flow')
  let importedNodes = 0
  let destinationDefs: SVGDefsElement | undefined
  for (const id of refs) {
    if (ids.has(id)) continue
    if (!diagram) return fail('unsafe', 'SVG reference is outside the captured visual')
    const candidates = Array.from(diagram.querySelectorAll('svg defs [id]')).filter(node => node.getAttribute('id') === id && node.closest('.react-flow') === diagram)
    if (candidates.length !== 1) return fail('unsafe', 'SVG reference is outside or ambiguous within the diagram')
    const original = candidates[0]!
    importedNodes += 1 + original.querySelectorAll('*').length
    if (importedNodes > 4096) return fail('too-large', 'Diagram definitions exceed the capture limit')
    observer.observe(original, { subtree: true, childList: true, characterData: true, attributes: true })
    const copy = original.cloneNode(true) as Element
    copyTree(original, copy)
    if (!destinationDefs) {
      destinationDefs = doc.createElementNS(SVG_NS, 'defs')
      clone.insertBefore(destinationDefs, clone.firstChild)
    }
    destinationDefs.append(copy)
  }
  // A text glyph used as a clipping/masking shape cannot be removed faithfully.
  if (svg.querySelector('clipPath text, clipPath tspan, mask text, mask tspan')) return fail('unsafe', 'Text-shaped SVG masks are unsupported')
  clone.querySelectorAll('text,tspan,textPath,style,title,desc').forEach(node => node.remove())
  const textWalker = doc.createTreeWalker(clone, 4 /* NodeFilter.SHOW_TEXT */)
  const remainingText: Node[] = []
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) remainingText.push(node)
  remainingText.forEach(node => node.parentNode?.removeChild(node))
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.style.setProperty('width', `${width}px`)
  clone.style.setProperty('height', `${height}px`)
  if (expanded) {
    const transform = axisMatrix(svg)
    clone.setAttribute('viewBox', `${(expanded.left - transform.e) / transform.a} ${(expanded.top - transform.f) / transform.d} ${expanded.width / transform.a} ${expanded.height / transform.d}`)
    clone.setAttribute('preserveAspectRatio', 'none')
    clone.style.setProperty('transform', 'none')
  }
  return clone
}

function imageGeometry(image: HTMLImageElement, view: Window, width: number, height: number) {
  const style = view.getComputedStyle(image)
  // Border/padding/filter/transform add pixels or coordinate changes that cannot be
  // reconstructed from the decoded image alone. Keep the original in those cases.
  for (const name of ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    const value = style.getPropertyValue(name).trim()
    if (value && parseFloat(value) !== 0) return fail('unavailable', 'Image box decoration cannot be captured faithfully')
  }
  for (const name of ['filter', 'clip-path', 'mask-image', 'transform']) {
    const value = style.getPropertyValue(name).trim()
    if (value && value !== 'none') return fail('unavailable', 'Image effects cannot be captured faithfully')
  }
  const fit = style.objectFit || 'fill'
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  let drawWidth = width
  let drawHeight = height
  if (fit !== 'fill') {
    const contain = Math.min(width / naturalWidth, height / naturalHeight)
    const scale = fit === 'contain' ? contain : fit === 'cover' ? Math.max(width / naturalWidth, height / naturalHeight)
      : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, contain) : NaN
    if (!Number.isFinite(scale)) return fail('unavailable', 'Unsupported image fit')
    drawWidth = naturalWidth * scale
    drawHeight = naturalHeight * scale
  }
  const position = (style.objectPosition || '50% 50%').trim().split(/\s+/)
  if (position.length > 2) return fail('unavailable', 'Unsupported image position')
  const coordinate = (value: string | undefined, available: number, axis: 'x' | 'y') => {
    if (!value || value === 'center') return available / 2
    if (value === (axis === 'x' ? 'left' : 'top')) return 0
    if (value === (axis === 'x' ? 'right' : 'bottom')) return available
    if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(value)) return available * parseFloat(value) / 100
    if (/^-?(?:\d+\.?\d*|\.\d+)px$/.test(value)) return parseFloat(value)
    return fail('unavailable', 'Unsupported image position')
  }
  const x = coordinate(position[0], width - drawWidth, 'x')
  const y = coordinate(position[1], height - drawHeight, 'y')
  return { x, y, width: drawWidth, height: drawHeight }
}

function loadSvgImage(doc: Document, serialized: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const view = doc.defaultView
  if (!view || typeof view.URL.createObjectURL !== 'function') return Promise.reject(new AsciiVisualCaptureError('unavailable', 'SVG capture is unavailable'))
  const image = doc.createElement('img')
  const url = view.URL.createObjectURL(new view.Blob([serialized], { type: 'image/svg+xml' }))
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      image.onload = null
      image.onerror = null
      view.URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve(image)
    }
    const onAbort = () => finish(abortError())
    const timer = setTimeout(() => finish(new AsciiVisualCaptureError('capture', 'SVG image loading timed out')), 10000)
    signal.addEventListener('abort', onAbort, { once: true })
    image.onload = () => finish()
    image.onerror = () => finish(new AsciiVisualCaptureError('capture', 'SVG image could not be decoded'))
    if (signal.aborted) onAbort()
    else image.src = url
  })
}

/** Draws only the current, already-rendered source; failure leaves that source intact. */
export async function captureAsciiVisual(
  element: SVGSVGElement | HTMLImageElement,
  signal: AbortSignal,
  options: { maxPixels?: number } = {},
): Promise<AsciiVisualCapture> {
  checkAbort(signal)
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) return fail('too-large', 'Invalid capture size limit')
  const originalRect = element.getBoundingClientRect()
  const rect = measureAsciiVisualBounds(element)
  const { width, height } = dimensions(rect, maxPixels)
  const doc = element.ownerDocument
  const view = doc.defaultView
  if (!view) return fail('unavailable', 'The source document has no window')
  const isSvg = element.namespaceURI === SVG_NS && element.localName.toLowerCase() === 'svg'
  const isImage = element.localName.toLowerCase() === 'img' && element.namespaceURI === 'http://www.w3.org/1999/xhtml'
  if (!isSvg && !isImage) return fail('unavailable', 'Unsupported visual')
  let source: CanvasImageSource
  let labels: ReadonlyArray<AsciiVisualRect> = Object.freeze([])
  let draw = { x: 0, y: 0, width, height }
  let observer: MutationObserver | undefined
  let changed = false
  try {
    if (isSvg) {
      const svg = element as SVGSVGElement
      observer = new view.MutationObserver(() => { changed = true })
      observer.observe(svg, { subtree: true, childList: true, characterData: true, attributes: true })
      labels = textRects(svg, rect)
      const expanded = rect.left !== originalRect.left || rect.top !== originalRect.top || rect.width !== originalRect.width || rect.height !== originalRect.height
      const clone = cloneSvg(svg, width, height, observer, expanded ? rect : undefined)
      const serialized = new view.XMLSerializer().serializeToString(clone)
      source = await loadSvgImage(doc, serialized, signal)
      if (observer.takeRecords().length) changed = true
    } else {
      const image = element as HTMLImageElement
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return fail('unavailable', 'Image is not decoded')
      draw = imageGeometry(image, view, width, height)
      source = image
    }
    checkAbort(signal)
    const now = element.getBoundingClientRect()
    const nowBounds = measureAsciiVisualBounds(element)
    if (changed || now.width !== originalRect.width || now.height !== originalRect.height || now.left !== originalRect.left || now.top !== originalRect.top ||
        nowBounds.left !== rect.left || nowBounds.top !== rect.top || nowBounds.width !== rect.width || nowBounds.height !== rect.height) {
      return fail('changed', 'The source changed during capture')
    }
    const canvas = doc.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return fail('unavailable', 'Canvas 2D is unavailable')
    try {
      context.drawImage(source, draw.x, draw.y, draw.width, draw.height)
      // A cross-origin image can be drawn but cannot be safely read by WebGL.
      context.getImageData(0, 0, 1, 1)
      checkAbort(signal)
    } catch (error) {
      canvas.width = 0
      canvas.height = 0
      if (signal.aborted) throw abortError()
      return fail('capture', `The visual cannot be read: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      signal.removeEventListener('abort', dispose)
      canvas.width = 0
      canvas.height = 0
    }
    signal.addEventListener('abort', dispose, { once: true })
    if (signal.aborted) { dispose(); throw abortError() }
    return { bitmap: canvas, width, height, bounds: Object.freeze({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }), textRects: labels, dispose }
  } finally {
    observer?.disconnect()
  }
}
