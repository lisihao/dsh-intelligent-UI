/**
 * Boundary contracts for the pinned TuffUI React 19 realm.  These contracts
 * deliberately carry JSON data and named host actions only: neither model
 * output nor the iframe can send executable JavaScript to the other side.
 */
export const TUFFUI_PROTOCOL_VERSION = 1 as const
export const TUFFUI_SOURCE_REPOSITORY = 'https://github.com/yurigdesigner/tuffui.git'
export const TUFFUI_SOURCE_COMMIT = '378f3eaac693c693d2ec845baf38bf6c0488cb37'
export const TUFFUI_SOURCE_LICENSE = 'MIT'

export type TuffUiJson = null | boolean | number | string | readonly TuffUiJson[] | { readonly [key: string]: TuffUiJson }
export type TuffUiVisualKind = 'ui' | 'block'
export type TuffUiWireType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date' | 'renderable' | 'callback' | 'unknown' | 'unsupported'

export type TuffUiSourceProp = Readonly<{
  readonly name: string
  readonly optional: boolean
  /** Original fixed-source TypeScript type text, retained for provenance. */
  readonly sourceType: string
  /** Safe JSON transport category derived from the source type. */
  readonly wireType: TuffUiWireType
  /** Literal values are enforced when the source type is a literal-only union. */
  readonly literals?: readonly (string | number | boolean)[]
}>

export type TuffUiSourceExport = Readonly<{
  readonly name: string
  /** Named, destructured public props from the fixed upstream export. */
  readonly props: readonly TuffUiSourceProp[]
}>

export type TuffUiSourceEntry = Readonly<{
  readonly id: string
  readonly kind: TuffUiVisualKind
  readonly title: string
  readonly description: string
  readonly sourcePath: string
  readonly sha256: string
  readonly exports: readonly TuffUiSourceExport[]
}>

export type TuffUiSourceManifest = Readonly<{
  readonly formatVersion: 1
  readonly repository: typeof TUFFUI_SOURCE_REPOSITORY
  readonly commit: typeof TUFFUI_SOURCE_COMMIT
  readonly license: typeof TUFFUI_SOURCE_LICENSE
  readonly registrySha256: string
  readonly entries: readonly TuffUiSourceEntry[]
}>

export type TuffUiActionBinding = Readonly<{ readonly prop: string, readonly actionId: string }>
export type TuffUiComponentBinding = Readonly<{
  /** The fixed upstream named export to render. */
  readonly exportName: string
  /** JSON values bound to actual declared source props. */
  readonly props: Readonly<Record<string, TuffUiJson>>
  /** Source callback prop -> host-owned opaque action identifier. */
  readonly actions?: readonly TuffUiActionBinding[]
}>

export type TuffUiMount = Readonly<{
  readonly protocolVersion: typeof TUFFUI_PROTOCOL_VERSION
  readonly mountId: string
  readonly componentId: string
  readonly binding: TuffUiComponentBinding
}>

export type TuffUiHostToFrameMessage = Readonly<{
  readonly type: 'tuffui/mount' | 'tuffui/update' | 'tuffui/dispose'
  readonly protocolVersion: typeof TUFFUI_PROTOCOL_VERSION
  readonly nonce: string
  readonly mount?: TuffUiMount
  readonly mountId?: string
  readonly revision: number
}>

export type TuffUiFrameToHostMessage = Readonly<{
  readonly type: 'tuffui/mounted' | 'tuffui/action' | 'tuffui/error' | 'tuffui/disposed' | 'tuffui/resize'
  readonly protocolVersion: typeof TUFFUI_PROTOCOL_VERSION
  readonly nonce: string
  readonly mountId: string
  readonly revision: number
  readonly actionId?: string
  readonly payload?: TuffUiJson
  readonly code?: string
  readonly message?: string
  readonly height?: number
}>

export class TuffUiContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TuffUiContractError' }
}

export function isTuffUiJson(value: unknown, depth = 0): value is TuffUiJson {
  if (depth > 64 || value === null || typeof value === 'boolean' || typeof value === 'string') return depth <= 64 && (value === null || typeof value !== 'string' || value.length <= 200_000)
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 20_000 && value.every(item => isTuffUiJson(item, depth + 1))
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) return false
  const entries = Object.entries(record)
  return entries.length <= 20_000 && entries.every(([key, item]) => key.length <= 300 && key !== '__proto__' && key !== 'prototype' && key !== 'constructor' && isTuffUiJson(item, depth + 1))
}

export function assertTuffUiJson(value: unknown, label: string): asserts value is TuffUiJson {
  if (!isTuffUiJson(value)) throw new TuffUiContractError('TUFFUI_JSON_INVALID', `${label} must be finite JSON data.`)
}

export function assertTuffUiId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/u.test(value)) throw new TuffUiContractError('TUFFUI_ID_INVALID', `${label} must be a lowercase component identifier.`)
}

export function assertTuffUiActionId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/u.test(value)) throw new TuffUiContractError('TUFFUI_ACTION_ID_INVALID', `${label} must be an opaque host action identifier.`)
}

export function assertTuffUiNonce(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new TuffUiContractError('TUFFUI_NONCE_INVALID', 'Realm nonce must be 32 lowercase hexadecimal characters.')
}

export function assertTuffUiRevision(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new TuffUiContractError('TUFFUI_REVISION_INVALID', 'Revision must be a positive safe integer.')
}

export function isTuffUiCallbackProp(value: string): boolean { return /^on[A-Z][A-Za-z0-9]*$/u.test(value) }
