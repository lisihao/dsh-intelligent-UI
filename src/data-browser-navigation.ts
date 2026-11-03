import { createElement as h, Fragment, useSyncExternalStore, type ComponentType, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export const DATA_BROWSER_PANEL_ID = 'solar-intelligent-data-browser' as MainPanelId

const navigationStyle = `
.iexp-data-browser-nav { box-sizing:border-box; display:flex; align-items:center; gap:8px; width:calc(100% - 4px); min-height:36px; margin:0 2px; padding:7px 8px; border:0; border-radius:var(--dsw-radius-md, 6px); background:transparent; color:var(--dsw-alias-label-primary, CanvasText); font:inherit; line-height:22px; text-align:left; cursor:pointer; }
.iexp-data-browser-nav:hover, .iexp-data-browser-nav[aria-current="page"] { background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.15)); }
.iexp-data-browser-nav:focus-visible { outline:2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, Highlight)); outline-offset:-2px; }
.iexp-data-browser-nav[data-compact="true"] { width:36px; height:36px; margin:0; padding:0; justify-content:center; }
.iexp-data-browser-nav svg { flex:none; }
`

/** Install only an official footer action and its matching owned main panel. */
export function installDataBrowserNavigation(ctx: Context, Browser: ComponentType<PropsRuntime<'main'>>): () => Promise<void> {
  const { layout } = ctx
  function Entry({ wide }: PropsRuntime<'sidebar.footer.action'>): ReactElement {
    const current = () => layout.panelInfo.getSnapshot().activePanelId === DATA_BROWSER_PANEL_ID
    const active = useSyncExternalStore(layout.panelInfo.subscribe, current, current)
    return h(Fragment, null,
      h('style', null, navigationStyle),
      h('button', {
        type: 'button', className: 'iexp-data-browser-nav', 'data-compact': !wide,
        'aria-label': '数据浏览器', 'aria-current': active ? 'page' : undefined,
        title: wide ? undefined : '数据浏览器',
        onClick: () => layout.selectPanel(current() ? null : DATA_BROWSER_PANEL_ID),
      }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }),
        h('path', { d: 'M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7' })),
      wide ? h('span', null, '数据浏览器') : null))
  }
  function Panel(props: PropsRuntime<'main'>): ReactElement {
    return h('section', {
      'aria-label': '数据浏览器',
      style: {
        boxSizing: 'border-box', display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
        minWidth: 0, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', overscrollBehavior: 'contain',
        paddingTop: 'var(--dsh-frame-top-clearance, 0px)', paddingInlineStart: 'var(--dsh-frame-leading-clearance, 0px)',
      },
    }, h(Browser, props))
  }

  return ctx.effect(() => ctx.slots.inject('main', () => {
    const removePanel = ctx.slots.register({ name: 'main', key: DATA_BROWSER_PANEL_ID }, Panel)
    let removeEntry: () => void
    try {
      // DS Bot mode may hide sidebar.panellist; use its public footer action seat.
      removeEntry = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: DATA_BROWSER_PANEL_ID, order: 50 }, Entry))
    } catch (error) { removePanel(); throw error }
    return () => {
      removeEntry()
      try { if (layout.panelInfo.getSnapshot().activePanelId === DATA_BROWSER_PANEL_ID) layout.selectPanel(null) }
      finally { removePanel() }
    }
  }), 'intelligent-ui: data browser navigation')
}
