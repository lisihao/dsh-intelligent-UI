import { createElement as h, useId, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { appearancePreferences, appearanceTokens } from '../appearance.js'
import { CuratedComponentView, CuratedUiEventPortContext, type CuratedUiEvent } from '../adaptive-ui/curated-component-view.js'
import { CanvasComponentView } from '../adaptive-ui/canvas-component-view.js'
import { bindCanvasComponentSource, CANVAS_COMPONENT_RENDERER_KEY, type CanvasSourceCapabilities } from '../adaptive-ui/canvas-component-bindings.js'
import { CURATED_UI_RENDERER_KEY } from '../adaptive-ui/library-component-bindings.js'
import type { ExecutableComponentDispatch, ExecutableJson } from '../adaptive-ui/executable-registry.js'
import { AdaptiveLoading, AdaptiveText, HistoricalChart, LiveSeriesView } from '../adaptive-ui/components.js'
import { liveSeriesInputSchema, type LiveSeriesInput } from '../adaptive-ui/source-contracts.js'
import type { AutoChartPlan } from '../content-analysis.js'
import { usePresentationTheme } from '../theme-runtime.js'
import { assertTuffUiActionId, assertTuffUiJson, TUFFUI_PROTOCOL_VERSION, type TuffUiComponentBinding, type TuffUiJson } from '../tuffui/contracts.js'
import { TuffUiBlockView, TuffUiHostActionPortContext, type TuffUiHostActionEvent } from '../tuffui/view.js'
import { parseUiverseRuntimeMount, UIVERSE_SHADOW_RENDERER_KEY, type UiverseRuntimeMount } from '../uiverse/runtime-contract.js'
import { UiverseBlockView, UiverseHostEventPortContext } from '../uiverse/runtime-view.js'
import type { UiverseRuntimeEvent } from '../uiverse/runtime-renderer.js'
import type { UiverseRuntimeSelectionValues } from '../uiverse/runtime-registry.js'
import { validateDilComponentInput, validateDilExternalComponentId, type DilJson } from './protocol.js'
import {
  historicalLibraryInputSchema,
  skulletLibraryInputSchema,
  torphLibraryInputSchema,
} from './library-inputs.js'
import type { DilExternalComponentRenderer } from './view.js'

export {
  DIL_LIBRARY_COMPONENT_INPUT_SCHEMAS,
  DIL_LIBRARY_INPUT_SCHEMA_VERSION,
  getDilLibraryComponentInputSchema,
  type DilLibraryContractJson,
} from './library-contracts.js'

export type DilLibraryRendererOptions = Readonly<{
  /** Required when a selected adapter projects Markdown into a trusted native slot. */
  renderMarkdown?: (source: string) => ReactNode
}>

type LibraryComponentProps = Readonly<{
  id: string
  input: DilJson
  onEvent?: (event: DilJson) => void
  renderMarkdown?: (source: string) => ReactNode
}>

type CuratedRole = 'card' | 'loader' | 'button' | 'input' | 'toggle'
type CuratedId = Readonly<{ componentSet: 'soft-relief' | 'clear-glass' | 'mechanical-outline', role: CuratedRole }>

const curatedId = /^uiverse:(soft-relief|clear-glass|mechanical-outline):(card|loader|button|input|toggle)$/u
const MAX_LIBRARY_TEXT = 20_000

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(code)
}
function text(value: unknown, code: string, max = MAX_LIBRARY_TEXT): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(code)
  return value
}
function jsonText(value: DilJson): string {
  try { return JSON.stringify(value, null, 2) } catch { return '[unserializable input]' }
}
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
  return code === undefined || message.startsWith(`${code}:`) ? message : `${code}: ${message}`
}
function failure(id: string, reason: string, input: DilJson): ReactElement {
  return h('section', { 'data-dil-library-failure': reason, 'data-dil-library-id': id, style: { minWidth: 0, maxWidth: '100%' } },
    h('p', { role: 'alert' }, `外部组件未呈现：${reason}`),
    h('details', { open: true }, h('summary', null, '查看原始来源绑定'), h('pre', null, jsonText(input))))
}
function sourceBinding(input: DilJson): ReactElement {
  return h('details', { 'data-dil-library-source': true }, h('summary', null, '查看原始来源绑定'), h('pre', null, jsonText(input)))
}
function mountId(prefix: string, reactId: string): string {
  const normalized = reactId.replace(/[^A-Za-z0-9]/gu, '').toLowerCase() || 'node'
  return `${prefix}-${normalized}`.slice(0, 95)
}
function asExecutable(value: unknown): ExecutableJson { return value as ExecutableJson }
function dispatch(id: string, rendererKey: string, input: unknown, actionIds: readonly string[] = []): ExecutableComponentDispatch {
  return Object.freeze({ id, family: 'dil-library', rendererKey, input: asExecutable(input), actionIds: Object.freeze([...actionIds].sort((left, right) => left.localeCompare(right))) })
}

function parseCuratedId(id: string): CuratedId | undefined {
  const match = curatedId.exec(id)
  return match ? { componentSet: match[1] as CuratedId['componentSet'], role: match[2] as CuratedRole } : undefined
}

function parseTuffBinding(value: DilJson): { binding: TuffUiComponentBinding, actionIds: readonly string[] } {
  if (!record(value)) throw new Error('DIL_TUFF_BINDING_INVALID')
  exactKeys(value, ['exportName', 'props', 'actions'], 'DIL_TUFF_BINDING_INVALID')
  const exportName = text(value.exportName, 'DIL_TUFF_EXPORT_INVALID', 160)
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(exportName)) throw new Error('DIL_TUFF_EXPORT_INVALID')
  // Some fixed-source exports intentionally have only optional visual props.
  // The exact Tuff catalog/type schema, not this bridge, decides whether an
  // empty object is valid for the selected export.
  if (!record(value.props)) throw new Error('DIL_TUFF_PROPS_INVALID')
  const props: Record<string, TuffUiJson> = {}
  for (const [name, prop] of Object.entries(value.props)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name)) throw new Error('DIL_TUFF_PROP_INVALID')
    assertTuffUiJson(prop, `binding.props.${name}`)
    props[name] = prop
  }
  const actions: Array<{ prop: string, actionId: string }> = []
  const actionIds = new Set<string>(), actionProps = new Set<string>()
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length > 64) throw new Error('DIL_TUFF_ACTIONS_INVALID')
    for (const raw of value.actions) {
      if (!record(raw)) throw new Error('DIL_TUFF_ACTIONS_INVALID')
      exactKeys(raw, ['prop', 'actionId'], 'DIL_TUFF_ACTIONS_INVALID')
      const prop = text(raw.prop, 'DIL_TUFF_ACTIONS_INVALID', 160), actionId = text(raw.actionId, 'DIL_TUFF_ACTIONS_INVALID', 200)
      if (!/^on[A-Z][A-Za-z0-9]*$/u.test(prop) || actionProps.has(prop) || actionIds.has(actionId)) throw new Error('DIL_TUFF_ACTIONS_INVALID')
      assertTuffUiActionId(actionId, 'binding.actions.actionId')
      actionProps.add(prop); actionIds.add(actionId); actions.push({ prop, actionId })
    }
  }
  return { binding: Object.freeze({ exportName, props: Object.freeze(props), ...(actions.length ? { actions: Object.freeze(actions) } : {}) }), actionIds: Object.freeze([...actionIds].sort((left, right) => left.localeCompare(right))) }
}

function TuffLibraryView({ id, componentId, input, onEvent, stableMountId }: Readonly<{ id: string, componentId: string, input: DilJson, onEvent?: (event: DilJson) => void, stableMountId: string }>): ReactElement {
  try {
    const parsed = parseTuffBinding(input)
    if (parsed.actionIds.length > 0 && onEvent === undefined) throw new Error('DIL_TUFF_EVENT_PORT_REQUIRED')
    const mount = Object.freeze({ protocolVersion: TUFFUI_PROTOCOL_VERSION, mountId: stableMountId, componentId, binding: parsed.binding })
    const selection = dispatch(id, 'tuffui-v1', mount, parsed.actionIds)
    const port = onEvent === undefined ? undefined : (event: TuffUiHostActionEvent): void => {
      if (event.componentId !== componentId || event.mountId !== stableMountId || !parsed.actionIds.includes(event.actionId)) throw new Error('DIL_TUFF_EVENT_INVALID')
      assertTuffUiJson(event.payload, 'tuffui.event.payload')
      onEvent({ library: 'tuffui', componentId: event.componentId, mountId: event.mountId, actionId: event.actionId, payload: event.payload })
    }
    return h('section', { 'data-dil-library-component': id, style: { minWidth: 0, maxWidth: '100%' } },
      h(TuffUiHostActionPortContext.Provider, { value: port }, h(TuffUiBlockView, { selection, renderMarkdown: source => h('pre', null, source) }, sourceBinding(input))))
  } catch (error) { return failure(id, failureReason(error), input) }
}

function parseOpaqueUiverseInput(componentId: string, input: DilJson): { mount: UiverseRuntimeMount, content?: string } {
  let values: unknown = input, content: string | undefined
  if (record(input) && Object.hasOwn(input, 'values')) {
    exactKeys(input, ['values', 'content'], 'DIL_UIVERSE_INPUT_INVALID')
    values = input.values
    if (input.content !== undefined) content = text(input.content, 'DIL_UIVERSE_CONTENT_INVALID')
  }
  const mount = parseUiverseRuntimeMount({ componentId, values })
  if ((mount.values.projectedTextIds?.length ?? 0) > 0 && content === undefined) throw new Error('DIL_UIVERSE_PROJECTED_CONTENT_REQUIRED')
  if (content !== undefined && (mount.values.projectedTextIds?.length ?? 0) === 0) throw new Error('DIL_UIVERSE_PROJECTED_TARGET_REQUIRED')
  return { mount, ...(content === undefined ? {} : { content }) }
}

function uiverseActionIds(values: UiverseRuntimeSelectionValues): readonly string[] {
  if (values.mode === 'read-only') return []
  return Object.freeze(Object.values(values.actions ?? {}).map(action => action.actionId).sort((left, right) => left.localeCompare(right)))
}
function uiverseEvent(event: UiverseRuntimeEvent): DilJson {
  switch (event.kind) {
    case 'action': return { library: 'uiverse', kind: 'action', componentId: event.componentId, targetId: event.targetId, actionId: event.actionId }
    case 'field': return { library: 'uiverse', kind: 'field', componentId: event.componentId, targetId: event.targetId, fieldId: event.fieldId, value: event.value }
    case 'toggle': return { library: 'uiverse', kind: 'toggle', componentId: event.componentId, targetId: event.targetId, fieldId: event.fieldId, checked: event.checked }
    case 'file': return { library: 'uiverse', kind: 'file', componentId: event.componentId, targetId: event.targetId, fieldId: event.fieldId, names: [...event.names] }
  }
}

function UiverseLibraryView({ id, componentId, input, onEvent, renderMarkdown }: Readonly<{ id: string, componentId: string, input: DilJson, onEvent?: (event: DilJson) => void, renderMarkdown?: (source: string) => ReactNode }>): ReactElement {
  try {
    const parsed = parseOpaqueUiverseInput(componentId, input)
    if (parsed.content !== undefined && !renderMarkdown) throw new Error('DIL_UIVERSE_MARKDOWN_RENDERER_UNAVAILABLE')
    if (parsed.mount.values.mode !== 'read-only' && onEvent === undefined) throw new Error('DIL_UIVERSE_EVENT_PORT_REQUIRED')
    const selection = dispatch(id, UIVERSE_SHADOW_RENDERER_KEY, parsed.mount, uiverseActionIds(parsed.mount.values))
    // Keep the trusted semantic renderer's node as the actual light-DOM child.
    // A bridge wrapper here would alter the fixed source component's slot tree.
    const projected = parsed.content === undefined ? undefined : renderMarkdown!(parsed.content)
    const port = onEvent === undefined ? undefined : (event: UiverseRuntimeEvent): void => {
      if (event.componentId !== componentId) throw new Error('DIL_UIVERSE_EVENT_COMPONENT_MISMATCH')
      onEvent(uiverseEvent(event))
    }
    return h('section', { 'data-dil-library-component': id, style: { minWidth: 0, maxWidth: '100%' } },
      h(UiverseHostEventPortContext.Provider, { value: port }, h(UiverseBlockView, { selection, renderMarkdown: renderMarkdown ?? (source => h('pre', null, source)) }, projected)),
      sourceBinding(input))
  } catch (error) { return failure(id, failureReason(error), input) }
}

function noAuthority(value: unknown, path = 'input', depth = 0): void {
  if (depth > 16 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) noAuthority(item, path, depth + 1); return }
  if (!record(value)) throw new Error('DIL_CURATED_PROPS_INVALID')
  for (const [key, item] of Object.entries(value)) {
    if (key === '__dilFn' || key === 'authority' || key === 'handlerIds' || key === 'formActionIds' || /^on[A-Z]/u.test(key)) throw new Error(`DIL_CURATED_AUTHORITY_FORBIDDEN:${path}.${key}`)
    noAuthority(item, `${path}.${key}`, depth + 1)
  }
}
function curatedControlNode(role: Exclude<CuratedRole, 'card' | 'loader'>, input: DilJson, handlerId: string | undefined): { node: DilJson, label?: string } {
  if (!record(input)) throw new Error('DIL_CURATED_INPUT_INVALID')
  exactKeys(input, ['props', 'label'], 'DIL_CURATED_INPUT_INVALID')
  if (!record(input.props)) throw new Error('DIL_CURATED_PROPS_INVALID')
  noAuthority(input.props, 'input.props')
  const props: Record<string, DilJson> = { ...input.props as Record<string, DilJson> }
  const label = input.label === undefined ? undefined : text(input.label, 'DIL_CURATED_LABEL_INVALID', 200)
  const disabled = props.disabled === true
  if (!disabled) {
    if (!handlerId) throw new Error('DIL_CURATED_EVENT_PORT_REQUIRED')
    if (role === 'button') {
      if (props.type === 'submit') throw new Error('DIL_CURATED_SUBMIT_UNSUPPORTED')
      props.onClick = { __dilFn: handlerId } as unknown as DilJson
    } else props.onChange = { __dilFn: handlerId } as unknown as DilJson
  }
  const tag = role === 'toggle' ? 'switch' : role
  return {
    ...(label === undefined ? {} : { label }),
    node: {
      formatVersion: 1,
      componentId: `dil:${tag}`,
      source: { kind: 'node', tag, props, ...(role === 'button' || role === 'toggle' ? { text: label ?? (typeof props.label === 'string' ? props.label : '') } : {}) },
      authority: { handlerIds: !disabled && handlerId !== undefined ? [handlerId] : [], formActionIds: [] },
    },
  }
}

function CuratedLibraryView({ id, curated, input, onEvent, renderMarkdown, stableMountId }: Readonly<{ id: string, curated: CuratedId, input: DilJson, onEvent?: (event: DilJson) => void, renderMarkdown?: (source: string) => ReactNode, stableMountId: string }>): ReactElement {
  try {
    if (curated.role === 'card') {
      if (!record(input) || Object.keys(input).some(key => key !== 'content')) throw new Error('DIL_CURATED_CARD_INPUT_INVALID')
      const content = text(input.content, 'DIL_CURATED_CARD_CONTENT_REQUIRED')
      if (!renderMarkdown) throw new Error('DIL_CURATED_MARKDOWN_RENDERER_UNAVAILABLE')
      const selection = dispatch(id, CURATED_UI_RENDERER_KEY, { componentSet: curated.componentSet, role: 'card', content })
      return h(CuratedComponentView, { selection, renderMarkdown, children: h('section', { 'data-dil-curated-markdown': true }, renderMarkdown(content)) })
    }
    if (curated.role === 'loader') {
      if (!record(input) || Object.keys(input).some(key => key !== 'loading' && key !== 'label') || input.loading !== true) throw new Error('DIL_CURATED_INITIAL_LOADING_REQUIRED')
      const label = input.label === undefined ? undefined : text(input.label, 'DIL_CURATED_LABEL_INVALID', 200)
      const selection = dispatch(id, CURATED_UI_RENDERER_KEY, { componentSet: curated.componentSet, role: 'loader', ...(label === undefined ? {} : { label }) })
      return h(CuratedComponentView, { selection, renderMarkdown: renderMarkdown ?? (source => h('pre', null, source)), children: sourceBinding(input) })
    }
    const localHandlerId = onEvent === undefined ? undefined : `dil-library-${stableMountId}`
    const built = curatedControlNode(curated.role, input, localHandlerId)
    const selection = dispatch(id, CURATED_UI_RENDERER_KEY, { componentSet: curated.componentSet, role: curated.role, ...(built.label === undefined ? {} : { label: built.label }), node: built.node })
    const port = onEvent === undefined ? undefined : (event: CuratedUiEvent): void => {
      if (event.componentSet !== curated.componentSet || event.role !== curated.role || event.handlerId !== localHandlerId) throw new Error('DIL_CURATED_EVENT_INVALID')
      const value: DilJson = event.args.length === 1 ? validateDilComponentInput(event.args[0], 'curated.event') : validateDilComponentInput([...event.args] as unknown, 'curated.event')
      onEvent({ library: 'uiverse-curated', componentId: id, role: curated.role, value })
    }
    return h(CuratedUiEventPortContext.Provider, { value: port }, h(CuratedComponentView, { selection, renderMarkdown: renderMarkdown ?? (source => h('pre', null, source)), children: sourceBinding(input) }))
  } catch (error) { return failure(id, failureReason(error), input) }
}

function useLibraryPalette(): { dark: boolean, palette: readonly string[] } {
  const theme = usePresentationTheme()
  const appearance = useSyncExternalStore(appearancePreferences.subscribe, appearancePreferences.getSnapshot, appearancePreferences.getSnapshot)
  const colors = appearanceTokens(appearance, theme)
  return { dark: colors.colorScheme === 'dark', palette: colors.colorScheme === 'dark' ? theme.tokens.paletteDark : theme.tokens.paletteLight }
}
function LiveLibraryView({ source }: { source: LiveSeriesInput }): ReactElement {
  const { dark } = useLibraryPalette()
  return h(LiveSeriesView, { source, dark })
}
function HistoricalSourceTable({ plan }: { plan: AutoChartPlan }): ReactElement {
  const header = h('thead', null,
    h('tr', null,
      h('th', { scope: 'col' }, '标签'),
      ...plan.series.map(series => h('th', { key: series.name, scope: 'col' }, series.name + (series.unit ? ` (${series.unit})` : ''))),
    ),
  )
  const body = h('tbody', null,
    ...plan.labels.map((label, row) => h('tr', { key: `${label}-${String(row)}` },
      h('th', { scope: 'row' }, label),
      ...plan.series.map(series => h('td', { key: series.name }, series.originals?.[row] ?? String(series.values[row]!))),
    )),
  )
  return h('details', { open: true, 'data-dil-library-source-table': true },
    h('summary', null, '历史图表使用的原始序列'),
    h('div', { style: { overflowX: 'auto' } }, h('table', null, header, body)),
  )
}
function HistoricalLibraryView({ plan }: { plan: AutoChartPlan }): ReactElement {
  const { palette } = useLibraryPalette()
  return h('section', { 'data-dil-library-historical': true }, h(HistoricalChart, { plan, palette }), h(HistoricalSourceTable, { plan }))
}

function BuiltInLibraryView({ id, input }: Readonly<{ id: string, input: DilJson }>): ReactElement {
  try {
    if (id === 'component:skullet') {
      const parsed = skulletLibraryInputSchema.parse(input)
      return h(AdaptiveLoading, { loading: parsed.loading, ...(parsed.label === undefined ? {} : { label: parsed.label }) })
    }
    if (id === 'component:torph') return h(AdaptiveText, { text: torphLibraryInputSchema.parse(input).text, motion: true })
    if (id === 'component:liveline') return h(LiveLibraryView, { source: liveSeriesInputSchema.parse(input) })
    if (id === 'component:visx-historical') return h(HistoricalLibraryView, { plan: historicalLibraryInputSchema.parse(input).plan as AutoChartPlan })
    return failure(id, 'DIL_LIBRARY_COMPONENT_UNKNOWN', input)
  } catch (error) { return failure(id, failureReason(error), input) }
}

/** Browser facts gate a visual-only Canvas binding; the fixed consumer rechecks its own runtime surface. */
function canvasCapabilities(): CanvasSourceCapabilities {
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  let webgl = false
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    try {
      const context = canvas.getContext('webgl2')
      webgl = context !== null
      context?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch { /* A missing or restricted GPU stays in the retained-source fallback path. */ }
  }
  return { webgl, reducedMotion }
}

function canvasSourceNode(source: DilJson, renderMarkdown?: (source: string) => ReactNode): ReactNode {
  const markdown = typeof source === 'string'
    ? source
    : record(source) && source.kind === 'canvas-html-pair' && typeof source.primary === 'string'
      ? source.primary
      : undefined
  if (markdown !== undefined) {
    return renderMarkdown === undefined
      ? h('pre', { 'data-dil-canvas-source': 'text' }, markdown)
      : h('section', { 'data-dil-canvas-source': 'markdown' }, renderMarkdown(markdown))
  }
  return h('pre', { 'data-dil-canvas-source': 'json' }, jsonText(source))
}

/**
 * Canvas takes one actual retained source value and derives its internal
 * renderer input locally. It never accepts model-produced factory code,
 * URLs marked verified, blob URLs, or a remote action callback.
 */
function CanvasLibraryView({ id, input, onEvent, renderMarkdown }: Readonly<{ id: string, input: DilJson, onEvent?: (event: DilJson) => void, renderMarkdown?: (source: string) => ReactNode }>): ReactElement {
  try {
    if (onEvent !== undefined) throw new Error('DIL_CANVAS_EVENT_UNSUPPORTED')
    if (!record(input)) throw new Error('DIL_CANVAS_INPUT_INVALID')
    exactKeys(input, ['source'], 'DIL_CANVAS_INPUT_INVALID')
    if (!Object.hasOwn(input, 'source')) throw new Error('DIL_CANVAS_SOURCE_REQUIRED')
    const source = input.source as DilJson
    const binding = bindCanvasComponentSource(id, source, canvasCapabilities(), false)
    if (!binding.eligible) throw new Error(`DIL_CANVAS_SOURCE_INELIGIBLE:${binding.reasons.join(',')}`)
    const selection = dispatch(id, CANVAS_COMPONENT_RENDERER_KEY, binding.input)
    return h('section', { 'data-dil-library-component': id, style: { minWidth: 0, maxWidth: '100%' } },
      h(CanvasComponentView, { selection, value: source }, canvasSourceNode(source, renderMarkdown)))
  } catch (error) { return failure(id, failureReason(error), input) }
}

/** Hook-owning implementation; its generated mount id is never model input. */
export function DilLibraryComponent({ id: rawId, input: rawInput, onEvent, renderMarkdown }: LibraryComponentProps): ReactElement {
  const reactId = useId()
  let input: DilJson
  try {
    input = validateDilComponentInput(rawInput, 'component.input')
  } catch (error) { return failure(typeof rawId === 'string' ? rawId : 'unknown', failureReason(error), '[invalid non-JSON input]') }
  let id: string
  try {
    id = validateDilExternalComponentId(rawId, 'component.id')
  } catch (error) { return failure(typeof rawId === 'string' ? rawId : 'unknown', failureReason(error), input) }
  const curated = parseCuratedId(id)
  if (curated) return h(CuratedLibraryView, { id, curated, input, onEvent, renderMarkdown, stableMountId: mountId('dil-curated', reactId) })
  if (id.startsWith('tuffui:')) return h(TuffLibraryView, { id, componentId: id.slice('tuffui:'.length), input, onEvent, stableMountId: mountId('dil-tuff', reactId) })
  if (id.startsWith('uiverse:')) return h(UiverseLibraryView, { id, componentId: id.slice('uiverse:'.length), input, onEvent, renderMarkdown })
  if (id.startsWith('component:')) return h(BuiltInLibraryView, { id, input })
  if (id.startsWith('canvas:')) return h(CanvasLibraryView, { id, input, onEvent, renderMarkdown })
  return failure(id, 'DIL_LIBRARY_COMPONENT_UNKNOWN', input)
}

/** Default bridge when no Markdown projection callback is available. */
export const renderDilLibraryComponent: DilExternalComponentRenderer = (id, input, onEvent) => h(DilLibraryComponent, { id, input, onEvent })

/** Supply the caller's trusted Markdown renderer for curated cards/Uiverse slots. */
const libraryRenderersByMarkdown = new WeakMap<(source: string) => ReactNode, DilExternalComponentRenderer>()
export function createDilLibraryRenderer(renderMarkdown?: (source: string) => ReactNode): DilExternalComponentRenderer {
  if (renderMarkdown === undefined) return renderDilLibraryComponent
  const cached = libraryRenderersByMarkdown.get(renderMarkdown)
  if (cached !== undefined) return cached
  const renderer: DilExternalComponentRenderer = (id, input, onEvent) => h(DilLibraryComponent, { id, input, onEvent, renderMarkdown })
  libraryRenderersByMarkdown.set(renderMarkdown, renderer)
  return renderer
}
