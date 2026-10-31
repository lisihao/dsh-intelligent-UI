import { describe, expect, it } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'

describe('manual MCP Apps bridge', () => {
  it('initializes, sends input and result, mediates calls, and completes teardown', async () => {
    const [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair()
    const app = new App({ name: 'fixture', version: '1' }, {}, { autoResize: false })
    const bridge = new AppBridge(null, { name: 'host', version: '1' }, { serverTools: {} })
    let input: unknown; let result: unknown; let closed = false
    app.ontoolinput = value => { input = value.arguments }
    app.ontoolresult = value => { result = value.content }
    app.onteardown = async () => { closed = true; return {} }
    bridge.oncalltool = async ({ name }) => ({ content: [{ type: 'text', text: `authorized:${name}` }] })
    await bridge.connect(bridgeTransport); await app.connect(appTransport)
    await bridge.sendToolInput({ arguments: { x: 7 } })
    await bridge.sendToolResult({ content: [{ type: 'text', text: 'done' }] })
    expect(input).toEqual({ x: 7 }); expect(result).toEqual([{ type: 'text', text: 'done' }])
    expect((await app.callServerTool({ name: 'fixture', arguments: {} })).content).toEqual([{ type: 'text', text: 'authorized:fixture' }])
    await bridge.teardownResource({}); expect(closed).toBe(true)
    await bridge.close(); await app.close()
  })
})
