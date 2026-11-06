import { describe, expect, it } from 'vitest'
import { CANVAS_HTML_EFFECT_NAMES } from '../src/canvas-html-names.js'
import { BLOCK_PRESENTATION_IDS } from '../src/adaptive-ui/presentation-recipes.js'
import {
  CANVAS_BLOCK_PRESENTATION_IDS,
  MAX_CANVAS_BLOCK_SOURCE_CHARACTERS,
  MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS,
  canvasBlockCandidates,
  canvasBlockEligibility,
  canvasDecorativeColor,
} from '../src/adaptive-ui/canvas-block-recipes.js'

const usable = { webgl: true, reducedMotion: false } as const

describe('Canvas block recipe eligibility', () => {
  it('keeps all seventeen renderer IDs registered while offering 13 HTML, two isolated, and a geometry-qualified scroll recipe', () => {
    expect(CANVAS_BLOCK_PRESENTATION_IDS).toHaveLength(CANVAS_HTML_EFFECT_NAMES.length + 3)
    expect(CANVAS_BLOCK_PRESENTATION_IDS).toEqual(expect.arrayContaining([
      ...CANVAS_HTML_EFFECT_NAMES.map(slug => `canvas-${slug}`),
      'canvas-bend', 'canvas-hex-float', 'canvas-particle-scroll',
    ]))
    const source = Array.from({ length: MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS }, (_, index) => `第 ${index + 1} 段完整、无链接的普通说明与 \`code\`。`).join('\n\n')
    const candidates = canvasBlockCandidates(source, usable)
    expect(candidates).toHaveLength(16)
    expect(candidates.map(candidate => candidate.id).slice(0, 13)).toEqual(CANVAS_HTML_EFFECT_NAMES
      .filter(slug => slug !== 'magnify')
      .map(slug => `canvas-${slug}`))
    expect(candidates.map(candidate => candidate.id)).toEqual(expect.arrayContaining(['canvas-bend', 'canvas-hex-float', 'canvas-particle-scroll']))
    expect(candidates.every(candidate => (BLOCK_PRESENTATION_IDS as readonly string[]).includes(candidate.id))).toBe(true)
    for (const candidate of candidates) {
      expect(candidate.purpose).toContain('visual-only')
      expect(candidate.evidence).toEqual(expect.arrayContaining(['capability:webgl=true', 'source:markdown-noninteractive']))
    }
  })

  it('reads a compiler-owned value without accepting a model-provided replacement', () => {
    const compiled = {
      id: 'block-root-0-20-prose', path: [], kind: 'prose', evidence: ['source:markdown'], passive: true,
      value: '原文仍由渲染器完整保留。',
    }
    expect(canvasBlockCandidates(compiled, usable)).toHaveLength(15)
  })

  it.each([
    ['webgl unavailable', { webgl: false, reducedMotion: false }, false, 'capability:webgl=false'],
    ['reduced motion', { webgl: true, reducedMotion: true }, false, 'capability:reduced-motion=true'],
    ['streaming source', usable, true, 'source:streaming=true'],
  ])('rejects %s as a hard condition', (_name, capabilities, streaming, reason) => {
    const eligibility = canvasBlockEligibility('保留来源。', capabilities, streaming)
    expect(eligibility.candidates).toEqual([])
    expect(eligibility.reasons).toContain(reason)
  })

  it.each([
    ['fenced code with a production copy control', '```ts\nconst retained = true\n```'],
    ['heading with production navigation and icon', '# 来源标题\n\n完整正文'],
    ['blockquote', '> 完整引用'],
    ['deleted text', '~~已删除的源文~~'],
    ['horizontal rule', '---'],
    ['link', '[原始链接](https://example.test)'],
    ['image', '![原始图片](https://example.test/a.png)'],
    ['raw HTML', '<button>原始控制</button>'],
    ['table', '| 项目 | 值 |\n| --- | --- |\n| a | 1 |'],
    ['task control', '- [ ] 原始任务'],
  ])('does not offer a snapshot effect for Markdown containing a %s', (_name, value) => {
    expect(canvasBlockCandidates(value, usable)).toEqual([])
  })

  it('rejects source markup that deterministically exceeds the real capture element bound', () => {
    const source = '**a** '.repeat(129)
    expect(source.length).toBeLessThan(MAX_CANVAS_BLOCK_SOURCE_CHARACTERS)
    expect(canvasBlockEligibility(source, usable).reasons).toContain('source:capture-element-limit')
    expect(canvasBlockCandidates(source, usable)).toEqual([])
  })

  it('enforces the bounded source length before a visual recipe is considered', () => {
    const eligibility = canvasBlockEligibility('a'.repeat(MAX_CANVAS_BLOCK_SOURCE_CHARACTERS + 1), usable)
    expect(eligibility.candidates).toEqual([])
    expect(eligibility.reasons).toContain(`source:length>${MAX_CANVAS_BLOCK_SOURCE_CHARACTERS}`)
  })

  it('permits Magnify only for an exact, text-free decorative color record', () => {
    const source = { role: 'decorative', color: '#1a2B3c' } as const
    expect(canvasDecorativeColor(source)).toEqual({ cssColor: 'rgb(26, 43, 60)', rgb: [26, 43, 60] })
    expect(canvasBlockCandidates(source, usable)).toEqual([
      expect.objectContaining({ id: 'canvas-magnify', evidence: expect.arrayContaining(['source:decorative-color', 'source:text-free-swatch']) }),
    ])
    expect(canvasDecorativeColor({ role: 'decorative', color: [1, 0, 0] })).toEqual({ cssColor: 'rgb(255, 0, 0)', rgb: [255, 0, 0] })
    expect(canvasBlockCandidates({ role: 'decorative', color: '#000000', caption: 'not text free' }, usable)).toEqual([])
    expect(canvasBlockCandidates('123', usable).map(candidate => candidate.id)).not.toContain('canvas-magnify')
    expect(canvasBlockCandidates({ role: 'decorative', color: 'https://example.test/picture.png' }, usable)).toEqual([])
  })

  it('makes every registered ID reachable through a legal source path', () => {
    const text = Array.from({ length: MIN_CANVAS_PARTICLE_SCROLL_PARAGRAPHS }, (_, index) => `可滚动的原始第 ${index + 1} 段。`).join('\n\n')
    const reachable = new Set([
      ...canvasBlockCandidates(text, usable).map(candidate => candidate.id),
      ...canvasBlockCandidates({ role: 'decorative', color: [0, 0, 1] }, usable).map(candidate => candidate.id),
    ])
    expect([...reachable].sort()).toEqual([...CANVAS_BLOCK_PRESENTATION_IDS].sort())
  })
})
