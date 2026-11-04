import { createElement as h, useState, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { SlotCore, resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { installSettingsNavigation } from '../../src/settings-navigation.js'

const names: Record<string, string> = {
  account: '账号与余额',
  general: '通用设置',
  models: '模型',
  'dream-skin': 'Theme / 外观',
  plugins: '内置插件',
  'model-subscriptions': '模型订阅',
  'dsh-imagegen': '生图配置',
  'agent-presets': 'Agent 预设',
  'agent-persona': 'Agent 人设',
  'cost-meter': '费用',
  market: '插件市场',
  'solar-rlm': 'RLM 算子',
  'solar-native-collaboration': '智能协同',
  'deepseek-web-login': 'DeepSeek 网页登录',
  'solar-chatgpt-web': '网页与洞察',
  'solar-model-radar': '模型雷达',
  'solar-intelligent-experience': '智能体验',
  'solar-quant-research': '量化研究',
  bili: 'bili设置',
  'session-prefix': '会话前缀',
}

const groupIds: Record<string, string[]> = {
  'models-and-accounts': [
    'account', 'models', 'model-subscriptions', 'dsh-imagegen', 'agent-presets',
    'agent-persona', 'cost-meter', 'deepseek-web-login', 'solar-model-radar',
  ],
  'appearance-and-display': ['general', 'dream-skin', 'solar-intelligent-experience', 'session-prefix'],
  'solar-and-workflows': ['solar-rlm', 'solar-native-collaboration', 'solar-chatgpt-web', 'solar-quant-research', 'bili'],
  plugins: ['plugins', 'market'],
}

// The native shell has mixed legacy decoration: some rows carry an SVG and
// one carries a non-SVG wrapper. The adapter must hide these children and
// supply one normalized pseudo-element without replacing the native nodes.
const nativeDecorativeIconIds = new Set(['account', 'models', 'dream-skin', 'plugins', 'solar-native-collaboration', 'bili'])
const nativeDecorativeIcon = (id: string) => {
  if (!nativeDecorativeIconIds.has(id)) return null
  if (id === 'models') {
    return h('span', { className: 'fixture-native-icon-wrapper', 'data-native-decorative': id, 'aria-hidden': true })
  }
  return h('svg', { className: 'fixture-native-icon', 'data-native-decorative': id, 'aria-hidden': true, viewBox: '0 0 16 16', width: 16, height: 16 },
    h('path', { d: 'M2 2h12v12H2z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))
}

let language = 'zh'
let revision = 0
const localeListeners = new Set<() => void>()
const locale = {
  subscribe(listener: () => void) {
    localeListeners.add(listener)
    return () => localeListeners.delete(listener)
  },
  getSnapshot: () => revision,
}

const core = new SlotCore()
const register = core.register.bind(core) as (options: unknown, component: unknown) => () => void
register({
  name: 'root',
  children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.action': { kind: 'list', scope: 'root' },
  },
}, () => null)
Object.entries(names).forEach(([id, label], order) => register({
  name: 'settings.section',
  id,
  order,
  label: () => language === 'zh' ? label : 'Page ' + (order + 1),
}, () => null))

const cleanups: Array<() => void> = []
const ctx = {
  slots: {
    entries: core.entries.bind(core),
    subscribe: core.subscribe.bind(core),
    register,
    inject: (_name: string, callback: () => () => void) => callback(),
  },
  locale,
  effect: (callback: () => () => void) => {
    const cleanup = callback()
    cleanups.push(cleanup)
    return cleanup
  },
}

let preferenceState: { settings: { settingsNavigation: boolean } } = { settings: { settingsNavigation: false } }
let preferenceSaves = 0
const preferenceListeners = new Set<() => void>()
const preference = {
  snapshot: () => preferenceState,
  subscribe(listener: () => void) {
    preferenceListeners.add(listener)
    return () => preferenceListeners.delete(listener)
  },
  async setEnabled(enabled: boolean) {
    preferenceSaves++
    preferenceState = { settings: { settingsNavigation: enabled } }
    preferenceListeners.forEach(listener => listener())
  },
}

installSettingsNavigation(ctx as never, preference)
const Action = core.entries('settings.action')[0]?.component as ComponentType | undefined
if (!Action) throw new Error('Settings action was not registered through the public slot.')

let selected = 'account'

function FixtureHost() {
  useSyncExternalStore(listener => core.subscribe('settings.section', listener), () => core.getVersion('settings.section'))
  useSyncExternalStore(locale.subscribe, locale.getSnapshot)
  const [requested, setActive] = useState(selected)
  const rows = core.entries('settings.section')
  const active = rows.some(row => row.options.id === requested) ? requested : rows[0]?.options.id
  const current = rows.find(row => row.options.id === active)
  const currentLabel = current ? resolveSlotLabel(current.options.label) : '未命名设置项'
  return h('div', {
    role: 'dialog',
    'aria-modal': true,
    'aria-label': '设置',
    'data-shortcut-modal': 'settings',
    className: 'fixture-dialog',
  },
  h('nav', { className: 'fixture-native-nav', 'aria-label': '原设置菜单' },
    h('div', { className: 'fixture-nav-title' }, '设置'),
    h('div', { className: 'fixture-nav-list' }, ...rows.map(row => {
      const id = row.options.id!
      return h('button', {
        key: id,
        type: 'button',
        'data-native-id': id,
        'aria-current': active === id ? 'true' : undefined,
        onClick: () => {
          selected = id
          setActive(id)
        },
      }, nativeDecorativeIcon(id), h('span', { className: 'fixture-native-label' }, resolveSlotLabel(row.options.label)))
    })),
  ),
  h('div', { className: 'fixture-content' },
    h('div', { className: 'fixture-header' },
      h('div', { className: 'fixture-actions' },
        h('button', { type: 'button', 'data-host-action': 'open-config' }, '打开配置'),
        h('div', { className: 'fixture-slot-anchor', 'data-slot-anchor': 'settings.action' }, h(Action)),
      ),
      h('button', { type: 'button', 'data-host-action': 'close', 'aria-label': '关闭' }, h('svg', { viewBox:'0 0 20 20',width:16,height:16,'aria-hidden':true }, h('path',{d:'M5 5l10 10M15 5L5 15',fill:'none',stroke:'currentColor',strokeWidth:1.5}))),
    ),
    h('div', { className: 'fixture-options' },
      h('h1', { 'data-current-page': active }, currentLabel),
      h('label', { htmlFor: 'fixture-current-input' }, '当前设置值'),
      h('input', { id: 'fixture-current-input', type: 'text', defaultValue: currentLabel, readOnly: true }),
    ),
  ))
}

const style = document.createElement('style')
style.textContent = [
  ':root { --dsw-alias-bg-layer-2: #2d2f34; --dsw-alias-bg-layer-3: #34373e; --dsw-alias-label-primary: #eceef2; --dsw-alias-label-secondary: #b9bdc4; --dsw-alias-border-l2: #50545b; color-scheme: dark; }',
  'body { margin: 0; min-width: 0; background: #24262b; color: var(--dsw-alias-label-primary); font: 14px system-ui, sans-serif; }',
  '#root { min-height: 100vh; padding: 16px; }',
  '.fixture-dialog { position: relative; display: flex; width: min(800px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); margin: 0 auto; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }',
  '.fixture-native-nav { flex: 0 0 188px; width: 188px; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-2); }',
  '.fixture-nav-title { flex: 0 0 40px; padding: 12px 12px 8px; font-weight: 600; }',
  '.fixture-nav-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 4px 8px 12px; }',
  '.fixture-nav-list button { box-sizing: content-box; display: block; width: 100%; height: 40px; min-height: 40px; margin: 2px 0; padding: 6px 8px; overflow-wrap: anywhere; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
  '.fixture-native-icon-wrapper { display: inline-block; width: 16px; height: 16px; background: currentColor; }',
  '.fixture-nav-list button[aria-current=\"true\"] { background: var(--dsw-alias-bg-layer-3); }',
  '.fixture-content { min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; }',
  '.fixture-header { flex: 0 0 54px; height: 54px; padding: 20px 14px 8px 10px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }',
  '.fixture-actions { min-width: 0; display: flex; align-items: flex-start; gap: 8px; }',
  '.fixture-options { min-width: 0; min-height: 0; flex: 1 1 auto; overflow: auto; padding: 16px; }',
  '.fixture-options h1 { margin: 0 0 16px; font-size: 18px; overflow-wrap: anywhere; }',
  '.fixture-options input { display: block; width: min(360px, 100%); padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; background: var(--dsw-alias-bg-layer-3); color: inherit; font: inherit; }',
  '.fixture-dialog button:focus-visible, .fixture-dialog input:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }',
].join('\n')
document.head.append(style)
flushSync(() => createRoot(document.getElementById('root')!).render(h(FixtureHost)))
const delay = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
const ensure = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}
const waitUntil = async (condition: () => unknown, message: string, timeout = 6000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (condition()) return
    await delay()
  }
  throw new Error(message)
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-shortcut-modal="settings"]')!
const scope = () => document.querySelector<HTMLElement>('[data-solar-settings-navigation]')!
const categoryNav = () => dialog().querySelector<HTMLElement>('nav[aria-label="设置分类"]')
const toggle = () => [...scope().querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => !button.matches('[data-navigation-category]'))!
const visible = (element: HTMLElement) => {
  let current: HTMLElement | null = element
  while (current && current !== document.body) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false
    const computed = getComputedStyle(current)
    if (computed.display === 'none' || computed.visibility === 'hidden') return false
    current = current.parentElement
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
const rendered = (element: Element) => {
  let current: Element | null = element
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && current.hidden) return false
    const computed = getComputedStyle(current)
    if (computed.display === 'none' || computed.visibility === 'hidden' || computed.getPropertyValue('content-visibility') === 'hidden') return false
    current = current.parentElement
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
const nativeButtons = () => [...dialog().querySelectorAll<HTMLButtonElement>('nav[aria-label="原设置菜单"] .fixture-nav-list button')]
const categoryButton = (id: string) => categoryNav()?.querySelector<HTMLButtonElement>('button[data-navigation-category="' + id + '"]')
const visibleNativeButtons = () => nativeButtons().filter(visible)
const nativeButton = (id: string) => nativeButtons().find(button => button.dataset.nativeId === id)
const statusText = () => scope().querySelector<HTMLElement>('[role="status"]')?.textContent?.trim() ?? ''
const nativeLabel = (button: HTMLButtonElement) => button.lastElementChild?.tagName === 'SPAN' ? button.lastElementChild as HTMLElement : undefined
const hasNormalizedPseudoIcon = (button: HTMLButtonElement) => {
  const before = getComputedStyle(button, '::before')
  const after = getComputedStyle(button, '::after')
  const mask = before.getPropertyValue('mask-image') || before.getPropertyValue('-webkit-mask-image')
  return before.content !== 'none' && before.display !== 'none' && Number.parseFloat(before.width) === 16 && Number.parseFloat(before.height) === 16 && mask !== '' && mask !== 'none' && after.content === 'none'
}

const openGroupedMode = async () => {
  await waitUntil(() => Boolean(scope() && toggle()), 'Grouped-settings action did not mount in the slot anchor.')
  if (toggle().getAttribute('aria-pressed') !== 'true') {
    toggle().click()
    await waitUntil(() => preferenceState.settings.settingsNavigation && toggle().getAttribute('aria-pressed') === 'true', 'Grouped-settings mode did not enable.')
  }
  await waitUntil(() => Boolean(categoryNav()), 'Settings category navigation portal did not mount.')
}

const selectCategory = async (id: string) => {
  const button = categoryButton(id)
  ensure(button, 'Missing category button ' + id)
  if (button.getAttribute('aria-pressed') !== 'true') button.click()
  await waitUntil(() => categoryButton(id)?.getAttribute('aria-pressed') === 'true', 'Category ' + id + ' did not become active.')
}

const run = async () => {
  const native = nativeButtons()
  const nativeParent = native[0]?.parentElement
  const originalChildrenById = new Map<string, Element[]>()
  const originalDecorativeById = new Map<string, Element[]>()
  const originalLabelsById = new Map<string, HTMLElement>()
  ensure(native.length === 20, 'Native fixture did not retain 20 settings; found ' + native.length + '.')
  ensure(native.every(button => button.isConnected), 'Native settings buttons are not connected.')
  ensure(native.find(button => button.dataset.nativeId === 'account')?.getAttribute('aria-current') === 'true', 'Native current marker is not aria-current="true".')
  for (const button of native) {
    const id = button.dataset.nativeId
    const label = nativeLabel(button)
    ensure(id && label?.classList.contains('fixture-native-label'), 'Native row ' + (id ?? '(unknown)') + ' must end with a span label.')
    const children = [...button.children]
    const decorative = children.slice(0, -1)
    originalChildrenById.set(id, children)
    originalDecorativeById.set(id, decorative)
    originalLabelsById.set(id, label)
  }
  const originalDecorativeCount = [...originalDecorativeById.values()].reduce((total, children) => total + children.length, 0)
  ensure(originalDecorativeCount > 0, 'Native fixture must include legacy decorative children.')
  ensure(native.some(button => [...(originalDecorativeById.get(button.dataset.nativeId!) ?? [])].some(child => child.tagName === 'SPAN' && child.getAttribute('aria-hidden') === 'true')), 'Native fixture must include a non-SVG aria-hidden icon wrapper.')

  await openGroupedMode()
  const nav = categoryNav()!
  const initialCategoryButtons = [...nav.querySelectorAll<HTMLButtonElement>('button[data-navigation-category]')]
  ensure(initialCategoryButtons.length === 4, 'Expected four settings categories, found ' + initialCategoryButtons.length + '.')
  ensure(initialCategoryButtons.every(button => button.hasAttribute('aria-pressed')), 'Category buttons must expose aria-pressed state.')
  ensure(!scope().querySelector('select'), 'Grouped navigation must not render a select dropdown.')
  ensure(!scope().querySelector('[role="tablist"],[role="tab"],[role="tabpanel"]'), 'Grouped navigation must not use tablist/tab/tabpanel roles.')
  ensure(document.querySelectorAll('[role="dialog"]').length === 1, 'Grouped navigation rendered an old nested large popup.')

  await waitUntil(() => Boolean(visibleNativeButtons()[0]), 'Native sidebar did not expose a visible row after grouped mode mounted.')
  const normalizedIconFailures = nativeButtons().filter(button => !hasNormalizedPseudoIcon(button)).map(button => button.dataset.nativeId ?? '(unknown)')
  ensure(normalizedIconFailures.length === 0, 'Native rows missing one normalized 16px masked ::before icon: ' + normalizedIconFailures.join(', '))
  const denseStyleFailures = nativeButtons().filter(button => {
    const style = getComputedStyle(button)
    return !['none', 'flex'].includes(style.display) || Number.parseFloat(style.height) > 33 || Number.parseFloat(style.minHeight) > 33
  }).map(button => button.dataset.nativeId ?? '(unknown)')
  ensure(denseStyleFailures.length === 0, 'Native rows exceed the 32px density target: ' + denseStyleFailures.join(', '))
  const hiddenDecorationFailures = nativeButtons().filter(button => {
    const label = nativeLabel(button)
    const decorative = originalDecorativeById.get(button.dataset.nativeId!) ?? []
    return !label || getComputedStyle(label).display === 'none' || (visible(button) && !rendered(label)) || decorative.some(child => getComputedStyle(child).display !== 'none')
  }).map(button => button.dataset.nativeId ?? '(unknown)')
  ensure(hiddenDecorationFailures.length === 0, 'Native rows did not hide legacy decoration while keeping labels visible: ' + hiddenDecorationFailures.join(', '))
  const firstSidebarRow = visibleNativeButtons()[0]!
  const categoryRect = nav.getBoundingClientRect()
  const firstRowRect = firstSidebarRow.getBoundingClientRect()
  const categorySidebarGap = firstRowRect.top - categoryRect.bottom
  ensure(categorySidebarGap > 0, 'Category bottom border intersects the first native sidebar row (gap=' + categorySidebarGap + ').')
  const nativeRowMaxHeight = Math.max(...visibleNativeButtons().map(button => button.getBoundingClientRect().height))
  const normalizedNativeIcons = nativeButtons().every(hasNormalizedPseudoIcon)
  const nativeIconCount = nativeButtons().filter(hasNormalizedPseudoIcon).length
  const originalDecorativeChildrenHidden = native.every(button => (originalDecorativeById.get(button.dataset.nativeId!) ?? []).every(child => getComputedStyle(child).display === 'none'))
  const nativeLabelsVisible = native.every(button => {
    const label = nativeLabel(button)
    return Boolean(label && getComputedStyle(label).display !== 'none' && (!visible(button) || rendered(label)))
  })
  const nativeLabelsFit = native.every(button => {
    const label = nativeLabel(button)
    return Boolean(label && label.scrollWidth <= label.clientWidth)
  })
  const denseNativeRows = nativeButtons().every(button => {
    const style = getComputedStyle(button)
    return ['none', 'flex'].includes(style.display) && Number.parseFloat(style.height) <= 33 && Number.parseFloat(style.minHeight) <= 33
  }) && nativeRowMaxHeight <= 33
  ensure(normalizedNativeIcons, 'Each native row must expose exactly one normalized 16px masked ::before icon.')
  ensure(originalDecorativeChildrenHidden, 'Legacy native decorative children were not hidden.')
  ensure(nativeLabelsVisible, 'Native row labels were hidden or replaced.')
  ensure(nativeLabelsFit, 'A native row label is clipped inside its sidebar cell.')
  ensure(denseNativeRows, 'Native menu rows exceed the 32px density target.')
  ensure(categorySidebarGap > 0, 'Category bottom border intersects the first native sidebar row.')

  const modelVisualOrder = visibleNativeButtons().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(button => button.dataset.nativeId!)
  const modelClusterOrder = ['models', 'model-subscriptions', 'cost-meter', 'deepseek-web-login']
  const clusterStart = modelVisualOrder.indexOf('models')
  ensure(JSON.stringify(modelVisualOrder.slice(clusterStart, clusterStart + 4)) === JSON.stringify(modelClusterOrder), 'Model, subscription, cost and web-login entries must be consecutive in the requested order.')
  ensure(getComputedStyle(firstSidebarRow.parentElement!).getPropertyValue('reading-flow') === 'flex-visual', 'Visual sorting must preserve the same accessibility and keyboard reading flow.')

  const expectedCounts: Record<string, number> = { '模型与账号': 9, '界面与显示': 4, 'Solar 与工作流': 5, 插件管理: 2 }
  const categoryCounts: Record<string, number> = {}
  for (const [group, ids] of Object.entries(groupIds)) {
    await selectCategory(group)
    await waitUntil(() => visibleNativeButtons().length === expectedCounts[categoryButton(group)!.textContent!.trim()], 'Native rows did not update for category ' + group + '.')
    const rows = visibleNativeButtons()
    const label = categoryButton(group)!.textContent!.trim()
    categoryCounts[label] = rows.length
    ensure(rows.length === expectedCounts[label], 'Category ' + label + ' rendered ' + rows.length + ' rows; expected ' + expectedCounts[label] + '.')
    ensure(ids.every(id => visibleNativeButtons().some(button => button.dataset.nativeId === id)), 'Category ' + label + ' did not expose every expected native row.')
  }

  const routeById: Record<string, string> = {}
  Object.entries(groupIds).forEach(([group, ids]) => ids.forEach(id => { routeById[id] = group }))
  const clicked: string[] = []
  for (const [group, ids] of Object.entries(groupIds)) {
    await selectCategory(group)
    await waitUntil(() => visibleNativeButtons().length === ids.length, 'Category ' + group + ' did not filter the native nav.')
    for (const id of ids) {
      const button = nativeButton(id)
      ensure(button && visible(button), 'Missing visible native row ' + id)
      button.click()
      await waitUntil(() => selected === id && nativeButton(id)?.getAttribute('aria-current') === 'true', 'Original handler did not select ' + id + '.')
      ensure(toggle().getAttribute('aria-pressed') === 'true', 'Selecting a page unexpectedly disabled grouped mode.')
      ensure(categoryNav()?.querySelectorAll('button[data-navigation-category]').length === 4, 'Category navigation disappeared after a page selection.')
      clicked.push(id)
    }
  }
  ensure(clicked.length === 20 && new Set(clicked).size === 20, 'Not every native settings page was reachable exactly once.')
  ensure(preferenceSaves === 1, 'Page selection changed the preference ' + preferenceSaves + ' times.')

  const disposeFuture = register({ name: 'settings.section', id: 'constructor', order: 999, label: '未来功能' }, () => null)
  await waitUntil(() => Boolean(categoryButton('other')), 'Unknown settings item did not create the Other category.')
  const futureTabs = categoryNav()!.getBoundingClientRect()
  const futureOptions = dialog().querySelector<HTMLElement>('.fixture-options')!.getBoundingClientRect()
  ensure(futureTabs.bottom <= futureOptions.top + 1, 'Five categories overlap the original options area.')
  await selectCategory('other')
  await waitUntil(() => visibleNativeButtons().length === 1, 'Other category did not filter to the unknown native row.')
  const unknown = nativeButton('constructor')
  ensure(unknown && visible(unknown), 'Unknown settings item was hidden instead of appearing in Other.')
  unknown.click()
  await waitUntil(() => selected === 'constructor', 'Unknown settings item did not invoke the native handler.')
  disposeFuture()
  await waitUntil(() => nativeButtons().length === 20, 'Removing the unknown item changed the native button count.')

  language = 'en'
  revision++
  localeListeners.forEach(listener => listener())
  await selectCategory('models-and-accounts')
  await waitUntil(() => nativeButton('models')?.textContent === 'Page 3', 'Locale labels did not refresh in grouped navigation.')
  language = 'zh'
  revision++
  localeListeners.forEach(listener => listener())
  await waitUntil(() => nativeButton('models')?.textContent === '模型', 'Locale labels did not restore after the update.')

  const target = nativeButton('models')!
  await selectCategory('models-and-accounts')
  target.click()
  await waitUntil(() => selected === 'models', 'Could not establish the remembered model destination.')
  await selectCategory('appearance-and-display')
  await waitUntil(() => visibleNativeButtons().every(button => groupIds['appearance-and-display']!.includes(button.dataset.nativeId!)), 'Could not leave the model category before missing-target check.')
  target.disabled = true
  categoryButton('models-and-accounts')!.click()
  await waitUntil(() => statusText().includes('未找到'), 'Missing native target did not show a visible error.')
  target.disabled = false

  const duplicate = target.cloneNode(true) as HTMLButtonElement
  nativeParent!.append(duplicate)
  categoryButton('models-and-accounts')!.click()
  await waitUntil(() => statusText().length > 0, 'Duplicate native target did not show a visible error.')
  ensure(['多个','结构','目录','重复'].some(word => statusText().includes(word)), 'Duplicate native target error did not identify the ambiguity or invalid structure.')
  duplicate.remove()
  await waitUntil(() => Boolean(categoryNav()), 'Settings category navigation did not recover after duplicate removal.')

  await selectCategory('models-and-accounts')
  const tabRect = categoryNav()!.getBoundingClientRect()
  const options = dialog().querySelector<HTMLElement>('.fixture-options')!
  const optionsRect = options.getBoundingClientRect()
  const overlaps = tabRect.left < optionsRect.right && tabRect.right > optionsRect.left && tabRect.top < optionsRect.bottom && tabRect.bottom > optionsRect.top
  ensure(!overlaps, 'Category row overlaps the original options area.')
  const input = options.querySelector<HTMLInputElement>('#fixture-current-input')!
  input.focus()
  preferenceState = { settings: { ...preferenceState.settings } }
  preferenceListeners.forEach(listener => listener())
  await delay(180)
  ensure(document.activeElement === input, 'Input focus was interrupted by the settings polling/update path.')

  const originalNodesPreserved = native.every(button => {
    const id = button.dataset.nativeId!
    const originalChildren = originalChildrenById.get(id) ?? []
    return button.isConnected && button.parentElement === nativeParent && nativeLabel(button) === originalLabelsById.get(id) && [...button.children].length === originalChildren.length && [...button.children].every((child, index) => child === originalChildren[index])
  })
  ensure(originalNodesPreserved, 'Original native navigation nodes were moved or replaced.')

  toggle().click()
  await waitUntil(() => !preferenceState.settings.settingsNavigation && toggle().getAttribute('aria-pressed') === 'false', 'Explicit cancellation did not persist.')
  await waitUntil(() => !categoryNav(), 'Category navigation remained mounted after cancellation.')
  ensure(native.every(button => button.isConnected && button.parentElement === nativeParent && !button.hidden && getComputedStyle(button).display !== 'none'), 'Cancellation did not restore all twenty native buttons.')
  ensure(!scope().querySelector('button[data-section-id]'), 'Grouped rows remained after cancellation.')
  const originalIconsVisibleAfterCancel = native.every(button => {
    const expected = originalDecorativeById.get(button.dataset.nativeId!) ?? []
    const current = [...button.children].slice(0, -1)
    return current.length === expected.length && current.every((child, index) => child === expected[index] && rendered(child))
  })
  ensure(originalIconsVisibleAfterCancel, 'Cancellation did not restore the original native decorative icons.')

  const result = {
    ready: true,
    ok: true,
    width: innerWidth,
    nativeRows: 20,
    groupedRows: clicked.length,
    clicked,
    categoryCounts,
    unknownOther: true,
    fiveCategoryNonOverlap: true,
    localeUpdated: true,
    missingRejected: true,
    ambiguousRejected: true,
    originalNodesPreserved,
    originalNodesVisibleAfterCancel: native.every(button => getComputedStyle(button).display !== 'none') && originalIconsVisibleAfterCancel,
    normalizedNativeIcons,
    modelClusterOrder,
    nativeIconCount,
    originalDecorativeCount,
    originalDecorativeChildrenHidden,
    nativeLabelsVisible,
    nativeLabelsFit,
    denseNativeRows,
    nativeRowMaxHeight,
    categorySidebarGap,
    originalIconsVisibleAfterCancel,
    persistentModeUntilCancel: preferenceSaves === 2,
    explicitCancel: true,
    noSelect: !document.querySelector('select'),
    noNestedDialog: document.querySelectorAll('[role="dialog"]').length === 1,
    noTabRoles: !scope().querySelector('[role="tablist"],[role="tab"],[role="tabpanel"]'),
    tabrowOptionsNonOverlap: !overlaps,
    inputFocusStable: document.activeElement === input,
    portalMounted: true,
  }
  const capture = new URLSearchParams(location.search).get('capture')
  if (capture === 'grouped' || capture === 'other') {
    await openGroupedMode()
    if (capture === 'other') {
      register({ name:'settings.section',id:'constructor',order:999,label:'未来功能' },()=>null)
      await waitUntil(()=>Boolean(categoryButton('other')),'Other capture did not mount.')
      await selectCategory('other')
    } else {
      await selectCategory('appearance-and-display')
      nativeButton('solar-intelligent-experience')!.click()
      await waitUntil(()=>selected==='solar-intelligent-experience','Intelligent UI capture did not select.')
    }
  }
  document.getElementById('metrics')!.textContent = JSON.stringify(result)
  document.documentElement.dataset.fixtureReady = 'true'
}

setTimeout(() => {
  void run().catch(error => {
    document.getElementById('metrics')!.textContent = JSON.stringify({
      ready: true,
      ok: false,
      width: innerWidth,
      error: error instanceof Error ? error.message : String(error),
    })
    document.documentElement.dataset.fixtureReady = 'true'
  })
}, 0)
