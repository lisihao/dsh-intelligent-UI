import type { Nodes, Root, RootContent } from 'mdast'
import type { ContentSectionsPlan } from './content-sections.js'

function hasImage(node: Nodes): boolean {
  return node.type === 'image' || node.type === 'imageReference' || 'children' in node && node.children.some(hasImage)
}
function wrap(className: string, children: RootContent[], properties: Record<string, string> = {}): RootContent {
  // mdast-to-hast's documented data.hName bridge keeps the original nodes/positions intact.
  return { type: 'storyGroup', children, data: { hName: className === 'iexp-story-section' ? 'section' : 'div', hProperties: { className: [className], ...properties } } } as unknown as RootContent
}

/** One full-document AST: references, definitions and source offsets never cross a parser boundary. */
export function continuousSectionsPlugin(plan: ContentSectionsPlan, flowStarts: number[], wideTableStarts: number[]) {
  return function continuousSections() {
    return (tree: Root): void => {
      const original = tree.children
      const firstStart = plan.sections[0]!.start
      const intro = original.filter(node => (node.position?.start.offset ?? -1) < firstStart)
      let featured = false
      const arrange = (nodes: RootContent[], className: string): RootContent => {
        const visual = nodes.findIndex(node => node.type === 'table' || hasImage(node) || flowStarts.includes(node.position?.start.offset ?? -1))
        const visualCount = nodes.filter(node => node.type === 'table' || hasImage(node) || flowStarts.includes(node.position?.start.offset ?? -1)).length
        const from = nodes[0]?.position?.start.offset ?? 0
        const start = visual >= 0 ? nodes[visual]!.position!.start.offset! : from
        const end = nodes.at(-1)?.position?.end.offset ?? start
        const shortCopy = start - from <= 600
        const wide = wideTableStarts.some(offset => offset >= from && offset < end)
        const layout = visual < 0 ? 'text' : !featured ? 'feature' : shortCopy && visualCount === 1 && !wide ? 'split' : 'wide'
        if (visual >= 0) featured = true
        return wrap(className, visual < 0 ? [wrap('iexp-story-copy', nodes)] : [wrap('iexp-story-copy', nodes.slice(0, visual)), wrap('iexp-story-visual', nodes.slice(visual))], { 'data-story-layout': layout })
      }
      tree.children = [
        ...(intro.length ? [wrap('iexp-story-intro', intro)] : []),
        ...plan.sections.map(section => {
          const nodes = original.filter(node => { const start = node.position?.start.offset; return start !== undefined && start >= section.start && start < section.end })
          const subheadings = nodes.flatMap((node, index) => node.type === 'heading' && node.depth === section.headingDepth + 1 ? [index] : [])
          if (subheadings.length < 2) {
            const group = arrange(nodes, 'iexp-story-section')
            group.data!.hProperties = { ...group.data!.hProperties, 'aria-label': section.title }
            return group
          }
          // A long chapter may contain several independent topics. Keep each original
          // subheading with its own copy/visual, without reordering or inventing a summary.
          const boundaries = [0, ...subheadings]
          const parts = boundaries.map((from, index) => nodes.slice(from, boundaries[index + 1] ?? nodes.length)).filter(part => part.length)
          return wrap('iexp-story-section', parts.map(part => arrange(part, 'iexp-story-panel')), { 'data-story-layout': 'chapter', 'aria-label': section.title })
        }),
      ]
    }
  }
}

export const continuousCss = `
.dsh-experience.iexp-reply-surface:has(> .iexp-continuous) { padding:0; }
.iexp-content .iexp-continuous { container-type:inline-size; container-name:iexp-story; min-width:0; }
.iexp-content .iexp-continuous > .iexp-heading-index { margin:16px 24px; }
.iexp-continuous .iexp-story-intro { padding:32px 28px; text-align:start; }
.iexp-continuous .iexp-story-intro > :is(p,ul,ol) { max-width:70ch; margin-inline:auto; }
.iexp-content .iexp-story-intro h1 { max-width:30ch; font-size:clamp(28px,3.2cqi,40px); line-height:1.3; margin:8px auto 20px; text-align:center; }
.iexp-continuous .iexp-story-section { position:relative; display:grid; grid-template-columns:minmax(0,1fr); gap:24px; padding:28px; margin:0 12px; border-top:1px solid var(--iexp-line); border-inline:1px solid var(--iexp-line); }
.iexp-continuous .iexp-story-section:last-child { padding-bottom:32px; }
.iexp-continuous .iexp-story-section[data-story-layout=chapter] { display:block; padding-block:0; }
.iexp-continuous .iexp-story-panel { display:grid; grid-template-columns:minmax(0,1fr); gap:24px; padding-block:28px; min-width:0; }
.iexp-continuous .iexp-story-panel + .iexp-story-panel { border-top:1px solid var(--iexp-line); }
.iexp-story-section::before { content:''; position:absolute; width:6px; height:6px; left:-4px; top:-4px; background:var(--iexp-bg); border:1px solid var(--iexp-line); }
.iexp-story-section::after { content:''; position:absolute; width:1px; left:-1px; top:0; bottom:0; background:var(--iexp-accent); transform:scaleY(0); transform-origin:top; pointer-events:none; }
.iexp-content .iexp-story-copy { min-width:0; max-width:74ch; }
.iexp-content .iexp-story-copy > :first-child { margin-top:0; padding-top:0; border-top:0; }
.iexp-content .iexp-story-copy > :is(h1,h2) { font-size:clamp(23px,2.5cqi,30px); margin-bottom:16px; }
.iexp-content .iexp-story-copy > p { margin:12px 0; }
.iexp-content .iexp-story-visual { min-width:0; }
.iexp-content .iexp-story-visual > .iexp-table-group:first-child { margin-top:0; }
.iexp-content .iexp-story-visual :is(.iexp-chart-grid,.iexp-full-table) { max-width:none; }
.iexp-content .iexp-story-visual .iexp-chart-card:only-child { max-width:none; width:100%; }
.iexp-content .iexp-story-section[data-story-layout=feature] > .iexp-story-copy { max-width:74ch; }
.iexp-content .iexp-story-section[data-story-layout=text] { padding-block:24px; }
.iexp-content .iexp-story-section img { max-width:100%; height:auto; border-radius:var(--iexp-card-radius); }
@container iexp-story (min-width:920px) {
 :is(.iexp-story-section,.iexp-story-panel)[data-story-layout=split] { grid-template-columns:minmax(260px,.8fr) minmax(520px,1.6fr); gap:28px; align-items:start; }
 :is(.iexp-story-section,.iexp-story-panel)[data-story-layout=split] > .iexp-story-copy { position:sticky; top:24px; }
}
@container iexp-story (max-width:560px) {
 .iexp-continuous .iexp-story-intro { padding:24px 16px; text-align:start; }
 .iexp-content .iexp-story-intro h1 { font-size:28px; }
 .iexp-continuous .iexp-story-section { margin-inline:8px; padding:20px 12px; gap:20px; }
 .iexp-content .iexp-story-copy > :is(h1,h2) { font-size:23px; }
 .iexp-continuous .iexp-story-panel { padding-block:20px; gap:20px; }
}
@supports(animation-timeline:view()) {
 @media(prefers-reduced-motion:no-preference) {
  .iexp-story-section::after { animation:iexp-reading-line linear both; animation-timeline:view(); animation-range:entry 20% cover 65%; }
 }
}
@keyframes iexp-reading-line { from { transform:scaleY(0); } to { transform:scaleY(1); } }
@media(prefers-reduced-motion:reduce) { .iexp-story-section::after { animation:none; display:none; } }
`
