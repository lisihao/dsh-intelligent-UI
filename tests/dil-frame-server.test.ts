import { describe, expect, it } from 'vitest'
import { startDilFrameServer } from '../src/dil/frame-server.js'

describe('fixed DIL runner document service', () => {
  it('serves only pinned static runner content and closes its listener', async () => {
    const server = await startDilFrameServer()
    try {
      const response = await fetch(server.frameUrl)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
      expect(response.headers.get('content-security-policy')).toContain("script-src 'sha256-")
      expect(response.headers.get('content-security-policy')).not.toContain('https:')
      const html = await response.text()
      expect(html).toContain('DIL Runner')
      expect(html).toContain('<template')
      expect((await fetch(new URL('/not-the-runner', server.frameUrl))).status).toBe(404)
      expect((await fetch(server.frameUrl, { method: 'POST', body: 'not accepted' })).status).toBe(405)
      expect(await (await fetch(server.frameUrl, { method: 'HEAD' })).text()).toBe('')
    } finally { await server.close() }
    await expect(fetch(server.frameUrl)).rejects.toThrow()
    await server.close()
  })
})
