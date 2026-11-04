import { flowBounds } from './flow-scale.js'
import { publishAsciiVisualFrame, releaseAsciiVisualFrame } from './ascii-visual-frames.js'
import type { FlowGeometry, FlowViewPlan } from './flow-layout.js'
export interface OverviewRenderer {
  kind: 'webgl2' | 'canvas2d'
  draw(geometry: FlowGeometry, plan: FlowViewPlan, selectedId?: string): { zoom: number, x: number, y: number }
  dispose(): void
}
function color(canvas: HTMLCanvasElement): [number, number, number] {
  const previous = canvas.style.color
  canvas.style.color = 'var(--iexp-accent)'
  const value = getComputedStyle(canvas).color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  canvas.style.color = previous
  return value?.length === 3 ? value.map(channel => channel / 255) as [number, number, number] : [0.58, 0.75, 0.83]
}
/** Thin native drawing adapter; layout/interaction remain owned by ELK and React Flow. */
export function createGraphOverviewRenderer(canvas: HTMLCanvasElement): OverviewRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false })
  let disposed = false, program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null
  const shader = (type: number, source: string) => {
    const item = gl!.createShader(type)
    if (!item) throw new Error('无法创建关系图 GPU 着色器。')
    gl!.shaderSource(item, source); gl!.compileShader(item)
    if (!gl!.getShaderParameter(item, gl!.COMPILE_STATUS)) { const error = gl!.getShaderInfoLog(item); gl!.deleteShader(item); throw new Error(`关系图 GPU 着色器编译失败：${error}`) }
    return item
  }
  const initialize = () => {
    if (!gl || program) return
    const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 position; uniform vec2 resolution; void main(){vec2 p=position/resolution*2.0-1.0;gl_Position=vec4(p.x,-p.y,0,1);}')
    const fragment = shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; uniform vec4 ink; out vec4 outColor; void main(){outColor=ink;}')
    program = gl.createProgram(); if (!program) throw new Error('无法创建关系图 GPU 程序。')
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`关系图 GPU 程序链接失败：${gl.getProgramInfoLog(program)}`)
    buffer = gl.createBuffer(); if (!buffer) throw new Error('无法创建关系图 GPU 缓冲区。')
  }
  // A restored context invalidates its old resources; the next redraw rebuilds only owned resources.
  const lost = (event: Event) => { event.preventDefault(); releaseAsciiVisualFrame(canvas); canvas.dataset.renderError = 'GPU 上下文暂时丢失；可继续搜索节点和查看完整原文。' }
  const restored = () => { program = null; buffer = null; delete canvas.dataset.renderError; if (latest) renderer.draw(...latest) }
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored)
  const context = gl ? null : canvas.getContext('2d')
  if (!gl && !context) throw new Error('浏览器无法创建关系图画布；请使用完整原文列表。')
  let latest: [FlowGeometry, FlowViewPlan, string | undefined] | undefined
  const renderer: OverviewRenderer = {
    kind: gl ? 'webgl2' : 'canvas2d',
    draw(geometry, plan, selectedId) {
      latest = [geometry, plan, selectedId]
      const width = canvas.clientWidth || 800, height = canvas.clientHeight || 360, ratio = Math.min(2, globalThis.devicePixelRatio || 1)
      const bounds = flowBounds(geometry), zoom = Math.min((width - 32) / bounds.width, (height - 32) / bounds.height)
      const x = (width - bounds.width * zoom) / 2 - bounds.x * zoom, y = (height - bounds.height * zoom) / 2 - bounds.y * zoom
      if (disposed) return { zoom, x, y }
      if (gl?.isContextLost()) { releaseAsciiVisualFrame(canvas); return { zoom, x, y } }
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio))
      const positions = new Map(geometry.nodes.map(node => [node.id, node])), accent = color(canvas)
      try { if (gl) {
        initialize(); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        const attribute = gl.getAttribLocation(program!, 'position'); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)
        gl.uniform2f(gl.getUniformLocation(program!, 'resolution'), width, height); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        const draw = (points: number[], mode: number, alpha: number) => {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW); gl.uniform4f(gl.getUniformLocation(program!, 'ink'), ...accent, alpha); gl.drawArrays(mode, 0, points.length / 2)
        }
        const edges: number[] = []
        for (const edge of plan.edges) { const from = positions.get(edge.source), to = positions.get(edge.target); if (from && to) edges.push(x + (from.x + from.width / 2) * zoom, y + (from.y + from.height / 2) * zoom, x + (to.x + to.width / 2) * zoom, y + (to.y + to.height / 2) * zoom) }
        draw(edges, gl.LINES, 0.18)
        const nodes: number[] = []
        for (const node of geometry.nodes) { const left = x + node.x * zoom, top = y + node.y * zoom, right = left + Math.max(2, node.width * zoom), bottom = top + Math.max(2, node.height * zoom); nodes.push(left, top, right, top, left, bottom, left, bottom, right, top, right, bottom) }
        draw(nodes, gl.TRIANGLES, 1)
        const selected = selectedId && positions.get(selectedId)
        if (selected) { const left = x + selected.x * zoom - 3, top = y + selected.y * zoom - 3, right = left + Math.max(2, selected.width * zoom) + 6, bottom = top + Math.max(2, selected.height * zoom) + 6; draw([left, top, right, top, right, bottom, left, bottom], gl.LINE_LOOP, 1) }
      } else if (context) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0); const ink = `rgb(${accent.map(channel => Math.round(channel * 255)).join(',')})`
        context.strokeStyle = ink; context.fillStyle = ink; context.globalAlpha = 0.18; context.lineWidth = 0.5; context.beginPath()
        for (const edge of plan.edges) { const from = positions.get(edge.source), to = positions.get(edge.target); if (from && to) { context.moveTo(x + (from.x + from.width / 2) * zoom, y + (from.y + from.height / 2) * zoom); context.lineTo(x + (to.x + to.width / 2) * zoom, y + (to.y + to.height / 2) * zoom) } }
        context.stroke(); context.globalAlpha = 1
        for (const node of geometry.nodes) { context.fillRect(x + node.x * zoom, y + node.y * zoom, Math.max(2, node.width * zoom), Math.max(2, node.height * zoom)); if (node.id === selectedId) context.strokeRect(x + node.x * zoom - 3, y + node.y * zoom - 3, Math.max(2, node.width * zoom) + 6, Math.max(2, node.height * zoom) + 6) }
      } } catch (error) { releaseAsciiVisualFrame(canvas); throw error }
      publishAsciiVisualFrame(canvas)
      return { zoom, x, y }
    },
    dispose() { if (disposed) return; disposed = true; latest = undefined; canvas.removeEventListener('iexp:visual-frame-request', request); releaseAsciiVisualFrame(canvas); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); if (gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext() } },
  }
  // A theme may be enabled after the last draw. Repaint the existing geometry on demand.
  const request = () => { if (!disposed && latest) renderer.draw(...latest) }
  canvas.addEventListener('iexp:visual-frame-request', request)
  return renderer
}
