import { createElement as h, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { ThemeProvider } from '@openuidev/react-ui'
import { DilNativeTreeView, DilProgramView, type DilTreeNode } from '../../src/dil/view.js'
import { markdownCodeBlocks } from '../../src/markdown-code.js'
import { ContentView } from '../../src/presentation.js'
import type { CompiledDil } from '../../src/dil/compiler.js'
import { appearanceTokens } from '../../src/appearance.js'
import { appearanceSchema, resolveTheme, themePreferenceSchema, type ThemePackage } from '../../src/theme-contracts.js'
import { PresentationThemeContext, themeStyleTokens } from '../../src/theme-runtime.js'

type ReviewBlock = Readonly<{ id: string, start: number, end: number, kind: string, source: string,
  choice: Readonly<{ components: readonly string[], reason: string, dilSource: string }>, compiled?: CompiledDil,
  status: 'ready' | 'failed' | 'pending', diagnostics?: readonly string[], bindings?: unknown, sourceSha256?: unknown }>
type ReviewDocument = Readonly<{ id: string, fileName: string, title: string, sha256: string, raw: string, themeId?: string, blocks: readonly ReviewBlock[] }>
type ReviewManifest = Readonly<{ formatVersion: 1, session: Readonly<{ id: string, model: string, provider: string }>, documents: readonly ReviewDocument[], settings?: unknown }>
export type ReviewConfig = Readonly<{ state: 'pending' | 'ready' | 'failed', message?: string, frameUrl?: string, manifest?: ReviewManifest }>
type Snapshot = Readonly<{ tree: DilTreeNode, interactive: boolean }>
type DocumentCache = Map<string, Snapshot>

declare global { interface Window { __dilDocumentReview?: { mounted: number, failures: number } } }
const markdown = (source: string): ReactNode => h(ContentView, { value: source, decide: false, embedded: true })
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function reviewTheme(document: ReviewDocument, settings: unknown): { theme: ThemePackage, variables: Record<string, string>, mode: 'light' | 'dark', issue?: string } {
  const source = record(settings) ? settings : undefined, themeSource = record(source?.theme) ? source.theme : undefined
  const preference = themePreferenceSchema.safeParse({ activeId: document.themeId ?? themeSource?.activeId ?? 'empryo', installed: themeSource?.installed ?? [] })
  const theme = preference.success ? resolveTheme(preference.data) : resolveTheme()
  const parsed = appearanceSchema.safeParse(source?.appearance), appearance = appearanceTokens(parsed.success ? parsed.data : undefined, theme)
  return { theme, variables: themeStyleTokens(theme, appearance), mode: appearance.colorScheme,
    ...(!preference.success ? { issue: '文档主题设置无法读取，当前使用默认显示主题。' } : {}) }
}
function summary(value: string, limit = 58): string {
  const text = value.replace(/^\s*#{1,6}\s*/u, '').replace(/\s+/gu, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}
function printable(value: unknown): string { try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) } }
function bindingData(block: ReviewBlock): unknown { return (block.compiled as unknown as { appData?: { opGenui?: { modelDataBindings?: unknown } } })?.appData?.opGenui?.modelDataBindings }
function hasInteraction(tree: DilTreeNode): boolean {
  if (tree.t === '#text') return false
  if (tree.t === '#frag') return tree.c.some(hasInteraction)
  return tree.t === 'form' || Object.keys(tree.p ?? {}).some(key => key.startsWith('on')) || (tree.c ?? []).some(hasInteraction)
}
function codeMatchesSource(block: ReviewBlock, tree: DilTreeNode): boolean {
  if (block.kind !== 'code') return true
  const expected = markdownCodeBlocks(block.source).map(item => item.value)
  const rendered: string[] = []
  const plain = (node: DilTreeNode): string => node.t === '#text' ? node.v : (node.c ?? []).map(plain).join('')
  const visit = (node: DilTreeNode): void => {
    if (node.t === '#text') return
    if (node.t === 'code') rendered.push((node.c ?? []).map(plain).join(''))
    if (node.t === 'markdown' && typeof node.p?.source === 'string') rendered.push(...markdownCodeBlocks(node.p.source).map(item => item.value))
    ;(node.c ?? []).forEach(visit)
  }
  visit(tree)
  return expected.length > 0 && expected.every(value => rendered.includes(value))
}
function searchable(block: ReviewBlock): string { return [block.source, block.kind, ...block.choice.components, block.choice.reason].join('\n').toLocaleLowerCase() }
function BlockDetails({ block }: { block: ReviewBlock }): ReactElement {
  return h('div', { className: 'dil-review-evidence' },
    h('section', null, h('h3', null, '选择的组件'), h('p', { className: 'dil-review-components' }, block.choice.components.join(' / ') || '未声明组件')),
    h('section', null, h('h3', null, '模型的选择依据'), h('p', null, block.choice.reason || '原结果未提供选择依据。')),
    h('p', { className: 'dil-review-meta' }, `原文字符范围 ${block.start}–${block.end}`),
    h('details', null, h('summary', null, '原始内容'), h('pre', { 'data-review-source-start': block.start, 'data-review-source-end': block.end }, block.source)),
    h('details', null, h('summary', null, '界面程序'), h('pre', null, block.choice.dilSource || '未提供界面程序。')),
    block.bindings !== undefined && h('details', null, h('summary', null, '来源绑定'), h('pre', null, printable(block.bindings))),
    bindingData(block) !== undefined && h('details', null, h('summary', null, '编译数据'), h('pre', null, printable(bindingData(block)))),
    !!block.diagnostics?.length && h('p', { role: 'alert' }, block.diagnostics.join('；')))
}
const SnapshotView = memo(function SnapshotView({ snapshot, block, document }: { snapshot: Snapshot, block: ReviewBlock, document: ReviewDocument }): ReactElement {
  return h('div', { 'data-review-block-snapshot': true }, h(DilNativeTreeView, { tree: snapshot.tree, artifactId: block.id, sessionId: document.id, ownedHandlerIds: [], ownedFormActionIds: [], renderMarkdown: markdown }, markdown(block.source)))
})
function DocumentReview({ document, documentIndex, frameUrl, cache, settings }: { document: ReviewDocument, documentIndex: number, frameUrl?: string, cache: DocumentCache, settings: unknown }): ReactElement {
  const [query, setQuery] = useState(''), [selectedIndex, setSelectedIndex] = useState(0), [inspectorOpen, setInspectorOpen] = useState(false)
  const [revision, setRevision] = useState(0), [failures, setFailures] = useState<ReadonlyMap<string, string>>(() => new Map()), [liveId, setLiveId] = useState<string>()
  const localStates = useRef(new Map<string, Record<string, unknown>>())
  const wasInspecting = useRef(false)
  useEffect(() => {
    if (inspectorOpen) globalThis.document.querySelector<HTMLInputElement>('[data-review-inspector] input')?.focus({ preventScroll: true })
    else if (wasInspecting.current) globalThis.document.querySelector<HTMLButtonElement>('[data-review-inspect-toggle]')?.focus({ preventScroll: true })
    wasInspecting.current = inspectorOpen
  }, [inspectorOpen])
  const themed = useMemo(() => reviewTheme(document, settings), [document, settings])
  const matching = useMemo(() => document.blocks.filter(block => !query.trim() || searchable(block).includes(query.trim().toLocaleLowerCase())), [document, query])
  const queueBlock = useMemo(() => document.blocks.find(block => block.status === 'ready' && block.compiled && !cache.has(block.id) && !failures.has(block.id)), [document, cache, failures, revision])
  const runningBlock = liveId ? document.blocks.find(block => block.id === liveId) : queueBlock
  const selected = document.blocks[selectedIndex]
  const ready = document.blocks.filter(block => cache.has(block.id)).length
  const failedCount = document.blocks.filter(block => failures.has(block.id) || block.status === 'failed').length
  const progress = !queueBlock && !liveId ? (failedCount ? `已呈现 ${ready} 块，${failedCount} 块保留原文` : `${ready} 个内容块已呈现`) : `正在准备界面 ${ready} / ${document.blocks.length}`
  const failBlock = useCallback((id: string, reason: string) => { setFailures(current => new Map(current).set(id, reason)); setLiveId(current => current === id ? undefined : current) }, [])
  const acceptSnapshot = useCallback((id: string, tree: DilTreeNode) => {
    const block = document.blocks.find(candidate => candidate.id === id)
    if (block && !codeMatchesSource(block, tree)) {
      failBlock(id, 'DIL_CODE_SOURCE_MISMATCH：界面程序的代码内容与原文不一致，已显示原始代码。原程序与模型依据仍可查看。')
      return
    }
    cache.set(id, { tree, interactive: hasInteraction(tree) }); setRevision(value => value + 1)
  }, [cache, document, failBlock])
  useEffect(() => {
    if (!runningBlock || liveId) return
    const id = runningBlock.id, timer = setTimeout(() => failBlock(id, '本地界面程序未在规定时间内返回，原文仍可阅读。'), 15000)
    return () => clearTimeout(timer)
  }, [runningBlock?.id, liveId, failBlock])
  useEffect(() => { window.__dilDocumentReview = { mounted: ready, failures: failures.size } }, [ready, failures.size])
  const choose = (index: number) => {
    setSelectedIndex(index)
    if (window.matchMedia('(max-width: 1100px)').matches) setInspectorOpen(false)
    requestAnimationFrame(() => documentElement(index)?.scrollIntoView({ block: 'start', behavior: 'auto' }))
  }
  const documentElement = (index: number) => globalThis.document.querySelector<HTMLElement>(`[data-review-reader-block="${index}"]`)
  return h('section', { className: 'dil-review-workspace', 'data-review-document-index': documentIndex, 'data-inspector-open': String(inspectorOpen), onKeyDown: (event: { key: string, preventDefault(): void }) => { if (inspectorOpen && event.key === 'Escape') { event.preventDefault(); setInspectorOpen(false) } } },
    h('div', { className: 'dil-review-reading-column' },
      h('div', { className: 'dil-review-reading-toolbar' },
        h('div', { className: 'dil-review-reading-caption' }, h('span', null, document.fileName), h('span', { className: 'dil-review-meta', 'data-review-progress': true }, progress)),
        h('button', { type: 'button', 'data-review-inspect-toggle': true, 'aria-expanded': inspectorOpen, 'aria-controls': 'review-inspector', onClick: () => setInspectorOpen(value => !value) }, inspectorOpen ? '收起依据' : '选择与依据')),
      themed.issue && h('p', { role: 'alert' }, themed.issue),
      h(PresentationThemeContext.Provider, { value: themed.theme }, h(ThemeProvider, { cssSelector: '.dil-review-document-surface', mode: themed.mode },
        h('div', { className: 'dsh-experience iexp-content dil-review-document-surface', style: themed.variables as CSSProperties, 'data-review-theme': themed.theme.id, 'data-iexp-theme': themed.theme.id },
          document.blocks.length === 0 && h('p', { role: 'status' }, '这份文档尚无内容块，可在下方查看原文。'),
          ...document.blocks.map((block, index) => {
            const snapshot = cache.get(block.id), running = runningBlock?.id === block.id, failure = failures.get(block.id)
            const renderState = failure || block.status === 'failed' ? 'failed' : snapshot ? 'ready' : running ? 'running' : 'queued'
            return h('article', { key: block.id, className: 'dil-review-reader-block', 'data-review-reader-block': index, 'data-review-render-state': renderState, 'data-review-recovery': failure?.startsWith('DIL_CODE_SOURCE_MISMATCH') ? 'source-code' : undefined, 'data-review-failure': failure, 'data-review-active-block': selectedIndex === index ? true : undefined, 'data-review-active-block-index': selectedIndex === index ? index : undefined, 'data-review-status': block.status },
              liveId === block.id && h('div', { className: 'dil-review-block-actions' }, h('button', { type: 'button', onClick: () => setLiveId(undefined) }, '结束交互')),
              running && block.compiled && frameUrl
                ? h(DilProgramView, { key: block.id, source: block.choice.dilSource, compiled: block.compiled, enabled: true, artifactId: block.id, sessionId: document.id, frameUrl, initialState: localStates.current.get(block.id), onStateChange: state => { localStates.current.set(block.id, state) }, onSnapshot: tree => acceptSnapshot(block.id, tree), onRuntimeFailure: reason => failBlock(block.id, reason), renderMarkdown: markdown, renderFallback: markdown(block.source) })
                : snapshot && !snapshot.interactive ? h(SnapshotView, { snapshot, block, document }) : h('div', { 'data-review-source-preview': true }, markdown(block.source)),
              snapshot?.interactive && liveId !== block.id && h('button', { type: 'button', onClick: () => setLiveId(block.id) }, '运行此块交互'),
              (failure || block.status !== 'ready') && h('p', { className: 'dil-review-runtime-error', role: failure || block.status === 'failed' ? 'alert' : 'status' }, failure?.replace(/^DIL_CODE_SOURCE_MISMATCH：/u, '') || block.diagnostics?.join('；') || '该块尚未生成，当前显示原文。'))
          })))),
      h('footer', { className: 'dil-review-document-footer' }, h('p', null, '已保留完整原文与每个内容块的模型依据。'), h('details', { className: 'dil-review-raw' }, h('summary', null, '查看完整原始 Markdown'), h('pre', null, document.raw)))),
    h('aside', { id: 'review-inspector', className: 'dil-review-inspector', 'data-review-inspector': true, hidden: !inspectorOpen, 'aria-label': '内容块选择与依据' },
      h('div', { className: 'dil-review-inspector-heading' }, h('h2', null, '选择与依据'), h('button', { type: 'button', 'aria-label': '关闭选择与依据', onClick: () => setInspectorOpen(false) }, '关闭')),
      h('input', { className: 'dil-review-search', value: query, placeholder: '搜索内容或组件', 'aria-label': '搜索来源、组件或模型依据', onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value) }),
      h('p', { className: 'dil-review-meta' }, `${matching.length} / ${document.blocks.length} 个内容块`),
      h('div', { className: 'dil-review-block-list' }, ...matching.map(block => { const index = document.blocks.indexOf(block); return h('div', { key: block.id, 'data-review-block-index': index, 'data-review-block-status': block.status }, h('button', { type: 'button', 'aria-pressed': selectedIndex === index, onClick: () => choose(index) }, h('span', { className: 'dil-review-block-number' }, index + 1), h('span', null, summary(block.source)))) })),
      selected && h('div', { className: 'dil-review-selected-evidence' }, h('h2', null, `内容块 ${selectedIndex + 1}`), h(BlockDetails, { block: selected }))))
}
export function ReviewApp({ config }: { config: ReviewConfig }): ReactElement {
  const [documentIndex, setDocumentIndex] = useState(() => { const requested = new URLSearchParams(location.search).get('document'); const index = config.manifest?.documents.findIndex(document => document.id === requested) ?? -1; return Math.max(0, index) })
  const caches = useRef(new Map<string, DocumentCache>())
  if (config.state !== 'ready' || !config.manifest || !config.manifest.documents.length) return h('main', { className: 'dil-review-app dil-review-unavailable', 'data-review-state': config.state }, h('h1', null, '智能 UI 文档预览'), h('p', { role: config.state === 'failed' ? 'alert' : 'status' }, config.message ?? '尚无可预览文档。未调用模型或外部服务。'), h('button', { type: 'button', onClick: () => location.reload() }, '重新读取'))
  const document = config.manifest.documents[documentIndex]!, cacheKey = `${document.id}:${document.sha256}`
  if (!caches.current.has(cacheKey)) caches.current.set(cacheKey, new Map())
  const selectDocument = (index: number) => { setDocumentIndex(index); const url = new URL(location.href); url.searchParams.set('document', config.manifest!.documents[index]!.id); history.replaceState(null, '', url); window.scrollTo({ top: 0, behavior: 'auto' }) }
  return h('main', { className: 'dil-review-app', 'data-review-state': 'ready', 'data-review-mode': 'reading' },
    h('header', { className: 'dil-review-app-header' }, h('h1', null, '智能 UI'), h('span', null, '文档预览'), h('span', { className: 'dil-review-provenance' }, '真实会话模型结果')),
    h('div', { className: 'dil-review-app-grid' },
      h('nav', { className: 'dil-review-library', 'aria-label': '审阅文档' }, h('h2', null, '文档'), h('label', { className: 'dil-review-document-select-label' }, '文档', h('select', { value: documentIndex, 'data-review-document-select': true, 'aria-label': '选择预览文档', onChange: (event: { currentTarget: HTMLSelectElement }) => selectDocument(Number(event.currentTarget.value)) }, ...config.manifest.documents.map((candidate, index) => h('option', { key: candidate.id, value: index }, candidate.title)))), ...config.manifest.documents.map((candidate, index) => h('button', { key: candidate.id, type: 'button', title: candidate.title, 'data-review-document-picker-index': index, 'aria-pressed': index === documentIndex, onClick: () => selectDocument(index) }, h('span', { className: 'dil-review-document-title' }, candidate.title), h('span', { className: 'dil-review-meta' }, `${candidate.blocks.length} 个内容块`))), h('p', { className: 'dil-review-library-note' }, '模型选择与理由保持原样。预览不会调用模型。')),
      h(DocumentReview, { key: cacheKey, document, documentIndex, frameUrl: config.frameUrl, cache: caches.current.get(cacheKey)!, settings: config.manifest.settings })))
}
