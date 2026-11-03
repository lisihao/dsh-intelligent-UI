import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outputRoot = resolve(process.env.ASCII_GPU_FIXTURE_DIR ?? '/private/tmp/iexp-ascii-gpu-fixture-20261102')
if (!outputRoot.startsWith('/private/tmp/iexp-ascii-gpu-')) throw new Error('Fixture output must remain in a dedicated private temporary directory.')
const port = Number(process.env.ASCII_GPU_FIXTURE_PORT ?? 8919)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local fixture port.')
const files = new Map([
  ['/', [resolve(root, 'tools/browser-ascii-gpu/index.html'), 'text/html; charset=utf-8']],
  ['/fixture.js', [resolve(outputRoot, 'fixture.js'), 'text/javascript; charset=utf-8']],
])
const effects = new Set(['asciify', 'ascii-object', 'ink-object'])
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self' blob:; worker-src blob:; object-src 'none'; base-uri 'none'"
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  let entry = files.get(url.pathname)
  if (url.pathname === '/api/intelligent-ui-canvas-effect') {
    const slug = url.searchParams.get('slug')
    if (!slug || !effects.has(slug) || url.searchParams.size !== 3 || url.searchParams.get('revision') !== 'a04a99b235299ee79a123a16ccb2e6cf9da74b6b' || !/^\d+$/.test(url.searchParams.get('attempt') ?? '')) {
      response.writeHead(400); response.end(); return
    }
    entry = [resolve(outputRoot, `${slug}.mjs`), 'text/javascript; charset=utf-8']
  }
  if (!entry) { response.writeHead(404); response.end(); return }
  try {
    const data = await readFile(entry[0])
    response.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : data)
  } catch { response.writeHead(503); response.end('Fixture has not been built or is unavailable.') }
})
server.listen(port, '127.0.0.1', () => console.log(`Local ASCII GPU fixture: http://127.0.0.1:${port}/`))
