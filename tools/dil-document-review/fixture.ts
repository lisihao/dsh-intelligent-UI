import { createElement as h, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@openuidev/react-ui'

import { DilProgramView } from '../../src/dil/view.js'
import { ContentView } from '../../src/presentation.js'
import { installExperienceStyles } from '../../src/style.js'
import type { CompiledDil } from '../../src/dil/compiler.js'
import { appearanceTokens } from '../../src/appearance.js'
import { appearanceSchema } from '../../src/theme-contracts.js'
import { PresentationThemeContext, themeStyleTokens } from '../../src/theme-runtime.js'
import { resolveTheme, themePreferenceSchema, type ThemePackage } from '../../src/theme-contracts.js'
import fixtureCss from './fixture.css'

type ReviewBlock = Readonly<{
  id: string
  start: number
  end: number
  kind: string
  source: string
  choice: Readonly<{ components: readonly string[], reason: string, dilSource: string }>
  compiled?: CompiledDil
  status: 'ready' | 'failed' | 'pending'
  diagnostics?: readonly string[]
  bindings?: unknown
  sourceSha256?: unknown
}>
type ReviewDocument = Readonly<{
  id: string
  fileName: string
  title: string
  sha256: string
  raw: string
  themeId?: string
  blocks: readonly ReviewBlock[]
}>
type ReviewManifest = Readonly<{
  formatVersion: 1
  session: Readonly<{ id: string, model: string, provider: string }>
  documents: readonly ReviewDocument[]
  settings?: unknown
}>
type ReviewConfig = Readonly<{
  state: 'pending' | 'ready' | 'failed'
  message?: string
  frameUrl?: string
  manifest?: ReviewManifest
}>
type ActiveBlock = Readonly<{ documentIndex: number, blockIndex: number }>

declare global {
  interface Window { __dilDocumentReview?: { mounted: number, failures: number } }
}

function styleText(source: string): void {
  const element = document.createElement('style')
  element.dataset.dilDocumentReview = 'true'
  element.textContent = source
  document.head.append(element)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function reviewTheme(document: ReviewDocument, settings: unknown): { theme: ThemePackage, variables: Record<string, string>, mode: 'light' | 'dark', issue?: string } {
  const source = record(settings) ? settings : undefined
  const themeSource = record(source?.theme) ? source.theme : undefined
  const requestedId = document.themeId ?? themeSource?.activeId
  const preference = themePreferenceSchema.safeParse({ activeId: requestedId ?? 'empryo', installed: themeSource?.installed ?? [] })
  if (!preference.success) {
    const theme = resolveTheme()
    const appearance = appearanceTokens(undefined, theme)
    return { theme, variables: themeStyleTokens(theme, appearance), mode: appearance.colorScheme, issue: 'manifest 中的主题目录无效，当前未应用该文档声明的主题。' }
  }
  const theme = resolveTheme(preference.data)
  const parsedAppearance = appearanceSchema.safeParse(source?.appearance)
  const appearance = appearanceTokens(parsedAppearance.success ? parsedAppearance.data : undefined, theme)
  return {
    theme,
    variables: themeStyleTokens(theme, appearance),
    mode: appearance.colorScheme,
    ...(parsedAppearance.success || source?.appearance === undefined ? {} : { issue: 'manifest 中的外观设置无效，已使用该主题的默认外观。' }),
  }
}

function summary(value: string, limit = 72): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function statusText(status: ReviewBlock['status']): string {
  return status === 'ready' ? '可审阅' : status === 'failed' ? '生成失败' : '等待生成结果'
}

function diagnostics(block: ReviewBlock): readonly string[] {
  if (block.diagnostics?.length) return block.diagnostics
  if (block.status === 'ready' && !block.compiled) return ['该块标为可审阅，但 manifest 未附带编译结果。']
  return []
}

function bindingData(block: ReviewBlock): unknown {
  const compiled = block.compiled as unknown as { appData?: { opGenui?: { modelDataBindings?: unknown } } } | undefined
  return compiled?.appData?.opGenui?.modelDataBindings
}

function printable(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

function searchable(document: ReviewDocument, block: ReviewBlock): string {
  return [document.title, document.fileName, block.kind, block.source, block.choice.components.join(' '), block.choice.reason, block.choice.dilSource, ...(block.diagnostics ?? [])].join('\n').toLocaleLowerCase()
}

function BlockDetails({ document, block }: { document: ReviewDocument, block: ReviewBlock }): ReactElement {
  const messages = diagnostics(block)
  return h('details', null,
    h('summary', null, '查看来源、依据与程序'),
    h('p', null, `原文范围：${String(block.start)}–${String(block.end)}；组件：${block.choice.components.join(', ') || '未声明'}。`),
    h('p', null, block.choice.reason ? `模型依据：${block.choice.reason}` : '尚未提供模型依据。'),
    h('pre', { 'data-review-source-start': block.start, 'data-review-source-end': block.end }, block.source),
    h('pre', null, block.choice.dilSource || '未提供 DIL 原始程序。'),
    block.bindings !== undefined && h('details', null, h('summary', null, '查看来源绑定记录'), h('pre', null, printable(block.bindings))),
    bindingData(block) !== undefined && h('details', null, h('summary', null, '查看编译数据绑定'), h('pre', null, printable(bindingData(block)))),
    messages.length > 0 && h('ul', { role: block.status === 'failed' ? 'alert' : undefined }, ...messages.map((message, index) => h('li', { key: index }, message))),
    h('details', null, h('summary', null, '开发定位'), h('p', null, `文件锚点：${document.fileName}#source-${String(block.start)}-${String(block.end)}`)),
  )
}

function ActiveReview({ document, block, blockIndex, frameUrl }: { document: ReviewDocument, block: ReviewBlock, blockIndex: number, frameUrl?: string }): ReactElement {
  const canRun = block.status === 'ready' && !!block.compiled && !!frameUrl
  const messages = diagnostics(block)
  const markdown = (source: string): ReactNode => h(ContentView, { value: source, decide: false, embedded: true })
  return h('article', { className: 'dil-review-block', 'data-review-active-block': true, 'data-review-active-block-index': blockIndex, 'data-review-status': block.status },
    h('div', { className: 'dil-review-block-toolbar' },
      h('h3', null, `${block.kind} · 原文范围 ${String(block.start)}–${String(block.end)}`),
      h('span', { className: 'dil-review-status', 'data-status': block.status }, statusText(block.status))),
    h('p', null, `使用组件：${block.choice.components.join(', ') || '未声明'}。`),
    h('p', null, block.choice.reason ? `模型依据：${block.choice.reason}` : '尚未提供模型依据。'),
    messages.length > 0 && h('ul', { role: block.status === 'failed' || !canRun ? 'alert' : undefined }, ...messages.map((message, index) => h('li', { key: index }, message))),
    canRun
      ? h(DilProgramView, {
        source: block.choice.dilSource,
        compiled: block.compiled!,
        enabled: true,
        artifactId: block.id,
        sessionId: document.id,
        frameUrl,
        renderMarkdown: markdown,
      })
      : h('p', { role: block.status === 'failed' || block.status === 'ready' ? 'alert' : 'status' }, block.status === 'pending' ? '该块仍在等待生成结果，未启动界面程序。' : '该块未能启动界面程序；原始来源、程序和诊断保留在下方。'),
    h(BlockDetails, { document, block }),
  )
}

function DocumentReview({ document, documentIndex, frameUrl }: { document: ReviewDocument, documentIndex: number, frameUrl?: string }): ReactElement {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<ActiveBlock>()
  const matching = useMemo(() => document.blocks.filter(block => !query.trim() || searchable(document, block).includes(query.trim().toLocaleLowerCase())), [document, query])
  const activeBlock = active?.documentIndex === documentIndex ? document.blocks[active.blockIndex] : undefined
  return h('section', { className: 'dil-review-layout', 'data-review-document-index': documentIndex },
    h('aside', { className: 'dil-review-sidebar' },
      h('h2', null, document.title),
      h('p', { className: 'dil-review-meta' }, `${document.fileName} · ${String(document.blocks.length)} 个块`),
      h('input', { className: 'dil-review-search', value: query, placeholder: '搜索来源、组件或模型依据', 'aria-label': '搜索来源、组件或模型依据', onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value) }),
      h('p', { className: 'dil-review-meta' }, `显示 ${String(matching.length)} / ${String(document.blocks.length)} 个块`),
      h('div', { className: 'dil-review-block-list' }, ...matching.map(block => {
        const blockIndex = document.blocks.indexOf(block)
        const selected = active?.documentIndex === documentIndex && active.blockIndex === blockIndex
        return h('article', { key: block.id, 'data-review-block-index': blockIndex, 'data-review-block-status': block.status },
          h('button', { type: 'button', 'aria-pressed': selected, onClick: () => setActive({ documentIndex, blockIndex }) }, `${block.kind} · ${summary(block.source)}`),
          h('p', { className: 'dil-review-meta' }, `${statusText(block.status)} · ${String(block.start)}–${String(block.end)}`),
          h(BlockDetails, { document, block }))
      })),
    ),
    h('main', null,
      activeBlock
        ? h(ActiveReview, { document, block: activeBlock, blockIndex: active.blockIndex, frameUrl })
        : h('p', { className: 'dil-review-empty', role: 'status' }, '从左侧选择一个块以启动单一隔离预览。完整块清单、来源和模型依据始终可查看。'),
      h('section', { className: 'dil-review-raw' }, h('details', null, h('summary', null, '查看完整原始 Markdown'), h('pre', null, document.raw))),
    ),
  )
}

function ReviewApp({ config }: { config: ReviewConfig }): ReactElement {
  const [documentIndex, setDocumentIndex] = useState(0)
  if (config.state !== 'ready' || !config.manifest) return h('main', { className: 'dil-review-app', 'data-review-state': config.state },
    h('h1', null, 'DIL 文档审阅'),
    h('p', { className: 'dil-review-pending', role: config.state === 'failed' ? 'alert' : 'status' }, config.message ?? '等待本地 manifest。未调用模型或外部服务。'))
  const document = config.manifest.documents[documentIndex]
  if (!document) return h('main', { className: 'dil-review-app', 'data-review-state': 'failed' }, h('p', { role: 'alert' }, 'manifest 未包含可审阅文档。'))
  const themed = reviewTheme(document, config.manifest.settings)
  const themeLabel = document.themeId ? `文档声明主题：${themed.theme.name}` : `文档未声明主题；按 manifest 设置渲染：${themed.theme.name}`
  return h(PresentationThemeContext.Provider, { value: themed.theme }, h(ThemeProvider, { cssSelector: '.dsh-experience', mode: themed.mode }, h('main', { className: 'dil-review-app dsh-experience iexp-content', style: themed.variables as CSSProperties, 'data-review-state': 'ready', 'data-review-theme': themed.theme.id },
    h('header', { className: 'dil-review-header' },
      h('div', null, h('h1', null, 'DIL 文档审阅'), h('p', { className: 'dil-review-meta' }, `会话结果：${config.manifest.session.model} / ${config.manifest.session.provider}`), h('p', { className: 'dil-review-meta' }, themeLabel)),
      h('p', { className: 'dil-review-meta' }, '只读取本地 manifest；不触发模型调用。')),
    themed.issue && h('p', { role: 'alert' }, themed.issue),
    h('nav', { className: 'dil-review-document-picker', 'aria-label': '审阅文档' }, ...config.manifest.documents.map((candidate, index) => h('button', { key: candidate.id, type: 'button', 'data-review-document-picker-index': index, 'aria-pressed': index === documentIndex, onClick: () => setDocumentIndex(index) }, candidate.title))),
    h(DocumentReview, { document, documentIndex, frameUrl: config.frameUrl }),
  )))
}

styleText(fixtureCss)
installExperienceStyles()
const response = await fetch('/api/review', { cache: 'no-store' })
if (!response.ok) throw new Error(`DIL_DOCUMENT_REVIEW_CONFIG_FAILED:${String(response.status)}`)
const config = await response.json() as ReviewConfig
window.__dilDocumentReview = { mounted: 0, failures: 0 }
const root = document.querySelector('#root')
if (!root) throw new Error('DIL_DOCUMENT_REVIEW_ROOT_MISSING')
createRoot(root).render(h(ReviewApp, { config }))
