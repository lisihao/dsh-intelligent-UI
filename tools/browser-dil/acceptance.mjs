import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startDilBrowserPreview } from './preview.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const defaultEvidenceDirectory = resolve(root, '.acceptance/dil-browser-20261106')
const cdpModule = process.env.DIL_BROWSER_CDP || join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')

function copy(value) { return JSON.parse(JSON.stringify(value)) }

async function waitFor(label, action, sleep, timeoutMs = 12_000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await action()
    if (last) return last
    await sleep(80)
  }
  throw new Error(`DIL_BROWSER_TIMEOUT:${label}:${JSON.stringify(last ?? null)}`)
}

async function pointFor(page, selector) {
  return page.eval(selectorValue => {
    const element = document.querySelector(selectorValue)
    if (!(element instanceof HTMLElement)) return undefined
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined
  }, selector)
}

async function click(page, selector) {
  const point = await pointFor(page, selector)
  assert.ok(point, `DIL_BROWSER_CONTROL_MISSING:${selector}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function setRangeByPointer(page, selector, target) {
  const point = await page.eval(({ selectorValue, targetValue }) => {
    const element = document.querySelector(selectorValue)
    if (!(element instanceof HTMLInputElement)) return undefined
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    const min = Number(element.min), max = Number(element.max)
    if (!(rect.width > 16) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return undefined
    const ratio = Math.max(0, Math.min(1, (targetValue - min) / (max - min)))
    return { x: rect.left + 8 + ratio * (rect.width - 16), y: rect.top + rect.height / 2 }
  }, { selectorValue: selector, targetValue: target })
  assert.ok(point, `DIL_BROWSER_RANGE_MISSING:${selector}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function setSelectNative(page, selector, value) {
  const selected = await page.eval(({ selectorValue, nextValue }) => {
    const element = document.querySelector(selectorValue)
    if (!(element instanceof HTMLSelectElement)) return { found: false, options: [] }
    const options = [...element.options].map(option => option.value)
    if (!options.includes(nextValue)) return { found: true, options, value: element.value }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    if (!setter) return { found: true, options, value: element.value, noSetter: true }
    setter.call(element, nextValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return { found: true, options, value: element.value }
  }, { selectorValue: selector, nextValue: value })
  assert.equal(selected?.found, true, `DIL_BROWSER_SELECT_MISSING:${selector}:${value}:${JSON.stringify(selected)}`)
  assert.ok(selected.options.includes(value), `DIL_BROWSER_SELECT_OPTION_MISSING:${selector}:${value}:${JSON.stringify(selected)}`)
}

async function snapshot(page) {
  return page.eval(() => {
    const root = document.querySelector('[data-dil-browser-program]')
    const tree = root?.querySelector('[data-dil-native-tree]')
    const iframe = root?.querySelector('iframe[data-dil-sandbox="true"]')
    const slider = root?.querySelector('input[name="seats"]')
    const coverage = root?.querySelector('input[name="coverage"]')
    const select = root?.querySelector('select[name="tier"]')
    // Whole-page clipping can conceal overflow inside a rounded reading/card surface.
    const containedBounds = tree ? [...tree.querySelectorAll('[data-dil-tag], input, select, textarea, button, .iexp-dil-chart-plot')].flatMap(element => {
      if (!(element instanceof HTMLElement) || !element.getClientRects().length) return []
      const parent = element.parentElement?.closest('[data-dil-tag="card"], [data-dil-tag="chart"], [data-dil-tag="pie-chart"], label')
        ?? root?.querySelector('.dil-browser-surface')
      if (!(parent instanceof HTMLElement)) return []
      const rect = element.getBoundingClientRect(), outer = parent.getBoundingClientRect(), css = getComputedStyle(parent)
      const left = outer.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)
      const right = outer.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight)
      return [{ tag: element.getAttribute('data-dil-tag') ?? element.tagName.toLowerCase(), name: element.getAttribute('name'), left: rect.left, right: rect.right, containerLeft: left, containerRight: right }]
    }) : []
    let frameReadable = false
    try { frameReadable = Boolean(iframe?.contentWindow?.location.href) } catch { frameReadable = false }
    return {
      program: root?.getAttribute('data-dil-browser-program') ?? null,
      enabled: root?.getAttribute('data-dil-browser-enabled') ?? null,
      containedBounds,
      nativeTree: Boolean(tree), nativeText: tree?.textContent ?? '',
      fallback: Boolean(root?.querySelector('[data-dil-fallback]')), fallbackText: root?.querySelector('[data-dil-fallback]')?.textContent ?? '',
      iframeCount: root?.querySelectorAll('iframe[data-dil-sandbox="true"]').length ?? 0,
      iframeSandbox: iframe?.getAttribute('sandbox') ?? null, iframeReferrerPolicy: iframe?.getAttribute('referrerpolicy') ?? null,
      iframeSrc: iframe?.getAttribute('src') ?? null, frameReadable,
      slider: slider instanceof HTMLInputElement ? slider.value : null,
      coverage: coverage instanceof HTMLInputElement ? coverage.checked : null,
      tier: select instanceof HTMLSelectElement ? select.value : null,
      chartCount: root?.querySelectorAll('[data-dil-tag="chart"]').length ?? 0,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      modelCalls: window.__dilBrowser?.modelCalls ?? null,
      submissions: window.__dilBrowser?.submissions ?? [], stateSnapshots: window.__dilBrowser?.stateSnapshots ?? [],
    }
  })
}

function assertContentBounds(value, width) {
  const exceeded = value.containedBounds.filter(item => item.left < item.containerLeft - 0.5 || item.right > item.containerRight + 0.5)
  assert.deepEqual(exceeded, [], `native content crosses its container inset at ${width}px: ${JSON.stringify(exceeded)}`)
}

function assertInitial(value, width) {
  assertContentBounds(value, width)
  assert.equal(value.nativeTree, true, `DIL native tree did not mount at ${width}px`)
  assert.equal(value.fallback, false, `DIL unexpectedly fell back at ${width}px: ${value.fallbackText}`)
  assert.equal(value.iframeCount, 1, `DIL sandbox iframe count mismatch at ${width}px`)
  assert.equal(value.iframeSandbox, 'allow-scripts')
  assert.equal(value.iframeReferrerPolicy, 'no-referrer')
  assert.match(value.iframeSrc ?? '', /^http:\/\/127\.0\.0\.1:\d+\/solar-dil\//)
  assert.equal(value.frameReadable, false, 'sandboxed frame must not expose its document to the parent')
  assert.equal(value.slider, '3'); assert.equal(value.coverage, false); assert.equal(value.tier, 'standard')
  assert.equal(value.chartCount, 1); assert.match(value.nativeText, /月度金额：¥600/)
  assert.ok(value.stateSnapshots.some(state => state.seats === 3 && state.coverage === false && state.tier === 'standard'), 'worker never reported initial keyed state')
  assert.ok(value.scrollWidth <= value.clientWidth, `page overflows at ${width}px: ${value.scrollWidth}/${value.clientWidth}`)
}

async function exerciseInteractiveProgram(page, sleep, width, screenshotPath) {
  await setRangeByPointer(page, 'input[name="seats"]', 6)
  const afterSlider = await waitFor(`slider Worker state changes at ${width}px`, async () => {
    const current = await snapshot(page)
    const seats = Number(current.slider)
    return Number.isInteger(seats) && seats !== 3 && current.stateSnapshots.some(state => state.seats === seats) ? current : undefined
  }, sleep)
  const seats = Number(afterSlider.slider)
  await click(page, '[data-dil-tag="checkbox"]')
  await waitFor(`coverage Worker state toggles at ${width}px`, async () => {
    const current = await snapshot(page)
    return current.coverage === true && current.stateSnapshots.some(state => state.seats === seats && state.coverage === true) ? current : undefined
  }, sleep)

  // Deliberately adjacent: captureState must obtain final Worker state before host submit.
  await setSelectNative(page, 'select[name="tier"]', 'pro')
  await click(page, 'button[type="submit"]')
  const submitted = await waitFor(`immediate select-to-submit snapshot at ${width}px`, async () => {
    const current = await snapshot(page)
    return current.submissions.length === 1 ? current : undefined
  }, sleep)
  const expectedMonthly = seats * 500 + 75
  assert.equal(submitted.modelCalls, 0)
  assert.deepEqual(copy(submitted.submissions[0]), {
    action: 'confirm', state: { seats, coverage: true, tier: 'pro' }, fields: { seats: String(seats), coverage: true, tier: 'pro' },
  })
  const settled = await waitFor(`select snapshot settles after submit at ${width}px`, async () => {
    const current = await snapshot(page)
    return current.slider === String(seats) && current.coverage === true && current.tier === 'pro' && new RegExp(`月度金额：¥${String(expectedMonthly)}`).test(current.nativeText) ? current : undefined
  }, sleep)

  await click(page, '[data-dil-browser-action="update"]')
  const updated = await waitFor(`compiled update preserves keyed state at ${width}px`, async () => {
    const current = await snapshot(page)
    return current.program === 'updated' && /已更新/.test(current.nativeText) ? current : undefined
  }, sleep)
  assert.equal(updated.iframeCount, 1, 'compiled update must not rebuild the sandbox frame')
  assert.equal(updated.slider, String(seats)); assert.equal(updated.coverage, true); assert.equal(updated.tier, 'pro')
  assert.match(updated.nativeText, new RegExp(`月度金额：¥${String(expectedMonthly)}`))
  assertContentBounds(updated, width)
  assert.ok(updated.scrollWidth <= updated.clientWidth, `updated page overflows at ${width}px`)
  await page.screenshot({ path: screenshotPath, format: 'png', fullPage: true })

  await click(page, '[data-dil-browser-action="disable"]')
  const disabled = await waitFor(`gate disposes frame at ${width}px`, async () => {
    const current = await snapshot(page)
    return current.enabled === 'false' && current.fallback && current.iframeCount === 0 ? current : undefined
  }, sleep)
  assert.match(disabled.fallbackText, /查看完整 DIL 源码/)
  return { submitted, settled, updated, disabled }
}

async function exerciseInvalidSource(browser, origin, sleep, width) {
  const page = await browser.newPage({ width, height: 860, mobile: width <= 390 })
  try {
    await page.goto(origin)
    await waitFor(`invalid-source setup at ${width}px`, async () => (await snapshot(page)).nativeTree, sleep)
    await click(page, '[data-dil-browser-action="invalid"]')
    const failed = await waitFor(`invalid source fallback at ${width}px`, async () => {
      const current = await snapshot(page)
      return current.program === 'invalid' && current.fallback ? current : undefined
    }, sleep)
    assert.equal(failed.iframeCount, 0, 'invalid snapshot must quarantine its sandbox frame')
    assert.match(failed.fallbackText, /not-supported/); assert.match(failed.fallbackText, /查看完整 DIL 源码/)
    return failed
  } finally { await page.close() }
}

async function exerciseWatchdog(browser, origin, sleep) {
  const page = await browser.newPage({ width: 1440, height: 900 })
  try {
    await page.goto(origin)
    await waitFor('watchdog setup native tree', async () => (await snapshot(page)).nativeTree, sleep)
    const started = Date.now()
    await click(page, '[data-dil-browser-action="timeout"]')
    const failed = await waitFor('Worker render watchdog fallback', async () => {
      const current = await snapshot(page)
      return current.program === 'timeout' && current.fallback ? current : undefined
    }, sleep, 8_000)
    const elapsedMs = Date.now() - started
    assert.ok(elapsedMs < 8_000, `watchdog exceeded bounded wait: ${elapsedMs}ms`)
    assert.match(failed.fallbackText, /render budget|Timeout/i)
    assert.match(failed.fallbackText, /while\(true\)/)

    // The infinite loop stays in the Worker. A real host-page button still runs.
    await click(page, '[data-dil-browser-action="disable"]')
    const disabled = await waitFor('host remains responsive after Worker timeout', async () => {
      const current = await snapshot(page)
      return current.enabled === 'false' && current.iframeCount === 0 ? current : undefined
    }, sleep)
    assert.deepEqual(page.consoleErrors, [], `watchdog page exceptions: ${JSON.stringify(page.consoleErrors)}`)
    return { elapsedMs, failed, disabled }
  } finally { await page.close() }
}

/** Runs the isolated browser acceptance; source is fixed local fixture data only. */
export async function runDilBrowserAcceptance({ evidenceDirectory = defaultEvidenceDirectory } = {}) {
  if (!existsSync(cdpModule)) throw new Error(`DIL_BROWSER_CDP_MISSING: set DIL_BROWSER_CDP to the design-taste CDP helper (checked ${cdpModule}).`)
  const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)
  const preview = await startDilBrowserPreview()
  let browser
  try {
    const parentResponse = await fetch(preview.origin)
    const parentCsp = parentResponse.headers.get('content-security-policy') ?? ''
    assert.equal(parentResponse.status, 200)
    assert.ok(!/unsafe-eval/iu.test(parentCsp), `parent CSP permits eval: ${parentCsp}`)
    assert.match(parentCsp, /script-src 'self'/)
    const frameResponse = await fetch(preview.frameUrl)
    const frameCsp = frameResponse.headers.get('content-security-policy') ?? ''
    assert.equal(frameResponse.status, 200)
    assert.match(frameCsp, /default-src 'none'/)
    assert.match(frameCsp, /unsafe-eval/)

    await mkdir(evidenceDirectory, { recursive: true })
    browser = await Browser.launch({ width: 1440, height: 900 })
    const viewports = []
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width <= 390 })
      try {
        await page.goto(preview.origin)
        const initial = await waitFor(`DIL initial render at ${width}px`, async () => {
          const current = await snapshot(page)
          return current.nativeTree ? current : undefined
        }, sleep)
        assertInitial(initial, width)
        const targets = await browser.send('Target.getTargets')
        const workerTargets = (targets.targetInfos ?? []).filter(target => target.type === 'worker').map(target => target.url)
        assert.ok(workerTargets.length > 0, `no browser Worker target observed at ${width}px`)
        const interactions = await exerciseInteractiveProgram(page, sleep, width, join(evidenceDirectory, `dil-${width}.png`))
        const invalid = await exerciseInvalidSource(browser, preview.origin, sleep, width)
        assert.deepEqual(page.consoleErrors, [], `page exceptions at ${width}px: ${JSON.stringify(page.consoleErrors)}`)
        viewports.push({ width, initial, interactions, invalid, workerTargets })
      } finally { await page.close() }
    }
    const serverEvidence = await (await fetch(`${preview.origin}/api/evidence`)).json()
    assert.equal(serverEvidence.modelCalls, 0)
    assert.equal(serverEvidence.requestCounts['/api/model'] ?? 0, 0)
    const watchdog = await exerciseWatchdog(browser, preview.origin, sleep)
    const receipt = {
      formatVersion: 1,
      kind: 'synthetic-local-dil-browser-acceptance',
      generatedAt: new Date().toISOString(),
      modelCalls: 0,
      parentCsp,
      frameCsp,
      fixedSourceOnly: true,
      screenshots: ['dil-1440.png', 'dil-390.png'],
      viewports,
      watchdog,
      limitations: ['This checks a loopback browser fixture, not a real model authoring turn or installed Desktop runtime.'],
    }
    await writeFile(join(evidenceDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8')
    return receipt
  } finally {
    await browser?.close()
    await preview.close()
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const receipt = await runDilBrowserAcceptance()
  process.stdout.write(`DIL_BROWSER_RECEIPT=${JSON.stringify({ viewports: receipt.viewports.length, modelCalls: receipt.modelCalls, screenshots: receipt.screenshots })}\n`)
}
