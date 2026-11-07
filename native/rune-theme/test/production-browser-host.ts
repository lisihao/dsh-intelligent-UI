import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ComponentRuntimeHost, COMPONENT_RUNTIME_CSPS } from '../../../src/component-runtime-host.js'

const root = resolve(process.argv[2] ?? '')
const appPath = resolve(process.argv[3] ?? '')
if (!root || !appPath || !root.endsWith('adaptive-composition-design')) throw new Error('RUNE_PRODUCTION_BROWSER_ARGUMENTS')
const assets = new ComponentRuntimeHost({
  assetRoots: {
    rune: resolve(root, 'resources/components/rune'),
    tuffui: resolve(root, 'resources/components/tuffui'),
  },
})
const info = await assets.getInfo('rune')
const app = Buffer.concat([Buffer.from(`window.__runeProductionRuntimeInfo=${JSON.stringify(info)};\n`, 'utf8'), await readFile(appPath)])
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;max-width:100%;overflow-x:clip;background:#101116;color:#ededef;font:16px/1.5 system-ui,sans-serif}
#app{width:min(100% - 32px,880px);margin:24px auto;min-width:0}
#proof-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-block-end:16px}
#proof-controls button{min-height:38px;padding:6px 12px;border:1px solid #989fb6;border-radius:10px;background:#21242f;color:#ededef}
button:focus-visible,input:focus-visible{outline:2px solid #d7e5ff;outline-offset:3px}
h1{font-size:clamp(24px,4vw,40px);line-height:1.08;margin:0}h2{font-size:20px;margin:0 0 8px}p{max-width:68ch}
</style><main id="app"></main><script type="module" src="/app.js"></script></html>`
const parentCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src http://127.0.0.1:*; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
  if (url.pathname === '/app.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': parentCsp, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : app)
    return
  }
  if (url.pathname !== '/') { response.writeHead(404, { 'content-security-policy': parentCsp }); response.end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': parentCsp, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(request.method === 'HEAD' ? undefined : html)
})
await new Promise<void>((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', () => resolveListen()) })
const address = server.address()
if (!address || typeof address === 'string') throw new Error('RUNE_PRODUCTION_BROWSER_LISTEN_FAILED')
const origin = `http://127.0.0.1:${String(address.port)}`
process.stdout.write(`${JSON.stringify({ origin, frameUrl: info.frameUrl, frameCsp: COMPONENT_RUNTIME_CSPS.rune })}\n`)
const stop = async () => { await assets.close(); await new Promise<void>(resolveClose => server.close(() => resolveClose())) }
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)) })
process.once('SIGINT', () => { void stop().then(() => process.exit(0)) })
