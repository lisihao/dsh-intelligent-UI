/** The user's translucent/rounded/elevated refinement, confined to plugin-owned surfaces. */
export const surfaceCss = `
.dsh-experience.iexp-content {
  border-radius: var(--iexp-panel-radius); border: 1px solid var(--iexp-line);
  backdrop-filter: var(--iexp-backdrop); -webkit-backdrop-filter: var(--iexp-backdrop);
  box-shadow: var(--iexp-shadow-panel); background-clip: padding-box;
}
.iexp-content :is(.iexp-chart-card,.iexp-object-detail,.iexp-task) {
  border: 1px solid var(--iexp-line); border-radius: var(--iexp-card-radius); background: var(--iexp-card);
  box-shadow: var(--iexp-shadow-card);
  transition: transform 180ms cubic-bezier(.2,.8,.2,1),background-color 180ms ease-out,border-color 180ms ease-out,box-shadow 180ms ease-out;
}
.iexp-content .iexp-chart-card.iexp-chart-comparison { padding: 0; }
.iexp-content .iexp-chart-comparison .iexp-card-head { padding: 10px 16px 8px; }
.iexp-content .iexp-chart-comparison .iexp-chart-plot { padding: 6px 16px 0; }
.iexp-content .iexp-chart-comparison .iexp-card-foot { padding: 4px 16px 8px; }
.iexp-content .iexp-object-detail { padding: calc(18px * var(--iexp-density)); }
.iexp-content .iexp-board-columns { padding-top: 6px; }
.iexp-content .iexp-board-column { border-radius: var(--iexp-canvas-radius); }
.iexp-content .iexp-object-list { border: 0; padding: 4px; }
.iexp-content .iexp-object-list button { border-radius: var(--iexp-list-radius); margin-bottom: 6px; border: 1px solid transparent; transition: background-color 180ms ease-out,border-color 180ms ease-out; }
.iexp-content .iexp-object-list button[aria-pressed=true] { box-shadow: none; border-color: var(--iexp-accent); }
.iexp-content .iexp-flow-viewport { border-radius: var(--iexp-canvas-radius); box-shadow: var(--iexp-shadow-flow); transition: transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms ease-out,border-color 180ms ease-out; }
.iexp-content .iexp-flow-node { border-radius: var(--iexp-node-radius); box-shadow: var(--iexp-shadow-node); transition: background-color 180ms ease-out,box-shadow 180ms ease-out,border-color 180ms ease-out; }
.iexp-content .iexp-flow .react-flow__node:focus-visible { border-radius:var(--iexp-node-radius); }
.iexp-content .iexp-flow-node:hover { background: var(--iexp-card-hover); border-color: var(--iexp-accent); }
.iexp-content :is(.iexp-source-table,.iexp-heading-index) { border-radius: var(--iexp-source-radius); }
.iexp-content :is(.iexp-chart-card,.iexp-task,.iexp-object-detail,.iexp-flow-viewport):focus-within {
  background-color: var(--iexp-card-hover); border-color: var(--iexp-accent); box-shadow: var(--iexp-shadow-focus);
}
@media (hover:hover) and (pointer:fine) {
 .iexp-content :is(.iexp-chart-card,.iexp-task,.iexp-object-detail):hover {
  transform: translateY(var(--iexp-hover-lift)); background: var(--iexp-card-hover); border-color: var(--iexp-accent); box-shadow: var(--iexp-shadow-focus);
 }
 .iexp-content .iexp-flow-viewport:hover { transform: translateY(var(--iexp-canvas-lift)); border-color: var(--iexp-accent); box-shadow: var(--iexp-shadow-focus); }
}
.iexp-header-controls { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:6px 10px; min-width:0; }
.iexp-transparency-control { display:inline-flex; align-items:center; gap:6px; min-height:36px; font-size:13px; white-space:nowrap; cursor:pointer; }
.iexp-transparency-control input { margin:0; accent-color:var(--dsw-alias-label-primary,currentColor); }
.iexp-header-error { max-width:240px; font-size:12px; overflow-wrap:anywhere; }
@media(max-width:560px) { .dsh-experience.iexp-content { border-radius:var(--iexp-panel-radius-narrow); } .iexp-content .iexp-object-detail { padding:16px; } }
@media(prefers-reduced-motion:reduce) { .iexp-content :is(.iexp-chart-card,.iexp-task,.iexp-object-detail,.iexp-flow-viewport,.iexp-flow-node,.iexp-object-list button) { transition:none; transform:none!important; } }
`
