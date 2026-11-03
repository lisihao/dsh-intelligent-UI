/** A bounded, opt-in snapshot of an owned canvas, copied during its draw task. */
export interface AsciiVisualFrame { bitmap: HTMLCanvasElement; revision: number; width: number; height: number }
export type AsciiVisualFrameError = 'EMPTY_SOURCE' | 'FRAME_TOO_LARGE' | 'FRAME_BUDGET_EXCEEDED' | 'SNAPSHOT_UNAVAILABLE' | 'SNAPSHOT_TAINTED' | 'SNAPSHOT_FAILED' | 'SOURCE_RELEASED'
export const ASCII_FRAME_PIXEL_LIMIT = 4_000_000
export const ASCII_DOCUMENT_PIXEL_LIMIT = 16_000_000
export const ASCII_DOCUMENT_FRAME_LIMIT = 32

type DocumentScope = { subscribers: number; sources: Set<HTMLCanvasElement>; pixels: number }
type StoredFrame = AsciiVisualFrame & { scope: DocumentScope; document: Document }
const scopes = new WeakMap<Document, DocumentScope>()
const frames = new WeakMap<HTMLCanvasElement, StoredFrame>()
const revisions = new WeakMap<HTMLCanvasElement, number>()

function nextRevision(canvas: HTMLCanvasElement): number {
  const revision = (revisions.get(canvas) ?? 0) + 1
  revisions.set(canvas, revision)
  return revision
}
function emit(canvas: HTMLCanvasElement, name: string, detail: { revision: number; code?: AsciiVisualFrameError }): void {
  const document = canvas.ownerDocument
  const EventType = document.defaultView?.CustomEvent ?? globalThis.CustomEvent
  if (EventType) canvas.dispatchEvent(new EventType(name, { bubbles: true, composed: true, detail }))
  else {
    const event = document.createEvent('CustomEvent')
    event.initCustomEvent(name, true, false, detail)
    canvas.dispatchEvent(event)
  }
}
function forget(canvas: HTMLCanvasElement): boolean {
  const previous = frames.get(canvas)
  if (!previous) return false
  frames.delete(canvas)
  previous.scope.sources.delete(canvas)
  previous.scope.pixels -= previous.width * previous.height
  // Detach graphics backing storage promptly on failure, disposal and opt-out.
  previous.bitmap.width = 0; previous.bitmap.height = 0
  return true
}
function fail(canvas: HTMLCanvasElement, revision: number, code: AsciiVisualFrameError): void {
  forget(canvas)
  emit(canvas, 'iexp:visual-frame-error', { revision, code })
}

/** Every call owns one subscription; the last disposer releases this document's cache. */
export function subscribeAsciiVisualFrames(document: Document): () => void {
  let scope = scopes.get(document)
  if (!scope) { scope = { subscribers: 0, sources: new Set(), pixels: 0 }; scopes.set(document, scope) }
  const owned = scope
  owned.subscribers++
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--owned.subscribers !== 0) return
    for (const canvas of [...owned.sources]) forget(canvas)
    if (scopes.get(document) === owned) scopes.delete(document)
  }
}

/**
 * Publish synchronously after the source draw. A cached bitmap is reused on the
 * next draw: readers must consume it synchronously or ask for the latest frame.
 */
export function publishAsciiVisualFrame(canvas: HTMLCanvasElement): void {
  const scope = scopes.get(canvas.ownerDocument)
  if (!scope?.subscribers) { forget(canvas); return }
  const revision = nextRevision(canvas), width = canvas.width, height = canvas.height
  const previous = frames.get(canvas)
  if (previous && previous.scope !== scope) forget(canvas)
  if (!width || !height) { fail(canvas, revision, 'EMPTY_SOURCE'); return }
  if (width > ASCII_FRAME_PIXEL_LIMIT / height) { fail(canvas, revision, 'FRAME_TOO_LARGE'); return }
  const old = frames.get(canvas), pixels = width * height, oldPixels = old ? old.width * old.height : 0
  if (scope.pixels - oldPixels + pixels > ASCII_DOCUMENT_PIXEL_LIMIT || (!old && scope.sources.size >= ASCII_DOCUMENT_FRAME_LIMIT)) {
    fail(canvas, revision, 'FRAME_BUDGET_EXCEEDED'); return
  }
  let bitmap: HTMLCanvasElement | undefined = old?.bitmap
  try {
    bitmap ??= canvas.ownerDocument.createElement('canvas')
    if (bitmap.width !== width) bitmap.width = width
    if (bitmap.height !== height) bitmap.height = height
    const context = bitmap.getContext('2d')
    if (!context) { bitmap.width = 0; bitmap.height = 0; fail(canvas, revision, 'SNAPSHOT_UNAVAILABLE'); return }
    context.clearRect(0, 0, width, height)
    context.drawImage(canvas, 0, 0)
    // A tainted source can draw successfully; a one-pixel read detects it now.
    context.getImageData(0, 0, 1, 1)
    scope.pixels += pixels - oldPixels
    scope.sources.add(canvas)
    frames.set(canvas, { bitmap, revision, width, height, scope, document: canvas.ownerDocument })
    emit(canvas, 'iexp:visual-frame', { revision })
  } catch (error) {
    if (bitmap && bitmap !== old?.bitmap) { bitmap.width = 0; bitmap.height = 0 }
    const code = error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError' ? 'SNAPSHOT_TAINTED' : 'SNAPSHOT_FAILED'
    fail(canvas, revision, code)
  }
}

export function readAsciiVisualFrame(canvas: HTMLCanvasElement): AsciiVisualFrame | undefined {
  const frame = frames.get(canvas)
  if (!frame) return undefined
  if (frame.document !== canvas.ownerDocument || frame.width !== canvas.width || frame.height !== canvas.height) { releaseAsciiVisualFrame(canvas); return undefined }
  return { bitmap: frame.bitmap, revision: frame.revision, width: frame.width, height: frame.height }
}

/** Disabling, context loss and disposal can never leave a previously read cache active. */
export function releaseAsciiVisualFrame(canvas: HTMLCanvasElement): void {
  if (forget(canvas)) emit(canvas, 'iexp:visual-frame-error', { revision: nextRevision(canvas), code: 'SOURCE_RELEASED' })
}
