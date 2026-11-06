import type { Root, RootContent } from 'mdast'

import type { BlockPresentationId } from './presentation-recipes.js'
import type { ContentSectionsPlan } from '../content-sections.js'

/** The renderer only needs a compiler-owned range and its chosen executable recipe. */
export interface MarkdownBlockPresentation {
  readonly id: string
  readonly start?: number
  readonly end?: number
  readonly kind?: string
  readonly presentation?: BlockPresentationId | `canvas-${string}`
}

export type ResolvedBlockPresentation = BlockPresentationId | `canvas-${string}` | 'fallback'

/** Missing recipes are retained for older stored selections; they are not a new automatic choice. */
export function resolvedBlockPresentation(block: Pick<MarkdownBlockPresentation, 'presentation'> | undefined): ResolvedBlockPresentation {
  return block?.presentation ?? 'fallback'
}

function isDefinition(node: RootContent): boolean {
  return node.type === 'definition' || node.type === 'footnoteDefinition'
}

function matchingBlock(blocks: readonly MarkdownBlockPresentation[], node: RootContent): MarkdownBlockPresentation | undefined {
  if (isDefinition(node)) return undefined
  const start = node.position?.start.offset, end = node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  return blocks.find(block => block.start !== undefined && block.end !== undefined && block.start <= start && block.end >= end)
}

function wrappedBlock(block: MarkdownBlockPresentation, children: RootContent[]): RootContent {
  const first = children[0]?.position?.start, last = children.at(-1)?.position?.end
  return {
    type: 'iexpBlock',
    children,
    data: {
      hName: 'iexp-block',
      hProperties: {
        'data-iexp-block-id': block.id,
        'data-iexp-presentation': resolvedBlockPresentation(block),
        'data-iexp-block-kind': block.kind ?? 'unknown',
      },
    },
    ...(first && last ? { position: { start: first, end: last } } : {}),
  } as unknown as RootContent
}

/**
 * Group the original top-level MDAST nodes by compiler-owned ranges. This runs
 * in the same Markdown parse as the renderer: it never parses source slices,
 * and it deliberately leaves definitions at root scope for link/footnote lookup.
 */
export function blockPresentationPlugin(blocks: readonly MarkdownBlockPresentation[]) {
  return function sourceBoundBlockPresentation() {
    return (tree: Root): void => {
      if (!blocks.length) return
      const next: RootContent[] = []
      const definitions: RootContent[] = []
      let active: MarkdownBlockPresentation | undefined
      let children: RootContent[] = []
      const flush = () => {
        if (active && children.length) next.push(wrappedBlock(active, children))
        else next.push(...children)
        active = undefined
        children = []
      }
      for (const node of tree.children) {
        // Definitions are global Markdown state. Keep the original AST nodes at
        // root scope, but do not let a mid-document definition split the source
        // group that owns its visible references.
        if (isDefinition(node)) {
          definitions.push(node)
          continue
        }
        const block = matchingBlock(blocks, node)
        if (!block) {
          flush()
          next.push(node)
          continue
        }
        if (active?.id !== block.id) {
          flush()
          active = block
        }
        children.push(node)
      }
      flush()
      tree.children = [...next, ...definitions]
    }
  }
}

type WrappedNode = RootContent & { readonly data?: { readonly hProperties?: Record<string, unknown> }, readonly children?: readonly RootContent[] }
function wrappedBlockId(node: RootContent): string | undefined {
  const properties = (node as WrappedNode).data?.hProperties
  const id = properties?.['data-iexp-block-id']
  return typeof id === 'string' ? id : undefined
}
function blockKind(node: RootContent, blocks: ReadonlyMap<string, MarkdownBlockPresentation>): string | undefined {
  const id = wrappedBlockId(node)
  return id === undefined ? undefined : blocks.get(id)?.kind
}
function containsHeading(node: RootContent): boolean {
  if (node.type === 'heading') return true
  return 'children' in node && Array.isArray(node.children) && node.children.some(containsHeading)
}
function storyGroup(className: string, children: RootContent[], properties: Record<string, string> = {}, tag = 'div'): RootContent {
  return {
    type: 'storyGroup', children,
    data: { hName: tag, hProperties: { className: [className], ...properties } },
  } as unknown as RootContent
}
function sectionOwner(start: number | undefined, plan: ContentSectionsPlan): number | undefined {
  if (start === undefined) return undefined
  const index = plan.sections.findIndex(section => start >= section.start && start < section.end)
  return index >= 0 ? index : undefined
}

/**
 * Block-aware Paper composition. Unlike the legacy continuous transform, this
 * adapter never opens an `iexp-block`: each compiler-owned wrapper stays whole
 * and source-ordered while section and visual-stage containers remain real.
 */
export function continuousBlockSectionsPlugin(plan: ContentSectionsPlan, blocks: readonly MarkdownBlockPresentation[]) {
  return function continuousBlockSections() {
    return (tree: Root): void => {
      if (!plan.sections.length) return
      const byId = new Map(blocks.map(block => [block.id, block] as const))
      const intro: RootContent[] = []
      const sections = plan.sections.map(() => [] as RootContent[])
      const definitions: RootContent[] = []
      for (const node of tree.children) {
        if (isDefinition(node)) {
          definitions.push(node)
          continue
        }
        const owner = sectionOwner(node.position?.start.offset, plan)
        if (owner === undefined || owner < 0) intro.push(node)
        else sections[owner]!.push(node)
      }
      const sequence = (nodes: RootContent[]): RootContent[] => {
        const output: RootContent[] = []
        let role = '', pending: RootContent[] = []
        const flush = () => {
          if (!pending.length) return
          output.push(storyGroup(role, pending))
          pending = []
        }
        for (const node of nodes) {
          const kind = blockKind(node, byId)
          const nextRole = kind === 'table' || kind === 'ordered-list' || kind === 'paragraph' && byId.get(wrappedBlockId(node) ?? '')?.presentation === 'flow'
            ? 'iexp-story-stage'
            : containsHeading(node) ? 'iexp-story-heading iexp-story-copy'
              : 'iexp-story-copy'
          if (nextRole !== role) { flush(); role = nextRole }
          pending.push(node)
        }
        flush()
        return output
      }
      tree.children = [
        ...(intro.length ? [storyGroup('iexp-story-intro', [storyGroup('iexp-story-arch', sequence(intro))])] : []),
        ...sections.flatMap((nodes, index) => nodes.length ? [storyGroup('iexp-story-section', [storyGroup('iexp-story-panel', sequence(nodes))], {
          'data-story-layout': 'source-blocks',
          'aria-label': plan.sections[index]?.title ?? '来源章节',
        }, 'section')] : []),
        ...definitions,
      ]
    }
  }
}

/** React Markdown passes custom `data-*` properties through either casing. */
export function blockIdFromMarkdownProps(props: Record<string, unknown>): string | undefined {
  const direct = props['data-iexp-block-id'] ?? props.dataIexpBlockId
  if (typeof direct === 'string') return direct
  const node = props.node
  if (node && typeof node === 'object' && 'properties' in node) {
    const properties = (node as { properties?: Record<string, unknown> }).properties
    const value = properties?.['data-iexp-block-id'] ?? properties?.dataIexpBlockId
    if (typeof value === 'string') return value
  }
  return undefined
}
