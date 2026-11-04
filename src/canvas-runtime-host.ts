import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANVAS_UI_COMMIT } from './canvas-catalog.js'
import { CANVAS_UI_LICENSE_TEXT } from './canvas-license.js'
import { CANVAS_SOURCE_MANIFEST, canvasSourceEntry } from './canvas-source-manifest.js'
import { THREE_LICENSE_TEXT } from './three-license.js'

export const CANVAS_RUNTIME_PATH = '/api/intelligent-ui-canvas-effect'
export const CANVAS_RUNTIME_REVISION = CANVAS_UI_COMMIT
const SOURCE_ORIGIN = `https://raw.githubusercontent.com/DavidHDev/canvas-ui/${CANVAS_UI_COMMIT}/`
const MAX_SOURCE_BYTES = 256 * 1024
const MAX_MODULE_BYTES = 8 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15_000
const WORKER_STOP_GRACE_MS = 2_000
const MAX_CONCURRENT_BUILDS = 2

class CanvasRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'CanvasRuntimeError'
  }
}

export interface CanvasRuntimeHostOptions {
  /** A test seam. Production always fetches the fixed official source URL. */
  fetchSource?: (url: string, signal: AbortSignal) => Promise<Response>
  /** A test seam. Production builds the verified source with esbuild-wasm. */
  buildModule?: (entry: string, loadSource: (path: string) => Promise<string>, signal: AbortSignal) => Promise<string>
}

function stopped(): CanvasRuntimeError {
  return new CanvasRuntimeError('CANVAS_RUNTIME_STOPPED', 'Canvas UI 插件已停用。', 503)
}

/** Check exact upstream file length and hash before any source reaches the compiler. */
export function verifyCanvasSource(path: string, bytes: Uint8Array): string {
  const expected = CANVAS_SOURCE_MANIFEST[path]
  if (!Object.hasOwn(CANVAS_SOURCE_MANIFEST, path) || !expected) {
    throw new CanvasRuntimeError('CANVAS_SOURCE_NOT_ALLOWED', 'Canvas UI 源文件不在固定清单中。', 400)
  }
  if (bytes.byteLength !== expected.size || bytes.byteLength > MAX_SOURCE_BYTES || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
    throw new CanvasRuntimeError('CANVAS_SOURCE_INTEGRITY', `Canvas UI 源文件校验失败：${path}。`, 502)
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new CanvasRuntimeError('CANVAS_SOURCE_ENCODING', `Canvas UI 源文件编码无效：${path}。`, 502) }
}

async function readBounded(response: Response, expectedSize: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && Number(length) > Math.min(MAX_SOURCE_BYTES, expectedSize)) {
    await response.body?.cancel()
    throw new CanvasRuntimeError('CANVAS_SOURCE_INTEGRITY', 'Canvas UI 源文件大小与固定清单不符。', 502)
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > Math.min(MAX_SOURCE_BYTES, expectedSize)) {
        await reader.cancel()
        throw new CanvasRuntimeError('CANVAS_SOURCE_INTEGRITY', 'Canvas UI 源文件大小与固定清单不符。', 502)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

/** Resolve only pinned upstream imports; the installed three package owns its own imports. */
async function compileCanvasModule(entry: string, loadSource: (path: string) => Promise<string>, signal: AbortSignal): Promise<string> {
  const dependencyRoot = dirname(fileURLToPath(import.meta.url))
  const workerFile = import.meta.url.endsWith('.ts') ? './canvas-build-worker.ts' : './canvas-build-worker.js'
  const banner = `/*!\n${`${CANVAS_UI_LICENSE_TEXT}\n\n${THREE_LICENSE_TEXT}`.replaceAll('*/', '* /')}\n*/`
  const wrapperDir = await mkdtemp(join(tmpdir(), 'intelligent-ui-canvas-node-'))
  try {
    // esbuild-wasm launches "node" by name. Use this Host's own executable
    // without modifying the Host's PATH or depending on a system Node install.
    await writeFile(join(wrapperDir, 'node'), '#!/bin/sh\nexec "$INTELLIGENT_UI_NODE_EXECUTABLE" "$@"\n', { mode: 0o700 })
    if (signal.aborted) throw stopped()
    return await new Promise((resolve, reject) => {
      const worker = fork(new URL(workerFile, import.meta.url), [], {
        execPath: process.execPath,
        execArgv: [],
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, PATH: `${wrapperDir}${delimiter}${process.env.PATH ?? ''}`, INTELLIGENT_UI_NODE_EXECUTABLE: process.execPath, ELECTRON_RUN_AS_NODE: '1' },
      })
      let result: { output?: string, error?: { code: string, message: string, status: number } } | undefined
      let workerError: Error | undefined
      let exited = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const reply = (message: object) => { if (!exited && worker.connected) { try { worker.send(message, () => undefined) } catch { /* Process already exited. */ } } }
      const cancel = () => {
        reply({ type: 'cancel' })
        timer ??= setTimeout(() => {
          // The helper owns a new process group, including esbuild's child.
          // Killing just the helper can orphan a still-running compiler.
          try { if (worker.pid) process.kill(-worker.pid, 'SIGKILL'); else worker.kill('SIGKILL') }
          catch { worker.kill('SIGKILL') }
        }, WORKER_STOP_GRACE_MS)
        timer.unref?.()
      }
      signal.addEventListener('abort', cancel, { once: true })
      reply({ type: 'start', input: { entry, dependencyRoot, banner } })
      if (signal.aborted) cancel()
      worker.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return
        const value = message as Record<string, unknown>
        if (value.type === 'source-request' && Number.isSafeInteger(value.id) && typeof value.path === 'string') {
          const id = value.id
          void loadSource(value.path).then(
            source => reply({ type: 'source-result', id, source }),
            error => {
              const failure = error instanceof CanvasRuntimeError ? error : new CanvasRuntimeError('CANVAS_RUNTIME_FAILED', 'Canvas UI 源文件暂时不可用。', 503)
              reply({ type: 'source-result', id, error: { code: failure.code, message: failure.message, status: failure.status } })
            },
          )
        } else if (value.type === 'result') {
          result = value as typeof result
        }
      })
      worker.on('error', error => { workerError = error })
      worker.on('close', code => {
        exited = true
        signal.removeEventListener('abort', cancel)
        if (timer) clearTimeout(timer)
        if (signal.aborted) { reject(stopped()); return }
        if (code !== 0 || workerError || !result) { reject(new Error('CANVAS_BUILD_WORKER_FAILED')); return }
        if (result.error) {
          const { code: errorCode, message, status } = result.error
          reject(new CanvasRuntimeError(errorCode, message, status))
        } else if (typeof result.output === 'string') resolve(result.output)
        else reject(new Error('CANVAS_BUILD_WORKER_NO_OUTPUT'))
      })
    })
  } finally {
    await rm(wrapperDir, { recursive: true, force: true })
  }
}

/**
 * Register a plugin-owned, authenticated ESM endpoint. Source and output live
 * only in memory, and neither user content nor request-supplied URLs are code.
 */
export function installCanvasRuntimeHost(ctx: Context, options: CanvasRuntimeHostOptions = {}): () => Promise<void> {
  const lifetime = new AbortController()
  const sourceCache = new Map<string, Promise<string>>()
  const moduleCache = new Map<string, Promise<string>>()
  const fetchSource = options.fetchSource ?? ((url: string, signal: AbortSignal) => fetch(url, { signal, redirect: 'error' }))
  const buildModule = options.buildModule ?? compileCanvasModule
  let retired = false
  let retirement: Promise<void> | undefined
  let activeBuilds = 0
  const waitingBuilds: Array<{ start: () => void, cancel: () => void }> = []

  function acquireBuildSlot(): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const start = () => {
        if (retired) { reject(stopped()); return }
        activeBuilds++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          activeBuilds--
          if (!retired) waitingBuilds.shift()?.start()
        })
      }
      if (retired) reject(stopped())
      else if (activeBuilds < MAX_CONCURRENT_BUILDS) start()
      else waitingBuilds.push({ start, cancel: () => reject(stopped()) })
    })
  }

  function retire(): Promise<void> {
    if (retirement) return retirement
    retired = true
    const pending = [...sourceCache.values(), ...moduleCache.values()]
    for (const waiting of waitingBuilds.splice(0)) waiting.cancel()
    lifetime.abort()
    sourceCache.clear()
    moduleCache.clear()
    retirement = Promise.allSettled(pending).then(() => undefined)
    return retirement
  }

  function loadSource(path: string): Promise<string> {
    if (retired) return Promise.reject(stopped())
    const metadata = Object.hasOwn(CANVAS_SOURCE_MANIFEST, path) ? CANVAS_SOURCE_MANIFEST[path] : undefined
    if (!metadata) return Promise.reject(new CanvasRuntimeError('CANVAS_SOURCE_NOT_ALLOWED', 'Canvas UI 源文件不在固定清单中。', 400))
    const existing = sourceCache.get(path)
    if (existing) return existing
    const pending = (async () => {
      let response: Response
      try {
        response = await fetchSource(`${SOURCE_ORIGIN}${path}`, AbortSignal.any([lifetime.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]))
      } catch {
        if (retired) throw stopped()
        throw new CanvasRuntimeError('CANVAS_SOURCE_UNAVAILABLE', `无法下载 Canvas UI 源文件：${path}。请检查网络后重试。`, 503)
      }
      if (!response.ok) throw new CanvasRuntimeError('CANVAS_SOURCE_HTTP', `Canvas UI 源文件下载失败（HTTP ${response.status}）：${path}。`, 503)
      let bytes: Uint8Array
      try { bytes = await readBounded(response, metadata.size) }
      catch (error) {
        if (retired) throw stopped()
        if (error instanceof CanvasRuntimeError) throw error
        throw new CanvasRuntimeError('CANVAS_SOURCE_UNAVAILABLE', `读取 Canvas UI 源文件失败：${path}。请检查网络后重试。`, 503)
      }
      if (retired) throw stopped()
      return verifyCanvasSource(path, bytes)
    })()
    sourceCache.set(path, pending)
    void pending.catch(() => { if (sourceCache.get(path) === pending) sourceCache.delete(path) })
    return pending
  }

  function getModule(slug: string, entry: string): Promise<string> {
    if (retired) return Promise.reject(stopped())
    const existing = moduleCache.get(slug)
    if (existing) return existing
    const pending = (async () => {
      let release: (() => void) | undefined
      try {
        release = await acquireBuildSlot()
        if (retired) throw stopped()
        const result = await buildModule(entry, loadSource, lifetime.signal)
        if (retired) throw stopped()
        if (!result || Buffer.byteLength(result, 'utf8') > MAX_MODULE_BYTES) {
          throw new CanvasRuntimeError('CANVAS_BUILD_SIZE', 'Canvas UI 构建结果为空或超过大小限制。', 502)
        }
        return result
      } catch (error) {
        if (retired) throw stopped()
        if (error instanceof CanvasRuntimeError) throw error
        throw new CanvasRuntimeError('CANVAS_BUILD_FAILED', `Canvas UI 组件构建失败：${slug}。请检查本地构建依赖后重试。`, 502)
      } finally { release?.() }
    })()
    moduleCache.set(slug, pending)
    void pending.catch(() => { if (moduleCache.get(slug) === pending) moduleCache.delete(slug) })
    return pending
  }

  const unregister = ctx.connection.fetch.register({
    path: CANVAS_RUNTIME_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      try {
        if (retired) throw stopped()
        const params = new URL(request.url).searchParams
        const keys = [...params.keys()]
        const slug = params.get('slug')
        const revision = params.get('revision')
        const attempt = params.get('attempt')
        if (keys.some(key => !['slug', 'revision', 'attempt'].includes(key)) || keys.length !== new Set(keys).size || !slug || revision !== CANVAS_RUNTIME_REVISION || (attempt !== null && !/^\d{1,6}$/.test(attempt))) {
          throw new CanvasRuntimeError('CANVAS_RUNTIME_REQUEST', 'Canvas UI 组件请求参数无效。', 400)
        }
        const entry = canvasSourceEntry(slug)
        if (!entry) throw new CanvasRuntimeError('CANVAS_RUNTIME_COMPONENT', 'Canvas UI 组件不在固定清单中。', 400)
        const output = await getModule(slug, entry)
        if (retired) throw stopped()
        return new Response(output, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
      } catch (error) {
        const failure = error instanceof CanvasRuntimeError ? error : new CanvasRuntimeError('CANVAS_RUNTIME_FAILED', 'Canvas UI 组件暂时不可用，请重试。', 503)
        return Response.json({ code: failure.code, message: failure.message }, { status: failure.status, headers: { 'cache-control': 'no-store' } })
      }
    },
  })
  ctx.effect(() => retire)
  return async () => { const done = retire(); await unregister(); await done }
}
