import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { ExperienceStore } from './client.js'
import { defaultAppearance } from './contracts.js'
import { appearanceTokens, type Appearance } from './appearance.js'
import { resolveTheme } from './theme-contracts.js'

/** A native range previews backgrounds locally; only a completed gesture writes settings. */
export function TransparencyControl({ store, available = true, closeRevision = 0 }: { store: ExperienceStore; available?: boolean; closeRevision?: number }): ReactElement {
  const { settings, error, appearancePreview } = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const owner = useRef({}).current, id = useId()
  const wrapper = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), anchor = useRef<HTMLLabelElement>(null)
  const dirty = useRef(false), saving = useRef(false), closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastCloseRevision = useRef(closeRevision)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  const appearance = settings?.appearance ?? defaultAppearance()
  const active = appearancePreview ?? appearance
  const opacity = appearanceTokens({ ...active, translucent: true }, resolveTheme(settings?.theme)).backgroundOpacity
  const percent = Math.round((1 - opacity) * 100)
  function clearClose() { clearTimeout(closeTimer.current) }
  function closeLater() {
    clearClose()
    closeTimer.current = setTimeout(() => { if (!wrapper.current?.contains(document.activeElement)) setOpen(false) }, 180)
  }
  useEffect(() => { dirty.current = false; store.previewAppearance(owner) }, [store, owner, settings?.revision])
  useEffect(() => () => { clearClose(); store.previewAppearance(owner) }, [store, owner])
  useLayoutEffect(() => {
    const newlyClosed = closeRevision !== lastCloseRevision.current
    lastCloseRevision.current = closeRevision
    if (available && !newlyClosed) return
    clearClose(); dirty.current = false; store.previewAppearance(owner); setOpen(false)
  }, [store, owner, available, closeRevision])
  useLayoutEffect(() => {
    const popup = panel.current
    if (!popup) return
    if (!open) return
    const position = () => {
      const target = anchor.current?.getBoundingClientRect()
      if (!target) return
      popup.style.left = `${Math.max(12, Math.min(target.right - 256, window.innerWidth - 268))}px`
      popup.style.top = `${Math.max(12, Math.min(target.bottom + 8, window.innerHeight - popup.getBoundingClientRect().height - 12))}px`
    }
    popup.showPopover(); position()
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); if (popup.matches(':popover-open')) popup.hidePopover() }
  }, [open])
  async function persist(next: Appearance) {
    if (saving.current) return
    const current = store.snapshot().settings
    if (!current) return
    saving.current = true; dirty.current = false; setBusy(true); setFailure('')
    const request = { expectedRevision: current.revision, takeover: current.takeover, openui: current.openui, mcpApps: current.mcpApps, appearance: next }
    try { await store.save(request) }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); await store.refresh() }
    finally { store.previewAppearance(owner); saving.current = false; setBusy(false) }
  }
  function preview(value: string) {
    dirty.current = true
    store.previewAppearance(owner, { ...appearance, translucent: true, backgroundOpacity: Number((1 - Number(value) / 100).toFixed(2)) })
  }
  function commit() {
    if (dirty.current) void persist(store.snapshot().appearancePreview ?? appearance)
  }
  return h('div', { ref: wrapper, className: 'iexp-transparency', onMouseEnter: () => { clearClose(); setOpen(true) }, onMouseLeave: closeLater,
    onFocus: () => { clearClose(); setOpen(true) }, onBlur: (event: { relatedTarget: EventTarget | null }) => { if (!wrapper.current?.contains(event.relatedTarget as Node | null)) { commit(); setOpen(false) } },
    onKeyDown: (event: { key: string; stopPropagation(): void }) => { if (event.key === 'Escape') { event.stopPropagation(); dirty.current = false; store.previewAppearance(owner); setOpen(false) } } },
    h('label', { ref: anchor, className: 'iexp-transparency-control', title: '悬停或聚焦以调节背景透明度；文字保持实色。' },
      h('input', { type: 'checkbox', checked: active.translucent, disabled: !settings || busy, 'aria-controls': id, 'aria-expanded': open,
        onChange: (event: { currentTarget: HTMLInputElement }) => { void persist({ ...active, translucent: event.currentTarget.checked }) } }), '开启透明'),
    h('div', { ref: panel, id, popover: 'manual', className: 'iexp-opacity-popover', role: 'group', 'aria-label': '透明度调节', style: { backgroundColor: active.backgroundColor }, onMouseEnter: clearClose, onMouseLeave: closeLater },
      h('div', { className: 'iexp-opacity-heading' }, h('label', { htmlFor: `${id}-range` }, '背景透明度'), h('output', { htmlFor: `${id}-range`, 'aria-live': 'off' }, `${percent}%`)),
      h('input', { id: `${id}-range`, type: 'range', min: 0, max: 70, step: 1, value: percent, disabled: !settings || busy, 'aria-label': '背景透明度', 'aria-valuetext': `${percent}% 透明`,
        onChange: (event: { currentTarget: HTMLInputElement }) => preview(event.currentTarget.value), onPointerUp: commit,
        onKeyUp: (event: { key: string }) => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) commit() } }),
      h('div', { className: 'iexp-opacity-scale', 'aria-hidden': true }, h('span', null, '不透明'), h('span', null, '更透明')),
      h('p', null, active.translucent ? '拖动实时预览，松手后保存' : '透明已关闭，拖动滑杆即可开启')),
    failure && h('span', { role: 'alert', className: 'iexp-header-error' }, `透明设置未保存：${failure}`),
    error && h('span', { role: 'alert', className: 'iexp-header-error' }, settings ? '设置连接暂时不可用，已保留上次读到的设置。' : '设置连接暂时不可用，尚未读取到设置。'))
}
