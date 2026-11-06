import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as JSXRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'

type RecordValue = Record<string, unknown>
type Target = { sessionId: string } | { parentSessionId: string, childSessionId: string, mode: 'one-shot' | 'continuable' | 'unknown' }
type Contribution = { id: string, factory(require: (id: string) => unknown): { CollaborationEntry?: React.ComponentType<RecordValue>, collaborationCss?: unknown } }

declare global {
  interface Window {
    __ModuleLoader__?: { load(value: Contribution): void }
    __collaborationBrowserFixture?: { evidence(): unknown, auditLayout(): unknown, auditScroll(): unknown }
  }
}

const query = new URLSearchParams(window.location.search)
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message) }
const wait = (milliseconds = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds))
async function flush(): Promise<void> { await wait(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); await wait() }
async function waitFor(selector: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const item = document.querySelector<HTMLElement>(selector)
    if (item) return item
    await wait(20)
  }
  throw new Error(`fixture did not render ${selector}`)
}
function need<T extends Element>(selector: string): T { const item = document.querySelector<T>(selector); assert(item, `missing ${selector}`); return item }
function includes(node: ParentNode, text: string): boolean { return node.textContent?.includes(text) === true }

class Store<T> {
  private readonly listeners = new Set<() => void>()
  constructor(private value: T) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = (): T => this.value
  set(value: T): void { if (Object.is(value, this.value)) return; this.value = value; for (const listener of this.listeners) listener() }
}

let contribution: Contribution | undefined
let Entry: React.ComponentType<RecordValue> | undefined
let passed = false
let finalLayout: ReturnType<typeof auditLayout> | undefined
const runtimeErrors: string[] = []
const documentRenders: Array<{ value: unknown, raw: unknown, mode: unknown }> = []
const opens: Target[] = []
let modelSubmissions = 0
const sessionId = new Store('session-A')
const session = new Store<RecordValue>({ openState: 'ready' })
const sessions = new Store<RecordValue>({ projectionsBySession: {} })
const statuses = new Store<unknown>(new Map())
const projections = new Store<RecordValue>({})
const connection = new Store<unknown>('connected')

window.addEventListener('error', event => runtimeErrors.push(`${event.message}${event.error instanceof Error ? ` (${event.error.message})` : ''}`))
window.addEventListener('unhandledrejection', event => runtimeErrors.push(`unhandled: ${String(event.reason)}`))
window.__ModuleLoader__ = { load(value: Contribution): void { assert(!contribution, 'built client registered more than one contribution'); contribution = value } }

const RESULT = ['# pstack 角色结果', '', '这是合成夹具保留的原始 Markdown。', '', '- value 与 raw 必须相同', '- 不会启动模型或重发任务', '', '```ts', "const source = 'pstack'", '```'].join('\n')
const LONG_RESULT = `${RESULT}\n\n${'用于验证面板独立滚动的长结果。'.repeat(8_000)}`

function SyntheticDocumentView(props: RecordValue): React.ReactElement {
  const raw = props.raw === undefined ? props.value : props.raw
  documentRenders.push({ value: props.value, raw, mode: props.mode })
  return React.createElement('article', { className: 'fixture-document', 'data-fixture-document': 'synthetic', 'data-value-raw-equal': String(props.value === raw) },
    React.createElement('p', null, 'Synthetic DocumentView：不解析 Markdown；仅验证 value/raw。'),
    React.createElement('pre', { style: { maxWidth: '100%', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, typeof raw === 'string' ? raw : JSON.stringify(raw)))
}

function team(subject: string, completed: boolean): RecordValue {
  return { members: [
    { id: 'lead', name: '协作负责人', role: 'lead', phase: 'active' },
    { id: 'worker', name: '验证成员', role: 'teammate', phase: completed ? 'active' : 'provisioning' },
  ], tasks: [
    { id: 'primary', revision: 1, subject, description: `${subject}说明。`, status: completed ? 'completed' : 'in_progress', blockedBy: [], writeScopes: [], ownerName: '协作负责人', ready: true, writeScopeWarnings: [] },
    { id: 'dependent', revision: 1, subject: '依赖检查', description: '验证依赖显示。', status: 'pending', blockedBy: ['primary'], writeScopes: [], ownerName: '验证成员', ready: false, writeScopeWarnings: [] },
  ] }
}

function catalog(): unknown[] {
  return [
    { id: 'child-one-shot', createdAt: 1, mode: 'one-shot' },
    { id: 'child-continuable', createdAt: 2, mode: 'continuable', label: '可继续角色子任务' },
    { id: 'child-generic', createdAt: 3, mode: 'continuable', label: '普通子会话' },
    { id: 'child-external', createdAt: 4, mode: 'external', label: '外部只读子会话' },
  ]
}

function pstack(result: string, state: 'running' | 'completed', includeHistory = false): RecordValue {
  return { formatVersion: 1, inheritedCount: 0, context: { availability: 'provided', name: 'solar-pstack-defaults', source: 'named-context' },
    currentTurn: { id: 'turn-current', status: state, calls: [{ id: 'role-current', kind: 'native-tool', name: 'pstack_spawn', invocation: 'called', status: state, role: 'independent-verifier', description: '核对协作会话的当前结果。', prompt: '仅报告已观察到的状态。', result: { isError: false, output: result, role: 'independent-verifier' }, child: { id: 'child-continuable', status: 'continuable' } }] },
    history: includeHistory ? [
      { id: 'turn-history-running', status: 'running', calls: [{ id: 'role-history-running', kind: 'ptc', name: 'pstack_spawn', invocation: 'called', status: 'running', role: 'poteto-agent', description: '历史仍在执行的角色任务。' }] },
      { id: 'turn-history-unknown', status: 'unknown', calls: [{ id: 'role-history-unknown', kind: 'native-tool', name: 'pstack_spawn', invocation: 'called', status: 'unknown', role: 'independent-verifier', description: '历史状态待确认的角色任务。' }] },
      { id: 'turn-history-completed', status: 'completed', calls: [{ id: 'role-history-completed', kind: 'native-tool', name: 'pstack_catalog', invocation: 'called', status: 'completed', description: '历史已完成的目录读取。', result: { isError: false, output: '历史目录读取结果。' } }] },
    ] : [], truncatedSettledTurnCount: 0 }
}

function listState(id: string, root: RecordValue): RecordValue {
  const byId = {
    lead: { running: true, title: '协作负责人' }, worker: { running: false, title: '验证成员' },
    'child-one-shot': { running: false }, 'child-continuable': { running: true, title: '可继续角色子任务' },
    'child-generic': { running: false, title: '普通子会话' }, 'child-external': { running: false, title: '外部只读子会话' },
  }
  return { phase: 'ready', ids: Object.keys(byId), byId, projectionsBySession: {
    [id]: { values: { agentTeam: root, subagentTiming: { lastTurnCompleted: false } } },
    'child-one-shot': { values: { subagentTiming: { lastTurnCompleted: true } } },
    'child-continuable': { values: { subagentTiming: { lastTurnCompleted: false } } },
    'child-generic': { values: { subagentTiming: { lastTurnCompleted: true } } },
    'child-external': { values: { subagentTiming: { lastTurnCompleted: true } } },
  } }
}

function configure(name: string, id = sessionId.getSnapshot()): void {
  const completed = ['completed', 'long', 'disconnected', 'session-a', 'session-b'].includes(name)
  const active = name === 'running'
  const root = team(name === 'session-b' ? '会话 B 的唯一共享任务' : '会话 A 的唯一共享任务', completed)
  session.set({ openState: 'ready' })
  statuses.set(new Map([
    ['lead', { running: active, pendingInteraction: undefined, completionUnread: false }],
    ['worker', { running: false, pendingInteraction: undefined, completionUnread: false }],
    ['child-one-shot', { running: false, pendingInteraction: undefined, completionUnread: false }],
    ['child-continuable', { running: active, pendingInteraction: undefined, completionUnread: false }],
    ['child-generic', { running: false, pendingInteraction: undefined, completionUnread: false }],
    ['child-external', { running: false, pendingInteraction: undefined, completionUnread: false }],
  ]))
  sessions.set(listState(id, root))
  connection.set(name === 'disconnected' ? 'disconnected' : 'connected')
  if (name === 'missing') { projections.set({}); return }
  if (name === 'empty') {
    projections.set({ agentTeam: { members: [], tasks: [] }, subagentCatalog: [], 'solar-pstack-status': { formatVersion: 1, inheritedCount: 0, context: { availability: 'unknown', name: 'solar-pstack-defaults', source: 'none' }, currentTurn: { id: 'empty', status: 'completed', calls: [] }, history: [], truncatedSettledTurnCount: 0 } })
    return
  }
  projections.set({ agentTeam: root, subagentCatalog: catalog(), 'solar-pstack-status': pstack(name === 'long' ? LONG_RESULT : RESULT, name === 'running' ? 'running' : 'completed', name === 'history') })
}

function useSession(selector: (value: RecordValue) => unknown): unknown { return React.useSyncExternalStore(session.subscribe, () => selector(session.getSnapshot()), () => selector(session.getSnapshot())) }
function useSessions(selector: (value: RecordValue) => unknown): unknown { return React.useSyncExternalStore(sessions.subscribe, () => selector(sessions.getSnapshot()), () => selector(sessions.getSnapshot())) }
function useSessionStatus(selector: (value: unknown) => unknown): unknown { return React.useSyncExternalStore(statuses.subscribe, () => selector(statuses.getSnapshot()), () => selector(statuses.getSnapshot())) }
function useProjection(key: string): unknown { return React.useSyncExternalStore(projections.subscribe, () => projections.getSnapshot()[key], () => projections.getSnapshot()[key]) }

function onOpen(value: unknown): void { assert(typeof value === 'object' && value !== null, 'onOpen received no target'); opens.push(JSON.parse(JSON.stringify(value)) as Target) }
function Header(): React.ReactElement {
  const id = React.useSyncExternalStore(sessionId.subscribe, sessionId.getSnapshot, sessionId.getSnapshot)
  assert(Entry, 'built CollaborationEntry did not initialize')
  return React.createElement(Entry, { key: id, sessionId: id, useSession, useSessions, useSessionStatus, useProjection, connectionState: { subscribe: connection.subscribe, getSnapshot: connection.getSnapshot }, DocumentView: SyntheticDocumentView, onOpen })
}
function App(): React.ReactElement {
  return React.createElement('main', { className: 'fixture-shell' }, [
    React.createElement('aside', { key: 'banner', className: 'fixture-banner', 'aria-label': '夹具说明' }, [React.createElement('h1', { key: 'title' }, '协作会话头部合成浏览器夹具'), React.createElement('span', { key: 'detail' }, '只加载已构建 client.cjs 的 CollaborationEntry；公开钩子和 DocumentView 是合成契约提供者，不读取真实 profile 或调用模型。')]),
    React.createElement('header', { key: 'header', className: 'fixture-header', 'aria-label': '会话头部操作' }, React.createElement(Header)),
    React.createElement('button', { key: 'outside', id: 'fixture-outside', type: 'button' }, '合成页面空白区域：用于验证面板外关闭。'),
    React.createElement('button', { key: 'floating', id: 'fixture-floating-control', type: 'button' }, '合成浮动控件：若面板不是 native popover top layer，它会遮挡面板。'),
  ])
}
function trigger(): HTMLButtonElement { return need<HTMLButtonElement>('.iexp-collab-trigger') }
async function openPanel(): Promise<HTMLElement> {
  if (!document.querySelector('.iexp-collab-panel')) trigger().click()
  const panel = await waitFor('.iexp-collab-panel')
  await flush()
  assert(panel.matches(':popover-open'), 'panel did not enter the native popover top layer')
  return panel
}
function openable(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll<HTMLButtonElement>('.iexp-collab-row--openable')].find(button => includes(button, label))
  assert(result, `missing openable row ${label}`)
  return result
}
function colorAlpha(value: string): number | undefined { const parts = value.match(/(?:\d+\.?\d*|\.\d+)/gu); return parts === null || parts.length < 3 ? undefined : parts.length >= 4 ? Number(parts[3]) : 1 }
function auditLayout(): { clientWidth: number, bodyScrollWidth: number, checked: number, offenders: string[] } {
  const width = document.documentElement.clientWidth
  const shell = document.querySelector<HTMLElement>('.fixture-shell')
  const panel = document.querySelector<HTMLElement>('.iexp-collab-panel')
  const nodes = [...(shell ? [shell, ...shell.querySelectorAll<HTMLElement>('*')] : []), ...(panel ? [panel, ...panel.querySelectorAll<HTMLElement>('*')] : [])]
  const offenders: string[] = []
  for (const node of nodes) {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect(), scrollable = ['auto', 'scroll'].includes(style.overflowX)
    if (style.display === 'none') continue
    if (!scrollable && rect.width > 0 && (rect.left < -0.5 || rect.right > width + 0.5)) offenders.push(`${node.tagName.toLowerCase()}.${node.className} rect=${rect.left.toFixed(1)}..${rect.right.toFixed(1)}/${width}`)
    if (!scrollable && node.scrollWidth > node.clientWidth + 1) offenders.push(`${node.tagName.toLowerCase()}.${node.className} scroll=${node.scrollWidth}/${node.clientWidth}`)
  }
  return { clientWidth: width, bodyScrollWidth: document.documentElement.scrollWidth, checked: nodes.length, offenders }
}
function auditScroll(): { independent: boolean, panel?: RecordValue, documentBefore: number, documentAfter: number } {
  const body = document.querySelector<HTMLElement>('.iexp-collab-body'), documentBefore = document.documentElement.scrollTop
  if (!body) return { independent: false, documentBefore, documentAfter: document.documentElement.scrollTop }
  const before = body.scrollTop
  body.scrollTop = Math.min(120, Math.max(0, body.scrollHeight - body.clientHeight))
  const style = getComputedStyle(body)
  return { independent: ['auto', 'scroll'].includes(style.overflowY) && body.scrollHeight > body.clientHeight && body.scrollTop > before && document.documentElement.scrollTop === documentBefore, panel: { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, before, after: body.scrollTop, overflowY: style.overflowY }, documentBefore, documentAfter: document.documentElement.scrollTop }
}
function evidence(): unknown {
  const panel = document.querySelector<HTMLElement>('.iexp-collab-panel'), inner = document.querySelector<HTMLElement>('.iexp-collab-root')
  const panelStyle = panel ? getComputedStyle(panel) : undefined, innerStyle = inner ? getComputedStyle(inner) : undefined, last = documentRenders.at(-1)
  return { contributionId: contribution?.id, builtExport: { name: Entry?.name, collaborationCssInstalled: !!document.head.querySelector('style[data-fixture-collaboration-css]') }, runtimeErrors: [...runtimeErrors], automation: { passed }, documentView: { actualRenderer: false, valueRawEqual: last?.value === last?.raw, renders: documentRenders.map(item => ({ ...item })) }, openCalls: { calls: [...opens], modelSubmissions: modelSubmissions }, panel: panel ? { popover: panel.getAttribute('popover'), popoverOpen: panel.matches(':popover-open'), width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height, backgroundColor: panelStyle?.backgroundColor, rootBackgroundColor: innerStyle?.backgroundColor, opacity: panelStyle?.opacity, opaqueSurface: colorAlpha(panelStyle?.backgroundColor ?? '') === 1 && colorAlpha(innerStyle?.backgroundColor ?? '') === 1 && panelStyle?.opacity === '1' } : undefined }
}

async function automate(): Promise<void> {
  configure('running')
  await flush()
  assert(trigger().getAttribute('aria-label')?.includes('执行中'), 'running initial trigger summary was not exposed')
  await openPanel()
  const subtasks = need<HTMLButtonElement>('#iexp-collab-subtasks-tab'), teamTab = need<HTMLButtonElement>('#iexp-collab-team-tab')
  subtasks.focus()
  subtasks.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  await flush()
  assert(teamTab.getAttribute('aria-selected') === 'true' && document.activeElement === teamTab, 'left-arrow did not move focus to Team')
  teamTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await flush()
  assert(subtasks.getAttribute('aria-selected') === 'true' && document.activeElement === subtasks, 'right-arrow did not move focus to Subtasks')
  const roleCall = need<HTMLElement>('.iexp-collab-call')
  assert(document.querySelector('.iexp-collab-child') !== null, 'ordinary child session was not rendered')
  assert(!includes(roleCall, '普通子会话'), 'generic child session was classified as a pstack role call')

  configure('completed')
  await flush()
  assert(!trigger().getAttribute('aria-label')?.includes('执行中') && includes(document.body, '已完成'), 'completed summary or call state is wrong')
  const resultView = need<HTMLElement>('.iexp-collab-result[aria-label="委派回执"]')
  const raw = [...resultView.querySelectorAll<HTMLButtonElement>('.iexp-collab-mode-button')].find(button => button.textContent?.trim() === '原文')
  assert(raw, 'original-text mode switch is missing')
  raw.click()
  await flush()
  const rawText = need<HTMLPreElement>('.iexp-collab-raw').textContent
  assert(rawText === RESULT, `raw pstack result was not preserved: ${JSON.stringify(rawText?.slice(0, 300))}`)
  const visual = [...resultView.querySelectorAll<HTMLButtonElement>('.iexp-collab-mode-button')].find(button => button.textContent?.trim() === '阅读')
  assert(visual, 'visual-result switch is missing')
  visual.click()
  await flush()
  assert(documentRenders.some(render => render.value === RESULT && render.raw === RESULT && render.mode === 'visual'), 'synthetic DocumentView did not receive exact value/raw')

  opens.length = 0
  openable('未命名子任务').click()
  await flush()
  assert(JSON.stringify(opens.at(-1)) === JSON.stringify({ parentSessionId: 'session-A', childSessionId: 'child-one-shot', mode: 'one-shot' }), `one-shot mode changed: ${JSON.stringify(opens.at(-1))}`)
  openable('可继续角色子任务').click()
  await flush()
  assert(JSON.stringify(opens.at(-1)) === JSON.stringify({ parentSessionId: 'session-A', childSessionId: 'child-continuable', mode: 'continuable' }), `pstack target changed: ${JSON.stringify(opens.at(-1))}`)
  assert(modelSubmissions === 0, 'opening a child attempted a model submission')

  configure('missing')
  await flush()
  assert(includes(document.body, '当前不可用'), 'missing projection was not marked unavailable')
  assert(!includes(document.body, '当前没有已报告的角色调用。'), 'missing projection was treated as empty')
  configure('empty')
  await flush()
  assert(includes(document.body, '当前没有'), 'empty projection did not show an empty state')

  configure('disconnected')
  await flush()
  assert(trigger().getAttribute('aria-label')?.includes('记录待更新') && includes(document.body, '信息可能已过期'), 'disconnect did not preserve and label old records')
  configure('history')
  await flush()
  assert(includes(document.body, '需要关注的历史调用') && includes(document.body, '历史仍在执行的角色任务。') && includes(document.body, '历史状态待确认的角色任务。'), 'running/unknown history was not visible')

  configure('session-a', 'session-A')
  sessionId.set('session-A')
  await flush()
  need<HTMLButtonElement>('#iexp-collab-team-tab').click()
  await flush()
  assert(includes(document.body, '会话 A 的唯一共享任务'), 'session A data did not render')
  sessionId.set('session-B')
  configure('session-b', 'session-B')
  await flush()
  assert(document.querySelector('.iexp-collab-panel') === null, 'switching sessions did not close the panel')
  await openPanel()
  need<HTMLButtonElement>('#iexp-collab-team-tab').click()
  await flush()
  assert(includes(document.body, '会话 B 的唯一共享任务') && !includes(document.body, '会话 A 的唯一共享任务'), 'session switch leaked prior task data')
  finalLayout = auditLayout()
  assert(finalLayout.offenders.length === 0, `post-interaction horizontal overflow: ${JSON.stringify(finalLayout.offenders)}`)
  passed = true
}

async function bootstrap(): Promise<void> {
  assert(contribution, 'built client did not call window.__ModuleLoader__.load')
  const module = contribution.factory(id => {
    if (id === '@deepseek-ai/dsh-client-ui-slots') return Slots
    if (id === 'react') return React
    if (id === 'react-dom') return ReactDOM
    if (id === 'react/jsx-runtime') return JSXRuntime
    throw new Error(`unexpected runtime module ${id}; fixture does not synthesize host protocols`)
  })
  assert(typeof module.CollaborationEntry === 'function', 'built factory did not export CollaborationEntry')
  assert(typeof module.collaborationCss === 'string', 'built factory did not export collaborationCss')
  Entry = module.CollaborationEntry
  const style = document.createElement('style')
  style.dataset.fixtureCollaborationCss = ''
  style.textContent = module.collaborationCss
  document.head.append(style)
  configure(query.get('scenario') ?? 'running')
  document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light'
  const root = need<HTMLElement>('#root')
  createRoot(root).render(React.createElement(App))
  await waitFor('.iexp-collab-trigger')
  if (query.get('open') === '1') await openPanel()
  window.__collaborationBrowserFixture = { evidence, auditLayout: () => finalLayout ?? auditLayout(), auditScroll }
  document.documentElement.dataset.fixtureState = 'ready'
  if (query.get('automation') === '1') { await automate(); document.documentElement.dataset.automation = 'passed' }
}
function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  document.documentElement.dataset.fixtureState = 'failed'
  document.documentElement.dataset.automation = 'failed'
  document.body.dataset.fixtureError = runtimeErrors.length ? `${message}\n${runtimeErrors.join('\n')}` : message
  console.error(error)
}
if (document.readyState === 'loading') window.addEventListener('load', () => { void bootstrap().catch(fail) }, { once: true })
else void bootstrap().catch(fail)
