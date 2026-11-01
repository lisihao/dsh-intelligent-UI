/** Source/role map: docs/design/uiverse-component-themes.md. Never selects foreign-plugin DOM. */
export const themeComponentsCss = `
.dsh-experience .iexp-uiv-button,.dsh-experience .iexp-uiv-input { box-sizing:border-box; font:inherit; color:var(--iexp-text); max-width:100%; min-height:36px; padding:8px 16px; transition:box-shadow 160ms ease-out,background-color 160ms ease-out,outline-offset 160ms ease-out; }
.dsh-experience .iexp-uiv-button { position:relative; isolation:isolate; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; overflow:visible; font-weight:600; }
.dsh-experience .iexp-uiv-button-label { position:relative; z-index:1; }
.dsh-experience .iexp-uiv-input { width:100%; caret-color:var(--iexp-accent); }
.dsh-experience .iexp-uiv-input::placeholder { color:var(--iexp-muted); }
.dsh-experience .iexp-uiv-button:disabled,.dsh-experience .iexp-uiv-input:disabled { opacity:.5; cursor:default; }
.dsh-experience :is(.iexp-uiv-button,.iexp-uiv-input):focus-visible { outline:2px solid var(--iexp-accent); outline-offset:4px; }
/* Praashoo7 button; lenfear23 input; Sashank02 card: paired raised/inset relief. */
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-button { border:1px solid transparent; border-radius:var(--iexp-control-radius); background:var(--iexp-bg); box-shadow:inset 2px 5px 10px #0003; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-button:hover:not(:disabled) { background:var(--iexp-text); color:var(--iexp-bg); }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-button:active:not(:disabled) { box-shadow:inset 4px 6px 12px #0005; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-input { background:var(--iexp-bg); border:1px solid var(--iexp-line); border-radius:var(--iexp-control-radius); box-shadow:5px 5px 17px #0002,-5px -5px 17px #fff9; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-input:focus { box-shadow:inset 5px 5px 17px #0002,inset -5px -5px 17px #fff9; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-card { background:var(--iexp-bg); border:1px solid var(--iexp-line); border-radius:var(--iexp-card-radius); box-shadow:5px 5px 6px #0002,-5px -5px 6px #fff9; }
/* akshat-patel28 glass button retains a separate backplate; Cksunandh rounded inset field. */
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-button { border:1px solid var(--iexp-line); border-radius:var(--iexp-control-radius); background:color-mix(in srgb,var(--iexp-text) 10%,var(--iexp-bg)); backdrop-filter:blur(10px); box-shadow:0 8px 16px #0004; }
.dsh-experience .iexp-uiv-backplate { position:absolute; inset:4px; z-index:0; border-radius:inherit; background:color-mix(in srgb,var(--iexp-accent) 15%,var(--iexp-bg)); transition:transform 160ms ease-out; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-button:hover:not(:disabled) .iexp-uiv-backplate { transform:rotate(-3deg); }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-button:active:not(:disabled) { box-shadow:none; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-input { border:1px solid var(--iexp-line); border-radius:24px; background:var(--iexp-bg); box-shadow:inset 0 -12px 20px #ffffff0d,0 4px 8px #0003; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-card { border:1px solid var(--iexp-line); border-radius:var(--iexp-card-radius); background:color-mix(in srgb,var(--iexp-card) 85%,transparent); backdrop-filter:blur(6px); box-shadow:12px 17px 51px #0004; }
/* rrr63 outline-offset hover; anniekoop hard offset field; 0xnihilism structural card. */
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-button { background:var(--iexp-accent); color:var(--iexp-button-text); border:2px solid var(--iexp-accent); border-radius:var(--iexp-control-radius); outline:2px solid var(--iexp-accent); outline-offset:0; }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-button:hover:not(:disabled) { outline-offset:3px; }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-input { background:var(--iexp-bg); border:2px solid var(--iexp-text); border-radius:var(--iexp-control-radius); box-shadow:3px 3px 0 var(--iexp-text); }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-input:focus { box-shadow:5px 6px 0 var(--iexp-text); }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-card { background:var(--iexp-bg); border:3px solid var(--iexp-text); border-radius:var(--iexp-card-radius); box-shadow:6px 6px 0 var(--iexp-text); }
/* Validation must win over every compiled field border, including the outline variant. */
.dsh-experience .iexp-uiv-input[data-iexp-component-set][aria-invalid=true] { border:2px solid var(--iexp-error); }
/* mobinkakei / vikramsinghnegi / ICe1BotMaker: native focusable inputs with owned track/thumb. */
.dsh-experience .iexp-uiv-toggle { position:relative; display:inline-block; width:56px; height:32px; flex:0 0 56px; vertical-align:middle; }
.dsh-experience .iexp-uiv-toggle > input { appearance:auto; position:absolute; inset:0; width:100%; height:100%; opacity:0; margin:0; z-index:2; cursor:pointer; }
.dsh-experience .iexp-uiv-track { position:absolute; inset:0; border-radius:16px; border:1px solid var(--iexp-line); background:var(--iexp-soft); pointer-events:none; }
.dsh-experience .iexp-uiv-thumb { position:absolute; width:24px; height:24px; left:3px; top:3px; border-radius:50%; background:var(--iexp-muted); transition:transform 160ms ease-out; }
.dsh-experience .iexp-uiv-toggle > input:checked + .iexp-uiv-track .iexp-uiv-thumb { transform:translateX(24px); background:var(--iexp-accent); }
.dsh-experience .iexp-uiv-toggle > input:focus-visible + .iexp-uiv-track { outline:2px solid var(--iexp-accent); outline-offset:4px; }
.dsh-experience .iexp-uiv-toggle > input:disabled + .iexp-uiv-track { opacity:.5; }
.dsh-experience [data-iexp-component-set=soft-relief] .iexp-uiv-track { box-shadow:inset 4px 4px 8px #0002,inset -4px -4px 8px #fff9; }
.dsh-experience [data-iexp-component-set=soft-relief] .iexp-uiv-thumb { box-shadow:-3px -2px 6px #fff9,3px 2px 6px #0003; }
.dsh-experience [data-iexp-component-set=clear-glass] .iexp-uiv-track { border:2px solid var(--iexp-line); background:#0003; box-shadow:inset 2px 2px 6px #0005; }
.dsh-experience [data-iexp-component-set=clear-glass] .iexp-uiv-thumb { border-radius:12px; background:linear-gradient(var(--iexp-muted),var(--iexp-soft)); border:1px solid var(--iexp-muted); box-shadow:inset 3px 0 4px #0004,inset -3px 0 4px #fff3; }
.dsh-experience [data-iexp-component-set=clear-glass] .iexp-uiv-thumb::after { content:''; position:absolute; inset:3px 9px; border-inline:1px solid var(--iexp-line); }
.dsh-experience [data-iexp-component-set=mechanical-outline] .iexp-uiv-track { border:2px solid var(--iexp-text); border-radius:4px; box-shadow:2px 2px 0 var(--iexp-text); }
.dsh-experience [data-iexp-component-set=mechanical-outline] .iexp-uiv-thumb { border-radius:2px; background:var(--iexp-text); }
/* angelo2004-mateus ring, Mike11jr three dots and G4b413l moving bar. */
.dsh-experience .iexp-uiv-loading { display:inline-flex; align-items:center; gap:12px; min-height:32px; flex-wrap:wrap; }
.dsh-experience .iexp-uiv-loader { display:inline-flex; position:relative; flex:none; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-loader { width:32px; height:32px; align-items:center; justify-content:center; border-radius:50%; box-shadow:-3px -3px 6px #fff9,3px 3px 6px #0002; }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-loader::before { content:''; position:absolute; inset:8px; z-index:1; border-radius:50%; background:var(--iexp-bg); border:1px solid var(--iexp-line); }
.dsh-experience [data-iexp-component-set=soft-relief].iexp-uiv-loader > span:first-child { width:80%; height:80%; border-radius:50%; background:conic-gradient(var(--iexp-accent),var(--iexp-soft)); animation:iexp-uiv-spin 1s linear infinite; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-loader { gap:8px; padding:8px; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-loader > span { width:8px; height:8px; border:double var(--iexp-text); border-radius:50%; background:var(--iexp-accent); animation:iexp-uiv-dot 1.6s linear infinite; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-loader > span:nth-child(1) { animation-delay:-.32s; }
.dsh-experience [data-iexp-component-set=clear-glass].iexp-uiv-loader > span:nth-child(2) { animation-delay:-.16s; }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-loader { width:80px; height:4px; background:linear-gradient(to right,transparent,var(--iexp-accent),transparent); overflow:hidden; }
.dsh-experience [data-iexp-component-set=mechanical-outline].iexp-uiv-loader::after { content:''; position:absolute; width:40px; height:100%; background:var(--iexp-text); animation:iexp-uiv-slide 1s ease-out infinite; }
.dsh-experience .iexp-uiv-preview { display:grid; gap:12px; min-width:0; }
.dsh-experience .iexp-uiv-preview h3 { font:600 16px/1.5 var(--iexp-font); margin:0; }
.dsh-experience .iexp-uiv-sample-card { padding:20px; margin:8px 8px 12px 0; overflow-wrap:anywhere; }
.dsh-experience .iexp-uiv-sample-card p { margin-block:12px 0; }
.dsh-experience .iexp-uiv-source { display:grid; gap:12px; min-width:0; padding-block:12px; }
.dsh-experience .iexp-uiv-source iframe { width:100%; height:320px; border:1px solid var(--iexp-line); border-radius:var(--iexp-card-radius); }
.dsh-experience .iexp-uiv-source pre { max-height:360px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.6 var(--iexp-code-font); }
.dsh-experience .iexp-uiv-source a { color:var(--iexp-accent); text-underline-offset:3px; }
@keyframes iexp-uiv-spin { to { transform:rotate(360deg); } }
@keyframes iexp-uiv-dot { 0%,80%,100% { transform:scale(.7); } 40% { transform:scale(1.4); } }
@keyframes iexp-uiv-slide { from { transform:translateX(-40px); } to { transform:translateX(80px); } }
@media(prefers-reduced-motion:reduce) { .dsh-experience :is(.iexp-uiv-button,.iexp-uiv-input,.iexp-uiv-backplate,.iexp-uiv-thumb),.dsh-experience .iexp-uiv-loader *,.dsh-experience .iexp-uiv-loader::after { animation:none; transition:none; } .dsh-experience .iexp-uiv-backplate { transform:none !important; } }
`
