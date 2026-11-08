/**
 * JSON-only public contracts for the external DIL bridge. These describe
 * authored binding data, never the Host-generated realm mount, nonce, or
 * callback authority. Exact fixed-library schemas validate after selection.
 *
 * This module deliberately has no React, renderer, or browser dependency so
 * catalog/RPC tooling can return a contract without importing the view graph.
 */
import { z, type core } from 'zod'

import { liveSeriesInputSchema } from '../adaptive-ui/source-contracts.js'
import {
  historicalLibraryInputSchema,
  skulletLibraryInputSchema,
  torphLibraryInputSchema,
} from './library-inputs.js'

export type DilLibraryContractJson =
  | null
  | boolean
  | number
  | string
  | readonly DilLibraryContractJson[]
  | { readonly [key: string]: DilLibraryContractJson }

export const DIL_LIBRARY_INPUT_SCHEMA_VERSION = 1 as const
const MAX_LIBRARY_TEXT = 20_000

function isJsonRecord(value: unknown): value is Record<string, DilLibraryContractJson> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clone Zod's public JSON Schema output into the JSON-only catalog boundary. */
function jsonSchemaOf(schema: core.$ZodType): Readonly<Record<string, DilLibraryContractJson>> {
  const serialized = JSON.stringify(z.toJSONSchema(schema))
  const parsed: unknown = JSON.parse(serialized)
  if (!isJsonRecord(parsed)) throw new Error('DIL_LIBRARY_INPUT_SCHEMA_INVALID')
  return Object.freeze(parsed)
}

const TUFFUI_BINDING_INPUT_SCHEMA = Object.freeze({
  version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
  library: 'tuffui',
  type: 'object',
  additionalProperties: false,
  required: ['exportName', 'props'],
  properties: {
    exportName: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$', maxLength: 160 },
    props: { type: 'object', description: 'Actual source values. The selected fixed Tuff export validates its exact prop names, required fields, and types.' },
    actions: {
      type: 'array', maxItems: 64,
      items: { type: 'object', additionalProperties: false, required: ['prop', 'actionId'], properties: { prop: { type: 'string', pattern: '^on[A-Z][A-Za-z0-9]*$' }, actionId: { type: 'string' } } },
    },
  },
  event: 'Actions are inert until the outer DIL component supplies onChange; emitted data stays in the compiled local handler.',
} as const satisfies DilLibraryContractJson)

const UIVERSE_VALUES_INPUT_SCHEMA = Object.freeze({
  version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
  library: 'uiverse',
  type: 'object',
  description: 'Use the fixed source slot map directly, or wrap it as { values, content? }. Content is trusted Markdown projected by the Host, never HTML.',
  slotMap: {
    type: 'object', additionalProperties: false,
    properties: {
      mode: { enum: ['read-only', 'interactive'] },
      text: { type: 'object', additionalProperties: { type: 'string' } },
      projectedTextIds: { type: 'array', items: { type: 'string' } },
      fields: { type: 'object', description: 'Actual fixed source field values.' },
      actions: { type: 'object', description: 'Actual fixed source action values.' },
      images: { type: 'object', description: 'Target ID -> {src,alt?}; src is bounded base64 data:image/png|jpeg|gif|webp|avif, never a remote URL; omitted alt clears the author description.' },
    },
  },
  wrapper: { type: 'object', additionalProperties: false, properties: { values: { type: 'object' }, content: { type: 'string', format: 'markdown', maxLength: MAX_LIBRARY_TEXT } } },
  constraints: ['When projectedTextIds is nonempty, content is required.', 'The exact archived component revalidates all target IDs and slot completeness.', 'Interactive source values require an outer DIL onChange event port.'],
} as const satisfies DilLibraryContractJson)

type CuratedRole = 'card' | 'loader' | 'button' | 'input' | 'toggle'

function curatedInputSchema(role: CuratedRole): DilLibraryContractJson {
  if (role === 'card') return { version: DIL_LIBRARY_INPUT_SCHEMA_VERSION, library: 'uiverse-curated', type: 'object', additionalProperties: false, required: ['content'], properties: { content: { type: 'string', format: 'markdown', maxLength: MAX_LIBRARY_TEXT } }, event: 'The Host renders content through the supplied semantic Markdown renderer.' }
  if (role === 'loader') return { version: DIL_LIBRARY_INPUT_SCHEMA_VERSION, library: 'uiverse-curated', type: 'object', additionalProperties: false, required: ['loading'], properties: { loading: { const: true }, label: { type: 'string', maxLength: 200 } }, constraints: ['Only source-declared initial loading is valid.'] }
  return { version: DIL_LIBRARY_INPUT_SCHEMA_VERSION, library: 'uiverse-curated', type: 'object', additionalProperties: false, required: ['props'], properties: { props: { type: 'object', description: 'Actual source-native control props. Nested handler or authority fields are not accepted.' }, label: { type: 'string', maxLength: 200 } }, event: 'The Host injects one local native handler only when the outer DIL component supplies onChange and props.disabled is not true.' }
}

const fixedLibraryInputSchemas: Readonly<Record<string, DilLibraryContractJson>> = Object.freeze({
  'component:skullet': {
    version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
    library: 'skullet',
    ...jsonSchemaOf(skulletLibraryInputSchema),
    constraints: ['Only source-declared initial loading is valid.'],
  },
  'component:torph': {
    version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
    library: 'torph',
    ...jsonSchemaOf(torphLibraryInputSchema),
    constraints: ['text must be a short plain value; markup, code, URLs, and Markdown links are rejected by the runtime validator.'],
  },
  'component:liveline': {
    version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
    library: 'liveline',
    ...jsonSchemaOf(liveSeriesInputSchema),
    constraints: [
      'source and unit must be nonempty after trimming.',
      'points must be nonempty finite time/value observations ordered by strictly increasing time.',
      'updatedAt, when supplied, must not predate the final source point.',
    ],
  },
  'component:visx-historical': {
    version: DIL_LIBRARY_INPUT_SCHEMA_VERSION,
    library: 'visx',
    ...jsonSchemaOf(historicalLibraryInputSchema),
    constraints: [
      'Every series.values array must have the same length as plan.labels.',
      'series.originals, when supplied, and sourceRows, when supplied, must have the same length as plan.labels.',
      'Every omitted row or column range is a zero-based half-open [start,end) range with end greater than start.',
      'The original finite labels, series values, units, and optional originals remain visible in the native source table.',
    ],
  },
})

const curatedLibraryInputSchemas: Readonly<Record<string, DilLibraryContractJson>> = Object.freeze(Object.fromEntries(
  ['soft-relief', 'clear-glass', 'mechanical-outline'].flatMap(componentSet =>
    (['card', 'loader', 'button', 'input', 'toggle'] as const).map(role => [`uiverse:${componentSet}:${role}`, curatedInputSchema(role)]),
  ),
))

/** Exact contracts for the four built-in libraries and all fifteen curated IDs. */
export const DIL_LIBRARY_COMPONENT_INPUT_SCHEMAS: Readonly<Record<string, DilLibraryContractJson>> = Object.freeze({
  ...fixedLibraryInputSchemas,
  ...curatedLibraryInputSchemas,
})

/** Resolve a JSON-only authored-data contract for the requested fixed library ID. */
export function getDilLibraryComponentInputSchema(componentId: string): DilLibraryContractJson | undefined {
  const exact = DIL_LIBRARY_COMPONENT_INPUT_SCHEMAS[componentId]
  if (exact !== undefined) return exact
  if (/^tuffui:[a-z][a-z0-9-]{0,95}$/u.test(componentId)) return TUFFUI_BINDING_INPUT_SCHEMA
  if (/^uiverse:[A-Za-z][A-Za-z0-9_.\/-]{0,159}$/u.test(componentId) && !componentId.includes('..')) return UIVERSE_VALUES_INPUT_SCHEMA
  return undefined
}
