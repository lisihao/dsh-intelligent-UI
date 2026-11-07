import { TuffUiContractError, isTuffUiJson, type TuffUiComponentBinding, type TuffUiJson } from './contracts.js'
import { tuffUiEntry, validateTuffUiBinding, type TuffUiCatalog } from './catalog.js'

export const TUFFUI_TYPE_SCHEMA_FORMAT_VERSION = 1 as const
export type TuffUiValueSchema =
  | Readonly<{ readonly kind: 'null' | 'boolean' | 'string' | 'number' | 'date' | 'json' | 'renderable' | 'callback' }>
  | Readonly<{ readonly kind: 'literal', readonly value: string | number | boolean | null }>
  | Readonly<{ readonly kind: 'array', readonly items: TuffUiValueSchema }>
  | Readonly<{ readonly kind: 'object', readonly properties: Readonly<Record<string, Readonly<{ readonly optional: boolean, readonly schema: TuffUiValueSchema }>>>, readonly additional?: TuffUiValueSchema }>
  | Readonly<{ readonly kind: 'union', readonly variants: readonly TuffUiValueSchema[] }>
  | Readonly<{ readonly kind: 'opaque', readonly reason: string }>

export type TuffUiTypeSchemaManifest = Readonly<{
  readonly formatVersion: typeof TUFFUI_TYPE_SCHEMA_FORMAT_VERSION
  readonly sourceManifestSha256: string
  readonly entries: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, TuffUiValueSchema>>>>>>
}>

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TuffUiContractError(code, code)
  return value as Record<string, unknown>
}
function validSchema(value: unknown, depth = 0): value is TuffUiValueSchema {
  if (depth > 24 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (['null', 'boolean', 'string', 'number', 'date', 'json', 'renderable', 'callback'].includes(String(item.kind))) return Object.keys(item).length === 1
  if (item.kind === 'literal') return Object.keys(item).length === 2 && (item.value === null || ['string', 'number', 'boolean'].includes(typeof item.value))
  if (item.kind === 'array') return Object.keys(item).length === 2 && validSchema(item.items, depth + 1)
  if (item.kind === 'union') return Array.isArray(item.variants) && item.variants.length >= 1 && item.variants.length <= 32 && item.variants.every(item => validSchema(item, depth + 1))
  if (item.kind === 'opaque') return typeof item.reason === 'string' && item.reason.length > 0 && item.reason.length <= 500
  if (item.kind === 'object') {
    if (!item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties) || Object.keys(item.properties as object).length > 128) return false
    for (const value of Object.values(item.properties as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const field = value as Record<string, unknown>
      if (typeof field.optional !== 'boolean' || !validSchema(field.schema, depth + 1)) return false
    }
    return item.additional === undefined || validSchema(item.additional, depth + 1)
  }
  return false
}

export function validateTuffUiTypeSchemaManifest(value: unknown): TuffUiTypeSchemaManifest {
  const candidate = record(value, 'TUFFUI_TYPE_SCHEMA_INVALID')
  if (candidate.formatVersion !== TUFFUI_TYPE_SCHEMA_FORMAT_VERSION || typeof candidate.sourceManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.sourceManifestSha256) || !candidate.entries || typeof candidate.entries !== 'object' || Array.isArray(candidate.entries)) throw new TuffUiContractError('TUFFUI_TYPE_SCHEMA_INVALID', 'TuffUI type schema manifest is invalid.')
  for (const exports of Object.values(candidate.entries as Record<string, unknown>)) {
    if (!exports || typeof exports !== 'object' || Array.isArray(exports)) throw new TuffUiContractError('TUFFUI_TYPE_SCHEMA_INVALID', 'TuffUI type export schema is invalid.')
    for (const props of Object.values(exports as Record<string, unknown>)) {
      if (!props || typeof props !== 'object' || Array.isArray(props)) throw new TuffUiContractError('TUFFUI_TYPE_SCHEMA_INVALID', 'TuffUI prop schema is invalid.')
      for (const schema of Object.values(props as Record<string, unknown>)) if (!validSchema(schema)) throw new TuffUiContractError('TUFFUI_TYPE_SCHEMA_INVALID', 'TuffUI value schema is invalid.')
    }
  }
  return candidate as TuffUiTypeSchemaManifest
}

function assertSchema(schema: TuffUiValueSchema, value: unknown, path: string, depth = 0): void {
  if (depth > 24) throw new TuffUiContractError('TUFFUI_NESTED_SCHEMA_DEPTH', `${path} exceeds schema depth.`)
  if (schema.kind === 'opaque') throw new TuffUiContractError('TUFFUI_NESTED_SCHEMA_UNAVAILABLE', `${path} cannot be validated because source type resolution stopped at ${schema.reason}.`)
  if (schema.kind === 'null') { if (value !== null) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be null.`); return }
  if (schema.kind === 'json') { if (!isTuffUiJson(value)) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be bounded finite JSON.`); return }
  if (schema.kind === 'boolean' || schema.kind === 'string' || schema.kind === 'number') { if (typeof value !== schema.kind || schema.kind === 'number' && !Number.isFinite(value)) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be ${schema.kind}.`); return }
  if (schema.kind === 'date') { if (typeof value !== 'string' || Number.isNaN(new Date(value).valueOf())) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be an ISO date string.`); return }
  if (schema.kind === 'renderable') { if (!(value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value))) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be a JSON-renderable child.`); if (Array.isArray(value)) value.forEach((item, index) => assertSchema(schema, item, `${path}[${String(index)}]`, depth + 1)); return }
  if (schema.kind === 'callback') throw new TuffUiContractError('TUFFUI_NESTED_CALLBACK_INVALID', `${path} must be represented by a host action binding.`)
  if (schema.kind === 'literal') { if (value !== schema.value) throw new TuffUiContractError('TUFFUI_NESTED_LITERAL_INVALID', `${path} must equal the source literal.`); return }
  if (schema.kind === 'array') { if (!Array.isArray(value)) throw new TuffUiContractError('TUFFUI_NESTED_TYPE_INVALID', `${path} must be an array.`); value.forEach((item, index) => assertSchema(schema.items, item, `${path}[${String(index)}]`, depth + 1)); return }
  if (schema.kind === 'union') {
    const errors: unknown[] = []
    for (const variant of schema.variants) try { assertSchema(variant, value, path, depth + 1); return } catch (error) { errors.push(error) }
    throw new TuffUiContractError('TUFFUI_NESTED_UNION_INVALID', `${path} does not satisfy any source union variant.`)
  }
  if (schema.kind !== 'object') throw new TuffUiContractError('TUFFUI_NESTED_SCHEMA_INVALID', `${path} has an unsupported schema kind.`)
  const objectSchema = schema
  const object = record(value, 'TUFFUI_NESTED_TYPE_INVALID')
  for (const [name, field] of Object.entries(objectSchema.properties)) {
    if (!(name in object)) { if (!field.optional) throw new TuffUiContractError('TUFFUI_NESTED_REQUIRED_MISSING', `${path}.${name} is required by the source type.`); continue }
    assertSchema(field.schema, object[name], `${path}.${name}`, depth + 1)
  }
  for (const [name, child] of Object.entries(object)) {
    if (name in objectSchema.properties) continue
    if (!objectSchema.additional) throw new TuffUiContractError('TUFFUI_NESTED_UNKNOWN_FIELD', `${path}.${name} is not declared by the source type.`)
    assertSchema(objectSchema.additional, child, `${path}.${name}`, depth + 1)
  }
}

/**
 * Requires a build-generated schema for every supplied complex source prop.
 * This prevents a generic JSON object from bypassing an unresolved nested type.
 */
export function validateTuffUiTypedBinding(catalog: TuffUiCatalog, types: TuffUiTypeSchemaManifest, componentId: string, value: unknown): TuffUiComponentBinding {
  const manifest = validateTuffUiTypeSchemaManifest(types)
  const binding = validateTuffUiBinding(catalog, componentId, value)
  const entry = tuffUiEntry(catalog, componentId), exported = entry.exports.find(item => item.name === binding.exportName)!
  const schemas = manifest.entries[componentId]?.[binding.exportName]
  for (const [name, propValue] of Object.entries(binding.props)) {
    const prop = exported.props.find(item => item.name === name)!
    if (!['object', 'array', 'unknown', 'renderable', 'date'].includes(prop.wireType)) continue
    const schema = schemas?.[name]
    if (!schema) throw new TuffUiContractError('TUFFUI_NESTED_SCHEMA_REQUIRED', `${componentId}.${binding.exportName}.${name} needs a generated source type schema.`)
    assertSchema(schema, propValue, `${componentId}.${name}`)
  }
  return binding
}
