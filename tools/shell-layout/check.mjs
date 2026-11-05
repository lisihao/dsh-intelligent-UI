#!/usr/bin/env node

// Real Chromium geometry regression for src/shell-layout-style.ts.
// The DOM and the small view-toggle handler below are synthetic fixtures. The
// CSS consumed by the fixture is read from the published rc.2/Synapse modules.

import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '../..')
const DEFAULT_HOME = homedir()
const PATHS = {
  shellSource: process.env.SHELL_LAYOUT_SOURCE ?? join(PROJECT, 'src/shell-layout-style.ts'),
  layoutClient: process.env.DSH_LAYOUT_CLIENT ?? join(PROJECT, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'),
  sidebarClient: process.env.DSH_SIDEBAR_CLIENT ?? join(PROJECT, 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'),
  conversationClient: process.env.DSH_CONVERSATION_CLIENT ?? join(PROJECT, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),
  synapseClient: process.env.DSH_SYNAPSE_CLIENT ?? join(DEFAULT_HOME, '.dsh/profiles/desktop/node_modules/dsh-synapse/client.js'),
  quantClient: process.env.DSH_QUANTJOURNEY_CLIENT ?? join(DEFAULT_HOME, '.dsh/profiles/desktop/node_modules/@lisihao/dsh-solar-quantjourney/lib/client.cjs'),
  cdpModule: process.env.CDP_MODULE ?? join(process.env.CODEX_HOME ?? join(DEFAULT_HOME, '.codex'), 'skills/design-taste-frontend/scripts/lib/cdp.mjs'),
  outputRoot: process.env.SHELL_LAYOUT_OUTPUT ?? join(PROJECT, 'output/playwright/shell-layout'),
}

const viewports = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'medium', width: 1024, height: 768 },
  { name: 'compact', width: 768, height: 600 },
  { name: 'phone', width: 390, height: 844 },
]

const require = createRequire(import.meta.url)
const ts = require(join(PROJECT, 'node_modules/typescript'))

function usage() {
  return 'Usage: node tools/shell-layout/check.mjs [--help]\n' +
    'Environment overrides: DSH_LAYOUT_CLIENT, DSH_SIDEBAR_CLIENT, DSH_CONVERSATION_CLIENT, DSH_SYNAPSE_CLIENT, DSH_QUANTJOURNEY_CLIENT, CDP_MODULE, SHELL_LAYOUT_OUTPUT'
}

function decodeDouble(raw) {
  return JSON.parse('"' + raw + '"')
}

function decodeSingle(raw) {
  let result = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch !== '\\') {
      result += ch
      continue
    }
    const next = raw[++i]
    if (next === undefined) throw new Error('unterminated JavaScript string escape')
    result += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' })[next] ?? next
  }
  return result
}

function extractCss(source, marker, label) {
  const matches = source.matchAll(/const css(?:\$\d+)? = "((?:\\.|[^"\\])*)"/g)
  for (const match of matches) {
    const css = decodeDouble(match[1])
    if (css.includes(marker)) return css
  }
  throw new Error(`Cannot find ${label} CSS containing ${marker}`)
}

function extractSynapseCss(source) {
  const match = source.match(/style\.textContent = '((?:\\.|[^'\\])*)'/)
  if (!match) throw new Error('Cannot find Synapse 0.5.7 style.textContent')
  return decodeSingle(match[1])
}

function extractClass(source, key, label, mapMarker) {
  const scoped = mapMarker ? source.slice(source.indexOf(mapMarker)) : source
  const match = scoped.match(new RegExp(`"${key}":\\s*"([^"]+)"`))
  if (!match) throw new Error(`Cannot find ${label} CSS class ${key}`)
  return match[1]
}

async function readText(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`)
  return (await readFile(path)).toString('utf8')
}

async function loadInputs() {
  const [shellSource, layoutSource, sidebarSource, conversationSource, synapseSource, quantSource] = await Promise.all([
    readText(PATHS.shellSource, 'shell-layout source'),
    readText(PATHS.layoutClient, 'rc.2 ui-layout client'),
    readText(PATHS.sidebarClient, 'rc.2 ui-sidebar client'),
    readText(PATHS.conversationClient, 'rc.2 ui-conversation client'),
    readText(PATHS.synapseClient, 'Synapse client'),
    readText(PATHS.quantClient, 'QuantJourney client'),
  ])
  const quantStyle = quantSource.match(/var navigation_default = '((?:\\.|[^'\\])*)'/)
  if (!quantStyle) throw new Error('QuantJourney navigation CSS not found')
  const shellModule = ts.transpileModule(shellSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: basename(PATHS.shellSource),
  }).outputText
  const shell = await import(`data:text/javascript;base64,${Buffer.from(shellModule).toString('base64')}`)
  if (typeof shell.shellLayoutCss !== 'string' || !shell.shellLayoutCss.includes('cm-footer-stack')) throw new Error('shellLayoutCss was not exported')

  const classes = {
    frame: extractClass(layoutSource, 'frame', 'ui-layout'),
    sidebarCol: extractClass(layoutSource, 'sidebarCol', 'ui-layout'),
    centerCol: extractClass(layoutSource, 'centerCol', 'ui-layout'),
    bottomRow: extractClass(layoutSource, 'bottomRow', 'ui-layout'),
    overlayLayer: extractClass(layoutSource, 'overlayLayer', 'ui-layout'),
    sidebarRoot: extractClass(sidebarSource, 'root', 'ui-sidebar'),
    topStrip: extractClass(sidebarSource, 'topStrip', 'ui-sidebar'),
    brand: extractClass(sidebarSource, 'brand', 'ui-sidebar'),
    brandIdentity: extractClass(sidebarSource, 'brandIdentity', 'ui-sidebar'),
    logoRow: extractClass(sidebarSource, 'logoRow', 'ui-sidebar'),
    toggle: extractClass(sidebarSource, 'toggle', 'ui-sidebar'),
    regionArea: extractClass(sidebarSource, 'regionArea', 'ui-sidebar'),
    panelList: extractClass(sidebarSource, 'panelList', 'ui-sidebar'),
    panelRow: extractClass(sidebarSource, 'panelRow', 'ui-sidebar'),
    footArea: extractClass(sidebarSource, 'footArea', 'ui-sidebar'),
    settingsArea: extractClass(sidebarSource, 'settingsArea', 'ui-sidebar'),
    footerActions: extractClass(sidebarSource, 'footerActions', 'ui-sidebar'),
    conversationRoot: extractClass(conversationSource, 'root', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    body: extractClass(conversationSource, 'body', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    conversationHeader: extractClass(conversationSource, 'header', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    titleRow: extractClass(conversationSource, 'titleRow', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    titleCluster: extractClass(conversationSource, 'titleCluster', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    headerActions: extractClass(conversationSource, 'headerActions', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    headerUtilities: extractClass(conversationSource, 'headerUtilities', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    headerCorner: extractClass(conversationSource, 'headerCorner', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    tabs: extractClass(conversationSource, 'tabs', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
    tab: extractClass(conversationSource, 'tab', 'ui-conversation', 'var ConversationRoot_module_css_default = {'),
  }
  return {
    shellCss: shell.shellLayoutCss,
    layoutCss: extractCss(layoutSource, `.${classes.frame}`, 'ui-layout'),
    sidebarCss: extractCss(sidebarSource, `.${classes.sidebarRoot}`, 'ui-sidebar'),
    conversationCss: extractCss(conversationSource, `.${classes.conversationRoot}`, 'ui-conversation'),
    synapseCss: extractSynapseCss(synapseSource),
    quantCss: decodeSingle(quantStyle[1]),
    classes,
    paths: { ...PATHS },
  }
}

function fixtureMarkup(input, fullscreen) {
  const c = input.classes
  const rows = Array.from({ length: 36 }, (_, i) => `<button id="fee-${i + 1}" class="fixture-fee-row" type="button">费用 ${i + 1}</button>`).join('')
  return `<!doctype html>
<html data-platform="darwin"${fullscreen ? ' data-fullscreen' : ''}>
<head>
<meta charset="utf-8">
<style id="fixture-reset">
  :root,html,body,#fixture-app{width:100%;height:100%;margin:0;overflow:hidden}
  *{box-sizing:border-box}
  body{background:#f7f8fb;color:#111827;font:14px system-ui,sans-serif}
  button{font:inherit}
  .bt-return{display:flex;align-items:center}
  .bt-return-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fixture-native-header-mark{min-width:0}
  .fixture-native-header-mark button{height:30px;white-space:nowrap}
  .fixture-native-body{min-height:0;flex:1;background:#fff}
  .fixture-fee-stack{display:flex;flex-direction:column;gap:2px;min-height:0;background:#eef1f6;padding:4px}
  .fixture-fee-row{height:24px;min-height:24px;flex:none;border:0;text-align:left;background:#e2e8f0}
  .fixture-sentinel{position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0}
</style>
<style id="official-layout">${input.layoutCss}</style>
<style id="official-sidebar">${input.sidebarCss}</style>
<style id="official-conversation">${input.conversationCss}</style>
<style id="official-synapse">${input.synapseCss}</style>
<style id="quant-navigation">${input.quantCss}</style>
<style id="solar-shell-layout">${input.shellCss}</style>
</head>
<body>
<button class="solar-quant-tools-disclosure" type="button" aria-expanded="true" tabindex="-1">工具</button>
<button id="tab-sentinel" class="fixture-sentinel" type="button">sentinel</button>
<main id="fixture-app">
  <div data-slot="root" style="width:100%;height:100%">
    <div class="${c.frame}" style="grid-template-columns:280px minmax(0,1fr) 0px">
      <div class="${c.sidebarCol}">
        <div data-slot="sidebar" class="${c.sidebarRoot}">
          <div class="${c.topStrip}"><button id="sidebar-toggle" class="${c.toggle}" tabindex="-1" type="button">侧栏</button></div>
          <div class="${c.logoRow}"><span class="${c.brand}"><span id="native-brand" class="${c.brandIdentity}" style="width:188px">DeepSeek Harness</span></span></div>
          <nav class="${c.panelList}" aria-label="工具">
            <button class="${c.panelRow}" tabindex="-1"><svg data-solar-quant-panel-icon data-wide="true"></svg>量化研究</button>
            <button id="tool-progress" class="${c.panelRow}" tabindex="-1">项目进展</button>
            <button id="tool-browser" class="${c.panelRow}" tabindex="-1">数据浏览器</button>
          </nav>
          <div class="${c.regionArea}"><span>原生会话列表</span></div>
          <div class="${c.footArea}">
            <div class="${c.footerActions}">
              <div data-slot="sidebar.footer.action">
                <button id="dsbot" class="bt-return" type="button"><span class="bt-mark" style="width:20px;height:20px"></span><span class="bt-return-name">DS Bot</span></button>
                <div class="cm-footer-stack fixture-fee-stack">${rows}</div>
              </div>
            </div>
            <div class="${c.settingsArea}"><button id="settings" type="button">设置</button></div>
          </div>
        </div>
      </div>
      <div class="${c.centerCol}">
        <section class="${c.conversationRoot}" data-phase="active">
          <header id="native-header" class="${c.conversationHeader}">
            <div class="fixture-native-header-mark"><button id="native-leading" tabindex="-1" type="button">原生标题前导</button></div>
            <div class="${c.titleRow}">
              <div class="${c.titleCluster}">
                <nav class="fixture-native-header-mark" aria-label="会话层级"><button id="native-title" tabindex="-1" type="button">原生会话标题</button><span>当前会话</span></nav>
                <div class="${c.headerActions}"><button id="native-action" tabindex="-1" type="button">原生操作</button></div>
              </div>
              <div class="${c.headerUtilities}"><button id="native-label" tabindex="-1" type="button">原生标签</button></div>
            </div>
            <div class="${c.headerCorner}"><button id="native-corner" tabindex="-1" type="button">原生角标操作</button></div>
            <div class="${c.tabs}" role="tablist"><button tabindex="-1" class="${c.tab}" type="button">对话页签</button><button tabindex="-1" class="${c.tab}" type="button">详情页签</button></div>
          </header>
          <div class="${c.body} fixture-native-body"><div class="fixture-native-body">原生内容</div></div>
        </section>
      </div>
      <div class="${c.bottomRow}" data-shell-bottom></div>
      <div class="${c.overlayLayer}" data-shell-overlay></div>
    </div>
  </div>
  <div class="dsh-synapse-host">
    <div class="dsh-synapse-switch" role="group" aria-label="视图切换">
      <span class="dsh-synapse-grip" aria-hidden="true"></span>
      <button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button>
      <button type="button" data-view="map" aria-pressed="false">会话地图</button>
    </div>
    <section class="dsh-synapse-overlay" hidden><iframe title="会话地图"></iframe></section>
  </div>
</main>
</body></html>`
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value
}

function pageGeometry() {
  const round = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : value
  const rect = (selector) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), width: round(r.width), height: round(r.height) }
  }
  const style = (selector) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const s = getComputedStyle(node)
    return {
      display: s.display,
      position: s.position,
      top: s.top,
      left: s.left,
      right: s.right,
      zIndex: s.zIndex,
      order: s.order,
      overflowY: s.overflowY,
      maxHeight: s.maxHeight,
      paddingBlockStart: s.paddingBlockStart,
      readingFlow: s.readingFlow ?? s.getPropertyValue('reading-flow'),
    }
  }
  const selectors = {
    frame: '[data-slot="root"] > [class$="_frame"]',
    center: '[data-slot="root"] > [class$="_frame"] > [class$="_centerCol"]',
    foot: '[data-slot="sidebar"] [class$="_footArea"]',
    topStrip: '[data-slot="sidebar"] [class$="_topStrip"]',
    logoRow: '[data-slot="sidebar"] [class$="_logoRow"]',
    sidebarToggle: '#sidebar-toggle',
    settings: '#settings',
    dsbot: '#dsbot',
    nativeBrand: '#native-brand',
    stack: '.cm-footer-stack',
    switch: '.dsh-synapse-switch',
    overlay: '.dsh-synapse-overlay',
    nativeHeader: '#native-header',
    nativeTitle: '#native-title',
    nativeLabel: '#native-label',
    nativeAction: '#native-action',
  }
  const frame = rect(selectors.frame)
  const stack = document.querySelector(selectors.stack)
  const overlay = document.querySelector(selectors.overlay)
  const rootStyle = getComputedStyle(document.documentElement)
  const switchRect = rect(selectors.switch)
  const overlayRect = rect(selectors.overlay)
  const headerRect = rect(selectors.nativeHeader)
  return {
    viewport: { width: innerWidth, height: innerHeight },
    frame,
    switch: switchRect,
    overlay: overlayRect,
    nativeHeader: headerRect,
    nativeTitle: rect(selectors.nativeTitle),
    nativeLabel: rect(selectors.nativeLabel),
    nativeAction: rect(selectors.nativeAction),
    center: rect(selectors.center),
    topStrip: rect(selectors.topStrip),
    logoRow: rect(selectors.logoRow),
    sidebarToggle: rect(selectors.sidebarToggle),
    foot: rect(selectors.foot),
    settings: rect(selectors.settings),
    dsbot: rect(selectors.dsbot),
    nativeBrand: rect(selectors.nativeBrand),
    stack: rect(selectors.stack),
    stackScrollHeight: stack?.scrollHeight ?? null,
    stackClientHeight: stack?.clientHeight ?? null,
    stackScrollTop: stack?.scrollTop ?? null,
    overlayHidden: overlay?.hidden ?? null,
    custom: {
      frame: style(selectors.frame),
      center: style(selectors.center),
      foot: style(selectors.foot),
      settings: style(selectors.settings),
      dsbot: style(selectors.dsbot),
      stack: style(selectors.stack),
      switch: style(selectors.switch),
      overlay: style(selectors.overlay),
      htmlTopClearance: rootStyle.getPropertyValue('--dsh-frame-top-clearance').trim(),
      htmlChromeTop: rootStyle.getPropertyValue('--dsh-frame-chrome-top').trim(),
    },
    switchRowStart: 0,
    switchRowEnd: 44,
    headerOverlap: frame && switchRect && headerRect
      ? Math.max(0, Math.min(headerRect.bottom, switchRect.bottom) - Math.max(headerRect.top, switchRect.top))
      : null,
  }
}

function fixtureToggle() {
  const tools = document.querySelector('.solar-quant-tools-disclosure')
  tools.addEventListener('click', () => tools.setAttribute('aria-expanded', String(tools.getAttribute('aria-expanded') !== 'true')))
  const switchEl = document.querySelector('.dsh-synapse-switch')
  const overlay = document.querySelector('.dsh-synapse-overlay')
  for (const button of switchEl.querySelectorAll('button[data-view]')) button.addEventListener('click', () => {
    const map = button.dataset.view === 'map'
    for (const peer of switchEl.querySelectorAll('button[data-view]')) {
      peer.classList.toggle('active', peer === button)
      peer.setAttribute('aria-pressed', peer === button ? 'true' : 'false')
    }
    overlay.hidden = !map
  })
}

function shellFixture(html) {
  document.open()
  document.write(html)
  document.close()
}

async function tab(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
  return page.eval(() => document.activeElement?.id ?? document.activeElement?.textContent?.trim() ?? '')
}

function check(checks, name, ok, detail) {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) })
}

async function runViewport(page, input, viewport) {
  const checks = []
  for (const fullscreen of [false, true]) {
    await page.setViewport({ width: viewport.width, height: viewport.height, dsf: 1, mobile: false, reducedMotion: true })
    await page.eval(shellFixture, fixtureMarkup(input, fullscreen))
    await page.eval(fixtureToggle)
    await new Promise(resolve => setTimeout(resolve, 30))
    const before = await page.eval(pageGeometry)
    const normalLabel = `${viewport.name}/${fullscreen ? 'fullscreen' : 'windowed'}`
    const rowStart = before.switchRowStart
    const rowEnd = before.switchRowEnd
    const switchRect = before.switch
    const header = before.nativeHeader
    const switchInsideRow = switchRect && switchRect.top >= rowStart - 0.5 && switchRect.bottom <= rowEnd + 0.5
    const switchGap = switchRect ? rowEnd - switchRect.bottom : null
    check(checks, `${normalLabel}: switch stays in reserved 44px row`, switchInsideRow, { rowStart, rowEnd, switch: switchRect })
    check(checks, `${normalLabel}: switch leaves 4px bottom gap`, switchGap !== null && Math.abs(switchGap - 4) <= 0.5, { switchGap, switch: switchRect, rowEnd })
    check(checks, `${normalLabel}: map overlay starts below row`, before.custom.overlay && Math.abs(Number.parseFloat(before.custom.overlay.top) - rowEnd) <= 0.5, { overlay: before.overlay, overlayTop: before.custom.overlay.top, rowEnd })
    check(checks, `${normalLabel}: native header is not under reserved row`, header && header.top >= rowEnd - 0.5, { header, rowEnd, overlap: before.headerOverlap })
    for (const key of ['nativeTitle', 'nativeLabel', 'nativeAction']) {
      const r = before[key]
      check(checks, `${normalLabel}: ${key} is not under switch`, r && switchRect && (Math.min(r.bottom, switchRect.bottom) - Math.max(r.top, switchRect.top) <= 0.5), { native: r, switch: switchRect })
    }

    const fee = before.stack
    const settings = before.settings
    const dsbot = before.dsbot
    const ordered = settings && fee && settings.bottom <= fee.top + 0.5
    check(checks, `${normalLabel}: settings stays above full-width fee`, ordered, { settings, dsbot, fee })
    check(checks, `${normalLabel}: fee fills sidebar content width`, fee && before.logoRow && Math.abs(fee.width - before.logoRow.width) <= 1, { fee, logoRow: before.logoRow })
    const brand = before.nativeBrand
    check(checks, `${normalLabel}: DS Bot sits beside the brand without overlap`, dsbot && brand && before.logoRow && dsbot.left >= brand.right + 1 && dsbot.right <= before.logoRow.right + 0.5 && dsbot.top >= before.logoRow.top && dsbot.bottom <= before.logoRow.bottom + 0.5, { dsbot, brand, logoRow: before.logoRow })
    check(checks, `${normalLabel}: fee block scrolls internally`, before.stackScrollHeight > before.stackClientHeight && before.custom.stack.overflowY === 'auto', { scrollHeight: before.stackScrollHeight, clientHeight: before.stackClientHeight, overflowY: before.custom.stack.overflowY, maxHeight: before.custom.stack.maxHeight })
    check(checks, `${normalLabel}: frame guard and center padding are active`, before.custom.center.paddingBlockStart === '44px', { center: before.custom.center, frameSelector: '[data-slot=root] > *_frame:has(>[data-shell-overlay])' })
    check(checks, `${normalLabel}: native sidebar top strip stays at top`, before.topStrip && before.topStrip.top <= 0.5 && before.sidebarToggle && before.sidebarToggle.top >= before.topStrip.top && before.sidebarToggle.bottom <= before.topStrip.bottom + 0.5, { topStrip: before.topStrip, toggle: before.sidebarToggle })
    check(checks, `${normalLabel}: native sidebar logo row keeps its position`, before.topStrip && before.logoRow && Math.abs(before.logoRow.top - (before.topStrip.bottom - 12)) <= 0.5, { topStrip: before.topStrip, logoRow: before.logoRow })
    check(checks, `${normalLabel}: footer uses visual reading flow`, before.custom.foot.readingFlow === 'flex-visual', { readingFlow: before.custom.foot.readingFlow })

    await page.eval(() => { const stack = document.querySelector('.cm-footer-stack'); stack.scrollTop = stack.scrollHeight })
    const afterScroll = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: fee scroll does not move settings/DS Bot`, afterScroll.stackScrollTop > 0 && Math.abs(afterScroll.settings.top - settings.top) <= 0.5 && Math.abs(afterScroll.dsbot.top - dsbot.top) <= 0.5, { scrollTop: afterScroll.stackScrollTop, before: { settings: settings.top, dsbot: dsbot.top }, after: { settings: afterScroll.settings.top, dsbot: afterScroll.dsbot.top } })

    await page.eval(() => {
      const switchEl = document.querySelector('.dsh-synapse-switch')
      switchEl.style.left = '4px'
      switchEl.style.top = '80px'
      switchEl.style.transform = 'translateX(-50%)'
    })
    const stored = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: stored inline switch offsets cannot leave reserved row`, stored.switch && stored.switch.top >= rowStart - 0.5 && stored.switch.bottom <= rowEnd + 0.5, { inline: { left: '4px', top: '80px', transform: 'translateX(-50%)' }, computed: stored.custom.switch, switch: stored.switch, rowStart, rowEnd })

    await page.eval(() => { document.querySelector('.dsh-synapse-switch [data-view="map"]').click() })
    const mapOn = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: map toggle shows overlay below toolbar`, !mapOn.overlayHidden && mapOn.overlay && mapOn.overlay.top >= rowEnd - 0.5 && mapOn.switch && mapOn.switch.bottom <= mapOn.overlay.top + 0.5, { switch: mapOn.switch, overlay: mapOn.overlay, overlayHidden: mapOn.overlayHidden })
    await page.eval(() => { document.querySelector('.dsh-synapse-switch [data-view="dialog"]').click() })
    const mapOff = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: dialog toggle hides map overlay`, mapOff.overlayHidden === true, { overlayHidden: mapOff.overlayHidden })

    const folded = await page.eval(() => {
      document.querySelector('.solar-quant-tools-disclosure').click()
      return ['tool-progress', 'tool-browser'].every(id => getComputedStyle(document.getElementById(id)).display === 'none')
    })
    check(checks, `${normalLabel}: native progress and data browser fold with Tools`, folded)
    const expanded = await page.eval(() => {
      document.querySelector('.solar-quant-tools-disclosure').click()
      return ['tool-progress', 'tool-browser'].every(id => getComputedStyle(document.getElementById(id)).display !== 'none')
    })
    check(checks, `${normalLabel}: Tools expands both entries again`, expanded)
    await page.eval(() => { document.querySelector('.cm-footer-stack').scrollTop = 0 })
    if (!fullscreen) {
      await page.eval(() => document.querySelector('#tab-sentinel').focus())
      const tabOrder = []
      for (let i = 0; i < 4; i += 1) tabOrder.push(await tab(page))
      check(checks, `${normalLabel}: footer keyboard reachability settings → DS Bot → fee`, JSON.stringify(tabOrder) === JSON.stringify(['settings', 'dsbot', 'fee-1', 'fee-2']), { expected: ['settings', 'dsbot', 'fee-1', 'fee-2'], actual: tabOrder })
    }

    const screenshot = join(input.outputRun, `${viewport.name}-${fullscreen ? 'fullscreen' : 'windowed'}.png`)
    await page.screenshot({ path: screenshot, format: 'png', quality: 90 })
    await page.eval(() => {
      const marker = document.querySelector('[data-shell-overlay]')
      marker.remove()
      const switchEl = document.querySelector('.dsh-synapse-switch')
      switchEl.style.left = ''
      switchEl.style.top = ''
      switchEl.style.transform = ''
    })
    const guardOff = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: removing overlay marker disables shell sheet`, guardOff.custom.center.paddingBlockStart !== '44px' && guardOff.custom.overlay.top !== `${rowEnd}px`, { center: guardOff.custom.center, overlay: guardOff.custom.overlay, switch: guardOff.custom.switch })

    await page.eval(() => {
      const frame = document.querySelector('[data-slot="root"] > [class$="_frame"]')
      const marker = document.createElement('div')
      marker.dataset.shellOverlay = ''
      frame.append(marker)
    })
    await page.eval(() => document.querySelector('#solar-shell-layout').remove())
    const restored = await page.eval(pageGeometry)
    check(checks, `${normalLabel}: removing sheet restores original styles`, restored.custom.center.paddingBlockStart !== '44px' && restored.custom.stack.maxHeight === 'none' && restored.custom.overlay.top !== before.custom.overlay.top, { before: { centerPadding: before.custom.center.paddingBlockStart, feeMaxHeight: before.custom.stack.maxHeight, overlayTop: before.custom.overlay.top }, restored: { centerPadding: restored.custom.center.paddingBlockStart, feeMaxHeight: restored.custom.stack.maxHeight, overlayTop: restored.custom.overlay.top } })


  }
  return checks
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(usage() + '\n')
    return
  }
  const input = await loadInputs()
  input.outputRun = join(PATHS.outputRoot, new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(input.outputRun, { recursive: true, mode: 0o700 })
  const { Browser } = await import(PATHS.cdpModule)
  const browser = await Browser.launch({ width: 1440, height: 900 })
  const page = await browser.newPage({ width: 1440, height: 900, dsf: 1, mobile: false, reducedMotion: true })
  const checks = []
  try {
    for (const viewport of viewports) checks.push(...await runViewport(page, input, viewport))
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
  const failures = checks.filter(check => !check.ok)
  const result = {
    fixture: true,
    nativeAppAcceptance: false,
    cssSources: {
      shellSource: PATHS.shellSource,
      officialLayout: PATHS.layoutClient,
      officialSidebar: PATHS.sidebarClient,
      officialConversation: PATHS.conversationClient,
      synapse: PATHS.synapseClient,
    },
    screenshotDirectory: input.outputRun,
    checks: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    failures,
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (failures.length) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})

