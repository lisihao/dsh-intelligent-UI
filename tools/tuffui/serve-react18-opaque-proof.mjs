#!/usr/bin/env node
/** Start a private React18 parent plus the real ComponentRuntimeHost realm. */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const repo = option('--repo') && resolve(option('--repo'))
const parent = option('--parent') && resolve(option('--parent'))
const assets = option('--assets') && resolve(option('--assets'))
const portValue = option('--port') ?? '4175'
const port = Number(portValue)
const allowed = new Set(['--repo', repo, '--parent', parent, '--assets', assets, '--port', portValue])

function fail(code) { throw new Error(code) }

function entrySource({ parent, assets, port, hostSource }) {
  return `import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComponentRuntimeHost } from ${JSON.stringify(hostSource)}

const parent = ${JSON.stringify(parent)}
const assets = ${JSON.stringify(assets)}
const port = ${JSON.stringify(port)}
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/parent.js', ['parent.js', 'text/javascript; charset=utf-8']],
  ['/runtime.json', ['runtime.json', 'application/json; charset=utf-8']],
])
const parentCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'"
const runtime = new ComponentRuntimeHost({ assetRoots: { rune: join(assets, 'rune'), tuffui: join(assets, 'tuffui') } })
const info = await runtime.getInfo('tuffui')
const realm = await fetch(info.frameUrl)
const headers = Object.freeze({ csp: realm.headers.get('content-security-policy'), cors: realm.headers.get('access-control-allow-origin'), corp: realm.headers.get('cross-origin-resource-policy') })
if (realm.status !== 200 || !headers.csp || headers.cors !== '*' || headers.corp !== 'cross-origin') throw new Error('TUFFUI_OPAQUE_PROOF_RUNTIME_HEADERS_INVALID')
await writeFile(join(parent, 'runtime.json'), JSON.stringify(info) + '\\n')
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const item = publicFiles.get(pathname)
  if (!item || (request.method !== 'GET' && request.method !== 'HEAD')) { response.writeHead(item ? 405 : 404, { 'Content-Security-Policy': parentCsp, 'Cache-Control': 'no-store', Connection: 'close' }); response.end(); return }
  try {
    const body = await readFile(join(parent, item[0]))
    response.writeHead(200, { 'Content-Type': item[1], 'Content-Length': String(body.byteLength), 'Content-Security-Policy': parentCsp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Connection: 'close' })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch { response.writeHead(500, { 'Content-Security-Policy': parentCsp, 'Cache-Control': 'no-store', Connection: 'close' }); response.end() }
})
const close = async () => { await new Promise(done => server.close(done)); await runtime.close() }
process.once('SIGINT', () => { void close().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)) })
await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); done() }) })
process.stdout.write(JSON.stringify({ parentOrigin: 'http://127.0.0.1:' + String(port), frameUrl: info.frameUrl, sourceCommit: info.sourceCommit, headers }) + '\\n')
`
}

export async function buildReact18OpaqueProofServer(options) {
  if (!options || !options.repo || !options.parent || !options.assets || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) fail('TUFFUI_OPAQUE_PROOF_ARGUMENTS')
  await mkdir(options.parent, { recursive: true })
  const source = join(options.parent, 'component-runtime-server-entry.ts')
  const output = join(options.parent, 'component-runtime-server.mjs')
  await writeFile(source, entrySource({ parent: options.parent, assets: options.assets, port: options.port, hostSource: join(options.repo, 'src/component-runtime-host.ts') }))
  await build({ absWorkingDir: options.repo, nodePaths: [join(options.repo, 'node_modules')], entryPoints: [source], outfile: output, bundle: true, platform: 'node', target: 'node22', format: 'esm', logLevel: 'silent' })
  return Object.freeze({ output })
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!repo || !parent || !assets || !Number.isInteger(port) || port < 1 || port > 65535 || args.some(value => !allowed.has(value))) fail('TUFFUI_OPAQUE_PROOF_ARGUMENTS')
  const built = await buildReact18OpaqueProofServer({ repo, parent, assets, port })
  await import(`${pathToFileURL(built.output).href}?run=${String(Date.now())}`)
}
