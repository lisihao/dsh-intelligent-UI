import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import { acquireCanvasSlot, loadCanvasEffect, type CanvasEffectInstance } from './canvas-runtime-client.js'
import { planCanvasEffect, type EffectDomain } from './effect-planner.js'
import { ThemeButton } from './theme-components.js'

interface GlbSource { field: string, reference: string }
const glbTypes = new Set(['glb', 'model/gltf-binary'])
const MAX_GLB_BYTES = 64 * 1024 * 1024
const domainEffects: Readonly<Record<EffectDomain, string>> = Object.freeze({
  'technical-insight': 'ink-object', coding: 'ascii-object',
  'project-management': 'glass-object', quantitative: 'ink-object', general: 'ink-object',
})

/** A domain is used only when the actual source supplies a recognized domain. */
export function modelDomain(value: unknown): EffectDomain {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'general'
  const domain = (value as { domain?: unknown }).domain
  return typeof domain === 'string' && Object.hasOwn(domainEffects, domain) ? domain as EffectDomain : 'general'
}

/** Upstream object effects use different material/color controls. */
function objectEffectAppearance(component: string, dark: boolean): Record<string, unknown> {
  const color = dark ? '#d5e2e9' : '#1e2c32'
  if (component === 'ink-object') return { inkColor: color }
  if (component === 'ascii-object') return { colored: false, color, cellSize: 9, exposure: 2 }
  return {}
}

/** Only explicit source-owned 3D models are transformed; ordinary images stay unchanged. */
export function glbSource(value: unknown): GlbSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const type = [record.mimeType, record.mediaType, record.format, record.type].find(item => typeof item === 'string' && glbTypes.has(item.toLowerCase()))
  if (!type) return undefined
  const field = ['url', 'src', 'uri', 'href'].find(key => typeof record[key] === 'string' && (record[key] as string).trim())
  return field ? { field, reference: record[field] as string } : undefined
}

export function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || bytes.length > MAX_GLB_BYTES || bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) return false
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return header.getUint32(4, true) === 2 && header.getUint32(8, true) === bytes.length
}

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

function safeAssetUrl(reference: string): string {
  const url = new URL(reference, window.location.href)
  const location = window.location
  const local = url.protocol === location.protocol && url.host === location.host
  if (url.protocol === 'data:' && !/^data:(?:model\/gltf-binary|application\/octet-stream)(?:;|,)/i.test(url.href)) throw new Error('模型地址不受支持')
  if (!(local || url.protocol === 'https:' || url.protocol === 'blob:' || url.protocol === 'data:')) throw new Error('模型地址不受支持')
  return url.href
}

/** Render a derived view only beside the intact structured source. */
export function CanvasObjectView({ value, source, dark, isStreaming = false }: { value: unknown, source: GlbSource, dark: boolean, isStreaming?: boolean }): ReactElement {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const currentEffect = useRef<CanvasEffectInstance | null>(null), rotateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(value); latest.current = value
  const domain = modelDomain(value), component = domainEffects[domain]
  const [visible, setVisible] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [status, setStatus] = useState('正在准备模型视图…')
  const [canRotate, setCanRotate] = useState(false)
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)

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
    if (!target || isStreaming || reduced) { setVisible(false); return }
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [isStreaming, reduced])

  useEffect(() => {
    const target = canvas.current
    if (!target || !visible || !pageVisible || isStreaming || reduced) return
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
          setStatus('正在准备模型视图…')
          const gl = target.getContext('webgl2')
          if (!gl) throw new Error('当前设备不支持 WebGL 2')
          const url = safeAssetUrl(source.reference)
          const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' })
          if (!response.ok) throw new Error(`模型读取失败（${response.status}）`)
          const bytes = await readGlbResponse(response)
          if (!isGlb(bytes)) throw new Error('来源不是有效的 GLB 模型')
          if (!live) return
          const factory = await loadCanvasEffect(component)
          if (!live) return
          const plan = planCanvasEffect({ source: latest.current, target: { kind: 'asset' }, assets: [{ kind: 'glb', sourceRef: source.reference, resolved: true, sourcePath: [source.field] }], providers: [{ id: `upstream-${component}-webgl`, component, renderer: 'webgl', inputs: ['glb'] }], capabilities: { webgl2: true }, domain })
          if (plan.status !== 'selected') throw new Error('模型与原始来源不匹配')
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }))
          const created = factory({ canvas: target }, { src: objectUrl, ...objectEffectAppearance(component, dark), background: '', orbit: true, zoom: false, onLoad: () => { if (live && !effectFailed) setStatus('') }, onError: () => { if (live) { effectFailed = true; setFailed(true); setCanRotate(false); setStatus('模型无法显示，原始内容仍可查看。'); discard() } } })
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
  }, [source.field, source.reference, component, domain, dark, visible, pageVisible, isStreaming, reduced, retry])

  const rotate = (direction: number) => {
    const effect = currentEffect.current
    if (!effect?.setOptions) return
    if (rotateTimer.current) clearTimeout(rotateTimer.current)
    effect.setOptions({ autoRotate: true, autoRotateSpeed: direction * 6 })
    rotateTimer.current = setTimeout(() => { if (currentEffect.current === effect) effect.setOptions?.({ autoRotate: false }) }, 700)
  }
  let originalUrl: string | undefined
  try { originalUrl = typeof window === 'undefined' ? undefined : safeAssetUrl(source.reference) } catch { /* raw source is still shown by the caller */ }
  return h('div', null,
    h('div', { ref: container, role: 'figure', className: 'iexp-canvas-object', 'aria-label': '根据原始模型生成的图形视图，原始记录在下方', hidden: reduced || isStreaming, style: { position: 'relative', height: 300, minWidth: 0, borderRadius: 'var(--iexp-card-radius)', overflow: 'hidden', background: 'var(--iexp-soft)' } },
      h('canvas', { ref: canvas, 'aria-hidden': true, style: { display: 'block', width: '100%', height: '100%', touchAction: 'none' } }),
      !status && h('span', { style: { position: 'absolute', inset: '12px auto auto 12px', color: 'var(--iexp-muted)', fontSize: 12, pointerEvents: 'none' } }, '拖动或使用按钮旋转'),
      !status && canRotate && h('div', { role: 'group', 'aria-label': '模型旋转', style: { position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 } },
        h(ThemeButton, { type: 'button', 'aria-label': '向左旋转模型', onClick: () => rotate(-1), style: { minHeight: 32, padding: '4px 8px' } }, '左转'),
        h(ThemeButton, { type: 'button', 'aria-label': '向右旋转模型', onClick: () => rotate(1), style: { minHeight: 32, padding: '4px 8px' } }, '右转')),
      status && h('div', { style: { position: 'absolute', inset: 'auto 12px 8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
        h('p', { role: 'status', style: { margin: 0, fontSize: 12 } }, status),
        failed && h(ThemeButton, { type: 'button', onClick: () => setRetry(value => value + 1), style: { minHeight: 32, padding: '4px 8px' } }, '重试'))),
    originalUrl && h('p', { style: { margin: '8px 0', fontSize: 12 } }, h('a', { className: 'iexp-model-source-link', href: originalUrl, ...(originalUrl.startsWith('data:') || originalUrl.startsWith('blob:') ? { download: 'model.glb' } : { target: '_blank', rel: 'noopener noreferrer' }) }, '打开原始模型')))
}
