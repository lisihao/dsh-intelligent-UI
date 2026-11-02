/** Appended after scoped React Flow vendor CSS; every rule remains plugin-owned. */
export const flowViewCss = `
.dsh-experience .iexp-flow { margin: 16px 0; min-width: 0; color: var(--iexp-text); }
.dsh-experience .iexp-flow-caption { display: grid; gap: 6px; margin-bottom: 12px; }
.dsh-experience .iexp-flow-caption > strong { font-size: 17px; font-weight: 600; }
.dsh-experience .iexp-flow-caption > span, .dsh-experience .iexp-flow-help { font-size: 12px; line-height: 1.7; color: var(--iexp-muted); }
.dsh-experience .iexp-flow-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.dsh-experience .iexp-flow-toolbar button { font: inherit; font-size: 13px; color: var(--iexp-text); background: var(--iexp-card); border: 1px solid var(--iexp-line); border-radius: var(--iexp-small-control-radius); min-height: 36px; padding: 5px 12px; cursor: pointer; }
.dsh-experience .iexp-flow-toolbar button:hover:not(:disabled) { border-color: var(--iexp-accent); background: var(--iexp-soft); }
.dsh-experience .iexp-flow-toolbar button:active:not(:disabled) { background: var(--iexp-soft); }
.dsh-experience .iexp-flow-toolbar button:disabled { color: var(--iexp-muted); cursor: default; }
.dsh-experience .iexp-flow-viewport { height: 440px; width: 100%; min-width: 0; border: 1px solid var(--iexp-line); border-radius: var(--iexp-node-radius); overflow: hidden; background: var(--iexp-soft); }
.dsh-experience .iexp-flow .react-flow { --xy-background-color-default: var(--iexp-soft); --xy-controls-button-background-color-default: var(--iexp-card); --xy-controls-button-background-color-hover-default: var(--iexp-soft); --xy-controls-button-color-default: var(--iexp-text); --xy-controls-button-border-color-default: var(--iexp-line); --xy-edge-label-color-default: var(--iexp-text); }
.dsh-experience .iexp-flow-node { width: 100%; height: 100%; box-sizing: border-box; padding: 16px 18px; color: var(--iexp-text); border: 1px solid var(--iexp-line); background: var(--iexp-card); border-radius: var(--iexp-node-radius); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 24px; }
.dsh-experience .iexp-flow-node > strong { display: block; font-size: 15px; font-weight: 600; }
.dsh-experience .iexp-flow-node > p { font-size: 13px; line-height: 22px; color: var(--iexp-muted); margin: 10px 0 0; }
.dsh-experience .iexp-flow .react-flow__node.selected .iexp-flow-node { border-color: var(--iexp-accent); box-shadow: var(--iexp-shadow-node); }
.dsh-experience .iexp-flow .react-flow__node:focus-visible { outline: 2px solid var(--iexp-accent); outline-offset: 4px; border-radius: var(--iexp-node-radius); }
.dsh-experience .iexp-flow-node[data-related] { border-color: var(--iexp-accent); }
.dsh-experience .iexp-flow .iexp-flow-node-muted { opacity: .55; }
.dsh-experience .iexp-flow .iexp-flow-edge-muted { opacity: .3; }
.dsh-experience .iexp-flow .react-flow__handle { width: 6px; height: 6px; border: 1px solid var(--iexp-card); background: var(--iexp-accent); pointer-events: none; }
.dsh-experience .iexp-flow .react-flow__controls { box-shadow: var(--iexp-shadow-flow); border: 1px solid var(--iexp-line); border-radius: var(--iexp-small-control-radius); overflow: hidden; }
.dsh-experience .iexp-flow .react-flow__controls-button { width: 34px; height: 34px; }
.dsh-experience .iexp-flow .react-flow__attribution { background: var(--iexp-card); color: var(--iexp-muted); }
.dsh-experience .iexp-flow .react-flow__attribution a { color: inherit; }
.dsh-experience .iexp-flow-help { margin: 10px 0; }
.dsh-experience .iexp-flow-selection { padding: 14px 0; border-block: 1px solid var(--iexp-line); font-size: 13px; }
.dsh-experience .iexp-flow-selection > p { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-experience .iexp-flow-selection ul { margin: 8px 0 0; padding-left: 20px; }
.dsh-experience .iexp-flow-selection li { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-experience .iexp-flow-source { margin-top: 12px; font-size: 13px; }
.dsh-experience .iexp-flow-source pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.75; background: var(--iexp-soft); border: 1px solid var(--iexp-line); padding: 12px; border-radius: var(--iexp-small-control-radius); }
.dsh-experience .iexp-flow-source p { max-width: 74ch; }
.dsh-experience .iexp-flow[data-motion='still'] .react-flow__edge-path { animation: none; }
.dsh-experience .iexp-flow-overview { width: 100%; height: 360px; display: block; background: var(--iexp-soft); border: 1px solid var(--iexp-line); border-radius: var(--iexp-node-radius); }
.dsh-experience .iexp-flow-search { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-block: 12px; }
.dsh-experience .iexp-flow-search label { display: grid; gap: 8px; flex: 1; min-width: min(240px, 100%); }
.dsh-experience .iexp-flow-source-pages { margin-block: 12px; border-top: 1px solid var(--iexp-line); font-size: 13px; }
.dsh-experience .iexp-flow-source-pages > summary { cursor: pointer; min-height: 36px; padding-block: 8px; }
.dsh-experience .iexp-flow-source-pages .iexp-flow-toolbar { align-items: center; }
.dsh-experience .iexp-flow-source-pages input[type='number'] { width: 6em; }
.dsh-experience .iexp-flow-source-pages li { padding-block: 8px; overflow-wrap: anywhere; }
.dsh-experience .iexp-flow-source-pages li p { margin-block: 8px; white-space: pre-wrap; }
.dsh-experience .iexp-flow-large .iexp-flow-node-compact { height: 72px; overflow: hidden; }
.dsh-experience .iexp-flow-node-compact > strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dsh-experience .iexp-flow-large :is(summary, input, button):focus-visible { outline: 2px solid var(--iexp-accent); outline-offset: 3px; }

@media (max-width: 560px) { .dsh-experience .iexp-flow-viewport { height: 400px; } }
@media (prefers-reduced-motion: reduce) { .dsh-experience .iexp-flow .react-flow__edge-path { animation: none !important; } }
`
