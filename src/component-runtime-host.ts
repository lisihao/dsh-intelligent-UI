import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  ComponentAssetsHostError,
  startComponentAssetsServer,
  type ComponentAsset,
  type ComponentAssetsServer,
} from './component-assets-host.js'

export type ComponentRuntimeLibrary = 'rune' | 'tuffui'
export const COMPONENT_RUNTIME_PROTOCOL_VERSION = 1 as const
export const COMPONENT_RUNTIME_MAX_ASSETS = 64
export const COMPONENT_RUNTIME_MAX_ASSET_BYTES = 64 * 1024 * 1024
export const COMPONENT_RUNTIME_MAX_MANIFEST_BYTES = 4 * 1024 * 1024

export const COMPONENT_RUNTIME_SOURCE_COMMITS: Readonly<Record<ComponentRuntimeLibrary, string>> = Object.freeze({
  rune: '4ca683561a100e16b1ce32f3576f4ade61bd2924',
  tuffui: '378f3eaac693c693d2ec845baf38bf6c0488cb37',
})

export const COMPONENT_RUNTIME_CSPS: Readonly<Record<ComponentRuntimeLibrary, string>> = Object.freeze({
  rune: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
  tuffui: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
})

export interface ComponentRuntimeHostOptions {
  /** Plugin-owned, fixed bundle roots. These are never derived from a request. */
  readonly assetRoots: Readonly<Record<ComponentRuntimeLibrary, string>>
}

export interface ComponentRuntimeInfo {
  readonly protocolVersion: typeof COMPONENT_RUNTIME_PROTOCOL_VERSION
  readonly library: ComponentRuntimeLibrary
  readonly frameUrl: string
  readonly sourceCommit: string
}

export class ComponentRuntimeHostError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'ComponentRuntimeHostError'
  }
}

type RuntimeManifestAsset = Readonly<{ path: string, contentType: string, sha256: string, bytes: number }>
type RuntimeManifest = Readonly<{
  formatVersion: 1
  library: ComponentRuntimeLibrary
  sourceCommit: string
  entry: string
  assets: readonly RuntimeManifestAsset[]
}>
type VerifiedAsset = Readonly<{ contentType: string, body: Uint8Array }>
type VerifiedBundle = Readonly<{ manifest: RuntimeManifest, assets: ReadonlyMap<string, VerifiedAsset>, transportAssets: readonly ComponentAsset[] }>
type LoadedRuntime = Readonly<{ verified: VerifiedBundle, server: ComponentAssetsServer }>
type PinnedFile = Readonly<{ path: string, bytes: number }>

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u
const SHA256 = /^[a-f0-9]{64}$/u

function fail(code: string, message?: string): never { throw new ComponentRuntimeHostError(code, message) }

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail(code)
}

function validUtf8(value: string): boolean {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value }
  catch { return false }
}

/** File names are a strict prefix-relative ASCII subset to eliminate aliases. */
function assetPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1_024) fail('COMPONENT_RUNTIME_ASSET_PATH_INVALID')
  if (!validUtf8(value)) fail('COMPONENT_RUNTIME_ASSET_PATH_UTF8_INVALID')
  if (value.startsWith('/') || value.includes('\\') || value.includes('\u0000') || value.includes('%') || value.includes('?') || value.includes('#')) fail('COMPONENT_RUNTIME_ASSET_PATH_INVALID')
  const segments = value.split('/')
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment))) fail('COMPONENT_RUNTIME_ASSET_PATH_INVALID')
  return value
}

function contentType(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 300 || /[^\x20-\x7e]/u.test(value)) fail('COMPONENT_RUNTIME_ASSET_CONTENT_TYPE_INVALID')
  return value
}

function sourceCommit(library: ComponentRuntimeLibrary, value: unknown): string {
  if (typeof value !== 'string' || value !== COMPONENT_RUNTIME_SOURCE_COMMITS[library]) fail('COMPONENT_RUNTIME_SOURCE_UNKNOWN')
  return value
}

function nonnegativeInteger(value: unknown, code: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) fail(code)
  return value as number
}

function parseManifest(raw: unknown, library: ComponentRuntimeLibrary): RuntimeManifest {
  if (!isRecord(raw)) fail('COMPONENT_RUNTIME_MANIFEST_INVALID')
  exactKeys(raw, ['formatVersion', 'library', 'sourceCommit', 'entry', 'assets'], 'COMPONENT_RUNTIME_MANIFEST_EXTRA_FIELD')
  if (raw.formatVersion !== 1) fail('COMPONENT_RUNTIME_MANIFEST_VERSION_UNSUPPORTED')
  if (raw.library !== library) fail('COMPONENT_RUNTIME_LIBRARY_MISMATCH')
  const commit = sourceCommit(library, raw.sourceCommit)
  const entry = assetPath(raw.entry)
  if (!Array.isArray(raw.assets) || !raw.assets.length || raw.assets.length > COMPONENT_RUNTIME_MAX_ASSETS) fail('COMPONENT_RUNTIME_ASSET_COUNT_INVALID')
  const paths = new Set<string>()
  let total = 0
  const assets = raw.assets.map((rawAsset): RuntimeManifestAsset => {
    if (!isRecord(rawAsset)) fail('COMPONENT_RUNTIME_ASSET_INVALID')
    exactKeys(rawAsset, ['path', 'contentType', 'sha256', 'bytes'], 'COMPONENT_RUNTIME_ASSET_EXTRA_FIELD')
    const path = assetPath(rawAsset.path)
    if (paths.has(path)) fail('COMPONENT_RUNTIME_ASSET_DUPLICATE')
    paths.add(path)
    const bytes = nonnegativeInteger(rawAsset.bytes, 'COMPONENT_RUNTIME_ASSET_BYTES_INVALID', COMPONENT_RUNTIME_MAX_ASSET_BYTES)
    total += bytes
    if (!Number.isSafeInteger(total) || total > COMPONENT_RUNTIME_MAX_ASSET_BYTES) fail('COMPONENT_RUNTIME_ASSET_TOTAL_EXCEEDED')
    if (typeof rawAsset.sha256 !== 'string' || !SHA256.test(rawAsset.sha256)) fail('COMPONENT_RUNTIME_ASSET_SHA256_INVALID')
    return Object.freeze({ path, contentType: contentType(rawAsset.contentType), sha256: rawAsset.sha256, bytes })
  })
  if (!paths.has(entry)) fail('COMPONENT_RUNTIME_ENTRY_UNKNOWN')
  return Object.freeze({ formatVersion: 1, library, sourceCommit: commit, entry, assets: Object.freeze(assets) })
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

function inside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate)
  return difference !== '' && difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

async function realPinnedFile(root: string, path: string, missingCode: string): Promise<PinnedFile> {
  const candidate = resolve(root, path)
  let physical: string
  try { physical = await realpath(candidate) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') fail(missingCode)
    fail('COMPONENT_RUNTIME_FILE_REALPATH_FAILED')
  }
  if (!inside(root, physical)) fail('COMPONENT_RUNTIME_SYMLINK_ESCAPE')
  let metadata
  try { metadata = await stat(physical) }
  catch { fail('COMPONENT_RUNTIME_FILE_STAT_FAILED') }
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size < 0) fail('COMPONENT_RUNTIME_FILE_NOT_REGULAR')
  return Object.freeze({ path: physical, bytes: metadata.size })
}

async function utf8Json(file: PinnedFile, maximum: number, invalidCode: string): Promise<unknown> {
  if (file.bytes > maximum) fail('COMPONENT_RUNTIME_MANIFEST_TOO_LARGE')
  let bytes: Uint8Array
  try { bytes = await readFile(file.path) }
  catch { fail('COMPONENT_RUNTIME_FILE_READ_FAILED') }
  if (bytes.byteLength > maximum) fail('COMPONENT_RUNTIME_MANIFEST_TOO_LARGE')
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { fail('COMPONENT_RUNTIME_JSON_UTF8_INVALID') }
  try { return JSON.parse(text) as unknown }
  catch { fail(invalidCode) }
}

/** Parse only a byte array already verified against the fixed asset manifest. */
function jsonAsset(bundle: VerifiedBundle, path: string, missingCode: string, contentTypeCode: string, invalidCode: string): unknown {
  const asset = bundle.assets.get(path)
  if (!asset) fail(missingCode)
  if (asset.body.byteLength > COMPONENT_RUNTIME_MAX_MANIFEST_BYTES) fail('COMPONENT_RUNTIME_MANIFEST_TOO_LARGE')
  if (!/^application\/json(?:\s*;|$)/iu.test(asset.contentType)) fail(contentTypeCode)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(asset.body) }
  catch { fail('COMPONENT_RUNTIME_JSON_UTF8_INVALID') }
  try { return JSON.parse(text) as unknown }
  catch { fail(invalidCode) }
}

async function rootRealPath(root: string): Promise<string> {
  if (typeof root !== 'string' || !root || !isAbsolute(root)) fail('COMPONENT_RUNTIME_ROOT_INVALID')
  try { return await realpath(root) }
  catch { fail('COMPONENT_RUNTIME_ROOT_UNAVAILABLE') }
}

/**
 * Loads only manifest-listed public compiled assets from a plugin-owned root.
 * There is deliberately no API accepting an asset path, URL, model output,
 * session value, credential or arbitrary source text.
 */
export class ComponentRuntimeHost {
  private readonly roots: Readonly<Record<ComponentRuntimeLibrary, string>>
  private readonly manifests = new Map<ComponentRuntimeLibrary, Promise<Readonly<{ root: string, manifest: RuntimeManifest }>>>()
  private readonly verifiedBundles = new Map<ComponentRuntimeLibrary, Promise<VerifiedBundle>>()
  private readonly runtimes = new Map<ComponentRuntimeLibrary, Promise<LoadedRuntime>>()
  private closing?: Promise<void>
  private closed = false

  constructor(options: ComponentRuntimeHostOptions) {
    if (!options || typeof options !== 'object' || !options.assetRoots || typeof options.assetRoots !== 'object') fail('COMPONENT_RUNTIME_ROOTS_INVALID')
    const rune = options.assetRoots.rune, tuffui = options.assetRoots.tuffui
    if (typeof rune !== 'string' || typeof tuffui !== 'string') fail('COMPONENT_RUNTIME_ROOTS_INVALID')
    this.roots = Object.freeze({ rune, tuffui })
  }

  async getInfo(library: ComponentRuntimeLibrary): Promise<ComponentRuntimeInfo> {
    this.assertOpen()
    if (library !== 'rune' && library !== 'tuffui') fail('COMPONENT_RUNTIME_LIBRARY_UNKNOWN')
    const loaded = await this.runtimeFor(library)
    if (this.closed) {
      await loaded.server.close()
      fail('COMPONENT_RUNTIME_CLOSED')
    }
    return Object.freeze({ protocolVersion: COMPONENT_RUNTIME_PROTOCOL_VERSION, library, frameUrl: loaded.server.frameUrl, sourceCommit: loaded.verified.manifest.sourceCommit })
  }

  /** Raw, fixed Tuff source-manifest JSON. Tuff's own catalog validator owns its schema. */
  async getCatalog(library: 'tuffui'): Promise<unknown> {
    this.assertOpen()
    if (library !== 'tuffui') fail('COMPONENT_RUNTIME_CATALOG_LIBRARY_INVALID')
    const verified = await this.verifiedFor(library)
    this.assertOpen()
    return jsonAsset(verified, 'source-manifest.json', 'COMPONENT_RUNTIME_CATALOG_NOT_ALLOWLISTED', 'COMPONENT_RUNTIME_CATALOG_CONTENT_TYPE_INVALID', 'COMPONENT_RUNTIME_CATALOG_JSON_INVALID')
  }

  /** Raw, fixed Tuff type-schema JSON. Tuff's nested schema validator owns its shape. */
  async getTypeSchemas(library: 'tuffui'): Promise<unknown> {
    this.assertOpen()
    if (library !== 'tuffui') fail('COMPONENT_RUNTIME_TYPE_SCHEMAS_LIBRARY_INVALID')
    const verified = await this.verifiedFor(library)
    this.assertOpen()
    return jsonAsset(verified, 'type-schema.json', 'COMPONENT_RUNTIME_TYPE_SCHEMAS_NOT_ALLOWLISTED', 'COMPONENT_RUNTIME_TYPE_SCHEMAS_CONTENT_TYPE_INVALID', 'COMPONENT_RUNTIME_TYPE_SCHEMAS_JSON_INVALID')
  }

  async close(): Promise<void> {
    if (this.closing) return await this.closing
    this.closed = true
    this.closing = (async () => {
      const loaded = await Promise.allSettled([...this.runtimes.values()])
      const closes = loaded.flatMap(item => item.status === 'fulfilled' ? [item.value.server.close()] : [])
      await Promise.all(closes)
    })()
    return await this.closing
  }

  private assertOpen(): void { if (this.closed) fail('COMPONENT_RUNTIME_CLOSED') }

  private async runtimeFor(library: ComponentRuntimeLibrary): Promise<LoadedRuntime> {
    let runtime = this.runtimes.get(library)
    if (!runtime) {
      runtime = this.startRuntime(library)
      this.runtimes.set(library, runtime)
      void runtime.catch(() => { if (this.runtimes.get(library) === runtime) this.runtimes.delete(library) })
    }
    return await runtime
  }

  private async startRuntime(library: ComponentRuntimeLibrary): Promise<LoadedRuntime> {
    const verified = await this.verifiedFor(library)
    let server: ComponentAssetsServer
    try { server = await startComponentAssetsServer({ assets: verified.transportAssets, entry: verified.manifest.entry, csp: COMPONENT_RUNTIME_CSPS[library] }) }
    catch (error) {
      if (error instanceof ComponentAssetsHostError) fail(`COMPONENT_RUNTIME_ASSET_HOST_${error.code}`)
      throw error
    }
    return Object.freeze({ verified, server })
  }

  private async verifiedFor(library: ComponentRuntimeLibrary): Promise<VerifiedBundle> {
    let pending = this.verifiedBundles.get(library)
    if (!pending) {
      pending = this.verifyBundle(library)
      this.verifiedBundles.set(library, pending)
      void pending.catch(() => { if (this.verifiedBundles.get(library) === pending) this.verifiedBundles.delete(library) })
    }
    return await pending
  }

  private async verifyBundle(library: ComponentRuntimeLibrary): Promise<VerifiedBundle> {
    const { root, manifest } = await this.manifestFor(library)
    const transportAssets: ComponentAsset[] = []
    const assets = new Map<string, VerifiedAsset>()
    for (const asset of manifest.assets) {
      const physical = await realPinnedFile(root, asset.path, 'COMPONENT_RUNTIME_ASSET_MISSING')
      if (physical.bytes !== asset.bytes) fail('COMPONENT_RUNTIME_ASSET_SIZE_MISMATCH')
      let body: Uint8Array
      try { body = await readFile(physical.path) }
      catch { fail('COMPONENT_RUNTIME_ASSET_READ_FAILED') }
      if (body.byteLength !== asset.bytes) fail('COMPONENT_RUNTIME_ASSET_SIZE_MISMATCH')
      if (digest(body) !== asset.sha256) fail('COMPONENT_RUNTIME_ASSET_HASH_MISMATCH')
      const verified = Object.freeze({ contentType: asset.contentType, body: new Uint8Array(body) })
      assets.set(asset.path, verified)
      transportAssets.push({ path: asset.path, contentType: asset.contentType, body: verified.body, sha256: asset.sha256 })
    }
    return Object.freeze({ manifest, assets, transportAssets: Object.freeze(transportAssets) })
  }

  private async manifestFor(library: ComponentRuntimeLibrary): Promise<Readonly<{ root: string, manifest: RuntimeManifest }>> {
    let pending = this.manifests.get(library)
    if (!pending) {
      pending = (async () => {
        const root = await rootRealPath(this.roots[library])
        const manifestPath = await realPinnedFile(root, 'manifest.json', 'COMPONENT_RUNTIME_MANIFEST_MISSING')
        const manifest = parseManifest(await utf8Json(manifestPath, COMPONENT_RUNTIME_MAX_MANIFEST_BYTES, 'COMPONENT_RUNTIME_MANIFEST_JSON_INVALID'), library)
        return Object.freeze({ root, manifest })
      })()
      this.manifests.set(library, pending)
      void pending.catch(() => { if (this.manifests.get(library) === pending) this.manifests.delete(library) })
    }
    return await pending
  }
}
