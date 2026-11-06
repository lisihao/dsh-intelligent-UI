import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { buildRunnerHtml, DIL_FRAME_CSP } from '@solar-ui/dil-reference/frame'

export interface DilFrameServer {
  readonly frameUrl: string
  close(): Promise<void>
}

/** Serve only the pinned runner document. Source, state and programs never enter HTTP. */
export async function startDilFrameServer(): Promise<DilFrameServer> {
  const path = `/solar-dil/${randomUUID()}/runner.html`
  const document = buildRunnerHtml()
  const server = createServer((request, response) => {
    const remote = request.socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      response.writeHead(403); response.end(); return
    }
    if (request.url !== path) { response.writeHead(404); response.end(); return }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': DIL_FRAME_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    response.end(request.method === 'HEAD' ? undefined : document)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close(); throw new Error('DIL_RUNNER_ADDRESS_UNAVAILABLE')
  }
  let closed = false
  return {
    frameUrl: `http://127.0.0.1:${address.port}${path}`,
    close: async () => {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
