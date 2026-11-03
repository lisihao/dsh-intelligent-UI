// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsciiVisualCaptureError, captureAsciiVisual, measureAsciiVisualBounds } from '../src/ascii-visual-capture.js'

const svgNs = 'http://www.w3.org/2000/svg'
const rect = (left: number, top: number, width: number, height: number) => ({
  x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}),
}) as DOMRect
function svgFixture() {
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', '0 0 100 50')
  svg.innerHTML = '<defs><clipPath id="clip"><rect width="100" height="50"/></clipPath><linearGradient id="grad"><stop offset="0" stop-color="red"/></linearGradient></defs><g transform="translate(1 2)"><path d="M0 0 L90 40" clip-path="url(#clip)" fill="url(#grad)"/><text><tspan>secret value 42</tspan></text><text style="display:none">hidden text</text></g>'
  svg.getBoundingClientRect = () => rect(100, 50, 200, 100)
  document.body.append(svg)
  return svg
}
function chartLabel(svg: SVGSVGElement, text = '原始类别 · 42') {
  const frame = document.createElementNS(svgNs, 'foreignObject')
  frame.setAttribute('x', '0'); frame.setAttribute('y', '2'); frame.setAttribute('width', '100'); frame.setAttribute('height', '12')
  frame.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml'); frame.style.pointerEvents = 'none'
  const label = document.createElement('div'); label.className = 'openui-horizontal-bar-chart-category-label'
  const span = document.createElement('span'); span.textContent = text; label.append(span); frame.append(label)
  frame.getBoundingClientRect = () => rect(102, 64, 120, 18)
  svg.querySelector('g')!.append(frame)
  return { frame, label, span }
}
function imageFixture() {
  const image = document.createElement('img')
  Object.defineProperties(image, {
    complete: { value: true }, naturalWidth: { value: 400 }, naturalHeight: { value: 200 },
  })
  image.getBoundingClientRect = () => rect(100, 50, 200, 100)
  document.body.append(image)
  return image
}

function overflowingEdge(scale = 1) {
  const diagram = document.createElement('div')
  diagram.className = 'react-flow'
  const definitions = document.createElementNS(svgNs, 'svg')
  definitions.innerHTML = '<defs><marker id="arrow" markerWidth="18" markerHeight="18" viewBox="-10 -10 20 20" markerUnits="strokeWidth" refX="0" refY="0"><path d="M-10 -10L0 0L-10 10"/></marker></defs>'
  diagram.append(definitions); document.body.append(diagram)
  const svg = svgFixture()
  diagram.append(svg)
  svg.style.overflow = 'visible'
  svg.getBoundingClientRect = () => rect(60, 465, 300 * scale, 150 * scale)
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: scale, b: 0, c: 0, d: scale, e: 60, f: 465 }), configurable: true })
  const path = svg.querySelector('path')!
  path.setAttribute('d', 'M270 53L560 53')
  path.setAttribute('marker-end', 'url(#arrow)')
  path.style.fill = 'none'; path.style.stroke = 'rgb(20, 40, 60)'; path.style.strokeWidth = '1.8px'; path.style.strokeLinejoin = 'round'
  path.getBoundingClientRect = () => rect(60 + 270 * scale, 465 + 53 * scale, 290 * scale, 0)
  Object.defineProperty(path, 'getScreenCTM', { value: () => ({ a: scale, b: 0, c: 0, d: scale, e: 60, f: 465 }), configurable: true })
  return { svg, path, diagram }
}

let tempImages: HTMLImageElement[]
let autoLoad: boolean
let drawImage: ReturnType<typeof vi.fn>
let readPixel: ReturnType<typeof vi.fn>
let serialized: string
let srcDescriptor: PropertyDescriptor | undefined
let createUrl: ReturnType<typeof vi.fn>
let revokeUrl: ReturnType<typeof vi.fn>

beforeEach(() => {
  tempImages = []
  autoLoad = true
  serialized = ''
  drawImage = vi.fn()
  readPixel = vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage, getImageData: readPixel })) as never)
  const serialize = XMLSerializer.prototype.serializeToString
  vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(function (this: XMLSerializer, root) {
    serialized = serialize.call(this, root)
    return serialized
  })
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents() {}, getClientRects: () => [rect(110, 70, 30, 15)], detach() {},
  }) as unknown as Range)
  createUrl = vi.fn(() => 'blob:local-capture')
  revokeUrl = vi.fn()
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, writable: true, value: createUrl })
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeUrl })
  srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    set(this: HTMLImageElement) {
      tempImages.push(this)
      if (autoLoad) queueMicrotask(() => this.dispatchEvent(new Event('load')))
    },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  if (srcDescriptor) Object.defineProperty(HTMLImageElement.prototype, 'src', srcDescriptor)
  document.body.replaceChildren()
})

describe('captureAsciiVisual', () => {
  it('omits a plaintext OpenUI foreignObject label from serialized SVG while retaining its native pixels and masks', async () => {
    const svg = svgFixture(); svg.querySelectorAll('text').forEach(node => node.remove())
    const { frame, label, span } = chartLabel(svg)
    const trailingPath = document.createElementNS(svgNs, 'path')
    trailingPath.setAttribute('id', 'after-label'); trailingPath.setAttribute('d', 'M5 7L80 20'); trailingPath.style.stroke = 'rgb(9, 8, 7)'
    svg.querySelector('g')!.append(trailingPath)
    const original = svg.outerHTML
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    expect(serialized).not.toMatch(/foreignObject|<div|<span|原始类别/)
    expect(serialized).toContain('id="after-label"'); expect(serialized).toContain('d="M5 7L80 20"'); expect(serialized).toContain('stroke: rgb(9, 8, 7)')
    expect(result.textRects).toEqual([{ x: 10, y: 20, width: 30, height: 15 }, { x: 2, y: 14, width: 120, height: 18 }])
    expect(svg.outerHTML).toBe(original); expect(svg.contains(frame)).toBe(true)
    expect(frame.firstElementChild).toBe(label); expect(label.firstElementChild).toBe(span); expect(span.textContent).toBe('原始类别 · 42')
    expect(label.hasAttribute('hidden')).toBe(false); expect(span.style.opacity).toBe('')
    expect(drawImage).toHaveBeenCalledOnce(); result.dispose()
  })

  it('keeps adjacent SVG sibling pairings after several omitted label branches and clips whole-frame masks to the visual', async () => {
    const svg = svgFixture(); svg.querySelectorAll('text').forEach(node => node.remove())
    const first = chartLabel(svg, '第一个标签')
    first.frame.getBoundingClientRect = () => rect(90, 75, 80, 12)
    const rectNode = document.createElementNS(svgNs, 'rect'); rectNode.setAttribute('id', 'middle-paint'); rectNode.setAttribute('width', '45'); rectNode.style.fill = 'rgb(1, 2, 3)'
    svg.querySelector('g')!.append(rectNode)
    chartLabel(svg, '第二个标签')
    const path = document.createElementNS(svgNs, 'path'); path.setAttribute('id', 'final-paint'); path.setAttribute('d', 'M15 9L42 11'); path.style.stroke = 'rgb(4, 5, 6)'; svg.querySelector('g')!.append(path)
    vi.mocked(document.createRange).mockReturnValue({ selectNodeContents() {}, getClientRects: () => [], detach() {} } as unknown as Range)
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    const isolated = new DOMParser().parseFromString(serialized, 'image/svg+xml')
    expect(isolated.querySelector('#middle-paint')?.getAttribute('width')).toBe('45')
    expect(isolated.querySelector('#middle-paint')?.getAttribute('style')).toContain('fill: rgb(1, 2, 3)')
    expect(isolated.querySelector('#final-paint')?.getAttribute('d')).toBe('M15 9L42 11')
    expect(isolated.querySelector('#final-paint')?.getAttribute('style')).toContain('stroke: rgb(4, 5, 6)')
    expect(result.textRects).toEqual([{ x: 0, y: 25, width: 70, height: 12 }, { x: 2, y: 14, width: 120, height: 18 }])
    expect(svg.querySelectorAll('foreignObject')).toHaveLength(2)
    result.dispose()
  })

  it('does not mask a hidden native label and rejects an HTML label reused as SVG paint', async () => {
    const svg = svgFixture(); svg.querySelectorAll('text').forEach(node => node.remove())
    const { frame } = chartLabel(svg)
    frame.style.display = 'none'
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    expect(result.textRects).toEqual([]); result.dispose()
    frame.style.display = ''; frame.id = 'native-label'
    svg.querySelector('path')!.setAttribute('fill', 'url(#native-label)')
    createUrl.mockClear()
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ name: 'AsciiVisualCaptureError', code: 'unsafe' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it.each([
    '<button>Action</button>', '<a href="https://example.com/">Link</a>', '<input value="Input">', '<textarea>Input</textarea>',
    '<img src="https://example.com/picture.png">', '<iframe src="https://example.com/"></iframe>', '<script>run()</script>',
    '<div onclick="run()">Action</div>', '<span onmouseover="run()">Action</span>', '<div role="button">Action</div>',
    '<div tabindex="0">Focusable</div>', '<div contenteditable="true">Editable</div>',
    '<div style="background-image:url(https://example.com/a.png)">Resource</div>', '<span style="cursor:url(https://example.com/c.cur),auto">Cursor</span>',
    '<div><svg xmlns="http://www.w3.org/2000/svg"><text>Other namespace</text></svg></div>', '<canvas>Texture</canvas>',
  ])('keeps unsafe/interactive foreignObject content on the existing fallback path: %s', async markup => {
    const svg = svgFixture(), { label } = chartLabel(svg)
    label.innerHTML = markup
    const original = svg.outerHTML
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ name: 'AsciiVisualCaptureError', code: 'unsafe' })
    expect(createUrl).not.toHaveBeenCalled(); expect(svg.outerHTML).toBe(original)
  })

  it('rejects resource CSS supplied through a class and property-bound interactive handlers', async () => {
    const sheet = document.createElement('style'); sheet.textContent = '.capture-resource-label{background-image:url(https://example.com/bg.png)}'; document.head.append(sheet)
    const svg = svgFixture(), { label } = chartLabel(svg)
    label.className = 'capture-resource-label'
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
    label.className = ''; sheet.remove()
    label.onclick = () => { throw new Error('must never execute') }
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('does not allow a plaintext-label exception inside clipping definitions or weaken duplicate-ID checks', async () => {
    const svg = svgFixture(), { frame, label } = chartLabel(svg)
    svg.querySelector('clipPath')!.append(frame)
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
    svg.querySelector('g')!.append(frame)
    label.id = 'clip'
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it.each([1, 2])('captures visible overflowing React Flow edges and markers at scale %s', async scale => {
    const { svg } = overflowingEdge(scale)
    const before = svg.outerHTML
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    const bounds = result.bounds!
    const padding = Math.hypot(18, 18) * 1.8 * scale
    expect(bounds.left).toBeCloseTo(60 + 270 * scale - padding)
    expect(bounds.top).toBeCloseTo(465 + 53 * scale - padding)
    expect(bounds.width).toBeCloseTo(290 * scale + 2 * padding)
    expect(bounds.height).toBeCloseTo(2 * padding)
    const isolated = new DOMParser().parseFromString(serialized, 'image/svg+xml')
    expect(isolated.querySelector('parsererror')).toBeNull()
    const root = isolated.documentElement
    const viewBox = root.getAttribute('viewBox')!.split(' ').map(Number)
    expect(viewBox[0]).toBeCloseTo((bounds.left - 60) / scale)
    expect(viewBox[1]).toBeCloseTo((bounds.top - 465) / scale)
    expect(viewBox[2]).toBeCloseTo(bounds.width / scale)
    expect(viewBox[3]).toBeCloseTo(bounds.height / scale)
    expect(root.getAttribute('preserveAspectRatio')).toBe('none')
    expect(root.querySelector('marker#arrow')).not.toBeNull()
    expect(svg.outerHTML).toBe(before)
  })

  it('keeps regular in-viewport graphics on their original viewBox', async () => {
    const { svg, path } = overflowingEdge()
    path.removeAttribute('marker-end')
    path.getBoundingClientRect = () => rect(100, 480, 80, 30)
    const originalBounds = svg.getBoundingClientRect()
    expect(measureAsciiVisualBounds(svg)).toMatchObject({ left: originalBounds.left, top: originalBounds.top, width: originalBounds.width, height: originalBounds.height })
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    expect(result.bounds).toEqual({ left: 60, top: 465, width: 300, height: 150 })
    expect(serialized).toContain('viewBox="0 0 100 50"')
  })

  it('ignores transparent interaction paths when calculating visible overflow', () => {
    const { svg, path } = overflowingEdge()
    path.removeAttribute('marker-end')
    path.getBoundingClientRect = () => rect(100, 480, 80, 30)
    const interaction = document.createElementNS(svgNs, 'path')
    interaction.setAttribute('class', 'react-flow__edge-interaction')
    interaction.getBoundingClientRect = () => rect(3000, 3000, 1000, 1000)
    svg.append(interaction)
    expect(measureAsciiVisualBounds(svg)).toMatchObject({ left: 60, top: 465, width: 300, height: 150 })
  })

  it('refuses defs-only SVGs and unsupported skewed overflow', async () => {
    const empty = svgFixture()
    empty.querySelector('g')!.remove()
    expect(() => measureAsciiVisualBounds(empty)).toThrow(AsciiVisualCaptureError)
    const { svg } = overflowingEdge()
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0.1, c: 0, d: 1, e: 60, f: 465 }) })
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('rejects expanded overflow beyond the requested pixel budget before rasterization', async () => {
    const { svg } = overflowingEdge()
    await expect(captureAsciiVisual(svg, new AbortController().signal, { maxPixels: 1000 })).rejects.toMatchObject({ code: 'too-large' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('falls back when a filter can paint beyond the measured overflow geometry', async () => {
    const { svg, path } = overflowingEdge()
    path.style.filter = 'blur(4px)'
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('expresses original text rectangles relative to the expanded graphic bounds', async () => {
    const { svg } = overflowingEdge()
    vi.mocked(document.createRange).mockReturnValue({
      selectNodeContents() {}, getClientRects: () => [rect(330, 518, 40, 12)], detach() {},
    } as unknown as Range)
    const result = await captureAsciiVisual(svg, new AbortController().signal)
    expect(result.textRects).toHaveLength(1)
    expect(result.textRects[0]!.x).toBeCloseTo(330 - result.bounds!.left)
    expect(result.textRects[0]!.y).toBeCloseTo(518 - result.bounds!.top)
  })

  it('rejects a moved overflow path that changes while the SVG is decoding', async () => {
    autoLoad = false
    const { svg, path } = overflowingEdge()
    const pending = captureAsciiVisual(svg, new AbortController().signal)
    path.getBoundingClientRect = () => rect(430, 518, 290, 0)
    tempImages[0]!.dispatchEvent(new Event('load'))
    await expect(pending).rejects.toMatchObject({ code: 'changed' })
    expect(drawImage).not.toHaveBeenCalled()
  })
  it('captures actual SVG paint and local definitions, excluding the source text', async () => {
    const svg = svgFixture()
    const path = svg.querySelector('path')!
    path.style.setProperty('stroke', 'rgb(12, 34, 56)')
    path.setAttribute('clip-path', `url("${document.URL}#clip")`)
    const before = svg.outerHTML
    const controller = new AbortController()
    const result = await captureAsciiVisual(svg, controller.signal)
    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
    expect(result.textRects).toEqual([{ x: 10, y: 20, width: 30, height: 15 }])
    expect(serialized).toContain('viewBox="0 0 100 50"')
    expect(serialized).toContain('<clipPath id="clip"')
    expect(serialized).toContain('transform="translate(1 2)"')
    expect(serialized).toContain('url(&quot;#clip&quot;)')
    expect(serialized).toContain('url(&quot;#grad&quot;)')
    expect(serialized.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1)
    expect(serialized).toContain('stroke: rgb(12, 34, 56)')
    expect(serialized).not.toContain('secret value')
    expect(serialized).not.toContain('<text')
    expect(svg.outerHTML).toBe(before)
    expect(drawImage).toHaveBeenCalledWith(tempImages[0], 0, 0, 200, 100)
    expect(revokeUrl).toHaveBeenCalledOnce()
    result.dispose()
    result.dispose()
    expect(result.bitmap.width).toBe(0)
    expect(result.bitmap.height).toBe(0)
  })

  it('includes recursively referenced sibling definitions of the same React Flow, including its real marker id syntax', async () => {
    const diagram = document.createElement('div')
    diagram.className = 'react-flow'
    document.body.append(diagram)
    const definitions = document.createElementNS(svgNs, 'svg')
    definitions.innerHTML = '<defs><marker><path fill="url(#arrow-gradient)" d="M0 0 L10 5 L0 10Z"/></marker><linearGradient id="arrow-gradient"><stop offset="0" stop-color="red"/></linearGradient></defs>'
    const id = '1__color=var(--iexp-accent)&height=18&type=arrowclosed&width=18'
    definitions.querySelector('marker')!.setAttribute('id', id)
    diagram.append(definitions)
    const svg = svgFixture()
    diagram.append(svg)
    svg.querySelector('path')!.setAttribute('marker-end', `url('#${id}')`)
    await captureAsciiVisual(svg, new AbortController().signal)
    expect(serialized).toContain('id="1__color=var(--iexp-accent)&amp;height=18&amp;type=arrowclosed&amp;width=18"')
    expect(serialized).toContain('id="arrow-gradient"')
    expect(serialized).toContain('url(&quot;#arrow-gradient&quot;)')
    expect(serialized).toContain('marker-end=')
  })

  it('does not resolve sibling definitions from a different or nested diagram', async () => {
    const outer = document.createElement('div')
    outer.className = 'react-flow'
    outer.innerHTML = '<div class="react-flow"><svg><defs><marker id="foreign"/></defs></svg></div>'
    document.body.append(outer)
    const svg = svgFixture()
    outer.append(svg)
    svg.querySelector('path')!.setAttribute('marker-end', 'url(#foreign)')
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
  })

  it('rejects a sibling definition changed during decode', async () => {
    autoLoad = false
    const diagram = document.createElement('div')
    diagram.className = 'react-flow'
    document.body.append(diagram)
    const definitions = document.createElementNS(svgNs, 'svg')
    definitions.innerHTML = '<defs><marker id="arrow"><path d="M0 0"/></marker></defs>'
    diagram.append(definitions)
    const svg = svgFixture()
    diagram.append(svg)
    svg.querySelector('path')!.setAttribute('marker-end', 'url(#arrow)')
    const pending = captureAsciiVisual(svg, new AbortController().signal)
    definitions.querySelector('path')!.setAttribute('d', 'M1 1')
    tempImages[0]!.dispatchEvent(new Event('load'))
    await expect(pending).rejects.toMatchObject({ code: 'changed' })
  })

  it.each([
    ['script', '<script/>'],
    ['foreignObject', '<foreignObject/>'],
    ['image resource', '<image href="https://example.com/a.png"/>'],
    ['handler', '<path onload="run()"/>'],
    ['external href', '<use href="https://example.com/a.svg#id"/>'],
    ['external paint', '<path fill="url(https://example.com/a.svg#id)"/>'],
    ['escaped CSS', '<path style="fill: url(\\78)"/>'],
    ['missing local ref', '<path clip-path="url(#outside)"/>'],
  ])('rejects %s before creating a decodable SVG', async (_name, markup) => {
    const svg = svgFixture()
    svg.insertAdjacentHTML('beforeend', markup)
    await expect(captureAsciiVisual(svg, new AbortController().signal)).rejects.toMatchObject({ code: 'unsafe' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('waits for actual image load and aborts without committing or leaking its object URL', async () => {
    autoLoad = false
    const svg = svgFixture()
    const controller = new AbortController()
    const pending = captureAsciiVisual(svg, controller.signal)
    let resolved = false
    void pending.then(() => { resolved = true }, () => {})
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(tempImages).toHaveLength(1)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    tempImages[0]!.dispatchEvent(new Event('load'))
    expect(drawImage).not.toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledOnce()
  })

  it('rejects a source changed during decode instead of returning a stale snapshot', async () => {
    autoLoad = false
    const svg = svgFixture()
    const pending = captureAsciiVisual(svg, new AbortController().signal)
    svg.querySelector('path')!.setAttribute('d', 'M2 2 L3 3')
    tempImages[0]!.dispatchEvent(new Event('load'))
    await expect(pending).rejects.toMatchObject({ code: 'changed' })
    expect(drawImage).not.toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledOnce()
  })

  it('reports failed decode and frees its URL', async () => {
    autoLoad = false
    const pending = captureAsciiVisual(svgFixture(), new AbortController().signal)
    tempImages[0]!.dispatchEvent(new Event('error'))
    await expect(pending).rejects.toMatchObject({ code: 'capture' })
    expect(revokeUrl).toHaveBeenCalledOnce()
  })

  it('fails size limits before loading; a pre-aborted signal creates nothing', async () => {
    const svg = svgFixture()
    await expect(captureAsciiVisual(svg, new AbortController().signal, { maxPixels: 19999 })).rejects.toMatchObject({ code: 'too-large' })
    const controller = new AbortController()
    controller.abort()
    await expect(captureAsciiVisual(svg, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('uses the already-loaded image directly and clears the bitmap on cancellation', async () => {
    const image = imageFixture()
    const controller = new AbortController()
    const result = await captureAsciiVisual(image, controller.signal)
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 200, 100)
    expect(readPixel).toHaveBeenCalledWith(0, 0, 1, 1)
    expect(createUrl).not.toHaveBeenCalled()
    expect(result.textRects).toEqual([])
    controller.abort()
    expect(result.bitmap.width).toBe(0)
  })

  it('uses the source object-fit geometry and preserves transparent canvas padding', async () => {
    const image = imageFixture()
    image.getBoundingClientRect = () => rect(100, 50, 100, 100)
    image.style.objectFit = 'contain'
    await captureAsciiVisual(image, new AbortController().signal)
    expect(drawImage).toHaveBeenCalledWith(image, 0, 25, 100, 50)
    image.style.objectFit = 'cover'
    await captureAsciiVisual(image, new AbortController().signal)
    expect(drawImage).toHaveBeenLastCalledWith(image, -50, 0, 200, 100)
  })

  it('rejects unreadable image pixels and unsupported box effects without loading another image', async () => {
    const image = imageFixture()
    readPixel.mockImplementationOnce(() => { throw new DOMException('Tainted', 'SecurityError') })
    await expect(captureAsciiVisual(image, new AbortController().signal)).rejects.toBeInstanceOf(AsciiVisualCaptureError)
    image.style.filter = 'blur(2px)'
    await expect(captureAsciiVisual(image, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' })
    expect(createUrl).not.toHaveBeenCalled()
  })
})
