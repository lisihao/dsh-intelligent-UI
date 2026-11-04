export const documentWorkbenchCss=`
.dsh-experience.iexp-document-workbench { display:flex; flex-direction:column; gap:12px; min-width:0; min-height:0; box-sizing:border-box; color:var(--iexp-text); font:15px/1.6 var(--iexp-font); container-type:inline-size; }
.iexp-data-browser { height:100%; padding:16px; overflow:hidden; background:var(--iexp-bg); }
.iexp-workbench-toolbar,.iexp-workbench-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; min-width:0; }
.iexp-workbench-toolbar { justify-content:space-between; }
.iexp-workbench-toolbar h1,.iexp-workbench-toolbar h2 { font-size:20px; font-weight:600; margin:0; }
.iexp-document-workbench .iexp-workbench-control { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:0; max-width:100%; min-height:36px; border:1px solid var(--iexp-line); border-radius:var(--iexp-control-radius); padding:6px 10px; background:var(--iexp-card); color:var(--iexp-text); font:inherit; font-size:13px; }
.iexp-document-workbench button.iexp-workbench-control { cursor:pointer; }
.iexp-document-workbench .iexp-workbench-control:hover:not(:disabled) { background:var(--iexp-card-hover); border-color:var(--iexp-accent); }
.iexp-document-workbench .iexp-workbench-control:disabled { opacity:.6; cursor:default; }
.iexp-workbench-body { display:grid; grid-template-columns:minmax(180px,260px) minmax(0,1fr); gap:16px; flex:1; min-height:0; min-width:0; }
.iexp-workbench-body[data-empty=true] { grid-template-columns:minmax(0,1fr); }
.iexp-workbench-list,.iexp-workbench-reader { min-width:0; min-height:0; overflow:auto; scrollbar-color:var(--iexp-line) transparent; }
.iexp-workbench-search { display:grid; gap:6px; font-size:13px; }
.iexp-workbench-search input { width:100%; }
.iexp-workbench-meta { color:var(--iexp-muted); font-size:13px; margin:8px 0; }
.iexp-workbench-list ul { list-style:none; margin:0; padding:0; }
.iexp-document-workbench .iexp-workbench-entry { display:block; box-sizing:border-box; width:100%; text-align:start; border:1px solid transparent; border-radius:var(--iexp-control-radius); background:transparent; color:var(--iexp-text); padding:10px 12px; font:inherit; cursor:pointer; overflow-wrap:anywhere; }
.iexp-workbench-entry strong { display:block; font-size:14px; font-weight:500; }
.iexp-workbench-entry span,.iexp-workbench-entry time { display:block; color:var(--iexp-muted); font-size:12px; }
.iexp-document-workbench .iexp-workbench-entry[aria-current=true] { border-color:var(--iexp-line); background:var(--iexp-card); }
.iexp-document-workbench .iexp-workbench-entry:hover { background:var(--iexp-card-hover); }
.iexp-workbench-reader { overflow-wrap:anywhere; }
.iexp-document-workbench .iexp-source-label { align-items:flex-start; margin-bottom:8px; color:var(--iexp-muted); }
.iexp-document-workbench .iexp-source-label > :first-child { flex:none; white-space:nowrap; }
.iexp-document-workbench .iexp-source-label > :last-child { min-width:0; }
.iexp-workbench-empty { padding:32px 16px; max-width:68ch; margin:auto; }
.iexp-workbench-empty h2 { font-size:20px; font-weight:500; }
.iexp-workbench-error { overflow-wrap:anywhere; margin:0; }
.iexp-document-workbench :is(button,input,select,a,[tabindex]):focus-visible { outline:2px solid var(--iexp-accent); outline-offset:2px; }
.iexp-browser-import { flex:none; max-height:40%; overflow:auto; }
.iexp-insight-preview { padding:12px; }
.iexp-preview-selectors { display:flex; flex-wrap:wrap; align-items:end; gap:12px 16px; }
.iexp-preview-selectors label { display:grid; gap:6px; min-width:0; max-width:100%; font-size:13px; }
.iexp-preview-selectors select { max-width:100%; }
.iexp-preview-document { min-width:0; }
.iexp-preview-provenance { min-width:0; font-size:13px; }
.iexp-preview-provenance summary { cursor:pointer; min-height:36px; }
.iexp-preview-provenance pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:480px; overflow:auto; font:13px/1.6 var(--iexp-code-font); }
@container(max-width:560px) { .iexp-insight-preview .iexp-research-tabs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); box-sizing:border-box; } .iexp-insight-preview .iexp-research-tabs [role=tab] { white-space:nowrap; padding-inline:8px; } }
@container(max-width:760px) { .iexp-workbench-body { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); } .iexp-workbench-list { max-height:160px; } .iexp-workbench-body[data-empty=true] { grid-template-rows:minmax(0,1fr); } }
`
