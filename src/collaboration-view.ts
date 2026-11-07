import { Component, createElement as h, useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import type { DocumentViewProps } from './document-view.js'
import { ThemeButton } from './theme-components.js'
import type { CollaborationCall, CollaborationChild, CollaborationMember, CollaborationSnapshot, CollaborationSourceState, CollaborationStatus, CollaborationTarget, CollaborationTask } from './collaboration-contracts.js'

const RAW_TEXT_LIMIT = 200_000
const tabs = ['team', 'subtasks'] as const
type CollaborationTab = typeof tabs[number]
type ResultMode = 'visual' | 'raw'

type CollaborationViewProps = {
  snapshot: CollaborationSnapshot
  onOpen: (target: CollaborationTarget) => void | Promise<void>
  DocumentView: ComponentType<DocumentViewProps>
}

type OpenError = { label: string }
type TargetOpener = (target: CollaborationTarget, label: string) => void

function text(value: string | undefined, fallback = '不可用'): string {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}

function sourceMessage(name: string, state: CollaborationSourceState, notice?: string): string | undefined {
  if (state === 'ready') return undefined
  if (state === 'loading') return name + '正在读取。'
  const detail = notice?.trim()
  if (detail) return '不可用：' + detail
  return state === 'failed' ? name + '读取失败，当前不可用。' : name + '当前不可用。'
}

function Status({ status, statusLabel }: { status: CollaborationStatus, statusLabel: string }): ReactElement {
  const label = text(statusLabel, '状态不可用')
  return h('span', { className: 'iexp-collab-status iexp-collab-status--' + status, 'data-status': status, 'aria-label': '状态：' + label }, label)
}

function TargetRow({ target, label, onOpen, className, children }: { target?: CollaborationTarget, label: string, onOpen: TargetOpener, className: string, children?: ReactNode }): ReactElement {
  if (!target) return h('div', { className }, children)
  return h(ThemeButton, {
    type: 'button', className: className + ' iexp-collab-row--openable',
    'aria-label': '打开' + text(label), onClick: () => onOpen(target, label),
  }, children)
}

function MemberRow({ member, onOpen }: { member: CollaborationMember, onOpen: TargetOpener }): ReactElement {
  return h(TargetRow, { target: member.target, label: member.label, onOpen, className: 'iexp-collab-row iexp-collab-member' },
    h('div', { className: 'iexp-collab-row-main' },
      h('strong', null, text(member.label)),
      member.current && h('span', { className: 'iexp-collab-current' }, '本会话'),
      h(Status, { status: member.status, statusLabel: member.statusLabel })),
    h('span', { className: 'iexp-collab-row-meta' }, '角色：' + text(member.role)))
}

function dependencyText(task: CollaborationTask): string {
  if (task.dependencies === undefined) return '不可用'
  if (!task.dependencies.length) return '无已知依赖'
  const labels = task.dependencies.map(dependency => dependency.trim()).filter(Boolean)
  return labels.length ? labels.join('、') : '不可用'
}

function TaskRow({ task }: { task: CollaborationTask }): ReactElement {
  return h('li', { className: 'iexp-collab-row iexp-collab-task' },
    h('div', { className: 'iexp-collab-row-main' }, h('strong', null, text(task.label)), h(Status, { status: task.status, statusLabel: task.statusLabel })),
    h('p', { className: 'iexp-collab-row-copy' }, text(task.description)),
    h('div', { className: 'iexp-collab-task-meta' },
      h('span', null, '负责人：' + text(task.owner)),
      h('span', null, '依赖：' + dependencyText(task))))
}

function Empty({ children }: { children?: ReactNode }): ReactElement {
  return h('p', { className: 'iexp-collab-empty' }, children)
}

function TeamPanel({ snapshot, onOpen }: { snapshot: CollaborationSnapshot['team'], onOpen: TargetOpener }): ReactElement {
  const message = sourceMessage('团队信息', snapshot.state, snapshot.notice)
  return h('section', { className: 'iexp-collab-tabpanel', role: 'tabpanel', id: 'iexp-collab-team-panel', 'aria-labelledby': 'iexp-collab-team-tab' },
    h('div', { className: 'iexp-collab-section-heading' }, h('h2', null, '团队'), h('p', null, '成员、共享任务与已报告的负责人和依赖。')),
    message && h('p', { className: 'iexp-collab-notice', role: snapshot.state === 'failed' ? 'alert' : 'status' }, message),
    h('section', { className: 'iexp-collab-section', 'aria-labelledby': 'iexp-collab-members-heading' },
      h('h3', { id: 'iexp-collab-members-heading' }, '成员'),
      snapshot.members.length
        ? h('ul', { className: 'iexp-collab-list' }, ...snapshot.members.map(member => h('li', { key: member.key }, h(MemberRow, { member, onOpen }))))
        : snapshot.state === 'ready' && h(Empty, null, '当前没有已报告的团队成员。')),
    h('section', { className: 'iexp-collab-section', 'aria-labelledby': 'iexp-collab-tasks-heading' },
      h('h3', { id: 'iexp-collab-tasks-heading' }, '共享任务'),
      snapshot.tasks.length
        ? h('ul', { className: 'iexp-collab-list' }, ...snapshot.tasks.map(task => h(TaskRow, { key: task.key, task })))
        : snapshot.state === 'ready' && h(Empty, null, '当前没有已报告的共享任务。')))
}

type ResultBoundaryProps = { resetKey: string, onRetry: () => void, onRenderError: () => void, raw: string, children?: ReactNode }
type ResultBoundaryState = { failed: boolean }

class ResultBoundary extends Component<ResultBoundaryProps, ResultBoundaryState> {
  state: ResultBoundaryState = { failed: false }

  static getDerivedStateFromError(): ResultBoundaryState { return { failed: true } }

  componentDidCatch(): void { this.props.onRenderError() }

  componentDidUpdate(previousProps: ResultBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  private retry = (): void => {
    this.setState({ failed: false })
    this.props.onRetry()
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return h('section', { className: 'iexp-collab-render-error', role: 'alert' },
      h('p', null, '内容无法呈现，已保留完整原文。可以选择“阅读”再次尝试。'),
      h('pre', { className: 'iexp-collab-raw' }, this.props.raw),
      h(ThemeButton, { type: 'button', onClick: this.retry }, '重新阅读结果'))
  }
}

function ReadableText({ identifier, title, value, DocumentView }: { identifier: string, title: string, value: string | undefined, DocumentView: ComponentType<DocumentViewProps> }): ReactElement {
  const [mode, setMode] = useState<ResultMode>(() => value !== undefined && value.length > RAW_TEXT_LIMIT ? 'raw' : 'visual')
  const [revision, setRevision] = useState(0)
  const [renderFailed, setRenderFailed] = useState(false)
  useEffect(() => {
    if (value !== undefined && value.length > RAW_TEXT_LIMIT) setMode('raw')
  }, [value])
  if (value === undefined) return h('p', { className: 'iexp-collab-result-unavailable' }, title + '：不可用。')
  const canRead = value.length <= RAW_TEXT_LIMIT
  const documentId = 'collaboration-' + identifier
  const read = (): void => {
    if (!canRead) return
    setRenderFailed(false)
    setMode('visual')
    setRevision(current => current + 1)
  }
  const showRaw = (): void => setMode('raw')
  const fallbackToRaw = (): void => {
    setRenderFailed(true)
    setMode('raw')
  }
  return h('section', { className: 'iexp-collab-result', 'aria-label': title },
    h('div', { className: 'iexp-collab-result-heading' },
      h('h4', null, title),
      h('div', { className: 'iexp-collab-mode-control', role: 'group', 'aria-label': title + '显示方式' },
        h(ThemeButton, { type: 'button', className: 'iexp-collab-mode-button', disabled: !canRead, 'aria-pressed': mode === 'visual', onClick: read }, '阅读'),
        h(ThemeButton, { type: 'button', className: 'iexp-collab-mode-button', 'aria-pressed': mode === 'raw', onClick: showRaw }, '原文'))),
    !canRead && h('p', { className: 'iexp-collab-large-result-note' }, '原文超过 200000 个字符，完整保留；为避免重新解析，只能以原文方式阅读。'),
    renderFailed && mode === 'raw' && h('p', { className: 'iexp-collab-render-note', role: 'alert' }, title + '渲染失败，已切换到完整原文。可以选择“阅读”再次尝试。'),
    mode === 'raw'
      ? h('pre', { className: 'iexp-collab-raw' }, value)
      : h(ResultBoundary, { resetKey: identifier + ':' + revision, raw: value, onRenderError: fallbackToRaw, onRetry: read },
        h(DocumentView, { documentId, value, raw: value, mode: 'visual' })))
}

function CallCard({ call, DocumentView, onOpen, historical = false }: { call: CollaborationCall, DocumentView: ComponentType<DocumentViewProps>, onOpen: TargetOpener, historical?: boolean }): ReactElement {
  const task = call.description?.trim() ? call.description : '具体任务已记录'
  return h('article', { className: 'iexp-collab-call', 'data-status': call.status, 'data-historical': historical || undefined },
    h(TargetRow, { target: call.target, label: call.label, onOpen, className: 'iexp-collab-row iexp-collab-call-header' },
      h('div', { className: 'iexp-collab-row-main' }, h('strong', null, text(call.label)), h(Status, { status: call.status, statusLabel: call.statusLabel })),
      h('span', { className: 'iexp-collab-row-meta' }, '角色任务：' + text(task))),
    call.prompt !== undefined && h('details', { className: 'iexp-collab-prompt' },
      h('summary', null, '查看调用输入'), h(ReadableText, { identifier: 'prompt:' + call.key, title: '调用输入', value: call.prompt, DocumentView })),
    h(ReadableText, { identifier: 'result:' + call.key, title: text(call.resultTitle, '结果'), value: call.result, DocumentView }))
}

function ChildRow({ child, onOpen }: { child: CollaborationChild, onOpen: TargetOpener }): ReactElement {
  return h('li', null, h(TargetRow, { target: child.target, label: child.label, onOpen, className: 'iexp-collab-row iexp-collab-child' },
    h('div', { className: 'iexp-collab-row-main' }, h('strong', null, text(child.label)), h(Status, { status: child.status, statusLabel: child.statusLabel })),
    child.description?.trim() && h('p', { className: 'iexp-collab-row-copy' }, child.description)))
}

function withoutDuplicates(calls: CollaborationCall[], excluded: Set<string> = new Set()): CollaborationCall[] {
  const seen = new Set(excluded)
  return calls.filter(call => {
    if (seen.has(call.key)) return false
    seen.add(call.key)
    return true
  })
}

function SubtasksPanel({ snapshot, onOpen, DocumentView }: { snapshot: CollaborationSnapshot, onOpen: TargetOpener, DocumentView: ComponentType<DocumentViewProps> }): ReactElement {
  const pstackMessage = sourceMessage('角色调用信息', snapshot.pstack.state, undefined)
  const childrenMessage = sourceMessage('子会话信息', snapshot.children.state, snapshot.children.notice)
  const currentCalls = snapshot.pstack.calls.filter(call => !call.previous)
  const currentKeys = new Set(currentCalls.map(call => call.key))
  const history = withoutDuplicates([...snapshot.pstack.calls.filter(call => call.previous), ...snapshot.pstack.history], currentKeys)
  const attentionHistory = history.filter(call => call.status === 'running' || call.status === 'preparing' || call.status === 'unknown')
  const collapsedHistory = history.filter(call => !attentionHistory.includes(call))
  const summary = text(snapshot.pstack.summary)
  const context = snapshot.pstack.context?.trim()
  return h('section', { className: 'iexp-collab-tabpanel', role: 'tabpanel', id: 'iexp-collab-subtasks-panel', 'aria-labelledby': 'iexp-collab-subtasks-tab' },
    h('div', { className: 'iexp-collab-section-heading' }, h('h2', null, '子任务'), h('p', null, 'pstack 调用与其他子会话分开显示。')),
    h('section', { className: 'iexp-collab-section iexp-collab-pstack', 'aria-labelledby': 'iexp-collab-calls-heading' },
      h('h3', { id: 'iexp-collab-calls-heading' }, 'pstack'),
      pstackMessage && h('p', { className: 'iexp-collab-notice', role: snapshot.pstack.state === 'failed' ? 'alert' : 'status' }, pstackMessage),
      h('p', { className: 'iexp-collab-summary' }, summary),
      h('p', { className: 'iexp-collab-context' }, '规则上下文：' + (context || '不可用')),
      attentionHistory.length > 0 && h('section', { className: 'iexp-collab-attention-history', 'aria-labelledby': 'iexp-collab-attention-heading' },
        h('h4', { id: 'iexp-collab-attention-heading' }, '需要关注的历史调用'),
        h('p', null, '以下历史调用仍在进行、准备中或状态未知，保持展开显示。'),
        ...attentionHistory.map(call => h(CallCard, { key: call.key, call, DocumentView, onOpen, historical: true }))),
      currentCalls.length
        ? h('div', { className: 'iexp-collab-call-list' }, ...currentCalls.map(call => h(CallCard, { key: call.key, call, DocumentView, onOpen })))
        : snapshot.pstack.state === 'ready' && h(Empty, null, '当前没有已报告的角色调用。'),
      collapsedHistory.length > 0 && h('details', { className: 'iexp-collab-history' },
        h('summary', null, '查看其他历史调用（' + collapsedHistory.length + '）'),
        h('div', { className: 'iexp-collab-call-list' }, ...collapsedHistory.map(call => h(CallCard, { key: call.key, call, DocumentView, onOpen, historical: true }))))),
    h('section', { className: 'iexp-collab-section', 'aria-labelledby': 'iexp-collab-children-heading' },
      h('h3', { id: 'iexp-collab-children-heading' }, '子会话'),
      h('p', { className: 'iexp-collab-section-help' }, '角色调用以 pstack 记录为准。'),
      childrenMessage && h('p', { className: 'iexp-collab-notice', role: snapshot.children.state === 'failed' ? 'alert' : 'status' }, childrenMessage),
      snapshot.children.rows.length
        ? h('ul', { className: 'iexp-collab-list' }, ...snapshot.children.rows.map(child => h(ChildRow, { key: child.key, child, onOpen })))
        : snapshot.children.state === 'ready' && h(Empty, null, '当前没有已报告的子会话。')))
}

function sessionStatus(snapshot: CollaborationSnapshot): string {
  if (snapshot.loading) return '本会话状态：正在读取。'
  if (snapshot.running) return '本会话状态：正在运行。'
  return '本会话状态：未报告正在运行的协作。'
}

/** Panel body only. The caller owns its trigger, native popover, close action, focus and data reads. */
export function CollaborationView({ snapshot, onOpen, DocumentView }: CollaborationViewProps): ReactElement {
  const [tab, setTab] = useState<CollaborationTab>('subtasks')
  const [openError, setOpenError] = useState<OpenError>()
  const tabRefs = useRef<Record<CollaborationTab, HTMLButtonElement | null>>({ team: null, subtasks: null })
  const open: TargetOpener = (target, label) => {
    setOpenError(undefined)
    try {
      void Promise.resolve(onOpen(target)).catch(error => {
        console.error('Collaboration target open failed.', error)
        setOpenError({ label: text(label) })
      })
    } catch (error) {
      console.error('Collaboration target open failed.', error)
      setOpenError({ label: text(label) })
    }
  }
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const current = tabs.indexOf(tab)
    let next: CollaborationTab | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = tabs[(current + 1) % tabs.length]
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = tabs[(current + tabs.length - 1) % tabs.length]
    else if (event.key === 'Home') next = tabs[0]
    else if (event.key === 'End') next = tabs[tabs.length - 1]
    if (!next) return
    event.preventDefault()
    setTab(next)
    tabRefs.current[next]?.focus()
  }
  return h('section', { className: 'dsh-experience iexp-collab-root', 'aria-label': '协作状态' },
    h('header', { className: 'iexp-collab-header' },
      h('div', { className: 'iexp-collab-title-row' },
        h('div', null, h('h1', null, '协作'), h('p', null, sessionStatus(snapshot))),
        snapshot.stale && h('p', { className: 'iexp-collab-stale', role: 'status' }, '上次读取的信息可能已过期：' + text(snapshot.stale))),
      h('div', { className: 'iexp-collab-tabs', role: 'tablist', 'aria-label': '协作内容' },
        h(ThemeButton, { ref: element => { tabRefs.current.team = element }, type: 'button', className: 'iexp-collab-tab', role: 'tab', id: 'iexp-collab-team-tab', 'aria-selected': tab === 'team', 'aria-controls': 'iexp-collab-team-panel', tabIndex: tab === 'team' ? 0 : -1, onClick: () => setTab('team'), onKeyDown: moveTab }, '团队'),
        h(ThemeButton, { ref: element => { tabRefs.current.subtasks = element }, type: 'button', className: 'iexp-collab-tab', role: 'tab', id: 'iexp-collab-subtasks-tab', 'aria-selected': tab === 'subtasks', 'aria-controls': 'iexp-collab-subtasks-panel', tabIndex: tab === 'subtasks' ? 0 : -1, onClick: () => setTab('subtasks'), onKeyDown: moveTab }, '子任务')),
      openError && h('p', { className: 'iexp-collab-open-error', role: 'alert' }, '打开会话失败，请重新打开协作面板后重试。系统不会自动重试。')),
    h('div', { className: 'iexp-collab-body' }, tab === 'team'
      ? h(TeamPanel, { snapshot: snapshot.team, onOpen: open })
      : h(SubtasksPanel, { snapshot, onOpen: open, DocumentView })),
    h('footer', { className: 'iexp-collab-footer' }, '状态来自会话记录；“已完成”不代表结果已验证或正确。'))
}
