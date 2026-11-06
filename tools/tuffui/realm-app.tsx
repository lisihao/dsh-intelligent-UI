'use client'

/**
 * This file is copied into a private React 19 carrier during the TuffUI realm
 * build. It is glue only: every visual component still comes from the pinned,
 * unmodified TuffUI source closure.
 */
import * as React from 'react'

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type Action = { prop: string, actionId: string }
type Binding = { exportName: string, props: Record<string, Json>, actions?: readonly Action[] }
type Mount = { protocolVersion: 1, mountId: string, componentId: string, binding: Binding }
type HostMessage = { type: 'tuffui/mount' | 'tuffui/update' | 'tuffui/dispose', protocolVersion: 1, nonce: string, revision: number, mount?: Mount, mountId?: string }
type ModuleMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>
type RealmProps = { registry: ModuleMap }
type RealmPort = { postMessage(value: unknown): void, onmessage: ((event: MessageEvent<unknown>) => void) | null, start?(): void, close?(): void }

const noncePattern = /^[a-f0-9]{32}$/u
const actionPattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/u
const unsupportedFunctionProps = new Set(['renderAvatar', 'validate', 'format', 'as'])

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function json(value: unknown, depth = 0): value is Json {
  if (depth > 64 || value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1))
  const object = record(value)
  if (!object) return false
  return Object.entries(object).every(([key, item]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype' && json(item, depth + 1))
}
function hostMessage(value: unknown, nonce: string): HostMessage | undefined {
  const raw = record(value)
  if (!raw || raw.protocolVersion !== 1 || raw.nonce !== nonce || !['tuffui/mount', 'tuffui/update', 'tuffui/dispose'].includes(String(raw.type)) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) return undefined
  if (raw.type === 'tuffui/dispose') return typeof raw.mountId === 'string' ? raw as HostMessage : undefined
  const mount = record(raw.mount)
  const binding = mount && record(mount.binding)
  if (!mount || !binding || typeof mount.mountId !== 'string' || typeof mount.componentId !== 'string' || typeof binding.exportName !== 'string' || !record(binding.props)) return undefined
  return raw as HostMessage
}
function child(value: Json): React.ReactNode {
  if (value === null || typeof value === 'boolean') return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.map((item, index) => <React.Fragment key={index}>{child(item)}</React.Fragment>)
  throw new Error('TUFFUI_REALM_CHILD_OBJECT_UNSUPPORTED')
}
function actionPayload(args: readonly unknown[]): Json {
  const normalize = (value: unknown): Json => {
    if (json(value)) return value
    if (value instanceof Date) return value.toISOString()
    if (typeof Event !== 'undefined' && value instanceof Event) {
      const target = value.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return { event: value.type, value: target.value, ...(target instanceof HTMLInputElement ? { checked: target.checked } : {}) }
      return { event: value.type }
    }
    return { unsupportedCallbackValue: Object.prototype.toString.call(value) }
  }
  return args.length === 0 ? null : args.length === 1 ? normalize(args[0]) : args.map(normalize)
}
function dateValue(value: Json): Json | Date | { from: Date | null, to: Date | null } {
  if (typeof value === 'string') { const date = new Date(value); if (!Number.isNaN(date.valueOf())) return date }
  const range = record(value)
  if (range && ('from' in range || 'to' in range)) {
    const date = (candidate: unknown): Date | null => candidate === null || candidate === undefined ? null : typeof candidate === 'string' && !Number.isNaN(new Date(candidate).valueOf()) ? new Date(candidate) : null
    return { from: date(range.from), to: date(range.to) }
  }
  return value
}

export function TuffUiRealmApp({ registry }: RealmProps) {
  const [active, setActive] = React.useState<{ mount: Mount, revision: number } | undefined>()
  const [failure, setFailure] = React.useState<string | undefined>()
  const nonce = React.useRef<string | undefined>(undefined)
  const port = React.useRef<RealmPort | undefined>(undefined)
  const parentOrigin = React.useMemo(() => {
    if (typeof window === 'undefined') return undefined
    const value = new URLSearchParams(window.location.search).get('parentOrigin')
    return value && /^https?:\/\/[^/]+$/u.test(value) ? value : undefined
  }, [])

  const post = React.useCallback((message: Record<string, unknown>) => {
    if (!nonce.current || !port.current) return
    port.current.postMessage({ ...message, protocolVersion: 1, nonce: nonce.current })
  }, [])

  React.useEffect(() => {
    const apply = (value: unknown) => {
      if (!nonce.current) return
      const message = hostMessage(value, nonce.current)
      if (!message) return
      if (message.type === 'tuffui/dispose') {
        setActive(current => current?.mount.mountId === message.mountId ? undefined : current)
        post({ type: 'tuffui/disposed', mountId: message.mountId, revision: message.revision })
        return
      }
      const mount = message.mount!
      const module = registry[mount.componentId]
      if (!module || typeof module[mount.binding.exportName] !== 'function') {
        setFailure('TUFFUI_REALM_EXPORT_UNAVAILABLE')
        post({ type: 'tuffui/error', mountId: mount.mountId, revision: message.revision, code: 'TUFFUI_REALM_EXPORT_UNAVAILABLE', message: 'The requested pinned source export is unavailable in this realm.' })
        return
      }
      setFailure(undefined)
      setActive({ mount, revision: message.revision })
    }
    const receive = (event: MessageEvent<unknown>) => {
      const candidate = record(event.data)
      if (!candidate || candidate.type !== 'tuffui/connect' || candidate.protocolVersion !== 1 || typeof candidate.nonce !== 'string' || !noncePattern.test(candidate.nonce)) return
      // The Host writes this exact origin into the iframe URL. A model cannot
      // change it through mount data, and an opaque frame never trusts origin "null".
      if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent || event.ports.length !== 1 || port.current || nonce.current) return
      nonce.current = candidate.nonce
      const received = event.ports[0] as RealmPort
      port.current = received
      received.onmessage = nested => apply(nested.data)
      received.start?.()
      received.postMessage({ type: 'tuffui/ready', protocolVersion: 1, nonce: nonce.current })
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive); port.current?.close?.(); port.current = undefined }
  }, [parentOrigin, post, registry])

  React.useEffect(() => {
    if (active) post({ type: 'tuffui/mounted', mountId: active.mount.mountId, revision: active.revision })
  }, [active, post])

  React.useEffect(() => {
    if (!active || typeof ResizeObserver === 'undefined') return
    const emit = () => {
      const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
      if (Number.isFinite(height) && height > 0) post({ type: 'tuffui/resize', mountId: active.mount.mountId, revision: active.revision, height: Math.min(20_000, height) })
    }
    const observer = new ResizeObserver(emit)
    observer.observe(document.body); emit()
    return () => observer.disconnect()
  }, [active, post])

  if (failure) return <output role="status" data-tuffui-status="error">{failure}</output>
  if (!active) return <output role="status" data-tuffui-status="waiting">Waiting for an explicit host binding.</output>
  try {
    const { mount, revision } = active
    const exported = registry[mount.componentId]![mount.binding.exportName] as React.ComponentType<Record<string, unknown>>
    const props: Record<string, unknown> = { ...mount.binding.props }
    for (const name of Object.keys(props)) if (unsupportedFunctionProps.has(name)) throw new Error(`TUFFUI_REALM_PROP_UNSUPPORTED:${name}`)
    if (mount.componentId === 'date-field' && 'value' in props) props.value = dateValue(props.value as Json)
    const suppliedChildren = props.children as Json | undefined
    delete props.children
    for (const action of mount.binding.actions ?? []) {
      if (!actionPattern.test(action.actionId)) throw new Error('TUFFUI_REALM_ACTION_INVALID')
      props[action.prop] = (...args: unknown[]) => post({ type: 'tuffui/action', mountId: mount.mountId, revision, actionId: action.actionId, payload: actionPayload(args) })
    }
    return <section data-tuffui-component={mount.componentId} data-tuffui-export={mount.binding.exportName} style={{ minWidth: 0, maxWidth: '100%', overflowX: 'clip' }}><style>{`html,body,#root{margin:0;min-width:0;max-width:100%;overflow-x:clip}body{overflow-y:auto}[data-tuffui-component]{container-type:inline-size}[data-tuffui-component] pre,[data-tuffui-component] code,[data-tuffui-component] [role=table]{max-width:100%;overflow:auto}`}</style>{React.createElement(exported, props, suppliedChildren === undefined ? undefined : child(suppliedChildren))}</section>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return <output role="status" data-tuffui-status="error">{message}</output>
  }
}
