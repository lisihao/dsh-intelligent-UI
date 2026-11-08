import { refractor } from 'refractor'
import http from 'refractor/http'
import powershell from 'refractor/powershell'
import mermaid from 'refractor/mermaid'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { createElement as h, useState, type ReactElement, type ReactNode } from 'react'
import { unified } from 'unified'

// These declared languages occur in the retained Markdown review documents.
for (const grammar of [http, powershell, mermaid]) refractor.register(grammar)

export interface MarkdownCodeBlockSource {
  /** UTF-16 offsets in the original complete Markdown input, `[start,end)`. */
  readonly start: number
  readonly end: number
  /** Exact MDAST `code.value`; indentation and blank lines are not normalized. */
  readonly value: string
  /** Exact MDAST `code.lang` when the source fence supplied one. */
  readonly language?: string
}

export interface MarkdownCodeBlockProps {
  readonly code: string
  readonly language?: string
  readonly start?: number
  readonly end?: number
}

type MarkdownNode = {
  readonly type: string
  readonly value?: string
  readonly lang?: string | null
  readonly children?: readonly MarkdownNode[]
  readonly position?: { readonly start?: { readonly offset?: number }, readonly end?: { readonly offset?: number } }
}
type HighlightNode = {
  readonly type?: string
  readonly value?: unknown
  readonly tagName?: unknown
  readonly properties?: Readonly<Record<string, unknown>>
  readonly children?: readonly HighlightNode[]
}

const markdown = unified().use(remarkParse).use(remarkGfm)

function codeRange(node: MarkdownNode, sourceLength: number): { start: number, end: number } | undefined {
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceLength) return undefined
  return { start, end }
}

function collectCodeBlocks(node: MarkdownNode, sourceLength: number, output: MarkdownCodeBlockSource[]): void {
  if (node.type === 'code' && typeof node.value === 'string') {
    const range = codeRange(node, sourceLength)
    if (range) output.push({
      ...range,
      value: node.value,
      ...(typeof node.lang === 'string' ? { language: node.lang } : {}),
    })
  }
  for (const child of node.children ?? []) collectCodeBlocks(child, sourceLength, output)
}

/**
 * Reads fenced/indented MDAST code nodes from one complete source document.
 * The output is source metadata only; no code is evaluated, reformatted, or
 * inferred from its contents.
 */
export function markdownCodeBlocks(source: string): readonly MarkdownCodeBlockSource[] {
  const output: MarkdownCodeBlockSource[] = []
  let tree: MarkdownNode
  try {
    tree = markdown.parse(source) as unknown as MarkdownNode
  } catch {
    return output
  }
  collectCodeBlocks(tree, source.length, output)
  return output
}

function highlightText(node: HighlightNode): string {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  return node.children?.map(highlightText).join('') ?? ''
}

function highlightClassName(properties: HighlightNode['properties']): string | undefined {
  const value = properties?.className
  const names = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' ? [value] : []
  return names.length ? names.join(' ') : undefined
}

function renderHighlightNode(node: HighlightNode, path: readonly number[]): ReactNode {
  if (node.type === 'text' && typeof node.value === 'string') return node.value
  const children = (node.children ?? []).map((child, index) => renderHighlightNode(child, [...path, index]))
  if (node.type === 'element' && node.tagName === 'span') {
    const className = highlightClassName(node.properties)
    return h('span', { key: path.join('-'), ...(className ? { className } : {}) }, ...children)
  }
  // Refractor's common grammars emit text and span nodes. Unknown node forms
  // are flattened to their original text descendants rather than treated as
  // HTML, attributes, or executable content.
  return children
}

function highlightedCode(code: string, language: string | undefined): ReactNode {
  if (!language || !refractor.registered(language)) return code
  try {
    const tree = refractor.highlight(code, language) as unknown as HighlightNode
    // A source-preserving guard: never show a partial token tree as though it
    // were the complete code block.
    if (highlightText(tree) !== code) return code
    return (tree.children ?? []).map((node, index) => renderHighlightNode(node, [index]))
  } catch {
    return code
  }
}

function sourceOffset(value: number | undefined): string | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? String(value) : undefined
}

/**
 * A local semantic replacement for one Markdown code block. It renders the
 * original string into a real `pre > code`; refractor contributes only token
 * spans, and the clipboard action copies the exact unmodified source value.
 */
export function MarkdownCodeBlock({ code, language, start, end }: MarkdownCodeBlockProps): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const languageLabel = language && language.length > 0 ? language : '未标注语言'
  const copy = async (): Promise<void> => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard?.writeText) {
      setCopyState('failed')
      return
    }
    try {
      await clipboard.writeText(code)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  const status = copyState === 'copied'
    ? '已复制原始代码。'
    : copyState === 'failed' ? '无法复制原始代码；请手动选择并复制。' : undefined
  return h('section', { className: 'iexp-markdown-code' },
    h('div', { className: 'iexp-markdown-code-header' },
      h('span', { className: 'iexp-markdown-code-language' }, `语言：${languageLabel}`),
      h('button', { type: 'button', className: 'iexp-markdown-code-copy', 'aria-label': '复制原始代码', onClick: () => { void copy() } }, '复制'),
    ),
    status && h('p', { className: 'iexp-markdown-code-status', role: copyState === 'failed' ? 'alert' : 'status' }, status),
    h('pre', null, h('code', {
      ...(language ? { className: `language-${language}`, 'data-iexp-code-language': language } : {}),
      ...(sourceOffset(start) ? { 'data-iexp-code-start': sourceOffset(start) } : {}),
      ...(sourceOffset(end) ? { 'data-iexp-code-end': sourceOffset(end) } : {}),
    }, highlightedCode(code, language))),
  )
}
