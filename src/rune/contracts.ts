import { componentRuntimeInfoSchema, type ComponentRuntimeInfo } from '../component-runtime-contracts.js'

export const RUNE_FRAME_PROTOCOL_VERSION = 1 as const
export const RUNE_SOURCE_COMMIT = '4ca683561a100e16b1ce32f3576f4ade61bd2924'
export const RUNE_MAX_SURFACES = 64
export const RUNE_MAX_EXTENT = 32_768
export const RUNE_MAX_ORIGIN = 65_536
export const RUNE_MAX_VISIBLE_WIDTH = 4_096
export const RUNE_MAX_VISIBLE_HEIGHT = 2_048

export type RuneSurfaceRole = 'reading' | 'card' | 'button' | 'input' | 'toggle' | 'chart'
export type RuneSurfaceState = 'idle' | 'hover' | 'focus' | 'pressed' | 'disabled'
export type RuneSurfaceMaterial = 'native' | 'liquid-metal' | 'fluted-glass'
export type RuneJson = null | boolean | number | string | readonly RuneJson[] | { readonly [key: string]: RuneJson }

export type RuneSurface = Readonly<{
  id: string
  role: RuneSurfaceRole
  x: number
  y: number
  width: number
  height: number
  state: RuneSurfaceState
  material: RuneSurfaceMaterial
}>

export type RuneMaterialPayload = Readonly<{
  version: typeof RUNE_FRAME_PROTOCOL_VERSION
  width: number
  height: number
  reducedMotion: boolean
  surfaces: readonly RuneSurface[]
}>

export type RuneConnectMessage = Readonly<{
  type: 'rune/connect'
  protocolVersion: typeof RUNE_FRAME_PROTOCOL_VERSION
  nonce: string
  parentOrigin: string
}>
export type RuneHostMessage = Readonly<{
  type: 'rune/mount' | 'rune/update' | 'rune/dispose'
  protocolVersion: typeof RUNE_FRAME_PROTOCOL_VERSION
  nonce: string
  revision: number
  payload?: RuneMaterialPayload
}>
export type RuneFrameMessage = Readonly<{
  type: 'rune/ready' | 'rune/mounted' | 'rune/updated' | 'rune/disposed' | 'rune/error'
  protocolVersion: typeof RUNE_FRAME_PROTOCOL_VERSION
  nonce: string
  revision: number
  code?: string
}>

export class RuneThemeError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'RuneThemeError'
  }
}

const roles = new Set<RuneSurfaceRole>(['reading', 'card', 'button', 'input', 'toggle', 'chart'])
const states = new Set<RuneSurfaceState>(['idle', 'hover', 'focus', 'pressed', 'disabled'])
const materials = new Set<RuneSurfaceMaterial>(['native', 'liquid-metal', 'fluted-glass'])
const noncePattern = /^[a-f0-9]{32}$/u
const codePattern = /^[A-Z][A-Z0-9_]{2,119}$/u

function fail(code: string, message?: string): never { throw new RuneThemeError(code, message) }
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function record(value: unknown, code: string): Record<string, unknown> { return plainRecord(value) ? value : fail(code) }
function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort(), sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail(code)
}
function finiteExtent(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > RUNE_MAX_EXTENT) fail(code)
  return value
}
function finiteOrigin(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > RUNE_MAX_ORIGIN) fail(code)
  return value
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 160 || /[\u0000-\u001f\u007f]/u.test(value)) fail('RUNE_THEME_SURFACE_ID_INVALID')
  return value
}

export function assertRuneNonce(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !noncePattern.test(value)) fail('RUNE_FRAME_NONCE_INVALID')
}
export function assertRuneRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) fail('RUNE_FRAME_REVISION_INVALID')
}

/** The sole data boundary from the Host DOM into Rune's Rust material layer. */
export function parseRuneMaterialPayload(value: unknown): RuneMaterialPayload {
  const raw = record(value, 'RUNE_THEME_PAYLOAD_INVALID')
  exactKeys(raw, ['version', 'width', 'height', 'reducedMotion', 'surfaces'], 'RUNE_THEME_PAYLOAD_EXTRA_FIELD')
  if (raw.version !== RUNE_FRAME_PROTOCOL_VERSION) fail('RUNE_THEME_CONTRACT_VERSION_UNSUPPORTED')
  const width = finiteExtent(raw.width, 'RUNE_THEME_WIDTH_INVALID')
  const height = finiteExtent(raw.height, 'RUNE_THEME_HEIGHT_INVALID')
  if (typeof raw.reducedMotion !== 'boolean') fail('RUNE_THEME_REDUCED_MOTION_INVALID')
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length > RUNE_MAX_SURFACES) fail('RUNE_THEME_SURFACE_LIMIT_EXCEEDED')
  const ids = new Set<string>()
  const surfaces = raw.surfaces.map((input): RuneSurface => {
    const surface = record(input, 'RUNE_THEME_SURFACE_INVALID')
    exactKeys(surface, ['id', 'role', 'x', 'y', 'width', 'height', 'state', 'material'], 'RUNE_THEME_SURFACE_EXTRA_FIELD')
    const surfaceId = id(surface.id)
    if (ids.has(surfaceId)) fail('RUNE_THEME_SURFACE_ID_DUPLICATE')
    ids.add(surfaceId)
    if (typeof surface.role !== 'string' || !roles.has(surface.role as RuneSurfaceRole)) fail('RUNE_THEME_SURFACE_ROLE_INVALID')
    if (typeof surface.state !== 'string' || !states.has(surface.state as RuneSurfaceState)) fail('RUNE_THEME_SURFACE_STATE_INVALID')
    if (typeof surface.material !== 'string' || !materials.has(surface.material as RuneSurfaceMaterial)) fail('RUNE_THEME_SURFACE_MATERIAL_INVALID')
    return Object.freeze({
      id: surfaceId,
      role: surface.role as RuneSurfaceRole,
      x: finiteOrigin(surface.x, 'RUNE_THEME_SURFACE_X_INVALID'),
      y: finiteOrigin(surface.y, 'RUNE_THEME_SURFACE_Y_INVALID'),
      width: finiteExtent(surface.width, 'RUNE_THEME_SURFACE_WIDTH_INVALID'),
      height: finiteExtent(surface.height, 'RUNE_THEME_SURFACE_HEIGHT_INVALID'),
      state: surface.state as RuneSurfaceState,
      material: surface.material as RuneSurfaceMaterial,
    })
  })
  return Object.freeze({ version: RUNE_FRAME_PROTOCOL_VERSION, width, height, reducedMotion: raw.reducedMotion, surfaces: Object.freeze(surfaces) })
}

export function parseRuneRuntimeInfo(value: unknown): ComponentRuntimeInfo {
  const info = componentRuntimeInfoSchema.parse(value)
  if (info.library !== 'rune') fail('RUNE_RUNTIME_LIBRARY_INVALID')
  if (info.sourceCommit !== RUNE_SOURCE_COMMIT) fail('RUNE_RUNTIME_SOURCE_UNKNOWN')
  const url = new URL(info.frameUrl)
  if (!url.pathname.endsWith('/frame.html')) fail('RUNE_RUNTIME_FRAME_ENTRY_INVALID')
  return Object.freeze({ ...info })
}

export function createRuneNonce(crypto: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  if (!crypto?.getRandomValues) fail('RUNE_FRAME_CRYPTO_UNAVAILABLE')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export function parseRuneFrameMessage(value: unknown, nonce: string): RuneFrameMessage | undefined {
  assertRuneNonce(nonce)
  if (!plainRecord(value)) return undefined
  const type = value.type
  if (typeof type !== 'string' || !['rune/ready', 'rune/mounted', 'rune/updated', 'rune/disposed', 'rune/error'].includes(type)) return undefined
  if (value.protocolVersion !== RUNE_FRAME_PROTOCOL_VERSION || value.nonce !== nonce) return undefined
  const expected = type === 'rune/error' ? ['type', 'protocolVersion', 'nonce', 'revision', 'code'] : ['type', 'protocolVersion', 'nonce', 'revision']
  exactKeys(value, expected, 'RUNE_FRAME_MESSAGE_EXTRA_FIELD')
  if (type === 'rune/ready') {
    if (value.revision !== 0) return undefined
  } else assertRuneRevision(value.revision)
  if (type === 'rune/error' && (typeof value.code !== 'string' || !codePattern.test(value.code))) fail('RUNE_FRAME_ERROR_INVALID')
  return Object.freeze({
    type: type as RuneFrameMessage['type'], protocolVersion: RUNE_FRAME_PROTOCOL_VERSION, nonce,
    revision: value.revision as number, ...(type === 'rune/error' ? { code: value.code as string } : {}),
  })
}

export function runePayloadMessage(type: 'rune/mount' | 'rune/update', nonce: string, revision: number, payload: unknown): RuneHostMessage {
  assertRuneNonce(nonce); assertRuneRevision(revision)
  return Object.freeze({ type, protocolVersion: RUNE_FRAME_PROTOCOL_VERSION, nonce, revision, payload: parseRuneMaterialPayload(payload) })
}

export function runeDisposeMessage(nonce: string, revision: number): RuneHostMessage {
  assertRuneNonce(nonce); assertRuneRevision(revision)
  return Object.freeze({ type: 'rune/dispose', protocolVersion: RUNE_FRAME_PROTOCOL_VERSION, nonce, revision })
}

export function runeConnectMessage(nonce: string, parentOrigin: string): RuneConnectMessage {
  assertRuneNonce(nonce)
  if (!/^https?:\/\/[^/]+$/u.test(parentOrigin)) fail('RUNE_FRAME_PARENT_ORIGIN_INVALID')
  return Object.freeze({ type: 'rune/connect', protocolVersion: RUNE_FRAME_PROTOCOL_VERSION, nonce, parentOrigin })
}
