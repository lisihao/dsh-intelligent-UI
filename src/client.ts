import { ThemeButton, ThemeInput, ThemeToggle, ThemeLoader } from './theme-components.js'
import { installBuiltInVisualEffects, visualEffectSchema } from './effects.js'
import { createElement as h, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActionEvent } from '@openuidev/react-lang'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExperienceApi, ExperienceSettings, SaveSettingsInput, WidgetStateApi, ThemeApi } from './contracts.js'
import { resolveTheme, type ThemePackage } from './theme-contracts.js'
import { type ThemeCatalog, type DownloadThemeInput } from './theme-source.js'
import { TransparencyControl } from './transparency-control.js'
import { ThemeSettings } from './theme-settings.js'
import { RPC_REMOTE } from './remote.js'
import { ArtifactView, ContentView, DisplayModeControl, OutputView, displayModes, rawText, openUiWidgets, experienceTheme, type OpenUiWidgets, type McpUiApi } from './presentation.js'
import { installExperienceStyles, styles } from './style.js'
import { installAppearanceStyles } from './appearance-style.js'
import { defaultAppearance, appearanceSchema, saveSettingsSchema } from './contracts.js'

declare module '@deepseek-ai/cordis' { interface Context { solarExperienceUi: OpenUiWidgets } }
declare module '@deepseek-ai/dsh-api-session-controller/client' { interface SessionReferenceSourceMap { solarExperienceUi: unknown } }

export const name = 'intelligent-experience-platform'
export const inject = ['slots', 'remote', 'connection', 'sessions', 'theme']
type McpStatus = { configured: boolean, enabled: boolean, connected: boolean, instances: number, error?: string }
type ClientApi = ExperienceApi & Partial<ThemeApi> & Partial<WidgetStateApi> & Partial<McpUiApi> & { mcpStatus?: () => Promise<McpStatus> }
type Wire = { [K in keyof ExperienceApi]: (...args: Parameters<ExperienceApi[K]>) => Promise<RemoteResult<Awaited<ReturnType<ExperienceApi[K]>>>> } & { [K in keyof ThemeApi]?: (...args: Parameters<ThemeApi[K]>) => Promise<RemoteResult<Awaited<ReturnType<ThemeApi[K]>>>> } & { [K in keyof WidgetStateApi]?: (...args: Parameters<WidgetStateApi[K]>) => Promise<RemoteResult<Awaited<ReturnType<WidgetStateApi[K]>>>> } & { mcpStatus?: () => Promise<RemoteResult<unknown>> } & { [K in keyof McpUiApi]?: (...args: Parameters<McpUiApi[K]>) => Promise<RemoteResult<unknown>> }
const message = (e: unknown): string => e instanceof Error ? e.message : String(e)
function unwrap<T>(result: RemoteResult<T>): T { if (result.ok) return result.value; throw result.error }
export function apiFromWire(w: Wire): ClientApi { return { settings: async () => unwrap(await w.settings()), saveSettings: async input => unwrap(await w.saveSettings(saveSettingsSchema.parse(JSON.parse(JSON.stringify(input))))), artifacts: async input => unwrap(await w.artifacts(input)), publish: async input => unwrap(await w.publish(input)), ...(w.themeCatalog ? { themeCatalog: async () => unwrap(await w.themeCatalog!()) } : {}), ...(w.downloadTheme ? { downloadTheme: async input => unwrap(await w.downloadTheme!(input)) } : {}), ...(w.installTheme ? { installTheme: async input => unwrap(await w.installTheme!(input)) } : {}), ...(w.removeTheme ? { removeTheme: async input => unwrap(await w.removeTheme!(input)) } : {}), ...(w.mcpStatus ? { mcpStatus: async () => mcpStatusSchema.parse(unwrap(await w.mcpStatus!())) } : {}), ...(w.widgetState && w.saveWidgetState ? { widgetState: async input => unwrap(await w.widgetState!(input)), saveWidgetState: async input => unwrap(await w.saveWidgetState!(input)) } : {}), ...(w.mcpOpen && w.mcpAction && w.mcpClose ? { mcpOpen: async input => openSchema.parse(unwrap(await w.mcpOpen!(input))), mcpAction: async input => resultSchema.parse(unwrap(await w.mcpAction!(input))), mcpClose: async input => z.null().parse(unwrap(await w.mcpClose!(input))) } : {}) } }
const resultSchema = z.object({ content: z.array(z.record(z.string(), z.unknown())), isError: z.boolean().optional() }).passthrough().transform(value => value as CallToolResult)
const mcpStatusSchema = z.object({ configured: z.boolean(), enabled: z.boolean(), connected: z.boolean(), instances: z.number().int().nonnegative(), error: z.string().optional() })
const openSchema = z.object({ instanceId: z.uuid(), proxyUrl: z.url(), html: z.string(), input: z.record(z.string(), z.unknown()), result: resultSchema })
function mcpApi(api?: ClientApi): McpUiApi | undefined { return api?.mcpOpen && api.mcpAction && api.mcpClose ? api as McpUiApi : undefined }
function stateApi(api?: ClientApi): WidgetStateApi | undefined { return api?.widgetState && api.saveWidgetState ? api as WidgetStateApi : undefined }

export class ExperienceStore {
  private value: { api?: ClientApi, settings?: ExperienceSettings, error?: string, takeoverError?: string, appearancePreview?: ReturnType<typeof defaultAppearance> } = {}
  private listeners = new Set<() => void>()
  private generation = 0
  private previewOwner?: object
  previewAppearance(owner: object, appearance?: ReturnType<typeof defaultAppearance>) {
    if (!appearance && this.previewOwner !== owner) return
    this.previewOwner = appearance ? owner : undefined
    if (this.value.appearancePreview !== appearance) this.update({ ...this.value, appearancePreview: appearance })
  }
  snapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  update(value: typeof this.value) { this.value = value; this.listeners.forEach(listener => listener()) }
  setTakeoverError(error?: string) { if (this.value.takeoverError !== error) this.update({ ...this.value, takeoverError: error }) }
  async refresh() { const api = this.value.api; if (!api) return; const generation = this.generation; try { const settings = await api.settings(); if (this.value.api === api && generation === this.generation) this.update({ ...this.value, api, settings }) } catch (e) { if (this.value.api === api) this.update({ ...this.value, error: message(e) }) } }
  async save(input: SaveSettingsInput) { this.generation++; const api = this.value.api; if (!api) throw new Error('设置服务不可用'); const settings = await api.saveSettings(input); if (this.value.api === api) this.update({ ...this.value, api, settings }); return settings }
  async installTheme(theme: ThemePackage) { this.generation++; const { api, settings: current } = this.value; if (!api?.installTheme || !current) throw new Error('主题管理服务不可用，请重新加载插件。'); const settings = await api.installTheme({ expectedRevision: current.revision, theme }); if (this.value.api === api) this.update({ ...this.value, api, settings }); return settings }
  async themeCatalog(): Promise<ThemeCatalog> { const api = this.value.api; if (!api?.themeCatalog) throw new Error('主题来源服务不可用，请重新加载插件。'); return api.themeCatalog() }
  async downloadTheme(input: Omit<DownloadThemeInput, 'expectedRevision'>) { this.generation++; const { api, settings: current } = this.value; if (!api?.downloadTheme || !current) throw new Error('主题来源服务不可用，请重新加载插件。'); const settings = await api.downloadTheme({ ...input, expectedRevision: current.revision }); if (this.value.api === api) this.update({ ...this.value, api, settings }); return settings }
  async removeTheme(id: string) { this.generation++; const { api, settings: current } = this.value; if (!api?.removeTheme || !current) throw new Error('主题管理服务不可用，请重新加载插件。'); const settings = await api.removeTheme({ expectedRevision: current.revision, id }); if (this.value.api === api) this.update({ ...this.value, api, settings }); return settings }
}
function useStore(store: ExperienceStore) { return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot) }
/** One global appearance shortcut beside the existing conversation display control. */
export function HeaderControls({ store, sessionId }: { store: ExperienceStore, sessionId: string }): ReactElement {
  return h('div', { className: 'dsh-experience iexp-header-controls' }, h(DisplayModeControl, { sessionId }), h(TransparencyControl, { store }))
}
export function Settings({ store }: { store: ExperienceStore }): ReactElement {
  const { api, settings, error, takeoverError } = useStore(store)
  const [mcpStatus, setMcpStatus] = useState<McpStatus>()
  const [mcpStatusError, setMcpStatusError] = useState('')
  useEffect(() => { let live = true; setMcpStatus(undefined); setMcpStatusError(''); if (!settings?.mcpApps || !api?.mcpStatus) return; const refresh = () => { void api.mcpStatus!().then(value => { if (live) { setMcpStatus(value); setMcpStatusError('') } }, e => { if (live) setMcpStatusError(message(e)) }) }; refresh(); const timer = setInterval(refresh, 5000); return () => { live = false; clearInterval(timer) } }, [api, settings?.mcpApps])
  const [color, setColor] = useState(settings?.appearance?.backgroundColor ?? defaultAppearance().backgroundColor)
  useEffect(() => setColor(settings?.appearance?.backgroundColor ?? defaultAppearance().backgroundColor), [settings?.appearance?.backgroundColor])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function change(key: 'takeover' | 'openui' | 'mcpApps' | 'appearance', checked: boolean | ReturnType<typeof defaultAppearance>) {
    if (!settings || busy) return
    setBusy(true); setFailure('')
    try { await store.save({ expectedRevision: settings.revision, takeover: settings.takeover, openui: settings.openui, mcpApps: settings.mcpApps, appearance: settings.appearance ?? defaultAppearance(), [key]: checked }) } catch (e) { setFailure(message(e)); await store.refresh() } finally { setBusy(false) }
  }
  async function themeOperation(operation: () => Promise<unknown>) {
    if (!settings || busy) throw new Error('设置尚未就绪，请稍后重试。')
    setBusy(true); setFailure('')
    try { await operation() } catch (error) { await store.refresh(); throw error } finally { setBusy(false) }
  }
  async function selectTheme(theme: ThemePackage) {
    await themeOperation(() => store.save({ expectedRevision: settings!.revision, takeover: settings!.takeover, openui: settings!.openui, mcpApps: settings!.mcpApps, themeId: theme.id, appearance: theme.appearance }))
  }
  return h('div', { className: 'dsh-experience iexp-settings', style: { backgroundColor: (settings?.appearance ?? defaultAppearance()).backgroundColor, '--iexp-settings-ground': (settings?.appearance ?? defaultAppearance()).backgroundColor } as CSSProperties }, h('h2', null, '智能体验'), h('p', { className: 'iexp-setting-help' }, '统一助手、工具输出与兼容标签页的外观。关闭接管后恢复原来的显示。'), error && h('p', { role: 'alert' }, `设置服务不可用：${error}`), failure && h('p', { role: 'alert' }, `保存失败：${failure}`), takeoverError && h('p', { role: 'alert' }, `聊天接管不可用：${takeoverError} 请关闭接管，并检查其他聊天显示插件。`), ...([['takeover', '接管输出与兼容页面外观'], ['openui', '启用 OpenUI 展示'], ['mcpApps', '启用 MCP Apps（需要已配置的隔离宿主）']] as const).map(([key, label]) => h('label', { key, className: 'iexp-toggle-row' }, h(ThemeToggle, { checked: settings?.[key] ?? false, disabled: !settings || busy, onChange: (e: { currentTarget: HTMLInputElement }) => { void change(key, e.currentTarget.checked) } }), ` ${label}`)), h(ThemeSettings, { settings, busy, onCatalog: () => store.themeCatalog(), onDownload: (source, id) => themeOperation(() => store.downloadTheme({ source, id })), onSaveSource: source => themeOperation(() => store.save({ expectedRevision: settings!.revision, takeover: settings!.takeover, openui: settings!.openui, mcpApps: settings!.mcpApps, themeSource: source })), onSelect: selectTheme, onInstall: theme => themeOperation(() => store.installTheme(theme)), onRemove: id => themeOperation(() => store.removeTheme(id)) }), h('fieldset', { className: 'iexp-appearance-controls', disabled: !settings || busy }, h('legend', null, '内容外观'),
    h('label', { className: 'iexp-toggle-row' }, h(ThemeToggle, { checked: (settings?.appearance ?? defaultAppearance()).translucent, onChange: (event: { currentTarget: HTMLInputElement }) => { void change('appearance', { ...(settings?.appearance ?? defaultAppearance()), translucent: event.currentTarget.checked }) } }), ' 半透明背景'),
    h('form', { className: 'iexp-appearance-color', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); const next = appearanceSchema.safeParse({ ...(settings?.appearance ?? defaultAppearance()), backgroundColor: color }); if (!next.success) { setFailure('请输入 #RRGGBB 格式的背景颜色。'); return }; void change('appearance', next.data) } },
      h('label', { htmlFor: 'iexp-background-color' }, '背景颜色'), h('input', { className: 'iexp-control', type: 'color', id: 'iexp-background-color', 'aria-label': '背景颜色选择器', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#24262b', onChange: (event: { currentTarget: HTMLInputElement }) => setColor(event.currentTarget.value) }),
      h(ThemeInput, { className: 'iexp-control', type: 'text', 'aria-label': '背景颜色值', value: color, spellCheck: false, maxLength: 7, onChange: (event: { currentTarget: HTMLInputElement }) => setColor(event.currentTarget.value) }), h(ThemeButton, { type: 'submit', className: 'iexp-control' }, '应用颜色')),
    h(ThemeButton, { type: 'button', className: 'iexp-control', onClick: () => { const appearance = resolveTheme(settings?.theme).appearance; setColor(appearance.backgroundColor); void change('appearance', appearance) } }, '恢复默认外观')), settings?.mcpApps && api?.mcpStatus && h('p', { role: mcpStatusError || mcpStatus?.error ? 'alert' : 'status' }, mcpStatusError ? `MCP Apps 状态不可用：${mcpStatusError}` : !mcpStatus ? '正在读取 MCP Apps 状态…' : mcpStatus.error ? `MCP Apps 连接失败：${mcpStatus.error}` : !mcpStatus.configured ? '尚未配置 MCP Apps 服务地址。' : !mcpStatus.connected ? '正在连接 MCP Apps 服务…' : 'MCP Apps 已连接。'), !settings && !error && h(ThemeLoader, { label: '正在读取设置…' }))
}
export async function continueInSession(ctx: {sessions: ISessions}, sessionId: SessionId, event: ActionEvent, state: Record<string, unknown>, signal: AbortSignal): Promise<void> {
  if (event.type !== 'continue_conversation') throw new Error('不支持此交互类型')
  const text = `用户在生成界面中选择了操作。\n${JSON.stringify({ action: event, state })}`
  await ctx.sessions.using(sessionId, { source: 'solarExperienceUi', signal }, async reference => {
    const binding = await reference.ready
    if (signal.aborted) throw new Error('操作已取消')
    const session = binding.session
    const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] })
    try { const result = await session.prompt([{ type: 'text', text }], 'queue', signal, submission.requestId); if (!result.ok) throw result.error }
    catch (error) { submission.abandon(); throw error }
  })
}
type Continue = (event: ActionEvent, state: Record<string, unknown>, signal: AbortSignal) => Promise<void>
/** Recognize only a whole explicit OpenUI fence, including an unfinished streaming fence. */
export function openUiFence(text: string, streaming: boolean): string | undefined {
  const match = /^\s*```openui(?:-lang)?\s*\n([\s\S]*?)(?:\n```\s*)?$/.exec(text)
  if (!match || (!streaming && !/\n```\s*$/.test(text))) return undefined
  return match[1]
}
function ImageBlock({ attachment, loadImage }: { attachment: unknown, loadImage: (value: never) => Promise<string> }): ReactElement {
  const [url, setUrl] = useState(''); const [error, setError] = useState('')
  useEffect(() => { let live = true; void loadImage(attachment as never).then(x => { if (live) setUrl(x) }, e => { if (live) setError(message(e)) }); return () => { live = false } }, [attachment, loadImage])
  return error ? h('p', { role: 'alert' }, `图片加载失败：${error}`) : url ? h('img', { src: url, alt: '助手输出的图片', style: { maxWidth: '100%' } }) : h('span', null, '正在加载图片…')
}
function AssistantNode({ nodeProps: props, store, onContinue }: { nodeProps: PropsRuntime<'conversation.chat.node', 'assistant-step'>, store: ExperienceStore, onContinue: Continue }): ReactElement {
  const { node, loadImage } = props
  const { settings } = useStore(store)
  return h('section', { className: 'dsh-experience', style: styles.section }, h(OutputView, { sessionId: String(props.sessionId), raw: node.data }, node.data.status === 'interrupted' && h('p', null, '已停止'), ...node.data.blocks.map((block, i) => block.kind === 'image' ? h(ImageBlock, { key: i, attachment: block.attachment, loadImage }) : block.kind === 'reasoning' ? h('details', { key: i }, h('summary', null, '思考过程'), h(ContentView, { value: block.text })) : block.kind === 'text' ? (() => { const code = openUiFence(block.text, node.data.status === 'running'); return code !== undefined && settings?.openui ? h(ArtifactView, { key: i, artifact: { formatVersion: 1, id: `stream-${i}`, createdAt: '', source: { sessionId: String(props.sessionId), kind: 'assistant', label: '助手生成的界面' }, protocol: 'openui', raw: block.text, payload: code, providerId: 'openui' }, isStreaming: node.data.status === 'running', displayMode: 'visual', onContinue }) : h(ContentView, { key: i, value: block.text, isStreaming: node.data.status === 'running' }) })() : h('details', { key: i }, h('summary', null, block.kind === 'tool-call' ? `工具调用：${block.name}` : '其他内容'), h('pre', { style: styles.raw }, rawText(block))))))
}
type Tool = { meta?: unknown; name: string; callId: string; kind?: string; phase?: string; content?: unknown; isError?: boolean; error?: unknown; call?: unknown; argsRaw?: string; subCalls: readonly Tool[] }
function McpInline({ api, sessionId, callId, enabled, onContinue }: { api?: ClientApi, sessionId: string, callId: string, enabled: boolean, onContinue?: Continue }): ReactElement | null {
  const [artifact, setArtifact] = useState<Awaited<ReturnType<ExperienceApi['artifacts']>>[number]>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true; let tries = 0; let timer: ReturnType<typeof setTimeout> | undefined
    setArtifact(undefined); setError('')
    if (!enabled || !api) return
    const poll = async () => { try {
      const items = await api.artifacts({ sessionId }); if (!active) return
      const match = items.find(item => item.protocol === 'mcp-app' && item.source.callId === callId)
      if (match) setArtifact(match); else if (++tries < 10) timer = setTimeout(() => { void poll() }, 1000)
    } catch (e) { if (active) setError(message(e)) } }
    void poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [api, sessionId, callId, enabled])
  return error ? h('p', { role: 'alert' }, `无法读取 MCP App 内容：${error}`) : artifact ? h(ArtifactView, { artifact, displayMode: 'visual', mcpApi: mcpApi(api), onContinue }) : null
}
function ToolTree({ tool, inspect, openuiEnabled, onContinue, sessionId, widgetStateApi, api, mcpEnabled }: { tool: Tool, inspect?: (id: never) => void, openuiEnabled?: boolean, onContinue?: Continue, sessionId: string, widgetStateApi?: WidgetStateApi, api?: ClientApi, mcpEnabled?: boolean }): ReactElement {
  const meta = tool.meta && typeof tool.meta === 'object' ? tool.meta as Record<string, unknown> : undefined
  const parsedEffect = visualEffectSchema.safeParse(meta?.effectId)
  const artifact = meta?.type === 'solar-experience' && (meta.protocol === 'content' || meta.protocol === 'openui') && typeof meta.label === 'string' && typeof meta.artifactId === 'string' ? { formatVersion: 1 as const, id: meta.artifactId, createdAt: '', source: { sessionId, kind: 'generated' as const, label: meta.label }, protocol: meta.protocol, payload: meta.payload, raw: meta.payload, providerId: 'solar-present', ...(parsedEffect.success ? { effectId: parsedEffect.data } : {}) } : undefined
  return h('details', { open: true, className: 'dsh-experience', style: styles.section }, h('summary', null, `${tool.name || '工具调用'} · ${tool.isError ? '失败' : tool.kind === 'tool-result' ? '已完成' : '执行中'}`), tool.isError && h('pre', { role: 'alert', style: styles.raw }, rawText(tool.error)), artifact ? h(ArtifactView, { artifact: artifact as Parameters<typeof ArtifactView>[0]['artifact'], displayMode: 'visual', openuiEnabled, onContinue, stateApi: widgetStateApi }) : tool.content !== undefined && h(ContentView, { value: tool.content }), tool.kind === 'tool-result' && h(McpInline, { api, sessionId, callId: tool.callId, enabled: !!mcpEnabled, onContinue }), inspect && h(ThemeButton, { type: 'button', style: styles.button, onClick: () => inspect(tool.callId as never) }, '查看调用详情'), h('details', null, h('summary', null, '原始调用与结果'), h('pre', { style: styles.raw }, rawText(tool))), ...tool.subCalls.map((child, i) => h(ToolTree, { key: i, tool: child, inspect, openuiEnabled, onContinue, sessionId, widgetStateApi, api, mcpEnabled })))
}
function ToolNode({ store, nodeProps, onContinue }: { store: ExperienceStore, onContinue: Continue, nodeProps: PropsRuntime<'conversation.chat.node', 'tool-call'> }): ReactElement { const { settings, api } = useStore(store); return h(OutputView, { sessionId: String(nodeProps.sessionId), raw: nodeProps.node.data.root }, h(ToolTree, { tool: nodeProps.node.data.root as Tool, inspect: nodeProps.inspectCall, openuiEnabled: settings?.openui, onContinue, sessionId: String(nodeProps.sessionId), widgetStateApi: stateApi(api), api, mcpEnabled: settings?.mcpApps })) }
export function Workspace({ store, sessionId, onContinue }: { store: ExperienceStore, sessionId: string, onContinue?: Continue }): ReactElement {
  const { api, settings } = useStore(store); const [items, setItems] = useState<Awaited<ReturnType<ExperienceApi['artifacts']>>>([]); const [error, setError] = useState('')
  useEffect(() => { let live = true; setItems([]); setError(''); const refresh = () => { if (api) void api.artifacts({ sessionId }).then(x => { if (live) { setItems(x); setError('') } }, e => { if (live) setError(message(e)) }) }; refresh(); const timer = setInterval(refresh, 5000); return () => { live = false; clearInterval(timer) } }, [api, sessionId])
  return h('div', { className: 'dsh-experience', style: styles.panel }, h('h2', null, '生成内容'), error && h('p', { role: 'alert' }, `无法读取内容：${error}`), !error && items.length === 0 && h('p', null, '当前会话还没有保存的生成内容。'), ...items.map(item => h(ArtifactView, { key: item.id, artifact: item, openuiEnabled: settings?.openui, onContinue, stateApi: stateApi(api), mcpApi: settings?.mcpApps ? mcpApi(api) : undefined })))
}
export function apply(ctx: Context): void {
  // Host and browser both contribute Context.sessions in the shared type graph.
  // This entry is browser-only and consumes the published client service face.
  const sessionContext = {sessions: ctx.get('sessions') as unknown as ISessions}
  ctx.effect(() => {
    type ThemeSnapshot = { active: { colorScheme: 'light' | 'dark' } }
    const runtime = ctx.get('theme') as { getTheme(): ThemeSnapshot }
    experienceTheme.set(runtime.getTheme().active.colorScheme)
    const onChange = ctx.on.bind(ctx) as unknown as (event: string, listener: (snapshot: ThemeSnapshot) => void) => () => void
    return onChange('theme/change', snapshot => experienceTheme.set(snapshot.active.colorScheme))
  }, 'intelligent-experience: theme')
  ctx.effect(() => () => displayModes.clear(), 'intelligent-experience: display modes')
  ctx.effect(() => installExperienceStyles(), 'intelligent-experience: styles')
  ctx.effect(() => installBuiltInVisualEffects(), 'intelligent-experience: effects')
  ctx.effect(() => ctx.provide('solarExperienceUi', openUiWidgets), 'intelligent-experience: widgets')
  const store = new ExperienceStore()
  ctx.effect(() => installAppearanceStyles(store), 'intelligent-experience: appearance')
  let disposed = false; let remoteDispose: (() => Promise<void>) | undefined
  let injectionDispose: (() => void) | undefined
  let registrationDisposers: Array<() => void> = []
  let failed = false; let syncing = false
  const assistantView = (props: PropsRuntime<'conversation.chat.node', 'assistant-step'>) => h(AssistantNode, { store, nodeProps: props, onContinue: (event, state, signal) => continueInSession(sessionContext, props.sessionId, event, state, signal) })
  const toolView = (props: PropsRuntime<'conversation.chat.node', 'tool-call'>) => h(ToolNode, { store, nodeProps: props, onContinue: (event, state, signal) => continueInSession(sessionContext, props.sessionId, event, state, signal) })
  const retract = () => { const owned = registrationDisposers; registrationDisposers = []; for (const dispose of owned.reverse()) dispose() }
  const fail = (error: unknown) => { failed = true; retract(); console.warn('智能体验聊天接管失败：', error); store.setTakeoverError('聊天显示位置发生冲突或尚未就绪。') }
  const checkWinners = () => {
    if (!registrationDisposers.length || failed) return
    const winners = ctx.slots.entriesOfSlot('conversation.chat.node')
    if (winners.find(entry => entry.options.key === 'assistant-step')?.component !== assistantView || winners.find(entry => entry.options.key === 'tool-call')?.component !== toolView) fail('其他插件占用了聊天显示位置')
  }
  const syncTakeover = () => {
    if (syncing) return
    syncing = true
    try {
      if (!store.snapshot().settings?.takeover) {
        injectionDispose?.(); injectionDispose = undefined; retract(); failed = false; store.setTakeoverError(undefined); return
      }
      if (injectionDispose || failed) return
      try {
        injectionDispose = ctx.slots.inject('conversation.chat.node', () => {
          if (failed) return () => {}
          const owned: Array<() => void> = []
          try {
            owned.push(ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: -100 }, assistantView))
            owned.push(ctx.slots.register({ name: 'conversation.chat.node', key: 'tool-call', priority: -100 }, toolView))
            registrationDisposers = owned
            checkWinners()
          } catch (error) {
            for (const dispose of owned.reverse()) dispose()
            registrationDisposers = []
            fail(error)
          }
          return () => { for (const dispose of owned.reverse()) dispose(); if (registrationDisposers === owned) registrationDisposers = [] }
        })
      } catch (error) { fail(error) }
    } finally { syncing = false }
  }
  const unsubscribeSlots = ctx.slots.subscribe('conversation.chat.node', checkWinners)
  const unsubscribe = store.subscribe(syncTakeover)
  ctx.effect(() => {
    void ctx.remote.$mount(RPC_REMOTE).then(async dispose => { if (disposed) { await dispose(); return }; remoteDispose = dispose; const wire = ctx.get('remote.solarExperience') as unknown as Wire | undefined; if (!wire) { store.update({ error: '本机没有提供智能体验服务。' }); return }; store.update({ api: apiFromWire(wire) }); await store.refresh() }).catch(e => { if (!disposed) store.update({ error: message(e) }) })
    const timer = setInterval(() => { void store.refresh() }, 5000)
    return () => { disposed = true; clearInterval(timer); unsubscribe(); unsubscribeSlots(); injectionDispose?.(); retract(); store.update({}); if (remoteDispose) void remoteDispose() }
  }, 'intelligent-experience: remote')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'solar-intelligent-experience-mode', order: 47 }, (props: PropsRuntime<'conversation.session.header.utilities'>) => h(HeaderControls, { store, sessionId: String(props.sessionId) })))
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'solar-intelligent-experience', order: 47, label: () => '智能体验' }, () => h(Settings, { store })))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'solar-intelligent-experience', order: 47, label: () => '生成内容' }, (props: PropsRuntime<'conversation.view'>) => h(Workspace, { store, sessionId: String(props.sessionId), onContinue: (event, state, signal) => continueInSession(sessionContext, props.sessionId, event, state, signal) })))
}
