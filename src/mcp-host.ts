import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { CallToolResultSchema } from '@modelcontextprotocol/core'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type {} from '@deepseek-ai/dsh-tools'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ExperienceSettings } from './contracts.js'
import { McpAppsConnector } from './mcp-connector.js'
import { createMcpSandboxProxy } from './mcp-proxy.js'

const jsonObject = z.record(z.string(), z.json())
const requestSchema = z.strictObject({ sessionId: z.string().min(1).max(200), instanceId: z.uuid(), commandId: z.string().min(1).max(200), name: z.string().min(1).max(300), args: jsonObject })
const toolInput = z.strictObject({ capability: z.string().length(64), instanceId: z.uuid(), mode: z.enum(['model', 'app']), name: z.string().min(1).max(300), args: jsonObject })
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'solar-mcp-app': { kind: 'solar-mcp-app', form: 'notice', summary: string }
  }
}
const TOOL = 'solar_mcp_app_action'
type Instance = { sessionId: string, capability: string, agent: Agent, proxy: Awaited<ReturnType<typeof createMcpSandboxProxy>>, abort: AbortController }

/** Explicit single-server Apps connector; never alters existing DSH MCP clients. */
export class McpHost {
  private connector = new McpAppsConnector()
  private connecting?: Promise<void>
  private connected = false
  private closed = false
  private closing?: Promise<void>
  private instances = new Map<string, Instance>()
  private wrappers: Array<() => void> = []
  private unregister: () => void
  constructor(private ctx: Context, private options: { endpoint: string, root: string, settings: () => ExperienceSettings }) {
    this.unregister = ctx.tools.register({
      name: TOOL,
      description: '执行当前交互页面授权的 MCP 操作；仅活跃页面可调用。',
      parameters: JSON.parse(JSON.stringify(z.toJSONSchema(toolInput))),
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: '交互页面操作已完成。' }] },
      execute: async (raw, exec) => {
        const input = toolInput.parse(raw)
        const instance = this.instances.get(input.instanceId)
        if (!instance || input.capability !== instance.capability || !exec.agent || exec.agent !== instance.agent || this.ctx.agents.get(exec.agent.id) !== exec.agent) throw new Error('MCP_APP_CAPABILITY_INVALID')
        this.assertEnabled(); exec.signal.throwIfAborted()
        const authorize = (_name: string, _args: Record<string, unknown>, run: () => Promise<CallToolResult>) => run()
        const result = input.mode === 'model'
          ? await this.connector.callModel(input.name, input.args, authorize, exec.signal)
          : await this.connector.callFromView(input.name, input.args, authorize, exec.signal)
        return z.json().parse(result)
      },
    })
  }
  private assertEnabled() {
    const settings = this.options.settings()
    if (this.closed || this.closing || !settings.takeover || !settings.mcpApps) throw new Error('MCP Apps is disabled')
    if (!this.options.endpoint) throw new Error('MCP Apps endpoint is not configured')
  }
  private async connect() {
    this.assertEnabled()
    if (!this.connected) {
      this.connecting ??= this.connector.connect(this.options.endpoint).then(async () => { try { this.registerModelTools(); this.connected = true } catch (error) { await this.connector.close(); throw error } }).finally(() => { this.connecting = undefined })
      await this.connecting
      this.assertEnabled()
    }
  }
  private registerModelTools() {
    try {
      for (const tool of this.connector.modelTools()) {
        const uri = (tool._meta?.ui as { resourceUri?: unknown } | undefined)?.resourceUri ?? tool._meta?.['ui/resourceUri']
        if (typeof uri !== 'string') continue
        const wireName = `solar_mcp_${createHash('sha256').update(tool.name).digest('hex').slice(0, 24)}`
        const serverName = tool.name
        this.wrappers.push(this.ctx.tools.register({
          name: wireName,
          description: tool.description ?? `MCP tool ${serverName}`,
          parameters: tool.inputSchema,
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
            presentationMeta: (args, value) => z.json().parse({ type: 'solar-experience', protocol: 'mcp-app', payload: { toolName: serverName, input: args, result: value }, label: tool.title ?? serverName }),
          },
          execute: async (raw, exec) => {
            this.assertEnabled()
            if (!exec.agent || this.ctx.agents.get(exec.agent.id) !== exec.agent) throw new Error('MCP Apps requires a live session Agent')
            const args = jsonObject.parse(raw)
            const request = { formatVersion: 1, sessionId: String(exec.agent.id), commandId: String(exec.callId), mode: 'model', name: serverName, args }
            return z.json().parse(await this.record(request, () => this.connector.callModel(serverName, args, (_name, _args, run) => run(), exec.signal)))
          },
        }))
      }
    } catch (error) { for (const dispose of this.wrappers.splice(0)) dispose(); throw error }
  }
  status() { return { configured: !!this.options.endpoint, enabled: !this.closed && this.options.settings().takeover && this.options.settings().mcpApps, connected: this.connected, instances: this.instances.size } }
  async list() { await this.connect(); return this.connector.modelTools() }
  async open(input: { sessionId: string, toolName: string, input: Record<string, unknown>, result: CallToolResult, hostOrigin: string }) {
    await this.connect()
    const args = jsonObject.parse(input.input)
    const agent = this.ctx.agents.get(input.sessionId as Agent['id'])
    if (!agent) throw new Error('MCP Apps requires a live session Agent')
    const resource = await this.connector.resource(input.toolName)
    this.assertEnabled()
    const proxy = await createMcpSandboxProxy(input.hostOrigin)
    const instanceId = randomUUID()
    const instance: Instance = { sessionId: input.sessionId, capability: randomBytes(32).toString('hex'), agent, proxy, abort: new AbortController() }
    this.instances.set(instanceId, instance)
    try {
      const result = CallToolResultSchema.parse(input.result)
      this.assertEnabled()
      return { instanceId, proxyUrl: proxy.url, html: resource.content.text, input: args, result }
    } catch (error) { await this.close(instanceId); throw error }
  }
  async action(raw: { sessionId: string, instanceId: string, commandId: string, name: string, args: Record<string, unknown> }) {
    const input = requestSchema.parse(raw)
    this.assertEnabled()
    const instance = this.instances.get(input.instanceId)
    if (!instance || instance.sessionId !== input.sessionId) throw new Error('MCP Apps instance is unavailable for this session')
    return this.dispatch(input.instanceId, instance, input.commandId, 'app', input.name, input.args)
  }
  private async dispatch(instanceId: string, instance: Instance, commandId: string, mode: 'model' | 'app', name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.assertEnabled()
    if (this.instances.get(instanceId) !== instance || this.ctx.agents.get(instance.agent.id) !== instance.agent) throw new Error('MCP Apps session is no longer live')
    const request = { formatVersion: 1, sessionId: instance.sessionId, instanceId, commandId, mode, name, args }
    return this.record(request, async () => {
      const result = await this.ctx.tools.execute({ callId: ToolCallId(`mcp-app-${randomUUID()}`), name: TOOL, arguments: { capability: instance.capability, instanceId, mode, name, args }, agent: instance.agent, signal: instance.abort.signal })
      return result.isError ? { isError: true, content: [{ type: 'text', text: result.error.message }] } : CallToolResultSchema.parse(result.value)
    }, async (phase, value) => this.notice(instance, request, phase, value))
  }
  private async notice(instance: Instance, request: { commandId: string, name: string, args: Record<string, unknown> }, phase: 'requested' | 'settled' | 'uncertain', value?: CallToolResult) {
    const sessions = this.ctx.get('sessions') as unknown as SessionStore | undefined
    if (!sessions || typeof sessions.get !== 'function' || typeof sessions.flush !== 'function' || sessions.get(instance.agent.id) !== instance.agent.session) throw new Error('MCP Apps session is not attached to the Session store')
    const summary = phase === 'requested' ? 'MCP 页面交互已请求' : phase === 'settled' ? 'MCP 页面交互已结束' : 'MCP 页面交互结果未知'
    const content = JSON.stringify({ commandId: request.commandId, tool: request.name, phase, ...(phase === 'requested' ? { arguments: request.args } : {}), ...(value ? { result: value } : {}) })
    const message = createUserMessage({ content: [{ type: 'text', text: content }], source: { kind: 'solar-mcp-app', form: 'notice', summary } })
    instance.agent.session.append('user/message', message, { surfaceOp: 'append' })
    if (!await sessions.flush(instance.agent.session)) throw new Error('MCP Apps session durability is unavailable')
  }
  private async record(request: { formatVersion: number, sessionId: string, commandId: string, mode: string, name: string, args: Record<string, unknown>, instanceId?: string }, run: () => Promise<CallToolResult>, notice?: (phase: 'requested' | 'settled' | 'uncertain', value?: CallToolResult) => Promise<void>): Promise<CallToolResult> {
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const key = createHash('sha256').update(`${request.sessionId}\0${request.commandId}`).digest('hex')
    const dir = join(this.options.root, 'mcp-actions')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const pending = join(dir, `${key}.request.json`), outcome = join(dir, `${key}.result.json`), sessionReceipt = join(dir, `${key}.session.json`)
    try {
      const file = await open(pending, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify({ ...request, digest })); await file.sync() } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const prior = JSON.parse(await readFile(pending, 'utf8')) as { formatVersion?: unknown, digest?: unknown }
      if (prior.formatVersion !== 1 || prior.digest !== digest) throw new Error('MCP Apps command ID conflicts with a previous request')
      try {
        const saved = JSON.parse(await readFile(outcome, 'utf8')) as { formatVersion?: unknown, digest?: unknown, result?: unknown }
        if (saved.formatVersion !== 1 || saved.digest !== digest) throw new Error('MCP Apps receipt is invalid')
        if (notice) {
          try { const marker = JSON.parse(await readFile(sessionReceipt, 'utf8')) as { formatVersion?: unknown, digest?: unknown }; if (marker.formatVersion !== 1 || marker.digest !== digest) throw new Error('MCP Apps session receipt is invalid') }
          catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('MCP Apps result is recorded but its session receipt is unconfirmed'); throw e }
        }
        return CallToolResultSchema.parse(saved.result)
      } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('MCP Apps command outcome is uncertain; it will not be replayed'); throw e }
    }
    if (notice) await notice('requested')
    let result: CallToolResult
    try { result = await run() }
    catch (error) { if (notice) await notice('uncertain', { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }).catch(() => undefined); throw error }
    try {
      const file = await open(outcome, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify({ formatVersion: 1, digest, result })); await file.sync() } finally { await file.close() }
    } catch (error) {
      if (notice) await notice('uncertain', { isError: true, content: [{ type: 'text', text: 'MCP action returned but its durable result receipt could not be saved' }] }).catch(() => undefined)
      throw error
    }
    if (notice) {
      await notice(result.isError ? 'uncertain' : 'settled', result)
      const marker = await open(sessionReceipt, 'wx', 0o600)
      try { await marker.writeFile(JSON.stringify({ formatVersion: 1, digest })); await marker.sync() } finally { await marker.close() }
    }
    return result
  }
  async closeForSession(sessionId: string, instanceId: string) { const instance = this.instances.get(instanceId); if (!instance || instance.sessionId !== sessionId) throw new Error('MCP Apps instance is unavailable for this session'); await this.close(instanceId) }
  async close(instanceId: string) { const instance = this.instances.get(instanceId); if (!instance) return; this.instances.delete(instanceId); instance.abort.abort(); await instance.proxy.close() }
  async closeAll() {
    if (this.closing) return this.closing
    const close = async () => {
      if (this.connecting) await this.connecting.catch(() => undefined)
      for (const dispose of this.wrappers.splice(0)) dispose()
      await Promise.all([...this.instances.keys()].map(id => this.close(id)))
      await this.connector.close(); this.connected = false
    }
    const operation = close()
    this.closing = operation
    try { await operation } finally { if (this.closing === operation) this.closing = undefined }
  }
  async dispose() { if (this.closed) return; this.closed = true; this.unregister(); await this.closeAll() }
}
