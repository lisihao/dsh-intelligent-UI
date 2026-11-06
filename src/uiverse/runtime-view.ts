import { Children, createContext, createElement as h, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { ExecutableRendererProps } from '../adaptive-ui/executable-block-view.js'
import { CompositionRuntimeContext, type CompositionApi } from '../adaptive-ui/view.js'
import { parseUiverseRuntimeComponentDto, parseUiverseRuntimeMount, UIVERSE_SHADOW_RENDERER_KEY } from './runtime-contract.js'
import { evaluateUiverseRuntimeEligibility } from './runtime-eligibility.js'
import { mountUiverseRuntime, type UiverseRuntimeEvent, type UiverseRuntimeInstance } from './runtime-renderer.js'
import type { UiverseRuntimeComponent, UiverseRuntimeSelectionValues } from './runtime-registry.js'

export type UiverseHostEventPort = (event: UiverseRuntimeEvent) => void | Promise<void>
/** Explicit Host port only; a Uiverse source can never execute an action itself. */
export const UiverseHostEventPortContext = createContext<UiverseHostEventPort | undefined>(undefined)

type Ready = Readonly<{ component: UiverseRuntimeComponent, sharedCss?: string }>
type State = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'ready', value: Ready }> | Readonly<{ kind: 'failure', reason: string }>
type Parsed = Readonly<{ mount: ReturnType<typeof parseUiverseRuntimeMount> }> | Readonly<{ error: string }>
const components = new Map<string, UiverseRuntimeComponent>()
const sharedCss = new Map<string, string>()

function stable(value: unknown): string { try { return JSON.stringify(value) } catch { return '' } }
function failure(reason: string, children?: ReactNode): ReactElement {
  return h('section', { 'data-uiverse-runtime-failure': reason, style: { minWidth: 0, maxWidth: '100%' } as CSSProperties },
    h('p', { role: 'alert' }, `Uiverse 组件未呈现：${reason}`), children)
}
function componentKey(sessionId: string, componentId: string): string { return `${sessionId}\u0000${componentId}` }
function expectedActionIds(values: UiverseRuntimeSelectionValues): readonly string[] {
  if (values.mode === 'read-only') return []
  return Object.values(values.actions ?? {}).map(action => action.actionId).sort((left, right) => left.localeCompare(right))
}
function sourceProjection(component: UiverseRuntimeComponent, values: UiverseRuntimeSelectionValues): { targetId: string } | undefined {
  const ids = values.projectedTextIds ?? []
  if (!ids.length) return undefined
  if (ids.length !== 1) throw new Error('UIVERSE_CONTENT_PROJECTION_NOT_UNIQUE')
  const target = component.targets.find(candidate => candidate.id === ids[0])
  if (!target || target.kind !== 'text' || target.semanticRole !== 'content') throw new Error('UIVERSE_CONTENT_PROJECTION_TARGET_INVALID')
  return { targetId: target.id }
}
/** A named slot is valid only when the Root Host has actual trusted content. */
function hasTrustedProjectionChildren(children: ReactNode): boolean {
  return Children.toArray(children).some(child => typeof child !== 'string' || child.trim().length > 0)
}
async function loadComponent(api: CompositionApi | undefined, sessionId: string, componentId: string): Promise<Ready> {
  const key = componentKey(sessionId, componentId), cached = components.get(key), cachedCss = sharedCss.get(sessionId)
  if (cached && cachedCss !== undefined) return { component: cached, sharedCss: cachedCss }
  if (!api?.uiverseRuntimeComponent) throw new Error('UIVERSE_RUNTIME_API_UNAVAILABLE')
  const response = await api.uiverseRuntimeComponent({ sessionId, componentId, includeSharedCss: cachedCss === undefined })
  const component = parseUiverseRuntimeComponentDto(response.component)
  if (component.id !== componentId) throw new Error('UIVERSE_RUNTIME_COMPONENT_ID_MISMATCH')
  components.set(key, component)
  if (response.sharedCss !== undefined) sharedCss.set(sessionId, response.sharedCss)
  return { component, ...(response.sharedCss === undefined && cachedCss === undefined ? {} : { sharedCss: response.sharedCss ?? cachedCss }) }
}

/** React 18 consumer for the same opaque ID dispatched by the executable registry. */
export function UiverseBlockView({ selection, children }: ExecutableRendererProps): ReactElement {
  const runtime = useContext(CompositionRuntimeContext)
  const eventPort = useContext(UiverseHostEventPortContext)
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<UiverseRuntimeInstance | undefined>(undefined)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [slotName, setSlotName] = useState<string | undefined>()
  const [runtimeError, setRuntimeError] = useState<string | undefined>()
  const parsed = useMemo<Parsed>(() => {
    try {
      if (selection.rendererKey !== UIVERSE_SHADOW_RENDERER_KEY) throw new Error('UIVERSE_RUNTIME_RENDERER_KEY_MISMATCH')
      const mount = parseUiverseRuntimeMount(selection.input)
      if (selection.id !== `uiverse:${mount.componentId}`) throw new Error('UIVERSE_EXECUTABLE_ID_MISMATCH')
      const expected = expectedActionIds(mount.values)
      if (expected.length !== selection.actionIds.length || expected.some((id, index) => id !== selection.actionIds[index])) throw new Error('UIVERSE_ACTION_SELECTION_MISMATCH')
      return { mount }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [selection.id, selection.rendererKey, stable(selection.input), stable(selection.actionIds)])
  const mount = 'mount' in parsed ? parsed.mount : undefined

  useEffect(() => {
    let active = true
    setRuntimeError(undefined); setSlotName(undefined)
    if (!mount || !runtime.api || !runtime.sessionId) { setState({ kind: 'failure', reason: 'UIVERSE_RUNTIME_API_UNAVAILABLE' }); return () => { active = false } }
    setState({ kind: 'loading' })
    void loadComponent(runtime.api, runtime.sessionId, mount.componentId).then(value => { if (active) setState({ kind: 'ready', value }) }).catch(error => { if (active) setState({ kind: 'failure', reason: error instanceof Error ? error.message : String(error) }) })
    return () => { active = false }
  }, [runtime.api, runtime.sessionId, mount?.componentId])

  const ready = state.kind === 'ready' ? state.value : undefined
  const interactive = mount !== undefined && (mount.values.mode === 'interactive' || mount.values.mode === undefined && (ready?.component.inputSchema.actionIds.length ?? 0) > 0)
  const key = ready && mount ? `${ready.component.id}:${stable(mount.values)}:${stable(selection.actionIds)}` : ''
  useEffect(() => {
    instance.current?.dispose(); instance.current = undefined
    if (!ready || !mount || !host.current || runtimeError) return
    if (interactive && !eventPort) { setRuntimeError('UIVERSE_HOST_EVENT_PORT_MISSING'); return }
    try {
      const eligibility = evaluateUiverseRuntimeEligibility(ready.component, mount.values)
      if (!eligibility.eligible) throw new Error(`UIVERSE_RUNTIME_BINDINGS_INCOMPLETE:${[...eligibility.reasons, ...eligibility.missing].join(',')}`)
      const projection = sourceProjection(ready.component, mount.values)
      if (projection && !hasTrustedProjectionChildren(children)) throw new Error('UIVERSE_CONTENT_PROJECTION_CHILDREN_MISSING')
      const mounted = mountUiverseRuntime({
        component: { ...ready.component, sharedCss: ready.sharedCss }, host: host.current, values: mount.values,
        ...(projection === undefined ? {} : { contentProjection: projection }),
        ...(eventPort === undefined ? {} : { onEvent: event => { void Promise.resolve(eventPort(event)).catch(error => setRuntimeError(error instanceof Error ? error.message : String(error))) } }),
      })
      instance.current = mounted
      setSlotName(mounted.contentSlotName)
    } catch (error) { setRuntimeError(error instanceof Error ? error.message : String(error)) }
    return () => { instance.current?.dispose(); instance.current = undefined }
    // `children` is intentionally excluded: React may attach its trusted light
    // DOM child after the fixed native slot exists; remounting would drop it.
  }, [key, ready, mount, interactive, eventPort, runtimeError])

  if ('error' in parsed) return failure(parsed.error, children)
  if (state.kind === 'failure') return failure(state.reason, children)
  if (runtimeError) return failure(runtimeError, children)
  if (interactive && !eventPort) return failure('UIVERSE_HOST_EVENT_PORT_MISSING', children)
  return h('section', { 'data-uiverse-runtime-component': mount?.componentId, style: { minWidth: 0, maxWidth: '100%', overflow: 'hidden' } as CSSProperties },
    h('div', { ref: host, 'data-uiverse-runtime-host': mount?.componentId, style: { minWidth: 0, maxWidth: '100%' } as CSSProperties },
      slotName ? h('div', { slot: slotName, 'data-uiverse-runtime-light-dom': true }, children) : null),
  )
}
