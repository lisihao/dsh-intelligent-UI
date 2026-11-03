import { ASCII_FRAME_PIXEL_LIMIT, releaseAsciiVisualFrame } from './ascii-visual-frames.js'

export interface FlowParticleOptions {
  viewport: HTMLElement
  activeEdgeIds?: ReadonlySet<string> | null
  onError?: (error: Error) => void
  onRecovery?: () => void
}
export interface FlowParticles {
  setActiveEdges(ids: ReadonlySet<string> | null): void
  setMotion(enabled: boolean): void
  dispose(): void
}
type Color = [number, number, number, number]
type Sample = { path: SVGPathElement, id: string, signature: string, length: number, points?: Float32Array, bounds?: [number, number, number, number] }
type Renderer = { kind: 'webgl2' | 'canvas2d', draw(points: number[], width: number, height: number, ratio: number): void, clear(): void, reset(): void, dispose(): void }
const STEP_MS = 1000 / 30, SAMPLE_LIMIT = 192, TAIL_POINTS = 7
function error(name: string, message: string): Error { const result = new Error(message); result.name = name; return result }
function strokeColor(value: string): Color | undefined {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) { const full = hex[1]!.length === 3 ? [...hex[1]!].map(character => character + character).join('') : hex[1]!; return [Number.parseInt(full.slice(0, 2), 16) / 255, Number.parseInt(full.slice(2, 4), 16) / 255, Number.parseInt(full.slice(4, 6), 16) / 255, full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1] }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const channels = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map((part, index) => part.endsWith('%') ? Number.parseFloat(part) / 100 : Number(part) / (index < 3 ? 255 : 1))
    if (channels.length >= 3 && channels.every(Number.isFinite)) return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1]
  }
  const srgb = value.match(/^color\(srgb\s+([^)]*)\)$/i)
  if (srgb) {
    const channels = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number)
    if (channels.length >= 3 && channels.every(Number.isFinite)) return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1]
  }
  return undefined
}
function createRenderer(canvas: HTMLCanvasElement, notify: (error: Error) => void): Renderer | undefined {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false })
  if (!gl) {
    const context = canvas.getContext('2d')
    if (!context) { notify(error('FlowParticlesRendererUnavailable', '无法创建粒子画布；原始关系图保持可读。')); return }
    notify(error('FlowParticlesCanvas2DFallback', 'WebGL2 不可用；粒子层使用 Canvas2D，原始关系图保持不变。'))
    return {
      kind: 'canvas2d',
      draw(points, width, height, ratio) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height)
        for (let i = 0; i < points.length; i += 7) {
          context.fillStyle = `rgba(${Math.round(points[i + 2]! * 255)},${Math.round(points[i + 3]! * 255)},${Math.round(points[i + 4]! * 255)},${points[i + 5]})`
          context.beginPath(); context.arc(points[i]!, points[i + 1]!, points[i + 6]! / 2, 0, Math.PI * 2); context.fill()
        }
      },
      clear() { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height) }, reset() {}, dispose() {},
    }
  }
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null
  const cleanup = () => { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); buffer = null; program = null }
  const initialize = () => {
    if (program) return
    const shaders: WebGLShader[] = []
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, '#version 300 es\nin vec2 position;in vec4 pigment;in float size;uniform vec2 resolution;uniform float ratio;out vec4 ink;void main(){vec2 p=position/resolution*2.0-1.0;gl_Position=vec4(p.x,-p.y,0,1);gl_PointSize=size*ratio;ink=pigment;}'],
        [gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;in vec4 ink;out vec4 outColor;void main(){float a=1.0-smoothstep(0.36,0.5,length(gl_PointCoord-vec2(0.5)));outColor=vec4(ink.rgb,ink.a*a);}'],
      ] as const) {
        const shader = gl.createShader(type); if (!shader) throw new Error('无法创建点着色器。')
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || '点着色器编译失败。')
      }
      program = gl.createProgram(); if (!program) throw new Error('无法创建点绘制程序。')
      for (const shader of shaders) gl.attachShader(program, shader)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || '点绘制程序链接失败。')
      buffer = gl.createBuffer(); if (!buffer) throw new Error('无法创建点缓冲区。')
    } catch (cause) { cleanup(); throw cause }
    finally { for (const shader of shaders) gl.deleteShader(shader) }
  }
  return {
    kind: 'webgl2',
    draw(points, width, height, ratio) {
      initialize(); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      if (!points.length) return
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW)
      for (const [name, count, offset] of [['position', 2, 0], ['pigment', 4, 8], ['size', 1, 24]] as const) {
        const attribute = gl.getAttribLocation(program!, name); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, count, gl.FLOAT, false, 28, offset)
      }
      gl.uniform2f(gl.getUniformLocation(program!, 'resolution'), width, height); gl.uniform1f(gl.getUniformLocation(program!, 'ratio'), ratio)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, points.length / 7)
    },
    clear() { if (!gl.isContextLost()) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) } },
    reset() { program = null; buffer = null }, dispose() { cleanup(); gl.getExtension('WEBGL_lose_context')?.loseContext() },
  }
}
/** A source-geometry projection only: particles never advance task status or progress. */
export function installFlowParticles({ viewport, activeEdgeIds = null, onError, onRecovery }: FlowParticleOptions): FlowParticles {
  const document = viewport.ownerDocument, view = document.defaultView
  if (!view) throw error('FlowParticlesDocumentUnavailable', '粒子层需要可见页面环境；原始关系图保持不变。')
  const canvas = document.createElement('canvas')
  // Tiny moving lights remain native WebGL: a character-cell resample can erase them.
  canvas.setAttribute('data-iexp-ascii-original', 'true'); canvas.setAttribute('data-iexp-flow-particles', 'true'); canvas.setAttribute('data-iexp-continuous-visual', 'true'); canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '4' })
  let host = viewport.querySelector<HTMLElement>('.react-flow') ?? viewport
  host.append(canvas)
  let active = activeEdgeIds === null ? null : new Set(activeEdgeIds), motion = true, disposed = false, intersecting = true, lost = false, failed = false
  let raf: number | undefined, lastFrame: number | undefined, lastClock: number | undefined, clock = 0, drawn = 0, dirty = true
  const cache = new Map<SVGPathElement, Sample>(), notified = new Set<string>()
  const notify = (issue: Error) => {
    canvas.dataset.renderError = issue.message; canvas.dataset.renderErrorKind = issue.name
    const key = `${issue.name}:${issue.message}`; if (notified.has(key)) return; notified.add(key)
    onError?.(issue)
  }
  let renderer: Renderer | undefined
  try { renderer = createRenderer(canvas, notify) } catch (cause) { notify(error('FlowParticlesRendererError', `粒子画布初始化失败：${cause instanceof Error ? cause.message.slice(0, 400) : '未知画布错误'}；原始关系图保持不变。`)) }
  canvas.dataset.renderer = renderer?.kind ?? 'unavailable'
  const media = view.matchMedia?.('(prefers-reduced-motion: reduce)')
  const scan = () => {
    if (!dirty) return
    dirty = false
    const currentHost = viewport.querySelector<HTMLElement>('.react-flow') ?? viewport
    if (host !== currentHost) { host = currentHost; host.append(canvas) }
    const paths = new Set(viewport.querySelectorAll<SVGPathElement>('path.react-flow__edge-path'))
    for (const path of cache.keys()) if (!paths.has(path)) cache.delete(path)
    for (const path of paths) {
      const id = path.closest('g[data-id]')?.getAttribute('data-id'); if (!id) { cache.delete(path); continue }
      const signature = path.getAttribute('d') ?? ''
      const old = cache.get(path)
      if (!old || old.signature !== signature || old.id !== id) cache.set(path, { path, id, signature, length: 0 })
    }
  }
  const eligible = () => {
    scan()
    if (disposed) return 'disposed'
    if (!renderer || failed) return 'unavailable'
    if (!motion) return 'paused'
    if (media?.matches) return 'reduced-motion'
    if (document.hidden) return 'hidden'
    if (!intersecting) return 'offscreen'
    if (lost) return 'context-lost'
    if (active?.size === 0) return 'empty-active-edges'
    if (![...cache.values()].some(sample => active === null || active.has(sample.id))) return 'no-active-paths'
    return 'running'
  }
  const stop = (state: string) => {
    if (raf !== undefined) view.cancelAnimationFrame(raf)
    raf = undefined; lastFrame = undefined; lastClock = undefined; canvas.hidden = true; canvas.dataset.particleState = state
    renderer?.clear(); releaseAsciiVisualFrame(canvas)
  }
  const samplePath = (sample: Sample) => {
    const signature = sample.path.getAttribute('d') ?? ''
    if (sample.signature !== signature) { sample.signature = signature; sample.points = undefined; sample.bounds = undefined }
    if (sample.points) return
    const length = sample.path.getTotalLength()
    if (!Number.isFinite(length) || length <= 0) { sample.points = new Float32Array(); return }
    const count = Math.min(SAMPLE_LIMIT, Math.max(8, Math.ceil(length / 12))), points = new Float32Array((count + 1) * 2)
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
    for (let index = 0; index <= count; index++) {
      const point = sample.path.getPointAtLength(length * index / count)
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw error('FlowParticlesPathError', '实际 SVG 连线返回了无效坐标；原文关系保持不变。')
      points[index * 2] = point.x; points[index * 2 + 1] = point.y
      left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
    }
    sample.length = length; sample.points = points; sample.bounds = [left, top, right, bottom]
  }
  const draw = () => {
    if (eligible() !== 'running') return
    canvas.hidden = false
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height || !renderer) { releaseAsciiVisualFrame(canvas); return }
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) { releaseAsciiVisualFrame(canvas); return }
    const ratio = Math.min(view.devicePixelRatio || 1, 2, Math.sqrt(ASCII_FRAME_PIXEL_LIMIT / (width * height)), ASCII_FRAME_PIXEL_LIMIT / width, ASCII_FRAME_PIXEL_LIMIT / height)
    const bitmapWidth = Math.max(1, Math.floor(width * ratio)), bitmapHeight = Math.max(1, Math.floor(height * ratio))
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight
    const scaleX = width / rect.width, scaleY = height / rect.height, points: number[] = []
    for (const sample of cache.values()) {
      if (active !== null && !active.has(sample.id)) continue
      const style = view.getComputedStyle(sample.path)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const matrix = sample.path.getScreenCTM(); if (!matrix) continue
      if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)) { notify(error('FlowParticlesTransformError', '实际 SVG 变换无效；原始关系图保持不变。')); continue }
      samplePath(sample); if (!sample.points?.length || !sample.bounds) continue
      const project = (x: number, y: number) => ({ x: (matrix.a * x + matrix.c * y + matrix.e - rect.left) * scaleX, y: (matrix.b * x + matrix.d * y + matrix.f - rect.top) * scaleY })
      const [left, top, right, bottom] = sample.bounds, corners = [project(left, top), project(right, top), project(left, bottom), project(right, bottom)]
      if (corners.every(point => point.x < -12) || corners.every(point => point.x > width + 12) || corners.every(point => point.y < -12) || corners.every(point => point.y > height + 12)) continue
      const pigment = strokeColor(style.stroke.toLocaleLowerCase('en-US') === 'currentcolor' ? style.color : style.stroke)
      if (!pigment) { notify(error('FlowParticlesColorUnavailable', `无法读取实际连线颜色（${style.stroke.slice(0, 80)}）；该连线不添加猜测颜色。`)); continue }
      const strokeOpacity = Number(style.strokeOpacity || 1)
      if (pigment[3] <= 0 || !Number.isFinite(strokeOpacity) || strokeOpacity <= 0) continue
      const projected: { x: number, y: number }[] = [], distances = [0]
      for (let index = 0; index < sample.points.length; index += 2) {
        const point = project(sample.points[index]!, sample.points[index + 1]!); projected.push(point)
        if (projected.length > 1) { const before = projected[projected.length - 2]!; distances.push(distances.at(-1)! + Math.hypot(point.x - before.x, point.y - before.y)) }
      }
      const length = distances.at(-1)!; if (!length) continue
      const heads = Math.max(1, Math.min(3, Math.ceil(length / 200)))
      let phase = 0; for (const character of sample.id) phase = (phase * 31 + character.charCodeAt(0)) % 997
      for (let head = 0; head < heads; head++) for (let tail = TAIL_POINTS - 1; tail >= 0; tail--) {
        const distance = (clock * 0.072 + phase / 997 * length + head * length / heads) % length - tail * 3.5
        if (distance < 0) continue
        let segment = 1; while (segment < distances.length - 1 && distances[segment]! < distance) segment++
        const before = projected[segment - 1]!, after = projected[segment]!, part = (distance - distances[segment - 1]!) / Math.max(0.001, distances[segment]! - distances[segment - 1]!)
        const x = before.x + (after.x - before.x) * part, y = before.y + (after.y - before.y) * part
        if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue
        points.push(x, y, pigment[0], pigment[1], pigment[2], pigment[3] * (1 - tail / TAIL_POINTS) * strokeOpacity, tail === 0 ? 5.5 : 2.8)
      }
    }
    if (eligible() !== 'running') return
    renderer.draw(points, width, height, ratio)
    canvas.hidden = false
    if (points.length) { canvas.dataset.drawnFrames = String(++drawn) }
    else releaseAsciiVisualFrame(canvas)
  }
  const frame = (time: number) => {
    raf = undefined
    const state = eligible(); if (state !== 'running') { stop(state); return }
    if (lastClock !== undefined) clock += Math.max(0, Math.min(100, time - lastClock))
    lastClock = time
    if (lastFrame === undefined || time - lastFrame >= STEP_MS - 0.5) {
      lastFrame = time
      try { draw() } catch (cause) { failed = true; notify(cause instanceof Error && cause.name.startsWith('FlowParticles') ? cause : error('FlowParticlesDrawError', `粒子绘制失败：${cause instanceof Error ? cause.message.slice(0, 400) : String(cause).slice(0, 400)}；原始关系图保持不变。`)); stop('unavailable'); return }
    }
    if (raf === undefined && eligible() === 'running') raf = view.requestAnimationFrame(frame)
  }
  const reconcile = () => {
    if (disposed) return
    const state = eligible(); canvas.dataset.particleState = state
    if (state !== 'running') { stop(state); return }
    canvas.hidden = false
    if (raf === undefined) raf = view.requestAnimationFrame(frame)
  }
  const mutate = (records: MutationRecord[]) => { if (records.some(record => record.target !== canvas)) { dirty = true; reconcile() } }
  const mutations = new view.MutationObserver(mutate)
  mutations.observe(viewport, { subtree: true, childList: true, attributes: true, attributeFilter: ['d', 'transform', 'class', 'style', 'data-id', 'hidden'] })
  const resize = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(reconcile) : undefined; resize?.observe(host)
  const intersection = typeof view.IntersectionObserver === 'function' ? new view.IntersectionObserver(entries => { const entry = entries.find(entry => entry.target === viewport); if (entry) { intersecting = entry.isIntersecting; reconcile() } }) : undefined
  intersection?.observe(viewport)
  const change = () => reconcile()
  const lostContext = (event: Event) => { if (disposed || renderer?.kind !== 'webgl2') return; event.preventDefault(); lost = true; stop('context-lost'); notify(error('FlowParticlesContextLost', '粒子层 GPU 上下文已丢失；原始关系图和源数据保持可读。')) }
  const restoredContext = () => { if (disposed || !lost || renderer?.kind !== 'webgl2') return; lost = false; failed = false; renderer.reset(); delete canvas.dataset.renderError; delete canvas.dataset.renderErrorKind; notified.clear(); onRecovery?.(); reconcile() }
  const request = () => { if (!disposed && eligible() === 'running') { try { draw() } catch (cause) { failed = true; notify(error('FlowParticlesDrawError', cause instanceof Error ? cause.message.slice(0, 400) : String(cause))); reconcile() } } }
  document.addEventListener('visibilitychange', change); media?.addEventListener('change', change)
  canvas.addEventListener('webglcontextlost', lostContext); canvas.addEventListener('webglcontextrestored', restoredContext); canvas.addEventListener('iexp:visual-frame-request', request)
  reconcile()
  return {
    setActiveEdges(ids) { if (disposed) return; active = ids === null ? null : new Set(ids); dirty = true; reconcile() },
    setMotion(enabled) { if (disposed) return; motion = enabled; reconcile() },
    dispose() {
      if (disposed) return
      disposed = true; stop('disposed'); mutations.disconnect(); resize?.disconnect(); intersection?.disconnect()
      document.removeEventListener('visibilitychange', change); media?.removeEventListener('change', change)
      canvas.removeEventListener('webglcontextlost', lostContext); canvas.removeEventListener('webglcontextrestored', restoredContext); canvas.removeEventListener('iexp:visual-frame-request', request)
      renderer?.dispose(); renderer = undefined; cache.clear(); canvas.width = 0; canvas.height = 0; canvas.remove()
    },
  }
}
