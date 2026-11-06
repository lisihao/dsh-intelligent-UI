import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(process.env.CANVAS_EXTENDED_FIXTURE_DIR ?? '/private/tmp/iexp-canvas-extended-20261106')
if (!output.startsWith('/private/tmp/iexp-canvas-extended-')) throw new Error('CANVAS_EXTENDED_FIXTURE_OUTPUT')
const port = Number(process.env.CANVAS_EXTENDED_FIXTURE_PORT ?? 8920)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('CANVAS_EXTENDED_FIXTURE_PORT')
const revision = 'a04a99b235299ee79a123a16ccb2e6cf9da74b6b'
const effects = new Set(['ascii-sweep', 'bubble', 'cloth', 'droplets', 'flame-wrap', 'force-field', 'glass', 'glyph-rain', 'laser', 'liquid', 'peel', 'retro-dither', 'ripple', 'dithered-object', 'particle-object', 'liquid-object'])
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self' blob:; worker-src blob:; frame-src 'self'; object-src 'none'; base-uri 'none'"
const productionObjectPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

export async function startCanvasExtendedFixture() {
  const frame = await import(pathToFileURL(join(output, 'liquid-frame.mjs')).href)
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let file
    let type = 'text/javascript; charset=utf-8'
    if (url.pathname === '/') { file = join(root, 'tools/browser-canvas-extended/index.html'); type = 'text/html; charset=utf-8' }
    else if (url.pathname === '/component-view') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/component-view.js"></script>')
      return
    }
    else if (url.pathname === '/fixture-assets/production-object.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; object-src 'none'; base-uri 'none'", 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : productionObjectPng)
      return
    }
    else if (url.pathname === '/texture-debug') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><meta charset="utf-8"><script type="module" src="/texture-debug.js"></script>')
      return
    }
    else if (url.pathname === '/fixture.js') file = join(output, 'fixture.js')
    else if (url.pathname === '/component-view.js') file = join(output, 'component-view.js')
    else if (url.pathname === '/texture-debug.js') file = join(output, 'texture-debug.js')
    else if (url.pathname.startsWith('/effects/')) {
      const slug = /^\/effects\/([a-z-]+)\.mjs$/u.exec(url.pathname)?.[1]
      if (!slug || !effects.has(slug)) { response.writeHead(404); response.end(); return }
      file = join(output, 'effects', `${slug}.mjs`)
    } else if (url.pathname === '/api/intelligent-ui-canvas-effect') {
      const slug = url.searchParams.get('slug')
      if (!slug || !effects.has(slug) || url.searchParams.size !== 3 || url.searchParams.get('revision') !== revision || !/^\d+$/u.test(url.searchParams.get('attempt') ?? '')) { response.writeHead(400); response.end(); return }
      file = join(output, 'effects', `${slug}.mjs`)
    } else if (url.pathname === '/api/intelligent-ui-canvas-liquid-frame') {
      const nonce = url.searchParams.get('nonce')
      if (!nonce || url.searchParams.size !== 1 || !/^[0-9a-f]{32}$/u.test(nonce)) { response.writeHead(400); response.end(); return }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : frame.canvasExtendedLiquidFrameDocument(nonce))
      return
    } else { response.writeHead(404); response.end(); return }
    try {
      const bytes = await readFile(file)
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch { response.writeHead(503); response.end('Canvas fixture has not been built.') }
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${String(port)}` })))
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  const preview = await startCanvasExtendedFixture()
  process.stdout.write(`Canvas extended fixture: ${preview.origin}\n`)
}
