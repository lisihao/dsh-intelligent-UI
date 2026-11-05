/** Presentation adapters for the installed rc.2 sidebar and Synapse 0.5.7.
 * Original nodes, event handlers, drag coordinates and registrations stay owned
 * by their plugins. Removing this sheet restores their original presentation.
 */
const moduleClass = (name: string) => `:is([class$="_${name}"],[class*="_${name} "])`
const sidebarFoot = `[data-slot="sidebar"] ${moduleClass('footArea')}:has(.cm-footer-stack)`
const frameRoot = `[data-slot="root"] > ${moduleClass('frame')}`
const frame = `${frameRoot}:has(> [data-shell-overlay])`
const synapse = `body:has(${frameRoot} > [data-shell-overlay]):has(.dsh-synapse-host > .dsh-synapse-switch)`

export const shellLayoutCss = `
/* Settings and other actions stay above the independently scrolling fee block. */
${sidebarFoot} {
  display:flex!important;flex-direction:column!important;align-items:stretch!important;
  min-height:0;flex-shrink:1;reading-flow:flex-visual;
}
${sidebarFoot} > ${moduleClass('settingsArea')} { order:0!important;flex:none; }
${sidebarFoot} > ${moduleClass('footerActions')} { order:1!important;min-height:0; }
${sidebarFoot} [data-slot="sidebar.footer.action"] {
  display:flex!important;flex-direction:column!important;align-items:stretch!important;
  min-width:0;min-height:0;gap:4px;reading-flow:flex-visual;
}
${sidebarFoot} .cm-footer-stack {
  order:100!important;flex:0 1 auto!important;min-height:0;
  max-height:min(36dvh,320px);overflow-y:auto;overscroll-behavior:contain;
}
/* Reserve a separate global view-switch row, aligned to the right of window controls.
   Session labels and utilities keep their native layout beneath that row. */
${synapse} ${frame} > :is(${moduleClass('centerCol')},${moduleClass('rightbarCol')}) {
  box-sizing:border-box;padding-block-start:44px;
}
${synapse} .dsh-synapse-switch {
  position:fixed!important;inset-inline-start:auto!important;inset-inline-end:12px!important;
  top:calc(var(--dsh-frame-chrome-top,0px) + 4px)!important;
  left:auto!important;right:12px!important;transform:none!important;
  box-sizing:border-box;max-width:calc(100% - 24px);height:36px;z-index:200;
  background:var(--dsw-alias-bg-base,Canvas)!important;
  border-color:var(--dsw-alias-border-l2,ButtonBorder)!important;
  box-shadow:none!important;backdrop-filter:none!important;
}
${synapse} .dsh-synapse-switch .dsh-synapse-grip { display:none; }
${synapse} .dsh-synapse-switch button { color:var(--dsw-alias-label-secondary,CanvasText);font-family:inherit; }
${synapse} .dsh-synapse-switch button.active {
  color:var(--dsw-alias-label-primary-inverted,HighlightText);
  background:var(--dsw-alias-state-business-primary,Highlight);
}
${synapse} .dsh-synapse-switch button:focus-visible {
  outline:2px solid var(--dsw-focus-ring-color,Highlight);outline-offset:2px;
}
${synapse} .dsh-synapse-overlay {
  top:calc(var(--dsh-frame-chrome-top,0px) + 44px)!important;
}
html[data-fullscreen] ${synapse} .dsh-synapse-switch { top:4px!important; }
html[data-fullscreen] ${synapse} .dsh-synapse-overlay { top:44px!important; }
`

export function installShellLayoutStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.solarShellLayout = ''
  style.textContent = shellLayoutCss
  document.head.append(style)
  return () => style.remove()
}
