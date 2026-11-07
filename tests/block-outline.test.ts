import { describe, expect, it } from 'vitest'
import { compileBlockLayout } from '../src/adaptive-ui/block-compiler.js'
import { BLOCK_OUTLINE_FORMAT, MAX_BLOCK_OUTLINE_SECTIONS, MAX_BLOCK_OUTLINE_TITLE_CHARACTERS, outlineBlockLayout, type BlockOutline } from '../src/adaptive-ui/block-outline.js'

function outline(value: unknown): { result: BlockOutline, compiled: ReturnType<typeof compileBlockLayout> } {
  const compiled = compileBlockLayout(value)
  return { result: outlineBlockLayout(value, compiled), compiled }
}

function sectionOf(result: BlockOutline, blockId: string): string | null {
  const id = result.blocks.find(block => block.blockId === blockId)!.sectionId
  return id === null ? null : result.sections.find(section => section.id === id)!.title
}

describe('outlineBlockLayout', () => {
  it('builds the heading tree and places every compiled block in its innermost section', () => {
    const source = '# Title\n\nIntro.\n\n## Part A\n\nText A.\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n### Detail\n\nMore.\n\n## Part B\n\nText B.'
    const { result, compiled } = outline(source)
    expect(result.format).toBe(BLOCK_OUTLINE_FORMAT)
    expect(result.complete).toBe(true)
    const byTitle = new Map(result.sections.map(section => [section.title, section]))
    expect(result.sections.map(section => [section.title, section.depth])).toEqual([['Title', 1], ['Part A', 2], ['Detail', 3], ['Part B', 2]])
    expect(byTitle.get('Title')).toMatchObject({ start: 0, end: source.length, parentId: null, evidence: ['source:heading', 'heading-depth:1'] })
    expect(byTitle.get('Part A')).toMatchObject({ parentId: byTitle.get('Title')!.id, start: source.indexOf('## Part A'), end: source.indexOf('## Part B') })
    expect(byTitle.get('Detail')).toMatchObject({ parentId: byTitle.get('Part A')!.id, end: source.indexOf('## Part B') })
    expect(byTitle.get('Part B')).toMatchObject({ parentId: byTitle.get('Title')!.id, end: source.length })
    expect(result.blocks.map(block => block.blockId)).toEqual(compiled.blocks.map(block => block.id))
    expect(compiled.blocks.map(block => [block.kind, sectionOf(result, block.id)])).toEqual([
      ['prose', 'Title'], ['prose', 'Part A'], ['table', 'Part A'], ['prose', 'Detail'], ['prose', 'Part B'],
    ])
  })

  it('uses only top-level headings, plain heading text, and no section before the first heading', () => {
    const source = 'Preamble.\n\n- # not a section\n\n> ## quoted, not a section\n\nSetext\ntitle\n============\n\n## A **bold** `code` [link](https://example.invalid) <span>z</span>\n\nBody.'
    const { result, compiled } = outline(source)
    expect(result.sections.map(section => [section.title, section.depth])).toEqual([['Setext title', 1], ['A bold code link z', 2]])
    expect(sectionOf(result, compiled.blocks[0]!.id)).toBeNull()
  })

  it('marks a shortened title instead of dropping it', () => {
    const long = 'x'.repeat(MAX_BLOCK_OUTLINE_TITLE_CHARACTERS + 50)
    const { result } = outline(`# ${long}\n\nBody.`)
    expect(result.sections[0]).toMatchObject({ title: long.slice(0, MAX_BLOCK_OUTLINE_TITLE_CHARACTERS), titleTruncated: true })
    expect(outline('# Short\n\nBody.').result.sections[0]).toMatchObject({ title: 'Short', titleTruncated: false })
  })

  it('keeps separate source paths apart and gives structured values no section', () => {
    const value = [{ type: 'text', text: '# One\n\ntext' }, { type: 'text', text: '{"metric":4}' }, { type: 'text', text: '# Two\n\nmore' }]
    const { result, compiled } = outline(value)
    expect(result.sections.map(section => [section.title, section.path])).toEqual([['One', [0]], ['Two', [2]]])
    expect(compiled.blocks.map(block => [block.path, sectionOf(result, block.id)])).toEqual([[[0], 'One'], [[1], null], [[2], 'Two']])
    expect(outline({ metric: 4 }).result).toMatchObject({ complete: true, sections: [], blocks: [{ sectionId: null }] })
  })

  it('reports an omitted outline when the heading count exceeds its limit', () => {
    const source = Array.from({ length: MAX_BLOCK_OUTLINE_SECTIONS + 1 }, (_, index) => `## H${index}\n\np${index}`).join('\n\n')
    const { result, compiled } = outline(source)
    expect(result).toMatchObject({ complete: false, sections: [], omitted: { reason: 'BLOCK_OUTLINE_SECTION_LIMIT_EXCEEDED', sectionCount: MAX_BLOCK_OUTLINE_SECTIONS + 1 } })
    expect(result.blocks).toEqual(compiled.blocks.map(block => ({ blockId: block.id, sectionId: null })))
  })
})
