/** Presentation adapters for the installed rc.2 sidebar and Synapse 0.5.7.
 * Original nodes, event handlers, drag coordinates and registrations stay owned
 * by their plugins. Removing this sheet restores their original presentation.
 */
const moduleClass = (name: string) => `:is([class$="_${name}"],[class*="_${name} "])`
const sidebarFoot = `[data-slot="sidebar"] ${moduleClass('footArea')}:has(.cm-footer-stack)`
const frameRoot = `[data-slot="root"] > ${moduleClass('frame')}`
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
  min-width:0;min-height:0;gap:4px;
  width:100%;flex:1 1 0%;align-self:stretch;
}
${sidebarFoot} .cm-footer-stack {
  order:100!important;flex:0 1 auto!important;min-height:0;
  box-sizing:border-box;width:100%!important;align-self:stretch;
  max-height:min(36dvh,320px);overflow-y:auto;overscroll-behavior:contain;
}
/* Move only DS Bot's existing return button beside the brand. Its original
   React handler and lifetime remain owned by DS Bot. Unsupported anchors keep
   the original footer placement. */
@supports (anchor-name: --solar-dsbot-brand) and (left: anchor(right)) {
  [data-slot="sidebar"] ${moduleClass('logoRow')} { anchor-name:--solar-dsbot-brand; }
  body:not(:has([data-sidebar-collapsed])) [data-slot="sidebar.footer.action"] > .bt-return {
    position:fixed;position-anchor:--solar-dsbot-brand;z-index:25;
    left:calc(anchor(right) - 60px);top:calc(anchor(center) - 14px);right:auto;bottom:auto;
    box-sizing:border-box;width:60px;min-width:60px;max-width:60px;
    height:28px;min-height:28px;margin:0;padding:0;gap:3px;
    justify-content:center;font-size:12px;white-space:nowrap;
  }
  body:not(:has([data-sidebar-collapsed])) [data-slot="sidebar.footer.action"] > .bt-return .bt-mark { width:14px!important;height:14px!important;flex:none; }
  body:not(:has([data-sidebar-collapsed])) [data-slot="sidebar.footer.action"] > .bt-return .bt-return-name { flex:none;overflow:visible;text-overflow:clip; }
  body:not(:has([data-sidebar-collapsed])) [data-slot="sidebar.footer.action"] > .bt-return svg { width:14px;height:14px;flex:none; }
  [data-slot="sidebar.footer.action"] > .bt-return:focus-visible {
    outline:2px solid var(--dsw-focus-ring-color,Highlight);outline-offset:2px;
  }
}
/* Float without reserving header space. Synapse's saved inline left/top/transform
   take precedence over these defaults, so native drag and restart restore work. */
${synapse} .dsh-synapse-switch {
  position:fixed;left:auto;right:12px;
  top:calc(var(--dsh-frame-chrome-top,0px) + 48px);transform:none;
  box-sizing:border-box;width:max-content;max-width:calc(100% - 16px);height:36px;z-index:200;
  background:var(--dsw-alias-bg-base,Canvas)!important;
  border-color:var(--dsw-alias-border-l2,ButtonBorder)!important;
  box-shadow:none!important;backdrop-filter:none!important;
}
${synapse} .dsh-synapse-switch button { color:var(--dsw-alias-label-secondary,CanvasText);font-family:inherit; }
${synapse} .dsh-synapse-switch button.active {
  color:var(--dsw-alias-label-primary-inverted,HighlightText);
  background:var(--dsw-alias-state-business-primary,Highlight);
}
${synapse} .dsh-synapse-switch button:focus-visible {
  outline:2px solid var(--dsw-focus-ring-color,Highlight);outline-offset:2px;
}

`

export function installShellLayoutStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.solarShellLayout = ''
  style.textContent = shellLayoutCss
  document.head.append(style)
  return () => style.remove()
}
