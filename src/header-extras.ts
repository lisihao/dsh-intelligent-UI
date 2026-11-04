import { createElement as h, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react'
import { IconWrapper } from '@openuidev/react-ui'
import type { ExperienceStore } from './client.js'
import { ResearchModeControl } from './research-view.js'
import { TransparencyControl } from './transparency-control.js'

function isOpen(element: HTMLElement): boolean {
  try { return element.matches(':popover-open') } catch { return false }
}

/** One set of controls, inline when there is room and in a native popover otherwise. */
export function HeaderExtras({ store, sessionId, compact, showResearch, beforeWide }: {
  store: ExperienceStore; sessionId: string; compact: boolean; showResearch: boolean; beforeWide: MutableRefObject<() => void>
}): ReactElement {
  const id = useId(), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const focusAfterWide = useRef<HTMLElement>(), [open, setOpen] = useState(false), [closeRevision, setCloseRevision] = useState(0)
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const sync = () => {
      const visible = isOpen(element)
      setOpen(visible)
      if (!visible) setCloseRevision(value => value + 1)
    }
    element.addEventListener('toggle', sync)
    return () => { element.removeEventListener('toggle', sync); if (isOpen(element)) element.hidePopover() }
  }, [])
  useLayoutEffect(() => {
    const close = () => {
      const element = panel.current
      setCloseRevision(value => value + 1)
      if (!element) return
      const active = element.ownerDocument.activeElement
      if (active === button.current) focusAfterWide.current = element.querySelector<HTMLElement>('.iexp-research-mode input') ?? element.closest('.iexp-header-controls')?.querySelector<HTMLElement>('select[aria-label="界面主题"]') ?? undefined
      if (!isOpen(element)) return
      if (active instanceof HTMLElement && element.contains(active)) {
        focusAfterWide.current = active.closest('.iexp-opacity-popover')
          ? element.querySelector<HTMLElement>('.iexp-research-mode input') ?? element.closest('.iexp-header-controls')?.querySelector<HTMLElement>('select[aria-label="界面主题"]') ?? undefined
          : active
      }
      element.hidePopover()
      setOpen(false)
    }
    beforeWide.current = close
    return () => { if (beforeWide.current === close) beforeWide.current = () => {} }
  }, [beforeWide])
  useLayoutEffect(() => {
    if (!compact && focusAfterWide.current?.isConnected) focusAfterWide.current.focus({ preventScroll: true })
    if (!compact) focusAfterWide.current = undefined
  }, [compact])
  useLayoutEffect(() => {
    const element = panel.current, anchor = button.current, view = element?.ownerDocument.defaultView
    if (!compact || !open || !element || !anchor || !view) return
    const position = () => {
      const target = anchor.getBoundingClientRect(), rect = element.getBoundingClientRect()
      const left = Math.max(8, Math.min(target.right - rect.width, view.innerWidth - rect.width - 8))
      const below = target.bottom + 6
      const top = Math.max(8, Math.min(below + rect.height <= view.innerHeight - 8 ? below : target.top - rect.height - 6, view.innerHeight - rect.height - 8))
      element.style.left = `${left}px`; element.style.top = `${top}px`
    }
    position()
    view.addEventListener('resize', position); view.addEventListener('scroll', position, true)
    return () => { view.removeEventListener('resize', position); view.removeEventListener('scroll', position, true) }
  }, [compact, open])
  return h('div', { className: 'iexp-header-extras' },
    compact && h('button', { key: 'button', ref: button, type: 'button', className: 'iexp-header-extras-button',
      'aria-label': '更多显示选项', 'aria-haspopup': 'dialog', 'aria-controls': id, 'aria-expanded': open,
      ...{ popovertarget: id } }, h(IconWrapper, { name: 'sliders-horizontal', size: 16 })),
    h('div', { key: 'panel', ref: panel, id, className: 'iexp-header-extras-panel', ...(compact ? { popover: 'auto', role: 'dialog', 'aria-label': '更多显示选项' } : {}) },
      showResearch && h(ResearchModeControl, { sessionId }), h(TransparencyControl, { store, available: !compact || open, closeRevision })))
}
