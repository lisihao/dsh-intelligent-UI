// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn(), destroy: vi.fn() }))
vi.mock('../src/canvas-runtime-client.js', () => ({
  loadCanvasEffect: runtime.load,
  acquireCanvasSlot: (activate: () => void) => { activate(); return runtime.release },
}))
import { CanvasObjectView, glbSource, inspectGlb, isGlb, isSafeRaster, modelDomain, readGlbResponse } from '../src/canvas-object-view.js'
import { ContentView } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fixtureGlb(document: Record<string, unknown> = { asset: { version: '2.0' } }, bin?: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document)), jsonLength = Math.ceil(json.length / 4) * 4
  const binLength = bin ? Math.ceil(bin.length / 4) * 4 : 0
  const bytes = new Uint8Array(20 + jsonLength + (bin ? 8 + binLength : 0))
  bytes.set([0x67, 0x6c, 0x54, 0x46]); bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(json, 20)
  const header = new DataView(bytes.buffer); header.setUint32(4, 2, true); header.setUint32(8, bytes.length, true); header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true)
  if (bin) { header.setUint32(20 + jsonLength, binLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength) }
  return bytes
}

function fixturePng(): Uint8Array {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), char => char.charCodeAt(0))
}

function fixtureJpeg(): Uint8Array {
  // Minimal marker sequence to exercise the size sniffer; the browser fixture uses a decodable JPEG.
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x20, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9])
}

describe('source-bound Canvas object display', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

  it('only recognizes explicit GLB records and verifies the binary header and length', () => {
    expect(glbSource({ type: 'model/gltf-binary', url: '/model.glb' })).toEqual({ field: 'url', reference: '/model.glb' })
    expect(glbSource({ type: 'image/png', url: '/photo.png' })).toBeUndefined()
    expect(glbSource({ url: '/model.glb' })).toBeUndefined()
    expect(modelDomain({ domain: 'coding' })).toBe('coding')
    expect(modelDomain({ domain: 'invented' })).toBe('general')
    const bytes = fixtureGlb()
    expect(isGlb(bytes)).toBe(true)
    bytes[8] = 21
    expect(isGlb(bytes)).toBe(false)
  })

  it('rejects malformed, truncated, duplicated and non-v2 GLB chunks', () => {
    const valid = fixtureGlb()
    const wrongVersion = valid.slice(); new DataView(wrongVersion.buffer).setUint32(4, 1, true)
    const wrongType = valid.slice(); new DataView(wrongType.buffer).setUint32(16, 0x004e4942, true)
    const truncated = valid.slice(0, -4); new DataView(truncated.buffer).setUint32(8, truncated.length, true)
    const badJson = valid.slice(); badJson[20] = 0xff
    const duplicated = new Uint8Array(valid.length + 8); duplicated.set(valid); const header = new DataView(duplicated.buffer)
    header.setUint32(8, duplicated.length, true); header.setUint32(valid.length, 0, true); header.setUint32(valid.length + 4, 0x4e4f534a, true)
    for (const bytes of [wrongVersion, wrongType, truncated, badJson, duplicated]) expect(inspectGlb(bytes)).toEqual({ ok: false, reason: 'invalid' })
    expect(isGlb(fixtureGlb({ asset: { version: '1.0' } }))).toBe(false)
  })

  it('permits bounded self-contained binary and PNG data URIs while rejecting malformed data', () => {
    const png = fixturePng(), pngData = btoa(String.fromCharCode(...png))
    expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, images: [{ uri: `data:image/png;base64,${pngData}` }] }))).toEqual({ ok: true })
    const binaryDoc = { asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAAAAA==', byteLength: 4 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }] }
    expect(inspectGlb(fixtureGlb(binaryDoc))).toEqual({ ok: true })
    const embeddedDoc = { asset: { version: '2.0' }, buffers: [{ byteLength: png.length }], bufferViews: [{ buffer: 0, byteLength: png.length }], images: [{ bufferView: 0, mimeType: 'image/png' }] }
    expect(inspectGlb(fixtureGlb(embeddedDoc, png))).toEqual({ ok: true })
    expect(inspectGlb(fixtureGlb({ ...embeddedDoc, bufferViews: [{ buffer: 0, byteLength: png.length + 1 }] }, png)).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,A===', byteLength: 1 }] })).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, images: [{ uri: `data:image/jpeg;base64,${pngData}` }] })).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ ...embeddedDoc, images: [{ bufferView: 0, mimeType: 'image/svg+xml' }] }, png)).ok).toBe(false)
  })

  it('rejects external references and unapproved decoder extensions anywhere in GLB JSON', () => {
    for (const uri of ['https://example.test/texture.png', '/external.bin', '//example.test/file', 'blob:https://example.test/id', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const bytes = fixtureGlb({ asset: { version: '2.0' }, images: [{ uri }] })
      expect(inspectGlb(bytes)).toEqual({ ok: false, reason: 'external-resource' })
    }
    expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, extras: { uri: 'https://example.test/extra' } }))).toEqual({ ok: false, reason: 'external-resource' })
    for (const extension of ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression']) {
      expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, extensionsUsed: [extension] }))).toEqual({ ok: false, reason: 'unsupported-decoder' })
      expect(inspectGlb(fixtureGlb({ asset: { version: '2.0' }, meshes: [{ extensions: { [extension]: {} } }] }))).toEqual({ ok: false, reason: 'unsupported-decoder' })
    }
  })

  it('bounds the aggregate decoded accessor bytes without a small element-count limit', () => {
    const doc = (accessors: unknown[]) => ({ asset: { version: '2.0' }, accessors })
    expect(inspectGlb(fixtureGlb(doc([{ count: 100_000, componentType: 5126, type: 'VEC3' }])))).toEqual({ ok: true })
    expect(inspectGlb(fixtureGlb(doc([{ count: 33_554_432, componentType: 5126, type: 'SCALAR' }])))).toEqual({ ok: true })
    expect(inspectGlb(fixtureGlb(doc([{ count: 33_554_433, componentType: 5126, type: 'SCALAR' }]))).ok).toBe(false)
    expect(inspectGlb(fixtureGlb(doc([{ count: 20_000_000, componentType: 5126, type: 'SCALAR' }, { count: 20_000_000, componentType: 5126, type: 'SCALAR' }]))).ok).toBe(false)
    expect(inspectGlb(fixtureGlb(doc([{ count: Number.MAX_SAFE_INTEGER, componentType: 5126, type: 'MAT4' }]))).ok).toBe(false)
    for (const accessor of [{ count: -1, componentType: 5126, type: 'VEC3' }, { count: 1.5, componentType: 5126, type: 'VEC3' }, { count: 1, componentType: 123, type: 'SCALAR' }, { count: 1, componentType: 5126, type: 'invented' }]) {
      expect(inspectGlb(fixtureGlb(doc([accessor]))).ok).toBe(false)
    }
  })

  it('validates accessor views and accounts for sparse indices, values and copied buffers', () => {
    const binary = new Uint8Array(12)
    const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteLength: 2 }, { buffer: 0, byteOffset: 4, byteLength: 8 }], accessors: [{ count: 3, componentType: 5126, type: 'SCALAR', sparse: { count: 2, indices: { bufferView: 0, componentType: 5121 }, values: { bufferView: 1 } } }] }
    expect(inspectGlb(fixtureGlb(doc, binary))).toEqual({ ok: true })
    const sparse = doc.accessors[0]!.sparse
    expect(inspectGlb(fixtureGlb({ ...doc, accessors: [{ ...doc.accessors[0], sparse: { ...sparse, count: 4 } }] }, binary)).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ ...doc, accessors: [{ ...doc.accessors[0], sparse: { ...sparse, indices: { bufferView: 0, componentType: 5120 } } }] }, binary)).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ ...doc, accessors: [{ ...doc.accessors[0], bufferView: 1, byteOffset: 4 }] }, binary)).ok).toBe(false)
    expect(inspectGlb(fixtureGlb({ ...doc, accessors: [{ ...doc.accessors[0], count: 33_554_431, sparse: { ...sparse, count: 1 } }] }, binary)).ok).toBe(false)
    const oneMiB = 1024 * 1024, repeated = new Uint8Array(oneMiB + 8)
    const repeatedDoc = { asset: { version: '2.0' }, buffers: [{ byteLength: repeated.length }], bufferViews: [{ buffer: 0, byteLength: oneMiB }, { buffer: 0, byteOffset: oneMiB, byteLength: 1 }, { buffer: 0, byteOffset: oneMiB + 4, byteLength: 4 }], accessors: Array.from({ length: 65 }, () => ({ count: oneMiB, componentType: 5121, type: 'SCALAR', bufferView: 0, sparse: { count: 1, indices: { bufferView: 1, componentType: 5121 }, values: { bufferView: 2 } } })) }
    expect(inspectGlb(fixtureGlb(repeatedDoc, repeated)).ok).toBe(false)
  })

  it('caps cumulative embedded texture pixels before browser image decoding', () => {
    // Header-only dimension expansion exercises the pre-decode budget without allocating a 64 MiB raster.
    const big = fixturePng(); const header = new DataView(big.buffer); header.setUint32(16, 4096); header.setUint32(20, 4096)
    const document = (count: number) => ({ asset: { version: '2.0' }, buffers: [{ byteLength: big.length }], bufferViews: [{ buffer: 0, byteLength: big.length }], images: Array.from({ length: count }, () => ({ bufferView: 0, mimeType: 'image/png' })) })
    expect(inspectGlb(fixtureGlb(document(2), big))).toEqual({ ok: true })
    expect(inspectGlb(fixtureGlb(document(3), big)).ok).toBe(false)
  })

  it('caps repeated buffer-view slices even when they point to the same compact binary', () => {
    const binary = new Uint8Array(1024 * 1024)
    const document = (count: number) => ({ asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }], bufferViews: Array.from({ length: count }, () => ({ buffer: 0, byteLength: binary.length })) })
    expect(inspectGlb(fixtureGlb(document(128), binary))).toEqual({ ok: true })
    expect(inspectGlb(fixtureGlb(document(129), binary)).ok).toBe(false)
  })

  it('retains the source record and link without loading a model containing an external texture', async () => {
    const bytes = fixtureGlb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.test/extra-texture.png' }] })
    const value = { type: 'glb', src: '/untrusted.glb' }, original = JSON.stringify(value)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/not-used')
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(ContentView, { value })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.textContent).toContain('模型包含外部资源')
      expect(host.querySelector('a')?.getAttribute('href')).toBe(new URL('/untrusted.glb', location.href).href)
      expect(JSON.stringify(value)).toBe(original)
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(new URL('/untrusted.glb', location.href).href, expect.objectContaining({ redirect: 'error' }))
      expect(runtime.load).not.toHaveBeenCalled()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('recognizes only explicitly declared illustrations with supported image types', () => {
    expect(glbSource({ type: 'image/png', role: 'illustration', url: '/art.png' })).toEqual({ field: 'url', reference: '/art.png', kind: 'image', mime: 'image/png' })
    expect(glbSource({ mimeType: 'image/jpeg', role: 'decorative', src: '/art.jpg' })?.kind).toBe('image')
    expect(glbSource({ type: 'image/png', url: '/chart.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'photo', url: '/photo.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', kind: 'screenshot', url: '/shot.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: '实际财务图表', url: '/chart.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: '系统架构示意图', url: '/architecture.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', caption: '组件连接图解', url: '/connections.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: 'architecture schematic', url: '/diagram.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: '营收趋势图插画', url: '/trend.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', caption: '財務折線圖', url: '/line.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: 'K线图插画', url: '/stock.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/png', role: 'illustration', alt: 'heatmap illustration', url: '/heat.png' })).toBeUndefined()
    expect(glbSource({ type: 'image/svg+xml', role: 'illustration', url: '/art.svg' })).toBeUndefined()
  })

  it('checks raster signatures, bounded dimensions and excludes animated PNG', () => {
    const png = fixturePng(), jpeg = fixtureJpeg()
    expect(isSafeRaster(png, 'image/png')).toBe(true)
    expect(isSafeRaster(jpeg, 'image/jpeg')).toBe(true)
    expect(isSafeRaster(png, 'image/jpeg')).toBe(false)
    expect(isSafeRaster(jpeg, 'image/png')).toBe(false)
    const oversized = png.slice(); new DataView(oversized.buffer).setUint32(16, 4097)
    expect(isSafeRaster(oversized, 'image/png')).toBe(false)
    const animated = new Uint8Array(png.length + 20)
    animated.set(png.slice(0, -12)); animated.set([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], png.length - 12); animated.set(png.slice(-12), png.length + 8)
    expect(isSafeRaster(animated, 'image/png')).toBe(false)
    expect(isSafeRaster(png.slice(0, -1), 'image/png')).toBe(false)
    expect(isSafeRaster(jpeg.slice(0, 8), 'image/jpeg')).toBe(false)
  })

  it('shows a source illustration unchanged beside a verified Ink effect, and releases both on unmount', async () => {
    const bytes = fixturePng(), value = { type: 'image/png', role: 'illustration', url: '/art.png', alt: '示意插画', domain: 'coding' }
    const original = JSON.stringify(value), setOptions = vi.fn()
    const factory = vi.fn((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy, setOptions } })
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(ContentView, { value })); await new Promise(resolve => setTimeout(resolve, 10)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(new URL('/art.png', location.href).href, expect.objectContaining({ redirect: 'error' }))
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ scale: 4.2 })
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/illustration')
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('示意插画')
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
      expect(JSON.stringify(value)).toBe(original)
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="向左旋转插画效果"]')!
      await act(async () => { button.focus(); button.click() })
      expect(document.activeElement).toBe(button)
      expect(setOptions).toHaveBeenCalledWith({ autoRotate: true, autoRotateSpeed: -6 })
    } finally { await act(async () => root.unmount()); host.remove() }
    expect(runtime.destroy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/illustration')
  })

  it('keeps the verified original image visible without animation in reduced motion', async () => {
    const bytes = fixturePng(), value = { type: 'image/png', role: 'decorative', url: '/art.png' }
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(ContentView, { value })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.querySelector<HTMLDivElement>('.iexp-canvas-object')?.hidden).toBe(true)
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/illustration')
      expect(host.querySelector('a')?.textContent).toBe('打开原始插画')
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/illustration')
  })

  it('does not use Glass to erase a JPEG illustration’s interior marks', async () => {
    const bytes = fixtureJpeg(), value = { type: 'image/jpeg', role: 'illustration', url: '/art.jpg', domain: 'project-management' }
    const factory = vi.fn((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy } })
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(ContentView, { value })); await new Promise(resolve => setTimeout(resolve, 10)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(runtime.load).not.toHaveBeenCalledWith('glass-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ threshold: 0.15, contrast: 4, lineSpacing: 6, scale: 4.2 })
      const image = host.querySelector('img')!
      expect(image.getAttribute('src')).toBe('blob:http://localhost/illustration')
      expect(image.style.objectFit).toBe('contain')
      expect(image.style.maxWidth).toBe('100%')
      expect(image.style.maxHeight).toBe('260px')
      expect(image.parentElement?.style.padding).toBe('16px')
      expect(image.parentElement?.style.aspectRatio).toBe('')
      expect(host.querySelector<HTMLDivElement>('.iexp-canvas-object')?.style.flex).toBe('1 1 200px')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('retains the source link and allows retry when image bytes do not match their declared type', async () => {
    const valid = fixturePng(), value = { type: 'image/png', role: 'illustration', url: '/art.png' }
    const response = (bytes: Uint8Array) => ({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer })
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(fixtureJpeg())).mockResolvedValueOnce(response(valid)))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(ContentView, { value })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.textContent).toContain('插画格式或尺寸不受支持')
      expect(host.querySelector('a')?.getAttribute('href')).toBe(new URL('/art.png', location.href).href)
      expect(host.querySelector('img')).toBeNull()
      const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
      await act(async () => { retry.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/illustration')
      expect(host.textContent).not.toContain('插画格式或尺寸不受支持')
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('always retains the caller’s original image when byte validation fails', async () => {
    const value = { type: 'image/png', role: 'illustration', url: '/unavailable.png' }
    const originalView = h('img', { src: '/unavailable.png', alt: 'Markdown 原始插画' })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true, originalView })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/unavailable.png')
      expect(host.querySelector('img')?.getAttribute('alt')).toBe('Markdown 原始插画')
      expect(host.textContent).toContain('插画读取失败（404）')
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('does not refetch a supplied original in reduced motion, then loads the effect when motion is enabled', async () => {
    const bytes = fixturePng(), value = { type: 'image/png', role: 'illustration', url: '/art.png', domain: 'coding' }
    const originalView = h('img', { src: '/art.png', alt: 'Markdown 原始插画' })
    let reducedMotion = true, onChange = () => {}
    const media = { get matches() { return reducedMotion }, addEventListener(_type: string, callback: () => void) { onChange = callback }, removeEventListener() {} }
    vi.stubGlobal('matchMedia', () => media)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }); vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    runtime.load.mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy } })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration'); URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true, originalView })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/art.png')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(runtime.load).not.toHaveBeenCalled()
      await act(async () => { reducedMotion = false; onChange(); await new Promise(resolve => setTimeout(resolve, 10)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(host.querySelector('img')?.getAttribute('src')).toBe('/art.png')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('defers illustration fetches until near the viewport and frees them when scrolled away', async () => {
    const bytes = fixturePng(), value = { type: 'image/png', role: 'illustration', url: '/art.png' }
    let observer: IntersectionObserverCallback | undefined, target: Element | undefined
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { observer = callback } observe(element: Element) { target = element } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }); vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/illustration'); URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    const fire = (isIntersecting: boolean) => observer!([{ isIntersecting, target } as IntersectionObserverEntry], {} as IntersectionObserver)
    try {
      await act(async () => root.render(h(ContentView, { value })))
      expect(fetchMock).not.toHaveBeenCalled()
      await act(async () => { fire(true); await new Promise(resolve => setTimeout(resolve, 0)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:http://localhost/illustration')
      await act(async () => fire(false))
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/illustration')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('does not fetch an image whose supplied source is not in the actual record', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const value = { type: 'image/png', role: 'illustration', url: '/actual.png' }
    const source = { field: 'url', reference: '/other.png', kind: 'image' as const, mime: 'image/png' as const }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source, dark: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(host.textContent).toContain('插画与原始来源不匹配')
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('cancels an oversized streamed model even when Content-Length is absent', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(4)) }, cancel })
    await expect(readGlbResponse(new Response(stream), 5)).rejects.toThrow('模型超出可处理大小')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('uses a verified source model, releases the effect and retains the original object', async () => {
    const bytes = fixtureGlb(), value = { type: 'model/gltf-binary', url: 'https://example.test/model.glb', caption: '源模型' }
    const original = JSON.stringify(value)
    const setOptions = vi.fn()
    runtime.load.mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy, setOptions } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(host.querySelector('canvas')).not.toBeNull()
      expect(JSON.stringify(value)).toBe(original)
      const rotate = host.querySelector<HTMLButtonElement>('button[aria-label="向左旋转模型"]')
      expect(rotate).not.toBeNull()
      await act(async () => { rotate!.focus(); rotate!.click() })
      expect(document.activeElement).toBe(rotate)
      expect(setOptions).toHaveBeenCalledWith({ autoRotate: true, autoRotateSpeed: -6 })
    } finally { await act(async () => root.unmount()); host.remove() }
    expect(runtime.destroy).toHaveBeenCalledTimes(1)
    expect(runtime.release).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/fixture')
  })

  it('recognizes an explicit model in the normal content path while retaining the source text', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const value = { type: 'model/gltf-binary', url: '/fixture.glb', caption: '源模型' }
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => root.render(h(ContentView, { value })))
      expect(host.querySelector('.iexp-canvas-object')).not.toBeNull()
      expect(host.querySelector<HTMLDivElement>('.iexp-canvas-object')?.hidden).toBe(true)
      expect(host.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe(new URL('/fixture.glb', location.href).href)
      expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(value)
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('releases its slot immediately if WebGL is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    const value = { type: 'glb', src: '/fixture.glb' }, host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: false })); await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(host.querySelector('[role="status"]')?.textContent).toContain('WebGL 2')
      expect(runtime.release).toHaveBeenCalled()
      expect(runtime.load).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('selects the ASCII object for a source that explicitly identifies a coding context', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb', domain: 'coding' }
    const factory = vi.fn((_elements: unknown, _options: Record<string, unknown>) => ({ destroy: runtime.destroy }))
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledWith('ascii-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ colored: false, color: '#d5e2e9' })
      expect(factory.mock.calls[0]![1]).not.toHaveProperty('scale')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('uses the legible Ink fallback for an explicitly quantitative model', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb', domain: 'quantitative' }
    const factory = vi.fn((_elements: unknown, _options: Record<string, unknown>) => ({ destroy: runtime.destroy }))
    runtime.load.mockResolvedValue(factory)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: true })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledWith('ink-object')
      expect(factory.mock.calls[0]![1]).toMatchObject({ inkColor: '#d5e2e9' })
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('keeps the original model available and permits retry after a component download fails', async () => {
    const bytes = fixtureGlb(), value = { type: 'glb', src: '/fixture.glb' }
    runtime.load.mockReset().mockRejectedValueOnce(new Error('internal module address')).mockResolvedValue((_elements: unknown, options: { onLoad(): void }) => { options.onLoad(); return { destroy: runtime.destroy } })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as WebGL2RenderingContext)
    vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) } disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer }))
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fixture')
    URL.revokeObjectURL = vi.fn()
    const host = document.createElement('div'), root = createRoot(host); document.body.append(host)
    try {
      await act(async () => { root.render(h(CanvasObjectView, { value, source: glbSource(value)!, dark: false })); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.textContent).toContain('请检查网络后重试')
      expect(host.textContent).not.toContain('internal module address')
      expect(host.querySelector('a')?.textContent).toBe('打开原始模型')
      const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试')!
      await act(async () => { retry.click(); await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(runtime.load).toHaveBeenCalledTimes(2)
      expect(host.textContent).not.toContain('组件加载失败')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
