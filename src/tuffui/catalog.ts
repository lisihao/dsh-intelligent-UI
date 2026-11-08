import {
  TUFFUI_SOURCE_COMMIT,
  TUFFUI_SOURCE_LICENSE,
  TUFFUI_SOURCE_REPOSITORY,
  TuffUiContractError,
  assertTuffUiActionId,
  assertTuffUiId,
  assertTuffUiJson,
  isTuffUiCallbackProp,
  type TuffUiComponentBinding,
  type TuffUiActionBinding,
  type TuffUiJson,
  type TuffUiMount,
  type TuffUiSourceEntry,
  type TuffUiSourceManifest,
  type TuffUiSourceProp,
  type TuffUiVisualKind,
} from './contracts.js'

/** Every upstream visual entry at the pinned registry revision. */
const UI_IDS = `surface action-button choice-controls status-pill segmented-control progress-bar rolling-number text-field tooltip-hint action-menu popover-panel modal-sheet toast-stack select-field tab-panels disclosure agent-avatar loading-skeleton range-slider key-hint loader empty-state date-field drop-zone streaming-message agent-status message-branches response-feedback agent-composer agent-question tool-approval-queue tool-call-block file-changes terminal-output mcp-servers background-agents checkpoint-timeline run-trace eval-results context-window-meter memory-panel usage-summary rate-limits chat-thread user-message conversation-list prompt-suggestions attachment-preview code-block source-list chart-card dot-histogram tick-gauge mirror-strips radial-dots match-field radar-chart diverging-bars blast-radius iso-bars hex-density data-table stat-grid form-card result-carousel slot-picker confirmation-card json-viewer artifact-panel`.split(' ') as readonly string[]
const BLOCK_IDS = `ai-chat coding-agent data-answer booking-assistant agent-console support-widget handoff-inbox`.split(' ') as readonly string[]
const expected = new Map<string, TuffUiVisualKind>([...UI_IDS.map(id => [id, 'ui'] as const), ...BLOCK_IDS.map(id => [id, 'block'] as const)])

export const TUFFUI_VISUAL_ENTRY_COUNT = 76
export const TUFFUI_UI_ENTRY_COUNT = 69
export const TUFFUI_BLOCK_ENTRY_COUNT = 7
export const TUFFUI_VISUAL_IDS: readonly string[] = Object.freeze([...UI_IDS, ...BLOCK_IDS])

export type TuffUiCatalog = Readonly<{
  readonly manifest: TuffUiSourceManifest
  readonly entries: readonly TuffUiSourceEntry[]
  readonly byId: ReadonlyMap<string, TuffUiSourceEntry>
}>

export type TuffUiAvailability = Readonly<{
  readonly componentId: string
  readonly available: boolean
  readonly reason?: string
}>

function ownRecord(value: unknown, code: string, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TuffUiContractError(code, message)
  return value as Record<string, unknown>
}

function validateSourceEntry(entry: unknown): asserts entry is TuffUiSourceEntry {
  const item = ownRecord(entry, 'TUFFUI_MANIFEST_ENTRY_INVALID', 'Source manifest entry must be an object.')
  assertTuffUiId(item.id, 'entry.id')
  if (item.kind !== 'ui' && item.kind !== 'block') throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} has an unknown kind.`)
  for (const key of ['title', 'description', 'sourcePath', 'sha256'] as const) if (typeof item[key] !== 'string' || !item[key].trim()) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)}.${key} must be a non-empty string.`)
  if (!/^registry\/[a-z0-9-]+\/[a-z0-9-]+\.tsx$/u.test(item.sourcePath as string) || !/^[a-f0-9]{64}$/u.test(item.sha256 as string)) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} has invalid pinned source provenance.`)
  if (!Array.isArray(item.exports) || item.exports.length < 1) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} has no renderable export.`)
  const exportNames = new Set<string>()
  for (const exported of item.exports) {
    const value = ownRecord(exported, 'TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} export must be an object.`)
    if (typeof value.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/u.test(value.name) || exportNames.has(value.name)) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} export name is invalid.`)
    exportNames.add(value.name)
    if (!Array.isArray(value.props) || value.props.length < 1) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} export props are invalid.`)
    const propNames = new Set<string>()
    for (const prop of value.props) {
      const detail = ownRecord(prop, 'TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} prop must be an object.`)
      if (typeof detail.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/u.test(detail.name) || propNames.has(detail.name) || typeof detail.optional !== 'boolean' || typeof detail.sourceType !== 'string' || detail.sourceType.length > 4_000 || !['string', 'number', 'boolean', 'array', 'object', 'date', 'renderable', 'callback', 'unknown', 'unsupported'].includes(String(detail.wireType))) {
        throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} prop contract is invalid.`)
      }
      propNames.add(detail.name)
      if (detail.literals !== undefined && (!Array.isArray(detail.literals) || detail.literals.length < 1 || detail.literals.some(literal => !['string', 'number', 'boolean'].includes(typeof literal)))) throw new TuffUiContractError('TUFFUI_MANIFEST_ENTRY_INVALID', `${String(item.id)} prop literals are invalid.`)
    }
  }
}

/** Validates a build-generated provenance record before it can drive choices. */
export function createTuffUiCatalog(value: unknown): TuffUiCatalog {
  const manifest = ownRecord(value, 'TUFFUI_MANIFEST_INVALID', 'TuffUI source manifest must be an object.') as unknown as TuffUiSourceManifest
  if (manifest.formatVersion !== 1 || manifest.repository !== TUFFUI_SOURCE_REPOSITORY || manifest.commit !== TUFFUI_SOURCE_COMMIT || manifest.license !== TUFFUI_SOURCE_LICENSE || typeof manifest.registrySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.registrySha256) || !Array.isArray(manifest.entries)) {
    throw new TuffUiContractError('TUFFUI_MANIFEST_INVALID', 'TuffUI source manifest does not match the pinned repository, commit, license, or format.')
  }
  if (manifest.entries.length !== TUFFUI_VISUAL_ENTRY_COUNT) throw new TuffUiContractError('TUFFUI_MANIFEST_COVERAGE', `Expected ${String(TUFFUI_VISUAL_ENTRY_COUNT)} visual entries, received ${String(manifest.entries.length)}.`)
  const byId = new Map<string, TuffUiSourceEntry>()
  for (const entry of manifest.entries) {
    validateSourceEntry(entry)
    const expectedKind = expected.get(entry.id)
    if (!expectedKind || expectedKind !== entry.kind || byId.has(entry.id)) throw new TuffUiContractError('TUFFUI_MANIFEST_COVERAGE', `Unexpected, duplicate, or kind-mismatched TuffUI entry: ${entry.id}.`)
    byId.set(entry.id, entry)
  }
  if (byId.size !== expected.size || [...expected.keys()].some(id => !byId.has(id))) throw new TuffUiContractError('TUFFUI_MANIFEST_COVERAGE', 'Pinned TuffUI source manifest omitted one or more visual entries.')
  return Object.freeze({ manifest, entries: Object.freeze([...manifest.entries]), byId })
}

export function tuffUiEntry(catalog: TuffUiCatalog, componentId: string): TuffUiSourceEntry {
  assertTuffUiId(componentId, 'componentId')
  const entry = catalog.byId.get(componentId)
  if (!entry) throw new TuffUiContractError('TUFFUI_COMPONENT_UNKNOWN', `No pinned TuffUI component named ${componentId}.`)
  return entry
}

function exportFor(entry: TuffUiSourceEntry, name: string) {
  const target = entry.exports.find(item => item.name === name)
  if (!target) throw new TuffUiContractError('TUFFUI_EXPORT_UNKNOWN', `${entry.id} does not export ${name}.`)
  return target
}

function propFor(exported: { readonly props: readonly TuffUiSourceProp[] }, name: string): TuffUiSourceProp | undefined {
  return exported.props.find(prop => prop.name === name)
}

function validateWireValue(componentId: string, prop: TuffUiSourceProp, value: unknown): void {
  assertTuffUiJson(value, `${componentId}.${prop.name}`)
  if (prop.wireType === 'unsupported') throw new TuffUiContractError('TUFFUI_PROP_UNSUPPORTED', `${componentId}.${prop.name} requires a non-serializable source value (${prop.sourceType}).`)
  if (prop.wireType === 'callback') throw new TuffUiContractError('TUFFUI_CALLBACK_DATA', `${componentId}.${prop.name} must be bound through actions, never JSON data.`)
  if (prop.wireType === 'string' && typeof value !== 'string' || prop.wireType === 'number' && typeof value !== 'number' || prop.wireType === 'boolean' && typeof value !== 'boolean' || prop.wireType === 'array' && !Array.isArray(value) || prop.wireType === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value)) || prop.wireType === 'date' && typeof value !== 'string' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
    throw new TuffUiContractError('TUFFUI_PROP_TYPE_INVALID', `${componentId}.${prop.name} must satisfy ${prop.wireType} (${prop.sourceType}).`)
  }
  if (prop.wireType === 'renderable' && !(value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value))) throw new TuffUiContractError('TUFFUI_PROP_TYPE_INVALID', `${componentId}.${prop.name} must be a JSON-renderable child.`)
  if (prop.literals?.length && !prop.literals.some(literal => literal === value)) throw new TuffUiContractError('TUFFUI_PROP_LITERAL_INVALID', `${componentId}.${prop.name} must be one of its fixed source literals.`)
}

/**
 * A selection is legal only with data bound to declared source props.  It
 * never invents demonstration data, props, callbacks, or host authority.
 */
export function validateTuffUiBinding(catalog: TuffUiCatalog, componentId: string, binding: unknown): TuffUiComponentBinding {
  const entry = tuffUiEntry(catalog, componentId)
  const candidate = ownRecord(binding, 'TUFFUI_BINDING_INVALID', `${componentId} binding must be an object.`)
  if (typeof candidate.exportName !== 'string') throw new TuffUiContractError('TUFFUI_BINDING_INVALID', `${componentId}.exportName is required.`)
  const exported = exportFor(entry, candidate.exportName)
  const props = ownRecord(candidate.props, 'TUFFUI_BINDING_INVALID', `${componentId}.props must be an object.`)
  if (Object.keys(props).length === 0) throw new TuffUiContractError('TUFFUI_BINDING_EMPTY', `${componentId} has no supplied source props; use an explicit unavailable state instead of a demo fixture.`)
  for (const [name, data] of Object.entries(props)) {
    const prop = propFor(exported, name)
    if (!prop) throw new TuffUiContractError('TUFFUI_PROP_UNKNOWN', `${componentId}.${candidate.exportName} does not declare prop ${name}.`)
    validateWireValue(componentId, prop, data)
  }
  if (candidate.actions !== undefined && !Array.isArray(candidate.actions)) throw new TuffUiContractError('TUFFUI_ACTIONS_INVALID', `${componentId}.actions must be an array.`)
  const actions: TuffUiActionBinding[] = []
  const propsSeen = new Set<string>(), idsSeen = new Set<string>()
  for (const raw of candidate.actions ?? []) {
    const action = ownRecord(raw, 'TUFFUI_ACTIONS_INVALID', `${componentId} action must be an object.`)
    const prop = typeof action.prop === 'string' ? propFor(exported, action.prop) : undefined
    if (!prop || prop.wireType !== 'callback' || !isTuffUiCallbackProp(prop.name) || propsSeen.has(prop.name)) throw new TuffUiContractError('TUFFUI_ACTION_PROP_INVALID', `${componentId} action prop must be one distinct declared callback prop.`)
    assertTuffUiActionId(action.actionId, `${componentId}.${action.prop}`)
    if (idsSeen.has(action.actionId)) throw new TuffUiContractError('TUFFUI_ACTION_ID_DUPLICATE', `${componentId} repeats action ${action.actionId}.`)
    propsSeen.add(prop.name); idsSeen.add(action.actionId); actions.push({ prop: prop.name, actionId: action.actionId })
  }
  for (const prop of exported.props) {
    if (prop.optional) continue
    if (prop.wireType === 'callback') {
      if (!propsSeen.has(prop.name)) throw new TuffUiContractError('TUFFUI_REQUIRED_ACTION_MISSING', `${componentId}.${prop.name} is a required source callback and needs a host action binding.`)
    } else if (prop.wireType === 'unsupported') {
      throw new TuffUiContractError('TUFFUI_REQUIRED_PROP_UNSUPPORTED', `${componentId}.${prop.name} is required but cannot cross the JSON realm boundary (${prop.sourceType}).`)
    } else if (!(prop.name in props)) {
      throw new TuffUiContractError('TUFFUI_REQUIRED_PROP_MISSING', `${componentId}.${prop.name} is required by the fixed source type.`)
    }
  }
  return Object.freeze({ exportName: exported.name, props: Object.freeze({ ...props } as Record<string, TuffUiJson>), ...(actions.length ? { actions: Object.freeze(actions) } : {}) })
}

export function validateTuffUiMount(catalog: TuffUiCatalog, value: unknown): TuffUiMount {
  const raw = ownRecord(value, 'TUFFUI_MOUNT_INVALID', 'TuffUI mount must be an object.')
  if (raw.protocolVersion !== 1) throw new TuffUiContractError('TUFFUI_PROTOCOL_UNSUPPORTED', 'Unsupported TuffUI mount protocol.')
  assertTuffUiId(raw.mountId, 'mountId')
  assertTuffUiId(raw.componentId, 'componentId')
  return Object.freeze({ protocolVersion: 1, mountId: raw.mountId, componentId: raw.componentId, binding: validateTuffUiBinding(catalog, raw.componentId, raw.binding) })
}

/** Turn host-observed bindings into transparent Jev candidate availability. */
export function tuffUiAvailability(catalog: TuffUiCatalog, bindings: Readonly<Record<string, unknown>>): readonly TuffUiAvailability[] {
  return catalog.entries.map(entry => {
    try { validateTuffUiBinding(catalog, entry.id, bindings[entry.id]); return { componentId: entry.id, available: true } }
    catch (error) { return { componentId: entry.id, available: false, reason: error instanceof Error ? error.message : String(error) } }
  })
}
