import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startCanvasExtendedFixture } from './server.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(process.env.CANVAS_COMPONENT_BROWSER_EVIDENCE ?? '/private/tmp/iexp-canvas-extended-20261106/component-view-evidence')
const cdpModule = process.env.CANVAS_EXTENDED_CDP ?? join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')
const scenarios = ['bubble', 'liquid', 'ascii-sweep', 'dithered-object', 'ripple']
const selected = process.env.CANVAS_COMPONENT_SCENARIOS === undefined ? scenarios : process.env.CANVAS_COMPONENT_SCENARIOS.split(',').map(value => value.trim()).filter(value => scenarios.includes(value))
if (!selected.length) throw new Error('CANVAS_COMPONENT_SCENARIOS_INVALID')
if (!output.startsWith('/private/tmp/iexp-canvas-extended-')) throw new Error('CANVAS_COMPONENT_BROWSER_OUTPUT')

async function waitFor(label, action, sleep, timeoutMs = 30_000) {
  const start = Date.now()
  let latest
  while (Date.now() - start < timeoutMs) {
    latest = await action()
    if (latest) return latest
    await sleep(100)
  }
  throw new Error(`CANVAS_COMPONENT_BROWSER_TIMEOUT:${label}:${JSON.stringify(latest ?? null)}`)
}

async function snapshot(page) {
  return page.eval(() => window.__canvasComponentProductionFixture?.snapshot())
}

async function screenshotEvidence(page, before, after, region) {
  return page.eval(async ({ before: beforeData, after: afterData, region: target }) => {
    const load = async data => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      return image
    }
    const [prior, next] = await Promise.all([load(beforeData), load(afterData)])
    const crop = image => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(target.width)); canvas.height = Math.max(1, Math.round(target.height))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('CANVAS_COMPONENT_SCREENSHOT_CONTEXT')
      context.drawImage(image, target.x, target.y, target.width, target.height, 0, 0, canvas.width, canvas.height)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const first = crop(prior), second = crop(next)
    const feature = pixels => {
      const bins = new Map()
      for (let index = 0; index < pixels.length; index += 4) {
        const key = `${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`
        bins.set(key, (bins.get(key) ?? 0) + 1)
      }
      let dominant = 0
      for (const value of bins.values()) dominant = Math.max(dominant, value)
      return { pixels: pixels.length / 4, bins: bins.size, nonDominantPixels: pixels.length / 4 - dominant }
    }
    let changedPixels = 0, delta = 0
    for (let index = 0; index < first.length; index += 4) {
      const distance = Math.abs(first[index] - second[index]) + Math.abs(first[index + 1] - second[index + 1]) + Math.abs(first[index + 2] - second[index + 2])
      delta += distance
      if (distance >= 24) changedPixels++
    }
    return { before: feature(first), after: feature(second), changedPixels, delta }
  }, { before, after, region })
}

async function stimulate(page, region, sleep) {
  const x = region.x + region.width * 0.24
  const y = region.y + region.height * 0.5
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 6; step++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + step * Math.max(8, region.width * 0.075), y: y + Math.sin(step) * Math.max(5, region.height * 0.16), button: 'left', buttons: 1,
    })
    await sleep(28)
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + region.width * 0.48, y, button: 'left', buttons: 0, clickCount: 1 })
}

function expectedLoad(scenario) {
  return scenario === 'liquid' ? [] : [scenario]
}

function requiresPointerChange(scenario) {
  return scenario === 'bubble' || scenario === 'liquid' || scenario === 'ripple'
}

async function checkOne(browser, origin, scenario, width, sleep) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width <= 390 })
  try {
    // CanvasClientScope correctly refuses hidden documents. Make this real
    // CDP window foreground before navigation, matching an active app surface.
    await page.send('Page.bringToFront')
    await page.goto(`${origin}/component-view?scenario=${encodeURIComponent(scenario)}`, { settleMs: 300 })
    const initial = await waitFor(`${scenario}:${String(width)}`, async () => {
      const value = await snapshot(page)
      return value?.status === 'ready' || value?.status === 'failed' || value?.status === 'blocked' ? value : undefined
    }, sleep)
    assert.equal(initial.status, 'ready', `production CanvasComponentView did not reach ready for ${scenario}:${String(width)}: ${JSON.stringify(initial)}`)
    assert.deepEqual(initial.errors, [], `production CanvasComponentView reported source/effect error for ${scenario}:${String(width)}: ${JSON.stringify(initial)}`)
    assert.deepEqual(initial.loaded, expectedLoad(scenario), `production CanvasRuntimeContext did not load the expected fixed factory for ${scenario}:${String(width)}: ${JSON.stringify(initial)}`)
    assert.equal(initial.horizontalOverflow, false, `production CanvasComponentView overflowed at ${scenario}:${String(width)}`)
    assert.ok(initial.sourceText.includes('Synthetic'), `production source DOM is absent for ${scenario}:${String(width)}`)
    assert.ok(initial.source?.width > 0 && initial.source?.height > 0 && initial.host?.width > 0 && initial.host?.height > 0, `production source/effect geometry is absent for ${scenario}:${String(width)}: ${JSON.stringify(initial)}`)
    assert.ok(Math.abs(initial.source.width - initial.host.width) <= 2 && Math.abs(initial.source.height - initial.host.height) <= 2, `CanvasComponentView geometry violates the extended adapter equality requirement for ${scenario}:${String(width)}: ${JSON.stringify(initial)}`)
    if (scenario === 'ascii-sweep') assert.ok(initial.alternateText.includes('Synthetic alternate retained panel'), `ASCII Sweep second retained source is absent: ${JSON.stringify(initial)}`)
    if (scenario === 'liquid') assert.equal(initial.liquidFrames, 1, `Liquid did not mount exactly one fixed opaque frame: ${JSON.stringify(initial)}`)

    const before = await page.screenshot({ format: 'png', fullPage: true })
    await stimulate(page, initial.host, sleep)
    await sleep(240)
    const after = await page.screenshot({ path: join(output, `${scenario}-${String(width)}.png`), format: 'png', fullPage: true })
    const visual = await screenshotEvidence(page, before, after, initial.host)
    const nonFlat = visual.after.nonDominantPixels > Math.max(256, Math.floor(visual.after.pixels * 0.015))
    const changed = visual.changedPixels > Math.max(96, Math.floor(visual.after.pixels * 0.002))
    assert.ok(nonFlat, `production effect host is visually flat for ${scenario}:${String(width)}: ${JSON.stringify(visual)}`)
    if (requiresPointerChange(scenario)) assert.ok(changed, `production effect did not visibly react to local pointer input for ${scenario}:${String(width)}: ${JSON.stringify(visual)}`)
    assert.deepEqual(page.consoleErrors, [], `browser exception for ${scenario}:${String(width)}: ${JSON.stringify(page.consoleErrors)}`)

    const disposed = await page.eval(() => {
      window.__canvasComponentProductionFixture?.dispose()
      return { components: document.querySelectorAll('[data-canvas-component],[data-canvas-block]').length, frames: document.querySelectorAll('iframe').length, bodyCanvases: document.querySelectorAll('body > canvas').length }
    })
    await sleep(350)
    const cleanup = await page.eval(() => ({ components: document.querySelectorAll('[data-canvas-component],[data-canvas-block]').length, frames: document.querySelectorAll('iframe').length, bodyCanvases: document.querySelectorAll('body > canvas').length }))
    assert.equal(cleanup.components, 0, `production CanvasComponentView left a mounted tree after cleanup for ${scenario}:${String(width)}: ${JSON.stringify(cleanup)}`)
    assert.equal(cleanup.frames, 0, `production CanvasComponentView left an iframe after cleanup for ${scenario}:${String(width)}: ${JSON.stringify(cleanup)}`)
    assert.equal(cleanup.bodyCanvases, 0, `production CanvasComponentView left a detached source canvas after cleanup for ${scenario}:${String(width)}: ${JSON.stringify(cleanup)}`)
    return { initial, visual, disposed, cleanup }
  } finally { await page.close() }
}

export async function runCanvasComponentProductionAcceptance() {
  if (!existsSync(cdpModule)) throw new Error(`CANVAS_COMPONENT_CDP_MISSING:${cdpModule}`)
  const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)
  await mkdir(output, { recursive: true, mode: 0o700 })
  const preview = await startCanvasExtendedFixture()
  let browser
  try {
    const response = await fetch(`${preview.origin}/component-view?scenario=bubble`)
    assert.equal(response.status, 200)
    const csp = response.headers.get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /frame-src 'self'/)
    browser = await Browser.launch({ width: 1440, height: 900 })
    const results = []
    for (const scenario of selected) {
      const desktop = await checkOne(browser, preview.origin, scenario, 1440, sleep)
      const narrow = await checkOne(browser, preview.origin, scenario, 390, sleep)
      results.push({ scenario, desktop, narrow })
    }
    const receipt = {
      formatVersion: 1,
      kind: 'production-canvas-component-view-browser-acceptance',
      generatedAt: new Date().toISOString(),
      sourceCommit: 'a04a99b235299ee79a123a16ccb2e6cf9da74b6b',
      scenarios: selected,
      viewports: [1440, 390],
      modelCalls: 0,
      results,
      limitations: ['This is a loopback React 18 fixture using fixed local Canvas modules and explicit synthetic source values. It is not an installed DSH Desktop acceptance run.', 'The fixture verifies production CanvasComponentView dispatch and CanvasRuntimeContext loading; no model, profile, or external asset is used.'],
    }
    await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
    return receipt
  } finally {
    await browser?.close()
    await new Promise(resolve => preview.server.close(resolve))
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  const receipt = await runCanvasComponentProductionAcceptance()
  process.stdout.write(`CANVAS_COMPONENT_BROWSER_RECEIPT=${JSON.stringify({ scenarios: receipt.results.length, modelCalls: receipt.modelCalls })}\n`)
}
