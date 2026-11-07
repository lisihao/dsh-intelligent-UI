import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import type { Root } from 'mdast'

import { markdownNavigation } from '../src/markdown-navigation.js'

type Node = {
  type: string
  value?: string
  url?: string
  ordered?: boolean
  start?: number
  children?: Node[]
  position?: { start?: { offset?: number }, end?: { offset?: number } }
  data?: { hName?: string, hProperties?: Record<string, unknown> }
}

function text(node: Node): string {
  return typeof node.value === 'string' ? node.value : node.children?.map(text).join('') ?? ''
}

function find(node: Node, type: string): Node | undefined {
  if (node.type === type) return node
  for (const child of node.children ?? []) {
    const match = find(child, type)
    if (match) return match
  }
  return undefined
}

function transform(source: string, wrapped = false) {
  const navigation = markdownNavigation(source, start => `#source-${start}`)
  const processor = unified().use(remarkParse).use(remarkGfm)
  if (wrapped) {
    processor.use(() => (tree: Root): void => {
      const root = tree as unknown as Node
      root.children = (root.children ?? []).map(child => ({
        type: 'iexpBlock', children: [child], position: child.position,
        data: { hName: 'iexp-block', hProperties: { 'data-iexp-block-id': `block-${child.position?.start?.offset ?? 'none'}` } },
      }))
    })
  }
  processor.use(navigation.remarkPlugin)
  return { navigation, tree: processor.runSync(processor.parse(source)) as unknown as Node }
}

describe('markdownNavigation', () => {
  it('resolves GitHub slugs, Unicode exact fragments, and duplicate slug aliases without guessing ambiguous text', () => {
    const source = `# Repeat

# Repeat

## 中文 标题`
    const { navigation } = transform(source)

    expect(navigation.resolveHref('#repeat')).toBe(`#source-${source.indexOf('# Repeat')}`)
    expect(navigation.resolveHref('#repeat-1')).toBe(`#source-${source.lastIndexOf('# Repeat')}`)
    expect(navigation.resolveHref('#%E4%B8%AD%E6%96%87%20%E6%A0%87%E9%A2%98')).toBe(`#source-${source.indexOf('## 中文 标题')}`)
    expect(navigation.resolveHref('#Repeat')).toBeUndefined()
  })

  it('does not map missing, malformed, or external URL fragments', () => {
    const { navigation } = transform('# Local heading')

    expect(navigation.resolveHref('#missing')).toBeUndefined()
    expect(navigation.resolveHref('#%E0%A4%A')).toBeUndefined()
    expect(navigation.resolveHref('https://example.test/report#local-heading')).toBeUndefined()
    expect(navigation.resolveHref('/report#local-heading')).toBeUndefined()
  })

  it('converts only a verified explicit directory and preserves its labels while mapping a source link href', () => {
    const source = `# 目录

- 中文 标题
- [Second heading](#second-heading)

## 中文 标题

完整原文保留。

## Second heading

完整原文保留。`
    const { tree } = transform(source)
    const list = find(tree, 'list')!
    const first = list.children![0]!.children![0]!.children![0]!
    const second = list.children![1]!.children![0]!.children![0]!

    expect(find(tree, 'iexpSourceToc')?.data).toMatchObject({ hName: 'iexp-source-toc', hProperties: { 'aria-label': '原文目录', 'data-iexp-source-toc-label': '目录', 'data-iexp-toc-unmatched': '0' } })
    expect(first).toMatchObject({ type: 'link', url: `#source-${source.indexOf('## 中文 标题')}` })
    expect(second).toMatchObject({ type: 'link', url: `#source-${source.indexOf('## Second heading')}` })
    expect(text(first)).toBe('中文 标题')
    expect(text(second)).toBe('Second heading')
  })

  it.each(['Table of Contents', 'Contents', 'TOC'])('recognizes the explicit %s heading without changing its original text', label => {
    const source = `# ${label}

- Destination
- Second

## Destination

## Second`
    const { tree } = transform(source)
    const heading = find(tree, 'heading')!
    const list = find(tree, 'list')!

    expect(text(heading)).toBe(label)
    expect(find(tree, 'iexpSourceToc')?.data?.hName).toBe('iexp-source-toc')
  })

  it('reconstructs an ordered directory label from its literal source marker before exact heading matching', () => {
    const source = `# 目录

1. Destination
2. Next

## 1. Destination

## 2. Next`
    const { tree } = transform(source)
    const list = find(tree, 'list')!
    const link = list.children![0]!.children![0]!.children![0]!
    const wrapper = find(tree, 'iexpSourceToc')!

    expect(wrapper.data?.hName).toBe('iexp-source-toc')
    expect(wrapper.position).toEqual(list.position)
    expect(list.data?.hName).toBeUndefined()
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 1 })
    expect(link).toMatchObject({ type: 'link', url: `#source-${source.indexOf('## 1. Destination')}` })
    expect(text(link)).toBe('Destination')
  })

  it('keeps unmatched labels and external links unchanged while exposing a partially verified directory', () => {
    const source = `# 目录

- First
- [External](https://example.test/guide#first)
- Second
- Unmatched

## First

## Second`
    const { tree } = transform(source)
    const list = find(tree, 'list')!
    const first = list.children![0]!.children![0]!.children![0]!
    const external = list.children![1]!.children![0]!.children![0]!
    const second = list.children![2]!.children![0]!.children![0]!
    const unmatched = list.children![3]!.children![0]!.children![0]!

    expect(find(tree, 'iexpSourceToc')?.data).toMatchObject({ hName: 'iexp-source-toc', hProperties: { 'data-iexp-toc-unmatched': '2' } })
    expect(first).toMatchObject({ type: 'link', url: `#source-${source.indexOf('## First')}` })
    expect(external).toMatchObject({ type: 'link', url: 'https://example.test/guide#first' })
    expect(second).toMatchObject({ type: 'link', url: `#source-${source.indexOf('## Second')}` })
    expect(unmatched).toMatchObject({ type: 'text', value: 'Unmatched' })
  })

  it('leaves an ordinary process list and a duplicate-heading directory candidate untouched', () => {
    const ordinary = transform(`# Process

1. Collect
2. Review

## Collect

## Review`).tree
    expect(find(ordinary, 'iexpSourceToc')).toBeUndefined()

    const ambiguous = transform(`# 目录

- Same

## Same

## Same`).tree
    const list = find(ambiguous, 'list')!
    expect(find(ambiguous, 'iexpSourceToc')).toBeUndefined()
    expect(list.children![0]!.children![0]!.children![0]!.type).toBe('text')
  })

  it('recognizes a directory across iexpBlock wrappers and retains source offsets, references, and code', () => {
    const source = `# Table of Contents

- Destination
- Second

## Destination

## Second

\`\`\`ts
const retained = true
\`\`\`

[source-ref]: https://example.test/source`
    const { tree } = transform(source, true)
    const list = find(tree, 'list')!
    const code = find(tree, 'code')!
    const definition = find(tree, 'definition')!

    expect(find(tree, 'iexpSourceToc')?.data?.hName).toBe('iexp-source-toc')
    expect(list.position?.start?.offset).toBe(source.indexOf('- Destination'))
    expect(code.position?.start?.offset).toBe(source.indexOf('```ts'))
    expect(definition.url).toBe('https://example.test/source')
    expect(list.children?.map(text)).toEqual(['Destination', 'Second'])
  })
})
