import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { RESOURCE_MIME_TYPE, getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge'

/** A separate, explicitly configured connection. Existing DSH MCP clients are never modified. */
export class McpAppsConnector {
  private client: Client | undefined
  private tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []

  async connect(endpoint: string): Promise<void> {
    if (this.client) throw new Error('MCP Apps connector is already connected')
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid MCP Apps endpoint')
    const client = new Client({ name: 'dsh-intelligent-experience', version: '0.1.0' }, {
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [RESOURCE_MIME_TYPE] } } },
    })
    try {
      await client.connect(new StreamableHTTPClientTransport(url))
      this.client = client
      this.tools = (await client.listTools()).tools
    } catch (error) {
      this.client = undefined
      await client.close().catch(() => {})
      throw error
    }
  }

  list() { return this.tools.slice() }
  modelTools() { return this.tools.filter(tool => {
    const ui = tool._meta?.ui as { visibility?: unknown } | undefined
    return ui?.visibility === undefined || (Array.isArray(ui.visibility) && ui.visibility.includes('model'))
  }) }
  private connected() { if (!this.client) throw new Error('MCP Apps connector is disconnected'); return this.client }

  async resource(toolName: string) {
    const tool = this.tools.find(item => item.name === toolName)
    if (!tool) throw new Error('Unknown MCP tool')
    const uri = getToolUiResourceUri(tool)
    if (!uri) throw new Error('Tool does not declare an MCP Apps resource')
    const result = await this.connected().readResource({ uri })
    const content = result.contents.find(item => item.uri === uri && item.mimeType === RESOURCE_MIME_TYPE && 'text' in item)
    if (!content || !('text' in content)) throw new Error('MCP Apps resource MIME or content is invalid')
    const listing = (await this.connected().listResources()).resources.find(item => item.uri === uri)
    for (const meta of [listing?._meta, content._meta]) {
      const ui = meta?.ui as { csp?: Record<string, unknown>, permissions?: Record<string, unknown> } | undefined
      if (ui?.permissions && Object.keys(ui.permissions).length) throw new Error('MCP Apps device permissions are unsupported')
      if (ui?.csp && Object.values(ui.csp).some(value => !Array.isArray(value) || value.length > 0)) throw new Error('MCP Apps external network permissions are unsupported')
    }
    return { uri, content, tool }
  }

  async callModel(name: string, args: Record<string, unknown>, authorize: (name: string, args: Record<string, unknown>, execute: () => ReturnType<Client['callTool']>) => ReturnType<Client['callTool']>, signal?: AbortSignal) {
    if (!this.modelTools().some(tool => tool.name === name)) throw new Error('Tool is not visible to the model')
    if (typeof authorize !== 'function') throw new Error('DSH action authorization is unavailable')
    return authorize(name, args, () => this.connected().callTool({ name, arguments: args }, { signal }))
  }

  /** Calls require an injected DSH authorization and provenance boundary. */
  async callFromView(name: string, args: Record<string, unknown>, authorize: (name: string, args: Record<string, unknown>, execute: () => ReturnType<Client['callTool']>) => ReturnType<Client['callTool']>, signal?: AbortSignal) {
    const tool = this.tools.find(item => item.name === name)
    if (!tool) throw new Error('Unknown MCP tool')
    const ui = tool._meta?.ui as { visibility?: unknown } | undefined
    if (ui?.visibility !== undefined && (!Array.isArray(ui.visibility) || !ui.visibility.includes('app'))) throw new Error('Tool is not visible to MCP Apps')
    if (typeof authorize !== 'function') throw new Error('DSH action authorization is unavailable')
    return authorize(name, args, () => this.connected().callTool({ name, arguments: args }, { signal }))
  }

  async close() { const client = this.client; this.client = undefined; this.tools = []; if (client) await client.close() }
}
