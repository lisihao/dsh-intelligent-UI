import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidenceDirectory = resolve(root, '.acceptance/adaptive-ui-browser')
const cdpModule = process.env.ADAPTIVE_UI_CDP ?? '/Users/sihaoli/.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs'
const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)

const mixedBlockLayoutSource = `# 混合区块编排验收

这段普通说明必须保留在完整文档中，并保留[本地资料][mixed-source]与脚注[^mixed-note]。它不提供额外指标，也不改变相邻区块的来源边界。

## 历史数值

下面的表格是固定的历史数值序列，单位和日期来自原文。

| 日期 | 延迟（ms） |
| --- | ---: |
| 2026-11-01 | 8.2 |
| 2026-11-02 | 7.6 |
| 2026-11-03 | 9.1 |
| 2026-11-04 | 7.9 |

## 任务状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| 核对来源 | queued | 保留原始任务与说明。 |
| 渲染布局 | running | 只使用已验证的候选项。 |
| 确认回执 | done | 挂载后才记录观察结果。 |

## 来源流程

读取来源 → 核对证据 -> 记录结果

[mixed-source]: https://sources.example.invalid/mixed-source "固定本地来源"
[^mixed-note]: 固定本地脚注；该脚注不请求外部网络。`

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
  const scrolled = await page.eval(selector => {
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement)) return false
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    return true
  }, selector)
  assert.equal(scrolled, true, `missing clickable control ${selector}`)
  await sleep(80)
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

async function clickLabeledControl(page, pattern) {
  const target = await page.eval(patternSource => {
    const pattern = new RegExp(patternSource, 'i')
    const panel = document.querySelector('[data-block-layout-settings-panel]') ?? document
    const labels = [...panel.querySelectorAll('label')]
    const label = labels.find(candidate => pattern.test(candidate.textContent ?? '') || pattern.test(candidate.getAttribute('aria-label') ?? ''))
    const labelled = [...panel.querySelectorAll('input,select,button')].find(candidate => pattern.test(candidate.getAttribute('aria-label') ?? '') || pattern.test(candidate.getAttribute('placeholder') ?? ''))
    const element = label?.querySelector('input,select,button') ?? labelled
    if (!(element instanceof HTMLElement)) return undefined
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
  }, pattern)
  assert.ok(target, `missing visible Settings control matching /${pattern}/`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
}

async function recordLabeledShortcut(page, pattern, code) {
  await clickLabeledControl(page, pattern)
  await dispatchShortcut(page, code)
}

async function dispatchShortcut(page, code, modifiers = 5) {
  const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code
  const windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined
  // Chromium CDP uses bit 1=Alt, 2=Control, 4=Meta, 8=Shift; Alt+Meta is 5.
  const event = { key, code, modifiers, windowsVirtualKeyCode }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

async function mixedSnapshot(page) {
  return await waitFor('mixed block layout selection, concurrent mounts, and receipt', () => page.eval(() => {
    const events = window.__adaptiveUiPreviewEvents ?? []
    const composition = [...events].reverse().find(event => event.type === 'composition' && event.documentId === 'synthetic-mixed-block-layout')
    const receipt = [...events].reverse().find(event => event.type === 'receipt' && event.documentId === 'synthetic-mixed-block-layout' && event.observed === true)
    const output = document.querySelector('#preview-output')
    const scope = output?.querySelector('[data-iexp-composition-scope]')
    const root = output?.querySelector('[data-iexp-block-layout]') ?? scope
    if (!composition || !receipt || !output || !scope || composition.status !== 'selected' || !root) return undefined
    const mounted = selector => [...root.querySelectorAll(selector)].filter(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }).length
    const blocks = composition.selection?.blockLayout?.blocks ?? []
    const questionIds = composition.schema?.questionIds ?? []
    const optionIds = composition.schema?.optionIds ?? {}
    return {
      status: scope.getAttribute('data-iexp-composition-status'),
      selection: composition.selection,
      schema: composition.schema,
      blockIds: blocks.map(block => block.id),
      chartBlocks: blocks.filter(block => block.selection?.chart === 'visx').length,
      boardBlocks: blocks.filter(block => block.selection?.layout === 'board').length,
      flowBlocks: blocks.filter(block => block.selection?.layout === 'flow').length,
      chartMounts: mounted('.iexp-historical-chart, [data-auto-chart], .iexp-chart-grid'),
      boardMounts: mounted('[data-content-layout="board"], .iexp-task-board, .iexp-task'),
      flowMounts: mounted('.iexp-flow, .react-flow, .iexp-flow-viewport'),
      ordinaryProse: (root.textContent ?? '').includes('这段普通说明必须保留'),
      sourceTable: root.querySelectorAll('table').length >= 2,
      receiptObserved: receipt.observed === true,
      decisionCalls: receipt.decisionCalls,
      questionIdsUnique: new Set(questionIds).size === questionIds.length,
      multiChoice: Object.values(optionIds).every(options => Array.isArray(options) && options.length >= 2),
      width: root.getBoundingClientRect().width,
    }
  }))
}

function assertMixedSnapshot(snapshot, viewportWidth) {
  assert.equal(snapshot.status, 'selected')
  assert.equal(snapshot.receiptObserved, true)
  assert.equal(snapshot.decisionCalls, 1)
  assert.equal(snapshot.questionIdsUnique, true)
  assert.equal(snapshot.multiChoice, true)
  assert.ok(snapshot.blockIds.length >= 4, `expected source-owned mixed blocks: ${JSON.stringify(snapshot)}`)
  assert.equal(snapshot.chartBlocks, 1, `expected one selected historical chart block: ${JSON.stringify(snapshot)}`)
  assert.equal(snapshot.boardBlocks, 1, `expected one selected task-board block: ${JSON.stringify(snapshot)}`)
  assert.equal(snapshot.flowBlocks, 1, `expected one selected arrow-flow block: ${JSON.stringify(snapshot)}`)
  assert.ok(snapshot.chartMounts > 0, `historical chart is not mounted at ${viewportWidth}px: ${JSON.stringify(snapshot)}`)
  assert.ok(snapshot.boardMounts > 0, `task board is not mounted at ${viewportWidth}px: ${JSON.stringify(snapshot)}`)
  assert.ok(snapshot.flowMounts > 0, `arrow flow is not mounted at ${viewportWidth}px: ${JSON.stringify(snapshot)}`)
  assert.equal(snapshot.ordinaryProse, true)
  assert.equal(snapshot.sourceTable, true)
  assert.ok(snapshot.width > 0)
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
  for (const requiredQuestion of ['theme', 'surface', 'component-set']) {
    assert.ok(snapshot.schema?.questionIds.includes(requiredQuestion), `${documentId} has actual candidate-schema question ${requiredQuestion}`)
  }
  for (const [id, options] of Object.entries(snapshot.schema?.optionIds ?? {})) {
    assert.ok(options.length >= 2, `${documentId} sends a genuine multi-option choice for ${id}`)
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

  await setSelect(page, '合成场景', 'strategy-flow')
  const flow = await selectedScenario(page, 'synthetic-strategy-flow', { theme: 'uiverse-soft-relief', layout: 'flow' })
  assert.equal(flow.selection?.['componentSet'], 'soft-relief')
  assert.ok(flow.componentSets.includes('soft-relief'), 'the explicit graph mounts a production flow component adapter')
  const renderedFlow = await waitFor('explicit nodes/edges React Flow rendering', () => page.eval(() => {
    const nodes = [...document.querySelectorAll('#preview-output .react-flow__node')].map(node => ({
      id: node.getAttribute('data-id'),
      label: node.querySelector('strong')?.textContent ?? '',
      description: node.querySelector('p')?.textContent ?? '',
    }))
    const edgeIds = [...document.querySelectorAll('#preview-output .react-flow__edge')].map(edge => edge.getAttribute('data-id'))
    const edgeLabels = [...document.querySelectorAll('#preview-output .react-flow__edge-text')].map(label => label.textContent ?? '')
    if (nodes.length !== 3 || edgeIds.length !== 2 || edgeLabels.length !== 2) return undefined
    return { nodes, edgeIds, edgeLabels }
  }))
  assert.deepEqual(renderedFlow.nodes, [
    { id: 'scope', label: '明确边界', description: '确定本轮策略只覆盖可观察的来源、约束和停止条件。' },
    { id: 'evidence', label: '核对证据', description: '逐项检查来源记录、单位和限定条件，不补造关系。' },
    { id: 'decision', label: '选择方案', description: '仅在前两步保留完整时比较可执行方案。' },
  ])
  assert.deepEqual(renderedFlow.edgeIds, ['relation-0', 'relation-1'])
  assert.deepEqual(renderedFlow.edgeLabels, ['限定检查范围', '保留证据后比较'])
  await click(page, '#preview-output button[aria-label="查看全图"]')
  let lastFlowViewport
  let fittedFlow
  try {
    fittedFlow = await waitFor('all strategy nodes in the fitted React Flow viewport', async () => {
      lastFlowViewport = await page.eval(() => {
        const viewport = document.querySelector('#preview-output .iexp-flow-viewport')
        if (!(viewport instanceof HTMLElement)) return undefined
        const bounds = viewport.getBoundingClientRect()
        const nodes = [...document.querySelectorAll('#preview-output .react-flow__node')].map(node => {
          const rect = node.getBoundingClientRect()
          return { id: node.getAttribute('data-id'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
        })
        const visible = nodes.every(node => node.left >= bounds.left - 2 && node.right <= bounds.right + 2 && node.top >= bounds.top - 2 && node.bottom <= bounds.bottom + 2)
        return { count: nodes.length, visible, bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, nodes }
      })
      return lastFlowViewport?.count === 3 && lastFlowViewport.visible ? lastFlowViewport : undefined
    })
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; last flow viewport=${JSON.stringify(lastFlowViewport)}`)
  }
  assert.equal(fittedFlow.count, 3)
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-strategy-flow-1440.png'), format: 'png', fullPage: true })
  await setSelect(page, '输出显示方式', 'compare')
  const flowRaw = await waitFor('complete flow source in comparison mode', () => page.eval(() => document.querySelector('.iexp-raw-output pre')?.textContent ?? undefined))
  const parsedFlow = JSON.parse(flowRaw)
  assert.deepEqual(parsedFlow.nodes.map(node => [node.id, node.label, node.description]), [
    ['scope', '明确边界', '确定本轮策略只覆盖可观察的来源、约束和停止条件。'],
    ['evidence', '核对证据', '逐项检查来源记录、单位和限定条件，不补造关系。'],
    ['decision', '选择方案', '仅在前两步保留完整时比较可执行方案。'],
  ])
  assert.deepEqual(parsedFlow.edges, [
    { source: 'scope', target: 'evidence', label: '限定检查范围' },
    { source: 'evidence', target: 'decision', label: '保留证据后比较' },
  ])
  await setSelect(page, '输出显示方式', 'visual')

  await setSelect(page, '合成场景', 'comparison-records')
  const records = await selectedScenario(page, 'synthetic-comparison-records', { theme: 'uiverse-clear-glass', layout: 'records' })
  assert.equal(records.selection?.componentSet, 'clear-glass')
  assert.ok(records.componentSets.includes('clear-glass'), 'records route mounts the selected clear-glass production adapter')
  assert.ok(records.schema?.optionIds?.layout.includes('records'), 'records is an actual deterministic planner option for this source')
  assert.ok(records.schema?.optionIds?.['component-set'].includes('clear-glass'), 'clear-glass is an actual deterministic component-set option')
  const firstRecord = await waitFor('first comparison record details', () => page.eval(() => {
    const detail = document.querySelector('#preview-output .iexp-master-detail')
    const selected = document.querySelector('#preview-output .iexp-object-list button[aria-pressed="true"]')?.textContent?.trim()
    const description = document.querySelector('#preview-output .iexp-object-description')?.textContent ?? ''
    const fields = [...document.querySelectorAll('#preview-output .iexp-record-fields dt')].map((term, index) => [term.textContent, document.querySelectorAll('#preview-output .iexp-record-fields dd')[index]?.textContent])
    return detail && selected && fields.length === 3 ? { selected, description, fields } : undefined
  }))
  assert.match(firstRecord.selected, /方案 A：局部缓存/)
  assert.equal(firstRecord.description, '在固定本地样例中保留最近一次完整响应，以降低重复读取造成的等待。该记录只描述比较条件，不代表线上命中率、成本或真实模型质量，也不将样例差异视为节约，更不替代对来源版本、失败条件和完整响应的逐条核对。')
  assert.deepEqual(firstRecord.fields, [
    ['条件', '仅在请求体小于 64 KiB、未启用强制刷新且响应完整时比较；不能把本地回退与远端结果合并。'],
    ['单位', 'ms / 次（P95）'],
    ['观测窗口', '2026-11-01 至 2026-11-05（5 个合成采样点）'],
  ])
  await click(page, '#preview-output .iexp-object-list button:nth-of-type(2)')
  const secondRecord = await waitFor('second comparison record details', () => page.eval(() => {
    const selected = document.querySelector('#preview-output .iexp-object-list button[aria-pressed="true"]')?.textContent?.trim()
    const description = document.querySelector('#preview-output .iexp-object-description')?.textContent ?? ''
    const fields = [...document.querySelectorAll('#preview-output .iexp-record-fields dt')].map((term, index) => [term.textContent, document.querySelectorAll('#preview-output .iexp-record-fields dd')[index]?.textContent])
    return selected?.includes('方案 B：逐次读取') && fields.length === 3 ? { selected, description, fields } : undefined
  }))
  assert.equal(secondRecord.description, '在相同的固定本地样例中每次重新读取来源，以便保留更新可见性。该记录不估算生产吞吐量，也不把合成结果解释为用户真实工作负载，并且不把局部时延差异当作可推广的性能承诺或成本结论。')
  assert.deepEqual(secondRecord.fields, [
    ['条件', '仅在同一来源版本、同一 64 KiB 上限且无网络请求时比较；不包含认证、模型调用或后台刷新。'],
    ['单位', 'ms / 次（P95）'],
    ['观测窗口', '2026-11-01 至 2026-11-05（5 个合成采样点）'],
  ])
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-comparison-records-1440.png'), format: 'png', fullPage: true })
  await setSelect(page, '输出显示方式', 'compare')
  const recordsRaw = await waitFor('complete comparison records source', () => page.eval(() => document.querySelector('.iexp-raw-output pre')?.textContent ?? undefined))
  const parsedRecords = JSON.parse(recordsRaw)
  assert.deepEqual(parsedRecords.map(record => [record.name, record.条件, record.单位, record.观测窗口]), [
    ['方案 A：局部缓存', '仅在请求体小于 64 KiB、未启用强制刷新且响应完整时比较；不能把本地回退与远端结果合并。', 'ms / 次（P95）', '2026-11-01 至 2026-11-05（5 个合成采样点）'],
    ['方案 B：逐次读取', '仅在同一来源版本、同一 64 KiB 上限且无网络请求时比较；不包含认证、模型调用或后台刷新。', 'ms / 次（P95）', '2026-11-01 至 2026-11-05（5 个合成采样点）'],
  ])
  await setSelect(page, '输出显示方式', 'visual')

  await setSelect(page, '合成场景', 'cited-report-index')
  const report = await selectedScenario(page, 'synthetic-cited-report-index', { theme: 'uiverse-mechanical-outline', layout: 'heading-index' })
  assert.equal(report.selection?.componentSet, 'mechanical-outline')
  assert.ok(report.schema?.optionIds?.layout.includes('heading-index'), 'heading-index is an actual deterministic planner option for the cited report')
  const renderedReport = await waitFor('cited report heading index', () => page.eval(() => {
    const index = document.querySelector('#preview-output .iexp-heading-index')
    const indexEntries = [...document.querySelectorAll('#preview-output .iexp-heading-index nav a')].map(anchor => anchor.textContent?.trim() ?? '')
    const headings = [...document.querySelectorAll('#preview-output .openui-markdown-renderer h2, #preview-output .openui-markdown-renderer h3')].map(heading => heading.textContent?.trim() ?? '')
    const citations = [...document.querySelectorAll('#preview-output .openui-markdown-renderer a[href^="https://sources.example.invalid/"]')].map(anchor => anchor.getAttribute('href'))
    return index && indexEntries.length === 5 && headings.length === 5 && citations.length === 4 ? { indexEntries, headings, citations } : undefined
  }))
  assert.deepEqual(renderedReport.indexEntries, ['范围与问题', '范围条件', '方法与材料', '比较结果', '限制与引文'])
  assert.deepEqual(renderedReport.headings, ['范围与问题', '范围条件', '方法与材料', '比较结果', '限制与引文'])
  assert.deepEqual(renderedReport.citations, [
    'https://sources.example.invalid/a',
    'https://sources.example.invalid/b',
    'https://sources.example.invalid/a',
    'https://sources.example.invalid/b',
  ])
  await click(page, '#preview-output .iexp-heading-index summary')
  const expandedIndex = await waitFor('five visible cited-report heading-index links', () => page.eval(() => {
    const index = document.querySelector('#preview-output .iexp-heading-index')
    if (!(index instanceof HTMLDetailsElement) || !index.open) return undefined
    const links = [...index.querySelectorAll('nav a')]
    const visible = links.every(link => {
      const rect = link.getBoundingClientRect()
      const style = getComputedStyle(link)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    })
    return links.length === 5 && visible ? links.map(link => link.textContent?.trim() ?? '') : undefined
  }))
  assert.deepEqual(expandedIndex, ['范围与问题', '范围条件', '方法与材料', '比较结果', '限制与引文'])
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-cited-report-index-1440.png'), format: 'png', fullPage: true })
  await click(page, '#preview-output .iexp-heading-index nav a')
  const navigatedHeading = await waitFor('heading-index anchor focus', () => page.eval(() => {
    const active = document.activeElement
    return active instanceof HTMLHeadingElement && active.tagName === 'H2' ? { text: active.textContent?.trim(), id: active.id } : undefined
  }))
  assert.equal(navigatedHeading.text, '范围与问题')
  assert.match(navigatedHeading.id, /-heading-\d+$/)
  await setSelect(page, '输出显示方式', 'compare')
  const reportRaw = await waitFor('complete cited report source', () => page.eval(() => document.querySelector('.iexp-raw-output pre')?.textContent ?? undefined))
  assert.equal(reportRaw, `# 合成方案比较报告

本报告是固定本地样例，用于验证章节导航和引文原文保留；不构成真实研究结论。[资料 A](https://sources.example.invalid/a)

## 范围与问题

比较只覆盖两个明确的本地读取方案。单位为 ms / 次（P95），不把样例结果外推为生产时延。[资料 B](https://sources.example.invalid/b)

### 范围条件

请求体必须小于 64 KiB，且来源版本一致；缺失、重试和外部调用不纳入本节比较。

## 方法与材料

记录保留 2026-11-01 至 2026-11-05 的五个合成采样点。每个点的原始单位与条件保持不变。[资料 A](https://sources.example.invalid/a)

## 比较结果

本地缓存适合验证重复读取路径；逐次读取适合验证来源更新可见性。两者都不能证明真实模型、付费调用或线上业务效果。

## 限制与引文

本报告没有真实会话、账号、凭据或外部网络请求。任何部署、成本和质量判断都需要独立的真实证据。[资料 B](https://sources.example.invalid/b)

[^1]: 资料 A：固定本地来源记录，版本 synthetic-2026-11-05。
[^2]: 资料 B：合成验收约束；该引用不请求外部网络。`)
  await setSelect(page, '输出显示方式', 'visual')

  await setSelect(page, '合成场景', 'mixed-block-layout')
  const mixed = await mixedSnapshot(page)
  assertMixedSnapshot(mixed, 1440)
  assert.equal(mixed.selection?.blockLayout?.version, 1)
  assert.equal(mixed.selection?.blockLayout?.inspection, 'none')
  assert.equal(new Set(mixed.blockIds).size, mixed.blockIds.length)
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-mixed-block-layout-1440.png'), format: 'png', fullPage: true })

  await setSelect(page, '输出显示方式', 'compare')
  const mixedRaw = await waitFor('complete mixed block source in comparison mode', () => page.eval(() => document.querySelector('.iexp-raw-output pre')?.textContent ?? undefined))
  assert.equal(mixedRaw, mixedBlockLayoutSource)
  await setSelect(page, '输出显示方式', 'visual')
  const mixedReferences = await waitFor('mixed reference link and footnote definitions', () => page.eval(() => {
    const output = document.querySelector('#preview-output')
    if (!output) return undefined
    const reference = [...output.querySelectorAll('a')].find(anchor => anchor.textContent?.trim() === '本地资料')
    const footnoteRef = output.querySelector('a[data-footnote-ref], a[href*="mixed-note"], sup a')
    const footnoteDefinition = output.querySelector('[data-footnotes] li, li[id*="mixed-note"], li[id*="fn-"]')
    if (!reference || !footnoteRef || !footnoteDefinition) return undefined
    return {
      href: reference.getAttribute('href'),
      footnoteHref: footnoteRef.getAttribute('href'),
      footnoteText: footnoteDefinition.textContent?.trim(),
    }
  }))
  assert.equal(mixedReferences.href, 'https://sources.example.invalid/mixed-source')
  assert.match(mixedReferences.footnoteHref ?? '', /mixed-note|fn-/)
  assert.match(mixedReferences.footnoteText ?? '', /固定本地脚注/)

  const initialBlockSettings = await waitFor('production block-layout Settings panel enabled state', () => page.eval(() => {
    const panel = document.querySelector('[data-block-layout-settings-panel]')
    const label = [...(panel?.querySelectorAll('label') ?? [])].find(candidate => /区块|block/i.test(candidate.textContent ?? ''))
    const checkbox = label?.querySelector('input[type="checkbox"]') ?? panel?.querySelector('input[data-adaptive-block-layout-toggle], input[aria-label*="区块"], input[aria-label*="block"], input[type="checkbox"]')
    const shortcut = [...(panel?.querySelectorAll('input') ?? [])].find(input => /快捷键|shortcut/i.test(input.getAttribute('aria-label') ?? '') || /快捷键|shortcut/i.test(input.getAttribute('placeholder') ?? '') || /快捷键|shortcut/i.test(input.parentElement?.textContent ?? ''))
    if (!(checkbox instanceof HTMLInputElement) || !(shortcut instanceof HTMLInputElement)) return undefined
    return { checked: checkbox.checked, shortcut: shortcut.value, rootEnabled: document.querySelector('[data-adaptive-preview]')?.getAttribute('data-preview-block-layout') }
  }))
  assert.equal(initialBlockSettings.checked, true)
  assert.equal(initialBlockSettings.rootEnabled, 'true')
  assert.ok(['Alt+Meta+KeyI', '⌥⌘I'].includes(initialBlockSettings.shortcut), `unexpected production shortcut display: ${initialBlockSettings.shortcut}`)

  await recordLabeledShortcut(page, '快捷键|shortcut', 'KeyK')
  await waitFor('custom block-layout shortcut saved through production Settings', () => page.eval(() => document.querySelector('[data-adaptive-preview]')?.getAttribute('data-preview-block-layout-shortcut') === 'Alt+Meta+KeyK'))
  await clickLabeledControl(page, '内容块|区块|block')
  await waitFor('production block-layout checkbox saved false', () => page.eval(() => document.querySelector('[data-adaptive-preview]')?.getAttribute('data-preview-block-layout') === 'false'))
  await dispatchShortcut(page, 'KeyI')
  await sleep(120)
  assert.equal(await page.eval(() => document.querySelector('[data-adaptive-preview]')?.getAttribute('data-preview-block-layout')), 'false', 'old default shortcut stops toggling after customization')
  await dispatchShortcut(page, 'KeyK')
  await waitFor('custom block-layout shortcut toggled through production handler', () => page.eval(() => document.querySelector('[data-adaptive-preview]')?.getAttribute('data-preview-block-layout') === 'true'))
  await waitFor('mixed composition remounted after custom shortcut', () => page.eval(() => document.querySelector('#preview-output [data-iexp-composition-status="selected"]') !== null))

  await page.setViewport({ width: 390, height: 844, mobile: true })
  const mixedNarrow = await mixedSnapshot(page)
  assertMixedSnapshot(mixedNarrow, 390)
  await page.screenshot({ path: join(evidenceDirectory, 'adaptive-mixed-block-layout-390.png'), format: 'png', fullPage: true })

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
    'synthetic-strategy-flow',
    'synthetic-comparison-records',
    'synthetic-cited-report-index',
    'synthetic-mixed-block-layout',
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
    if (documentId === 'synthetic-mixed-block-layout') assert.equal(receipt?.decisionCalls, 1, 'mixed block layout uses exactly one decision call')
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
    screenshots: [
      join(evidenceDirectory, 'adaptive-board-soft-1440.png'),
      join(evidenceDirectory, 'adaptive-strategy-flow-1440.png'),
      join(evidenceDirectory, 'adaptive-comparison-records-1440.png'),
      join(evidenceDirectory, 'adaptive-cited-report-index-1440.png'),
      join(evidenceDirectory, 'adaptive-mixed-block-layout-1440.png'),
      join(evidenceDirectory, 'adaptive-mixed-block-layout-390.png'),
      join(evidenceDirectory, 'adaptive-live-static-390.png'),
    ],
    selectedDocuments: selectedDocuments.length,
    receiptsObserved: serverReceipts.filter(event => event.observed === true).length,
    covered: ['board/table', 'soft-relief/mechanical-outline', 'visx/OpenUI', 'explicit nodes/edges React Flow', 'records/clear-glass with condition and unit preservation', 'cited report heading index with complete raw source', 'mixed source-bound chart/board/arrow-flow in one document at default and narrow widths', 'production Settings block-layout toggle and customizable physical-key shortcut', 'raw/compare', 'explicit live static snapshot', 'disable local fallback', 'global-ASCII/local-Plain style scope'],
    notClaimed: ['real Jev quality', 'real model', 'paid model', 'native application acceptance'],
  }, null, 2))
} finally {
  try { offConsole?.() } catch {}
  try { offNetwork?.() } catch {}
  try { await page?.close() } catch {}
  try { await browser?.close() } catch {}
  await stopPreview(preview.child)
}
