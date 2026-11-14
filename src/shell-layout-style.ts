/** Presentation adapters for the installed rc.2 sidebar and Synapse 0.5.7.
 * Original nodes, event handlers, drag coordinates and registrations stay owned
 * by their plugins. Removing this sheet restores their original presentation.
 */
const moduleClass = (name: string) => `:is([class$="_${name}"],[class*="_${name} "])`
const sidebarFoot = `[data-slot="sidebar"] ${moduleClass('footArea')}:has(.cm-footer-stack)`
const frameRoot = `[data-slot="root"] > ${moduleClass('frame')}`
const synapse = `body:has(${frameRoot} > [data-shell-overlay]):has(.dsh-synapse-host > .dsh-synapse-switch)`

export const shellLayoutCss = `
/* The native caption strips are above full-window plugin portals. The
   transparent container itself must not subtract a no-drag rectangle. */
[data-solar-titlebar-zoom] {
  position:fixed;inset:0 0 auto;height:var(--dsh-frame-top-clearance,48px);
  z-index:2147483647;pointer-events:none;-webkit-app-region:initial!important;
}
[data-solar-titlebar-zoom] > div {
  position:absolute;top:0;bottom:0;-webkit-app-region:drag;user-select:none;
}
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
  user-select:none;
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

const captionControls = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary', '[contenteditable="true"]',
  '[tabindex]', '[data-window-drag-recall]', '.dsh-synapse-switch', '.solar-wm-entry', '.solar-wm-panel',
  'iframe', 'webview',
  ...['button', 'tab', 'link', 'dialog', 'alertdialog', 'menu', 'menuitem', 'listbox', 'combobox', 'textbox']
    .map(role => `[role="${role}"]`),
].join(',')

function installMacTitlebar(): () => void {
  const html = document.documentElement
  if (html.dataset.platform !== 'darwin') return () => {}
  const layer = document.createElement('div')
  layer.dataset.solarTitlebarZoom = ''
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)
  let request = 0
  let last = ''
  const update = () => {
    request = 0
    const frame = document.querySelector(frameRoot)
    const { width, height } = layer.getBoundingClientRect()
    const gaps: [number, number][] = []
    if (frame && !html.hasAttribute('data-fullscreen')) {
      // The three native traffic lights and their immediate margins.
      let left = 84
      const blocked: [number, number][] = []
      for (const node of document.querySelectorAll(captionControls)) {
        const r = node.getBoundingClientRect()
        if (r.top >= height || r.bottom <= 0 || r.right <= left || r.left >= width || !r.width) continue
        const style = getComputedStyle(node)
        if (style.visibility !== 'visible' || style.pointerEvents === 'none') continue
        blocked.push([Math.floor(r.left), Math.ceil(r.right)])
      }
      blocked.sort((a, b) => a[0] - b[0])
      for (const [start, end] of blocked) {
        if (start > left) gaps.push([left, start])
        left = Math.max(left, end)
      }
      if (left < width) gaps.push([left, width])
    }
    const key = JSON.stringify(gaps)
    if (key === last) return
    last = key
    layer.replaceChildren(...gaps.map(([left, right]) => {
      const strip = document.createElement('div')
      strip.style.left = `${left}px`
      strip.style.width = `${right - left}px`
      return strip
    }))
  }
  const schedule = () => { if (!request) request = requestAnimationFrame(update) }
  const changes = new MutationObserver(records => {
    if (records.some(record => !layer.contains(record.target))) schedule()
  })
  changes.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'tabindex', 'role', 'aria-expanded', 'data-sidebar-collapsed'],
  })
  changes.observe(html, { attributes: true, attributeFilter: ['data-fullscreen'] })
  const bounds = new ResizeObserver(schedule)
  bounds.observe(layer)
  bounds.observe(document.body)
  // CSS transitions can finish after their class mutation has been measured.
  document.addEventListener('transitionend', schedule, true)
  schedule()
  return () => {
    changes.disconnect()
    bounds.disconnect()
    if (request) cancelAnimationFrame(request)
    document.removeEventListener('transitionend', schedule, true)
    layer.remove()
  }
}

export function installShellLayoutStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.solarShellLayout = ''
  style.textContent = shellLayoutCss
  document.head.append(style)
  const disposeTitlebar = installMacTitlebar()
  return () => { disposeTitlebar(); style.remove() }
}
