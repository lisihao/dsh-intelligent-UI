/** Settings share one control scale; every selector belongs to this plugin. */
export const settingsCss = `
.dsh-experience.iexp-settings {
 --iexp-settings-accent:var(--iexp-accent,var(--dsw-alias-label-primary,currentColor));
 --iexp-settings-line:color-mix(in srgb,currentColor 18%,transparent);
 display:grid; gap:12px; min-width:0; max-width:760px; padding:16px;
 color:var(--iexp-text,#202124); border-radius:20px; font:400 14px/1.6 system-ui,sans-serif;
 box-sizing:border-box; overflow-wrap:anywhere;
}
.iexp-settings *, .iexp-settings *::before, .iexp-settings *::after { box-sizing:border-box; }
.iexp-settings :is(h2,p) { margin:0; }
.iexp-settings h2 { font:600 20px/1.4 system-ui,sans-serif; }
.iexp-settings :is(fieldset,.iexp-settings-group) { display:grid; gap:12px; min-width:0; }
.iexp-settings fieldset { margin:4px 0 0; padding:16px; border:1px solid var(--iexp-settings-line); border-radius:16px; }
.iexp-settings legend { padding-inline:8px; font-weight:600; }
.iexp-settings .iexp-toggle-row { display:flex; align-items:baseline; gap:8px; min-height:32px; cursor:pointer; }
.iexp-settings input[type=checkbox] { margin:0; accent-color:var(--iexp-settings-accent); flex-shrink:0; }
.iexp-settings .iexp-control {
 display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:36px; max-width:100%;
 padding:6px 12px; border:1px solid var(--iexp-settings-line); border-radius:10px;
 color:inherit; background:color-mix(in srgb,currentColor 4%,transparent); font:inherit; line-height:1.5;
 text-decoration:none; cursor:pointer; transition:background-color 160ms ease-out,border-color 160ms ease-out;
}
.iexp-settings :is(input.iexp-control,select.iexp-control) { cursor:auto; }
.iexp-settings select.iexp-control { cursor:pointer; min-width:160px; }
.iexp-settings .iexp-control-primary { background:var(--iexp-settings-accent); color:var(--iexp-settings-ground,#24262b); border-color:transparent; font-weight:600; }
.iexp-settings :is(.iexp-control,.iexp-setting-link):focus-visible,
.iexp-settings .iexp-file-control:focus-within { outline:2px solid var(--iexp-settings-accent); outline-offset:3px; }
.iexp-settings :is(.iexp-control,.iexp-setting-link):hover { background:color-mix(in srgb,currentColor 10%,transparent); }
.iexp-settings .iexp-control-primary:hover { background:var(--iexp-settings-accent); border-color:currentColor; }
.iexp-settings :is(button,input,select):disabled { opacity:.5; cursor:default; }
.iexp-settings fieldset:disabled .iexp-file-control { opacity:.5; cursor:default; }
.iexp-settings .iexp-control-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; min-width:0; }
.iexp-settings .iexp-setting-link { display:inline-flex; align-items:center; min-height:36px; color:inherit; text-underline-offset:4px; border-radius:4px; }
.iexp-settings .iexp-setting-help { font-size:14px; line-height:1.6; color:var(--iexp-muted,currentColor); max-width:70ch; }
.iexp-settings .iexp-settings-group { padding-top:16px; border-top:1px solid var(--iexp-settings-line); }
.iexp-settings .iexp-theme-selection { display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; }
.iexp-settings .iexp-theme-preview { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:12px 16px; border:1px solid var(--iexp-settings-line); border-radius:12px; }
.iexp-settings .iexp-theme-preview strong { font-weight:600; }
.iexp-settings .iexp-theme-meta { display:block; font-size:14px; line-height:1.6; }
.iexp-settings .iexp-theme-palette { display:flex; gap:8px; }
.iexp-settings .iexp-theme-palette span { display:block; width:20px; height:20px; border-radius:6px; border:1px solid var(--iexp-settings-line); }
.iexp-settings .iexp-source-form { display:grid; gap:8px; min-width:0; }
.iexp-settings .iexp-source-input { width:100%; min-width:0; }
.dsh-experience.iexp-settings .iexp-source-input[aria-invalid=true] { border-color:var(--iexp-error); }
.iexp-settings .iexp-source-error { color:var(--iexp-error); }
.iexp-settings .iexp-theme-catalog { list-style:none; margin:0; padding:0; }
.iexp-settings .iexp-theme-catalog li { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; padding:8px 0; border-bottom:1px solid var(--iexp-settings-line); }
.iexp-settings .iexp-file-control { position:relative; overflow:hidden; }
.iexp-settings .iexp-file-control input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.iexp-settings .iexp-setting-feedback { margin:0; padding:8px 0; }
.iexp-settings [role=alert] { overflow-wrap:anywhere; }
.iexp-settings .iexp-appearance-color { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.iexp-settings .iexp-appearance-color input[type=color] { width:40px; height:36px; padding:4px; }
.iexp-settings .iexp-appearance-color input[type=text] { width:112px; font-variant-numeric:tabular-nums; }
.iexp-settings .iexp-appearance-controls > button { justify-self:start; }
.iexp-settings ::selection { background:var(--iexp-settings-accent); color:var(--iexp-settings-ground,#24262b); }
@media(max-width:480px) { .dsh-experience.iexp-settings { padding:12px; } .iexp-settings fieldset { padding:12px; } }
@media(prefers-reduced-motion:reduce) { .iexp-settings .iexp-control { transition:none; } }
`
