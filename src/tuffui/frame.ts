import {
  TUFFUI_PROTOCOL_VERSION,
  TuffUiContractError,
  assertTuffUiActionId,
  assertTuffUiNonce,
  assertTuffUiRevision,
  assertTuffUiJson,
  type TuffUiFrameToHostMessage,
  type TuffUiHostToFrameMessage,
  type TuffUiJson,
  type TuffUiMount,
} from './contracts.js'
import { validateTuffUiMount, type TuffUiCatalog } from './catalog.js'

export interface TuffUiWindowLike { postMessage(message: unknown, targetOrigin: string, transfer?: readonly unknown[]): void }
export interface TuffUiMessageEventLike { readonly origin: string, readonly source: unknown, readonly data: unknown }
export interface TuffUiPortEventLike { readonly data: unknown }
export interface TuffUiPortLike {
  postMessage(message: unknown): void
  onmessage: ((event: TuffUiPortEventLike) => void) | null
  start?(): void
  close?(): void
  /** Native transferable port when this is an adapter around MessagePort. */
  readonly transfer?: unknown
}
export interface TuffUiChannelLike { readonly port1: TuffUiPortLike, readonly port2: TuffUiPortLike }

export type TuffUiFrameEvent =
  | Readonly<{ readonly kind: 'mounted', readonly mountId: string, readonly revision: number }>
  | Readonly<{ readonly kind: 'disposed', readonly mountId: string, readonly revision: number }>
  | Readonly<{ readonly kind: 'action', readonly mountId: string, readonly revision: number, readonly actionId: string, readonly payload: TuffUiJson }>
  | Readonly<{ readonly kind: 'resize', readonly mountId: string, readonly revision: number, readonly height: number }>
  | Readonly<{ readonly kind: 'error', readonly mountId: string, readonly revision: number, readonly code: string, readonly message: string }>

type ActiveMount = Readonly<{ readonly mount: TuffUiMount, readonly revision: number }>

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', `${label} must be an object.`)
  return value as Record<string, unknown>
}

function frameMessage(value: unknown): TuffUiFrameToHostMessage {
  const raw = record(value, 'frame message')
  if (raw.protocolVersion !== TUFFUI_PROTOCOL_VERSION || !['tuffui/mounted', 'tuffui/action', 'tuffui/error', 'tuffui/disposed', 'tuffui/resize'].includes(String(raw.type))) throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Frame message has an unsupported type or protocol.')
  assertTuffUiNonce(raw.nonce)
  if (typeof raw.mountId !== 'string') throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Frame message has no mount id.')
  assertTuffUiRevision(raw.revision)
  if (raw.type === 'tuffui/action') { assertTuffUiActionId(raw.actionId, 'frame action'); assertTuffUiJson(raw.payload, 'frame action payload') }
  if (raw.type === 'tuffui/error' && (typeof raw.code !== 'string' || typeof raw.message !== 'string' || raw.code.length > 120 || raw.message.length > 4_000)) throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Frame error is invalid.')
  if (raw.type === 'tuffui/resize' && (!Number.isSafeInteger(raw.height) || Number(raw.height) < 1 || Number(raw.height) > 20_000)) throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Frame resize height is invalid.')
  return raw as TuffUiFrameToHostMessage
}

/** Host-side bridge.  It sends data but never runs an action received from a frame. */
export class TuffUiFrameHost {
  private readonly active = new Map<string, ActiveMount>()
  constructor(
    private readonly catalog: TuffUiCatalog,
    private readonly frame: TuffUiWindowLike,
    private readonly expectedOrigin: string,
    private readonly nonce: string,
  ) {
    if (expectedOrigin === '*' || !/^https?:\/\/[^/]+$/u.test(expectedOrigin)) throw new TuffUiContractError('TUFFUI_FRAME_ORIGIN_INVALID', 'Frame origin must be one explicit http(s) origin.')
    assertTuffUiNonce(nonce)
  }

  mount(value: unknown): TuffUiMount {
    const mount = validateTuffUiMount(this.catalog, value)
    if (this.active.has(mount.mountId)) throw new TuffUiContractError('TUFFUI_MOUNT_DUPLICATE', `Mount ${mount.mountId} is already active.`)
    const active = { mount, revision: 1 }
    this.active.set(mount.mountId, active)
    this.send({ type: 'tuffui/mount', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mount, revision: 1 })
    return mount
  }

  update(value: unknown): TuffUiMount {
    const mount = validateTuffUiMount(this.catalog, value)
    const previous = this.active.get(mount.mountId)
    if (!previous) throw new TuffUiContractError('TUFFUI_MOUNT_MISSING', `Mount ${mount.mountId} is not active.`)
    if (previous.mount.componentId !== mount.componentId) throw new TuffUiContractError('TUFFUI_MOUNT_COMPONENT_CHANGED', 'A mount id cannot change component.')
    const revision = previous.revision + 1
    this.active.set(mount.mountId, { mount, revision })
    this.send({ type: 'tuffui/update', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mount, revision })
    return mount
  }

  dispose(mountId: string): void {
    const previous = this.active.get(mountId)
    if (!previous) return
    const revision = previous.revision + 1
    this.active.delete(mountId)
    this.send({ type: 'tuffui/dispose', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mountId, revision })
  }

  receive(event: TuffUiMessageEventLike): TuffUiFrameEvent | undefined {
    if (event.origin !== this.expectedOrigin || event.source !== this.frame) return undefined
    const message = frameMessage(event.data)
    if (message.nonce !== this.nonce) return undefined
    const active = this.active.get(message.mountId)
    if (!active || message.revision !== active.revision) return undefined
    if (message.type === 'tuffui/mounted') return { kind: 'mounted', mountId: message.mountId, revision: message.revision }
    if (message.type === 'tuffui/disposed') return { kind: 'disposed', mountId: message.mountId, revision: message.revision }
    if (message.type === 'tuffui/error') return { kind: 'error', mountId: message.mountId, revision: message.revision, code: message.code!, message: message.message! }
    if (message.type === 'tuffui/resize') return { kind: 'resize', mountId: message.mountId, revision: message.revision, height: message.height! }
    const action = active.mount.binding.actions?.find(item => item.actionId === message.actionId)
    if (!action) return undefined
    return { kind: 'action', mountId: message.mountId, revision: message.revision, actionId: action.actionId, payload: message.payload! }
  }

  private send(message: TuffUiHostToFrameMessage): void { this.frame.postMessage(Object.freeze(message), this.expectedOrigin) }
}

/**
 * Preferred production transport for an opaque `sandbox="allow-scripts"`
 * realm. `*` is used exactly once to transfer an unguessable MessagePort to
 * an opaque-origin frame; every later message travels over that capability and
 * still carries the per-mount nonce/revision checks.
 */
export class TuffUiPortFrameHost {
  private readonly active = new Map<string, ActiveMount>()
  private readonly pending: TuffUiHostToFrameMessage[] = []
  private port: TuffUiPortLike | undefined
  private ready = false
  private connected = false

  constructor(
    private readonly catalog: TuffUiCatalog,
    private readonly frame: TuffUiWindowLike,
    private readonly parentOrigin: string,
    private readonly nonce: string,
    private readonly channelFactory: () => TuffUiChannelLike,
    private readonly onEvent?: (event: TuffUiFrameEvent) => void,
  ) {
    if (!/^https?:\/\/[^/]+$/u.test(parentOrigin)) throw new TuffUiContractError('TUFFUI_PARENT_ORIGIN_INVALID', 'Opaque realm parent origin must be one explicit http(s) origin.')
    assertTuffUiNonce(nonce)
  }

  /** Call only after the iframe element has loaded its URL containing parentOrigin. */
  connect(): void {
    if (this.connected) throw new TuffUiContractError('TUFFUI_PORT_ALREADY_CONNECTED', 'The opaque realm port has already been connected.')
    this.connected = true
    const channel = this.channelFactory()
    this.port = channel.port1
    this.port.onmessage = event => { const received = this.receive(event.data); if (received) this.onEvent?.(received) }
    this.port.start?.()
    // An opaque sandbox has origin "null", so a concrete targetOrigin cannot
    // be used for this one capability transfer. The realm separately verifies
    // event.source, the URL-bound parent origin, and this nonce before keeping it.
    this.frame.postMessage(Object.freeze({ type: 'tuffui/connect', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, parentOrigin: this.parentOrigin }), '*', [channel.port2.transfer ?? channel.port2])
  }

  mount(value: unknown): TuffUiMount {
    const mount = validateTuffUiMount(this.catalog, value)
    if (this.active.has(mount.mountId)) throw new TuffUiContractError('TUFFUI_MOUNT_DUPLICATE', `Mount ${mount.mountId} is already active.`)
    this.active.set(mount.mountId, { mount, revision: 1 })
    this.send({ type: 'tuffui/mount', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mount, revision: 1 })
    return mount
  }

  update(value: unknown): TuffUiMount {
    const mount = validateTuffUiMount(this.catalog, value)
    const previous = this.active.get(mount.mountId)
    if (!previous) throw new TuffUiContractError('TUFFUI_MOUNT_MISSING', `Mount ${mount.mountId} is not active.`)
    if (previous.mount.componentId !== mount.componentId) throw new TuffUiContractError('TUFFUI_MOUNT_COMPONENT_CHANGED', 'A mount id cannot change component.')
    const revision = previous.revision + 1
    this.active.set(mount.mountId, { mount, revision })
    this.send({ type: 'tuffui/update', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mount, revision })
    return mount
  }

  dispose(mountId: string): void {
    const previous = this.active.get(mountId)
    if (!previous) return
    this.active.delete(mountId)
    this.send({ type: 'tuffui/dispose', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce: this.nonce, mountId, revision: previous.revision + 1 })
  }

  close(): void { this.pending.length = 0; this.port?.close?.(); this.port = undefined; this.ready = false }

  /** Receives only bytes delivered through the private port, never window messages. */
  receive(value: unknown): TuffUiFrameEvent | undefined {
    const raw = record(value, 'opaque frame message')
    if (raw.type === 'tuffui/ready') {
      if (raw.protocolVersion !== TUFFUI_PROTOCOL_VERSION || raw.nonce !== this.nonce || this.ready) return undefined
      this.ready = true
      for (const message of this.pending.splice(0)) this.port?.postMessage(Object.freeze(message))
      return undefined
    }
    const message = frameMessage(raw)
    if (message.nonce !== this.nonce) return undefined
    const active = this.active.get(message.mountId)
    if (!active || message.revision !== active.revision) return undefined
    if (message.type === 'tuffui/mounted') return { kind: 'mounted', mountId: message.mountId, revision: message.revision }
    if (message.type === 'tuffui/disposed') return { kind: 'disposed', mountId: message.mountId, revision: message.revision }
    if (message.type === 'tuffui/error') return { kind: 'error', mountId: message.mountId, revision: message.revision, code: message.code!, message: message.message! }
    if (message.type === 'tuffui/resize') return { kind: 'resize', mountId: message.mountId, revision: message.revision, height: message.height! }
    if (!active.mount.binding.actions?.some(item => item.actionId === message.actionId)) return undefined
    return { kind: 'action', mountId: message.mountId, revision: message.revision, actionId: message.actionId!, payload: message.payload! }
  }

  private send(message: TuffUiHostToFrameMessage): void {
    if (!this.connected || !this.port || !this.ready) { this.pending.push(message); return }
    this.port.postMessage(Object.freeze(message))
  }
}

/** Browser adapter that transfers the real MessagePort while keeping this module testable without DOM globals. */
export function createBrowserTuffUiChannel(): TuffUiChannelLike {
  const channel = new MessageChannel()
  const wrap = (port: MessagePort, transferable?: unknown): TuffUiPortLike => ({
    postMessage: value => port.postMessage(value),
    get onmessage() { return port.onmessage as unknown as ((event: TuffUiPortEventLike) => void) | null },
    set onmessage(listener: ((event: TuffUiPortEventLike) => void) | null) { port.onmessage = listener === null ? null : event => listener(event) },
    start: () => port.start(),
    close: () => port.close(),
    ...(transferable === undefined ? {} : { transfer: transferable }),
  })
  return { port1: wrap(channel.port1), port2: wrap(channel.port2, channel.port2) }
}

/** Realm-side parser. A React 19 source adapter can render only this validated mount. */
export function parseTuffUiHostMessage(value: unknown, nonce: string): TuffUiHostToFrameMessage | undefined {
  assertTuffUiNonce(nonce)
  const raw = record(value, 'host message')
  if (raw.protocolVersion !== TUFFUI_PROTOCOL_VERSION || !['tuffui/mount', 'tuffui/update', 'tuffui/dispose'].includes(String(raw.type)) || raw.nonce !== nonce) return undefined
  assertTuffUiRevision(raw.revision)
  if (raw.type === 'tuffui/dispose') { if (typeof raw.mountId !== 'string') throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Dispose has no mount id.'); return raw as TuffUiHostToFrameMessage }
  if (!raw.mount || typeof raw.mount !== 'object') throw new TuffUiContractError('TUFFUI_FRAME_MESSAGE_INVALID', 'Mount message has no mount.')
  return raw as TuffUiHostToFrameMessage
}

/** Builds a callback for an already-mounted source component; it only posts an action event. */
export function tuffUiFrameActionSender(target: TuffUiWindowLike, targetOrigin: string, nonce: string, mount: TuffUiMount, revision: number, actionId: string): (payload: TuffUiJson) => void {
  assertTuffUiNonce(nonce); assertTuffUiRevision(revision); assertTuffUiActionId(actionId, 'action')
  if (!mount.binding.actions?.some(item => item.actionId === actionId)) throw new TuffUiContractError('TUFFUI_ACTION_UNBOUND', `Action ${actionId} is not bound by ${mount.mountId}.`)
  return payload => { assertTuffUiJson(payload, 'action payload'); target.postMessage({ type: 'tuffui/action', protocolVersion: TUFFUI_PROTOCOL_VERSION, nonce, mountId: mount.mountId, revision, actionId, payload } satisfies TuffUiFrameToHostMessage, targetOrigin) }
}
