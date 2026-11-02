import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'
import { isEvidenceVisualLabel } from './visual-semantics.js'

export interface MarkdownIllustration {
  readonly start: number
  readonly url: string
  readonly alt: string
  readonly title?: string
  readonly mime: 'image/png' | 'image/jpeg'
}

const markdown = unified().use(remarkParse).use(remarkGfm)
const illustrationLabel = /(?:\billustration\b|\bdecorative\b|插画|插畫)/iu

/** Identify only a complete, unlinked image paragraph that explicitly describes an illustration. */
export function markdownIllustrations(text: string): readonly MarkdownIllustration[] {
  if (text.length > 500_000) return []
  const tree = markdown.parse(text) as Root
  const result: MarkdownIllustration[] = []
  for (const node of tree.children) {
    if (node.type !== 'paragraph' || node.children.length !== 1 || node.children[0]?.type !== 'image') continue
    const image = node.children[0], start = node.position?.start.offset
    const alt = image.alt ?? ''
    if (start === undefined || !image.url || !illustrationLabel.test(alt) || isEvidenceVisualLabel(alt)) continue
    let mime: MarkdownIllustration['mime'] | undefined
    const dataType = /^data:(image\/(?:png|jpeg))(?:;|,)/iu.exec(image.url)?.[1]?.toLowerCase()
    if (dataType === 'image/png' || dataType === 'image/jpeg') mime = dataType
    else {
      try {
        const url = new URL(image.url, 'https://illustration.invalid/')
        if (!['https:', 'http:', 'dsh-app:'].includes(url.protocol)) continue
        const path = url.pathname.toLowerCase()
        if (path.endsWith('.png')) mime = 'image/png'
        else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) mime = 'image/jpeg'
      } catch { /* The original Markdown renderer remains responsible for this URL. */ }
    }
    if (mime) result.push({ start, url: image.url, alt, mime, ...(image.title ? { title: image.title } : {}) })
  }
  return result
}
