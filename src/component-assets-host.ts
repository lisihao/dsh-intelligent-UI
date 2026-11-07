import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'

export interface ComponentAsset {
  /** A safe, prefix-relative static asset name such as `assets/app_bg.wasm`. */
  readonly path: string
  readonly contentType: string
  readonly body: Uint8Array | string
  /** Optional lowercase SHA-256 of the exact UTF-8 or byte body. */
  readonly sha256?: string
}

export interface ComponentAssetsServerOptions {
  readonly assets: readonly ComponentAsset[]
  /** The allowlisted HTML document that an iframe should load. */
  readonly entry: string
  /** A fixed caller-owned CSP. This API never accepts a runtime/model CSP. */
  readonly csp: string
}

export interface ComponentAssetsServer {
  readonly frameUrl: string
  readonly origin: string
  close(): Promise<void>
}

export class ComponentAssetsHostError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'ComponentAssetsHostError'
  }
}

type StoredAsset = Readonly<{ path: string, contentType: string, body: Uint8Array }>
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u

function fail(code: string, message?: string): never { throw new ComponentAssetsHostError(code, message) }

function hasValidUtf8(value: string): boolean {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value }
  catch { return false }
}

/**
 * Asset names are deliberately an ASCII subset of UTF-8. It prevents encoded
 * aliases, traversal, platform separators, and the need for filesystem path
 * resolution. The Host never opens a path from a request.
 */
function normalizeAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1_024) fail('COMPONENT_ASSETS_PATH_INVALID')
  if (!hasValidUtf8(value)) fail('COMPONENT_ASSETS_PATH_UTF8_INVALID')
  if (value.startsWith('/') || value.includes('\\') || value.includes('\u0000') || value.includes('%') || value.includes('?') || value.includes('#')) fail('COMPONENT_ASSETS_PATH_INVALID')
  const segments = value.split('/')
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment))) fail('COMPONENT_ASSETS_PATH_INVALID')
  return value
}

function normalizeContentType(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 300 || /[^\x20-\x7e]/u.test(value) || /[\r\n]/u.test(value)) fail('COMPONENT_ASSETS_CONTENT_TYPE_INVALID')
  return value
}

function normalizeCsp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 16_384 || /[^\x20-\x7e]/u.test(value)) fail('COMPONENT_ASSETS_CSP_INVALID')
  return value
}

function bytes(value: Uint8Array | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return new Uint8Array(value)
  return fail('COMPONENT_ASSETS_BODY_INVALID')
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }

function validateExpectedSha(value: unknown, actual: string): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('COMPONENT_ASSETS_SHA256_INVALID')
  if (value !== actual) fail('COMPONENT_ASSETS_BODY_INTEGRITY_MISMATCH')
}

function assetsFrom(options: ComponentAssetsServerOptions): ReadonlyMap<string, StoredAsset> {
  if (!options || typeof options !== 'object' || !Array.isArray(options.assets) || !options.assets.length) fail('COMPONENT_ASSETS_ASSET_SET_INVALID')
  const assets = new Map<string, StoredAsset>()
  for (const raw of options.assets) {
    if (!raw || typeof raw !== 'object') fail('COMPONENT_ASSETS_ASSET_INVALID')
    const path = normalizeAssetPath(raw.path)
    if (assets.has(path)) fail('COMPONENT_ASSETS_DUPLICATE_PATH')
    const contentType = normalizeContentType(raw.contentType)
    const body = bytes(raw.body)
    validateExpectedSha(raw.sha256, sha256(body))
    assets.set(path, Object.freeze({ path, contentType, body }))
  }
  const entry = normalizeAssetPath(options.entry)
  const entryAsset = assets.get(entry)
  if (!entryAsset) fail('COMPONENT_ASSETS_ENTRY_UNKNOWN')
  if (!/^text\/html(?:\s*;|$)/iu.test(entryAsset.contentType)) fail('COMPONENT_ASSETS_ENTRY_NOT_DOCUMENT')
  return assets
}

function loopback(remote: string | undefined): boolean {
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function reply(response: import('node:http').ServerResponse, status: number, asset: StoredAsset | undefined, csp: string, head: boolean): void {
  if (!asset) { response.writeHead(status, { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', Connection: 'close' }); response.end(); return }
  response.writeHead(status, {
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.body.byteLength),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  })
  response.end(head ? undefined : asset.body)
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => { server.off('error', onError); resolve() })
  })
}

/**
 * A loopback-only, memory-only static asset Host for a fixed component bundle.
 * It has no filesystem path handling, proxying, POST route, or user/model
 * content input. Its random prefix is an unguessable capability boundary for
 * unrelated local pages sharing the loopback origin space.
 */
export async function startComponentAssetsServer(options: ComponentAssetsServerOptions): Promise<ComponentAssetsServer> {
  const assets = assetsFrom(options)
  const entry = normalizeAssetPath(options.entry)
  const csp = normalizeCsp(options.csp)
  const prefix = `/component-assets/${randomBytes(24).toString('base64url')}`
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    if (!loopback(request.socket.remoteAddress)) { reply(response, 403, undefined, csp, false); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', Connection: 'close' })
      response.end()
      return
    }
    const requestUrl = request.url ?? ''
    const marker = `${prefix}/`
    if (!requestUrl.startsWith(marker) || requestUrl.includes('#')) { reply(response, 404, undefined, csp, request.method === 'HEAD'); return }
    const queryAt = requestUrl.indexOf('?')
    const pathname = queryAt < 0 ? requestUrl : requestUrl.slice(0, queryAt)
    if (queryAt >= 0) {
      // An opaque component frame needs the exact parent origin for its
      // bootstrap check. This one entry-document parameter cannot select a
      // file, alter bytes, or enable a resource/proxy route.
      let valid = false
      try {
        const query = new URLSearchParams(requestUrl.slice(queryAt + 1))
        const parentOrigin = query.get('parentOrigin')
        if (pathname === `${marker}${entry}` && query.size === 1 && parentOrigin && parentOrigin.length <= 2048) {
          const parent = new URL(parentOrigin)
          valid = (parent.protocol === 'http:' || parent.protocol === 'https:') && parentOrigin === parent.origin
        }
      } catch { /* Unknown/malformed parameters keep the fixed 404 response. */ }
      if (!valid) { reply(response, 404, undefined, csp, request.method === 'HEAD'); return }
    }
    const requestedPath = pathname.slice(marker.length)
    const asset = assets.get(requestedPath)
    if (!asset) { reply(response, 404, undefined, csp, request.method === 'HEAD'); return }
    reply(response, 200, asset, csp, request.method === 'HEAD')
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('clientError', (error, socket) => {
    // A malformed/non-UTF-8 request is not routed to an asset and exposes no
    // server diagnostics to the client.
    void error
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })
  try { await listen(server) }
  catch (error) {
    server.close()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    fail('COMPONENT_ASSETS_ADDRESS_UNAVAILABLE')
  }
  const origin = `http://127.0.0.1:${String(address.port)}`
  let closePromise: Promise<void> | undefined
  return Object.freeze({
    origin,
    frameUrl: `${origin}${prefix}/${entry}`,
    close: () => {
      if (closePromise) return closePromise
      closePromise = new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.closeAllConnections()
        server.close(error => error ? reject(error) : resolve())
      })
      return closePromise
    },
  })
}
