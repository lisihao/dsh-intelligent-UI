import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SERVICE, publishSchema, widgetInputSchema, saveWidgetStateSchema, type ExperienceApi, type WidgetStateApi, type ThemeApi, type PublishInput, type SaveSettingsInput, type SaveWidgetStateInput } from './contracts.js'
import type { InstallThemeInput, RemoveThemeInput } from './theme-contracts.js'
import { z } from 'zod'
import { sessionInputSchema } from './remote.js'
import { ExperienceStore } from './store.js'
import { ExperienceRegistry } from './registry.js'
import { McpHost } from './mcp-host.js'
import { listSourceThemes, downloadSourceTheme } from './theme-download.js'
import type { DownloadThemeInput } from './theme-source.js'
import { CallToolResultSchema } from '@modelcontextprotocol/core'

export class ExperienceControl extends TypertRemoteService implements ExperienceApi, WidgetStateApi, ThemeApi {
  readonly registry = new ExperienceRegistry()
  private mcpError: string | undefined
  constructor(ctx: Context, readonly store: ExperienceStore, readonly mcp: McpHost) { super(ctx, SERVICE) }
  private owner(): void {
    if (this.ctx.invocation && this.ctx.invocation.peer.principal.kind !== 'owner') throw new Error('EXPERIENCE_OWNER_REQUIRED: 此操作仅允许本机所有者使用。')
  }
  @Remote
  async settings() { this.owner(); return this.store.settings() }
  @Remote
  async saveSettings(input: SaveSettingsInput) {
    this.owner()
    const value = await this.store.saveSettings(input)
    if (value.takeover && value.mcpApps && this.mcp.status().configured) void this.activateMcp()
    return value
  }
  @Remote
  async installTheme(input: InstallThemeInput) { this.owner(); return this.store.installTheme(input) }
  @Remote
  async removeTheme(input: RemoveThemeInput) { this.owner(); return this.store.removeTheme(input) }
  @Remote
  async themeCatalog() { this.owner(); return listSourceThemes(this.store) }
  @Remote
  async downloadTheme(input: DownloadThemeInput) { this.owner(); return downloadSourceTheme(this.store, input) }
  async activateMcp(): Promise<void> {
    try { await this.mcp.list(); this.mcpError = undefined }
    catch (error) { this.mcpError = error instanceof Error ? error.message : String(error); this.ctx.logger('solar-experience').warn('MCP Apps 连接失败：%s', this.mcpError) }
  }
  @Remote
  async artifacts(input: { sessionId: string }) { this.owner(); return this.store.artifacts(sessionInputSchema.parse(input)) }
  @Remote
  async publish(input: PublishInput) {
    this.owner()
    const value = publishSchema.parse(input)
    const payload = z.json().parse(await this.registry.route(value.protocol, value.providerId, value.payload))
    return this.store.publish({ ...value, payload })
  }
  @Remote
  async widgetState(input: {sessionId: string; artifactId: string}) { this.owner(); return this.store.widgetState(widgetInputSchema.parse(input)) }
  @Remote
  async saveWidgetState(input: SaveWidgetStateInput) { this.owner(); return this.store.saveWidgetState(saveWidgetStateSchema.parse(input)) }
  @Remote
  async mcpStatus() { this.owner(); return { ...this.mcp.status(), ...(this.mcpError ? {error: this.mcpError} : {}) } }
  @Remote
  async mcpList() { this.owner(); return this.mcp.list() }
  @Remote
  async mcpOpen(input: {sessionId: string; artifactId: string; hostOrigin: string}) {
    this.owner()
    const value = widgetInputSchema.extend({hostOrigin: z.url()}).parse(input)
    const artifact = (await this.store.artifacts(value)).find(a => a.id === value.artifactId)
    if (!artifact || artifact.protocol !== 'mcp-app') throw new Error('MCP_APP_SOURCE_REQUIRED: 找不到当前会话中已保存的 MCP App 输出。')
    const data = z.object({toolName: z.string(), input: z.record(z.string(), z.json()), result: CallToolResultSchema}).parse(artifact.payload)
    return this.mcp.open({sessionId: value.sessionId, hostOrigin: value.hostOrigin, ...data})
  }
  @Remote
  async mcpAction(input: {sessionId: string; instanceId: string; commandId: string; name: string; args: Record<string, unknown>}) { this.owner(); return this.mcp.action(input) }
  @Remote
  async mcpClose(input: {sessionId: string; instanceId: string}) {
    this.owner()
    const value = z.strictObject({sessionId: z.string().min(1).max(200), instanceId: z.uuid()}).parse(input)
    await this.mcp.closeForSession(value.sessionId, value.instanceId)
    return null
  }
}
declare module '@deepseek-ai/cordis' { interface Context { solarExperience: ExperienceControl } }
