import { createContext, createElement as h, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { ExecutableRendererProps } from '../adaptive-ui/executable-block-view.js'
import { CompositionRuntimeContext, type CompositionApi } from '../adaptive-ui/view.js'
import { createTuffUiCatalog, validateTuffUiMount, type TuffUiCatalog } from './catalog.js'
import { TuffUiPortFrameHost, createBrowserTuffUiChannel, type TuffUiWindowLike } from './frame.js'
import type { TuffUiMount } from './contracts.js'
import { validateTuffUiTypeSchemaManifest, validateTuffUiTypedBinding, type TuffUiTypeSchemaManifest } from './type-schema.js'

export type TuffUiHostActionEvent = Readonly<{
  readonly componentId: string
  readonly mountId: string
  readonly actionId: string
  readonly payload: unknown
}>
/**
 * The parent must deliberately provide this port. Receiving an action event
 * never grants the iframe permission to invoke a tool, mutate a session, or
 * submit a message by itself.
 */
export const TuffUiHostActionPortContext = createContext<((event: TuffUiHostActionEvent) => void | Promise<void>) | undefined>(undefined)

type CachedCatalog = Readonly<{ catalog: TuffUiCatalog, types: TuffUiTypeSchemaManifest }>
type Ready = Readonly<CachedCatalog & { frameUrl: string }>
type State = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'ready', value: Ready }> | Readonly<{ kind: 'failure', reason: string }>
type ParsedMount = Readonly<{ mount: TuffUiMount }> | Readonly<{ error: string }>
const MIN_HEIGHT = 160
const MAX_HEIGHT = 720
/** Immutable public source metadata only; no source props or session events enter this cache. */
const catalogCache = new WeakMap<object, Map<string, Promise<CachedCatalog>>>()

async function cachedRuntime(api: CompositionApi, sessionId: string): Promise<Ready> {
  if (!api?.componentRuntimeInfo || !api.componentCatalog) throw new Error('TUFFUI_RUNTIME_API_UNAVAILABLE')
  const info = await api.componentRuntimeInfo({ sessionId, library: 'tuffui' })
  const owner = api as object
  let byCommit = catalogCache.get(owner)
  if (!byCommit) { byCommit = new Map(); catalogCache.set(owner, byCommit) }
  let catalog = byCommit.get(info.sourceCommit)
  if (!catalog) {
    catalog = api.componentCatalog({ sessionId, library: 'tuffui' }).then(response => {
      if (response.library !== 'tuffui') throw new Error('TUFFUI_RUNTIME_CATALOG_LIBRARY_MISMATCH')
      const parsed = createTuffUiCatalog(response.catalog)
      if (parsed.manifest.commit !== info.sourceCommit) throw new Error('TUFFUI_RUNTIME_SOURCE_COMMIT_MISMATCH')
      // The Host admits both JSON documents only after they are hashed against
      // its one fixed bundle manifest. This client check owns the nested-schema
      // shape before a mount can reach the React 19 realm.
      return Object.freeze({ catalog: parsed, types: validateTuffUiTypeSchemaManifest(response.typeSchemas) })
    })
    byCommit.set(info.sourceCommit, catalog)
    void catalog.catch(() => { if (byCommit?.get(info.sourceCommit) === catalog) byCommit?.delete(info.sourceCommit) })
  }
  return { ...(await catalog), frameUrl: info.frameUrl }
}

function nonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
function stable(value: unknown): string { try { return JSON.stringify(value) } catch { return '' } }
function failure(reason: string, children?: ReactNode): ReactElement {
  return h('section', { 'data-tuffui-render-failure': reason, style: { minWidth: 0, maxWidth: '100%' } },
    h('p', { role: 'alert' }, `TuffUI 组件未呈现：${reason}`), children)
}
function boundedHeight(height: number): number { return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(height) + 2)) }
/** Component identity is part of the active realm mount, even when a caller reuses its mountId. */
function mountBindingKey(mount: TuffUiMount): string { return `${mount.mountId}:${mount.componentId}:${stable(mount.binding)}` }

/** React 18 executable renderer for one validated, opaque React 19 TuffUI realm. */
export function TuffUiBlockView({ selection, children }: ExecutableRendererProps): ReactElement {
  const runtime = useContext(CompositionRuntimeContext)
  const actionPort = useContext(TuffUiHostActionPortContext)
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useRef<TuffUiPortFrameHost | undefined>(undefined)
  const hostMountId = useRef<string | undefined>(undefined)
  const hostComponentId = useRef<string | undefined>(undefined)
  const hostBindingKey = useRef<string | undefined>(undefined)
  const errorMountIdentity = useRef<string | undefined>(undefined)
  const currentMount = useRef<TuffUiMount | undefined>(undefined)
  const actionPortRef = useRef(actionPort)
  actionPortRef.current = actionPort
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [runtimeError, setRuntimeError] = useState<string | undefined>()
  const [loadedFrameUrl, setLoadedFrameUrl] = useState<string | undefined>()

  useEffect(() => {
    const target = root.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    const api = runtime.api, sessionId = runtime.sessionId
    if (!visible) return
    if (!api?.componentRuntimeInfo || !api.componentCatalog || !sessionId) { setState({ kind: 'failure', reason: 'TUFFUI_RUNTIME_API_UNAVAILABLE' }); return }
    setState({ kind: 'loading' })
    void cachedRuntime(api, sessionId).then(ready => {
      if (!active) return
      const frameUrl = new URL(ready.frameUrl)
      const parentOrigin = window.location.origin
      if (!/^https?:\/\/[^/]+$/u.test(parentOrigin)) throw new Error('TUFFUI_PARENT_ORIGIN_UNAVAILABLE')
      frameUrl.searchParams.set('parentOrigin', parentOrigin)
      setState({ kind: 'ready', value: { catalog: ready.catalog, types: ready.types, frameUrl: frameUrl.href } })
    }).catch(error => { if (active) setState({ kind: 'failure', reason: error instanceof Error ? error.message : String(error) }) })
    return () => { active = false }
  }, [visible, runtime.api, runtime.sessionId])

  const parsedMount = useMemo<ParsedMount | undefined>(() => {
    if (state.kind !== 'ready') return undefined
    try {
      const value = validateTuffUiMount(state.value.catalog, selection.input)
      if (selection.id !== `tuffui:${value.componentId}`) throw new Error('TUFFUI_EXECUTABLE_ID_MISMATCH')
      const expected = [...selection.actionIds].sort(), actual = [...(value.binding.actions?.map(action => action.actionId) ?? [])].sort()
      if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) throw new Error('TUFFUI_ACTION_SELECTION_MISMATCH')
      // Re-run the complex prop validator in the React 18 Host immediately
      // before crossing into the opaque React 19 realm. A DIL/remote caller
      // cannot bypass the registry's earlier binder through selection.input.
      const binding = validateTuffUiTypedBinding(state.value.catalog, state.value.types, value.componentId, value.binding)
      return { mount: Object.freeze({ ...value, binding }) }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [state, selection.id, stable(selection.input), stable(selection.actionIds)])
  const mount = parsedMount && 'mount' in parsedMount ? parsedMount.mount : undefined
  currentMount.current = mount

  const requiresActionPort = (selection.actionIds?.length ?? 0) > 0
  const hasActionPort = actionPort !== undefined
  const bindingKey = mount ? mountBindingKey(mount) : undefined
  const mountIdentity = mount ? `${mount.mountId}:${mount.componentId}` : undefined
  const ready = state.kind === 'ready' ? state.value : undefined
  const sourceTitle = mount && ready ? ready.catalog.byId.get(mount.componentId)?.title : undefined
  useEffect(() => {
    if (!mountIdentity) return
    // A prior component's transport/render error cannot poison a distinct
    // component that reuses the compiler's mountId. Props-only updates keep
    // this identity and deliberately do not retry.
    if (runtimeError && errorMountIdentity.current && errorMountIdentity.current !== mountIdentity) {
      // The failed iframe was removed, but its loaded URL state outlives that
      // DOM node. Reset it so the replacement realm cannot receive a mount on
      // its initial about:blank document before its own load event.
      setRuntimeError(undefined)
      setLoadedFrameUrl(undefined)
      setHeight(MIN_HEIGHT)
    }
    errorMountIdentity.current = mountIdentity
  }, [mountIdentity, runtimeError])
  useEffect(() => {
    const initialMount = currentMount.current
    if (!visible || !ready || !initialMount || runtimeError || (requiresActionPort && !hasActionPort) || loadedFrameUrl !== ready.frameUrl) return
    const element = frame.current
    if (!element) return
    const target = element.contentWindow
    if (!target) { setRuntimeError('TUFFUI_FRAME_WINDOW_UNAVAILABLE'); return }
    host.current?.close()
    const instance = new TuffUiPortFrameHost(ready.catalog, target as unknown as TuffUiWindowLike, window.location.origin, nonce(), createBrowserTuffUiChannel, event => {
      if (event.kind === 'resize') { setHeight(boundedHeight(event.height)); return }
      if (event.kind === 'error') { setRuntimeError(`${event.code}: ${event.message}`); return }
      if (event.kind === 'action') {
        const actionPort = actionPortRef.current, liveMount = currentMount.current
        if (!actionPort || !liveMount) { setRuntimeError('TUFFUI_HOST_ACTION_PORT_MISSING'); return }
        void Promise.resolve(actionPort({ componentId: liveMount.componentId, mountId: event.mountId, actionId: event.actionId, payload: event.payload })).catch(error => setRuntimeError(error instanceof Error ? error.message : String(error)))
      }
    })
    host.current = instance
    try {
      instance.connect(); instance.mount(initialMount)
      hostMountId.current = initialMount.mountId; hostComponentId.current = initialMount.componentId; hostBindingKey.current = mountBindingKey(initialMount)
    } catch (error) { setRuntimeError(error instanceof Error ? error.message : String(error)) }
    return () => {
      if (host.current === instance) {
        instance.close(); host.current = undefined; hostMountId.current = undefined; hostComponentId.current = undefined; hostBindingKey.current = undefined
      }
    }
  }, [visible, ready, runtimeError, requiresActionPort, hasActionPort, loadedFrameUrl])

  useEffect(() => {
    const instance = host.current
    if (!instance || !mount || !bindingKey || runtimeError || hostBindingKey.current === bindingKey) return
    try {
      if (hostMountId.current && (hostMountId.current !== mount.mountId || hostComponentId.current !== mount.componentId)) {
        instance.dispose(hostMountId.current)
        instance.mount(mount)
      } else instance.update(mount)
      hostMountId.current = mount.mountId; hostComponentId.current = mount.componentId; hostBindingKey.current = bindingKey
    } catch (error) { setRuntimeError(error instanceof Error ? error.message : String(error)) }
  }, [mount, bindingKey, runtimeError])

  if (!visible) return h('section', { ref: root, 'data-tuffui-pending': true, style: { minWidth: 0, maxWidth: '100%' } }, children)
  if (state.kind === 'failure') return failure(state.reason, children)
  if (requiresActionPort && !actionPort) return failure('TUFFUI_HOST_ACTION_PORT_MISSING', children)
  if (runtimeError) return failure(runtimeError, children)
  if (parsedMount && 'error' in parsedMount) return failure(parsedMount.error, children)
  if (state.kind === 'loading' || !mount) return h('section', { ref: root, 'data-tuffui-pending': true, style: { minWidth: 0, maxWidth: '100%' } }, h('p', { role: 'status' }, '正在准备已验证的 TuffUI 组件…'), children)
  return h('section', { ref: root, 'data-tuffui-component': mount.componentId, style: { minWidth: 0, maxWidth: '100%', overflow: 'hidden' } as CSSProperties },
    h('iframe', { key: ready!.frameUrl, ref: frame, title: `TuffUI · ${sourceTitle ?? '组件'}`, src: ready!.frameUrl, sandbox: 'allow-scripts', onLoad: (event: { readonly currentTarget: HTMLIFrameElement }) => { setHeight(MIN_HEIGHT); setLoadedFrameUrl(event.currentTarget.src) }, style: { display: 'block', width: '100%', minWidth: 0, maxWidth: '100%', height, maxHeight: MAX_HEIGHT, border: 0, background: 'transparent' } as CSSProperties }),
    h('details', null, h('summary', null, '原始来源内容'), children))
}
