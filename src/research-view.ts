import { createElement as h, forwardRef, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { IconWrapper } from '@openuidev/react-ui'
import { UiverseRenderScope } from './uiverse-render.js'
import { ThemeButton, ThemeInput, ThemeToggle, ThemeLoader } from './theme-components.js'
import { analyzeResearchDocument, buildFollowupDraft } from './research-content.js'
import { AutoChart } from './presentation.js'
import type { ResearchApi, ResearchState, ResearchAnalysis } from './research-contracts.js'

type Anchor = { start: number; end: number; quote: string }
type Claim = ResearchAnalysis['claims'][number]
type Selection = { title: string; anchor: Anchor; url?: string; claimId?: string; relation?: string }
type Tab = 'report' | 'judgments' | 'sources' | 'compare'
const emptyResearchDocument: ReturnType<typeof analyzeResearchDocument> = { title: '研究报告', sections: [], sources: [], tables: [], footnotes: [] }
const tabs: [Tab, string][] = [['report', '报告'], ['judgments', '判断'], ['sources', '来源'], ['compare', '技术比较']]
const kinds = { observation: '报告观察', inference: '推断', hypothesis: '假设' }
const relations = { citation: '引用', support: '支持', challenge: '反对', limitation: '限制' }
const requestLabels = { prepared: '整理请求已准备，等待提交结果', queued: '整理请求已提交，等待当前模型返回', complete: '整理完成，判断与关系仍需复核', failed: '整理请求失败，请检查会话中的错误', unknown: '提交结果未知，请先查看当前会话；不会自动重试' }
const listeners = new Set<() => void>(), modes = new Map<string, boolean>()
export const researchModes = {
  get: (sessionId: string) => modes.get(sessionId) ?? false,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  set(sessionId: string, enabled: boolean) { if (enabled !== researchModes.get(sessionId)) { modes.set(sessionId, enabled); listeners.forEach(listener => listener()) } },
  clear() { modes.clear(); listeners.forEach(listener => listener()) },
}
export function ResearchModeControl({ sessionId }: { sessionId: string }): ReactElement {
  const enabled = useSyncExternalStore(researchModes.subscribe, () => researchModes.get(sessionId), () => false)
  return h('label', { className: 'dsh-experience iexp-research-mode' }, h(ThemeToggle, { checked: enabled, onChange: event => researchModes.set(sessionId, event.currentTarget.checked), 'aria-label': '研究工作区' }), '研究工作区')
}
/** Shared multiline field: one theme-token appearance for notes and editable copy drafts. */
const ResearchField = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function ResearchField(props, ref) { return h('textarea', { ...props, ref, className: 'iexp-research-field' }) })
function Action({ children, icon, ...props }: React.ComponentProps<typeof ThemeButton> & { icon?: string }) { return h(ThemeButton, { type: 'button', ...props }, icon && h('span', { 'aria-hidden': true, className: 'iexp-research-icon' }, h(IconWrapper, { name: icon, size: 15 })), children) }
function exactAnchor(text: string, anchor: Anchor): string { return text.slice(anchor.start, anchor.end) === anchor.quote ? anchor.quote : '该片段与当前报告不一致，请返回报告核对。' }
function readableResearchError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/RESEARCH_REVISION_CONFLICT|RESEARCH_UNKNOWN_CLAIM/.test(message)) return '研究记录已更新，请重新打开工作区后再次保存。'
  if (/RESEARCH_SOURCE_CHANGED_WITH_UNRESOLVED_REQUEST/.test(message)) return '报告已变化，上一项整理尚未核对。请先在当前会话核对提交结果。'
  if (/RESEARCH_REQUEST_ALREADY_EXISTS|RESEARCH_REQUEST_TRANSITION_INVALID|RESEARCH_RECEIPT_CONFLICT/.test(message)) return '已有整理请求或结果，请先查看当前会话核对状态。'
  if (/RESEARCH_REPORT_TOO_LARGE|RESEARCH_STATE_TOO_LARGE/.test(message)) return '内容超过研究记录的大小限制，请缩小报告或笔记范围后再试。'
  if (/RESEARCH_STORED_|RESEARCH_SNAPSHOT_MISMATCH/.test(message)) return '已保存的研究记录暂不可读取，请保留记录并检查插件版本。'
  if (/RESEARCH_ANCHOR_|RESEARCH_REPORT_HASH_MISMATCH|RESEARCH_STALE_REPORT|RESEARCH_SOURCE_NOT_IN_REPORT|RESEARCH_SOURCE_URL_INVALID/.test(message)) return '整理结果与报告原文不匹配，请在当前会话核对引用和报告版本。'
  if (/RESEARCH_SESSION_MISMATCH|RESEARCH_REQUEST_MISMATCH/.test(message)) return '研究请求与当前会话不一致，请回到发起整理的会话核对。'
  if (/RESEARCH_OWNER_REQUIRED/.test(message)) return '当前连接无法修改研究记录，请使用本机所有者会话。'
  if (/network|fetch|timeout|网络|连接|超时/i.test(message)) return '连接未完成，请检查当前会话的连接状态。'
  return '当前操作未完成，请查看当前会话中的错误详情。'
}
function safeUrl(value?: string): string | undefined { try { if (!value) return; const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return } }

export interface ResearchWorkspaceProps {
  sessionId: string; documentId: string; text: string; api?: ResearchApi
  onOrganize?: (prompt: string, signal: AbortSignal) => Promise<void>
  children?: ReactNode; isStreaming?: boolean
}

export function ResearchWorkspace({ sessionId, documentId, text, api, onOrganize, children, isStreaming = false }: ResearchWorkspaceProps): ReactElement {
  const enabled = useSyncExternalStore(researchModes.subscribe, () => researchModes.get(sessionId), () => false)
  const prefix = useId(), doc = useMemo(() => ({ sessionId, documentId, text }), [sessionId, documentId, text])
  const local = useMemo(() => enabled && !isStreaming ? analyzeResearchDocument(text) : emptyResearchDocument, [text, enabled, isStreaming])
  const [tab, setTab] = useState<Tab>('report'), [state, setState] = useState<ResearchState>(), [error, setError] = useState('')
  const [selection, setSelection] = useState<Selection>(), [narrow, setNarrow] = useState(true), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({}), [reviews, setReviews] = useState<ResearchState['reviews']>({}), [questions, setQuestions] = useState(''), [dirty, setDirty] = useState(false), [saved, setSaved] = useState('')
  const [location, setLocation] = useState<{ message: string; quote?: string }>()
  const reportRoot = useRef<HTMLDivElement>(null), highlighted = useRef<{ node: HTMLElement; timer: ReturnType<typeof setTimeout>; tabIndex: string | null }>()
  const [draft, setDraft] = useState(''), [copied, setCopied] = useState(''), [newQuestion, setNewQuestion] = useState('')
  const container = useRef<HTMLDivElement>(null), inspector = useRef<HTMLElement>(null), opener = useRef<HTMLElement | null>(null), controller = useRef<AbortController>(), alive = useRef(true), dirtyRef = useRef(false), savingRef = useRef(false), editVersion = useRef(0)
  const currentDoc = useRef(doc); currentDoc.current = doc
  const claims = state?.analysis?.claims ?? []
  const activeClaim = claims.find(claim => claim.id === selection?.claimId)
  const activeRequest = state?.request && ['prepared', 'queued'].includes(state.request.status)
  const blockedRequest = !!state?.request && state.request.status !== 'failed'
  function accept(next: ResearchState) { setState(next); if (!dirtyRef.current && !savingRef.current) { setNotes(next.notes); setReviews(next.reviews); setQuestions(next.questions.join('\n')) } }
  function edit() { editVersion.current += 1; dirtyRef.current = true; setDirty(true); setSaved('') }
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); clearHighlight() } }, [])
  useEffect(() => {
    controller.current?.abort(); clearHighlight(); setLocation(undefined); setState(undefined); setError(''); setSelection(undefined); setConfirm(false); setBusy(false); setNotes({}); setReviews({}); setQuestions(''); setDraft(''); setSaved(''); setDirty(false); dirtyRef.current = false
  }, [doc])
  useEffect(() => {
    if (!enabled || !api || isStreaming) return
    let disposed = false
    void api.get(doc).then(next => { if (!disposed) accept(next) }).catch(cause => { if (!disposed) setError(`读取研究记录失败：${readableResearchError(cause)}`) })
    return () => { disposed = true }
  }, [enabled, api, doc, isStreaming])
  useEffect(() => {
    if (!enabled || !api || !activeRequest || isStreaming) return
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try { const next = await api!.get(doc); if (disposed) return; accept(next); if (next.request && ['prepared', 'queued'].includes(next.request.status)) timer = setTimeout(() => { void poll() }, 1500) }
      catch (cause) { if (!disposed) setError(`刷新整理结果失败：${readableResearchError(cause)}`) }
    }
    timer = setTimeout(() => { void poll() }, 1500)
    return () => { disposed = true; clearTimeout(timer) }
  }, [enabled, api, doc, !!activeRequest, isStreaming])
  useEffect(() => {
    const root = container.current; if (!root) return
    function resize(width: number) { if (width > 0) setNarrow(width < 1000) }
    resize(root.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) resize(entry.contentRect.width) }); observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const modal = enabled && narrow && !!selection
  useEffect(() => {
    if (!selection || !enabled) return
    const node = inspector.current; node?.focus({ preventScroll: true })
    if (!modal) return
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setSelection(undefined); return }
      if (event.key !== 'Tab' || !node) return
      const controls = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,input,select,summary,[tabindex="0"]')]
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); node.focus(); return }
      if (!node.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); const target = opener.current; if (target?.isConnected) target.focus({ preventScroll: true }) }
  }, [selection, enabled, modal])
  function inspect(next: Selection, target?: HTMLElement) { opener.current = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); setSelection(next) }
  function clearHighlight() {
    const previous = highlighted.current
    if (!previous) return
    clearTimeout(previous.timer); previous.node.removeAttribute('data-iexp-research-highlight')
    if (previous.tabIndex === null) previous.node.removeAttribute('tabindex'); else previous.node.setAttribute('tabindex', previous.tabIndex)
    highlighted.current = undefined
  }
  function reportLink(event: ReactMouseEvent<HTMLDivElement>) {
    if (!enabled || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    const root = reportRoot.current
    if (!target || !root?.contains(target)) return
    const url = safeUrl(target.href), candidates = local.sources.filter(source => safeUrl(source.url) === url)
    if (!url || !candidates.length) return
    const block = target.closest<HTMLElement>('[data-iexp-source-start][data-iexp-source-end]')
    const start = Number(block?.dataset.iexpSourceStart), end = Number(block?.dataset.iexpSourceEnd)
    const localCandidates = block && root.contains(block) && Number.isFinite(start) && Number.isFinite(end) ? candidates.filter(source => source.start >= start && source.end <= end) : candidates
    const scope = localCandidates.length ? block ?? root : root, sources = localCandidates.length ? localCandidates : candidates
    const links = [...scope.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(link => safeUrl(link.href) === url)
    const source = sources[Math.max(0, links.indexOf(target))] ?? sources.find(item => item.title === target.textContent) ?? sources[0]!
    event.preventDefault(); event.stopPropagation(); inspect({ title: source.title, anchor: source, url: source.url }, target)
  }
  function locateReport() {
    if (!selection) return
    const anchor = selection.anchor
    setTab('report'); setSelection(undefined); clearHighlight()
    // Only the owned report subtree may receive source navigation or temporary focus/highlight.
    requestAnimationFrame(() => {
      if (!alive.current || currentDoc.current !== doc) return
      const root = reportRoot.current
      const candidates = root ? [...root.querySelectorAll<HTMLElement>('[data-iexp-source-start][data-iexp-source-end]')].filter(node => {
        const from = node.dataset.iexpSourceStart ?? '', to = node.dataset.iexpSourceEnd ?? ''
        return /^\d+$/.test(from) && /^\d+$/.test(to) && Number(from) <= anchor.start && Number(to) >= anchor.end && Number(to) <= text.length
      }).sort((a, b) => (Number(a.dataset.iexpSourceEnd) - Number(a.dataset.iexpSourceStart)) - (Number(b.dataset.iexpSourceEnd) - Number(b.dataset.iexpSourceStart))) : []
      let target = candidates[0]
      if (!target || exactAnchor(text, anchor) !== anchor.quote) {
        setLocation({ message: '报告片段不可定位：当前渲染没有匹配的来源位置标记。以下保留报告快照摘录。', quote: anchor.quote })
        root?.focus({ preventScroll: true }); return
      }
      for (let ancestor: HTMLElement | null = target; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      }
      const fullTable = target.classList.contains('iexp-table-group') ? [...target.querySelectorAll<HTMLDetailsElement>('details.iexp-full-table')].find(details => details.closest('.iexp-table-group') === target) : undefined
      if (fullTable) { fullTable.open = true; target = fullTable.querySelector<HTMLElement>('.iexp-source-table') ?? fullTable.querySelector<HTMLElement>('table') ?? fullTable }
      const tabIndex = target.getAttribute('tabindex')
      target.setAttribute('data-iexp-research-highlight', 'true'); target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      highlighted.current = { node: target, tabIndex, timer: setTimeout(clearHighlight, 1800) }
      setLocation({ message: fullTable ? '已展开并定位完整原表；当前位置标记覆盖整张表，尚未定位到单独行。' : '已定位报告片段，并短暂高亮原文。' })
    })
  }
  function makeDraft(question: string, context = activeClaim?.text ?? state?.analysis?.question ?? local.title) { setDraft(buildFollowupDraft(question, context)); setCopied('') }
  async function organize() {
    if (!api || !onOrganize || !state || busy || isStreaming || blockedRequest) return
    setConfirm(false); setBusy(true); setError('')
    const abort = new AbortController(); controller.current = abort
    let requestId: string | undefined
    try {
      const prepared = await api.prepare({ ...doc, expectedRevision: state.revision }); requestId = prepared.requestId
      if (currentDoc.current === doc && alive.current) accept(prepared.state)
      if (abort.signal.aborted) throw new Error('整理提交已中断，请查看当前会话')
      await onOrganize(prepared.prompt, abort.signal)
      const next = await api.markSubmission({ ...doc, requestId, status: 'queued' })
      if (currentDoc.current === doc && alive.current) accept(next)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (requestId) {
        try { const next = await api.markSubmission({ ...doc, requestId, status: 'unknown', error: message }); if (currentDoc.current === doc && alive.current) accept(next) }
        catch { if (currentDoc.current === doc && alive.current) setState(previous => previous?.request ? { ...previous, request: { ...previous.request, status: 'unknown', error: message } } : previous) }
      }
      if (currentDoc.current === doc && alive.current) setError(`${requestId ? '整理提交结果未知' : '未能准备整理请求'}：${readableResearchError(cause)}不会自动重试。`)
    } finally { if (currentDoc.current === doc && alive.current) setBusy(false) }
  }
  async function save() {
    if (!api || !state || savingRef.current) return
    savingRef.current = true; const version = editVersion.current; setBusy(true); setError(''); setSaved('')
    try {
      const next = await api.saveNotes({ ...doc, expectedRevision: state.revision, notes, reviews, questions: questions.split('\n').map(value => value.trim()).filter(Boolean) })
      if (currentDoc.current !== doc || !alive.current) return
      setState(next); if (version === editVersion.current) { dirtyRef.current = false; setDirty(false); setSaved('研究记录已保存') } else setSaved('已保存提交时的内容，仍有新的修改')
    } catch (cause) { if (currentDoc.current === doc && alive.current) setError(`保存研究记录失败：${readableResearchError(cause)}未保存的内容仍保留在输入框中。`) }
    finally { savingRef.current = false; if (currentDoc.current === doc && alive.current) setBusy(false) }
  }
  async function copy() { try { await navigator.clipboard.writeText(draft); setCopied('草稿已复制，请自行粘贴到会话') } catch { setCopied('复制失败，请选择草稿文字手动复制') } }
  const empty = h('div', { className: 'iexp-research-empty' }, h('h3', null, '尚未整理判断'), h('p', null, '原报告仍可连续阅读。来源与原表已在本地解析；如需提取判断、条件与反对意见，可手动启动 AI 整理。'))
  const sourceButton = (item: Selection, label: string, key: string) => h(Action, { key, icon: 'locate-fixed', onClick: event => inspect(item, event.currentTarget) }, label)
  const claimView = (claim: Claim) => h('article', { key: claim.id, className: 'iexp-research-claim', tabIndex: -1, id: `${prefix}-claim-${claim.id}` },
    h('div', { className: 'iexp-research-row' }, h('span', { className: 'iexp-research-muted' }, `${kinds[claim.kind]} · AI 整理，待复核`), h('span', null, reviews[claim.id] === 'confirmed' ? '你已确认' : reviews[claim.id] === 'questioned' ? '你有疑问' : '尚未复核')),
    h('h3', null, claim.text), sourceButton({ title: claim.text, anchor: claim.anchor, claimId: claim.id }, '定位判断原文', `${claim.id}-source`),
    h('h4', null, '成立条件'), claim.conditions.length ? h('ul', { className: 'iexp-research-conditions', 'aria-label': '成立条件' }, ...claim.conditions.map((condition, index) => h('li', { key: index }, condition))) : h('p', { className: 'iexp-research-muted' }, '整理结果未列出条件，请对照报告核查。'),
    h('div', { className: 'iexp-research-actions' }, ...claim.evidence.map(evidence => sourceButton({ title: `${relations[evidence.relation]} · 待复核`, anchor: evidence.anchor, url: evidence.sourceUrl, claimId: claim.id, relation: evidence.note }, `${relations[evidence.relation]}片段`, evidence.id))),
    h('div', { className: 'iexp-research-actions' }, h(Action, { 'aria-pressed': reviews[claim.id] === 'confirmed', onClick: () => { edit(); setReviews({ ...reviews, [claim.id]: 'confirmed' }) } }, '确认判断'), h(Action, { 'aria-pressed': reviews[claim.id] === 'questioned', onClick: () => { edit(); setReviews({ ...reviews, [claim.id]: 'questioned' }) } }, '标记疑问'), h(Action, { onClick: () => makeDraft(`请进一步核查这个判断的成立条件和反证：${claim.text}`, claim.text) }, '拟定追问草稿')),
    h('details', { className: 'iexp-research-note' }, h('summary', null, notes[claim.id]?.trim() ? '我的笔记（已填写）' : '添加我的笔记'), h('label', { htmlFor: `${prefix}-note-${claim.id}` }, '我的笔记'), h(ResearchField, { id: `${prefix}-note-${claim.id}`, rows: 2, value: notes[claim.id] ?? '', onChange: event => { edit(); setNotes({ ...notes, [claim.id]: event.currentTarget.value }) } })))
  const opposition = claims.flatMap(claim => claim.evidence.filter(evidence => ['challenge', 'limitation'].includes(evidence.relation)).map(evidence => ({ claim, evidence })))
  const queuedQuestions = claims.flatMap(claim => claim.openQuestions.map(question => ({ question, context: claim.text })))
  return h(UiverseRenderScope, { role: 'content' }, h('div', { ref: container, className: `dsh-experience iexp-research${enabled ? ' is-enabled' : ''}`, 'data-research-workspace': enabled ? 'enabled' : 'disabled' },
    h('div', { className: 'iexp-research-toolbar', hidden: !enabled },
      h('div', { className: 'iexp-research-tabs', role: 'tablist', 'aria-label': '研究工作区内容' }, ...tabs.map(([value, title]) => h(Action, { key: value, role: 'tab', id: `${prefix}-tab-${value}`, 'aria-selected': tab === value, 'aria-controls': `${prefix}-panel-${value}`, tabIndex: tab === value ? 0 : -1, onClick: () => setTab(value), onKeyDown: event => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const index = tabs.findIndex(([name]) => name === tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next]![0]); document.getElementById(`${prefix}-tab-${tabs[next]![0]}`)?.focus() } }, title))),
      h(Action, { icon: 'list-checks', disabled: !api || !onOrganize || !state || busy || isStreaming || blockedRequest, title: !onOrganize ? '当前会话未提供模型提交接口，暂不能整理' : undefined, onClick: () => setConfirm(true) }, 'AI 整理')),
    h('div', { hidden: !enabled, className: 'iexp-research-status' }, api && !state && !error && !isStreaming && h(ThemeLoader, { label: '正在读取研究记录…' }), !onOrganize && h('p', null, '当前会话未提供模型提交接口，暂不能使用 AI 整理；仍可检查报告内来源与原表。'), isStreaming && h('p', { role: 'status' }, '报告生成中，完成后可整理判断。'), state?.request && h('p', { role: 'status' }, requestLabels[state.request.status]), error && h('p', { role: 'alert' }, error),
      confirm && h('section', { className: 'iexp-research-confirm', 'aria-label': '确认 AI 整理' }, h('p', null, '将使用当前会话可见的模型发送一次整理请求，可能产生模型费用。仅整理这份报告，不会自动开展外部研究或核查网页。'), h('div', { className: 'iexp-research-actions' }, h(Action, { onClick: () => { void organize() }, disabled: busy || isStreaming }, '开始整理'), h(Action, { onClick: () => setConfirm(false) }, '取消整理')))),
    h('div', { className: 'iexp-research-layout', 'data-inspector-open': enabled && !!selection && !narrow },
      h('div', { className: 'iexp-research-main' },
        h('div', { id: `${prefix}-panel-report`, role: enabled ? 'tabpanel' : undefined, 'aria-labelledby': enabled ? `${prefix}-tab-report` : undefined, hidden: enabled && tab !== 'report', className: 'iexp-research-report', ref: reportRoot, tabIndex: -1, onClickCapture: reportLink }, location && h('div', { className: 'iexp-research-location' }, h('p', { role: 'status' }, location.message), location.quote && h('blockquote', { className: 'iexp-research-excerpt' }, location.quote)), children),
        h('section', { id: `${prefix}-panel-judgments`, role: 'tabpanel', 'aria-labelledby': `${prefix}-tab-judgments`, hidden: !enabled || tab !== 'judgments' },
          h('h2', null, '核心判断'), state?.analysis && h('p', { className: 'iexp-research-question' }, state.analysis.question), claims.length ? claims.map(claimView) : empty,
          h('section', { className: 'iexp-research-section' }, h('h2', null, '反对意见与替代解释'), opposition.length ? opposition.map(({ claim, evidence }) => h('div', { className: 'iexp-research-opposition', key: `${claim.id}-${evidence.id}` }, h('p', null, evidence.note || evidence.anchor.quote), h('p', { className: 'iexp-research-muted' }, 'AI 关联，待复核'), sourceButton({ title: `${relations[evidence.relation]} · 待复核`, anchor: evidence.anchor, claimId: claim.id }, '查看反对或限制片段', `${evidence.id}-opposed`))) : h('p', null, '尚无明确整理的反对意见或替代解释。来源列表中的链接不代表支持或反对关系。')),
          h('section', { className: 'iexp-research-section' }, h('h2', null, '待研究问题'), ...queuedQuestions.map((item, index) => h('div', { className: 'iexp-research-question-row', key: index }, h('p', null, item.question), h(Action, { onClick: () => makeDraft(item.question, item.context) }, '拟定追问草稿'))),
            h('label', { htmlFor: `${prefix}-questions` }, '我的问题队列（每行一个）'), h(ResearchField, { id: `${prefix}-questions`, rows: 3, value: questions, disabled: !api || !state, onChange: event => { edit(); setQuestions(event.currentTarget.value) } }),
            h('label', { htmlFor: `${prefix}-question` }, '要继续核查的问题'), h(ThemeInput, { id: `${prefix}-question`, value: newQuestion, onChange: event => setNewQuestion(event.currentTarget.value) }), h(Action, { disabled: !newQuestion.trim(), onClick: () => makeDraft(newQuestion) }, '拟定追问草稿')),
          h('div', { className: 'iexp-research-save' }, h(Action, { disabled: !dirty || !api || !state || busy, icon: 'save', onClick: () => { void save() } }, '保存研究记录'), h('span', { role: 'status' }, saved || (dirty ? '有未保存的修改' : '')))),
        h('section', { id: `${prefix}-panel-sources`, role: 'tabpanel', 'aria-labelledby': `${prefix}-tab-sources`, hidden: !enabled || tab !== 'sources' }, h('h2', null, '报告内来源'), h('p', { className: 'iexp-research-muted' }, '报告内引用，外部原文未核查。仅按当前报告中的链接和脚注定位，不推断证据关系。'), local.sources.length || local.footnotes.length ? h('ol', { className: 'iexp-research-sources' }, ...local.sources.map(source => h('li', { key: source.id }, sourceButton({ title: source.title, anchor: source, url: source.url }, source.title, source.id), h('span', { className: 'iexp-research-muted' }, source.url))), ...local.footnotes.map(source => h('li', { key: source.id }, sourceButton({ title: `脚注 ${source.label}`, anchor: source.definition ?? source }, `脚注 ${source.label}`, `footnote-${source.id}`)))) : h('p', null, '这份报告未包含可识别的链接或脚注。仍可在报告中阅读完整文字。')),
        h('section', { id: `${prefix}-panel-compare`, className: 'iexp-research-compare iexp-content', role: 'tabpanel', 'aria-labelledby': `${prefix}-tab-compare`, hidden: !enabled || tab !== 'compare' }, h('h2', null, '技术比较与原表'), h('p', { className: 'iexp-research-muted' }, '保留原始口径、单位和限定条件；普通表格不自动解释为可比结论。选择单元格可检查报告原文。'), local.tables.length ? local.tables.map((table, tableIndex) => h('section', { className: 'iexp-research-section', key: table.id }, h('h3', null, `原表 ${new Intl.NumberFormat('zh-CN').format(tableIndex + 1)}`), ...table.plans.map((plan, index) => h(AutoChart, { key: index, plan })), h('div', { className: 'iexp-research-table', tabIndex: 0, role: 'region', 'aria-label': `完整原表 ${tableIndex + 1}` }, h('table', null, h('thead', null, h('tr', null, ...table.headers.map((cell, index) => h('th', { key: index, scope: 'col' }, sourceButton({ title: cell, anchor: table.cellAnchors[0]![index]! }, cell || '空表头', `head-${index}`))))), h('tbody', null, ...table.rows.map((row, rowIndex) => h('tr', { key: rowIndex }, ...row.map((cell, column) => h('td', { key: column }, sourceButton({ title: `${table.headers[column] ?? '单元格'} · 原文`, anchor: table.cellAnchors[rowIndex + 1]![column]! }, cell || '空单元格', `cell-${rowIndex}-${column}`)))))))), h('details', null, h('summary', null, '查看完整原始表格与上下文'), h('pre', null, text.slice(Math.max(0, table.start - 240), Math.min(text.length, table.end + 240)))))) : h('p', null, '这份报告没有可识别的 Markdown 表格，请继续阅读原报告。')),
        h('section', { className: 'iexp-research-draft', hidden: !enabled || !draft, 'aria-label': '可复制的追问草稿' }, h('h2', null, '追问草稿'), h('p', { className: 'iexp-research-muted' }, '仅生成草稿；修改后复制，并自行决定是否发送。'), h('label', { htmlFor: `${prefix}-draft` }, '编辑追问草稿'), h(ResearchField, { id: `${prefix}-draft`, rows: 6, value: draft, onChange: event => { setDraft(event.currentTarget.value); setCopied('') } }), h(Action, { icon: 'copy', onClick: () => { void copy() } }, '复制草稿'), h('p', { role: 'status' }, copied))),
      enabled && selection && h('div', { className: `iexp-research-inspector-wrap${narrow ? ' is-modal' : ''}` }, h('aside', { ref: inspector, tabIndex: -1, className: 'iexp-research-inspector', role: narrow ? 'dialog' : 'complementary', 'aria-modal': narrow ? true : undefined, 'aria-labelledby': `${prefix}-inspector-title` }, h('div', { className: 'iexp-research-row' }, h('h2', { id: `${prefix}-inspector-title` }, '来源检查'), h(Action, { onClick: () => { setSelection(undefined); if (!narrow) opener.current?.focus({ preventScroll: true }) }, icon: 'x', 'aria-label': '关闭来源检查' }, '关闭')), h('h3', null, selection.title), h('p', { className: 'iexp-research-muted' }, '报告内引用，外部原文未核查'), h('blockquote', { className: 'iexp-research-excerpt' }, exactAnchor(text, selection.anchor)), selection.relation && h('p', null, selection.relation), h(Action, { icon: 'locate-fixed', onClick: locateReport }, '定位报告片段'), safeUrl(selection.url) && h('a', { href: safeUrl(selection.url), target: '_blank', rel: 'noreferrer' }, '打开来源链接'), activeClaim && h('div', null, h('h3', null, '关联判断'), h('p', null, activeClaim.text), h(Action, { onClick: () => { setTab('judgments'); setSelection(undefined); requestAnimationFrame(() => { const target = document.getElementById(`${prefix}-claim-${activeClaim.id}`); target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' }) }) } }, '回到关联判断')), h('details', null, h('summary', null, '查看片段附近的报告文字'), h('pre', null, text.slice(Math.max(0, selection.anchor.start - 240), Math.min(text.length, selection.anchor.end + 240)))))))))
}
