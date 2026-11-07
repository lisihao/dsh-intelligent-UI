import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { relative, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { openuiCssPlugin } from '../../build-css.mjs'
import { dilReferencePlugin } from '../dil-reference.mjs'
import { parseDilDocumentReviewManifest } from './manifest.mjs'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const acceptanceDirectory = resolve(projectRoot, '.acceptance/dil-document-review')

export const DIL_DOCUMENT_REVIEW_PARENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src http://127.0.0.1:*',
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

function parseArgs(argv) {
  const values = { rootDir: process.cwd(), manifest: process.env.DIL_DOCUMENT_REVIEW_MANIFEST, port: 0 }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--rootDir' && value) { values.rootDir = value; index += 1; continue }
    if (key === '--manifest' && value) { values.manifest = value; index += 1; continue }
    if (key === '--port' && value) { values.port = Number.parseInt(value, 10); index += 1; continue }
    if (key === '--help') {
      process.stdout.write('Usage: node tools/dil-document-review/preview.mjs [--rootDir <directory>] [--manifest <relative-json>] [--port <port>]\n')
      process.exit(0)
    }
    throw new Error(`DIL_DOCUMENT_REVIEW_ARGUMENT_INVALID:${String(key)}`)
  }
  if (!Number.isInteger(values.port) || values.port < 0 || values.port > 65_535) throw new Error('DIL_DOCUMENT_REVIEW_PORT_INVALID')
  return { rootDir: resolve(values.rootDir), manifest: values.manifest, port: values.port }
}

function pathInside(rootDir, candidate) {
  const relation = relative(rootDir, candidate)
  return relation === '' || (!relation.startsWith('..') && !relation.includes('../'))
}

async function reviewConfig(rootDir, manifestArgument) {
  if (!manifestArgument) return { state: 'pending', message: '尚未提供私有结果 manifest。审阅器没有调用模型。' }
  const manifestPath = resolve(rootDir, manifestArgument)
  if (!pathInside(rootDir, manifestPath)) return { state: 'failed', message: 'manifest 必须位于 --rootDir 之内。' }
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const manifest = parseDilDocumentReviewManifest(JSON.parse(raw))
    return { state: 'ready', manifest, manifestPath }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
    if (code === 'ENOENT') return { state: 'pending', message: '指定 manifest 尚未生成。审阅器保持等待，未调用模型。' }
    return { state: 'failed', message: `无法读取本地 manifest：${error instanceof Error ? error.message : String(error)}` }
  }
}

async function buildHostRuntime(runtimeDirectory) {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: { host: 'tools/dil-document-review/host-entry.ts' },
    outdir: runtimeDirectory,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    plugins: [dilReferencePlugin()],
  })
  return import(pathToFileURL(join(runtimeDirectory, 'host.js')).href)
}

async function buildBrowserFixture(runtimeDirectory) {
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: ['tools/dil-document-review/fixture.ts'],
    outfile: join(runtimeDirectory, 'fixture.js'),
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    loader: { '.css': 'text', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [openuiCssPlugin, dilReferencePlugin()],
  })
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
  if (!script) throw new Error('DIL_DOCUMENT_REVIEW_BROWSER_BUNDLE_MISSING')
  return script
}

function html() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DIL document review</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
}

function headers(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, private',
    'Content-Security-Policy': DIL_DOCUMENT_REVIEW_PARENT_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
}

/** Start a loopback-only, read-only review server. It never compiles or calls a model. */
export async function startDilDocumentReview(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd())
  const manifestArgument = options.manifest ?? process.env.DIL_DOCUMENT_REVIEW_MANIFEST
  const port = options.port ?? 0
  await mkdir(acceptanceDirectory, { recursive: true })
  const runtimeDirectory = await mkdtemp(join(acceptanceDirectory, 'runtime-'))
  let frameServer
  let server
  try {
    const host = await buildHostRuntime(runtimeDirectory)
    frameServer = await host.startDilFrameServer()
    const browserScript = await buildBrowserFixture(runtimeDirectory)
    const loaded = await reviewConfig(rootDir, manifestArgument)
    const config = loaded.state === 'ready'
      ? { state: 'ready', frameUrl: frameServer.frameUrl, manifest: loaded.manifest }
      : loaded
    const evidence = { modelCalls: 0, requestCounts: Object.create(null) }
    server = createServer(async (request, response) => {
      const remote = request.socket.remoteAddress
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') { response.writeHead(403); response.end(); return }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      evidence.requestCounts[path] = (evidence.requestCounts[path] ?? 0) + 1
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return }
      if (path === '/' || path === '/index.html') { response.writeHead(200, headers('text/html; charset=utf-8')); response.end(html()); return }
      if (path === '/fixture.js') { response.writeHead(200, headers('text/javascript; charset=utf-8')); response.end(browserScript); return }
      if (path === '/api/review') {
        // Read and validate on every request. The model runner writes the
        // private manifest incrementally; a long-lived preview must not freeze
        // the first pending snapshot and later present it as current.
        const current = await reviewConfig(rootDir, manifestArgument)
        const currentConfig = current.state === 'ready'
          ? { state: 'ready', frameUrl: frameServer.frameUrl, manifest: current.manifest }
          : current
        response.writeHead(200, headers('application/json; charset=utf-8'))
        response.end(JSON.stringify(currentConfig))
        return
      }
      if (path === '/api/evidence') { response.writeHead(200, headers('application/json; charset=utf-8')); response.end(JSON.stringify(evidence)); return }
      response.writeHead(404, { 'Content-Security-Policy': DIL_DOCUMENT_REVIEW_PARENT_CSP }); response.end()
    })
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(port, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('DIL_DOCUMENT_REVIEW_ADDRESS_UNAVAILABLE')
    let closed = false
    return {
      origin: `http://127.0.0.1:${String(address.port)}`,
      state: config.state,
      parentCsp: DIL_DOCUMENT_REVIEW_PARENT_CSP,
      async close() {
        if (closed) return
        closed = true
        server.closeAllConnections?.()
        await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
        await frameServer.close()
        await rm(runtimeDirectory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (server) server.closeAllConnections?.()
    if (server) await new Promise(resolveClose => server.close(() => resolveClose()))
    if (frameServer) await frameServer.close().catch(() => undefined)
    await rm(runtimeDirectory, { recursive: true, force: true })
    throw error
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2))
  const review = await startDilDocumentReview(options)
  process.stdout.write(`DIL_DOCUMENT_REVIEW_URL=${review.origin}\n`)
  process.stdout.write(`DIL_DOCUMENT_REVIEW_STATE=${review.state}\n`)
  const stop = async () => { await review.close(); process.exit(0) }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
}
