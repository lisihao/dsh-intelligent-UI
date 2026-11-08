import { request as nodeRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ComponentAssetsHostError,
  startComponentAssetsServer,
} from '../src/component-assets-host.js'

function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }

async function rawRequest(origin: string, path: string, method = 'GET'): Promise<{ status: number, headers: Record<string, string | string[] | undefined>, body: Uint8Array }> {
  const url = new URL(origin)
  return await new Promise((resolve, reject) => {
    const request = nodeRequest({ host: url.hostname, port: url.port, path, method }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: new Uint8Array(Buffer.concat(chunks)) }))
    })
    request.once('error', reject)
    request.end()
  })
}

const csp = "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'"
const html = '<!doctype html><title>Component realm</title><script type="module" src="./assets/app.js"></script>'

describe('component asset host', () => {
  it('serves only allowlisted static bytes with a random loopback capability prefix', async () => {
    const server = await startComponentAssetsServer({
      assets: [
        { path: 'index.html', contentType: 'text/html; charset=utf-8', body: html, sha256: hash(html) },
        { path: 'assets/app.js', contentType: 'text/javascript; charset=utf-8', body: 'export const fixed = true' },
        { path: 'assets/app_bg.wasm', contentType: 'application/wasm', body: new Uint8Array([0, 97, 115, 109]) },
      ],
      entry: 'index.html',
      csp,
    })
    try {
      const frame = new URL(server.frameUrl)
      expect(server.origin).toBe(frame.origin)
      expect(frame.hostname).toBe('127.0.0.1')
      expect(frame.pathname).toMatch(/^\/component-assets\/[A-Za-z0-9_-]{32}\/index\.html$/u)

      const document = await fetch(server.frameUrl)
      expect(document.status).toBe(200)
      expect(document.headers.get('content-type')).toContain('text/html')
      expect(document.headers.get('content-security-policy')).toBe(csp)
      expect(document.headers.get('access-control-allow-origin')).toBe('*')
      expect(document.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(await document.text()).toBe(html)

      const script = await fetch(new URL('./assets/app.js', server.frameUrl))
      expect(script.status).toBe(200)
      expect(script.headers.get('content-type')).toContain('text/javascript')
      expect(await script.text()).toContain('fixed')

      const parentFrame = new URL(server.frameUrl)
      parentFrame.searchParams.set('parentOrigin', 'http://127.0.0.1:4175')
      const bootstrapDocument = await fetch(parentFrame)
      expect(bootstrapDocument.status).toBe(200)
      expect(await bootstrapDocument.text()).toBe(html)
      for (const query of ['parentOrigin=javascript:alert(1)', 'parentOrigin=http://user:pass@localhost', 'parentOrigin=http://localhost/path', 'parentOrigin=http://localhost&parentOrigin=http://other', 'parentOrigin=http://localhost&path=/etc/passwd']) {
        expect((await rawRequest(server.origin, `${frame.pathname}?${query}`)).status).toBe(404)
      }
      expect((await fetch(new URL('./assets/app.js?parentOrigin=http://localhost', server.frameUrl))).status).toBe(404)

      const head = await fetch(server.frameUrl, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-length')).toBe(String(new TextEncoder().encode(html).byteLength))
      expect(await head.text()).toBe('')

      const post = await fetch(server.frameUrl, { method: 'POST', body: 'not accepted' })
      expect(post.status).toBe(405)
      expect(post.headers.get('allow')).toBe('GET, HEAD')
    } finally { await server.close() }
    await server.close()
    await expect(fetch(server.frameUrl)).rejects.toThrow()
  })

  it('does not resolve unknown or traversal-like request paths through the filesystem', async () => {
    const server = await startComponentAssetsServer({
      assets: [{ path: 'index.html', contentType: 'text/html; charset=utf-8', body: html }],
      entry: 'index.html', csp,
    })
    try {
      const frame = new URL(server.frameUrl)
      const unknown = await rawRequest(server.origin, `${frame.pathname.slice(0, -'index.html'.length)}missing.txt`)
      expect(unknown.status).toBe(404)
      expect(unknown.body.byteLength).toBe(0)
      const traversal = await rawRequest(server.origin, `${frame.pathname.slice(0, -'index.html'.length)}%2e%2e/%2e%2e/etc/passwd`)
      expect(traversal.status).toBe(404)
      expect(traversal.body.byteLength).toBe(0)
      const query = await rawRequest(server.origin, `${frame.pathname}?path=/etc/passwd`)
      expect(query.status).toBe(404)
    } finally { await server.close() }
  })

  it('rejects invalid capability asset declarations before opening a listener', async () => {
    const valid = { path: 'index.html', contentType: 'text/html; charset=utf-8', body: html }
    const cases: Array<{ readonly code: string, readonly options: Parameters<typeof startComponentAssetsServer>[0] }> = [
      { code: 'COMPONENT_ASSETS_DUPLICATE_PATH', options: { assets: [valid, valid], entry: 'index.html', csp } },
      { code: 'COMPONENT_ASSETS_PATH_INVALID', options: { assets: [{ ...valid, path: '../index.html' }], entry: '../index.html', csp } },
      { code: 'COMPONENT_ASSETS_PATH_UTF8_INVALID', options: { assets: [{ ...valid, path: 'bad\ud800.html' }], entry: 'bad\ud800.html', csp } },
      { code: 'COMPONENT_ASSETS_BODY_INTEGRITY_MISMATCH', options: { assets: [{ ...valid, sha256: '0'.repeat(64) }], entry: 'index.html', csp } },
      { code: 'COMPONENT_ASSETS_ENTRY_UNKNOWN', options: { assets: [valid], entry: 'missing.html', csp } },
      { code: 'COMPONENT_ASSETS_ENTRY_NOT_DOCUMENT', options: { assets: [{ path: 'module.wasm', contentType: 'application/wasm', body: new Uint8Array([0]) }], entry: 'module.wasm', csp } },
      { code: 'COMPONENT_ASSETS_CSP_INVALID', options: { assets: [valid], entry: 'index.html', csp: "default-src 'none'\r\nX-Evil: 1" } },
    ]
    for (const testCase of cases) {
      await expect(startComponentAssetsServer(testCase.options)).rejects.toMatchObject({ name: 'ComponentAssetsHostError', code: testCase.code } satisfies Partial<ComponentAssetsHostError>)
    }
  })
})
