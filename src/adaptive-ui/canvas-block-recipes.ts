import { MAX_CANVAS_CAPTURE_ELEMENTS } from '../canvas-capture-limits.js'
import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { CANVAS_HTML_EFFECT_NAMES } from '../canvas-html-names.js'

/**
 * These IDs are executable renderer recipes. They are deliberately separate
 * from a planner's eligibility result: some recipes need actual mounted-DOM
 * geometry that a source-only planner cannot prove.
 */
const htmlPresentationIds = CANVAS_HTML_EFFECT_NAMES.map(slug => `canvas-${slug}` as const)
export const CANVAS_BLOCK_PRESENTATION_IDS = [
  ...htmlPresentationIds,
  'canvas-bend',
  'canvas-hex-float',
  'canvas-particle-scroll',
] as const

export type CanvasBlockPresentationId = typeof CANVAS_BLOCK_PRESENTATION_IDS[number]

export interface CanvasBlockCandidate {
  readonly id: CanvasBlockPresentationId
  readonly purpose: string
  /** Facts established from the owned source and browser capability input. */
  readonly evidence: readonly string[]
}

export interface CanvasBlockCapabilities {
  readonly webgl: boolean
  readonly reducedMotion: boolean
}

export interface CanvasBlockEligibility {
  readonly candidates: readonly CanvasBlockCandidate[]
  /** Reasons are source/capability facts, not a model rewrite or a theme rule. */
  readonly reasons: readonly string[]
}

export interface CanvasDecorativeColorSource {
  readonly role: 'decorative'
  /** An explicitly supplied, opaque visual color; no image URL is accepted. */
  readonly color: string | readonly [number, number, number]
}

export interface CanvasDecorativeColor {
  readonly cssColor: string
  readonly rgb: readonly [number, number, number]
}

export const MAX_CANVAS_BLOCK_SOURCE_CHARACTERS = 1_500
export const MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS = 4
export const MIN_CANVAS_PARTICLE_SCROLL_SOURCE_LINES = 12

const markdownParser = unified().use(remarkParse).use(remarkGfm)
const allowedMarkdownNodes = new Set([
  'root', 'paragraph', 'text', 'emphasis', 'strong',
  'inlineCode', 'list', 'listItem', 'break',
])
const prohibitedMarkdownNodes = new Map<string, string>([
  // The production Markdown renderer supplies a live copy control for fences.
  ['code', 'source:host-code-control'],
  ['heading', 'source:host-heading-navigation'],
  ['blockquote', 'source:unsupported-capture-blockquote'],
  ['delete', 'source:unsupported-capture-delete'],
  ['thematicBreak', 'source:unsupported-capture-rule'],
  ['link', 'source:markdown-link'],
  ['linkReference', 'source:markdown-link-reference'],
  ['definition', 'source:markdown-definition'],
  ['image', 'source:markdown-image'],
  ['imageReference', 'source:markdown-image-reference'],
  ['html', 'source:markdown-raw-html'],
  ['table', 'source:markdown-table'],
  ['tableRow', 'source:markdown-table'],
  ['tableCell', 'source:markdown-table'],
  ['footnoteDefinition', 'source:markdown-footnote'],
  ['footnoteReference', 'source:markdown-footnote'],
])

type MarkdownNode = {
  readonly type?: unknown
  readonly children?: unknown
  readonly checked?: unknown
}
type MarkdownInspection = { readonly failures: readonly string[], readonly paragraphs: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Accept a compiler block without mistaking an arbitrary source record for one. */
function compilerOwnedValue(value: unknown): unknown {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string'
    || !Array.isArray(value.path) || !Array.isArray(value.evidence) || typeof value.passive !== 'boolean'
    || !Object.hasOwn(value, 'value')) return value
  return value.value
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function inspectMarkdown(value: string): MarkdownInspection {
  let root: MarkdownNode
  try { root = markdownParser.parse(value) as unknown as MarkdownNode }
  catch { return { failures: ['source:markdown-parse-failed'], paragraphs: 0 } }
  const failures = new Set<string>()
  let paragraphs = 0, elements = 1 // The owned capture container is one DOM element.
  const visit = (node: unknown): void => {
    if (!isRecord(node) || typeof node.type !== 'string') { failures.add('source:markdown-unknown-node'); return }
    const type = node.type
    if (type !== 'root' && type !== 'text') elements++
    const typed = node as MarkdownNode
    const prohibited = prohibitedMarkdownNodes.get(type)
    if (prohibited) failures.add(prohibited)
    else if (!allowedMarkdownNodes.has(type)) failures.add(`source:markdown-unsupported-${type}`)
    if (type === 'paragraph') paragraphs++
    if (type === 'listItem' && (typed.checked === true || typed.checked === false)) failures.add('source:markdown-control')
    if (typed.children !== undefined) {
      if (!Array.isArray(typed.children)) failures.add('source:markdown-invalid-children')
      else for (const child of typed.children) visit(child)
    }
  }
  visit(root)
  if (elements > MAX_CANVAS_CAPTURE_ELEMENTS) failures.add('source:capture-element-limit')
  return { failures: [...failures], paragraphs }
}

function hexColor(value: string): CanvasDecorativeColor | undefined {
  const match = /^#(?:([\da-f])([\da-f])([\da-f])|([\da-f]{2})([\da-f]{2})([\da-f]{2}))$/iu.exec(value.trim())
  if (!match) return undefined
  const rgb = match[1]
    ? [match[1], match[2], match[3]].map(channel => Number.parseInt(channel! + channel!, 16)) as [number, number, number]
    : [match[4], match[5], match[6]].map(channel => Number.parseInt(channel!, 16)) as [number, number, number]
  return { cssColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, rgb }
}

function rgbColor(value: string): CanvasDecorativeColor | undefined {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu.exec(value.trim())
  if (!match) return undefined
  const rgb = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
  if (rgb.some(channel => channel < 0 || channel > 255)) return undefined
  return { cssColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, rgb }
}

function tupleColor(value: unknown): CanvasDecorativeColor | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some(channel => typeof channel !== 'number' || !Number.isFinite(channel))) return undefined
  const values = value as readonly number[]
  const normalized = values.every(channel => channel >= 0 && channel <= 1)
  if (!normalized && values.some(channel => channel < 0 || channel > 255 || !Number.isInteger(channel))) return undefined
  const rgb = values.map(channel => normalized ? Math.round(channel * 255) : channel) as [number, number, number]
  return { cssColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, rgb }
}

/**
 * A Magnify source is a strict decorative color record. Its eventual swatch
 * can be empty of text while the full source record remains rendered beside it.
 */
export function canvasDecorativeColor(value: unknown): CanvasDecorativeColor | undefined {
  const source = compilerOwnedValue(value)
  if (!isRecord(source) || source.role !== 'decorative' || !Object.hasOwn(source, 'color')) return undefined
  const keys = Object.keys(source)
  if (keys.length !== 2 || keys.some(key => key !== 'role' && key !== 'color')) return undefined
  return typeof source.color === 'string' ? hexColor(source.color) ?? rgbColor(source.color) : tupleColor(source.color)
}

export function isCanvasBlockPresentationId(value: string): value is CanvasBlockPresentationId {
  return (CANVAS_BLOCK_PRESENTATION_IDS as readonly string[]).includes(value)
}

function htmlCandidate(slug: typeof CANVAS_HTML_EFFECT_NAMES[number], evidence: readonly string[]): CanvasBlockCandidate {
  return {
    id: `canvas-${slug}` as CanvasBlockPresentationId,
    purpose: `Canvas ${slug} visual-only projection of the retained source.`,
    evidence,
  }
}

/**
 * Purely determine which effects a planner may offer. It never rewrites,
 * summarizes, or invents a visual source. The mounted view still checks the
 * separate-region and overflow constraints before it starts an effect.
 */
export function canvasBlockEligibility(value: unknown, capabilities: CanvasBlockCapabilities, isStreaming = false): CanvasBlockEligibility {
  const reasons: string[] = []
  if (capabilities.webgl !== true) reasons.push('capability:webgl=false')
  if (capabilities.reducedMotion === true) reasons.push('capability:reduced-motion=true')
  if (isStreaming) reasons.push('source:streaming=true')
  if (reasons.length) return { candidates: [], reasons }

  const source = compilerOwnedValue(value)
  const decorative = canvasDecorativeColor(source)
  if (decorative) {
    const evidence = ['capability:webgl=true', 'capability:reduced-motion=false', 'source:decorative-color', 'source:text-free-swatch']
    return {
      candidates: [{
        id: 'canvas-magnify',
        purpose: 'Canvas magnify visual-only projection of an explicit decorative color swatch.',
        evidence,
      }],
      reasons: evidence,
    }
  }
  if (typeof source !== 'string') return { candidates: [], reasons: ['source:not-noninteractive-markdown-or-decoration'] }
  const length = codePointLength(source)
  if (!source.trim()) return { candidates: [], reasons: ['source:empty'] }
  if (length > MAX_CANVAS_BLOCK_SOURCE_CHARACTERS) return { candidates: [], reasons: [`source:length>${MAX_CANVAS_BLOCK_SOURCE_CHARACTERS}`] }
  const markdown = inspectMarkdown(source)
  if (markdown.failures.length) return { candidates: [], reasons: markdown.failures }
  const sourceLines = source.split(/\r?\n/u).filter(line => line.trim().length > 0).length
  const particleEligible = markdown.paragraphs >= MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS
    || sourceLines >= MIN_CANVAS_PARTICLE_SCROLL_SOURCE_LINES
  const evidence = [
    'capability:webgl=true',
    'capability:reduced-motion=false',
    'source:markdown-noninteractive',
    `source:length=${length}`,
  ]
  const candidates: CanvasBlockCandidate[] = [
    // Magnify intentionally stays unavailable for all text and numeric source.
    ...CANVAS_HTML_EFFECT_NAMES
      .filter(slug => slug !== 'magnify')
      .map(slug => htmlCandidate(slug, evidence)),
    {
      id: 'canvas-bend',
      purpose: 'Canvas Bend isolated visual-only projection of the retained source.',
      evidence,
    },
    {
      id: 'canvas-hex-float',
      purpose: 'Canvas Hex Float isolated visual-only projection of the retained source.',
      evidence,
    },
  ]
  const selectionReasons = [...evidence]
  if (particleEligible) {
    candidates.push({
      id: 'canvas-particle-scroll',
      purpose: 'Canvas Particle Scroll visual-only projection of the retained, sufficiently long source.',
      evidence: [...evidence, `source:paragraphs=${markdown.paragraphs}`, `source:nonempty-lines=${sourceLines}`],
    })
  } else {
    selectionReasons.push(`source:particle-scroll-requires-${MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS}-paragraphs-or-${MIN_CANVAS_PARTICLE_SCROLL_SOURCE_LINES}-lines`)
  }
  return { candidates, reasons: selectionReasons }
}

export function canvasBlockCandidates(value: unknown, capabilities: CanvasBlockCapabilities, isStreaming = false): readonly CanvasBlockCandidate[] {
  return canvasBlockEligibility(value, capabilities, isStreaming).candidates
}
