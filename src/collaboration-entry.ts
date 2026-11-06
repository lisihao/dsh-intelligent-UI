import { createElement as h, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSnapshot, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot, UseSession, UseSessions, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { DocumentViewProps } from './document-view.js'
import type { CollaborationTarget } from './collaboration-contracts.js'
import { composeCollaborationSnapshot } from './collaboration-model.js'
import { CollaborationView } from './collaboration-view.js'

export type CollaborationEntryProps = PropsRuntime<'conversation.session.header.actions'> & {
 connectionState: ConnectionStateSource
 DocumentView: ComponentType<DocumentViewProps>
 onOpen(target: CollaborationTarget): void | Promise<void>
}
/** Public session hooks feed one panel; opening it never submits or repeats work. */
export function CollaborationEntry({ sessionId, useSession, useSessions, useSessionStatus, useProjection, connectionState, DocumentView, onOpen }: CollaborationEntryProps): ReactElement {
 const sessionHook: UseSession = useSession, listHook: UseSessions = useSessions, statusHook: UseSessionStatus = useSessionStatus
 const openState: SessionSnapshot['openState'] = sessionHook((session: SessionSnapshot) => session.openState)
 const teamRootId: string = sessionHook((session: SessionSnapshot) => session.subagent?.address.parentSessionId) ?? sessionId
 const list: SessionListState = listHook((state: SessionListState) => state)
 const statuses: SessionStatusSnapshot = statusHook((state: SessionStatusSnapshot) => state)
 // A plugin-owned projection is an unknown JSON boundary, validated by the adapter.
 const projection = useProjection as (key: string) => unknown
 const currentTeam = projection('agentTeam')
 const catalog = projection('subagentCatalog')
 const pstack = projection('solar-pstack-status')
 const team = teamRootId === sessionId ? currentTeam : (list.projectionsBySession[teamRootId as SessionListState['ids'][number]]?.values as Readonly<Record<string, unknown>> | undefined)?.agentTeam
 const connection = useSyncExternalStore(connectionState.subscribe, connectionState.getSnapshot, connectionState.getSnapshot)
 const snapshot = useMemo(() => composeCollaborationSnapshot({ sessionId, teamRootId, openState, connection, list, statuses, team, catalog, pstack }), [sessionId, teamRootId, openState, connection, list, statuses, team, catalog, pstack])
 const [open, setOpen] = useState(false)
 const [top, setTop] = useState(64)
 const [left, setLeft] = useState(16)
 const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null)
 const id = useId()
 useLayoutEffect(() => { setOpen(false) }, [sessionId])
 useLayoutEffect(() => {
  if (!open) return
  const surface = panel.current, anchor = trigger.current
  if (!surface || !anchor) return
  const position = (): void => {
   const r = anchor.getBoundingClientRect(), width = Math.min(720, window.innerWidth - 32)
   setTop(Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 240)))
   setLeft(Math.max(16, Math.min(r.right - width, window.innerWidth - width - 16)))
  }
  const sync = (): void => { if (!surface.matches(':popover-open')) setOpen(false) }
  surface.addEventListener('toggle', sync)
  surface.showPopover()
  position()
  window.addEventListener('resize', position)
  return () => {
   surface.removeEventListener('toggle', sync)
   window.removeEventListener('resize', position)
   if (surface.isConnected && surface.matches(':popover-open')) surface.hidePopover()
  }
 }, [open])
 const summary = snapshot.stale ? '记录待更新' : snapshot.loading ? '正在读取' : snapshot.running ? '执行中' : undefined
 return h('div', { className: 'dsh-experience iexp-collab-entry' },
  h('button', { type: 'button', className: 'iexp-collab-trigger', ref: trigger, 'aria-haspopup': 'dialog', 'aria-controls': id, 'aria-expanded': open,
   'aria-label': summary ? `协作：${summary}` : '协作', title: '查看团队、子任务与 pstack 调用', onClick: () => setOpen(value => !value) },
   h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }), h('circle', { cx: 9, cy: 7, r: 4 })),
   h('span', null, '协作'), summary ? h('span', { className: 'iexp-collab-trigger-state', 'aria-live': 'polite' }, summary) : null),
  open ? h('section', { id, key: sessionId, ref: panel, popover: 'auto', role: 'dialog', 'aria-label': '会话协作', className: 'dsh-experience iexp-collab-panel',
   style: { top, left, right: 'auto', bottom: 'auto', maxHeight: `min(780px, calc(100dvh - ${String(top)}px - 16px))` } },
   h('button', { className: 'iexp-collab-close', type: 'button', 'aria-label': '关闭协作面板', onClick: () => { setOpen(false); trigger.current?.focus() } },
    h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'm6 6 12 12M18 6 6 18' }))),
   h(CollaborationView, { snapshot, DocumentView, onOpen: (target: CollaborationTarget) => {
    if (snapshot.stale || snapshot.loading) throw Error('当前会话尚未重新连接，请连接恢复后再打开子任务。')
    return onOpen(target)
   } })) : null)
}
