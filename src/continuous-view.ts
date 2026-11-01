import type { Nodes, Root, RootContent } from 'mdast'
import type { MasterDetailPlan } from './content-layout.js'
import type { ContentSectionsPlan } from './content-sections.js'

function plain(node: Nodes): string {
  return 'value' in node ? String(node.value) : 'children' in node ? node.children.map(plain).join('') : ''
}
function hasImage(node: Nodes): boolean {
  return node.type === 'image' || node.type === 'imageReference' || 'children' in node && node.children.some(hasImage)
}
function wrap(className: string, children: RootContent[], properties: Record<string, string> = {}, tag = 'div'): RootContent {
  // mdast-to-hast's documented bridge retains the original nodes and source positions.
  return { type: 'storyGroup', children, data: { hName: tag, hProperties: { className: [className], ...properties } } } as unknown as RootContent
}
function disclosure(nodes: RootContent[]): RootContent[] {
  if (!nodes.length) return []
  return [wrap('iexp-story-body', [wrap('iexp-story-summary', [{ type: 'text', value: '展开本节正文' } as unknown as RootContent], {}, 'summary'), ...nodes], {}, 'details')]
}
// Conservative visibility rule: limitations, assumptions and source definitions
// are never traded away for a shorter composition. Matching does not rewrite copy.
const qualification = /口径|不能|不应|不宜|未经审计|未审计|假设|不足以|尚未|不确定|未披露|不等于|并非|需要注意|仅能|不代表|不可|仅供|unaudited|assum(?:e|ption)|caveat|uncertain|not comparable|exclud/i
const bound = (node: RootContent): Record<string, string> => ({ 'data-source-start': String(node.position?.start.offset ?? ''), 'data-source-end': String(node.position?.end.offset ?? '') })

/** Explicitly named narrative rows can use the existing read-only detail view.
 * No probability, ranking or missing numeric series is inferred from prose. */
export function planReadingTable(headers: string[], rows: string[][]): MasterDetailPlan | undefined {
  if (!/情景|观察对象|研究文献|资料.*分歧|scenario|research|subject/i.test(headers[0] ?? '') || headers.length < 3 || rows.length < 3 || rows.length > 12) return undefined
  if (new Set(rows.map(row => row[0])).size !== rows.length || rows.some(row => row.length !== headers.length || !row[0] || row[0].length > 200) || rows.reduce((n, row) => n + row.join('').length, 0) < rows.length * 80) return undefined
  return { kind: 'master-detail', items: rows.map(row => ({ title: row[0]!, description: row[1], record: Object.fromEntries(headers.map((header, i) => [header, row[i]!])) })) }
}

/** One full-document AST keeps global references/footnotes and exact source nodes. */
export function continuousSectionsPlugin(plan: ContentSectionsPlan, flowStarts: number[], _wideTableStarts: number[]) {
  return function continuousSections() {
    return (tree: Root): void => {
      const original = tree.children
      const intro = original.filter(node => (node.position?.start.offset ?? -1) < plan.sections[0]!.start)
      const isVisual = (node: RootContent) => node.type === 'table' || hasImage(node) || flowStarts.includes(node.position?.start.offset ?? -1)
      const arrange = (nodes: RootContent[], className: string): RootContent => {
        const headings = nodes.filter(node => node.type === 'heading')
        const content = nodes.filter(node => node.type !== 'heading')
        const visuals = content.filter(isVisual)
        const definitions: RootContent[] = content.filter(node => node.type === 'definition' || node.type === 'footnoteDefinition')
        const prose = content.filter(node => !isVisual(node) && !definitions.includes(node))
        const qualified = new Set<RootContent>()
        for (let i = 0; i < prose.length; i++) {
          const node = prose[i]!
          if (qualification.test(plain(node)) || node.type === 'blockquote') {
            qualified.add(node)
            if (prose[i + 1]?.type === 'list') qualified.add(prose[i + 1]!)
          }
        }
        // A list and its introducing sentence form one source block. Never lift
        // an orphan 'as follows:' into an unrelated caption.
        for (let i = 1; i < prose.length; i++) {
          if (prose[i]!.type === 'list' && prose[i - 1]!.type === 'paragraph' && /[:：]$/.test(plain(prose[i - 1]!)) && qualified.has(prose[i]!)) qualified.add(prose[i - 1]!)
        }
        if (!visuals.length) {
          // Short prose stays short. Long argument is locally expandable; definitions
          // and every detected caveat remain available without opening the disclosure.
          const short = prose.reduce((n, node) => n + plain(node).length, 0) <= 540
          const visible = short ? prose : prose.filter((node, i) => i === 0 || qualified.has(node))
          const rest = short ? [] : prose.filter(node => !visible.includes(node))
          return wrap(className, [wrap('iexp-story-heading', headings), wrap('iexp-story-copy', visible), ...disclosure(rest), ...definitions], { 'data-story-layout': 'text' }, className === 'iexp-story-section' ? 'section' : 'div')
        }
        // Complete original paragraphs only, within their own heading boundary.
        // There is no generated summary and no cross-topic claim/figure pairing.
        const captions = prose.filter(node => !qualified.has(node) && node.type === 'paragraph' && plain(node).length <= 400 && !/[:：]$/.test(plain(node))).slice(0, 2)
        const rest = prose.filter(node => !qualified.has(node) && !captions.includes(node))
        return wrap(className, [
          wrap('iexp-story-heading', headings),
          wrap('iexp-story-stage', visuals),
          ...(qualified.size ? [wrap('iexp-story-basis', [...qualified].map(node => wrap('iexp-story-source-fragment', [node], bound(node))))] : []),
          ...(captions.length ? [wrap('iexp-story-captions', captions.map(node => wrap('iexp-story-caption', [node], bound(node))))] : []),
          ...disclosure(rest), ...definitions,
        ], { 'data-story-layout': 'scene' }, className === 'iexp-story-section' ? 'section' : 'div')
      }
      const introHeadings = intro.filter(node => node.type === 'heading')
      const introProse = intro.filter(node => node.type !== 'heading')
      const lead = introProse.find(node => node.type === 'paragraph' && plain(node).length <= 240)
      const introBasis = introProse.filter(node => node !== lead && qualification.test(plain(node)))
      tree.children = [
        ...(intro.length ? [wrap('iexp-story-intro', [wrap('iexp-story-arch', [...introHeadings, ...(lead ? [lead] : [])]), ...(introBasis.length ? [wrap('iexp-story-basis', introBasis)] : []), ...disclosure(introProse.filter(node => node !== lead && !introBasis.includes(node)))])] : []),
        ...plan.sections.map(section => {
          const nodes = original.filter(node => { const start = node.position?.start.offset; return start !== undefined && start >= section.start && start < section.end })
          const subheadings = nodes.flatMap((node, index) => node.type === 'heading' && node.depth === section.headingDepth + 1 ? [index] : [])
          if (subheadings.length < 2) return arrange(nodes, 'iexp-story-section')
          const boundaries = [0, ...subheadings]
          const parts = boundaries.map((from, index) => nodes.slice(from, boundaries[index + 1] ?? nodes.length)).filter(part => part.length)
          return wrap('iexp-story-section', parts.map(part => arrange(part, 'iexp-story-panel')), { 'data-story-layout': 'chapter', 'aria-label': section.title }, 'section')
        }),
      ]
    }
  }
}

export const continuousCss = `
.dsh-experience.iexp-reply-surface:has(> .iexp-continuous) { padding:0; }
.iexp-content .iexp-continuous { container-type:inline-size; container-name:iexp-story; position:relative; isolation:isolate; min-width:0; overflow:clip; --iexp-story-rule:color-mix(in srgb,var(--iexp-text) 13%,transparent); --iexp-story-grid:color-mix(in srgb,var(--iexp-text) 2%,transparent); --iexp-story-space:clamp(24px,4cqi,52px); font-family:'DSH Paper Sans','PingFang SC',system-ui,sans-serif; }
.iexp-continuous::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:-1; background-image:linear-gradient(var(--iexp-story-grid) 1px,transparent 1px),linear-gradient(90deg,var(--iexp-story-grid) 1px,transparent 1px); background-size:80px 80px; }
.iexp-content .iexp-continuous > .iexp-heading-index { margin:16px var(--iexp-story-space) 24px; }
.iexp-content .iexp-continuous > .openui-markdown-renderer { margin-inline:var(--iexp-story-space); border-inline:1px solid var(--iexp-story-rule); }
.iexp-continuous .iexp-story-intro { position:relative; border-block:1px solid var(--iexp-story-rule); background:linear-gradient(140deg,color-mix(in srgb,var(--iexp-text) 11%,var(--iexp-bg)),var(--iexp-bg) 64%); }
.iexp-continuous .iexp-story-arch { position:relative; isolation:isolate; padding:clamp(88px,12cqi,144px) 32px 64px; overflow:hidden; text-align:center; }
.iexp-story-arch::before { content:''; position:absolute; z-index:-1; top:40px; left:-1px; width:100%; height:calc(200% - 40px); border:1px solid var(--iexp-story-rule); border-radius:50% 50% 0 0; background:var(--iexp-bg); }
.iexp-content .iexp-story-arch h1 { max-width:22ch; margin:0 auto 28px; justify-content:center; font-size:clamp(30px,4.7cqi,56px); line-height:1.22; font-weight:360; letter-spacing:-.035em; }
.iexp-content .iexp-story-arch > p { max-width:62ch; margin:0 auto; color:var(--iexp-muted); line-height:1.8; }
.iexp-content .iexp-continuous :is(h1,h2,h3) > span[aria-hidden=true] { display:none!important; }
.iexp-continuous .iexp-story-section { position:relative; border-top:1px solid var(--iexp-story-rule); }
.iexp-continuous .iexp-story-section + .iexp-story-section { margin-top:48px; }
.iexp-story-section::before { content:''; position:absolute; height:48px; width:calc(100% + 160px); top:-49px; left:-80px; pointer-events:none; background:linear-gradient(135deg,transparent calc(50% - .5px),var(--iexp-story-rule) 50%,transparent calc(50% + .5px)); }
.iexp-story-section::after,.iexp-story-intro::after { content:''; position:absolute; inset:-4px; pointer-events:none; background:linear-gradient(var(--iexp-bg),var(--iexp-bg)) top left/7px 7px no-repeat,linear-gradient(var(--iexp-bg),var(--iexp-bg)) top right/7px 7px no-repeat,linear-gradient(var(--iexp-story-rule),var(--iexp-story-rule)) top left/9px 9px no-repeat,linear-gradient(var(--iexp-story-rule),var(--iexp-story-rule)) top right/9px 9px no-repeat; }
.iexp-continuous .iexp-story-panel { position:relative; min-width:0; }
.iexp-continuous .iexp-story-panel + .iexp-story-panel { border-top:1px solid var(--iexp-story-rule); }
.iexp-content .iexp-story-heading { padding:40px 36px 28px; }
.iexp-content .iexp-story-heading:empty { display:none; }
.iexp-content .iexp-story-heading > :is(h1,h2,h3) { max-width:25ch; font-size:clamp(26px,3.4cqi,40px); line-height:1.28; font-weight:360; margin:0; padding:0; border:0; letter-spacing:-.025em; }
.iexp-content .iexp-story-section[data-story-layout=chapter] > .iexp-story-panel:first-child > .iexp-story-heading > h2 { font-size:clamp(30px,4.2cqi,48px); }
.iexp-content .iexp-story-copy { padding:0 36px 24px; max-width:78ch; }
.iexp-content .iexp-story-copy:empty { display:none; }
.iexp-content .iexp-story-copy > :first-child { margin-top:0; }
.iexp-content .iexp-story-copy p { margin:0 0 16px; }
.iexp-content .iexp-story-stage { margin:0 20px; min-width:0; }
.iexp-content .iexp-story-stage > .iexp-table-group { margin:0 0 24px; }
.iexp-content .iexp-story-stage :is(.iexp-chart-grid,.iexp-full-table) { max-width:none; }
.iexp-content .iexp-story-stage .iexp-chart-card { max-width:none; width:100%; border:0; border-radius:0; background:transparent; box-shadow:none; }
.iexp-content .iexp-story-stage .iexp-chart-card:is(:hover,:focus-within) { box-shadow:none; }
.iexp-content .iexp-story-stage .iexp-chart-plot { padding:24px 24px 8px; }
.iexp-content .iexp-story-stage .iexp-card-head { padding:20px 24px; border:0; }
.iexp-content .iexp-story-stage .iexp-card-title { font-size:16px; font-weight:450; }
.iexp-content .iexp-story-stage .iexp-card-basis { font-size:12px; }
.iexp-content .iexp-story-stage .iexp-card-foot { padding:12px 24px 20px; }
.iexp-content .iexp-story-stage .iexp-chart-notes { padding-inline-start:18px; font-size:12px; color:var(--iexp-muted); }
.iexp-content .iexp-story-basis { padding:8px 36px 24px; max-width:82ch; font-size:13px; color:var(--iexp-muted); }
.iexp-content .iexp-story-basis p { margin:0 0 12px; }
.iexp-content .iexp-story-captions { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); border-top:1px solid var(--iexp-story-rule); }
.iexp-content .iexp-story-caption { min-width:0; padding:28px 36px 32px; color:var(--iexp-muted); font-size:15px; line-height:1.8; }
.iexp-content .iexp-story-caption + .iexp-story-caption { border-inline-start:1px solid var(--iexp-story-rule); }
.iexp-content .iexp-story-caption p { margin:0; }
.iexp-content .iexp-story-caption strong { color:var(--iexp-text); font-weight:500; }
.iexp-content .iexp-story-body { margin:0; padding:12px 36px 20px; border-top:1px solid var(--iexp-story-rule); }
.iexp-content .iexp-story-body > summary { min-height:40px; font-size:13px; }
.iexp-content .iexp-story-body > :not(summary) { max-width:74ch; }
.iexp-content .iexp-story-intro > .iexp-story-body { position:relative; background:var(--iexp-bg); }
.iexp-content .iexp-story-stage .iexp-master-detail { margin:0; padding:24px; border:1px solid var(--iexp-story-rule); border-radius:var(--iexp-panel-radius); background:var(--iexp-bg); }
.iexp-content .iexp-story-stage .iexp-object-detail h3 { font-size:24px; }
.iexp-content .iexp-story-stage img { width:100%; height:auto; border-radius:var(--iexp-card-radius); }
.iexp-content .iexp-paper-chart-deck { border:1px solid var(--iexp-story-rule); border-radius:var(--iexp-panel-radius); background:var(--iexp-bg); box-shadow:0 16px 48px color-mix(in srgb,var(--iexp-text) 5%,transparent); overflow:clip; }
.iexp-content .iexp-paper-chart-controls { display:flex; flex-wrap:wrap; align-items:center; gap:12px; border-bottom:1px solid var(--iexp-story-rule); padding:0 20px; }
.iexp-content .iexp-paper-chart-tabs { display:flex; flex:1; flex-wrap:wrap; gap:0 20px; min-width:0; }
.iexp-content .iexp-paper-chart-tabs button { display:flex; flex-direction:column; align-items:start; gap:2px; min-height:60px; padding:12px 0; border:0; border-bottom:2px solid transparent; border-radius:0; background:transparent; color:var(--iexp-muted); font:inherit; font-size:13px; text-align:start; cursor:pointer; }
.iexp-content .iexp-paper-chart-tabs button[aria-selected=true] { border-bottom-color:var(--iexp-accent); color:var(--iexp-text); }
.iexp-content .iexp-paper-chart-tab-meta { font-size:11px; color:var(--iexp-muted); }
.iexp-content .iexp-paper-chart-playback { display:inline-flex; align-items:center; gap:8px; background:transparent; color:var(--iexp-muted); border:1px solid var(--iexp-story-rule); border-radius:var(--iexp-control-radius); padding:8px 12px; min-height:36px; cursor:pointer; font:inherit; font-size:12px; }
.iexp-content .iexp-paper-chart-playback:disabled { cursor:default; }
.iexp-content .iexp-paper-chart-status { font-size:12px; color:var(--iexp-muted); }
.iexp-content .iexp-paper-chart-scale-note { flex-basis:100%; margin:0 0 12px; font-size:12px; color:var(--iexp-muted); }
.iexp-content .iexp-paper-chart-stage { min-width:0; }
.iexp-content .iexp-paper-chart-panel[hidden] { display:none!important; }
.iexp-content .iexp-paper-chart-panel:not([hidden]) { animation:iexp-stage-reveal 440ms cubic-bezier(.16,1,.3,1) both; }
.iexp-content .iexp-paper-chart-data { border-top:1px solid var(--iexp-story-rule); padding:12px 24px; font-size:12px; color:var(--iexp-muted); }
.iexp-content .iexp-paper-chart-stage .iexp-card-foot { padding-inline-end:min(46%,500px); min-height:240px; box-sizing:border-box; }
.iexp-content .iexp-paper-chart-deck:has(.iexp-paper-chart-data-source) .iexp-card-foot { min-height:160px; }
.iexp-content .iexp-paper-chart-deck:has(.iexp-paper-chart-data-source) .iexp-paper-chart-data { margin-top:-120px; }
.iexp-content .iexp-paper-chart-data-meta { display:flex; flex-wrap:wrap; gap:8px 20px; }
.iexp-content .iexp-paper-chart-data-series { display:flex; flex-wrap:wrap; gap:8px 24px; }
.iexp-content .iexp-paper-chart-data-point { font-variant-numeric:tabular-nums; }
.iexp-content .iexp-paper-chart-deck { overflow:visible; margin-bottom:60px; }
.iexp-content .iexp-paper-chart-data { position:relative; width:min(440px,calc(100% - 40px)); box-sizing:border-box; margin:-200px 20px -24px auto; transform:translateY(24px); border:1px solid var(--iexp-story-rule); border-radius:var(--iexp-card-radius); background:var(--iexp-bg); box-shadow:0 12px 32px color-mix(in srgb,var(--iexp-text) 8%,transparent); }
.iexp-content .iexp-paper-chart-stage .iexp-card-foot { padding-inline-end:min(46%,500px); min-height:240px; box-sizing:border-box; }
.iexp-content .iexp-paper-chart-deck:has(.iexp-paper-chart-data-source) .iexp-card-foot { min-height:160px; }
.iexp-content .iexp-paper-chart-deck:has(.iexp-paper-chart-data-source) .iexp-paper-chart-data { margin-top:-120px; }
.iexp-content .iexp-paper-chart-data-meta { margin:0 0 8px; }
.iexp-content .iexp-paper-chart-data-scroll { overflow:auto; max-height:280px; }
.iexp-content .iexp-paper-chart-data table { font-size:12px; }
@keyframes iexp-stage-reveal { from { clip-path:inset(0 0 5% 0); transform:translateY(8px); } to { clip-path:inset(0); transform:translateY(0); } }
@container iexp-story (max-width:700px) {
 .iexp-content .iexp-paper-chart-stage .iexp-card-foot { padding-inline-end:24px; min-height:0!important; }
 .iexp-content .iexp-paper-chart-data,.iexp-content .iexp-paper-chart-deck:has(.iexp-paper-chart-data-source) .iexp-paper-chart-data { margin-top:0; }
 .iexp-content .iexp-story-stage .iexp-master-detail { grid-template-columns:minmax(0,1fr); }
 .iexp-content .iexp-story-stage .iexp-object-list { display:block; max-height:300px; overflow:auto; }
 .iexp-content .iexp-story-stage .iexp-object-list button { min-width:0; max-width:none; width:100%; }
 .iexp-content .iexp-story-stage .iexp-record-fields { grid-template-columns:minmax(0,1fr); gap:4px; }
 .iexp-content .iexp-story-stage .iexp-record-fields dt { margin-top:12px; }
 .iexp-content .iexp-story-heading { padding:32px 24px 24px; }
 .iexp-content :is(.iexp-story-copy,.iexp-story-basis) { padding-inline:24px; }
 .iexp-content .iexp-story-stage { margin-inline:12px; }
 .iexp-content .iexp-story-caption { padding:24px; }
 .iexp-content .iexp-story-caption + .iexp-story-caption { border-inline-start:0; border-top:1px solid var(--iexp-story-rule); }
 .iexp-content .iexp-story-body { padding-inline:24px; }
 .iexp-content .iexp-story-arch { padding-inline:24px; }
}
@container iexp-story (max-width:480px) {
 .iexp-content .iexp-continuous > .openui-markdown-renderer { margin-inline:12px; }
 .iexp-content .iexp-continuous > .iexp-heading-index { margin-inline:12px; }
 .iexp-content .iexp-paper-chart-tabs { flex-basis:100%; flex-wrap:nowrap; overflow-x:auto; gap:20px; }
 .iexp-content .iexp-paper-chart-tabs button { flex-shrink:0; }
 .iexp-content .iexp-paper-chart-data { margin-inline:12px; width:calc(100% - 24px); padding-inline:12px; }
 .iexp-content .iexp-story-stage .iexp-master-detail { grid-template-columns:minmax(0,1fr); padding:16px; }
 .iexp-content .iexp-story-heading { padding:28px 16px 20px; }
 .iexp-content :is(.iexp-story-copy,.iexp-story-basis) { padding-inline:16px; }
 .iexp-content .iexp-story-stage { margin-inline:8px; }
 .iexp-content .iexp-story-stage :is(.iexp-card-head,.iexp-card-foot) { padding-inline:12px; }
 .iexp-content .iexp-story-stage .iexp-chart-plot { padding:16px 8px 4px; }
 .iexp-content .iexp-story-caption { padding:20px 16px; font-size:14px; }
 .iexp-content .iexp-story-body { padding-inline:16px; }
 .iexp-content .iexp-paper-chart-controls { padding:0 12px 12px; }
 .iexp-content .iexp-story-arch { padding:96px 16px 44px; }
 .iexp-content .iexp-story-arch h1 { font-size:30px; }
}
@media(prefers-reduced-motion:reduce) { .iexp-content .iexp-paper-chart-panel:not([hidden]) { animation:none; } }
`
