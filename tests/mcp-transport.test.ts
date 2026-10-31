import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpAppsConnector } from '../src/mcp-connector.js'
// @ts-expect-error fixture is a JavaScript-only test server
import { startMcpFixture } from '../tools/mcp-fixture.mjs'

describe('MCP Apps over Streamable HTTP', () => {
  let fixture: { url: string, close(): Promise<void> }
  let connector: McpAppsConnector
  beforeAll(async () => { fixture = await startMcpFixture(); connector = new McpAppsConnector(); await connector.connect(fixture.url) })
  afterAll(async () => { await connector?.close(); await fixture?.close() })
  it('negotiates and preserves metadata, MIME and app-only visibility', async () => {
    expect(connector.list().find(t => t.name === 'fixture_open')?._meta?.ui).toMatchObject({ resourceUri: 'ui://fixture/view' })
    expect(connector.modelTools().some(t => t.name === 'fixture_increment')).toBe(false)
    const view = await connector.resource('fixture_open')
    expect(view.content.mimeType).toBe('text/html;profile=mcp-app')
    expect(view.content.text).toContain('Fixture view')
  })
  it('requires authorization and enforces same-connection visibility', async () => {
    const execute = async (_name: string, _args: Record<string, unknown>, run: () => Promise<any>) => run()
    await expect(connector.callFromView('fixture_model_only', {}, execute)).rejects.toThrow('not visible')
    await expect(connector.callFromView('unknown', {}, execute)).rejects.toThrow('Unknown')
    const result = await connector.callFromView('fixture_increment', { value: 2 }, execute)
    expect(result.content).toMatchObject([{ type: 'text', text: '3' }])
    await expect(connector.callModel('fixture_increment', {}, execute)).rejects.toThrow('not visible')
  })
})
