/** Research content only; host navigation and other plugins are outside this surface. */
export const researchCss = `
.iexp-research { min-width:0; color:var(--iexp-text); font-family:var(--iexp-font); font-size:15px; line-height:1.7; overflow-wrap:anywhere; }
.iexp-research [hidden] { display:none!important; }
.iexp-research.is-enabled { container-type:inline-size; box-sizing:border-box; width:100%; max-width:1240px; margin-inline:auto; padding:clamp(16px,2.5vw,calc(24px * var(--iexp-density))); background:var(--iexp-bg); border:1px solid var(--iexp-line); border-radius:var(--iexp-panel-radius); box-shadow:var(--iexp-shadow-panel); }
.iexp-research.is-enabled .iexp-research-report .dsh-experience.iexp-content { background:transparent; border:0; border-radius:0; box-shadow:none; backdrop-filter:none; -webkit-backdrop-filter:none; padding:0; max-width:none; margin:0; }
.iexp-research-toolbar,.iexp-research-row,.iexp-research-actions,.iexp-research-save { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; }
.iexp-research-toolbar { justify-content:space-between; padding:12px 0 16px; border-bottom:1px solid var(--iexp-line); margin-bottom:16px; }
.iexp-research-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:4px; background:var(--iexp-soft); border:1px solid var(--iexp-line); border-radius:var(--iexp-control-radius); }
.iexp-research-tabs [role=tab][aria-selected=true] { background:var(--iexp-card-hover); outline:1px solid var(--iexp-accent); outline-offset:-1px; }
.iexp-research-tabs .iexp-uiv-button { min-width:64px; }
.iexp-research-mode { display:inline-flex; align-items:center; gap:8px; font-size:13px; }
.iexp-research-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:24px; align-items:start; }
.iexp-research-layout[data-inspector-open=true] { grid-template-columns:minmax(0,1fr) 360px; }
.iexp-research-main { min-width:0; }
.iexp-research h2 { font-size:21px; font-weight:500; line-height:1.4; margin:24px 0 12px; }
.iexp-research h3 { font-size:17px; font-weight:500; line-height:1.5; margin:16px 0 8px; }
.iexp-research h4 { font-size:15px; font-weight:500; margin:16px 0 8px; }
.iexp-research p { max-width:74ch; margin:8px 0 12px; }
.iexp-research-question { font-size:17px; }
.iexp-research-muted,.iexp-research-status { color:var(--iexp-muted); font-size:13px; }
.iexp-research-status:empty { display:none; }
.iexp-research-status [role=alert] { color:var(--iexp-text); padding:12px 16px; border:1px solid var(--iexp-line); border-radius:var(--iexp-field-radius); }
.iexp-research-confirm { padding:16px; background:var(--iexp-soft); border-radius:var(--iexp-source-radius); margin-bottom:16px; }
.iexp-research-conditions { display:flex; flex-wrap:wrap; gap:8px; list-style:none; padding:0; margin:8px 0 12px; }
.iexp-research-conditions > li { box-sizing:border-box; max-width:100%; padding:4px 8px; border:1px solid var(--iexp-line); border-radius:var(--iexp-field-radius); background:var(--iexp-soft); font-size:13px; line-height:1.6; }
.iexp-research-note { margin-top:12px; }
.iexp-research-note > summary { display:list-item; min-height:36px; cursor:pointer; color:var(--iexp-muted); font-size:13px; }
.iexp-research-note[open] > summary { color:var(--iexp-text); }
.iexp-research-claim { padding:8px 0 24px; border-bottom:1px solid var(--iexp-line); scroll-margin-block:32px; }
.iexp-research-row { justify-content:space-between; font-size:13px; }
.iexp-research-actions { margin-block:12px; }
.iexp-research-actions [aria-pressed=true] { outline:1px solid var(--iexp-accent); outline-offset:2px; }
.iexp-research-section { margin-block:32px; }
.iexp-research-opposition,.iexp-research-question-row { padding-block:12px; border-bottom:1px solid var(--iexp-line); }
.iexp-research label { display:block; font-size:13px; margin-block:12px 4px; }
.iexp-research-field { display:block; box-sizing:border-box; width:100%; max-width:100%; min-height:80px; resize:vertical; border:1px solid var(--iexp-line); border-radius:var(--iexp-field-radius); background:var(--iexp-soft); color:var(--iexp-text); font:inherit; padding:12px 16px; caret-color:var(--iexp-accent); }
.iexp-research .iexp-uiv-input { max-width:74ch; }
.iexp-research-icon { display:inline-flex; vertical-align:middle; margin-inline-end:8px; }
.iexp-research .iexp-uiv-button-label { display:inline-flex; align-items:center; }
.iexp-research-save { padding:12px 0; background:var(--iexp-bg); border-top:1px solid var(--iexp-line); font-size:13px; }
.iexp-research-sources { padding-inline-start:24px; }
.iexp-research-sources li { padding-block:12px; border-bottom:1px solid var(--iexp-line); }
.iexp-research-sources li > span { display:block; margin-top:8px; }
.iexp-research-table { overflow:auto; max-width:100%; scrollbar-color:var(--iexp-line) var(--iexp-bg); }
.iexp-research table { width:100%; border-collapse:collapse; font-size:13px; font-variant-numeric:tabular-nums; }
.iexp-research :is(th,td) { padding:8px; text-align:start; vertical-align:top; border-bottom:1px solid var(--iexp-line); min-width:120px; }
.iexp-research th { font-weight:500; }
.iexp-research table .iexp-uiv-button { justify-content:start; text-align:start; white-space:normal; }
.iexp-research pre { white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.7 var(--iexp-code-font); }
.iexp-research a { color:var(--iexp-accent); text-underline-offset:4px; }
.iexp-research-inspector { position:sticky; top:16px; box-sizing:border-box; padding:20px; border:1px solid var(--iexp-line); border-radius:var(--iexp-card-radius); background:var(--iexp-card); box-shadow:var(--iexp-shadow-card); max-height:80vh; overflow:auto; scrollbar-color:var(--iexp-line) var(--iexp-card); }
.iexp-research-inspector .iexp-research-row h2 { margin:0; }
.iexp-research-excerpt { margin:16px 0; white-space:pre-wrap; padding:12px 0; border-block:1px solid var(--iexp-line); font-size:15px; line-height:1.7; }
.iexp-research-inspector-wrap.is-modal { position:fixed; inset:0; z-index:1200; display:flex; align-items:center; justify-content:center; padding:16px; background:color-mix(in srgb,var(--iexp-solid-bg) 80%,transparent); }
.iexp-research-inspector-wrap.is-modal .iexp-research-inspector { position:relative; top:auto; background:var(--iexp-solid-card); width:min(100%,520px); max-height:calc(100dvh - 32px); }
.iexp-research-draft { margin-block:24px; padding-top:16px; border-top:1px solid var(--iexp-line); }
.iexp-research-draft > .iexp-uiv-button { margin-top:12px; }
.iexp-research :is(button,a,input,textarea,summary,[tabindex]):focus-visible { outline:2px solid var(--iexp-accent); outline-offset:3px; }
.iexp-research-report [data-iexp-research-highlight=true] { background:color-mix(in srgb,var(--iexp-accent) 16%,var(--iexp-bg)); outline:2px solid var(--iexp-accent); outline-offset:4px; scroll-margin-block:32px; }
.iexp-research-location { padding-block:12px; border-bottom:1px solid var(--iexp-line); margin-bottom:16px; color:var(--iexp-muted); font-size:13px; }
.iexp-research ::selection { background:var(--iexp-accent); color:var(--iexp-bg); }
@container (max-width:560px) { .iexp-research-toolbar { align-items:start; } .iexp-research-tabs { width:100%; } .iexp-research-tabs [role=tab] { min-width:0; flex:1; } .iexp-research h2 { font-size:21px; } }
@media(prefers-reduced-motion:reduce) { .iexp-research *, .iexp-research *::before,.iexp-research *::after { scroll-behavior:auto; } }
`
