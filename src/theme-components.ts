import { createElement as h, forwardRef, useId, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { themePreferences } from './theme-runtime.js'
import type { ComponentSet, ThemePackage } from './theme-contracts.js'
import sources from './uiverse-sources.json' with { type: 'json' }

export function themeComponentSet(theme: ThemePackage): ComponentSet | 'native' { return theme.formatVersion === 2 ? theme.componentSet : 'native' }
export function useComponentSet(): ComponentSet | 'native' { return themeComponentSet(useSyncExternalStore(themePreferences.subscribe, themePreferences.getSnapshot, themePreferences.getSnapshot)) }
type Choice = { componentSet?: ComponentSet | 'native' }
function classes(base: string, existing?: string) { return [existing, base].filter(Boolean).join(' ') }

/** Compiled adapters only. Theme JSON cannot supply markup or CSS. Native props/events stay owned by the caller. */
export const ThemeButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Choice>(function ThemeButton({ componentSet, className, children, ...props }, ref) {
  const selected = useComponentSet(), set = componentSet ?? selected
  if (set === 'native') return h('button', { ...props, className, ref }, children)
  return h('button', { ...props, ref, className: classes('iexp-uiv-button', className), 'data-iexp-component-set': set },
    set === 'clear-glass' && h('span', { className: 'iexp-uiv-backplate', 'aria-hidden': true }), h('span', { className: 'iexp-uiv-button-label' }, children))
})
export const ThemeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Choice>(function ThemeInput({ componentSet, className, ...props }, ref) {
  const selected = useComponentSet(), set = componentSet ?? selected
  return h('input', { ...props, ref, className: set === 'native' ? className : classes('iexp-uiv-input', className), ...(set === 'native' ? {} : { 'data-iexp-component-set': set }) })
})
/** Kept inside the caller's label. Transparent full-area input remains focusable, clickable and a native checkbox. */
export function ThemeToggle({ componentSet, className, ...props }: InputHTMLAttributes<HTMLInputElement> & Choice) {
  const selected = useComponentSet(), set = componentSet ?? selected
  if (set === 'native') return h('input', { ...props, type: 'checkbox', className })
  return h('span', { className: 'iexp-uiv-toggle', 'data-iexp-component-set': set },
    h('input', { ...props, className, type: 'checkbox' }),
    h('span', { className: 'iexp-uiv-track', 'aria-hidden': true }, h('span', { className: 'iexp-uiv-thumb' })))
}
export function ThemeCard({ componentSet, as = 'div', className, children, ...props }: HTMLAttributes<HTMLElement> & Choice & { as?: 'div' | 'article' | 'figure' } & { [key: `data-${string}`]: string | number | boolean | undefined }) {
  const selected = useComponentSet(), set = componentSet ?? selected
  return h(as, { ...props, className: set === 'native' ? className : classes('iexp-uiv-card', className), ...(set === 'native' ? {} : { 'data-iexp-component-set': set }) }, children)
}
export function ThemeLoader({ componentSet, label = '正在加载…' }: Choice & { label?: string }) {
  const selected = useComponentSet(), set = componentSet ?? selected
  return h('span', { className: 'iexp-uiv-loading', role: 'status' },
    h('span', { className: 'iexp-uiv-loader', 'data-iexp-component-set': set, 'aria-hidden': true },
      ...[0, 1, 2].map(index => h('span', { key: index }))), h('span', null, label))
}

const roleNames: Record<string, string> = { button: '按钮', input: '输入框', toggle: '开关', card: '卡片', loader: '加载器' }
/** The source is displayed in a network-denied, scriptless opaque-origin iframe, never injected into the host document. */
export function originalComponentDocument(html: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{margin:0;min-height:260px;padding:36px;box-sizing:border-box;display:grid;place-items:center;background:#dce3e9;color:#17232c;font:16px system-ui}*{box-sizing:border-box}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style></head><body>${html}</body></html>`
}
function SourceComparison({ set }: { set: ComponentSet }) {
  const [role, setRole] = useState('button')
  const record = sources.sets[set].find(item => item.role === role)!
  return h('div', { className: 'iexp-uiv-source' },
    h('label', null, '原始组件 ', h('select', { value: role, onChange: (event: { currentTarget: HTMLSelectElement }) => setRole(event.currentTarget.value), 'aria-label': '原始组件类别', className: 'iexp-control' }, ...Object.entries(roleNames).map(([value, name]) => h('option', { key: value, value }, name)))),
    h('p', null, `${record.author} · MIT · `, h('a', { href: record.url, target: '_blank', rel: 'noreferrer' }, 'Uiverse 原页面'), ' · ', h('a', { href: record.sourceUrl, target: '_blank', rel: 'noreferrer' }, '固定版本源码')),
    h('iframe', { title: `${roleNames[role]}原始组件预览`, sandbox: '', referrerPolicy: 'no-referrer', srcDoc: originalComponentDocument(record.html) }),
    h('details', null, h('summary', null, '查看完整原始 HTML / CSS'), h('pre', null, record.html)),
    h('p', { className: 'iexp-setting-help' }, `源版本 ${sources.commit.slice(0, 12)} · SHA-256 ${record.sha256}`))
}
export function ThemeComponentPreview({ theme }: { theme: ThemePackage }) {
  const set = themeComponentSet(theme), prefix = useId(), [value, setValue] = useState('示例：保留输入'), [checked, setChecked] = useState(true), [loading, setLoading] = useState(false), [showSource, setShowSource] = useState(false)
  if (set === 'native') return null
  const invalid = !value.trim()
  const common = { componentSet: set }
  return h('section', { className: 'iexp-uiv-preview', 'aria-label': '真实组件预览' },
    h('h3', null, '组件与状态预览'),
    h('p', { className: 'iexp-setting-help' }, '以下是可操作的适配组件。仅用于预览，不更改会话、报告或插件设置。'),
    h('div', { className: 'iexp-control-row' }, h(ThemeButton, { ...common, type: 'button', onClick: () => setLoading(!loading) }, loading ? '结束预览加载' : '开始预览加载'), h(ThemeButton, { ...common, type: 'button', disabled: true }, '不可用按钮')),
    h('label', { htmlFor: `${prefix}-input` }, '预览输入（清空以查看校验）'),
    h(ThemeInput, { ...common, id: `${prefix}-input`, value, 'aria-invalid': invalid, 'aria-describedby': invalid ? `${prefix}-error` : undefined, onChange: (event: { currentTarget: HTMLInputElement }) => setValue(event.currentTarget.value) }),
    invalid && h('p', { id: `${prefix}-error`, role: 'alert' }, '预览内容不能为空，请输入文字。'),
    h('label', { className: 'iexp-toggle-row' }, h(ThemeToggle, { ...common, checked, onChange: (event: { currentTarget: HTMLInputElement }) => setChecked(event.currentTarget.checked) }), ' 预览开关'),
    h(ThemeCard, { ...common, className: 'iexp-uiv-sample-card' }, h('strong', null, '卡片保留你的内容'), h('p', null, value || '等待输入预览内容'), loading ? h(ThemeLoader, { ...common, label: '预览加载中…' }) : h('p', null, checked ? '预览开关已开启' : '预览开关已关闭')),
    h('p', { className: 'iexp-setting-help' }, '其他插件页面仅接收颜色、字体与表面兼容样式，保留原来的组件和操作。'),
    h('details', { onToggle: (event: { currentTarget: HTMLDetailsElement }) => setShowSource(event.currentTarget.open) }, h('summary', null, '对照原始 Uiverse 组件与完整源码'), showSource && h(SourceComparison, { set })))
}
