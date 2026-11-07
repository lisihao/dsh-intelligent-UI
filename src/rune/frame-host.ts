import {
  createRuneNonce,
  parseRuneFrameMessage,
  runeConnectMessage,
  runeDisposeMessage,
  runePayloadMessage,
  type RuneFrameMessage,
  type RuneMaterialPayload,
} from './contracts.js'

export interface RunePortLike {
  postMessage(message: unknown): void
  onmessage: ((event: { readonly data: unknown }) => void) | null
  start?(): void
  close?(): void
  /** Native transferable port when this is an adapter around MessagePort. */
  readonly transfer?: unknown
}
export interface RuneChannelLike { readonly port1: RunePortLike, readonly port2: RunePortLike }
export interface RuneFrameWindowLike { postMessage(message: unknown, targetOrigin: string, transfer?: readonly unknown[]): void }

export type RuneFrameEvent =
  | Readonly<{ readonly kind: 'ready' }>
  | Readonly<{ readonly kind: 'mounted', readonly revision: number }>
  | Readonly<{ readonly kind: 'updated', readonly revision: number }>
  | Readonly<{ readonly kind: 'disposed', readonly revision: number }>
  | Readonly<{ readonly kind: 'error', readonly revision: number, readonly code: string }>

/**
 * The host-side half of the opaque Rune realm.  Only the initial capability
 * transfer uses the opaque-frame exception described in `connect`; all
 * material data travels
 * on this nonce-bound MessagePort after the frame confirms readiness.
 */
export class RuneFrameHost {
  readonly nonce: string
  private readonly pending: ReturnType<typeof runePayloadMessage>[] = []
  private port: RunePortLike | undefined
  private connected = false
  private ready = false
  private closed = false
  private disposing = false
  private revision = 0
  private disposeRevision: number | undefined

  constructor(
    private readonly frame: RuneFrameWindowLike,
    private readonly parentOrigin: string,
    private readonly frameOrigin: string,
    private readonly channelFactory: () => RuneChannelLike,
    private readonly onEvent: (event: RuneFrameEvent) => void,
    nonce = createRuneNonce(),
  ) {
    this.nonce = nonce
  }

  connect(): void {
    if (this.closed) return
    if (this.connected) throw new Error('RUNE_FRAME_ALREADY_CONNECTED')
    this.connected = true
    const channel = this.channelFactory()
    this.port = channel.port1
    this.port.onmessage = event => this.receive(event.data)
    this.port.start?.()
    if (!/^https?:\/\/[^/]+$/u.test(this.frameOrigin)) throw new Error('RUNE_FRAME_ORIGIN_INVALID')
    // `sandbox="allow-scripts"` intentionally gives this fixed realm an
    // opaque origin, so a concrete target origin cannot deliver this one
    // transferable-port bootstrap. The frame validates event.source,
    // parentOrigin, nonce and every later port revision before accepting it.
    this.frame.postMessage(runeConnectMessage(this.nonce, this.parentOrigin), '*', [channel.port2.transfer ?? channel.port2])
  }

  mount(payload: RuneMaterialPayload): number { return this.send('rune/mount', payload) }
  update(payload: RuneMaterialPayload): number { return this.send('rune/update', payload) }

  /**
   * Delivers Rust's `dispose()` request before the owner tears down the iframe.
   * The caller keeps the port open until `rune/disposed` or a short timeout,
   * rather than closing it synchronously and losing the queued command.
   */
  requestDispose(): number | undefined {
    if (this.closed || this.disposing) return this.disposeRevision
    this.disposing = true
    this.pending.length = 0
    if (this.port && this.ready) {
      this.revision += 1
      this.disposeRevision = this.revision
      this.port.postMessage(runeDisposeMessage(this.nonce, this.revision))
      return this.disposeRevision
    }
    return undefined
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending.length = 0
    this.port?.close?.()
    this.port = undefined
    this.ready = false
  }

  /** Backward-compatible immediate close for callers that cannot retain a frame. */
  dispose(): void {
    this.requestDispose()
    this.close()
  }

  isReady(): boolean { return this.ready && !this.closed }

  private send(type: 'rune/mount' | 'rune/update', payload: RuneMaterialPayload): number {
    if (this.closed || this.disposing) throw new Error('RUNE_FRAME_CLOSED')
    this.revision += 1
    const message = runePayloadMessage(type, this.nonce, this.revision, payload)
    if (!this.ready || !this.port) this.pending.push(message)
    else this.port.postMessage(message)
    return this.revision
  }

  private receive(value: unknown): void {
    if (this.closed) return
    let message: RuneFrameMessage | undefined
    try { message = parseRuneFrameMessage(value, this.nonce) }
    catch { return }
    if (!message) return
    if (message.type === 'rune/ready') {
      if (this.ready) return
      this.ready = true
      this.onEvent({ kind: 'ready' })
      for (const pending of this.pending.splice(0)) this.port?.postMessage(pending)
      return
    }
    if (message.revision > this.revision) return
    if (message.type === 'rune/mounted') this.onEvent({ kind: 'mounted', revision: message.revision })
    else if (message.type === 'rune/updated') this.onEvent({ kind: 'updated', revision: message.revision })
    else if (message.type === 'rune/disposed') this.onEvent({ kind: 'disposed', revision: message.revision })
    else if (message.type === 'rune/error') this.onEvent({ kind: 'error', revision: message.revision, code: message.code! })
  }
}

class BrowserRunePort implements RunePortLike {
  private handler: ((event: { readonly data: unknown }) => void) | null = null

  constructor(private readonly native: MessagePort) {}

  get onmessage(): ((event: { readonly data: unknown }) => void) | null {
    return this.handler
  }

  set onmessage(handler: ((event: { readonly data: unknown }) => void) | null) {
    this.handler = handler
    this.native.onmessage = handler ? event => handler({ data: event.data }) : null
  }

  get transfer(): MessagePort { return this.native }
  postMessage(message: unknown): void { this.native.postMessage(message) }
  start(): void { this.native.start() }
  close(): void { this.native.close() }
}

/** Uses real browser MessagePorts while retaining a small testable host interface. */
export function createBrowserRuneChannel(): RuneChannelLike {
  const channel = new MessageChannel()
  return Object.freeze({ port1: new BrowserRunePort(channel.port1), port2: new BrowserRunePort(channel.port2) })
}
