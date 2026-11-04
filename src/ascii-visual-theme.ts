import type { ExperienceSettings } from './contracts.js'
import { isGpuAsciiTheme, resolveTheme } from './theme-contracts.js'
import { appearanceTokens } from './appearance.js'
import { acquireCanvasSlot, type CanvasEffectFactory } from './canvas-runtime-client.js'
import { createAsciiGpuEffect, type AsciiGpuEffect } from './ascii-gpu-effect.js'
import { captureAsciiVisual, measureAsciiVisualBounds, type AsciiVisualCapture } from './ascii-visual-capture.js'
import { readAsciiVisualFrame, subscribeAsciiVisualFrames } from './ascii-visual-frames.js'

type Source = SVGSVGElement | HTMLImageElement | HTMLCanvasElement
type Store = { snapshot(): { settings?: ExperienceSettings; appearancePreview?: ExperienceSettings['appearance'] }; subscribe(listener: () => void): () => void }
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type Entry = { source: Source; capture?: AsciiVisualCapture; origin?: DOMRect; dirty: boolean; epoch: number; marks: Map<Element, string | null>; failed?: string; inspecting?: boolean; pointer?: boolean; focused?: boolean; nativeOpacity?: string }
const MARK = 'data-iexp-ascii-paint'
const ROOTS = '.dsh-experience,[data-dsh-thoughtdag],[data-slot="conversation.view"]'
const EXCLUDED = '[data-iexp-ascii-overlay],[data-iexp-ascii-original]'
const SHAPES = 'path,rect,circle,ellipse,line,polyline,polygon,use,image'

/** A disposable graphics projection. Native text, data, DOM hit targets and source state stay owned by their original renderer. */
export function installAsciiVisualTheme(store: Store, options: { document?: Document; loadFactory?: (slug: string) => Promise<CanvasEffectFactory> } = {}): () => void {
  const doc = options.document ?? document, win = doc.defaultView
  if (!win || !doc.body) return () => {}
  let stop: (() => void) | undefined, key = '', disposed = false
  const sync = () => {
    if (disposed) return
    const snapshot = store.snapshot(), settings = snapshot.settings, theme = resolveTheme(settings?.theme)
    const background = appearanceTokens(snapshot.appearancePreview ?? settings?.appearance, theme).variables['--iexp-solid-bg']!
    const next = settings?.takeover && isGpuAsciiTheme(theme) && !doc.hidden ? background : ''
    if (next === key) return
    stop?.(); stop = undefined; key = next
    if (next) stop = run(next)
  }
  function run(background: string): () => void {
    const abort = new AbortController(), entries = new Map<Source, Entry>()
    const overlay = doc.createElement('div'), stage = doc.createElement('div'), style = doc.createElement('style'), status = doc.createElement('div')
    overlay.dataset.iexpAsciiOverlay = 'true'; overlay.setAttribute('aria-hidden', 'true')
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:100;overflow:hidden;visibility:hidden'
    stage.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0'
    status.className = 'dsh-experience iexp-ascii-status'
    status.setAttribute('role', 'status'); status.dataset.iexpAsciiStatus = 'true'
    status.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:min(360px,90%);pointer-events:none;z-index:101;padding:8px 12px;border-radius:8px;background:var(--iexp-solid-bg);color:var(--iexp-text);font:12px/1.5 var(--iexp-font,system-ui);display:none'
    style.textContent = `[${MARK}="true"]{opacity:0!important}[${MARK}="flow-underlay"]{opacity:.7!important}`
    overlay.append(stage); doc.body.append(overlay, status); doc.head.append(style)
    let effect: AsciiGpuEffect | undefined, queued = false, running = false, again = false, closed = false, failed = false, revision = 0
    let pending: { revision: number; items: { entry: Entry; epoch: number; box: Box }[] } | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let geometryEpoch = 0
    let scale = 1, width = 0, height = 0, releaseSlot: (() => void) | undefined
    const unsubscribeFrames = subscribeAsciiVisualFrames(doc)
    const requestedFrames = new WeakMap<HTMLCanvasElement, string>()
    const frameFailures = new Map<HTMLCanvasElement, string>()
    const restore = (entry: Entry) => {
      for (const [node, value] of entry.marks) { if (value === null) node.removeAttribute(MARK); else node.setAttribute(MARK, value) }
      entry.marks.clear()
    }
    const invalidate = (entry: Entry) => { restore(entry); entry.epoch++; entry.dirty = true; entry.failed = undefined }
    // Fine semantic connections must not disappear between character samples.
    // Retain their original geometry beneath the transparent glyph projection.
    const paintMark = (entry: Entry, node: Element) => entry.source.closest('.iexp-flow') && node.matches('path.react-flow__edge-path') ? 'flow-underlay' : 'true'
    const hide = (entry: Entry) => {
      if (!entry.marks.size) entry.nativeOpacity = win!.getComputedStyle(entry.source).opacity
      const nodes = entry.source.localName === 'svg' ? [...entry.source.querySelectorAll(SHAPES)].filter(node => !node.closest('defs,clipPath,mask,marker,symbol')) : [entry.source]
      for (const node of nodes) { if (!entry.marks.has(node)) entry.marks.set(node, node.getAttribute(MARK)); node.setAttribute(MARK, paintMark(entry, node)) }
    }
    const measured = (source: Source): DOMRect => {
      const entry = entries.get(source), marks = entry?.marks
      if (marks) for (const [node, value] of marks) { if (value === null) node.removeAttribute(MARK); else node.setAttribute(MARK, value) }
      try { return measureAsciiVisualBounds(source) } finally { if (marks && entry) for (const node of marks.keys()) node.setAttribute(MARK, paintMark(entry, node)) }
    }
    const visibleBox = (source: Element): Box | undefined => {
      if (source.closest(EXCLUDED)) return
      let rect: DOMRect
      try { rect = measured(source as Source) } catch { return }
      const css = win!.getComputedStyle(source)
      const entry = entries.get(source as Source), opacity = entry?.marks.has(source) ? entry.nativeOpacity : css.opacity
      if (opacity && Number(opacity) !== 1) return
      if (rect.width < 2 || rect.height < 2 || source.localName === 'svg' && rect.width <= 32 && rect.height <= 32 || css.display === 'none' || css.visibility === 'hidden') return
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(win!.innerWidth, rect.right), bottom = Math.min(win!.innerHeight, rect.bottom)
      for (let parent = source.parentElement; parent; parent = parent.parentElement) {
        const p = win!.getComputedStyle(parent)
        if (p.display === 'none' || p.visibility === 'hidden' || p.opacity && Number(p.opacity) !== 1) return
        const box = parent.getBoundingClientRect()
        if (/(hidden|clip|auto|scroll)/.test(p.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right) }
        if (/(hidden|clip|auto|scroll)/.test(p.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
      }
      if (right <= left || bottom <= top) return
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }
    const clip = (items: { entry: Entry; epoch: number; box: Box }[]) => {
      const valid = items.filter(item => item.epoch === item.entry.epoch && item.entry.source.isConnected && item.entry.marks.size)
      const path = valid.map(({ box: b }) => `M${b.left},${b.top}H${b.right}V${b.bottom}H${b.left}Z`).join(' ')
      overlay.style.clipPath = path ? `path("${path}")` : 'inset(100%)'
      overlay.style.visibility = valid.length ? 'visible' : 'hidden'
      overlay.dataset.asciiTargets = String(valid.length)
    }
    let committed: { entry: Entry; epoch: number; box: Box }[] = []
    const hasPopup = () => [...doc.querySelectorAll('[role=menu],[role=dialog],[role=tooltip],[role=listbox],[aria-modal=true],dialog[open],[data-radix-popper-content-wrapper]')].some(node => {
      if (node.closest('[data-iexp-ascii-overlay]') || node.getAttribute('aria-hidden') === 'true') return false
      const rect = node.getBoundingClientRect(), css = win!.getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden'
    })
    const report = (error: unknown) => {
      if (closed || failed) return
      failed = true; abort.abort(); clearTimeout(refreshTimer)
      for (const entry of entries.values()) restore(entry)
      committed = []; pending = undefined; clip([])
      status.textContent = 'ASCII 图形渲染暂不可用，已保留原图。可切换风格后重试。'; status.style.display = 'block'
      try { effect?.dispose() } catch (cleanupError) { console.error('Intelligent UI ASCII cleanup:', cleanupError) }
      releaseSlot?.(); releaseSlot = undefined; unsubscribeFrames()
      console.error('Intelligent UI ASCII:', error)
    }
    const discover = () => {
      const sources = [...doc.querySelectorAll<Source>(`${ROOTS.split(',').map(root => `${root} svg,${root} img,${root} canvas`).join(',')}`)].filter(node =>
        !node.closest(EXCLUDED) && !(node.localName === 'svg' && node.parentElement?.closest('svg')) &&
        (node.localName !== 'canvas' || readAsciiVisualFrame(node as HTMLCanvasElement)))
      // Ask owned graph renderers for their first frame when the style is enabled late.
      for (const canvas of doc.querySelectorAll<HTMLCanvasElement>(`${ROOTS.split(',').map(root => `${root} canvas`).join(',')}`)) {
        const size = `${canvas.width}x${canvas.height}`
        if (!readAsciiVisualFrame(canvas) && !canvas.closest(EXCLUDED) && requestedFrames.get(canvas) !== size) {
          requestedFrames.set(canvas, size)
          canvas.dispatchEvent(new Event('iexp:visual-frame-request'))
        }
      }
      for (const source of sources) if (!entries.has(source)) entries.set(source, { source, dirty: true, epoch: 0, marks: new Map() })
      for (const [source, entry] of entries) if (!source.isConnected || !source.closest(ROOTS) || source.closest(EXCLUDED)) { restore(entry); entry.capture?.dispose(); entries.delete(source) }
    }
    const compose = async () => {
      if (closed || failed || !effect) return
      if (running) { again = true; return }
      pending = undefined; clearTimeout(refreshTimer)
      const currentGeometry = geometryEpoch
      running = true
      try {
        discover()
        if (hasPopup()) { for (const entry of entries.values()) restore(entry); committed = []; clip([]); return }
        const logicalScale = Math.min(1, 1200 / Math.max(1, win!.innerWidth), 900 / Math.max(1, win!.innerHeight))
        const nextWidth = Math.max(1, Math.round(win!.innerWidth * logicalScale)), nextHeight = Math.max(1, Math.round(win!.innerHeight * logicalScale))
        if (width !== nextWidth || height !== nextHeight || scale !== logicalScale) {
          for (const entry of entries.values()) restore(entry)
          committed = []; clip([]); width = nextWidth; height = nextHeight; scale = logicalScale
          stage.style.width = `${width}px`; stage.style.height = `${height}px`; stage.style.transform = `scale(${1 / scale})`
          effect.resize(width, height)
        }
        const visible = [...entries.values()].map(entry => ({ entry, box: visibleBox(entry.source) })).filter((item): item is {entry: Entry;box: Box} => !!item.box)
        const visibleSources = new Set(visible.map(item => item.entry.source))
        for (const entry of entries.values()) if (!visibleSources.has(entry.source)) {
          restore(entry); entry.capture?.dispose(); entry.capture = undefined; entry.origin = undefined; entry.dirty = true; entry.failed = undefined
        }
        // Decode a bounded batch concurrently; data length and graph size are not capped.
        for (let offset = 0; offset < visible.length; offset += 4) await Promise.all(visible.slice(offset, offset + 4).map(async ({entry}) => {
          if (entry.source.localName === 'canvas' || !entry.dirty || entry.failed) return
          const epoch = entry.epoch; if (entry.source.localName !== 'img') restore(entry)
          try {
            const capture = await captureAsciiVisual(entry.source as SVGSVGElement | HTMLImageElement, abort.signal, {maxPixels: 4_194_304})
            if (closed || failed || epoch !== entry.epoch) { capture.dispose(); return }
            entry.capture?.dispose(); entry.capture = capture; entry.origin = entry.source.getBoundingClientRect(); entry.dirty = false
          } catch (error) { if (!closed && !failed && epoch === entry.epoch && error instanceof Error && error.name === 'AsciiVisualCaptureError' && 'code' in error && error.code === 'changed') { entry.dirty = true; entry.epoch++; again = true; return } if (!closed && !failed && epoch === entry.epoch) { entry.failed = error instanceof Error ? error.message : String(error); entry.capture?.dispose(); entry.capture = undefined } }
        }))
        if (closed || failed) return
        if (currentGeometry !== geometryEpoch) { again = true; return }
        const atlas = doc.createElement('canvas'); atlas.width = width; atlas.height = height
        const ctx = atlas.getContext('2d'); if (!ctx) throw new Error('ASCII atlas context unavailable')
        ctx.fillStyle = background; ctx.fillRect(0, 0, width, height)
        const items: {entry: Entry;epoch: number;box: Box}[] = []
        for (const {entry} of visible) {
          const box = visibleBox(entry.source); if (entry.inspecting || !box || entry.dirty && entry.source.localName !== 'canvas') continue
          const bitmap = entry.source.localName === 'canvas' ? readAsciiVisualFrame(entry.source as HTMLCanvasElement)?.bitmap : entry.capture?.bitmap
          if (!bitmap?.width || !bitmap.height) continue
          const rootRect = entry.source.getBoundingClientRect(), captured = entry.capture?.bounds, origin = entry.origin
          const sx = origin?.width ? rootRect.width / origin.width : 1, sy = origin?.height ? rootRect.height / origin.height : 1
          const rect = captured && origin ? { left: rootRect.left + (captured.left - origin.left) * sx, top: rootRect.top + (captured.top - origin.top) * sy, width: captured.width * sx, height: captured.height * sy } : rootRect
          ctx.save(); ctx.beginPath(); ctx.rect(box.left * scale, box.top * scale, box.width * scale, box.height * scale); ctx.clip()
          ctx.drawImage(bitmap, rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale)
          for (const text of entry.capture?.textRects ?? []) { ctx.fillStyle = background; ctx.fillRect((rect.left + text.x * sx - 5) * scale, (rect.top + text.y * sy - 5) * scale, (text.width * sx + 10) * scale, (text.height * sy + 10) * scale) }
          ctx.restore(); items.push({entry, epoch: entry.epoch, box})
        }
        for (const entry of entries.values()) if (!items.some(item => item.entry === entry)) restore(entry)
        pending = {revision: ++revision, items}
        effect.update(atlas, revision); atlas.width = atlas.height = 0
        for (const source of frameFailures.keys()) if (!source.isConnected || !source.closest(ROOTS) || source.closest(EXCLUDED)) frameFailures.delete(source)
        const failures = [...entries.values()].filter(entry => entry.failed && visibleBox(entry.source)).length + [...frameFailures.keys()].filter(source => visibleBox(source)).length
        overlay.dataset.asciiFallbacks = JSON.stringify([...entries.values()].filter(entry => entry.failed && visibleBox(entry.source)).map(entry => entry.failed))
        status.textContent = failures ? `有 ${failures} 个图形暂不支持 ASCII，已保留原图。` : ''; status.style.display = failures ? 'block' : 'none'
        const dynamic = visible.filter(({entry}) => !entry.inspecting && !entry.failed && (entry.source.localName === 'img' || entry.source.localName === 'svg' && [...entry.source.querySelectorAll(SHAPES)].some(node => { const animation = win!.getComputedStyle(node).animationName; return animation && animation !== 'none' })))
        if (dynamic.length) refreshTimer = setTimeout(() => {
          if (closed || failed) return
          for (const {entry} of dynamic) { entry.dirty = true; entry.epoch++ }
          schedule()
        }, 200)
      } catch (error) { report(error) }
      finally { running = false; if (again && !closed) { again = false; schedule() } }
    }
    const schedule = () => { if (closed || queued) return; queued = true; win!.requestAnimationFrame(() => { queued = false; void compose() }) }
    const observer = new win!.MutationObserver(records => {
      const real = records.filter(record => {
        if (record.attributeName === MARK || overlay.contains(record.target) || status.contains(record.target) || record.target === style) return false
        // Draw counters describe a frame; they do not change its source geometry.
        if (record.target instanceof win!.HTMLCanvasElement && record.target.getAttribute('data-iexp-continuous-visual') === 'true'
          && (record.attributeName === 'data-drawn-frames' || record.attributeName === 'data-particle-state')) return false
        return true
      })
      if (!real.length) return
      for (const entry of entries.values()) if (real.some(record => entry.source.contains(record.target) || record.target instanceof win!.Element && record.target.contains(entry.source))) invalidate(entry)
      if (hasPopup()) { pending = undefined; for (const entry of entries.values()) restore(entry); committed = []; }
      clip(committed); schedule()
    })
    observer.observe(doc.body, {childList:true, subtree:true, attributes:true, characterData:true})
    const geometry = () => { geometryEpoch++; pending = undefined; for (const entry of entries.values()) restore(entry); committed = []; clip([]); schedule() }
    const frame = (event: Event) => {
      const source = event.target as Source
      if (source.localName === 'canvas') {
        const code = (event as CustomEvent<{code?: string}>).detail?.code
        if (event.type === 'iexp:visual-frame-error' && code !== 'SOURCE_RELEASED') frameFailures.set(source as HTMLCanvasElement, code ?? 'frame unavailable')
        else frameFailures.delete(source as HTMLCanvasElement)
      }
      const entry = entries.get(source);
      if (event.type === 'iexp:visual-frame' && source.getAttribute('data-iexp-continuous-visual') === 'true') { schedule(); return }
      if (entry) invalidate(entry); clip(committed); schedule() }
    const resize = new win!.ResizeObserver(geometry); resize.observe(doc.documentElement)
    doc.addEventListener('scroll', geometry, true); win!.addEventListener('resize', geometry)
    doc.addEventListener('iexp:visual-frame', frame); doc.addEventListener('iexp:visual-frame-error', frame)
    doc.addEventListener('load', frame, true)
    // Raster originals remain inspectable using the existing pointer/focus path.
    const reveal = (event: Event) => { const target = event.target as Element; const entry = entries.get(target.closest?.('svg,img,canvas') as Source); if (entry) { if (event.type === 'focusin') entry.focused = true; else entry.pointer = true; entry.inspecting = true; invalidate(entry); clip(committed) } }
    const conceal = (event: Event) => { const target = event.target as Element; const entry = entries.get(target.closest?.('svg,img,canvas') as Source); if (entry && !(event instanceof win!.MouseEvent && event.relatedTarget instanceof win!.Node && entry.source.contains(event.relatedTarget))) { if (event.type === 'focusout') entry.focused = false; else entry.pointer = false; entry.inspecting = !!entry.focused || !!entry.pointer; schedule() } }
    doc.addEventListener('pointerover', reveal); doc.addEventListener('focusin', reveal)
    doc.addEventListener('pointerout', conceal); doc.addEventListener('focusout', conceal)
    releaseSlot = acquireCanvasSlot(() => {
      const initialScale = Math.min(1, 1200 / Math.max(1, win!.innerWidth), 900 / Math.max(1, win!.innerHeight))
      width = Math.max(1, Math.round(win!.innerWidth * initialScale)); height = Math.max(1, Math.round(win!.innerHeight * initialScale)); scale = initialScale
      stage.style.width = `${width}px`; stage.style.height = `${height}px`; stage.style.transform = `scale(${1 / scale})`
      void createAsciiGpuEffect({stage,width,height,background,loadFactory:options.loadFactory,signal:abort.signal,onError:report,onFrame: painted => {
        if (closed || failed || pending?.revision !== painted) return
        if (hasPopup()) { for (const entry of entries.values()) restore(entry); committed = []; clip([]); return }
        committed = pending.items.filter(item => item.epoch === item.entry.epoch && !item.entry.inspecting && item.entry.source.isConnected)
        for (const item of committed) hide(item.entry)
        clip(committed); overlay.dataset.asciiRevision = String(painted)
      }}).then(value => { if (closed || failed) value.dispose(); else { effect = value; schedule() } }, report)
    })
    return () => {
      if (closed) return
      closed = true; abort.abort(); clearTimeout(refreshTimer); observer.disconnect(); resize.disconnect()
      doc.removeEventListener('scroll', geometry, true); win!.removeEventListener('resize', geometry)
      doc.removeEventListener('iexp:visual-frame', frame); doc.removeEventListener('iexp:visual-frame-error', frame); doc.removeEventListener('load', frame, true)
      doc.removeEventListener('pointerover', reveal); doc.removeEventListener('focusin', reveal)
      doc.removeEventListener('pointerout', conceal); doc.removeEventListener('focusout', conceal)
      for (const entry of entries.values()) { restore(entry); entry.capture?.dispose() }
      entries.clear(); unsubscribeFrames()
      try { effect?.dispose() } finally { releaseSlot?.(); overlay.remove(); status.remove(); style.remove() }
    }
  }
  const unsubscribe = store.subscribe(sync); doc.addEventListener('visibilitychange', sync); sync()
  return () => { disposed = true; unsubscribe(); doc.removeEventListener('visibilitychange', sync); stop?.() }
}
