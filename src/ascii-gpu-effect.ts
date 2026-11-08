/**
 * Plugin-owned WebGL 2 character renderer for the GPU ASCII theme. Each cell
 * samples the captured graphics atlas, measures how far its brightness departs
 * from the opaque background, and draws one real glyph from the theme's
 * monospace font: a brightness ramp for filled areas and `- / | \\` where a thin
 * stroke crosses the cell, so chart lines stay continuous. Glyph colour comes
 * from the source pixels, which already use the theme palette. One output
 * canvas and one WebGL context serve every projected graphic on the page.
 */
export interface AsciiGpuEffectOptions {
  /** Plugin-owned, non-interactive overlay; the original UI remains elsewhere. */
  readonly stage: HTMLElement
  readonly width: number
  readonly height: number
  /** The opaque colour the atlas is composited on. */
  readonly background: string
  /** CSS font-family of the surrounding theme text; glyphs are drawn from it. */
  readonly font: string
  readonly signal?: AbortSignal
  /** Called once after the latest revision has been drawn. */
  readonly onFrame: (revision: number) => void
  readonly onError: (error: Error) => void
}

export interface AsciiGpuEffect {
  readonly output: HTMLCanvasElement
  /** Uploads the atlas; revisions must be positive and strictly increasing. */
  update(bitmap: HTMLCanvasElement, revision: number): void
  /** Clears the old view. A fresh, later revision is required after resize. */
  resize(width: number, height: number): void
  dispose(): void
}

export const ASCII_GLYPH_CELL = { width: 5, height: 9 } as const
/** Dark to bright. The first entry must stay a space so empty cells draw nothing. */
export const ASCII_GLYPH_RAMP = ' .:-=+*#%@'
const LINE_GLYPHS = '-/|\\'
const MAX_SIDE = 4096
const MAX_PIXELS = 4096 * 4096

const VERTEX = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource; uniform sampler2D uGlyphs;
uniform vec2 uResolution; uniform vec2 uCell; uniform vec3 uBackground;
uniform float uRampCount; uniform float uGlyphCount;
in vec2 vUv; out vec4 outColor;
void main(){
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float bgLuma = dot(uBackground, LUMA), bgRange = max(bgLuma, 1.0 - bgLuma);
  vec2 frag = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
  vec2 cell = floor(frag / uCell);
  vec2 origin = cell * uCell;
  float total = 0.0, peak = 0.0; vec3 tint = vec3(0.0);
  vec2 centre = vec2(0.0); float sxx = 0.0, syy = 0.0, sxy = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 p = vec2(float(i), float(j)) + 0.5;
    vec4 c = texture(uSource, (origin + p / 4.0 * uCell) / uResolution);
    float d = clamp(abs(dot(c.rgb, LUMA) - bgLuma) / bgRange * 1.15, 0.0, 1.0);
    total += d; peak = max(peak, d); tint += c.rgb * d;
    vec2 q = p - 2.0; centre += q * d; sxx += q.x * q.x * d; syy += q.y * q.y * d; sxy += q.x * q.y * d;
  }
  if (peak < 0.08) { outColor = vec4(0.0); return; }
  float mean = total / 16.0;
  centre /= total; sxx = sxx / total - centre.x * centre.x; syy = syy / total - centre.y * centre.y; sxy = sxy / total - centre.x * centre.y;
  float spread = sxx + syy, aniso = spread > 0.0 ? sqrt((sxx - syy) * (sxx - syy) + 4.0 * sxy * sxy) / spread : 0.0;
  float glyph;
  if (mean < 0.3 && aniso > 0.72) {
    // Screen y grows downward, so a positive covariance is a "\\" stroke.
    float angle = 0.5 * atan(2.0 * sxy, sxx - syy);
    float a = abs(angle);
    glyph = a < 0.39 ? uRampCount : a > 1.18 ? uRampCount + 2.0 : angle > 0.0 ? uRampCount + 3.0 : uRampCount + 1.0;
  } else {
    float level = max(mean, peak * 0.55);
    glyph = clamp(floor(level * (uRampCount - 1.0)) + 1.0, 1.0, uRampCount - 1.0);
  }
  vec2 local = (frag - origin) / uCell;
  float ink = texture(uGlyphs, vec2((glyph + local.x) / uGlyphCount, local.y)).a;
  vec3 colour = tint / total;
  outColor = vec4(colour * ink, ink);
}`

function failure(code: string, reason: string, cause?: unknown): Error {
  return new Error(`${code}: ${reason}`, cause === undefined ? undefined : { cause })
}

/** Glyph strip rendered from the theme font: ramp first, then the line glyphs. */
export function drawGlyphStrip(doc: Document, font: string, cellWidth: number, cellHeight: number): HTMLCanvasElement {
  const glyphs = ASCII_GLYPH_RAMP + LINE_GLYPHS
  const strip = doc.createElement('canvas')
  strip.width = cellWidth * glyphs.length; strip.height = cellHeight
  const ctx = strip.getContext('2d')
  if (!ctx) throw failure('ASCII_GLYPH_CONTEXT', 'A 2D context for the glyph strip is unavailable.')
  ctx.clearRect(0, 0, strip.width, strip.height)
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(cellHeight * 0.86)}px ${font}`
  for (let index = 0; index < glyphs.length; index++) ctx.fillText(glyphs[index]!, index * cellWidth + cellWidth / 2, cellHeight / 2)
  return strip
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw failure('ASCII_GLYPH_SHADER', 'A shader could not be created.')
  gl.shaderSource(shader, source); gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw failure('ASCII_GLYPH_SHADER', gl.getShaderInfoLog(shader) ?? 'Shader compilation failed.')
  return shader
}

function parseBackground(doc: Document, background: string): [number, number, number] {
  const probe = doc.createElement('canvas'); probe.width = probe.height = 1
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw failure('ASCII_GLYPH_CONTEXT', 'A 2D context is unavailable.')
  ctx.fillStyle = '#010203'; ctx.fillStyle = background; const first = ctx.fillStyle
  ctx.fillStyle = '#fefdfc'; ctx.fillStyle = background
  if (first !== ctx.fillStyle) throw failure('ASCII_GLYPH_BACKGROUND', 'The background is not a supported solid colour.')
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  if (a !== 255) throw failure('ASCII_GLYPH_BACKGROUND', 'The background must be opaque.')
  return [r! / 255, g! / 255, b! / 255]
}

export async function createAsciiGpuEffect(options: AsciiGpuEffectOptions): Promise<AsciiGpuEffect> {
  const { stage, onFrame, onError } = options
  const doc = stage.ownerDocument, win = doc.defaultView
  if (!win || !stage.isConnected) throw failure('ASCII_GLYPH_DETACHED', 'The effect stage is not connected.')
  if (options.signal?.aborted) throw failure('ASCII_GLYPH_CANCELLED', 'The effect was cancelled.')
  // Glyphs must come from the same face as the surrounding text.
  await doc.fonts?.ready
  if (options.signal?.aborted || !stage.isConnected) throw failure('ASCII_GLYPH_CANCELLED', 'The effect was cancelled.')
  const background = parseBackground(doc, options.background)

  const output = doc.createElement('canvas')
  output.setAttribute('aria-hidden', 'true')
  output.setAttribute('data-ascii-renderer', 'webgl2-glyphs')
  output.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;opacity:0'
  stage.append(output)
  const gl = output.getContext('webgl2', { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true })
  if (!gl || gl.isContextLost()) { output.remove(); throw failure('ASCII_GLYPH_CONTEXT', 'WebGL 2 is unavailable.') }

  let width = options.width, height = options.height, closed = false, failing = false, latest = 0
  let deviceScale = 1, cellWidth = 6, cellHeight = 11
  const program = gl.createProgram()!
  const sourceTexture = gl.createTexture()!, glyphTexture = gl.createTexture()!, buffer = gl.createBuffer()!
  const uniforms: Record<string, WebGLUniformLocation | null> = {}

  const dispose = () => {
    if (closed) return
    closed = true; output.style.opacity = '0'
    options.signal?.removeEventListener('abort', abort)
    output.removeEventListener('webglcontextlost', contextLost)
    if (!gl.isContextLost()) { gl.deleteTexture(sourceTexture); gl.deleteTexture(glyphTexture); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext() }
    output.width = output.height = 0; output.remove()
  }
  const report = (error: unknown) => {
    if (closed || failing) return
    failing = true; output.style.opacity = '0'
    const detail = error instanceof Error ? error : failure('ASCII_GLYPH_FAILED', 'The visual effect failed.', error)
    queueMicrotask(() => { if (closed) return; try { dispose() } finally { onError(detail) } })
  }
  function abort() { report(failure('ASCII_GLYPH_CANCELLED', 'The effect was cancelled.')) }
  function contextLost(event: Event) { event.preventDefault(); report(failure('ASCII_GLYPH_CONTEXT_LOST', 'The WebGL context was lost.')) }
  const check = (operation: string) => {
    if (gl.isContextLost()) throw failure('ASCII_GLYPH_CONTEXT_LOST', 'The WebGL context was lost.')
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw failure('ASCII_GLYPH_OPERATION', `${operation} failed (${error}).`)
  }

  /**
   * Output pixels follow the stage's on-screen size, so one cell is a fixed
   * number of CSS pixels. On very wide or dense displays the device scale is
   * clamped to the texture budget; cells keep their on-screen size and only
   * lose sharpness.
   */
  const layout = () => {
    if (!(width > 0 && height > 0)) throw failure('ASCII_GLYPH_SIZE', 'The effect size is outside the supported budget.')
    const shown = stage.getBoundingClientRect().width
    const shownScale = shown > 0 ? shown / width : 1
    deviceScale = Math.min(shownScale * (win.devicePixelRatio || 1), MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_PIXELS / (width * height)))
    const pixelWidth = Math.max(1, Math.floor(width * deviceScale)), pixelHeight = Math.max(1, Math.floor(height * deviceScale))
    output.width = pixelWidth; output.height = pixelHeight
    output.style.width = `${width}px`; output.style.height = `${height}px`
    const perCssPixel = deviceScale / shownScale
    cellWidth = Math.max(3, Math.round(ASCII_GLYPH_CELL.width * perCssPixel)); cellHeight = Math.max(5, Math.round(ASCII_GLYPH_CELL.height * perCssPixel))
    const strip = drawGlyphStrip(doc, options.font, cellWidth, cellHeight)
    gl.bindTexture(gl.TEXTURE_2D, glyphTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip)
    check('Glyph upload')
    gl.viewport(0, 0, pixelWidth, pixelHeight)
  }

  try {
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw failure('ASCII_GLYPH_SHADER', gl.getProgramInfoLog(program) ?? 'Program link failed.')
    gl.useProgram(program)
    for (const name of ['uSource', 'uGlyphs', 'uResolution', 'uCell', 'uBackground', 'uRampCount', 'uGlyphCount']) uniforms[name] = gl.getUniformLocation(program, name)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    for (const [texture, unit, filter] of [[sourceTexture, 0, gl.LINEAR], [glyphTexture, 1, gl.LINEAR]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.uniform1i(uniforms.uSource!, 0); gl.uniform1i(uniforms.uGlyphs!, 1)
    gl.uniform3f(uniforms.uBackground!, ...background)
    gl.uniform1f(uniforms.uRampCount!, ASCII_GLYPH_RAMP.length); gl.uniform1f(uniforms.uGlyphCount!, ASCII_GLYPH_RAMP.length + LINE_GLYPHS.length)
    gl.activeTexture(gl.TEXTURE1)
    layout()
    output.addEventListener('webglcontextlost', contextLost)
    options.signal?.addEventListener('abort', abort, { once: true })
  } catch (error) { dispose(); throw error }

  return {
    output,
    update(bitmap, revision) {
      if (closed || failing) throw failure('ASCII_GLYPH_DISPOSED', 'The visual effect is not active.')
      if (!Number.isSafeInteger(revision) || revision <= latest) throw failure('ASCII_GLYPH_REVISION', 'Atlas revisions must strictly increase.')
      try {
        latest = revision; output.style.opacity = '0'
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        check('Atlas upload')
        gl.uniform2f(uniforms.uResolution!, output.width, output.height)
        gl.uniform2f(uniforms.uCell!, cellWidth, cellHeight)
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        check('Frame draw')
        output.style.opacity = '1'
        onFrame(revision)
      } catch (error) { report(error); throw error }
    },
    resize(nextWidth, nextHeight) {
      if (closed || failing) throw failure('ASCII_GLYPH_DISPOSED', 'The visual effect is not active.')
      width = nextWidth; height = nextHeight; output.style.opacity = '0'
      try { layout() } catch (error) { report(error); throw error }
    },
    dispose,
  }
}
