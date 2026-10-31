import { describe, expect, it } from 'vitest'
import { createMcpSandboxProxy } from '../src/mcp-proxy.js'

describe('MCP Apps proxy origins', () => {
  it('accepts only the exact Desktop origin and retains response-header isolation', async () => {
    const proxy = await createMcpSandboxProxy('dsh-app://app')
    try {
      const response = await fetch(proxy.url)
      const csp = response.headers.get('content-security-policy') ?? ''
      expect(csp).toContain('frame-ancestors dsh-app://app')
      expect(csp).toContain("connect-src 'none'")
      expect(response.headers.get('permissions-policy')).toContain('camera=()')
      const html = await response.text()
      expect(html).toContain('const expected="dsh-app://app"')
      expect(html).toContain('e.source===parent&&e.origin===expected')
      expect(html).toContain("e.origin==='null'")
    } finally { await proxy.close() }
    for (const value of ['dsh-app://shell', 'dsh-app://app/', 'dsh-app://app.evil', 'file://', 'null']) {
      await expect(createMcpSandboxProxy(value)).rejects.toThrow()
    }
  })
})
