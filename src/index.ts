import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import { fileURLToPath } from 'node:url'
import { installUiverse } from './uiverse/host.js'
import { UI_TOOL_NAMES } from './uiverse/remote.js'
import { join } from 'node:path'
import { z as schema } from 'zod'
import { ExperienceStore } from './store.js'
import { ExperienceControl } from './control.js'
import { artifactSchema } from './contracts.js'
import { visualEffectSchema } from './effects.js'
import { McpHost } from './mcp-host.js'

export { UiComponentsControl } from './uiverse/host.js'
export { ExperienceControl } from './control.js'
export { ExperienceRegistry } from './registry.js'
export * from './contracts.js'
export const name = 'intelligent-experience-platform'
export const inject = ['tools', 'sessions', 'skills']
export interface Config { maxArtifactBytes: number; maxArtifactsPerSession: number; mcpEndpoint: string }
export const Config: z<Config> = z.object({
  maxArtifactBytes: z.number().min(1024).max(16 * 1024 * 1024).default(1024 * 1024),
  maxArtifactsPerSession: z.number().min(1).max(10000).default(500),
  mcpEndpoint: z.string().default(''),
})
const presentationInput = schema.strictObject({ protocol: schema.enum(['content', 'openui']), label: schema.string().min(1).max(300), payload: schema.json(), effectId: schema.enum(visualEffectSchema.options).optional() })

function renderedToolText(content: readonly unknown[]): string {
  return content.flatMap(block => {
    if (!block || typeof block !== 'object' || !('type' in block) || block.type !== 'text' || !('text' in block) || typeof block.text !== 'string') return []
    return [block.text]
  }).join('\n\n')
}

function toolPayload(result: { value?: unknown; content: readonly unknown[]; isError: boolean }): unknown {
  if (result.value !== undefined) return schema.json().parse(result.value)
  const rendered = renderedToolText(result.content)
  const content = rendered || schema.json().parse(result.content)
  return result.isError ? { isError: true, content } : content
}

function assistantMarkdown(message: unknown): string | undefined {
  if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content)) return undefined
  const sections = message.content.flatMap(block => {
    if (!block || typeof block !== 'object' || !('type' in block)) return []
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string' && block.text.trim()) return [block.text]
    if (block.type === 'reasoning' && 'text' in block && typeof block.text === 'string' && block.text.trim()) return [`**思考过程**\n\n${block.text}`]
    if (block.type === 'image') return ['助手输出包含图片；请在原始内容中查看附件。']
    return []
  })
  const markdown = sections.join('\n\n').trim()
  return markdown || undefined
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.mcpEndpoint) {
    const endpoint = new URL(config.mcpEndpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('EXPERIENCE_MCP_ENDPOINT_INVALID: MCP 应用地址必须为不含凭据的 HTTP(S) 地址。')
  }
  await installUiverse(ctx, fileURLToPath(new URL('./uiverse/assets/', import.meta.url)))
  const root = join(resolveDshHome(), 'solar', 'intelligent-experience-platform')
  const store = new ExperienceStore(root, config)
  let current = await store.settings()
  const mcp = new McpHost(ctx, {endpoint: config.mcpEndpoint, root, settings: () => current})
  const control = new ExperienceControl(ctx, store, mcp)
  if (current.takeover && current.mcpApps && config.mcpEndpoint) void control.activateMcp()
  ctx.effect(() => store.subscribe(settings => { current = settings; if (!settings.takeover || !settings.mcpApps) void mcp.closeAll().catch(error => ctx.logger('solar-experience').warn('%s', error)) }))
  ctx.effect(() => () => mcp.dispose())
  for (const [id, protocol] of [['openui', 'openui'], ['content', 'content'], ['mcp-app', 'mcp-app']] as const) {
    ctx.effect(() => control.registry.register({ id, version: '1', capabilities: [protocol] }, value => value))
  }
  const pending = new Set<Promise<unknown>>()
  let active = true
  const capture = (operation: () => Promise<unknown>) => {
    if (!active || !current.takeover) return
    const task = operation().catch(error => ctx.logger('solar-experience').warn('输出保存失败，原始会话保持可读：%s', error instanceof Error ? error.message : String(error))).finally(() => pending.delete(task))
    pending.add(task)
  }
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || exec.name === 'solar_present' || (UI_TOOL_NAMES as readonly string[]).includes(exec.name)) return
    const meta = result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta) ? result.meta : undefined
    const app = meta?.type === 'solar-experience' && meta.protocol === 'mcp-app'
    capture(() => store.publish({
      source: { sessionId: String(exec.agent!.id), callId: String(exec.callId), kind: 'tool', label: exec.name },
      protocol: app ? 'mcp-app' : 'content', raw: schema.json().parse({ content: result.content, ...(result.meta === undefined ? {} : { meta: result.meta }) }),
      payload: schema.json().parse(app ? meta!.payload : toolPayload(result)), providerId: app ? 'mcp-app' : 'content',
    }))
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message') return
    const payload = assistantMarkdown(event.data.message)
    if (payload === undefined) return
    capture(() => store.publish({ source: { sessionId: String(session.id), seq: event.seq, kind: 'assistant', label: '助手回复' }, protocol: 'content', raw: schema.json().parse(event.data.message), payload, providerId: 'content' }))
  })
  ctx.effect(() => () => { active = false; return Promise.allSettled([...pending]).then(() => undefined) })
  ctx.tools.register({
    name: 'solar_present', description: '保存并在当前会话呈现内容页面。protocol=content 接收普通文本或结构化 JSON；protocol=openui 接收 OpenUI Lang 文本。可选 effectId 仅作用于生成内容的首个短标题；需显式指定已安装的效果，缺失时保留原样。保留原始输入，不调用额外模型。',
    // Zod carries a non-enumerable ~standard helper on its schema object.
    // The DSH boundary accepts only the JSON document, never helper functions.
    parameters: JSON.parse(JSON.stringify(schema.toJSONSchema(presentationInput))),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: `已保存内容页面：${artifactSchema.parse(value).source.label}` }],
      presentationMeta: (_args, value) => { const a = artifactSchema.parse(value); return { type: 'solar-experience', artifactId: a.id, protocol: a.protocol, payload: a.payload, label: a.source.label, ...(a.effectId ? { effectId: a.effectId } : {}) } },
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('EXPERIENCE_SESSION_REQUIRED: 内容页面需要当前会话。')
      exec.signal.throwIfAborted()
      const value = presentationInput.parse(args)
      if (value.protocol === 'openui' && typeof value.payload !== 'string') throw new Error('EXPERIENCE_OPENUI_TEXT_REQUIRED: OpenUI 内容必须是语言文本。')
      return store.publish({ source: { sessionId: String(exec.agent.id), callId: String(exec.callId), kind: 'generated', label: value.label }, protocol: value.protocol, raw: value.payload, payload: value.payload, providerId: value.protocol === 'openui' ? 'openui' : 'content', ...(value.effectId && value.protocol === 'content' ? { effectId: value.effectId } : {}) })
    },
  })
  ctx.tools.register({ name: 'solar_ui_catalog', description: '按需读取 OpenUI 的真实组件目录和语法，用于生成可交互内容；仅需要生成 UI 时调用。', parameters: {type: 'object', properties: {}, additionalProperties: false},
    output: {schema: {type: 'object', properties: {prompt: {type: 'string'}}, required: ['prompt']}, render: (_args, value) => [{type: 'text', text: (value as {prompt: string}).prompt}]},
    async execute(_args, exec) {exec.signal.throwIfAborted(); const {openuiLibrary, openuiPromptOptions} = await import('@openuidev/react-ui/genui-lib'); return {prompt: openuiLibrary.prompt(openuiPromptOptions)}},
  })
}
