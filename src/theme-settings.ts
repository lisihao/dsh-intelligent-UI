import { createElement as h, useId, useState, useEffect, useRef, type ReactElement } from 'react'
import type { ExperienceSettings } from './contracts.js'
import { builtInThemes, MAX_THEME_BYTES, resolveTheme, themePackageSchema, type ThemePackage } from './theme-contracts.js'
import { appearanceTokens } from './appearance.js'
import { DEFAULT_THEME_SOURCE, DEFAULT_THEME_REPOSITORY, themeSourceSchema, themeSourceDirectory, type ThemeCatalog } from './theme-source.js'
import linen from './themes/linen-example.dsh-theme.json' with { type: 'json' }

const exampleTheme = themePackageSchema.parse(linen)
const downloadHref = (theme: ThemePackage) => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(theme, null, 2) + '\n')}`

export function parseThemeFile(text: string): ThemePackage {
  if (new TextEncoder().encode(text).byteLength > MAX_THEME_BYTES) throw new Error('主题文件超过 32 KiB，请选择较小的主题包。')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('主题文件不是有效的 JSON，请选择 .dsh-theme.json 文件。') }
  const parsed = themePackageSchema.safeParse(value)
  if (!parsed.success) {
    const version = value && typeof value === 'object' && 'formatVersion' in value ? value.formatVersion : undefined
    if (version !== 1) throw new Error('不支持这个主题包版本；当前支持 formatVersion 为 1 的主题包。')
    throw new Error('主题包字段或数值不符合格式，请检查主题名称、配色和样式参数。')
  }
  return parsed.data
}

export function ThemeSettings({ settings, busy, onSelect, onInstall, onRemove, onSaveSource, onCatalog, onDownload }: {
  settings?: ExperienceSettings
  busy: boolean
  onSaveSource(source: string): Promise<void>
  onCatalog(): Promise<ThemeCatalog>
  onDownload(source: string, id: string): Promise<void>
  onSelect(theme: ThemePackage): Promise<void>
  onInstall(theme: ThemePackage): Promise<void>
  onRemove(id: string): Promise<void>
}): ReactElement {
  const id = useId()
  const source = settings?.themeSource ?? DEFAULT_THEME_SOURCE
  const [sourceDraft, setSourceDraft] = useState(source)
  const [catalog, setCatalog] = useState<ThemeCatalog>()
  const [loading, setLoading] = useState(false)
  const requestGeneration = useRef(0)
  useEffect(() => { requestGeneration.current++; setSourceDraft(source); setCatalog(undefined); setLoading(false) }, [source])
  useEffect(() => () => { requestGeneration.current++ }, [])
  const [reading, setReading] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const selected = resolveTheme(settings?.theme)
  const imported = settings?.theme?.installed ?? []
  const themes = [...builtInThemes, ...imported]
  const builtin = builtInThemes.some(theme => theme.id === selected.id)
  const previewInk = appearanceTokens({ ...selected.appearance, translucent: false }).variables['--iexp-text']
  async function run(operation: () => Promise<void>, success: string) {
    setFailure(''); setNotice('')
    try { await operation(); setNotice(success) }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
  }
  async function importFile(input: HTMLInputElement) {
    const file = input.files?.[0]
    if (!file) return
    setReading(true); setFailure(''); setNotice('')
    try {
      if (file.size > MAX_THEME_BYTES) throw new Error('主题文件超过 32 KiB，请选择较小的主题包。')
      const theme = parseThemeFile(await file.text())
      const known = builtInThemes.find(item => item.id === theme.id)
      if (known && JSON.stringify(known) === JSON.stringify(theme)) { setNotice(`「${theme.name}」已内置，可在上方选择启用。`); return }
      await onInstall(theme)
      setNotice(`已导入「${theme.name}」，可在上方选择启用。`)
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { input.value = ''; setReading(false) }
  }
  async function browse() {
    const generation = ++requestGeneration.current
    setLoading(true); setFailure(''); setNotice(''); setCatalog(undefined)
    try { const value = await onCatalog(); if (generation === requestGeneration.current && value.source === source) setCatalog(value) }
    catch (error) { if (generation === requestGeneration.current) setFailure(error instanceof Error ? error.message : String(error)) }
    finally { if (generation === requestGeneration.current) setLoading(false) }
  }
  async function saveSource(value: string) {
    await run(async () => { const parsed = themeSourceSchema.parse(value); themeSourceDirectory(parsed); await onSaveSource(parsed) }, '主题来源已保存。')
  }
  return h('fieldset', { className: 'iexp-theme-controls', disabled: !settings || busy || reading },
    h('legend', null, '界面主题'),
    h('div', { className: 'iexp-theme-selection' },
      h('label', { htmlFor: id }, '当前主题'),
      h('select', { id, 'aria-label': '界面主题', value: selected.id, className: 'iexp-control', onChange: (event: { currentTarget: HTMLSelectElement }) => {
        const theme = themes.find(item => item.id === event.currentTarget.value)
        if (theme) void run(() => onSelect(theme), `已启用「${theme.name}」。`)
      } }, h('optgroup', { label: '内置主题' }, ...builtInThemes.map(theme => h('option', { key: theme.id, value: theme.id }, theme.name))), imported.length > 0 && h('optgroup', { label: '已导入' }, ...imported.map(theme => h('option', { key: theme.id, value: theme.id }, theme.name))))),
    h('div', { className: 'iexp-theme-preview', role: 'group', 'aria-label': `主题预览：${selected.name}`, style: { background: selected.appearance.backgroundColor, color: previewInk } },
      h('div', null, h('strong', null, selected.name), h('span', { className: 'iexp-theme-meta' }, `${builtin ? '内置' : '已导入'} · ${selected.version}${selected.author ? ` · ${selected.author}` : ''}`)),
      h('span', { className: 'iexp-theme-palette' }, ...selected.tokens.paletteDark.slice(0, 4).map((color, index) => h('span', { key: index, style: { background: color } })))),
    selected.description && h('p', { className: 'iexp-setting-help' }, selected.description),
    h('div', { className: 'iexp-settings-group' },
      h('label', { htmlFor: `${id}-source` }, '主题来源'),
      h('form', { className: 'iexp-source-form', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void saveSource(sourceDraft) } },
        h('input', { id: `${id}-source`, type: 'url', 'aria-label': '主题来源地址', 'aria-describedby': `${id}-source-help`, value: sourceDraft, maxLength: 2048, spellCheck: false, className: 'iexp-control iexp-source-input', onChange: (event: { currentTarget: HTMLInputElement }) => setSourceDraft(event.currentTarget.value) }),
        h('div', { className: 'iexp-control-row' }, h('button', { type: 'submit', className: 'iexp-control', disabled: sourceDraft.trim() === source }, '保存来源'),
          h('button', { type: 'button', className: 'iexp-control', disabled: source === DEFAULT_THEME_SOURCE, onClick: () => { void saveSource(DEFAULT_THEME_SOURCE) } }, '恢复默认来源'))),
      h('p', { className: 'iexp-setting-help', id: `${id}-source-help` }, '默认连接独立 UI 项目的 theme/ 目录。也支持其他 GitHub 目录或含 index.json 的主题目录；保存后生效。'),
      h('div', { className: 'iexp-control-row' },
        h('button', { type: 'button', className: 'iexp-control iexp-control-primary', disabled: loading, onClick: () => { void browse() } }, loading ? '正在读取主题…' : '浏览来源主题'),
        h('a', { className: 'iexp-setting-link', href: source === DEFAULT_THEME_SOURCE ? DEFAULT_THEME_REPOSITORY : source, target: '_blank', rel: 'noreferrer' }, '打开主题仓库')),
      loading && h('p', { role: 'status', className: 'iexp-setting-feedback' }, '正在读取已保存来源的主题目录…'),
      catalog && (catalog.themes.length === 0 ? h('p', { role: 'status', className: 'iexp-setting-feedback' }, '这个来源还没有主题。可更换来源或导入本地主题包。') : h('ul', { 'aria-label': '来源主题', className: 'iexp-theme-catalog' }, ...catalog.themes.map(entry => h('li', { key: entry.id },
        h('span', null, entry.name, h('span', { className: 'iexp-setting-help' }, ` · ${entry.version}`)),
        h('button', { type: 'button', className: 'iexp-control', onClick: () => { void run(() => onDownload(catalog.source, entry.id), `「${entry.name}」已就绪，可在上方选择启用。`) } }, '下载导入')))))),
    h('div', { className: 'iexp-settings-group' },
      h('span', null, '本地主题包'),
      h('div', { className: 'iexp-control-row' },
        h('label', { className: 'iexp-control iexp-file-control' }, '导入主题包', h('input', { type: 'file', accept: '.json,.dsh-theme.json,application/json', 'aria-label': '导入主题包', onChange: (event: { currentTarget: HTMLInputElement }) => { void importFile(event.currentTarget) } })),
        h('a', { className: 'iexp-setting-link', download: `${selected.id}.dsh-theme.json`, href: downloadHref(selected) }, '下载主题包'),
        h('a', { className: 'iexp-setting-link', download: `${exampleTheme.id}.dsh-theme.json`, href: downloadHref(exampleTheme) }, '下载示例主题'),
        !builtin && h('button', { type: 'button', className: 'iexp-control', title: '移除正在使用的主题后恢复 Empryo', onClick: () => { void run(() => onRemove(selected.id), '主题已移除，已恢复 Empryo。') } }, '移除此主题')),
      h('p', { className: 'iexp-setting-help' }, '导入 .dsh-theme.json 文件后，在上方选择即可启用。主题只改变已适配内容与页面的外观，保留原文、数据和操作。')),
    reading && h('p', { role: 'status', className: 'iexp-setting-feedback' }, '正在读取主题包…'),
    notice && h('p', { role: 'status', className: 'iexp-setting-feedback' }, notice),
    failure && h('p', { role: 'alert', className: 'iexp-setting-feedback' }, failure))
}
