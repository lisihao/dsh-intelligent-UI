import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { ActionEvent } from '@openuidev/react-lang'
import { dilPayloadSchema, dilRuntimeInfoSchema, type DilApi, type ExperienceArtifact } from '../contracts.js'
import { DilProgramView } from './view.js'

export interface DilArtifactViewProps {
  artifact: ExperienceArtifact
  enabled: boolean
  api?: DilApi
  stateReady: boolean
  initialState: Record<string, unknown>
  onStateChange(state: Record<string, unknown>): void
  onContinue?: (event: ActionEvent, state: Record<string, unknown>, signal: AbortSignal) => Promise<void>
  renderMarkdown(text: string): ReactNode
}

/** The stable identity belongs to a tool call, including its temporary streamed revision. */
export function dilArtifactIdentity(artifact: ExperienceArtifact): string {
  return `${artifact.source.sessionId}\u0000${artifact.source.callId ?? artifact.id}`
}

/** Bridge existing revision-checked widget state and explicit conversation continuation. */
export function DilArtifactView({ artifact, enabled, api, stateReady, initialState, onStateChange, onContinue, renderMarkdown }: DilArtifactViewProps): ReactElement {
  const parsed = useMemo(() => dilPayloadSchema.safeParse(artifact.payload), [artifact.payload])
  const payload = parsed.success ? parsed.data : undefined
  const constantsKey = payload ? JSON.stringify(payload.compiled.constants) : ''
  const appDataKey = payload ? JSON.stringify(payload.compiled.appData) : ''
  const compiled = useMemo(() => payload?.compiled, [payload?.source, payload?.compiled.code, constantsKey, appDataKey])
  const source = payload?.source ?? (typeof artifact.raw === 'string' ? artifact.raw : '')
  const [frameUrl, setFrameUrl] = useState<string>()
  const [failure, setFailure] = useState('')
  const [submission, setSubmission] = useState<'idle' | 'pending' | 'sent' | 'unconfirmed'>('idle')
  const submissionRef = useRef(submission)
  const readyOnce = useRef(false)
  if (stateReady) readyOnce.current = true
  const lastLocalState = useRef<Record<string, unknown>>({})
  const hasLocalState = useRef(false)
  const updateRef = useRef(onStateChange)
  updateRef.current = onStateChange
  const pending = useRef(new Set<AbortController>())
  useEffect(() => () => { pending.current.forEach(controller => controller.abort()); pending.current.clear() }, [])

  useEffect(() => {
    let active = true
    setFrameUrl(undefined); setFailure('')
    if (!enabled || !api || !payload) return
    void api.dilRuntimeInfo({ sessionId: artifact.source.sessionId }).then(result => {
      const info = dilRuntimeInfoSchema.parse(result)
      if (active) setFrameUrl(info.frameUrl)
    }).catch(() => { if (active) setFailure('交互界面服务未能连接，原始内容仍可查看。') })
    return () => { active = false }
  }, [enabled, api?.dilRuntimeInfo, artifact.source.sessionId, !!payload])

  const reportState = useCallback((next: Record<string, unknown>) => {
    lastLocalState.current = next; hasLocalState.current = true
    updateRef.current(next)
  }, [])
  // A streamed call keeps its runner while its durable artifact state is read.
  // Once that read completes, save the actual local state through the new UUID.
  useEffect(() => {
    if (stateReady && hasLocalState.current) updateRef.current(lastLocalState.current)
  }, [stateReady, artifact.id])

  const submit = async (action: string, input: { state: Readonly<Record<string, unknown>>, fields: Readonly<Record<string, unknown>> }): Promise<void> => {
    if (submissionRef.current === 'pending' || submissionRef.current === 'unconfirmed') return
    if (!onContinue) { setFailure('当前视图没有会话提交接口，尚未提交任何内容。'); return }
    const controller = new AbortController(); pending.current.add(controller); submissionRef.current = 'pending'; setSubmission('pending')
    const state = { state: { ...input.state }, fields: { ...input.fields } }
    const event: ActionEvent = { type: 'continue_conversation', params: { action, protocol: 'dil' }, humanFriendlyMessage: '提交当前界面中的选择', formState: { ...input.fields } }
    try {
      await onContinue(event, state, controller.signal)
      if (!controller.signal.aborted) { submissionRef.current = 'sent'; setSubmission('sent') }
    } catch {
      if (!controller.signal.aborted) { submissionRef.current = 'unconfirmed'; setSubmission('unconfirmed') }
    } finally { pending.current.delete(controller) }
  }

  const fallback = () => h('div', null,
    !enabled && h('p', { role: 'status' }, '内容块智能布局实验已关闭，未执行界面程序。'),
    !payload && h('p', { role: 'alert' }, '界面记录的格式无法识别，原始内容仍可查看。'),
    enabled && !api && h('p', { role: 'status' }, '当前没有可用的交互界面服务，未执行界面程序。'),
    failure && h('p', { role: 'alert' }, failure),
    renderMarkdown(payload?.compiled.fallbackMarkdown || source),
    h('details', null, h('summary', null, '查看原始界面程序'), h('pre', null, source)))

  return h('section', { className: 'dsh-experience iexp-dil-artifact' },
    !enabled || !api || !compiled || failure
      ? fallback()
      : !frameUrl || !readyOnce.current
        ? h('p', { role: 'status' }, '正在恢复本地交互界面…')
        : h(DilProgramView, {
          source, compiled, enabled,
          artifactId: artifact.source.callId ?? artifact.id,
          sessionId: artifact.source.sessionId, frameUrl,
          initialState, onStateChange: reportState, onSubmit: submit,
          renderFallback: ({ compiled: value, source: original, reason }) => h('div', null,
            reason && h('p', { role: 'alert' }, '交互界面未能运行，下面保留可读内容。'),
            renderMarkdown(value.fallbackMarkdown || original),
            h('details', null, h('summary', null, '查看原始界面程序与诊断'), h('pre', null, [reason, original].filter(Boolean).join('\n\n')))),
        }),
    submission === 'pending' && h('p', { role: 'status' }, '正在提交当前选择…'),
    submission === 'sent' && h('p', { role: 'status' }, '已提交到当前会话。'),
    submission === 'unconfirmed' && h('p', { role: 'alert' }, '提交结果尚未确认，请先检查当前会话；不会自动重发。'))
}
