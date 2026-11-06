import { executionFlowCss } from './execution-flow-style.js'
import { tableViewportCss } from './table-viewport.js'
import { documentWorkbenchCss } from './document-workbench-style.js'
import { chartViewportCss } from './chart-viewport.js'
import { researchCss } from './research-style.js'
import { themeComponentsCss } from './theme-components-style.js'
import { openuiCss } from './openui-css.js'
import flowCss from '@xyflow/react/dist/style.css'
import { flowViewCss } from './flow-view.css.js'
import { layoutViewCss } from './layout-views.js'
import { settingsCss } from './settings-style.js'
import { continuousCss } from './continuous-view.js'
import { surfaceCss } from './surface-style.js'
import blockPresentationsCss from './block-presentations.css'
import { themeStyleTokens } from './theme-runtime.js'
import { appearanceTokens } from './appearance.js'
import { resolveTheme } from './theme-contracts.js'
import recursiveFont from '../assets/recursive-latin-full-normal.woff2'
import paperFont from '../assets/dm-sans-latin-wght-normal.woff2'
import type { CSSProperties } from 'react'
export const styles: Record<string, CSSProperties> = {
  panel: { display: 'grid', gridTemplateColumns:'minmax(0,1fr)', gap: 12, padding: 12, color: 'var(--dsw-alias-label-primary, #202124)', fontFamily: 'system-ui, sans-serif', minWidth: 0 },
  section: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: '8px 0', minWidth: 0 },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  button: { padding: '4px 9px', marginInlineEnd: 4, border: '1px solid var(--dsw-alias-border-l2, #b9bdc4)', borderRadius: 5, color: 'inherit', background: 'transparent', cursor: 'pointer' },
  modeControl: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: 13, color: 'var(--dsw-alias-label-primary, #202124)' },
  compare: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, minWidth: 0 },
  raw: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'auto', margin: 0, fontSize: 12 },
  text: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 },
  semanticHeading: { display: 'flex', gap: 8, alignItems: 'baseline' },
  headingIcon: { display: 'inline-flex', alignSelf: 'center', flexShrink: 0 },
  autoChart: { margin: '16px 0', minWidth: 0, padding: '12px 0', borderBlock: '1px solid var(--dsw-alias-border-l2, #d4d6da)' },
  chartCaption: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  chartReason: { fontSize: 13, lineHeight: 1.5, margin: '6px 0' },
  chartNotes: { fontSize: 13, lineHeight: 1.5, paddingInlineStart: 20, margin: '6px 0' },
  chartSource: { fontSize: 13, margin: '8px 0' },
  chartGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 16, minWidth: 0 },
  overflow: { overflowX: 'auto', maxWidth: '100%' }, table: { borderCollapse: 'collapse', width: '100%' },
  cell: { textAlign: 'left', verticalAlign: 'top', padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, #d4d6da)', overflowWrap: 'anywhere' },
}

/** Install only into the plugin scope; the disposer removes the exact injected sheet. */
export function installExperienceStyles(): () => void {
  const element = document.createElement('style')
  element.dataset.solarExperience = 'true'
  const defaults = Object.entries(themeStyleTokens(resolveTheme(), appearanceTokens())).map(([key, value]) => `${key}:${value}`).join(';')
  element.textContent = researchCss + openuiCss + flowCss + tableViewportCss + documentWorkbenchCss + `
@font-face { font-family: 'DSH Paper Sans'; src: url('${paperFont}') format('woff2'); font-weight: 100 1000; font-style: normal; font-display: swap; }
@font-face { font-family: 'DSH Recursive'; src: url('${recursiveFont}') format('woff2'); font-weight: 300 1000; font-style: normal; font-display: swap; }
.dsh-experience.iexp-content {
  color: var(--iexp-text); background: var(--iexp-bg); padding: clamp(16px, 2.5vw, calc(24px * var(--iexp-density))); border-radius: 0; max-width: 1240px; box-sizing: border-box; margin-inline: auto;
  font-family: var(--iexp-font);
  font-size: 15px; line-height: calc(1.7 * var(--iexp-density)); font-variation-settings: 'CASL' 0, 'MONO' var(--iexp-font-mono,0), 'slnt' 0, 'CRSV' 0; min-width: 0;
  scrollbar-color: var(--iexp-line) var(--iexp-bg); caret-color: var(--iexp-accent);
}
.iexp-content ::selection { background: var(--iexp-accent); color: var(--iexp-bg); }
.iexp-content .openui-markdown-renderer { color: inherit; font: inherit; }
.iexp-content .openui-markdown-renderer > :is(p, ul, ol, blockquote) { max-width: 74ch; }
.iexp-content .openui-markdown-renderer > p { margin: calc(10px * var(--iexp-density)) 0; }
.iexp-content .openui-markdown-renderer :is(h1,h2,h3,h4,h5,h6) { color: var(--iexp-text); line-height: 1.4; text-wrap: balance; font-family: inherit; letter-spacing: -.02em; font-weight: 360; scroll-margin-top: 90px; }
.iexp-content .openui-markdown-renderer h1 { font-size: 30px; margin: 4px 0 20px; max-width: 29ch; }
.iexp-content .openui-markdown-renderer h2 { font-size: 21px; margin: calc(32px * var(--iexp-density)) 0 12px; padding-top: 16px; border-top: 1px solid var(--iexp-line); }
.iexp-content .openui-markdown-renderer h3 { font-size: 17px; margin: calc(24px * var(--iexp-density)) 0 10px; }
.iexp-content .openui-markdown-renderer :is(h4,h5,h6) { font-size: 15px; margin: 20px 0 8px; }
.iexp-content .openui-markdown-renderer :is(h1,h2,h3) svg { color: var(--iexp-accent); width: 18px; height: 18px; stroke-width: 1.6; }
.iexp-content .openui-markdown-renderer a { color: var(--iexp-accent); text-decoration-thickness: 1px; text-underline-offset: 4px; }
.iexp-content .iexp-model-source-link { color: var(--iexp-text); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.iexp-content .iexp-model-source-link:focus-visible { outline: 2px solid var(--iexp-accent); outline-offset: 3px; border-radius: 2px; }
.iexp-content .openui-markdown-renderer :is(pre,blockquote) { background: var(--iexp-soft); border: 1px solid var(--iexp-line); border-radius: var(--iexp-control-radius); padding: calc(12px * var(--iexp-density)) calc(16px * var(--iexp-density)); color: var(--iexp-text); }
.iexp-content .openui-markdown-renderer pre { font-family: var(--iexp-code-font); font-variation-settings: 'MONO' 1, 'CASL' 0; }
.iexp-content .openui-markdown-renderer :not(pre) > code { background: var(--iexp-soft); color: var(--iexp-accent); border-radius: min(4px,var(--iexp-control-radius)); padding: 2px 5px; }
.iexp-content .openui-markdown-renderer hr { border-color: var(--iexp-line); margin: 24px 0; }
.iexp-table-group { margin: 16px 0; min-width: 0; }
.iexp-chart-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%, 310px),1fr)); gap: calc(16px * var(--iexp-density)) calc(20px * var(--iexp-density)); max-width: 1160px; align-items: start; }
.iexp-chart-card { margin: 0; min-width: 0; background: var(--iexp-card); border: 1px solid var(--iexp-line); border-radius: var(--iexp-control-radius); overflow: clip; box-shadow: var(--iexp-shadow-card); transition: border-color 220ms ease-out, box-shadow 220ms ease-out; }
.iexp-chart-card:only-child { max-width: 760px; }
.iexp-chart-card.iexp-chart-comparison { border: 0; border-radius: 0; background: transparent; box-shadow: none; padding: 8px 0; }
.iexp-chart-card.iexp-chart-comparison:is(:hover,:focus-within) { box-shadow: none; }
.iexp-chart-comparison .iexp-card-head { padding: 0 0 10px; border-bottom: 0; }
.iexp-chart-comparison .iexp-chart-plot { padding: 8px 0 0; }
.iexp-chart-comparison .iexp-card-foot { padding: 6px 0 0; }
.iexp-content .openui-markdown-renderer :is(h1,h2,h3,h4,h5,h6) > span:last-child { min-width: 0; }
.iexp-chart-card:is(:hover,:focus-within) { border-color: var(--iexp-accent); box-shadow: var(--iexp-shadow-focus); }
.iexp-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 16px; border-bottom: 1px solid var(--iexp-line); }
.iexp-card-title { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 13px; line-height: 1.6; }
.iexp-card-icon { display: inline-flex; color: var(--iexp-accent); flex-shrink: 0; }
.iexp-card-basis { font-size: 11px; color: var(--iexp-muted); font-variant-numeric: tabular-nums; }
.iexp-chart-plot { padding: 12px 16px 4px; min-width: 0; font-variant-numeric: tabular-nums; --openui-text-label-xs: 400 12px/16px var(--iexp-font); }
.iexp-chart-plot text { fill: var(--iexp-muted); }
.iexp-chart-plot [class*='horizontal-bar-chart-label'] { color: var(--iexp-muted); font-size: 12px; }
.iexp-chart-plot [class*='horizontal-bar-chart-internal-line'] { display: none; }
.iexp-card-foot { padding: 4px 16px 8px; font-size: 12px; color: var(--iexp-muted); line-height: 1.75; }
.iexp-chart-caveat { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--iexp-accent); }
.iexp-card-foot .iexp-chart-caveat { margin: 0 0 8px; }
.iexp-content details > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; min-height: 36px; color: var(--iexp-muted); }
.iexp-content details > summary::-webkit-details-marker { display: none; }
.iexp-content details > summary::after { content: '+'; margin-inline-start: auto; font-size: 16px; font-weight: 400; }
.iexp-content details[open] > summary::after { content: '−'; }
.iexp-content details > summary:hover { color: var(--iexp-text); }
.iexp-content .iexp-disclosure { border-top: 1px solid var(--iexp-line); padding-top: 2px; }
.iexp-content .iexp-disclosure > :not(summary) { padding-bottom: 12px; }
.iexp-content .iexp-disclosure p { margin: 8px 0; font-size: 12px; }
.iexp-content .iexp-disclosure ul { margin: 8px 0; padding-inline-start: 18px; font-size: 12px; }
.iexp-full-table { max-width: 1160px; margin-top: 8px; padding: 8px 2px; font-size: 12px; }
.iexp-full-table > summary > span { font-size: 11px; color: var(--iexp-muted); margin-inline-start: 5px; }
.iexp-source-table { background: var(--iexp-card); border: 1px solid var(--iexp-line); border-radius: var(--iexp-control-radius); margin: calc(10px * var(--iexp-density)) 0; }
.iexp-content table { width: 100%; border-collapse: collapse; font-size: 12px; color: var(--iexp-text); font-variant-numeric: tabular-nums; }
.iexp-content :is(th,td) { padding: calc(8px * var(--iexp-density)) 12px; border: 0; border-bottom: 1px solid var(--iexp-line); line-height: 1.7; text-align: start; }
.iexp-content th { color: var(--iexp-muted); font-weight: 500; background: var(--iexp-soft); }
.iexp-content tbody tr:last-child td { border-bottom: 0; }
.iexp-content tbody tr:hover td { background: var(--iexp-soft); }
.iexp-content [class*='table-row'] { background: transparent; }
.iexp-content :is(summary,button,a,[tabindex]):focus-visible { outline: 2px solid var(--iexp-accent); outline-offset: 3px; border-radius: min(4px,var(--iexp-control-radius)); }
.iexp-local-import { min-width:0; padding-block:8px 16px; border-bottom:1px solid var(--iexp-line); }
.iexp-local-import label { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-width:0; }
.iexp-local-import input[type='file'] { font:inherit; color:inherit; }
.iexp-import-help { color:var(--iexp-muted); font-size:13px; line-height:1.6; margin-block:8px; }
.iexp-source-label { min-width:0; overflow-wrap:anywhere; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary, inherit); }
.iexp-mode-control { border: 1px solid var(--dsw-alias-border-l2, #b9bdc4); border-radius: 999px; padding: 3px 5px 3px 10px; }
.iexp-mode-control select { border: 0 !important; padding: 4px 6px !important; }
@media (max-width: 560px) {
 .dsh-experience.iexp-content { padding: 16px 12px; font-size: 14px; }
 .iexp-content .openui-markdown-renderer h1 { font-size: 23px; }
 .iexp-card-head { padding: 10px 14px; }
 .iexp-chart-plot { padding: 12px 12px 4px; }
 .iexp-card-foot { padding: 4px 14px 8px; }
 .iexp-full-table > summary { flex-wrap: wrap; }
 .iexp-full-table > summary > span { display: none; }
}
@media (prefers-reduced-motion: reduce) { .iexp-chart-card { transition: none; } }
.dsh-experience .openui-markdown-renderer { overflow-wrap: anywhere; }
.dsh-experience .openui-markdown-renderer-code { white-space: pre-wrap; overflow-wrap: anywhere; }
.iexp-content .iexp-markdown-illustration-original { display:flex; align-items:center; justify-content:center; width:100%; height:auto; max-height:260px; min-height:0; }
.iexp-content .iexp-markdown-illustration-original img { display:block; max-width:100%; max-height:260px; width:auto; height:auto; object-fit:contain; }
.dsh-experience :is(button, select):focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
` + `.dsh-experience.iexp-content{${defaults}}` + flowViewCss + chartViewportCss + layoutViewCss + surfaceCss + settingsCss + continuousCss + themeComponentsCss + executionFlowCss + blockPresentationsCss
  document.head.append(element)
  return () => element.remove()
}
