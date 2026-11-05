import { createElement as h, type ComponentType, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export const DATA_BROWSER_PANEL_ID = 'solar-intelligent-data-browser' as MainPanelId

/** Native panel rows own their label, focus and selected state. */
export function DataBrowserIcon({ size }: { size: number }): ReactElement {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }),
    h('path', { d: 'M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7' }))
}

/** Join the native Tools navigation and register the matching owned main panel. */
export function installDataBrowserNavigation(ctx: Context, Browser: ComponentType<PropsRuntime<'main'>>): () => Promise<void> {
  const { layout } = ctx
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
      // The existing Tools disclosure folds native panel rows together.
      removeEntry = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: DATA_BROWSER_PANEL_ID, order: 50, label: () => '数据浏览器' }, DataBrowserIcon))
    } catch (error) { removePanel(); throw error }
    return () => {
      removeEntry()
      try { if (layout.panelInfo.getSnapshot().activePanelId === DATA_BROWSER_PANEL_ID) layout.selectPanel(null) }
      finally { removePanel() }
    }
  }), 'intelligent-ui: data browser navigation')
}
