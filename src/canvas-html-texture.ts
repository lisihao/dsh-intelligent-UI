import { createContext, destroyContext, domToCanvas } from 'modern-screenshot'

/**
 * Bounded, visual-only HTML-in-canvas fallback. The caller must keep the real
 * source visible and interactive; the texture is not a replacement for it.
 * This adapter neither loads nor isolates any Canvas UI effect factory.
 */
export type CanvasHtmlTextureErrorCode =
  | 'reduced-motion' | 'unsupported' | 'unsafe-content' | 'too-large'
  | 'detached' | 'sandbox' | 'capture' | 'disposed' | 'busy'

export class CanvasHtmlTextureError extends Error {
  constructor(readonly code: CanvasHtmlTextureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasHtmlTextureError'
  }
}

type PaintableCanvas = HTMLCanvasElement & { requestPaint?: () => void, onpaint?: (() => void) | null }
type ElementImageContext = CanvasRenderingContext2D & { drawElementImage?: (element: Element, x: number, y: number) => void }

export interface CanvasHtmlTextureOptions {
  readonly source: HTMLCanvasElement
  readonly content: HTMLElement
  /** The caller guarantees that the original source remains present and readable. */
  readonly sourceRemainsVisible: true
  /** Only a non-interactive decorative representation is eligible. */
  readonly scope: 'visual-only'
  /** Failures leave the original source visible and are reported here. */
  readonly onError: (error: CanvasHtmlTextureError) => void
}

export interface CanvasHtmlTextureBridge {
  /** Re-capture after an external theme change; rejects if capture is unsafe or fails. */
  refresh(): Promise<void>
  /** Restores only this canvas instance and removes its sandbox and observers. */
  dispose(): void
  /** Resolves after a disposed bridge's in-flight capture releases its quota. */
  whenDisposed?(): Promise<void>
}

const ELEMENTS = new Set(['DIV', 'SECTION', 'ARTICLE', 'P', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BR', 'PRE', 'CODE'])
const INTERACTIVE_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox'])
const RESOURCE_STYLE = /(?:url\s*\(|image-set\s*\(|(?:^|[\s,(])src\s*\(|@import|expression\s*\()/iu
const MAX_ELEMENTS = 128
const MAX_TEXT_LENGTH = 16_384
const MAX_DIMENSION = 2048
const MAX_PIXELS = 2_097_152
const MAX_ACTIVE = 2
const MIN_AUTOMATIC_INTERVAL_MS = 250
const SNAPSHOT_CSP = "default-src 'none'; connect-src 'none'; font-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'none'"
let activeBridges = 0

interface SnapshotNode {
  readonly tag: string
  readonly styles: readonly (readonly [string, string])[]
  readonly children: readonly (SnapshotNode | string)[]
}

interface SnapshotTree {
  readonly width: number
  readonly height: number
  readonly tree: SnapshotNode
}

/** Follow every same-origin embedding frame; unverifiable boundaries fail closed. */
function visibilityChain(root: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  const documents = new Set<Document>()
  let current: HTMLElement = root
  while (true) {
    const doc = current.ownerDocument
    const view = doc.defaultView
    if (!current.isConnected || !view || !doc.documentElement || documents.has(doc)) {
      throw new CanvasHtmlTextureError('detached', 'The source or its embedding frame is no longer attached.')
    }
    documents.add(doc)
    if (documents.size > 16) throw new CanvasHtmlTextureError('unsafe-content', 'The source has too many embedding frames.')
    let last: HTMLElement | null = null
    for (let element: HTMLElement | null = current; element; element = element.parentElement) {
      if (element.assignedSlot) throw new CanvasHtmlTextureError('unsafe-content', 'The source visibility cannot be verified across a slot.')
      chain.push(element)
      last = element
    }
    if (last !== doc.documentElement) throw new CanvasHtmlTextureError('unsafe-content', 'The source visibility cannot be verified across this boundary.')
    try {
      if (view.document !== doc) throw new Error('Inactive document')
      if (view.parent === view) return chain
      const embedding = view.frameElement
      if (!embedding || embedding.namespaceURI !== 'http://www.w3.org/1999/xhtml'
        || !['IFRAME', 'FRAME'].includes(embedding.tagName)
        || view.parent.document !== embedding.ownerDocument
        || (embedding as HTMLIFrameElement).contentDocument !== doc) throw new Error('Inaccessible embedding frame')
      current = embedding as HTMLElement
    } catch (error) {
      throw new CanvasHtmlTextureError('unsafe-content', 'The source visibility cannot be verified across its embedding frame.', { cause: error })
    }
  }
}

/** Capture a small, simple, non-interactive source as inert data before cloning. */
export function readCanvasHtmlTextureSource(root: HTMLElement): SnapshotTree {
  if (!root.isConnected || !root.ownerDocument.defaultView) throw new CanvasHtmlTextureError('detached', 'The source is no longer attached.')
  const win = root.ownerDocument.defaultView
  let effectiveOpacity = 1
  for (const ancestor of visibilityChain(root)) {
    const ownerWindow = ancestor.ownerDocument.defaultView
    if (!ownerWindow) throw new CanvasHtmlTextureError('detached', 'An embedding frame is no longer attached.')
    const inherited = ownerWindow.getComputedStyle(ancestor)
    const opacity = Number(inherited.opacity || 1)
    if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true'
      || inherited.display === 'none' || inherited.visibility === 'hidden' || inherited.visibility === 'collapse'
      || inherited.contentVisibility === 'hidden' || !Number.isFinite(opacity)) {
      throw new CanvasHtmlTextureError('unsafe-content', 'The original source must remain visible and accessible.')
    }
    effectiveOpacity *= opacity
  }
  if (effectiveOpacity < 0.5) throw new CanvasHtmlTextureError('unsafe-content', 'The original source must remain readable.')
  const rect = root.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1
    || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new CanvasHtmlTextureError('too-large', 'The visual source has unsupported dimensions.')
  }
  let count = 0
  let textLength = 0
  const read = (element: Element): SnapshotNode => {
    if (++count > MAX_ELEMENTS) throw new CanvasHtmlTextureError('too-large', 'The visual source has too many elements.')
    if (!ELEMENTS.has(element.tagName) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      || element.shadowRoot || element.hasAttribute('contenteditable') || element.hasAttribute('tabindex')
      || element.hasAttribute('draggable') || [...element.attributes].some(attribute => /^on/iu.test(attribute.name))) {
      throw new CanvasHtmlTextureError('unsafe-content', 'This visual source contains an unsupported or interactive element.')
    }
    const role = element.getAttribute('role')?.toLowerCase().trim()
    if (role && INTERACTIVE_ROLES.has(role)) throw new CanvasHtmlTextureError('unsafe-content', 'Interactive content cannot be captured.')
    const style = win.getComputedStyle(element)
    if (['fixed', 'sticky'].includes(style.position) || (style.transform && style.transform !== 'none')
      || element.scrollLeft !== 0 || element.scrollTop !== 0) {
      throw new CanvasHtmlTextureError('unsafe-content', 'This visual source requires unsupported geometry.')
    }
    if (((style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth)
      || ((style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight)) {
      throw new CanvasHtmlTextureError('unsafe-content', 'Scrollable content cannot be captured.')
    }
    for (const pseudo of ['::before', '::after']) {
      const value = win.getComputedStyle(element, pseudo).content
      if (value && value !== 'none' && value !== 'normal') throw new CanvasHtmlTextureError('unsafe-content', 'Generated content cannot be captured safely.')
    }
    const styles: Array<readonly [string, string]> = []
    for (let index = 0; index < style.length; index++) {
      const name = style.item(index)
      if (!name || name.startsWith('--') || name.startsWith('animation') || name.startsWith('transition')
        || name === 'pointer-events' || name === 'caret-color' || name === 'content') continue
      const value = style.getPropertyValue(name)
      if (RESOURCE_STYLE.test(value)) throw new CanvasHtmlTextureError('unsafe-content', 'Resources in visual styles are not supported.')
      styles.push([name, value])
    }
    const children: Array<SnapshotNode | string> = []
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        const value = child.nodeValue ?? ''
        textLength += value.length
        if (textLength > MAX_TEXT_LENGTH) throw new CanvasHtmlTextureError('too-large', 'The visual source has too much text.')
        children.push(value)
      } else if (child.nodeType === 1) children.push(read(child as Element))
      else if (child.nodeType !== 8) throw new CanvasHtmlTextureError('unsafe-content', 'This visual source contains unsupported nodes.')
    }
    return { tag: element.tagName.toLowerCase(), styles, children }
  }
  return { width, height, tree: read(root) }
}

function createInertTree(doc: Document, snapshot: SnapshotTree): HTMLElement {
  const make = (node: SnapshotNode): HTMLElement => {
    const result = doc.createElement(node.tag)
    for (const [name, value] of node.styles) result.style.setProperty(name, value, 'important')
    result.style.setProperty('animation', 'none', 'important')
    result.style.setProperty('transition', 'none', 'important')
    result.style.setProperty('pointer-events', 'none', 'important')
    for (const child of node.children) result.append(typeof child === 'string' ? doc.createTextNode(child) : make(child))
    return result
  }
  const result = make(snapshot.tree)
  result.style.setProperty('box-sizing', 'border-box', 'important')
  result.style.setProperty('width', `${snapshot.width}px`, 'important')
  result.style.setProperty('height', `${snapshot.height}px`, 'important')
  result.style.setProperty('margin', '0', 'important')
  result.style.setProperty('position', 'relative', 'important')
  for (const side of ['top', 'right', 'bottom', 'left']) result.style.setProperty(side, 'auto', 'important')
  return result
}

function clearBitmap(canvas: HTMLCanvasElement | undefined): void {
  if (canvas) { canvas.width = 0; canvas.height = 0 }
}

function normalizeError(error: unknown): CanvasHtmlTextureError {
  return error instanceof CanvasHtmlTextureError ? error : new CanvasHtmlTextureError('capture', 'Unable to capture this visual source.', { cause: error })
}

/** Installs APIs only on the supplied canvas/context, never on browser prototypes. */
export function createCanvasHtmlTextureBridge(options: CanvasHtmlTextureOptions): CanvasHtmlTextureBridge {
  const { source, content, onError } = options
  if (options.scope !== 'visual-only' || options.sourceRemainsVisible !== true) throw new CanvasHtmlTextureError('unsafe-content', 'The original source must remain visible.')
  if (!source.ownerDocument.defaultView || source.ownerDocument !== content.ownerDocument) throw new CanvasHtmlTextureError('unsupported', 'Source and texture must share one document.')
  if (!source.isConnected || !source.ownerDocument.body?.isConnected) throw new CanvasHtmlTextureError('detached', 'The source canvas and document must remain attached.')
  const win = source.ownerDocument.defaultView
  if (typeof win.matchMedia !== 'function' || typeof win.ResizeObserver !== 'function' || typeof win.MutationObserver !== 'function') {
    throw new CanvasHtmlTextureError('unsupported', 'The browser cannot observe this visual source.')
  }
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)')
  if (motion.matches) throw new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.')
  if (activeBridges >= MAX_ACTIVE) throw new CanvasHtmlTextureError('busy', 'The visual effect limit has been reached.')
  const ctx = source.getContext('2d') as ElementImageContext | null
  const paintable = source as PaintableCanvas
  if (!ctx || typeof ctx.drawElementImage === 'function' || typeof paintable.requestPaint === 'function') {
    throw new CanvasHtmlTextureError('unsupported', 'A compatible native canvas is unavailable or already present.')
  }
  // Validate before making a temporary document or changing the supplied canvas.
  readCanvasHtmlTextureSource(content)
  const originalDraw = Object.getOwnPropertyDescriptor(ctx, 'drawElementImage')
  const originalRequest = Object.getOwnPropertyDescriptor(source, 'requestPaint')
  if ((originalDraw && !originalDraw.configurable) || (originalRequest && !originalRequest.configurable)) {
    throw new CanvasHtmlTextureError('unsupported', 'The source canvas cannot be adapted.')
  }
  activeBridges++
  let alive = true
  let released = false
  let resolveDisposed!: () => void
  const disposed = new Promise<void>(resolve => { resolveDisposed = resolve })
  let dirty = false
  let revision = 0
  let current: HTMLCanvasElement | undefined
  let inFlight: Promise<void> | undefined
  let iframe: HTMLIFrameElement | undefined
  let framePromise: Promise<Document> | undefined
  let cancelFrame: (() => void) | undefined
  let observer: MutationObserver | undefined
  let resize: ResizeObserver | undefined
  let scheduled: number | undefined
  let cancelWait: (() => void) | undefined
  let immediate = false
  let lastCaptureStart = Number.NEGATIVE_INFINITY
  let observedAncestors = new Set<Node>()

  const observeVisibility = (chain: readonly HTMLElement[]) => {
    if (!observer) return
    observer.disconnect()
    observer.observe(content, { subtree: true, childList: true, characterData: true, attributes: true })
    observedAncestors = new Set(chain)
    for (const ancestor of chain) {
      if (ancestor !== content) observer.observe(ancestor, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'] })
    }
  }

  const release = () => {
    if (!released && !alive && !inFlight) { released = true; activeBridges--; resolveDisposed() }
  }
  const clearTexture = () => {
    clearBitmap(current)
    current = undefined
    try { ctx.clearRect(0, 0, source.width, source.height) } catch { /* original source stays visible */ }
    try { paintable.onpaint?.() } catch { /* the caller retains the original source */ }
  }
  const frame = (): Promise<Document> => {
    if (framePromise) return framePromise
    framePromise = new Promise((resolve, reject) => {
      const element = source.ownerDocument.createElement('iframe')
      iframe = element
      let settled = false
      const timer = win.setTimeout(() => fail('The isolated texture sandbox timed out.'), 5_000)
      const finish = () => {
        settled = true
        win.clearTimeout(timer)
        element.onload = null
        element.onerror = null
        cancelFrame = undefined
      }
      const fail = (message: string) => {
        if (settled) return
        finish()
        element.remove()
        if (iframe === element) iframe = undefined
        framePromise = undefined
        reject(new CanvasHtmlTextureError('sandbox', message))
      }
      cancelFrame = () => fail('The isolated texture sandbox was closed.')
      element.setAttribute('sandbox', 'allow-same-origin')
      element.setAttribute('aria-hidden', 'true')
      element.tabIndex = -1
      element.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
      element.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}"><style>html,body{margin:0;padding:0}</style><body></body>`
      element.onload = () => {
        const doc = element.contentDocument
        const policy = doc?.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
        if (!alive || !doc?.body || policy !== SNAPSHOT_CSP) fail('The isolated texture sandbox could not be opened.')
        else if (!settled) { finish(); resolve(doc) }
      }
      element.onerror = () => fail('The isolated texture sandbox could not be opened.')
      try { source.ownerDocument.body.append(element) } catch { fail('The isolated texture sandbox could not be attached.') }
    })
    return framePromise
  }

  const capture = async (version: number): Promise<void> => {
    if (!source.isConnected || !source.ownerDocument.body?.isConnected) throw new CanvasHtmlTextureError('detached', 'The source canvas and document must remain attached.')
    observeVisibility(visibilityChain(content))
    const snapshot = readCanvasHtmlTextureSource(content)
    const doc = await frame()
    if (!alive) throw new CanvasHtmlTextureError('disposed', 'The visual effect was closed.')
    if (!iframe) throw new CanvasHtmlTextureError('sandbox', 'The isolated texture sandbox is unavailable.')
    iframe.style.width = `${snapshot.width}px`
    iframe.style.height = `${snapshot.height}px`
    const target = createInertTree(doc, snapshot)
    doc.body.replaceChildren(target)
    let captureContext: Awaited<ReturnType<typeof createContext>> | undefined
    let next: HTMLCanvasElement | undefined
    try {
      captureContext = await createContext(target, {
        width: snapshot.width, height: snapshot.height, scale: 1, maximumCanvasSize: MAX_DIMENSION,
        font: false, timeout: 3_000, fetch: { placeholderImage: '' },
        fetchFn: async () => { throw new Error('External resources are disabled for visual textures.') },
        workerNumber: 0,
      })
      next = await domToCanvas(captureContext)
      if (next.width !== snapshot.width || next.height !== snapshot.height) {
        clearBitmap(next)
        throw new CanvasHtmlTextureError('capture', 'The captured visual size does not match the source.')
      }
      if (!alive || version !== revision) { clearBitmap(next); return }
      const previous = current
      current = next
      clearBitmap(previous)
      paintable.onpaint?.()
    } finally {
      try { if (captureContext) destroyContext(captureContext) } finally { target.remove() }
    }
  }

  const enqueue = (manual: boolean): Promise<void> => {
    if (!alive) return Promise.reject(new CanvasHtmlTextureError('disposed', 'The visual effect was closed.'))
    dirty = true
    if (manual) { immediate = true; cancelWait?.() }
    revision++
    if (!inFlight) {
      inFlight = (async () => {
        while (dirty && alive) {
          const delay = immediate ? 0 : Math.max(0, lastCaptureStart + MIN_AUTOMATIC_INTERVAL_MS - win.performance.now())
          if (delay > 0) await new Promise<void>(resolve => {
            const done = () => {
              if (scheduled !== undefined) win.clearTimeout(scheduled)
              scheduled = undefined
              cancelWait = undefined
              resolve()
            }
            cancelWait = done
            scheduled = win.setTimeout(done, delay)
          })
          if (!alive) break
          dirty = false
          immediate = false
          lastCaptureStart = win.performance.now()
          const version = revision
          try { await capture(version) } catch (error) {
            if (!alive) break
            const failure = normalizeError(error)
            clearTexture()
            onError(failure)
            throw failure
          }
        }
      })().finally(() => { inFlight = undefined; release() })
    }
    return inFlight
  }
  const refresh = () => enqueue(true)
  const queueRefresh = () => {
    if (alive) void enqueue(false).catch(() => {})
  }
  const onMutation: MutationCallback = records => {
    if (!alive) return
    const visibilityChanged = records.some(record =>
      (record.type === 'attributes' && observedAncestors.has(record.target))
      || (record.type === 'childList' && [...record.removedNodes].some(node => observedAncestors.has(node))))
    if (visibilityChanged) clearTexture()
    if (visibilityChanged || records.some(record => record.type !== 'childList' || content.contains(record.target))) queueRefresh()
  }
  const draw = (element: Element, x: number, y: number) => {
    if (!alive || element !== content) throw new CanvasHtmlTextureError('unsafe-content', 'The visual source does not match this texture.')
    if (current) ctx.drawImage(current, x, y, source.width, source.height)
  }
  const request = () => queueRefresh()
  const onMotion = () => {
    if (motion.matches) {
      try { onError(new CanvasHtmlTextureError('reduced-motion', 'Animation is disabled by the system preference.')) }
      finally { dispose() }
    }
  }
  function dispose() {
    if (!alive) return
    alive = false
    observer?.disconnect()
    resize?.disconnect()
    motion.removeEventListener('change', onMotion)
    cancelWait?.()
    if (paintable.requestPaint === request) {
      if (originalRequest) Object.defineProperty(source, 'requestPaint', originalRequest)
      else delete paintable.requestPaint
    }
    if (ctx?.drawElementImage === draw) {
      if (originalDraw) Object.defineProperty(ctx, 'drawElementImage', originalDraw)
      else delete ctx.drawElementImage
    }
    clearBitmap(current)
    current = undefined
    cancelFrame?.()
    iframe?.remove()
    release()
  }
  try {
    observer = new win.MutationObserver(onMutation)
    resize = new win.ResizeObserver(queueRefresh)
    Object.defineProperty(ctx, 'drawElementImage', { configurable: true, value: draw })
    Object.defineProperty(source, 'requestPaint', { configurable: true, value: request })
    observeVisibility(visibilityChain(content))
    resize.observe(content)
    motion.addEventListener('change', onMotion)
  } catch (error) {
    dispose()
    throw normalizeError(error)
  }
  return { refresh, dispose, whenDisposed: () => disposed }
}
