import React, { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { ExperienceStore, Workspace, Settings, HeaderControls } from '../../src/client.js'
import { experienceTheme } from '../../src/presentation.js'
import { installExperienceStyles } from '../../src/style.js'
import { installAppearanceStyles } from '../../src/appearance-style.js'
import type { ExperienceArtifact, ExperienceSettings, WidgetState } from '../../src/contracts.js'
import { builtInThemes, resolveTheme, themePackageSchema } from '../../src/theme-contracts.js'
import linen from '../../src/themes/linen-example.dsh-theme.json' with { type: 'json' }
import carbon from '../../theme/unslop-carbon.dsh-theme.json' with { type: 'json' }
import cobalt from '../../theme/unslop-cobalt.dsh-theme.json' with { type: 'json' }
import amber from '../../theme/unslop-amber.dsh-theme.json' with { type: 'json' }
import porcelain from '../../theme/unslop-porcelain.dsh-theme.json' with { type: 'json' }
import { appearanceTokens } from '../../src/appearance.js'
import { OPENUI_VISUAL_SAMPLE } from '../fixtures/intelligent-experience-canary/visual-sample.mjs'
declare const REPORT_KIND: 'research' | 'test' | 'synthetic'
declare const REAL_REPORT_MARKDOWN: string | null
declare const ACTUAL_LAYOUT_OUTPUTS: Record<string, unknown> | null
const realMarkdown = typeof REAL_REPORT_MARKDOWN === 'string' ? REAL_REPORT_MARKDOWN : null
let settings: ExperienceSettings = { formatVersion: 1, revision: 0, takeover: true, openui: true, mcpApps: false }
const downloadableThemes = [linen, carbon, cobalt, amber, porcelain].map(theme => themePackageSchema.parse(theme))
const previewThemes = [...builtInThemes, ...downloadableThemes]
const themeId = new URLSearchParams(location.search).get('theme')
if (themeId && previewThemes.some(theme => theme.id === themeId)) {
  const theme = themePackageSchema.parse(previewThemes.find(theme => theme.id === themeId))
  settings = { ...settings, theme: { activeId: theme.id, installed: downloadableThemes }, appearance: theme.appearance }
}
const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '2026-10-30T00:00:00Z', source: { sessionId: 'fixture', kind: 'generated', label: '合成样例：本地服务趋势' }, protocol: 'openui', raw: OPENUI_VISUAL_SAMPLE, payload: OPENUI_VISUAL_SAMPLE, providerId: 'fixture' }
if (realMarkdown) Object.assign(artifact, { source: { ...artifact.source, label: REPORT_KIND === 'research' ? '美国 AI 泡沫研究报告（原文直接渲染）' : '真实测试输出（本地读取，无模型调用）' }, protocol: 'content', raw: realMarkdown, payload: realMarkdown })
const selected = new URLSearchParams(location.search).get('view') ?? 'report'
const actual = ACTUAL_LAYOUT_OUTPUTS?.[selected]
const outputLabels: Record<string, string> = { graph: '实际 TypeScript 静态导入关系', tasks: '实际 Vitest 测试结果（按原始状态分组）', records: '已采集页面的实际分析记录', commands: '实际 package.json 命令目录（只读）' }
if (actual !== undefined) { const raw = typeof actual === 'string' ? actual : JSON.stringify(actual, null, 2); Object.assign(artifact, { source: { ...artifact.source, label: outputLabels[selected] }, protocol: 'content', raw, payload: raw }) }
const store = new ExperienceStore()
let widgetState: WidgetState = { formatVersion: 1, revision: 1, state: { contact: { name: { value: 'Local canary state', componentType: 'Input' } } } }
store.update({ settings, api: { settings: async () => settings, saveSettings: async input => {
  if (input.expectedRevision !== settings.revision) throw new Error('设置已变化，请重试。')
  const { themeId, expectedRevision: _, ...values } = input
  const preference = settings.theme ?? { activeId: 'empryo', installed: [] }
  const nextTheme = themeId ? { ...preference, activeId: themeId } : preference
  resolveTheme(nextTheme)
  return settings = { ...settings, ...values, theme: nextTheme, revision: settings.revision + 1 }
}, installTheme: async input => {
  if (input.expectedRevision !== settings.revision) throw new Error('设置已变化，请重试。')
  const theme = themePackageSchema.parse(input.theme), preference = settings.theme ?? { activeId: 'empryo', installed: [] }
  if ([...builtInThemes, ...preference.installed].some(existing => existing.id === theme.id)) throw new Error('主题已安装，请先移除旧主题。')
  return settings = { ...settings, theme: { ...preference, installed: [...preference.installed, theme] }, revision: settings.revision + 1 }
}, removeTheme: async input => {
  if (input.expectedRevision !== settings.revision) throw new Error('设置已变化，请重试。')
  const preference = settings.theme ?? { activeId: 'empryo', installed: [] }, active = preference.activeId === input.id
  return settings = { ...settings, theme: { activeId: active ? 'empryo' : preference.activeId, installed: preference.installed.filter(theme => theme.id !== input.id) }, ...(active ? { appearance: builtInThemes[0]!.appearance } : {}), revision: settings.revision + 1 }
}, artifacts: async () => [artifact], publish: async () => artifact, widgetState: async () => widgetState, saveWidgetState: async input => widgetState = { formatVersion: 1, revision: widgetState.revision + 1, state: input.state } } })
installExperienceStyles()
installAppearanceStyles(store)
function syntheticTheme(mode: 'light' | 'dark') { experienceTheme.set(mode); document.body.style.background = mode === 'dark' ? 'linear-gradient(135deg,#191b20,#34414e 48%,#23282b)' : 'linear-gradient(135deg,#ffffff,#dde8ee 48%,#f4e4d6)'; document.body.style.color = mode === 'dark' ? '#eceef2' : '#202124'; document.body.style.setProperty('--dsw-alias-label-primary', mode === 'dark' ? '#eceef2' : '#202124'); document.body.style.colorScheme = mode }
syntheticTheme(appearanceTokens(settings.appearance, resolveTheme(settings.theme)).colorScheme)
const Fixture = () => h('main', null, h('header', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12 } }, h('p', null, actual !== undefined ? `${outputLabels[selected]} · 本地只读输出 · 无模型调用` : realMarkdown ? (REPORT_KIND === 'research' ? '真实研究报告 · 保留原文与口径 · 无额外模型调用' : '真实命令输出 · 自动展示验证 · 无额外模型调用') : '合成浏览器夹具 · 固定示例数据 · 不连接真实会话或模型'), h('div', null, h('button', { onClick: () => syntheticTheme('light') }, '浅色'), h('button', { onClick: () => syntheticTheme('dark') }, '深色'), h(HeaderControls, { store, sessionId: 'fixture' }))), ACTUAL_LAYOUT_OUTPUTS && h('nav', { 'aria-label': '本地真实输出验证', style: { display: 'flex', flexWrap: 'wrap', gap: 16, padding: '0 12px 12px' } }, ...Object.entries({ report: '原研究报告', graph: '源码依赖', tasks: '测试结果', records: '分析记录', commands: '命令目录' }).map(([value, title]) => h('a', { key: value, href: `?view=${value}`, 'aria-current': selected === value ? 'page' : undefined, style: { color: 'inherit', fontSize: 13 } }, title))), h('details', { style: { margin: 12 } }, h('summary', null, '插件外观设置'), h(Settings, { store })), h(Workspace, { store, sessionId: 'fixture' }))
createRoot(document.getElementById('root')!).render(h(Fixture))
