import { describe, expect, it } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { composeCollaborationSnapshot, type CollaborationInput } from '../src/collaboration-model.js'

type Row = { running: boolean; title?: string }

function list(rows: Record<string, Row> = {}, projections: Record<string, unknown> = {}): SessionListState {
  return {
    ids: Object.keys(rows),
    byId: rows,
    phase: 'ready',
    projectionsBySession: Object.fromEntries(Object.entries(projections).map(([id, values]) => [id, { values }])),
  } as unknown as SessionListState
}

function statuses(rows: Record<string, boolean | undefined> = {}): SessionStatusSnapshot {
  return new Map(Object.entries(rows).map(([id, running]) => [id, { running, pendingInteraction: undefined, completionUnread: false }])) as unknown as SessionStatusSnapshot
}

function input(overrides: Partial<CollaborationInput> = {}): CollaborationInput {
  return {
    sessionId: 'root',
    teamRootId: 'root',
    openState: 'open',
    connection: 'connected',
    list: list(),
    statuses: statuses(),
    team: undefined,
    catalog: undefined,
    pstack: undefined,
    ...overrides,
  }
}

function team(overrides: Record<string, unknown> = {}) {
  return {
    members: [],
    tasks: [],
    ...overrides,
  }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-a',
    revision: 1,
    subject: '准备验证',
    description: '验证适配结果',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ready: true,
    writeScopeWarnings: [],
    ...overrides,
  }
}

function pstack(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    inheritedCount: 0,
    context: { availability: 'unknown', name: 'solar-pstack-defaults', source: 'none' },
    currentTurn: null,
    history: [],
    truncatedSettledTurnCount: 0,
    ...overrides,
  }
}

function turn(id: string, calls: unknown[], status = 'completed') {
  return { id, status, calls }
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    kind: 'native-tool',
    name: 'pstack_spawn',
    invocation: 'called',
    status: 'completed',
    ...overrides,
  }
}

describe('composeCollaborationSnapshot', () => {
  it('keeps catalog rows isolated to their source session and preserves the original navigation mode where addressable', () => {
    const first = composeCollaborationSnapshot(input({
      sessionId: 'root-a',
      catalog: [{ id: 'child-a', createdAt: 1, mode: 'external', label: '外部子任务' }],
      list: list({ 'child-a': { running: false, title: '不应覆盖目录标签' } }, { 'child-a': { subagentTiming: { lastTurnCompleted: false } } }),
    }))
    const second = composeCollaborationSnapshot(input({
      sessionId: 'root-b',
      catalog: [{ id: 'child-b', createdAt: 2, mode: 'one-shot', label: '一次性子任务' }],
      list: list({ 'child-b': { running: false, title: '第二个标题' } }, { 'child-b': { subagentTiming: { lastTurnCompleted: true } } }),
    }))

    expect(first.children.rows).toHaveLength(1)
    expect(first.children.rows[0]).toMatchObject({ key: 'child-a', label: '外部子任务', status: 'inactive' })
    expect(first.children.rows[0]?.target).toBeUndefined()
    expect(second.children.rows).toHaveLength(1)
    expect(second.children.rows[0]).toMatchObject({ key: 'child-b', label: '一次性子任务', status: 'completed', target: { parentSessionId: 'root-b', childSessionId: 'child-b', mode: 'one-shot' } })
    expect(first.children.rows.map(row => row.label)).not.toContain('一次性子任务')
  })

  it('does not call an idle child completed, including when a pending interaction exists', () => {
    const status = new Map([['child', { running: false, pendingInteraction: { key: 'approval', kind: 'approval', sessionId: 'child' }, completionUnread: false }]]) as unknown as SessionStatusSnapshot
    const snapshot = composeCollaborationSnapshot(input({
      catalog: [{ id: 'child', createdAt: 1, mode: 'continuable' }],
      list: list({ child: { running: false, title: '真实标题' } }, { child: { subagentTiming: { lastTurnCompleted: false } } }),
      statuses: status,
    }))

    expect(snapshot.children.rows[0]).toMatchObject({ label: '真实标题', status: 'inactive', statusLabel: '当前未在执行' })
    expect(snapshot.children.rows[0]?.status).not.toBe('completed')
    expect(snapshot.children.rows[0]?.status).not.toBe('failed')
    expect(snapshot.running).toBe(false)
  })

  it('marks absent runtime status unknown and never uses an id as the child label', () => {
    const snapshot = composeCollaborationSnapshot(input({
      team: team({ members: [{ id: 'member-secret', name: '成员甲', role: 'teammate', phase: 'active' }] }),
      catalog: [{ id: 'child-secret', createdAt: 1, mode: 'unknown' }],
    }))

    expect(snapshot.team.members[0]).toMatchObject({ status: 'unknown', statusLabel: '运行状态未记录', role: '协作成员' })
    expect(snapshot.children.rows[0]).toMatchObject({ label: '未命名子任务', status: 'unknown' })
    expect(snapshot.children.rows[0]?.label).not.toContain('child-secret')
  })

  it('only gives active non-current team members an addressable target', () => {
    const snapshot = composeCollaborationSnapshot(input({
      team: team({
        members: [
          { id: 'active', name: '可继续成员', role: 'teammate', phase: 'active' },
          { id: 'provisioning', name: '准备成员', role: 'teammate', phase: 'provisioning' },
          { id: 'failed', name: '失败成员', role: 'teammate', phase: 'failed', error: '/private/internal' },
        ],
      }),
      list: list({ active: { running: false }, provisioning: { running: false }, failed: { running: false } }),
    }))

    expect(snapshot.team.members[0]?.target).toEqual({ parentSessionId: 'root', childSessionId: 'active', mode: 'continuable' })
    expect(snapshot.team.members[1]).toMatchObject({ status: 'preparing' })
    expect(snapshot.team.members[1]?.target).toBeUndefined()
    expect(snapshot.team.members[2]).toMatchObject({ status: 'failed', statusLabel: '成员失败' })
    expect(snapshot.team.members[2]?.target).toBeUndefined()
  })

  it('keeps valid team rows after a team failure and replaces internal dependency ids with known labels', () => {
    const snapshot = composeCollaborationSnapshot(input({
      team: team({
        failure: '/private/internal/member-secret',
        members: [{ id: 'lead', name: '主负责人', role: 'lead', phase: 'active' }],
        tasks: [
          task({ id: 'task-a', subject: '实现适配', blockedBy: ['task-b', 'missing-task'] }),
          task({ id: 'task-b', subject: '先决检查', status: 'completed' }),
        ],
      }),
      list: list({ lead: { running: false } }),
    }))

    expect(snapshot.team).toMatchObject({ state: 'failed', notice: '团队持久记录校验失败，以下保留上次有效记录。' })
    expect(snapshot.team.notice).not.toContain('/private/internal/member-secret')
    expect(snapshot.team.members).toHaveLength(1)
    expect(snapshot.team.tasks).toHaveLength(2)
    expect(snapshot.team.tasks[0]).toMatchObject({ label: '实现适配', dependencies: ['先决检查', '未取得的依赖任务'] })
  })

  it('does not treat a missing projection as an empty ready source', () => {
    const snapshot = composeCollaborationSnapshot(input())

    expect(snapshot.team.state).toBe('unavailable')
    expect(snapshot.children.state).toBe('unavailable')
    expect(snapshot.pstack.state).toBe('unavailable')
    expect(snapshot.team.notice).toContain('尚未取得')
  })

  it('marks disconnected or failed reads as stale instead of presenting records as current', () => {
    const snapshot = composeCollaborationSnapshot(input({ connection: 'disconnected', openState: 'error' }))

    expect(snapshot.stale).toContain('连接已中断')
    expect(snapshot.stale).toContain('当前会话读取失败')
  })

  it('rejects an unknown pstack projection version without guessing its contents', () => {
    const snapshot = composeCollaborationSnapshot(input({ pstack: { formatVersion: 2, currentTurn: turn('turn-x', [call()]) } }))

    expect(snapshot.pstack).toEqual({ state: 'failed', summary: 'pstack 状态使用未知版本，无法安全解读。', calls: [], history: [] })
  })

  it('keeps pstack failure and interruption states, and retains pending history as previous', () => {
    const snapshot = composeCollaborationSnapshot(input({
      pstack: pstack({
        currentTurn: turn('current', [
          call({ id: 'failed-call', name: 'pstack_catalog', status: 'failed', result: { isError: true, error: '目录请求失败' } }),
          call({ id: 'stopped-call', name: 'pstack_overlay_read', status: 'stopped', result: { isError: false, stopReason: 'interrupted' } }),
        ]),
        history: [turn('older', [call({ id: 'pending-call', status: 'running' })], 'unknown')],
      }),
    }))

    expect(snapshot.pstack.calls[0]).toMatchObject({ status: 'failed', resultTitle: '失败信息', result: '目录请求失败' })
    expect(snapshot.pstack.calls[1]).toMatchObject({ status: 'stopped', statusLabel: '已中断', resultTitle: '中断信息' })
    expect(snapshot.pstack.history[0]).toMatchObject({ status: 'running', previous: true })
    expect(snapshot.pstack.history[0]?.key).toBe(JSON.stringify(['root', 'older', 'pending-call']))
    expect(snapshot.running).toBe(true)
  })

  it('does not create a pstack call from provided context or a generic child record', () => {
    const snapshot = composeCollaborationSnapshot(input({
      pstack: pstack({
        context: { availability: 'provided', name: 'solar-pstack-defaults', source: 'named-context' },
        currentTurn: turn('current', [call({ name: 'ordinary_subagent', status: 'running', child: { id: 'generic-child', status: 'continuable' } })], 'running'),
      }),
    }))

    expect(snapshot.pstack.calls).toEqual([])
    expect(snapshot.pstack.context).toContain('不代表已调用')
    expect(snapshot.pstack.summary).toContain('尚未记录调用')
    expect(snapshot.running).toBe(false)
  })

  it('preserves complete spawn text but only summarizes machine JSON, and reuses catalog mode for a matching continuable receipt', () => {
    const snapshot = composeCollaborationSnapshot(input({
      catalog: [
        { id: 'catalog-child', createdAt: 1, mode: 'one-shot', label: '一次性工作' },
        { id: 'external-child', createdAt: 2, mode: 'external', label: '外部工作' },
      ],
      pstack: pstack({
        currentTurn: turn('turn-7', [
          call({ id: 'spawn', status: 'unknown', prompt: '完整委派正文', result: { isError: false, output: '第一行\n第二行' }, child: { id: 'catalog-child', status: 'continuable' } }),
          call({ id: 'catalog', name: 'pstack_catalog', status: 'completed', result: { isError: false, text: JSON.stringify({ selectableCount: 2, privatePath: '/secret/path' }) } }),
          call({ id: 'external', status: 'unknown', child: { id: 'external-child', status: 'continuable' } }),
          call({ id: 'unmatched', status: 'unknown', child: { id: 'not-in-catalog', status: 'continuable' } }),
        ]),
      }),
    }))

    expect(snapshot.pstack.calls[0]).toMatchObject({ prompt: '完整委派正文', result: '第一行\n第二行', target: { parentSessionId: 'root', childSessionId: 'catalog-child', mode: 'one-shot' } })
    expect(snapshot.pstack.calls[1]).toMatchObject({ result: '找到 2 个可选模型。' })
    expect(snapshot.pstack.calls[1]?.result).not.toContain('/secret/path')
    expect(snapshot.pstack.calls[2]?.target).toBeUndefined()
    expect(snapshot.pstack.calls[3]?.target).toBeUndefined()
  })
})
