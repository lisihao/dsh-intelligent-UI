import {AdaptiveCompositionCoordinator} from './adaptive-ui/host.js'
import {PersistedDecisionStore} from './adaptive-ui/decision-store.js'
import type {JevCompositionPort} from './adaptive-ui/contracts.js'
import {getCompositionCatalog} from './adaptive-ui/catalog.js'
import {builtInThemes} from './theme-contracts.js'
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
import { CANVAS_DEVELOPMENT_TOOL, installCanvasDevelopment } from './canvas-dev-host.js'
import { installCanvasRuntimeHost } from './canvas-runtime-host.js'
import { installResearch, RESEARCH_TOOL } from './research-host.js'
import { join } from 'node:path'
import { z as schema } from 'zod'
import { ExperienceStore } from './store.js'
import { ExperienceControl } from './control.js'
import { DIL_PROTOCOL, artifactSchema, dilSourceSchema } from './contracts.js'
import { LOCAL_IMPORT_PROVIDER } from './file-library-contracts.js'
import { McpHost } from './mcp-host.js'
import { dilAuthoringGuide } from './dil/catalog.js'
import { installDilAuthoringPrompt, installDilHost } from './dil/host.js'
import { createSourceBlockComponentRegistry } from './adaptive-ui/source-block-components.js'
import { ComponentRuntimeHost } from './component-runtime-host.js'
import { UiverseRuntimeHost } from './uiverse/runtime-host.js'
import { registerUiverseRuntimeComponents } from './uiverse/runtime-executable.js'
import { createTuffUiCatalog } from './tuffui/catalog.js'
import { validateTuffUiTypeSchemaManifest } from './tuffui/type-schema.js'
import { registerTuffUiComponents } from './tuffui/executable-components.js'
import { executableComponentContract } from './adaptive-ui/component-catalog.js'
import { getDilLibraryComponentInputSchema } from './dil/library-contracts.js'
import { registerCanvasComponents, getCanvasComponentInputContract } from './adaptive-ui/canvas-component-bindings.js'
import { installCanvasExtendedLiquidFrameHost } from './canvas-extended-liquid-host.js'

export { UiComponentsControl } from './uiverse/host.js'
export { ResearchControl } from './research-host.js'
export type { ResearchAnalysis, ResearchState, ResearchApi } from './research-contracts.js'
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
const presentationInput = schema.union([
  schema.strictObject({ protocol: schema.literal('content'), label: schema.string().min(1).max(300), payload: schema.json() }),
  schema.strictObject({ protocol: schema.literal('openui'), label: schema.string().min(1).max(300), payload: schema.json() }),
  schema.strictObject({ protocol: schema.literal(DIL_PROTOCOL), label: schema.string().min(1).max(300), payload: dilSourceSchema }),
])
const catalogInput = schema.strictObject({ format: schema.enum(['openui', DIL_PROTOCOL]).optional(), componentId: schema.string().min(1).max(160).optional() })

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
  if (ctx.tools.get(CANVAS_DEVELOPMENT_TOOL)) throw new Error('CANVAS_TOOL_REGISTRATION_CONFLICT: Canvas UI discovery tool is already registered.')
  await installUiverse(ctx, fileURLToPath(new URL('./uiverse/assets/', import.meta.url)))
  installCanvasDevelopment(ctx)
  // The connection service is optional in non-Web Hosts; let Cordis own this
  // route only while the service and this plugin are both present.
  ctx.inject(['connection'], connectionContext => { installCanvasRuntimeHost(connectionContext); connectionContext.effect(()=>installCanvasExtendedLiquidFrameHost(connectionContext),'intelligent-experience: isolated Liquid frame') })
  const root = join(resolveDshHome(), 'solar', 'intelligent-experience-platform')
  installResearch(ctx, root)
  const store = new ExperienceStore(root, config)
  let current = await store.settings()
  const mcp = new McpHost(ctx, {endpoint: config.mcpEndpoint, root, settings: () => current})
  const componentAssets = fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../resources/components/':'./components/',import.meta.url))
  const components = new ComponentRuntimeHost({assetRoots:{rune:join(componentAssets,'rune'),tuffui:join(componentAssets,'tuffui')}})
  ctx.effect(()=>()=>components.close(),'intelligent-experience: fixed component assets')
  const executableComponents = createSourceBlockComponentRegistry()
  ctx.effect(()=>registerCanvasComponents(executableComponents),'intelligent-experience: source-bound Canvas components')
  const uiverseAssets=fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../resources/uiverse/':'./uiverse/assets/',import.meta.url))
  const uiverseRuntime=await UiverseRuntimeHost.open(uiverseAssets)
  ctx.effect(()=>registerUiverseRuntimeComponents(executableComponents,uiverseRuntime.registry),'intelligent-experience: source-bound Uiverse components')
  const [tuffSource,tuffTypes]=await Promise.all([components.getCatalog('tuffui'),components.getTypeSchemas('tuffui')])
  const tuffCatalog=createTuffUiCatalog(tuffSource),tuffTypeSchemas=validateTuffUiTypeSchemaManifest(tuffTypes)
  ctx.effect(()=>registerTuffUiComponents(executableComponents,tuffCatalog,{typeSchemas:tuffTypeSchemas}),'intelligent-experience: source-bound TuffUI components')
  const decisions = PersistedDecisionStore.open(join(root, 'composition-decisions.json'), { warn: message => ctx.logger('solar-experience').warn('%s', message) })
  const adaptive = new AdaptiveCompositionCoordinator({getSettings:()=>store.settings(),maxSourceBytes:config.maxArtifactBytes,getExecutableComponents:()=>executableComponents,decisions})
  ctx.effect(()=>()=>adaptive.dispose(), 'intelligent-experience: adaptive decisions')
  // Jev is an optional peer; no UI dependency starts or enables its other consumers.
  ctx.inject(['jev' as never], child => child.effect(()=>adaptive.attachJev(child.get('jev' as never) as unknown as JevCompositionPort),'intelligent-experience: Jev composition consumer'))
  const dil = installDilHost(ctx, { store, maxArtifactBytes: config.maxArtifactBytes, settings: () => store.settings() })
  const control = new ExperienceControl(ctx, store, mcp, adaptive, dil, components, uiverseRuntime)
  if (current.takeover && current.mcpApps && config.mcpEndpoint) void control.activateMcp()
  ctx.effect(() => store.subscribe(settings => { current = settings; if (!settings.takeover || !settings.mcpApps) void mcp.closeAll().catch(error => ctx.logger('solar-experience').warn('%s', error)) }))
  ctx.effect(() => () => mcp.dispose())
  installDilAuthoringPrompt(ctx, () => current)
  for (const [id, protocol] of [['openui', 'openui'], ['content', 'content'], [LOCAL_IMPORT_PROVIDER, 'content'], ['mcp-app', 'mcp-app']] as const) {
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
    if (!exec.agent || exec.name === 'solar_present' || exec.name === 'solar_ui_catalog' || exec.name === RESEARCH_TOOL || exec.name === CANVAS_DEVELOPMENT_TOOL || (UI_TOOL_NAMES as readonly string[]).includes(exec.name)) return
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
    name: 'solar_present', description: '保存并在当前会话呈现内容页面。protocol=content 接收普通文本或结构化 JSON；protocol=openui 接收 OpenUI Lang 文本；protocol=dil 仅接收 DIL 源码文本，由 Host 编译并保留原文。不调用额外模型。',
    // Zod carries a non-enumerable ~standard helper on its schema object.
    // The DSH boundary accepts only the JSON document, never helper functions.
    parameters: JSON.parse(JSON.stringify(schema.toJSONSchema(presentationInput))),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: `已保存内容页面：${artifactSchema.parse(value).source.label}` }],
      presentationMeta: (_args, value) => { const a = artifactSchema.parse(value); return { type: 'solar-experience', artifactId: a.id, protocol: a.protocol, payload: a.payload, label: a.source.label } },
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('EXPERIENCE_SESSION_REQUIRED: 内容页面需要当前会话。')
      exec.signal.throwIfAborted()
      const value = presentationInput.parse(args)
      const source = { sessionId: String(exec.agent.id), callId: String(exec.callId), kind: 'generated' as const, label: value.label }
      if (value.protocol === DIL_PROTOCOL) return dil.publish({ source, sourceText: value.payload })
      if (value.protocol === 'openui' && typeof value.payload !== 'string') throw new Error('EXPERIENCE_OPENUI_TEXT_REQUIRED: OpenUI 内容必须是语言文本。')
      return store.publish({ source, protocol: value.protocol, raw: value.payload, payload: value.payload, providerId: value.protocol === 'openui' ? 'openui' : 'content' })
    },
  })
  ctx.tools.register({ name: 'solar_ui_catalog', description: '读取智能 UI 的完整能力目录。默认返回 OpenUI 语法；format=dil 返回 DIL 指南和全部已注册可执行组件。componentId 返回该组件的精确参数、来源要求和本地事件约定；先查契约再绑定真实内容。', parameters: JSON.parse(JSON.stringify(schema.toJSONSchema(catalogInput))),
    output: {schema: {type: 'object', properties: {prompt: {type: 'string'},capabilities:{type:'object',additionalProperties:true}}, required: ['prompt','capabilities']}, render: (_args, value) => [{type: 'text', text: (value as {prompt: string}).prompt+'\n\nAvailable intelligent UI capabilities (availability is explicit):\n'+JSON.stringify((value as {capabilities:unknown}).capabilities)}]},
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const input = catalogInput.parse(args === undefined ? {} : args)
      if (input.componentId) return { prompt: 'Use this exact registered component ID and its source-bound input contract. Do not invent demo content or Host action authority.', capabilities: { component: executableComponentContract(input.componentId,{registry:executableComponents,tuffui:tuffCatalog,tuffuiTypes:tuffTypeSchemas,uiverse:uiverseRuntime.registry,libraryContract:getDilLibraryComponentInputSchema,canvasContract:getCanvasComponentInputContract}) } }
      if (input.format === DIL_PROTOCOL) return { prompt: dilAuthoringGuide, capabilities: { protocol: DIL_PROTOCOL, guide: JSON.parse(dilAuthoringGuide), themes: getCompositionCatalog([...builtInThemes,...(current.theme?.installed??[])]).entries.filter(entry=>entry.kind==='theme'), executables: await adaptive.executableCatalog(), contractLookup: 'Call solar_ui_catalog with componentId to inspect exact input and event contracts. External library tags use <component id={exactId} input={sourceBoundJson} onChange={localHandler} />. No author demos or invented facts.' } }
      const {openuiLibrary, openuiPromptOptions} = await import('@openuidev/react-ui/genui-lib')
      const settings=await store.settings()
      return {prompt: openuiLibrary.prompt(openuiPromptOptions),capabilities:getCompositionCatalog([...builtInThemes,...(settings.theme?.installed??[])],{executables:await adaptive.executableCatalog()})}
    },
  })
}
