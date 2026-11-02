import { createElement as h, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { ExperienceStore } from './client.js'
import { builtInThemes, resolveTheme } from './theme-contracts.js'

/** The current theme can be changed without leaving the conversation. */
export function ThemeQuickSwitch({ store }: { store: ExperienceStore }): ReactElement {
  const { api, settings } = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const [pending, setPending] = useState<string>()
  const [failure, setFailure] = useState('')
  const sequence = useRef(0), mounted = useRef(true), pendingRef = useRef<string>(), id = useId()
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; sequence.current++ }
  }, [])
  const imported = settings?.theme?.installed ?? []
  const themes = [...builtInThemes, ...imported]
  const selected = settings ? resolveTheme(settings.theme).id : ''
  const value = pending && themes.some(theme => theme.id === pending) ? pending : selected

  function choose(id: string) {
    const current = store.snapshot()
    if (!current.api || !current.settings) return
    const theme = [...builtInThemes, ...(current.settings.theme?.installed ?? [])].find(item => item.id === id)
    if (!theme || (!pendingRef.current && id === resolveTheme(current.settings.theme).id)) return
    const ticket = ++sequence.current
    pendingRef.current = theme.id
    setPending(theme.id); setFailure('')
    void store.save({ expectedRevision: current.settings.revision, takeover: current.settings.takeover, openui: current.settings.openui, mcpApps: current.settings.mcpApps, themeId: theme.id, appearance: theme.appearance })
      .then(() => { if (mounted.current && ticket === sequence.current) { pendingRef.current = undefined; setPending(undefined) } }, error => {
        if (mounted.current && ticket === sequence.current) { pendingRef.current = undefined; setPending(undefined); setFailure(error instanceof Error ? error.message : String(error)) }
      })
  }

  return h('div', { className: 'iexp-quick-theme', 'aria-busy': !!pending },
    h('label', { className: 'iexp-quick-theme-label' }, h('span', null, '主题'),
      h('select', { className: 'iexp-control iexp-quick-theme-select', 'aria-label': '界面主题', 'aria-describedby': failure ? `${id}-error` : undefined,
        title: '切换界面主题', value, disabled: !api || !settings, onChange: (event: { currentTarget: HTMLSelectElement }) => choose(event.currentTarget.value) },
      !settings && h('option', { value: '' }, '正在读取主题…'),
      h('optgroup', { label: '内置主题' }, ...builtInThemes.map(theme => h('option', { key: theme.id, value: theme.id }, theme.name))),
      imported.length > 0 && h('optgroup', { label: '已导入' }, ...imported.map(theme => h('option', { key: theme.id, value: theme.id }, theme.name))))),
    h('span', { className: 'iexp-quick-theme-status', role: 'status' }, pending ? '正在切换主题' : ''),
    failure && h('span', { id: `${id}-error`, role: 'alert', className: 'iexp-header-error' }, `主题未保存：${failure}，请重试。`))
}
