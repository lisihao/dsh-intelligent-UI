import { useCompositionSelection } from './adaptive-ui/scope.js'
// ai-design-check-ignore-file locale-aware-case -- MIME, format, and role values are protocol identifiers, not localized UI text.
import { createElement as h, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { themePreferences, usePresentationTheme } from './theme-runtime.js'
import { isGpuAsciiTheme } from './theme-contracts.js'
import { acquireCanvasSlot, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { CanvasRuntimeContext } from './canvas-runtime-context.js'
import { planCanvasEffect, type EffectDomain } from './effect-planner.js'
import { classifyCanvasAutoDomain } from './canvas-auto-plan-domain.js'
import { ThemeButton } from './theme-components.js'
import { isEvidenceVisualLabel } from './visual-semantics.js'

interface GlbSource { field: string, reference: string, kind?: undefined }
interface ImageSource { field: string, reference: string, kind: 'image', mime: 'image/png' | 'image/jpeg' }
type ObjectSource = GlbSource | ImageSource
const glbTypes = new Set(['glb', 'model/gltf-binary'])
const MAX_GLB_BYTES = 64 * 1024 * 1024
// GLTFLoader can allocate accessors even when their bytes are absent from the file.
const MAX_GLB_ACCESSOR_BYTES = 128 * 1024 * 1024
const MAX_GLB_BUFFER_VIEW_BYTES = 128 * 1024 * 1024
const MAX_GLB_TEXTURE_BYTES = 128 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_SIDE = 4096
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
const domainEffects: Readonly<Record<EffectDomain, string>> = Object.freeze({
  'technical-insight': 'ink-object', coding: 'ascii-object',
  'project-management': 'glass-object', quantitative: 'ink-object', general: 'ink-object',
})

/** Use only declared or evidence-backed source context; uncertainty keeps Ink. */
export function modelDomain(value: unknown): EffectDomain {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'general'
  const result = classifyCanvasAutoDomain(value)
  return result.status === 'identified' ? result.domain : 'general'
}

/** Upstream object effects use different material/color controls. */
function objectEffectAppearance(component: string, dark: boolean, isImage = false, gpuTheme = false): Record<string, unknown> {
  const color = dark ? '#d5e2e9' : '#1e2c32'
  if (component === 'ink-object') return { inkColor: color, ...(isImage ? { threshold: 0.15, contrast: 4, lineSpacing: 6, scale: 4.2 } : {}) }
  if (component === 'ascii-object') return { colored: false, color, cellSize: 9, exposure: 2, ...(gpuTheme && !isImage ? {fov:45, scale:3.2} : {}) }
  return {}
}

/** Legacy name retained for the normal content path. Ordinary photos, charts and screenshots stay unchanged. */
export function glbSource(value: unknown): ObjectSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const field = ['url', 'src', 'uri', 'href'].find(key => typeof record[key] === 'string' && (record[key] as string).trim())
  if (!field) return undefined
  const types = [record.mimeType, record.mediaType, record.format, record.type]
    .filter((item): item is string => typeof item === 'string').map(item => item.trim().toLowerCase())
  if (types.some(type => glbTypes.has(type))) return { field, reference: record[field] as string }
  const role = typeof record.role === 'string' ? record.role.trim().toLowerCase() : ''
  if (!['illustration', 'decorative'].includes(role)) return undefined
  const conflictingRole = [record.type, record.kind, record.category, record.purpose, record.alt, record.caption]
    .some(item => typeof item === 'string' && isEvidenceVisualLabel(item))
  if (conflictingRole) return undefined
  const mime = types.find(type => type === 'image/png' || type === 'image/jpeg') as ImageSource['mime'] | undefined
  return mime ? { field, reference: record[field] as string, kind: 'image', mime } : undefined
}

/** Limit browser decoding and reject animated PNGs before passing bytes to upstream. */
function safeRasterPixelCount(bytes: Uint8Array, mime: ImageSource['mime']): number {
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 0
  let width = 0, height = 0
  if (mime === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 0
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (data.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return 0
    width = data.getUint32(16); height = data.getUint32(20)
    let offset = 8, ended = false
    while (offset + 12 <= bytes.length) {
      const length = data.getUint32(offset)
      if (length > bytes.length - offset - 12) return 0
      const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
      if (kind === 'acTL') return 0
      offset += length + 12
      if (kind === 'IEND') { ended = true; break }
    }
    if (!ended || offset !== bytes.length) return 0
  } else {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 0
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return 0
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) return 0
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!
      if (length < 2 || offset + length > bytes.length) return 0
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return 0
        height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!
        width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
        break
      }
      offset += length
    }
  }
  return width > 0 && height > 0 && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE && width * height <= MAX_IMAGE_PIXELS ? width * height : 0
}

export function isSafeRaster(bytes: Uint8Array, mime: ImageSource['mime']): boolean { return safeRasterPixelCount(bytes, mime) > 0 }

type GlbCheck = { ok: true } | { ok: false, reason: 'invalid' | 'external-resource' | 'unsupported-decoder' }
const unsupportedGlbDecoders = new Set(['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'])

function decodeEmbeddedUri(uri: string): { mime: string, bytes: Uint8Array } | undefined {
  const match = /^data:(image\/png|image\/jpeg|application\/octet-stream|application\/gltf-buffer);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(uri)
  if (!match || match[2]!.length % 4 !== 0) return undefined
  try {
    const decoded = atob(match[2]!)
    if (decoded.length > MAX_GLB_BYTES) return undefined
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
    return { mime: match[1]!.toLowerCase(), bytes }
  } catch { return undefined }
}

/** Only self-contained GLB v2 models reach Three: no external URLs or remote decoders. */
export function inspectGlb(bytes: Uint8Array): GlbCheck {
  const fail = (reason: Extract<GlbCheck, { ok: false }>['reason']): GlbCheck => ({ ok: false, reason })
  if (bytes.length < 20 || bytes.length > MAX_GLB_BYTES || bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) return fail('invalid')
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.length) return fail('invalid')
  let offset = 12, jsonBytes: Uint8Array | undefined, binBytes: Uint8Array | undefined
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return fail('invalid')
    const length = header.getUint32(offset, true), type = header.getUint32(offset + 4, true)
    offset += 8
    if (length % 4 !== 0 || length > bytes.length - offset) return fail('invalid')
    if (!jsonBytes && type === 0x4e4f534a && length > 0) jsonBytes = bytes.subarray(offset, offset + length)
    else if (jsonBytes && !binBytes && type === 0x004e4942) binBytes = bytes.subarray(offset, offset + length)
    else return fail('invalid')
    offset += length
  }
  if (!jsonBytes || offset !== bytes.length) return fail('invalid')
  let document: unknown
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)) } catch { return fail('invalid') }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return fail('invalid')
  const root = document as Record<string, unknown>, asset = root.asset
  if (!asset || typeof asset !== 'object' || Array.isArray(asset) || (asset as Record<string, unknown>).version !== '2.0') return fail('invalid')

  // Reject URI references anywhere, including extensions and extras; only inline base64 data is allowed.
  const pending: unknown[] = [root]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object') continue
    for (const [key, value] of Object.entries(current)) {
      if (unsupportedGlbDecoders.has(key)) return fail('unsupported-decoder')
      if ((key === 'extensionsUsed' || key === 'extensionsRequired') && Array.isArray(value)
        && value.some(extension => typeof extension === 'string' && unsupportedGlbDecoders.has(extension))) return fail('unsupported-decoder')
      if (key === 'uri' && (typeof value !== 'string' || !/^data:(?:image\/png|image\/jpeg|application\/octet-stream|application\/gltf-buffer);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value))) return fail('external-resource')
      if (value && typeof value === 'object') pending.push(value)
    }
  }

  const bufferDefs = root.buffers === undefined ? [] : root.buffers
  const viewDefs = root.bufferViews === undefined ? [] : root.bufferViews
  const imageDefs = root.images === undefined ? [] : root.images
  if (!Array.isArray(bufferDefs) || !Array.isArray(viewDefs) || !Array.isArray(imageDefs)) return fail('invalid')
  const buffers: Uint8Array[] = []
  for (let i = 0; i < bufferDefs.length; i++) {
    const entry = bufferDefs[i]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('invalid')
    const item = entry as Record<string, unknown>, declared = item.byteLength
    if (!Number.isSafeInteger(declared) || (declared as number) < 0) return fail('invalid')
    let contents: Uint8Array | undefined
    if (item.uri === undefined) {
      if (i !== 0 || !binBytes) return fail('invalid')
      contents = binBytes
      if (contents.length < (declared as number) || contents.length - (declared as number) > 3) return fail('invalid')
    } else {
      if (typeof item.uri !== 'string') return fail('invalid')
      const inline = decodeEmbeddedUri(item.uri)
      if (!inline || !['application/octet-stream', 'application/gltf-buffer'].includes(inline.mime)) return fail('invalid')
      contents = inline.bytes
      if (contents.length !== declared) return fail('invalid')
    }
    buffers.push(contents.subarray(0, declared as number))
  }
  const views: Uint8Array[] = []
  let totalViewBytes = 0
  for (const entry of viewDefs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('invalid')
    const item = entry as Record<string, unknown>, index = item.buffer, start = item.byteOffset ?? 0, length = item.byteLength
    if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= buffers.length
      || !Number.isSafeInteger(start) || (start as number) < 0 || !Number.isSafeInteger(length) || (length as number) < 0) return fail('invalid')
    const buffer = buffers[index as number]!
    if ((start as number) > buffer.length || (length as number) > buffer.length - (start as number)) return fail('invalid')
    // Three slices each requested bufferView, even when multiple views overlap.
    if ((length as number) > MAX_GLB_BUFFER_VIEW_BYTES - totalViewBytes) return fail('invalid')
    totalViewBytes += length as number
    views.push(buffer.subarray(start as number, (start as number) + (length as number)))
  }

  // Count the decoded attributes (and sparse copies) before GLTFLoader allocates typed arrays.
  const accessors = root.accessors === undefined ? [] : root.accessors
  if (!Array.isArray(accessors)) return fail('invalid')
  const componentBytes: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const typeSizes: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  let decodedBytes = 0
  const charge = (amount: number): boolean => {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_GLB_ACCESSOR_BYTES - decodedBytes) return false
    decodedBytes += amount
    return true
  }
  const indexValid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < views.length
  for (const entry of accessors) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('invalid')
    const item = entry as Record<string, unknown>, count = item.count, component = item.componentType, type = item.type
    if (!Number.isSafeInteger(count) || (count as number) < 0 || typeof component !== 'number' || !Object.hasOwn(componentBytes, component)
      || typeof type !== 'string' || !Object.hasOwn(typeSizes, type)) return fail('invalid')
    const elementBytes = componentBytes[component]!, itemBytes = typeSizes[type]! * elementBytes, total = (count as number) * itemBytes
    const byteOffset = item.byteOffset ?? 0
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(byteOffset) || (byteOffset as number) < 0 || (byteOffset as number) % elementBytes !== 0) return fail('invalid')
    let baseCost = total
    if (item.bufferView !== undefined) {
      if (!indexValid(item.bufferView)) return fail('invalid')
      const view = views[item.bufferView]!, viewDefinition = viewDefs[item.bufferView] as Record<string, unknown>
      const stride = viewDefinition.byteStride
      if (stride !== undefined) {
        if (!Number.isSafeInteger(stride) || (stride as number) < itemBytes || (stride as number) > 252
          || (stride as number) % elementBytes !== 0 || (byteOffset as number) % (stride as number) + itemBytes > (stride as number)) return fail('invalid')
        baseCost = (count as number) * (stride as number)
        const start = Math.floor((byteOffset as number) / (stride as number)) * (stride as number)
        if (!Number.isSafeInteger(baseCost) || start > view.length || baseCost > view.length - start) return fail('invalid')
      } else if ((byteOffset as number) > view.length || total > view.length - (byteOffset as number)) return fail('invalid')
    } else if (byteOffset !== 0) return fail('invalid')
    if (!charge(baseCost)) return fail('invalid')
    if (item.sparse !== undefined) {
      if (!item.sparse || typeof item.sparse !== 'object' || Array.isArray(item.sparse)) return fail('invalid')
      const sparse = item.sparse as Record<string, unknown>, sparseCount = sparse.count
      if (!Number.isSafeInteger(sparseCount) || (sparseCount as number) < 0 || (sparseCount as number) > (count as number)
        || !sparse.indices || typeof sparse.indices !== 'object' || Array.isArray(sparse.indices)
        || !sparse.values || typeof sparse.values !== 'object' || Array.isArray(sparse.values)) return fail('invalid')
      const indices = sparse.indices as Record<string, unknown>, values = sparse.values as Record<string, unknown>
      const indexSize = typeof indices.componentType === 'number' && [5121, 5123, 5125].includes(indices.componentType) ? componentBytes[indices.componentType] : undefined
      if (!indexSize || !indexValid(indices.bufferView) || !indexValid(values.bufferView)) return fail('invalid')
      const indexOffset = indices.byteOffset ?? 0, valueOffset = values.byteOffset ?? 0
      const indicesBytes = (sparseCount as number) * indexSize, valuesBytes = (sparseCount as number) * itemBytes
      if (!Number.isSafeInteger(indexOffset) || (indexOffset as number) < 0 || (indexOffset as number) % indexSize !== 0
        || !Number.isSafeInteger(valueOffset) || (valueOffset as number) < 0 || (valueOffset as number) % elementBytes !== 0
        || !Number.isSafeInteger(indicesBytes) || !Number.isSafeInteger(valuesBytes)
        || (indexOffset as number) > views[indices.bufferView]!.length || indicesBytes > views[indices.bufferView]!.length - (indexOffset as number)
        || (valueOffset as number) > views[values.bufferView]!.length || valuesBytes > views[values.bufferView]!.length - (valueOffset as number)) return fail('invalid')
      if (!charge(indicesBytes) || !charge(valuesBytes) || (item.bufferView !== undefined && !charge(baseCost))) return fail('invalid')
    }
  }
  let textureBytes = 0
  for (const entry of imageDefs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('invalid')
    const item = entry as Record<string, unknown>
    let contents: Uint8Array | undefined, mime: string | undefined
    if (item.bufferView !== undefined) {
      if (item.uri !== undefined || !Number.isSafeInteger(item.bufferView) || (item.bufferView as number) < 0 || (item.bufferView as number) >= views.length) return fail('invalid')
      contents = views[item.bufferView as number]; mime = typeof item.mimeType === 'string' ? item.mimeType.toLowerCase() : undefined
    } else {
      if (typeof item.uri !== 'string') return fail('invalid')
      const inline = decodeEmbeddedUri(item.uri)
      if (!inline) return fail('invalid')
      contents = inline.bytes; mime = inline.mime
      if (item.mimeType !== undefined && (typeof item.mimeType !== 'string' || item.mimeType.toLowerCase() !== mime)) return fail('invalid')
    }
    if (!contents || (mime !== 'image/png' && mime !== 'image/jpeg')) return fail('invalid')
    const pixels = safeRasterPixelCount(contents, mime)
    if (!pixels || pixels * 4 > MAX_GLB_TEXTURE_BYTES - textureBytes) return fail('invalid')
    textureBytes += pixels * 4
  }
  return { ok: true }
}

export function isGlb(bytes: Uint8Array): boolean { return inspectGlb(bytes).ok }

/** Stop reading as soon as the model exceeds the memory limit, even without a length header. */
export async function readGlbResponse(response: Response, limit = MAX_GLB_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > limit) { await response.body?.cancel(); throw new Error('模型超出可处理大小') }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw new Error('模型超出可处理大小')
    return bytes
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) { await reader.cancel(); throw new Error('模型超出可处理大小') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function safeAssetUrl(reference: string, mime?: ImageSource['mime']): string {
  const url = new URL(reference, window.location.href)
  const location = window.location
  const local = url.protocol === location.protocol && url.host === location.host
  if (url.protocol === 'data:') {
    const declared = /^data:([^;,]+)(?:;|,)/i.exec(url.href)?.[1]?.toLowerCase()
    if (mime ? declared !== mime : !['model/gltf-binary', 'application/octet-stream'].includes(declared ?? '')) throw new Error('来源地址不受支持')
  }
  if (!(local || url.protocol === 'https:' || url.protocol === 'blob:' || url.protocol === 'data:')) throw new Error('模型地址不受支持')
  return url.href
}

/** Render a derived view only beside the intact structured source. */
export function CanvasObjectView({ value, source, dark, isStreaming = false, originalView }: { value: unknown, source: ObjectSource, dark: boolean, isStreaming?: boolean, originalView?: ReactNode }): ReactElement {
  const loadEffect = useContext(CanvasRuntimeContext)
  const selectedTheme = usePresentationTheme()
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const currentEffect = useRef<CanvasEffectInstance | null>(null), rotateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(value); latest.current = value
  const imageSource = source.kind === 'image' ? source : undefined
  const hasOriginalView = originalView !== undefined && originalView !== null
  const [image, setImage] = useState<{ reference: string, mime: ImageSource['mime'], url: string } | undefined>()
  const [imageError, setImageError] = useState('')
  const [imageRetry, setImageRetry] = useState(0)
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  // Infer a model's domain only while its effect can run; images use the
  // selected ASCII theme or the existing Ink default without domain inference.
  const domain = useMemo(() => imageSource || isStreaming || !visible || !pageVisible || reduced ? 'general' : modelDomain(value), [value, !!imageSource, isStreaming, visible, pageVisible, reduced])
  const composition = useCompositionSelection()
  const gpuAscii = isGpuAsciiTheme(selectedTheme)
  const component = composition && composition.objectEffect !== 'auto' ? composition.objectEffect : gpuAscii ? 'ascii-object' : imageSource ? 'ink-object' : domainEffects[domain]
  const [status, setStatus] = useState(imageSource ? '正在准备插画效果…' : '正在准备模型视图…')
  const [canRotate, setCanRotate] = useState(false)
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)

  // Keep the source illustration independently of the optional animated effect, including reduced-motion mode.
  useEffect(() => {
    if (!imageSource || isStreaming || !visible || (reduced && hasOriginalView)) {
      setImage(undefined)
      setImageError('')
      return
    }
    const controller = new AbortController()
    let live = true, objectUrl = ''
    setImage(undefined)
    setImageError('')
    void (async () => {
      try {
        if (!latest.current || typeof latest.current !== 'object' || !Object.hasOwn(latest.current, imageSource.field)
          || (latest.current as Record<string, unknown>)[imageSource.field] !== imageSource.reference) throw new Error('插画与原始来源不匹配')
        const response = await fetch(safeAssetUrl(imageSource.reference, imageSource.mime), { signal: controller.signal, credentials: 'same-origin', redirect: 'error' })
          .catch(() => { throw new Error('插画读取失败，请检查地址或网络') })
        if (!response.ok) throw new Error(`插画读取失败（${response.status}）`)
        let bytes: Uint8Array<ArrayBuffer>
        try { bytes = await readGlbResponse(response, MAX_IMAGE_BYTES) } catch (error) {
          if (error instanceof Error && error.message === '模型超出可处理大小') throw new Error('插画超出可处理大小')
          throw error
        }
        if (!isSafeRaster(bytes, imageSource.mime)) throw new Error('插画格式或尺寸不受支持')
        if (!live) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageSource.mime }))
        setImage({ reference: imageSource.reference, mime: imageSource.mime, url: objectUrl })
      } catch (error) {
        if (live && !controller.signal.aborted) {
          const detail = error instanceof Error && /^(?:插画|来源地址)/.test(error.message) ? error.message : '插画暂时无法读取'
          setImageError(`${detail}，仍可打开原始来源。`)
        }
      }
    })()
    return () => { live = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [imageSource?.field, imageSource?.reference, imageSource?.mime, isStreaming, visible, imageRetry, reduced, hasOriginalView])
  const verifiedImage = imageSource && image?.reference === imageSource.reference && image.mime === imageSource.mime ? image : undefined

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(!!media?.matches)
    const visibility = () => setPageVisible(document.visibilityState === 'visible')
    media?.addEventListener?.('change', change)
    document.addEventListener('visibilitychange', visibility)
    return () => { media?.removeEventListener?.('change', change); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    const target = container.current
    if (!target || isStreaming) { setVisible(false); return }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [isStreaming])

  useEffect(() => {
    const target = canvas.current
    if (!target || !visible || !pageVisible || isStreaming || reduced || component === 'none' || (imageSource && (!verifiedImage || imageError))) return
    let live = true, effectFailed = false, objectUrl = '', instance: CanvasEffectInstance | null = null, release = () => {}
    const controller = new AbortController()
    const discard = () => {
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      rotateTimer.current = undefined
      if (currentEffect.current === instance) currentEffect.current = null
      instance?.destroy(); instance = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = ''; release()
    }
    release = acquireCanvasSlot(() => {
      // A pool grant can be synchronous; wait until `release` is assigned.
      void Promise.resolve().then(async () => {
        if (!live) return
        try {
          setFailed(false)
          setStatus(imageSource ? '正在准备插画效果…' : '正在准备模型视图…')
          const gl = target.getContext('webgl2')
          if (!gl) throw new Error('当前设备不支持 WebGL 2')
          let src: string
          if (imageSource && verifiedImage) src = verifiedImage.url
          else {
            const response = await fetch(safeAssetUrl(source.reference), { signal: controller.signal, credentials: 'same-origin', redirect: 'error' })
              .catch(() => { throw new Error('模型读取失败，请检查地址或网络') })
            if (!response.ok) throw new Error(`模型读取失败（${response.status}）`)
            const bytes = await readGlbResponse(response)
            const inspection = inspectGlb(bytes)
            if (!inspection.ok) throw new Error(inspection.reason === 'external-resource'
              ? '模型包含外部资源，暂无法安全展示'
              : inspection.reason === 'unsupported-decoder'
                ? '模型需要不受支持的压缩解码器，暂无法安全展示'
                : '来源不是有效的内嵌资源 GLB 模型')
            if (!live) return
            objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
            src = objectUrl
          }
          if (!live) return
          const factory = await loadEffect(component)
          if (!live) return
          const kind = imageSource ? 'image' : 'glb'
          const plan = planCanvasEffect({ source: latest.current, target: { kind: 'asset' }, assets: [{ kind, sourceRef: source.reference, resolved: true, sourcePath: [source.field] }], providers: [{ id: `upstream-${component}-webgl`, component, renderer: 'webgl', inputs: [kind] }], capabilities: { webgl2: true }, domain })
          if (plan.status !== 'selected') throw new Error('模型与原始来源不匹配')
          const created = factory({ canvas: target }, { src, ...objectEffectAppearance(component, dark, !!imageSource, gpuAscii), background: '', orbit: true, zoom: false, onLoad: () => { if (live && !effectFailed) setStatus('') }, onError: () => { if (live) { effectFailed = true; setFailed(true); setCanRotate(false); setStatus(imageSource ? '插画效果无法显示，原图仍可查看。' : '模型无法显示，原始内容仍可查看。'); discard() } } })
          if (!created) throw new Error('模型效果无法初始化')
          if (effectFailed || !live) created.destroy()
          else { instance = created; currentEffect.current = created; setCanRotate(typeof created.setOptions === 'function') }
        } catch (error) {
          if (live && !controller.signal.aborted) {
            const detail = error instanceof Error && /^(?:模型|当前设备|来源不是)/.test(error.message) ? error.message : '组件加载失败，请检查网络后重试'
            setFailed(true); setCanRotate(false); setStatus(`动态效果暂不可用：${detail}。原始内容仍可查看。`)
          }
          discard()
        }
      })
    })
    return () => { live = false; controller.abort(); discard() }
  }, [source.field, source.reference, imageSource?.mime, verifiedImage?.url, imageError, component, gpuAscii, domain, dark, visible, pageVisible, isStreaming, reduced, retry, loadEffect])

  const rotate = (direction: number) => {
    const effect = currentEffect.current
    if (!effect?.setOptions) return
    if (rotateTimer.current) clearTimeout(rotateTimer.current)
    effect.setOptions({ autoRotate: true, autoRotateSpeed: direction * 6 })
    rotateTimer.current = setTimeout(() => { if (currentEffect.current === effect) effect.setOptions?.({ autoRotate: false }) }, 700)
  }
  let originalUrl: string | undefined
  try { originalUrl = typeof window === 'undefined' ? undefined : safeAssetUrl(source.reference, imageSource?.mime) } catch { /* raw source is still shown by the caller */ }
  const effectView = h('div', { role: 'figure', className: 'iexp-canvas-object', 'aria-label': imageSource ? '根据原始插画生成的效果视图，原图和记录仍可查看' : '根据原始模型生成的图形视图，原始记录在下方', hidden: reduced || isStreaming || component === 'none' || (!!imageSource && !!imageError), style: { position: 'relative', minWidth: 0, borderRadius: 'var(--iexp-card-radius)', overflow: 'hidden', background: 'var(--iexp-soft)', ...(imageSource ? { flex: '1 1 200px', aspectRatio: '1 / 1', minHeight: 200, maxHeight: 300 } : { height: 300 }) } },
      h('canvas', { ref: canvas, 'aria-hidden': true, style: { display: 'block', width: '100%', height: 'calc(100% - 40px)', marginTop: 40, touchAction: 'none' } }),
      !status && h('span', { style: { position: 'absolute', inset: '12px auto auto 12px', color: 'var(--iexp-muted)', fontSize: 12, pointerEvents: 'none' } }, '拖动旋转'),
      !status && canRotate && h('div', { role: 'group', 'aria-label': imageSource ? '插画效果旋转' : '模型旋转', style: { position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 } },
        h(ThemeButton, { type: 'button', 'aria-label': imageSource ? '向左旋转插画效果' : '向左旋转模型', onClick: () => rotate(-1), style: { minHeight: 32, padding: '4px 8px' } }, '左转'),
        h(ThemeButton, { type: 'button', 'aria-label': imageSource ? '向右旋转插画效果' : '向右旋转模型', onClick: () => rotate(1), style: { minHeight: 32, padding: '4px 8px' } }, '右转')),
      status && h('div', { style: { position: 'absolute', inset: 'auto 12px 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
        h('p', { role: 'status', style: { margin: 0, fontSize: 12 } }, status),
        failed && h(ThemeButton, { type: 'button', onClick: () => setRetry(value => value + 1), style: { minHeight: 32, padding: '4px 8px' } }, '重试')))
  const originalAlt = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).alt === 'string'
    ? (value as Record<string, string>).alt : '原始插画'
  const originalTitle = value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).title === 'string'
    ? (value as Record<string, string>).title : undefined
  const originalImage = originalView ?? (verifiedImage && !imageError && h('img', { src: verifiedImage.url, alt: originalAlt, title: originalTitle, onError: () => setImageError('插画解码失败，仍可打开原始来源。'), style: { display: 'block', width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: 260, objectFit: 'contain' } }))
  const sourceImage = imageSource && originalImage && h('figure', { 'data-iexp-ascii-original': true, style: { flex: '1 1 200px', minWidth: 0, margin: 0 } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', width: '100%', maxHeight: 300, padding: 16, background: 'var(--iexp-soft)', borderRadius: 'var(--iexp-card-radius)' } }, originalImage),
    h('figcaption', { style: { marginTop: 6, color: 'var(--iexp-muted)', fontSize: 12 } }, '原图'))
  const download = imageSource ? (imageSource.mime === 'image/png' ? 'illustration.png' : 'illustration.jpg') : 'model.glb'
  return h('div', { ref: container },
    imageSource ? h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'start', gap: 12 } }, effectView, sourceImage) : effectView,
    imageError && h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' } },
      h('p', { role: 'status', style: { margin: 0, fontSize: 12 } }, imageError),
      h(ThemeButton, { type: 'button', onClick: () => setImageRetry(value => value + 1), style: { minHeight: 32, padding: '4px 8px' } }, '重试')),
    originalUrl && h('p', { style: { margin: '8px 0', fontSize: 12 } }, h('a', { className: 'iexp-model-source-link', href: originalUrl, ...(originalUrl.startsWith('data:') || originalUrl.startsWith('blob:') ? { download } : { target: '_blank', rel: 'noopener noreferrer' }) }, imageSource ? '打开原始插画' : '打开原始模型')))
}
