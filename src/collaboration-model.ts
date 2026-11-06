import { z } from 'zod'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  CollaborationCall,
  CollaborationChild,
  CollaborationMember,
  CollaborationSnapshot,
  CollaborationSourceState,
  CollaborationStatus,
  CollaborationTask,
  CollaborationTarget,
} from './collaboration-contracts.js'

/** Raw projections are validated here; list and status snapshots are typed host state. */
export interface CollaborationInput {
  sessionId: string
  teamRootId: string
  openState: string
  connection: 'connected' | 'connecting' | 'disconnected' | undefined
  list: SessionListState
  statuses: SessionStatusSnapshot
  team: unknown
  catalog: unknown
  pstack: unknown
}

const collaborationStatusLabels: Readonly<Record<CollaborationStatus, string>> = {
  running: '正在执行',
  completed: '已完成',
  failed: '执行失败',
  stopped: '已停止',
  unknown: '结果待确认',
  inactive: '当前未在执行',
  preparing: '准备中',
}

const teamMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(['lead', 'teammate']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
})

const teamTaskSchema = z.object({
  id: z.string().min(1),
  revision: z.unknown(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  blockedBy: z.array(z.string()),
  writeScopes: z.array(z.string()),
  ownerName: z.string().optional(),
  ready: z.boolean(),
  writeScopeWarnings: z.array(z.string()),
})

const catalogRowSchema = z.object({
  id: z.string().min(1),
  createdAt: z.unknown().optional(),
  mode: z.enum(['one-shot', 'external', 'continuable', 'unknown']),
  label: z.string().optional(),
})

const pstackStatusSchema = z.enum(['running', 'completed', 'failed', 'stopped', 'unknown'])
const pstackResultSchema = z.object({
  isError: z.boolean(),
  text: z.string().optional(),
  output: z.string().optional(),
  role: z.string().optional(),
  stopReason: z.string().optional(),
  kind: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
})
const pstackChildSchema = z.object({
  id: z.string().optional(),
  status: z.enum(['delegated', 'continuable', 'unknown']),
})
const pstackCallSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['native-tool', 'ptc']),
  name: z.string(),
  role: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  invocation: z.literal('called'),
  status: pstackStatusSchema,
  result: pstackResultSchema.optional(),
  child: pstackChildSchema.optional(),
})
const pstackTurnSchema = z.object({
  id: z.string().min(1),
  status: pstackStatusSchema,
  stopReason: z.string().optional(),
  calls: z.array(pstackCallSchema),
})
const pstackStateSchema = z.object({
  formatVersion: z.literal(1),
  inheritedCount: z.number().int().nonnegative(),
  context: z.object({
    availability: z.enum(['provided', 'unavailable', 'unknown']),
    name: z.string(),
    source: z.enum(['named-context', 'none']),
  }),
  currentTurn: pstackTurnSchema.nullable(),
  history: z.array(pstackTurnSchema),
  truncatedSettledTurnCount: z.number().int().nonnegative(),
})

type TeamMember = z.infer<typeof teamMemberSchema>
type TeamTask = z.infer<typeof teamTaskSchema>
type CatalogRow = z.infer<typeof catalogRowSchema>
type PstackCall = z.infer<typeof pstackCallSchema>
type PstackTurn = z.infer<typeof pstackTurnSchema>
type PstackState = z.infer<typeof pstackStateSchema>

const pstackToolNames = new Set(['pstack_catalog', 'pstack_overlay_read', 'pstack_overlay_write', 'pstack_spawn'])
const pstackRoleLabels: Readonly<Record<string, string>> = {
  'independent-verifier': '独立验证者',
  'poteto-agent': '通用执行者',
  'how-explainer': '原理讲解者',
  'comment-sicko': '注释审阅者',
  feature: '功能实现',
  refactoring: '代码重构',
  'bug-fix': '缺陷修复',
  'perf-issue': '性能排查',
  hillclimb: '迭代改进',
  'judgment-and-prose': '判断与写作',
  'hardest-tasks': '复杂任务',
  'how-explorer': '机制探索',
  'why-investigators': '原因调查',
  'why-synthesizer': '原因综合',
  'reflect-tooling': '工具复盘',
  'reflect-judgment': '判断复盘',
  'swarm-workers': '协作执行',
  'how-critics': '机制评议（已停用角色）',
  'arena-runners': '方案对比',
  'arena-cross-judge-pool': '交叉评审',
  'architect-runners': '架构方案',
  'interrogate-reviewers': '深入审阅',
}

type TeamResult = { value: CollaborationSnapshot['team']; running: boolean }
type ChildrenResult = { value: CollaborationSnapshot['children']; running: boolean; targets: ReadonlyMap<string, CollaborationTarget> }
type PstackResult = { value: CollaborationSnapshot['pstack']; running: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function presentText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function labelText(value: unknown): string | undefined {
  return presentText(value)?.trim()
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

function currentRunning(input: CollaborationInput, id: string): boolean | undefined {
  const statusRunning = input.statuses.get(asSessionId(id))?.running
  if (statusRunning !== undefined) return statusRunning
  return input.list.byId[asSessionId(id)]?.running
}

function childCompleted(input: CollaborationInput, id: string): boolean {
  const values: unknown = input.list.projectionsBySession[asSessionId(id)]?.values
  if (!isRecord(values)) return false
  const timing = values.subagentTiming
  return isRecord(timing) && timing.lastTurnCompleted === true
}

function isLoading(input: CollaborationInput): boolean {
  return input.openState === 'cold' || input.openState === 'loading' || input.list.phase === 'pending'
}

function missingState(loading: boolean): CollaborationSourceState {
  return loading ? 'loading' : 'unavailable'
}

function sourceNotice(name: string, loading: boolean): string {
  return loading ? `正在读取${name}状态。` : `尚未取得${name}状态；这不代表本会话没有${name}记录。`
}

function memberPresentation(member: TeamMember, running: boolean | undefined): Pick<CollaborationMember, 'status' | 'statusLabel'> {
  if (running === true) return { status: 'running', statusLabel: collaborationStatusLabels.running }
  if (member.phase === 'failed') {
    return { status: 'failed', statusLabel: '成员失败' }
  }
  if (member.phase === 'provisioning') return { status: 'preparing', statusLabel: collaborationStatusLabels.preparing }
  if (running === false) return { status: 'inactive', statusLabel: collaborationStatusLabels.inactive }
  return { status: 'unknown', statusLabel: '运行状态未记录' }
}

function taskPresentation(task: TeamTask): Pick<CollaborationTask, 'status' | 'statusLabel'> {
  switch (task.status) {
    case 'pending':
      return { status: 'preparing', statusLabel: task.ready ? '待开始' : '等待依赖' }
    case 'in_progress':
      return { status: 'running', statusLabel: '进行中' }
    case 'completed':
      return { status: 'completed', statusLabel: collaborationStatusLabels.completed }
    case 'deleted':
      return { status: 'stopped', statusLabel: '已删除' }
  }
}

function parseTeamRows(value: unknown): { members: TeamMember[]; tasks: TeamTask[]; malformed: boolean } {
  if (!isRecord(value)) return { members: [], tasks: [], malformed: true }
  const memberItems = value.members
  const taskItems = value.tasks
  let malformed = !Array.isArray(memberItems) || !Array.isArray(taskItems)
  const members: TeamMember[] = []
  const tasks: TeamTask[] = []
  if (Array.isArray(memberItems)) {
    for (const item of memberItems) {
      const parsed = teamMemberSchema.safeParse(item)
      if (parsed.success) members.push(parsed.data)
      else malformed = true
    }
  }
  if (Array.isArray(taskItems)) {
    for (const item of taskItems) {
      const parsed = teamTaskSchema.safeParse(item)
      if (parsed.success) tasks.push(parsed.data)
      else malformed = true
    }
  }
  return { members, tasks, malformed }
}

function projectTeam(input: CollaborationInput, loading: boolean): TeamResult {
  if (input.team === undefined || input.team === null) {
    return { value: { state: missingState(loading), notice: sourceNotice('团队', loading), members: [], tasks: [] }, running: false }
  }
  const raw = isRecord(input.team) ? input.team : undefined
  const parsed = parseTeamRows(input.team)
  const hasFailure = raw !== undefined && raw.failure !== undefined && raw.failure !== null
  const state: CollaborationSourceState = hasFailure || parsed.malformed ? 'failed' : 'ready'
  const notice = hasFailure
    ? '团队持久记录校验失败，以下保留上次有效记录。'
    : parsed.malformed
      ? '部分团队记录格式无法识别，以下仅显示已取得的有效记录。'
      : undefined
  const members = parsed.members.map(member => {
    const running = currentRunning(input, member.id)
    const current = member.role === 'lead' ? input.sessionId === input.teamRootId : member.id === input.sessionId
    const target: CollaborationTarget | undefined = current || member.phase !== 'active'
      ? undefined
      : member.role === 'lead'
        ? { sessionId: input.teamRootId }
        : { parentSessionId: input.teamRootId, childSessionId: member.id, mode: 'continuable' }
    return {
      key: member.id,
      label: labelText(member.name) ?? '未命名成员',
      role: member.role === 'lead' ? '负责人' : '协作成员',
      ...memberPresentation(member, running),
      ...(current ? { current: true } : {}),
      ...(target === undefined ? {} : { target }),
    } satisfies CollaborationMember
  })
  const subjects = new Map(parsed.tasks.map(task => [task.id, labelText(task.subject) ?? '未命名任务']))
  const tasks = parsed.tasks.map(task => ({
    key: task.id,
    label: subjects.get(task.id) ?? '未命名任务',
    ...(presentText(task.description) === undefined ? {} : { description: task.description }),
    ...taskPresentation(task),
    ...(labelText(task.ownerName) === undefined ? {} : { owner: labelText(task.ownerName) }),
    ...(task.blockedBy.length === 0 ? {} : { dependencies: task.blockedBy.map(id => subjects.get(id) ?? '未取得的依赖任务') }),
  } satisfies CollaborationTask))
  return { value: { state, ...(notice === undefined ? {} : { notice }), members, tasks }, running: members.some(member => member.status === 'running') }
}

function childPresentation(input: CollaborationInput, id: string): Pick<CollaborationChild, 'status' | 'statusLabel'> {
  const running = currentRunning(input, id)
  if (running === true) return { status: 'running', statusLabel: collaborationStatusLabels.running }
  if (running === false && childCompleted(input, id)) return { status: 'completed', statusLabel: collaborationStatusLabels.completed }
  if (running === false) return { status: 'inactive', statusLabel: collaborationStatusLabels.inactive }
  return { status: 'unknown', statusLabel: '运行状态未记录' }
}

function projectChildren(input: CollaborationInput, loading: boolean): ChildrenResult {
  if (input.catalog === undefined || input.catalog === null) {
    return { value: { state: missingState(loading), notice: sourceNotice('子任务目录', loading), rows: [] }, running: false, targets: new Map() }
  }
  if (!Array.isArray(input.catalog)) {
    return { value: { state: 'failed', notice: '子任务目录格式无法识别。', rows: [] }, running: false, targets: new Map() }
  }
  const rawRows: CatalogRow[] = []
  let malformed = false
  for (const item of input.catalog) {
    const parsed = catalogRowSchema.safeParse(item)
    if (parsed.success) rawRows.push(parsed.data)
    else malformed = true
  }
  const targets = new Map<string, CollaborationTarget>()
  const rows = rawRows.map(row => {
    // `external` is a catalog leaf, not a public SubagentAddress mode.
    const target: CollaborationTarget | undefined = row.mode === 'external'
      ? undefined
      : { parentSessionId: input.sessionId, childSessionId: row.id, mode: row.mode }
    if (target !== undefined) targets.set(row.id, target)
    const title = input.list.byId[asSessionId(row.id)]?.title
    return {
      key: row.id,
      label: labelText(row.label) ?? labelText(title) ?? '未命名子任务',
      ...childPresentation(input, row.id),
      ...(target === undefined ? {} : { target }),
    } satisfies CollaborationChild
  })
  return {
    value: { state: malformed ? 'failed' : 'ready', ...(malformed ? { notice: '部分子任务目录记录格式无法识别，以下仅显示有效记录。' } : {}), rows },
    running: rows.some(row => row.status === 'running'),
    targets,
  }
}

function pstackRoleLabel(role: string | undefined): string {
  if (role === undefined) return '未记录角色'
  return pstackRoleLabels[role] ?? '未识别的 pstack 角色'
}

function pstackLabel(call: PstackCall): string {
  if (call.name === 'pstack_spawn') return pstackRoleLabel(call.role)
  if (call.name === 'pstack_catalog') return '查看 pstack 目录'
  if (call.name === 'pstack_overlay_read') return '读取角色设置'
  return '更新角色设置'
}

function parsedResultRecord(result: PstackCall['result']): Record<string, unknown> | undefined {
  if (result === undefined) return undefined
  for (const value of [result.text, result.output]) {
    if (typeof value !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(value)
      if (isRecord(parsed)) return parsed
    } catch {
      // A non-JSON textual receipt is not a machine object to render.
    }
  }
  return undefined
}

function safeFailureText(result: NonNullable<PstackCall['result']>): string {
  for (const value of [result.error, result.text, result.output]) {
    if (presentText(value) === undefined) continue
    const candidate = value as string
    try {
      if (isRecord(JSON.parse(candidate) as unknown)) continue
    } catch {
      return candidate
    }
    if (!candidate.trim().startsWith('{')) return candidate
  }
  return 'pstack 操作失败；未记录可安全展示的错误说明。'
}

function operationSummary(call: PstackCall): string | undefined {
  const result = call.result
  if (result === undefined) return undefined
  if (call.name === 'pstack_spawn') return result.output ?? result.text ?? result.error
  if (result.isError) return safeFailureText(result)
  const record = parsedResultRecord(result)
  if (call.name === 'pstack_catalog') {
    const count = record?.selectableCount
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) return count === 0 ? '本次没有可选模型。' : `找到 ${String(count)} 个可选模型。`
    return 'pstack 目录操作已完成。'
  }
  const overlay = record?.overlay
  const roles = isRecord(overlay) && isRecord(overlay.roles) ? overlay.roles : undefined
  if (roles !== undefined) return `${call.name === 'pstack_overlay_write' ? '已保存' : '已读取'} ${String(Object.keys(roles).length)} 个角色的设置。`
  return 'pstack 操作已完成。'
}

function pstackStatusLabel(call: PstackCall): string {
  if (call.status === 'stopped' && /abort|cancel|stop|interrupt|fork/i.test(call.result?.stopReason ?? '')) return '已中断'
  return collaborationStatusLabels[call.status]
}

function pstackResultTitle(call: PstackCall, target: CollaborationTarget | undefined): string {
  if (call.status === 'failed') return '失败信息'
  if (call.status === 'stopped') return '中断信息'
  if (call.status === 'unknown') return '结果待确认'
  if (target !== undefined) return '委派回执'
  return '执行结果'
}

function pstackCallKey(sessionId: string, turnId: string, callId: string): string {
  return JSON.stringify([sessionId, turnId, callId])
}

function projectPstackCall(input: CollaborationInput, turn: PstackTurn, call: PstackCall, previous: boolean, catalogTargets: ReadonlyMap<string, CollaborationTarget>): CollaborationCall {
  const childId = call.name === 'pstack_spawn' && call.child?.status === 'continuable' ? presentText(call.child.id) : undefined
  const target = childId === undefined ? undefined : catalogTargets.get(childId)
  const result = operationSummary(call)
  return {
    key: pstackCallKey(input.sessionId, turn.id, call.id),
    label: pstackLabel(call),
    ...(presentText(call.description) === undefined ? {} : { description: call.description }),
    status: call.status,
    statusLabel: pstackStatusLabel(call),
    ...(call.name === 'pstack_spawn' && presentText(call.prompt) !== undefined ? { prompt: call.prompt } : {}),
    ...(result === undefined ? {} : { result }),
    resultTitle: pstackResultTitle(call, target),
    ...(previous ? { previous: true } : {}),
    ...(target === undefined ? {} : { target }),
  }
}

function pstackContext(state: PstackState): string | undefined {
  if (state.context.source !== 'named-context') return undefined
  if (state.context.availability === 'provided') return '本轮已提供 pstack 工作上下文；这不代表已调用 pstack。'
  if (state.context.availability === 'unavailable') return '本轮 pstack 工作上下文不可用。'
  return '本轮 pstack 工作上下文待确认。'
}

function pstackSummary(state: PstackState, calls: readonly CollaborationCall[], history: readonly CollaborationCall[]): string {
  let current: string
  if (calls.some(call => call.status === 'running')) current = '本轮 pstack 正在执行。'
  else if (calls.some(call => call.status === 'failed')) current = '本轮 pstack 调用出现失败。'
  else if (calls.some(call => call.status === 'unknown')) current = '本轮 pstack 调用结果待确认。'
  else if (calls.some(call => call.status === 'stopped')) current = '本轮 pstack 调用已停止。'
  else if (calls.length > 0) current = '本轮已记录 pstack 调用。'
  else if (state.context.source === 'named-context' && state.context.availability === 'provided') current = '本轮已提供 pstack 工作上下文，尚未记录调用。'
  else current = '本轮未记录 pstack 调用。'
  if (history.some(call => call.status === 'running')) return `${current} 此前任务仍在执行。`
  if (history.some(call => call.status === 'unknown')) return `${current} 此前结果待确认。`
  if (calls.length === 0 && state.truncatedSettledTurnCount > 0) return `${current} 部分已结束的 pstack 历史未在当前记录中。`
  return current
}

function projectPstack(input: CollaborationInput, loading: boolean, catalogTargets: ReadonlyMap<string, CollaborationTarget>): PstackResult {
  if (input.pstack === undefined || input.pstack === null) {
    return { value: { state: missingState(loading), summary: sourceNotice('pstack', loading), calls: [], history: [] }, running: false }
  }
  if (!isRecord(input.pstack)) {
    return { value: { state: 'failed', summary: 'pstack 状态格式无法识别。', calls: [], history: [] }, running: false }
  }
  if (input.pstack.formatVersion !== 1) {
    return { value: { state: 'failed', summary: 'pstack 状态使用未知版本，无法安全解读。', calls: [], history: [] }, running: false }
  }
  const parsed = pstackStateSchema.safeParse(input.pstack)
  if (!parsed.success) {
    return { value: { state: 'failed', summary: 'pstack 状态格式无法识别。', calls: [], history: [] }, running: false }
  }
  const state = parsed.data
  const current = state.currentTurn === null
    ? []
    : state.currentTurn.calls.filter(call => pstackToolNames.has(call.name)).map(call => projectPstackCall(input, state.currentTurn as PstackTurn, call, false, catalogTargets))
  const history = state.history.flatMap(turn => turn.calls
    .filter(call => pstackToolNames.has(call.name))
    .map(call => projectPstackCall(input, turn, call, true, catalogTargets)))
  return {
    value: { state: 'ready', summary: pstackSummary(state, current, history), ...(pstackContext(state) === undefined ? {} : { context: pstackContext(state) }), calls: current, history },
    running: current.some(call => call.status === 'running') || history.some(call => call.status === 'running'),
  }
}

function staleNotice(input: CollaborationInput): string | undefined {
  const notices: string[] = []
  if (input.connection === 'disconnected') notices.push('连接已中断；以下为最后取得的记录，不能确认当前状态。')
  else if (input.connection === 'connecting') notices.push('连接正在恢复；以下记录可能不是当前状态。')
  else if (input.connection === undefined) notices.push('连接状态未取得；以下记录可能已过期。')
  if (input.openState === 'error') notices.push('当前会话读取失败；以下仅为已取得的记录。')
  return notices.length === 0 ? undefined : notices.join(' ')
}

/** Purely adapts current typed host state plus validated projection JSON into display-only collaboration data. */
export function composeCollaborationSnapshot(input: CollaborationInput): CollaborationSnapshot {
  const loading = isLoading(input)
  const team = projectTeam(input, loading)
  const children = projectChildren(input, loading)
  const pstack = projectPstack(input, loading, children.targets)
  const stale = staleNotice(input)
  return {
    sessionId: input.sessionId,
    loading,
    ...(stale === undefined ? {} : { stale }),
    running: team.running || children.running || pstack.running,
    team: team.value,
    children: children.value,
    pstack: pstack.value,
  }
}
