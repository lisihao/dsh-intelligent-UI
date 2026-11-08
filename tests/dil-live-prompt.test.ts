import { describe, expect, it } from 'vitest'

import { DIL_COMPONENT_CATALOG, dilAuthoringGuide } from '../src/dil/catalog.js'
import { buildDilLivePrompt, type JsonSchema } from '../tools/dil-live/prompt.js'

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

function input() {
  return {
    document: {
      id: 'document-1',
      fileName: 'evidence.md',
      title: '运行边界',
      raw: 'FULL_DOCUMENT_RAW_MUST_NOT_APPEAR',
      blocks: [
        {
          id: 'block-alpha',
          start: 0,
          end: 21,
          kind: 'paragraph',
          source: 'SOURCE_BLOCK_ALPHA_ONCE',
          bindings: {
            source: 'BINDING_ALPHA_MUST_NOT_APPEAR',
            segments: [{ index: 0, kind: 'paragraph', source: 'SEGMENT_ALPHA_MUST_NOT_APPEAR' }],
            tables: [{ header: ['单位'], rows: [['ms']], source: 'TABLE_ALPHA_MUST_NOT_APPEAR' }],
            items: ['ITEM_ALPHA_MUST_NOT_APPEAR'],
          },
        },
        {
          id: 'block-beta',
          start: 21,
          end: 41,
          kind: 'code',
          source: 'SOURCE_BLOCK_BETA_ONCE',
          bindings: {
            source: 'BINDING_BETA_MUST_NOT_APPEAR',
            segments: [{ index: 0, kind: 'code', source: 'SEGMENT_BETA_MUST_NOT_APPEAR' }],
            tables: [],
            items: [],
          },
        },
      ],
    },
    themes: [
      { id: 'paper-flow', name: 'Paper Flow', description: 'Continuous reading surface.' },
      { id: 'plain', name: 'Plain' },
    ],
  } as const
}

function object(schema: unknown): Record<string, unknown> {
  expect(schema).toBeTypeOf('object')
  return schema as Record<string, unknown>
}

describe('DIL live prompt', () => {
  it('sends ordered block source exactly once, without raw or binding-body duplication', () => {
    const result = buildDilLivePrompt(input())
    expect(count(result.prompt, 'SOURCE_BLOCK_ALPHA_ONCE')).toBe(1)
    expect(count(result.prompt, 'SOURCE_BLOCK_BETA_ONCE')).toBe(1)
    expect(result.prompt).not.toContain('FULL_DOCUMENT_RAW_MUST_NOT_APPEAR')
    expect(result.prompt).not.toContain('BINDING_ALPHA_MUST_NOT_APPEAR')
    expect(result.prompt).not.toContain('SEGMENT_ALPHA_MUST_NOT_APPEAR')
    expect(result.prompt).not.toContain('TABLE_ALPHA_MUST_NOT_APPEAR')
    expect(result.prompt).not.toContain('ITEM_ALPHA_MUST_NOT_APPEAR')
    expect(result.prompt).toContain('"id": "block-alpha"')
    expect(result.prompt).toContain('"id": "block-beta"')
    expect(result.prompt.indexOf('"id": "block-alpha"')).toBeLessThan(result.prompt.indexOf('"id": "block-beta"'))
  })

  it('uses the complete DIL guide once and states the fixed binding and behavioral boundaries', () => {
    const result = buildDilLivePrompt(input())
    expect(count(result.prompt, dilAuthoringGuide)).toBe(1)
    expect(result.prompt).toContain('data=DIL.useAppData(a=>a.opGenui.modelDataBindings)')
    expect(result.prompt).toContain('segments[index].{kind,source}')
    expect(result.prompt).toContain('tables[index].{header:string[],rows:string[][],source}')
    expect(result.prompt).toContain('items:string[]')
    expect(result.prompt).toContain('<markdown source={data.source}/>')
    expect(result.prompt).toContain('不能跨单位')
    expect(result.prompt).toContain('explicit form action')
    expect(result.prompt).not.toContain('Jev')
    expect(result.prompt).not.toMatch(/\bcandidate\b/i)
    expect(result.prompt).not.toContain('current default')
    expect(result.prompt).not.toMatch(/\bdefault theme\b/i)
    expect(result.prompt).not.toMatch(/\bscore\b/i)
    expect(result.prompt).not.toContain('diversity quota')
    expect(dilAuthoringGuide).toContain('solar_ui_catalog componentId contract')
    expect(dilAuthoringGuide).toContain('JSON documents may contain code, URLs, image src values, actions')
  })

  it('builds a strict ordered response schema with only executable intrinsic tags', () => {
    const result = buildDilLivePrompt(input())
    const root = object(result.schema)
    expect(root.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(root.type).toBe('object')
    expect(root.additionalProperties).toBe(false)
    expect(root.required).toEqual(['programs', 'blocks'])
    const definitions = object(root.$defs)
    const properties = object(root.properties)
    expect(object(properties.themeId).enum).toEqual(['paper-flow', 'plain'])
    const programs = object(properties.programs)
    expect(programs.minItems).toBe(1)
    expect(object(programs.items).$ref).toBe('#/$defs/program')
    const program = object(definitions.program)
    expect(program.additionalProperties).toBe(false)
    expect(program.required).toEqual(['id', 'dilSource'])
    const blocks = object(properties.blocks)
    expect(blocks.additionalProperties).toBeUndefined()
    expect(blocks.minItems).toBe(2)
    expect(blocks.maxItems).toBe(2)
    expect(blocks.items).toBe(false)
    const prefixItems = blocks.prefixItems as readonly JsonSchema[]
    expect(prefixItems).toHaveLength(2)
    const constrainedIds = prefixItems.map(item => {
      const allOf = object(item).allOf as readonly unknown[]
      expect(allOf).toHaveLength(2)
      expect(object(allOf[0]).$ref).toBe('#/$defs/block')
      return object(object(allOf[1]).properties).blockId as Record<string, unknown>
    })
    expect(constrainedIds.map(item => item.const)).toEqual(['block-alpha', 'block-beta'])
    const block = object(definitions.block)
    expect(block.additionalProperties).toBe(false)
    expect(block.required).toEqual(['blockId', 'programId', 'components', 'reason'])
    const componentItems = object(object(object(block.properties).components).items)
    expect(componentItems.$ref).toBe('#/$defs/intrinsicTag')
    expect(object(definitions.intrinsicTag).enum).toEqual(DIL_COMPONENT_CATALOG.map(component => component.tag))
  })

  it('omits themeId when no complete installed-theme list is supplied', () => {
    const value = input()
    const result = buildDilLivePrompt({ document: value.document })
    const properties = object(object(result.schema).properties)
    expect(properties.themeId).toBeUndefined()
    expect(result.prompt).toContain('[]')
  })
})
