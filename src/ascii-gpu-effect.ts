import { loadCanvasEffect, type CanvasEffectFactory, type CanvasEffectInstance } from './canvas-runtime-client.js'

type PaintCanvas = HTMLCanvasElement & { onpaint?: (() => void) | null, requestPaint?: () => void }
type PaintContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }

export interface AsciiGpuEffectOptions {
  /** Plugin-owned, non-interactive overlay; the original UI remains elsewhere. */
  readonly stage: HTMLElement
  readonly width: number
  readonly height: number
  /** An opaque color also used to composite the atlas. */
  readonly background: string
  readonly loadFactory?: (slug: string) => Promise<CanvasEffectFactory>
  readonly signal?: AbortSignal
  /** Called once after the latest revision has been uploaded and submitted to WebGL. */
  readonly onFrame: (revision: number) => void
  readonly onError: (error: Error) => void
}

export interface AsciiGpuEffect {
  readonly output: HTMLCanvasElement
  /** Takes a private copy; revisions must be positive and strictly increasing. */
  update(bitmap: HTMLCanvasElement, revision: number): void
  /** Clears the old view. A fresh, later revision is required after resize. */
  resize(width: number, height: number): void
  dispose(): void
}

const MAX_SIDE = 4096
const MAX_PIXELS = 4_194_304
const glOptions: WebGLContextAttributes = { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true }

function validSize(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_PIXELS
}

function failure(code: string, reason: string, cause?: unknown): Error {
  return new Error(`${code}: ${reason}`, cause === undefined ? undefined : { cause })
}

function waitForFactory(pending: Promise<CanvasEffectFactory>, signal?: AbortSignal): Promise<CanvasEffectFactory> {
  if (!signal) return pending
  if (signal.aborted) return Promise.reject(failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/**
 * Uses the actual fixed Asciify factory with an inert pixel atlas and an empty
 * proxy. This is a visual projection only: the caller owns the original UI,
 * capture policy, visibility, slot budget and recovery. No upstream prototype
 * or module is changed.
 */
export async function createAsciiGpuEffect(options: AsciiGpuEffectOptions): Promise<AsciiGpuEffect> {
  const { stage, onFrame, onError } = options
  const doc = stage.ownerDocument, win = doc.defaultView
  if (!validSize(options.width, options.height)) throw failure('ASCII_GPU_SIZE', 'The effect size is outside the supported budget.')
  if (!stage.isConnected || !win || !doc.body?.isConnected) throw failure('ASCII_GPU_DETACHED', 'The effect stage is not connected.')
  if (options.signal?.aborted) throw failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.')

  // No canvas, observer or upstream instance is created while the loader waits.
  const factory = await waitForFactory(Promise.resolve().then(() => {
    if (options.signal?.aborted) throw failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.')
    return (options.loadFactory ?? loadCanvasEffect)('asciify')
  }), options.signal)
  if (options.signal?.aborted) throw failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.')
  if (!stage.isConnected || stage.ownerDocument !== doc) throw failure('ASCII_GPU_DETACHED', 'The effect stage was removed.')

  const source = doc.createElement('canvas') as PaintCanvas, output = doc.createElement('canvas')
  const proxy = doc.createElement('div'), atlas = doc.createElement('canvas')
  const ctx = source.getContext('2d') as PaintContext | null, atlasCtx = atlas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !atlasCtx) throw failure('ASCII_GPU_CONTEXT', 'A 2D source context is unavailable.')
  output.setAttribute('aria-hidden', 'true')
  output.setAttribute('data-ascii-factory', 'asciify')
  output.setAttribute('data-ascii-renderer', 'webgl2')
  output.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;opacity:0'
  source.style.cssText = 'position:absolute;left:0;top:0;display:block;pointer-events:none;opacity:0'
  // A canvas fallback subtree has no layout in browsers without HTML-in-Canvas.
  // Keep this empty proxy as a private sibling so its clientWidth remains real.
  proxy.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;margin:0;padding:0;border:0'
  proxy.style.backgroundColor = options.background
  if (!proxy.style.backgroundColor) throw failure('ASCII_GPU_BACKGROUND', 'The atlas background must be an opaque CSS color.')

  // Canvas validates CSS colors and resolves alpha without relying on browser-
  // specific color-string syntax. Two sentinels detect a rejected assignment.
  atlas.width = atlas.height = 1
  atlasCtx.fillStyle = '#010203'; atlasCtx.fillStyle = options.background
  const first = atlasCtx.fillStyle
  atlasCtx.fillStyle = '#fefdfc'; atlasCtx.fillStyle = options.background
  if (first !== atlasCtx.fillStyle) throw failure('ASCII_GPU_BACKGROUND', 'The atlas background is not a supported solid color.')
  atlasCtx.clearRect(0, 0, 1, 1); atlasCtx.fillRect(0, 0, 1, 1)
  if (atlasCtx.getImageData(0, 0, 1, 1).data[3] !== 255) throw failure('ASCII_GPU_BACKGROUND', 'The atlas background must be opaque.')
  atlas.width = atlas.height = 0

  let width = options.width, height = options.height
  const sizeElements = () => {
    for (const element of [source, output, proxy]) { element.style.width = `${width}px`; element.style.height = `${height}px` }
  }
  sizeElements()
  stage.append(source, proxy, output)
  const gl = output.getContext('webgl2', glOptions)
  if (!gl || gl.isContextLost()) { source.remove(); proxy.remove(); output.remove(); throw failure('ASCII_GPU_CONTEXT', 'WebGL 2 is unavailable.') }

  const descriptors = [
    [ctx, 'drawElementImage'], [source, 'requestPaint'], [gl, 'drawArrays'], [gl, 'texImage2D'],
  ].map(([target, key]) => ({ target: target as object, key: key as string, old: Object.getOwnPropertyDescriptor(target, key as string) }))
  if (descriptors.some(item => item.old && !item.old.configurable)) { source.remove(); proxy.remove(); output.remove(); throw failure('ASCII_GPU_CONTEXT', 'The isolated GPU context cannot be observed.') }
  const nativeDraw = gl.drawArrays, nativeUpload = gl.texImage2D
  let effect: CanvasEffectInstance | null = null
  let closed = false, failing = false, latestRevision = 0, paintedRevision = 0, uploadedRevision = 0, notifiedRevision = 0
  let hasAtlas = false

  const restore = () => {
    const errors: unknown[] = []
    for (const item of descriptors) {
      try { if (item.old) Object.defineProperty(item.target, item.key, item.old); else Reflect.deleteProperty(item.target, item.key) }
      catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Unable to restore the private Canvas context.')
  }
  const dispose = () => {
    if (closed) return
    closed = true; output.style.opacity = '0'
    options.signal?.removeEventListener('abort', abort)
    output.removeEventListener('webglcontextlost', contextLost)
    const errors: unknown[] = []
    try { effect?.destroy() } catch (error) { errors.push(error) }
    effect = null
    try { restore() } catch (error) { errors.push(error) }
    try { if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext() } catch (error) { errors.push(error) }
    try { atlas.width = atlas.height = 0; source.width = source.height = 0 } catch (error) { errors.push(error) }
    source.remove(); proxy.remove(); output.remove()
    if (errors.length) throw new AggregateError(errors, 'Unable to release all ASCII GPU resources.')
  }
  const report = (error: unknown) => {
    if (closed || failing) return
    failing = true; output.style.opacity = '0'
    const original = error instanceof Error ? error : failure('ASCII_GPU_FAILED', 'The visual effect failed.', error)
    queueMicrotask(() => {
      if (closed) return
      let detail = original
      try { dispose() } catch (cleanupError) { detail = failure('ASCII_GPU_CLEANUP', 'The effect failed and cleanup was incomplete.', new AggregateError([original, cleanupError])) }
      onError(detail)
    })
  }
  function abort() { report(failure('ASCII_GPU_CANCELLED', 'The effect was cancelled.')) }
  function contextLost(event: Event) { event.preventDefault(); report(failure('ASCII_GPU_CONTEXT_LOST', 'The WebGL context was lost.')) }
  const checkGpu = (operation: string) => {
    if (gl.isContextLost()) throw failure('ASCII_GPU_CONTEXT_LOST', 'The WebGL context was lost.')
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw failure('ASCII_GPU_OPERATION', `${operation} failed (${error}).`)
  }

  try {
    Object.defineProperty(ctx, 'drawElementImage', { configurable: true, value: (node: Element, x: number, y: number) => {
      if (closed || failing || node !== proxy) throw failure('ASCII_GPU_SOURCE', 'The atlas proxy does not match.')
      paintedRevision = 0
      if (!hasAtlas) return
      ctx.drawImage(atlas, x, y, source.width, source.height)
      paintedRevision = latestRevision
    } })
    Object.defineProperty(source, 'requestPaint', { configurable: true, value: () => { if (!closed && !failing) source.onpaint?.() } })
    Object.defineProperty(gl, 'texImage2D', { configurable: true, writable: true, value: function (...args: unknown[]) {
      try {
        const result = Reflect.apply(nativeUpload, gl, args)
        if (args.at(-1) === source && paintedRevision && paintedRevision === latestRevision) { checkGpu('Texture upload'); uploadedRevision = paintedRevision }
        return result
      } catch (error) { if (args.at(-1) === source) report(error); throw error }
    } })
    Object.defineProperty(gl, 'drawArrays', { configurable: true, writable: true, value: function (...args: unknown[]) {
      try {
        const result = Reflect.apply(nativeDraw, gl, args)
        if (!closed && !failing && hasAtlas && uploadedRevision === latestRevision && latestRevision > notifiedRevision
          && args[0] === gl.TRIANGLE_STRIP && args[1] === 0 && args[2] === 4) {
          checkGpu('Frame draw')
          const revision = latestRevision
          queueMicrotask(() => {
            if (closed || failing || !hasAtlas || revision !== latestRevision || revision !== uploadedRevision || revision <= notifiedRevision) return
            notifiedRevision = revision
            try {
              onFrame(revision)
              if (!closed && !failing && hasAtlas && revision === latestRevision && revision === uploadedRevision) output.style.opacity = '1'
            } catch (error) { report(error) }
          })
        }
        return result
      } catch (error) { report(error); return undefined }
    } })
    output.addEventListener('webglcontextlost', contextLost)
    options.signal?.addEventListener('abort', abort, { once: true })
    effect = factory({ source, content: proxy, output }, {
      charset: 'ascii', baseStrength: 1, strength: 1, scale: 0.5, spacing: 0, contrast: 1, brightness: 0.09,
      background: 'auto', backgroundOpacity: 0, glow: 0, aberration: 0,
    })
    if (!effect || typeof effect.destroy !== 'function' || typeof effect.resize !== 'function' || typeof source.onpaint !== 'function') {
      throw failure('ASCII_GPU_FACTORY', 'The Asciify factory did not initialize its source and lifecycle.')
    }
    if (options.signal?.aborted || !stage.isConnected) throw failure('ASCII_GPU_CANCELLED', 'The effect was cancelled during initialization.')
  } catch (error) {
    try { dispose() } catch (cleanupError) { throw failure('ASCII_GPU_CLEANUP', 'The effect could not start or release its resources.', new AggregateError([error, cleanupError])) }
    throw error
  }

  return {
    output,
    update(bitmap, revision) {
      if (closed || failing) throw failure('ASCII_GPU_DISPOSED', 'The visual effect is not active.')
      if (!Number.isSafeInteger(revision) || revision <= latestRevision) throw failure('ASCII_GPU_REVISION', 'Atlas revisions must strictly increase.')
      if (!(bitmap instanceof win.HTMLCanvasElement) || bitmap.ownerDocument !== doc || !validSize(bitmap.width, bitmap.height)
        || Math.abs(bitmap.width * height - bitmap.height * width) > Math.max(bitmap.width, bitmap.height)) {
        const error = failure('ASCII_GPU_BITMAP', 'The atlas bitmap has an unsupported size, owner or aspect ratio.')
        report(error); throw error
      }
      output.style.opacity = '0'; hasAtlas = false; paintedRevision = 0; uploadedRevision = 0
      try {
        atlas.width = bitmap.width; atlas.height = bitmap.height
        atlasCtx.drawImage(bitmap, 0, 0)
        atlasCtx.getImageData(0, 0, 1, 1) // Refuse a tainted atlas before GPU upload.
        latestRevision = revision; hasAtlas = true
        source.requestPaint!()
        if (paintedRevision !== revision) throw failure('ASCII_GPU_PAINT', 'The Asciify source could not receive the atlas.')
      } catch (error) { report(error); throw error }
    },
    resize(nextWidth, nextHeight) {
      if (closed || failing) throw failure('ASCII_GPU_DISPOSED', 'The visual effect is not active.')
      if (!validSize(nextWidth, nextHeight)) throw failure('ASCII_GPU_SIZE', 'The effect size is outside the supported budget.')
      if (width === nextWidth && height === nextHeight) return
      output.style.opacity = '0'; hasAtlas = false; paintedRevision = 0; uploadedRevision = 0
      atlas.width = atlas.height = 0; width = nextWidth; height = nextHeight; sizeElements()
      try { effect!.resize!() } catch (error) { report(error); throw error }
    },
    dispose,
  }
}
