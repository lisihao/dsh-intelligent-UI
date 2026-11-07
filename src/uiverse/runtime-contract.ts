import type {
  UiverseRuntimeActionValue,
  UiverseRuntimeComponent,
  UiverseRuntimeFieldValue,
  UiverseRuntimeImageValue,
  UiverseRuntimeMode,
  UiverseRuntimeSelectionValues,
} from './runtime-registry.js'

export const UIVERSE_SHADOW_RENDERER_KEY = 'uiverse-shadow-v1' as const

export interface UiverseRuntimeMount {
  readonly componentId: string
  readonly values: UiverseRuntimeSelectionValues
}

function fault(code: string): never { throw new Error(`UIVERSE_RUNTIME_CONTRACT_${code}`) }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function originalComponentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.\/-]{0,159}$/u.test(value)) fault('COMPONENT_ID_INVALID')
  return value
}
function textRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined
  if (!record(value)) fault('TEXT_INVALID')
  const result: Record<string, string> = {}
  for (const [id, text] of Object.entries(value)) {
    if (typeof text !== 'string') fault('TEXT_INVALID')
    result[id] = text
  }
  return result
}
function fieldsRecord(value: unknown): Readonly<Record<string, UiverseRuntimeFieldValue>> | undefined {
  if (value === undefined) return undefined
  if (!record(value)) fault('FIELDS_INVALID')
  const result: Record<string, UiverseRuntimeFieldValue> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!record(raw)) fault('FIELDS_INVALID')
    const field: { value?: string, checked?: boolean, file?: boolean, disabled?: boolean } = {}
    if (raw.value !== undefined) { if (typeof raw.value !== 'string') fault('FIELDS_INVALID'); field.value = raw.value }
    if (raw.checked !== undefined) { if (typeof raw.checked !== 'boolean') fault('FIELDS_INVALID'); field.checked = raw.checked }
    if (raw.file !== undefined) { if (typeof raw.file !== 'boolean') fault('FIELDS_INVALID'); field.file = raw.file }
    if (raw.disabled !== undefined) { if (typeof raw.disabled !== 'boolean') fault('FIELDS_INVALID'); field.disabled = raw.disabled }
    result[id] = field
  }
  return result
}
function actionsRecord(value: unknown): Readonly<Record<string, UiverseRuntimeActionValue>> | undefined {
  if (value === undefined) return undefined
  if (!record(value)) fault('ACTIONS_INVALID')
  const result: Record<string, UiverseRuntimeActionValue> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!record(raw) || typeof raw.actionId !== 'string' || !/^[a-z][a-z0-9:_-]{0,159}$/u.test(raw.actionId)) fault('ACTIONS_INVALID')
    if (raw.disabled !== undefined && typeof raw.disabled !== 'boolean') fault('ACTIONS_INVALID')
    result[id] = { actionId: raw.actionId, ...(raw.disabled === undefined ? {} : { disabled: raw.disabled }) }
  }
  return result
}
function imagesRecord(value: unknown): Readonly<Record<string, UiverseRuntimeImageValue>> | undefined {
  if (value === undefined) return undefined
  if (!record(value)) fault('IMAGES_INVALID')
  const result: Record<string, UiverseRuntimeImageValue> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!record(raw) || typeof raw.src !== 'string' || raw.src.length > 512 * 1024) fault('IMAGES_INVALID')
    if (raw.alt !== undefined && typeof raw.alt !== 'string') fault('IMAGES_INVALID')
    result[id] = { src: raw.src, ...(raw.alt === undefined ? {} : { alt: raw.alt }) }
  }
  return result
}
function values(value: unknown): UiverseRuntimeSelectionValues {
  if (!record(value)) fault('VALUES_INVALID')
  for (const key of Object.keys(value)) if (!['mode', 'text', 'projectedTextIds', 'fields', 'actions', 'images'].includes(key)) fault('VALUES_INVALID')
  const mode = value.mode
  if (mode !== undefined && mode !== 'interactive' && mode !== 'read-only') fault('MODE_INVALID')
  if (value.projectedTextIds !== undefined && (!Array.isArray(value.projectedTextIds) || value.projectedTextIds.some(item => typeof item !== 'string'))) fault('PROJECTED_TEXT_INVALID')
  return {
    ...(mode === undefined ? {} : { mode: mode as UiverseRuntimeMode }),
    ...(value.text === undefined ? {} : { text: textRecord(value.text) }),
    ...(value.projectedTextIds === undefined ? {} : { projectedTextIds: [...value.projectedTextIds] as string[] }),
    ...(value.fields === undefined ? {} : { fields: fieldsRecord(value.fields) }),
    ...(value.actions === undefined ? {} : { actions: actionsRecord(value.actions) }),
    ...(value.images === undefined ? {} : { images: imagesRecord(value.images) }),
  }
}

/** Validates the only browser/server mount payload accepted for this renderer. */
export function parseUiverseRuntimeMount(value: unknown): UiverseRuntimeMount {
  if (!record(value) || Object.keys(value).some(key => key !== 'componentId' && key !== 'values')) fault('MOUNT_INVALID')
  return Object.freeze({ componentId: originalComponentId(value.componentId), values: values(value.values) })
}

/** The public DTO is validated at the RPC/client boundary before Shadow DOM use. */
export function parseUiverseRuntimeComponentDto(value: unknown): UiverseRuntimeComponent {
  if (!record(value)) fault('COMPONENT_DTO_INVALID')
  const requiredStrings = ['id', 'title', 'category', 'sourceSha256', 'source']
  if (requiredStrings.some(field => typeof value[field] !== 'string') || typeof value.availability !== 'string' || typeof value.selectableWhenBound !== 'boolean' || !Array.isArray(value.capabilities) || !record(value.inputSchema) || !Array.isArray(value.targets) || !Array.isArray(value.blockers) || !Array.isArray(value.notes) || !record(value.visualCharacteristics)) fault('COMPONENT_DTO_INVALID')
  // The server owns fixed source bytes and hash validation. This client parser
  // checks the structural boundary; renderer/eligibility re-check all target IDs.
  return value as unknown as UiverseRuntimeComponent
}
