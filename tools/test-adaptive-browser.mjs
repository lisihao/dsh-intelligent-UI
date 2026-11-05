import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidenceDirectory = resolve(root, '.acceptance/adaptive-ui-browser')
const cdpModule = process.env.ADAPTIVE_UI_CDP ?? '/Users/sihaoli/.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)

function startPreview() {
  const child = spawn(process.execPath, ['tools/adaptive-ui-preview.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ADAPTIVE_UI_PREVIEW_PORT: '0' },
  })
  const lines = []
  let stdoutBuffer = ''
  let stderr = ''
  let resolveUrl
  let rejectUrl
  const url = new Promise((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
  const consume = chunk => {
    stdoutBuffer += chunk.toString()
    const fragments = stdoutBuffer.split('\n')
    stdoutBuffer = fragments.pop() ?? ''
    for (const line of fragments) {
      if (!line) continue
      lines.push(line)
      const match = /^ADAPTIVE_UI_PREVIEW_URL=(http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
      if (match) resolveUrl(match[1])
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.once('error', error => rejectUrl(error))
  child.once('exit', code => {
    if (!lines.some(line => line.startsWith('ADAPTIVE_UI_PREVIEW_URL='))) rejectUrl(new Error(`preview server exited before startup (${code ?? 'unknown'}): ${stderr.slice(-500)}`))
  })
  const timeout = setTimeout(() => rejectUrl(new Error(`preview server did not print its URL: ${stderr.slice(-500)}`)), 30000)
  return { child, lines, url: url.finally(() => clearTimeout(timeout)), stderr: () => stderr }
}

async function stopPreview(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(10000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function waitFor(label, action, timeoutMs = 15000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await action()
    if (last) return last
    await sleep(80)
  }
  throw new Error(`timeout waiting for ${label}${last ? `: ${JSON.stringify(last)}` : ''}`)
}

async function setSelect(page, label, value) {
  const changed = await page.eval(({ label, value }) => {
    const control = [...document.querySelectorAll('select')].find(item => item.getAttribute('aria-label') === label)
    if (!(control instanceof HTMLSelectElement)) return false
    if (![...control.options].some(option => option.value === value)) return false
    control.value = value
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return control.value === value
  }, { label, value })
  assert.equal(changed, true, `expected real select “${label}” to expose option “${value}”`)
}

async function click(page, selector) {
  const target = await page.eval(selector => {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement)) return undefined
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
  }, selector)
  assert.ok(target, `missing clickable control ${selector}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
}

async function selectedScenario(page, documentId, expected) {
  const snapshot = await waitFor(`${documentId} selected receipt`, () => page.eval(({ documentId, expected }) => {
    const events = window.__adaptiveUiPreviewEvents ?? []
    const composition = [...events].reverse().find(event => event.type === 'composition' && event.documentId === documentId)
    const receipt = [...events].reverse().find(event => event.type === 'receipt' && event.documentId === documentId && event.observed === true)
    const scope = document.querySelector('#preview-output [data-iexp-composition-scope]')
    if (!composition || !receipt || !scope || composition.status !== 'selected') return undefined
    return {
      status: scope.getAttribute('data-iexp-composition-status'),
      theme: scope.getAttribute('data-iexp-adaptive-theme'),
      layout: scope.getAttribute('data-iexp-composition-layout'),
      selection: composition.selection,
      schema: composition.schema,
      receiptObserved: receipt.observed === true,
      board: !!document.querySelector('#preview-output [data-content-layout="board"]'),
      sourceTable: !!document.querySelector('#preview-output table'),
      sourceContainsTask: (document.querySelector('#preview-output')?.textContent ?? '').includes('核对来源') && (document.querySelector('#preview-output')?.textContent ?? '').includes('确认回执'),
      historic: !!document.querySelector('#preview-output .iexp-historical-chart'),
      autoChartWrapper: !!document.querySelector('#preview-output [data-auto-chart]'),
      visxMarkCount: document.querySelectorAll('#preview-output path.visx-linepath, #preview-output rect.visx-bar').length,
      componentSets: [...document.querySelectorAll('#preview-output [data-iexp-component-set]')].map(element => element.getAttribute('data-iexp-component-set')),
      documentId: document.querySelector('[data-preview-document-id]')?.textContent,
    }
  }, { documentId, expected }))
  assert.equal(snapshot.status, 'selected')
  assert.equal(snapshot.theme, expected.theme)
  assert.equal(snapshot.layout, expected.layout)
  assert.equal(snapshot.selection?.themeId, expected.theme)
  assert.equal(snapshot.selection?.layout, expected.layout)
  assert.equal(snapshot.receiptObserved, true)
  assert.equal(snapshot.schema?.revision, 1)
  for (const requiredQuestion of ['theme', 'surface', 'chart', 'component-set', 'layout']) {
    assert.ok(snapshot.schema?.questionIds.includes(requiredQuestion), `${documentId} has actual candidate-schema question ${requiredQuestion}`)
  }
  return snapshot
}

await mkdir(evidenceDirectory, { recursive: true })
const preview = startPreview()
let browser
let page
let offConsole
let offNetwork
try {
  const origin = await preview.url
  browser = await Browser.launch({ width: 1440, height: 900 })
  page = await browser.newPage({ width: 1440, height: 900 })
  const consoleErrors = []
  const requests = []
  offConsole = page.browser.on(page.sessionId, 'Runtime.consoleAPICalled', message => {
    if (message.type === 'error') consoleErrors.push(message.args?.map(item => item.value ?? item.description ?? '').join(' ').slice(0, 500))
  })
  await page.send('Network.enable')
  offNetwork = page.browser.on(page.sessionId, 'Network.requestWillBeSent', message => {
    if (typeof message.request?.url === 'string') requests.push(message.request.url)
  })
  await page.goto(origin, { settleMs: 500 })
  await waitFor('fixture root', () => page.eval(() => document.querySelector('[data-adaptive-preview="synthetic"]') !== null))
  const banner = await page.eval(() => ({
    synthetic: document.querySelector('[data-adaptive-preview]')?.getAttribute('data-adaptive-preview'),
    paid: document.querySelector('[data-adaptive-preview]')?.getAttribute('data-paid-model-calls'),
    notice: document.querySelector('[data-preview-notice]')?.textContent ?? '',
  }))
  assert.deepEqual(banner.synthetic, 'synthetic')
  assert.equal(banner.paid, '0')
  assert.match(banner.notice, /零真实模型|零.*模型/)

  const board = await selectedScenario(page, 'synthetic-task-board-soft', { theme: 'uiverse-soft-relief', layout: 'board' })
  assert.equal(board.board, true)
  assert.equal(board.sourceTable, true)
  assert.equal(board.sourceContainsTask, true)
  assert.ok(board.componentSets.includes('soft-relief'), 'soft-relief is a real production component adapter in the selected board')
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-board-soft-1440.png'), format: 'png', fullPage: true })

  await setSelect(page, '输出显示方式', 'compare')
  const compare = await waitFor('raw comparison source', () => page.eval(() => {
    const raw = document.querySelector('.iexp-raw-output pre')?.textContent ?? ''
    return raw.includes('核对来源') && raw.includes('确认回执')
  }))
  assert.equal(compare, true)
  await setSelect(page, '输出显示方式', 'visual')

  await setSelect(page, '合成场景', 'table-mechanical')
  const table = await selectedScenario(page, 'synthetic-task-table-mechanical', { theme: 'uiverse-mechanical-outline', layout: 'table' })
  assert.equal(table.board, false, 'the same task source uses the selected table route rather than a board')
  assert.equal(table.sourceTable, true)
  assert.equal(table.sourceContainsTask, true)
  assert.equal(table.documentId, 'synthetic-task-table-mechanical')

  await setSelect(page, '合成场景', 'history-visx')
  const visx = await selectedScenario(page, 'synthetic-history-visx', { theme: 'uiverse-soft-relief', layout: 'auto' })
  assert.equal(visx.selection?.chart, 'visx')
  assert.equal(visx.historic, true, JSON.stringify(visx))
  assert.ok(visx.visxMarkCount > 0)
  assert.equal(visx.sourceTable, true)

  await setSelect(page, '合成场景', 'history-openui')
  const openui = await selectedScenario(page, 'synthetic-history-openui', { theme: 'uiverse-mechanical-outline', layout: 'auto' })
  assert.equal(openui.selection?.chart, 'openui')
  assert.equal(openui.historic, false)
  assert.equal(openui.autoChartWrapper, true)
  assert.equal(openui.visxMarkCount, 0)
  assert.ok(openui.componentSets.includes('mechanical-outline'), 'OpenUI route mounted the selected production mechanical adapter')
  assert.equal(openui.sourceTable, true)

  await setSelect(page, '共享主题', 'ascii')
  await setSelect(page, '合成场景', 'scope-plain')
  const scoped = await selectedScenario(page, 'synthetic-scope-plain', { theme: 'plain', layout: 'document' })
  const kerning = await waitFor('global ASCII/local Plain font-kerning boundary', () => page.eval(() => {
    const global = document.querySelector('[data-global-ascii-probe]')
    const local = document.querySelector('#preview-output [data-iexp-composition-scope] .openui-markdown-renderer > p')
    if (!(global instanceof HTMLElement) || !(local instanceof HTMLElement)) return undefined
    return { global: getComputedStyle(global).fontKerning, local: getComputedStyle(local).fontKerning }
  }))
  assert.equal(kerning.global, 'none', 'neighboring outer ASCII paragraph preserves its global kerning rule')
  assert.ok(['auto', 'normal'].includes(kerning.local), `local Plain paragraph resets kerning instead of inheriting ASCII none (${kerning.local})`)
  assert.equal(scoped.documentId, 'synthetic-scope-plain')

  await page.setViewport({ width: 390, height: 844, mobile: true })
  await setSelect(page, '合成场景', 'live-static')
  const live = await selectedScenario(page, 'synthetic-live-static', { theme: 'uiverse-soft-relief', layout: 'auto' })
  const liveSnapshot = await waitFor('explicit static live snapshot', () => page.eval(() => ({
    state: document.querySelector('#preview-output [data-live-series]')?.getAttribute('data-live-series'),
    text: document.querySelector('#preview-output [data-live-series]')?.textContent ?? '',
    rows: document.querySelectorAll('#preview-output [data-live-series] table tbody tr').length,
  })))
  assert.equal(live.selection?.live, 'native')
  assert.equal(liveSnapshot.state, 'static')
  assert.match(liveSnapshot.text, /动画已停用/)
  assert.equal(liveSnapshot.rows, 3)
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-live-static-390.png'), format: 'png', fullPage: true })

  await click(page, '[data-adaptive-toggle]')
  const disabled = await waitFor('adaptive disable local fallback', () => page.eval(() => {
    const root = document.querySelector('[data-adaptive-preview]')
    const scope = document.querySelector('#preview-output [data-iexp-composition-scope]')
    if (!root || !scope) return undefined
    return {
      enabled: root.getAttribute('data-preview-adaptive-enabled'),
      status: scope.getAttribute('data-iexp-composition-status'),
      theme: scope.getAttribute('data-iexp-adaptive-theme'),
    }
  }))
  assert.equal(disabled.enabled, 'false')
  assert.equal(disabled.status, 'local')

  const selectedDocuments = [
    'synthetic-task-board-soft',
    'synthetic-task-table-mechanical',
    'synthetic-history-visx',
    'synthetic-history-openui',
    'synthetic-scope-plain',
    'synthetic-live-static',
  ]
  await waitFor('server receipt evidence', () => preview.lines.filter(line => line.startsWith('ADAPTIVE_UI_EVENT=')).length >= selectedDocuments.length)
  const serverReceipts = preview.lines
    .filter(line => line.startsWith('ADAPTIVE_UI_EVENT='))
    .map(line => JSON.parse(line.slice('ADAPTIVE_UI_EVENT='.length)))
  for (const documentId of selectedDocuments) {
    const receipt = serverReceipts.find(event => event.documentId === documentId)
    assert.equal(receipt?.observed, true, `${documentId} has an observed receipt from the real coordinator route`)
    assert.equal(receipt?.schema?.revision, 1, `${documentId} has real planner schema evidence`)
    assert.equal(receipt?.externalModelCalls, 0)
  }
  const unexpectedNetwork = requests.filter(url => !url.startsWith(origin) && !url.startsWith('data:') && url !== 'about:blank')
  assert.deepEqual(unexpectedNetwork, [], 'the acceptance page makes no external network or paid-model request')
  assert.deepEqual(page.consoleErrors, [], 'the production browser bundle has no uncaught page exception')
  assert.deepEqual(consoleErrors, [], 'the production browser bundle emits no console error')

  console.log(JSON.stringify({
    status: 'passed',
    synthetic: true,
    externalModelCalls: 0,
    browser: 'real Chrome via CDP',
    viewports: [1440, 390],
    screenshots: [join(evidenceDirectory, 'adaptive-board-soft-1440.png'), join(evidenceDirectory, 'adaptive-live-static-390.png')],
    selectedDocuments: selectedDocuments.length,
    receiptsObserved: serverReceipts.filter(event => event.observed === true).length,
    covered: ['board/table', 'soft-relief/mechanical-outline', 'visx/OpenUI', 'raw/compare', 'explicit live static snapshot', 'disable local fallback', 'global-ASCII/local-Plain style scope'],
    notClaimed: ['real Jev', 'real model', 'paid model', 'native application acceptance'],
  }, null, 2))
} finally {
  try { offConsole?.() } catch {}
  try { offNetwork?.() } catch {}
  try { await page?.close() } catch {}
  try { await browser?.close() } catch {}
  await stopPreview(preview.child)
}
