import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startCanvasExtendedFixture } from './server.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(process.env.CANVAS_EXTENDED_BROWSER_EVIDENCE ?? '/private/tmp/iexp-canvas-extended-20261106/browser-evidence')
const cdpModule = process.env.CANVAS_EXTENDED_CDP ?? join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs')
const effects = ['ascii-sweep', 'bubble', 'cloth', 'droplets', 'flame-wrap', 'force-field', 'glass', 'glyph-rain', 'laser', 'liquid', 'peel', 'retro-dither', 'dithered-object', 'particle-object', 'liquid-object']
const selectedEffects = process.env.CANVAS_EXTENDED_EFFECTS === undefined ? effects : process.env.CANVAS_EXTENDED_EFFECTS.split(',').map(value => value.trim()).filter(value => effects.includes(value))
if (!selectedEffects.length) throw new Error('CANVAS_EXTENDED_EFFECTS_INVALID')

if (!output.startsWith('/private/tmp/iexp-canvas-extended-')) throw new Error('CANVAS_EXTENDED_BROWSER_OUTPUT')

async function waitFor(label, action, sleep, timeoutMs = 30_000) {
  const began = Date.now()
  let last
  while (Date.now() - began < timeoutMs) {
    last = await action()
    if (last) return last
    await sleep(100)
  }
  throw new Error(`CANVAS_EXTENDED_BROWSER_TIMEOUT:${label}:${JSON.stringify(last ?? null)}`)
}

async function snapshot(page) {
  return page.eval(() => {
    const evidence = window.__canvasExtendedEvidence
    const source = document.querySelector('.source')
    const visual = document.querySelector('.visual')
    return {
      ready: document.documentElement.dataset.fixtureReady ?? null,
      evidence,
      sourceVisible: source instanceof HTMLElement && source.getBoundingClientRect().width > 0 && source.getBoundingClientRect().height > 0,
      visualVisible: visual instanceof HTMLElement && visual.getBoundingClientRect().width > 0 && visual.getBoundingClientRect().height > 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      frames: document.querySelectorAll('iframe').length,
      visualFrames: visual?.querySelectorAll('iframe').length ?? 0,
      canvases: document.querySelectorAll('canvas').length,
    }
  })
}

async function visualRegions(page) {
  return page.eval(() => {
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return undefined
      const value = element.getBoundingClientRect()
      return value.width > 0 && value.height > 0 ? { x: value.x, y: value.y, width: value.width, height: value.height } : undefined
    }
    return { source: rect(document.querySelector('.source')), visual: rect(document.querySelector('.visual, .object')) }
  })
}

async function stimulateVisual(page, region, sleep) {
  assert.ok(region, 'visual region is missing')
  const x = region.x + region.width * 0.24
  const y = region.y + region.height * 0.5
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 6; step++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + step * Math.max(8, region.width * 0.075), y: y + Math.sin(step) * Math.max(5, region.height * 0.16), button: 'left', buttons: 1 })
    await sleep(28)
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + region.width * 0.48, y, button: 'left', buttons: 0, clickCount: 1 })
}

async function composedPixelEvidence(page, before, after, sourceRegion, visualRegion) {
  return page.eval(async ({ before: beforeData, after: afterData, sourceRegion: source, visualRegion: visual }) => {
    const image = async data => {
      const result = new Image()
      result.src = `data:image/png;base64,${data}`
      await result.decode()
      return result
    }
    const [beforeImage, afterImage] = await Promise.all([image(beforeData), image(afterData)])
    const read = (input, region) => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(region.width)); canvas.height = Math.max(1, Math.round(region.height))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('CANVAS_EXTENDED_SCREENSHOT_CONTEXT')
      context.drawImage(input, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
    }
    const feature = value => {
      const bins = new Map()
      for (let index = 0; index < value.data.length; index += 4) {
        const key = `${value.data[index] >> 4}:${value.data[index + 1] >> 4}:${value.data[index + 2] >> 4}`
        bins.set(key, (bins.get(key) ?? 0) + 1)
      }
      let dominant = 0
      for (const count of bins.values()) dominant = Math.max(dominant, count)
      return { pixels: value.width * value.height, dominantPixels: dominant, nonDominantPixels: value.width * value.height - dominant, bins: bins.size }
    }
    const visualBefore = read(beforeImage, visual)
    const visualAfter = read(afterImage, visual)
    let changedPixels = 0, delta = 0
    for (let index = 0; index < visualBefore.data.length; index += 4) {
      const distance = Math.abs(visualBefore.data[index] - visualAfter.data[index]) + Math.abs(visualBefore.data[index + 1] - visualAfter.data[index + 1]) + Math.abs(visualBefore.data[index + 2] - visualAfter.data[index + 2])
      delta += distance
      if (distance >= 24) changedPixels++
    }
    let sourceFeatureMatches = 0, sourceFeaturePixels = 0
    if (source) {
      const sourcePixels = read(beforeImage, source)
      const sourceFeature = feature(sourcePixels)
      const baseline = sourcePixels.data.slice(0, 3)
      const length = Math.min(sourcePixels.data.length, visualBefore.data.length)
      for (let index = 0; index < length; index += 4) {
        const sourceDistance = Math.abs(sourcePixels.data[index] - baseline[0]) + Math.abs(sourcePixels.data[index + 1] - baseline[1]) + Math.abs(sourcePixels.data[index + 2] - baseline[2])
        if (sourceDistance < 48) continue
        sourceFeaturePixels++
        const visualDistance = Math.abs(sourcePixels.data[index] - visualBefore.data[index]) + Math.abs(sourcePixels.data[index + 1] - visualBefore.data[index + 1]) + Math.abs(sourcePixels.data[index + 2] - visualBefore.data[index + 2])
        if (visualDistance < 72) sourceFeatureMatches++
      }
      return { source: sourceFeature, visualBefore: feature(visualBefore), visualAfter: feature(visualAfter), changedPixels, delta, sourceFeaturePixels, sourceFeatureMatches }
    }
    return { visualBefore: feature(visualBefore), visualAfter: feature(visualAfter), changedPixels, delta, sourceFeaturePixels, sourceFeatureMatches }
  }, { before, after, sourceRegion, visualRegion })
}

async function checkOne(browser, origin, effect, width, sleep) {
  const page = await browser.newPage({ width, height: width === 1440 ? 900 : 844, mobile: width <= 390 })
  try {
    await page.goto(`${origin}/?effect=${encodeURIComponent(effect)}`, { settleMs: 300 })
    const current = await waitFor(`${effect}:${String(width)}`, async () => {
      const next = await snapshot(page)
      return next.ready === 'true' ? next : next.ready === 'failed' ? next : undefined
    }, sleep)
    assert.equal(current.ready, 'true', `fixture failed for ${effect}:${String(width)}: ${JSON.stringify(current.evidence)}`)
    assert.equal(current.evidence?.mounted, true, `factory did not mount for ${effect}:${String(width)}`)
    assert.equal(current.evidence?.originalTextPreserved, true, `source changed for ${effect}:${String(width)}`)
    assert.deepEqual(current.evidence?.errors, [], `runtime error for ${effect}:${String(width)}: ${JSON.stringify(current.evidence)}`)
    assert.equal(current.overflow, false, `horizontal overflow at ${effect}:${String(width)}`)
    if (current.evidence?.kind === 'html') {
      assert.equal(current.sourceVisible, true, `retained source hidden for ${effect}:${String(width)}`)
      assert.ok(current.evidence.visualCanvasCount > 0, `visual copy absent for ${effect}:${String(width)}`)
      assert.equal(current.evidence.sourceCaptureCompleted, true, `source bitmap did not reach ${effect}:${String(width)}`)
      if (effect === 'liquid') {
        assert.ok(current.evidence.adapter?.mounted, `Liquid factory did not acknowledge mount at ${String(width)}`)
        assert.ok(current.evidence.adapter?.bitmaps > 0, `Liquid did not receive an ImageBitmap at ${String(width)}`)
        assert.ok(current.evidence.adapter?.updates > 0 && current.evidence.adapter?.resizes > 0, `Liquid update/resize was not acknowledged at ${String(width)}`)
        const frame = current.evidence.visualFrame
        assert.equal(frame?.hidden, false, `Liquid frame is hidden at ${String(width)}`)
        assert.equal(frame?.glError, 0, `Liquid WebGL error at ${String(width)}: ${String(frame?.glError)}`)
        assert.ok(frame?.source?.nonTransparent > 0 && frame?.source?.nonWhite > 0, `Liquid source feature was not painted at ${String(width)}: ${JSON.stringify({ sourceBitmap: current.evidence.sourceBitmap, frame })}`)
        assert.ok(frame?.displayOutput?.nonTransparent > 0 && frame?.displayOutput?.nonWhite > 0, `Liquid display framebuffer did not render source-derived pixels at ${String(width)}: ${JSON.stringify(frame)}`)
        // A later WebGL readback can be transparent when the browser has already
        // presented and discarded a non-preserved drawing buffer. The assertion
        // above reads the same default framebuffer synchronously after draw.
        if (frame?.output?.nonTransparent > 0) assert.ok(frame.output.nonWhite > 0, `Liquid retained output readback is flat at ${String(width)}`)
      } else {
        assert.ok(current.evidence.factory?.calls > 0 && current.evidence.factory?.mounted, `direct factory did not return an instance for ${effect}:${String(width)}`)
        assert.ok(current.evidence.factory?.updates > 0 && current.evidence.factory?.resizes > 0, `direct factory update/resize was not observed for ${effect}:${String(width)}`)
        if (effect === 'ascii-sweep') assert.deepEqual(current.evidence.contract, { slots: 2, privateSlots: true }, 'ASCII Sweep did not receive two private source slots')
        if (effect === 'peel') assert.equal(current.evidence.contract?.peelUnderLayer, true, 'Peel did not receive a captured private under-layer')
        if (effect !== 'ascii-sweep' && effect !== 'peel') assert.equal(current.evidence.contract?.privateProxy, true, `factory received original DOM for ${effect}`)
      }
    } else {
      assert.equal(current.evidence?.assetLoaded, true, `validated local raster was not loaded by ${effect}:${String(width)}`)
      assert.equal(current.evidence?.adapter?.loaded, true, `object adapter did not observe upstream onLoad for ${effect}:${String(width)}`)
      assert.ok(current.evidence?.factory?.calls > 0 && current.evidence?.factory?.mounted, `object factory did not return an instance for ${effect}:${String(width)}`)
      assert.ok(current.evidence?.factory?.updates > 0 && current.evidence?.factory?.resizes > 0, `object update/resize was not observed for ${effect}:${String(width)}`)
    }
    if (effect === 'liquid') assert.equal(current.visualFrames, 1, 'Liquid must run in its own visual iframe')
    const regions = await visualRegions(page)
    assert.ok(regions.visual, `visual pixels are unavailable for ${effect}:${String(width)}`)
    const before = await page.screenshot({ format: 'png', fullPage: true })
    await stimulateVisual(page, regions.visual, sleep)
    await sleep(220)
    const after = await page.screenshot({ path: join(output, `${effect}-${String(width)}.png`), format: 'png', fullPage: true })
    const visual = await composedPixelEvidence(page, before, after, regions.source, regions.visual)
    const enoughChange = visual.changedPixels > Math.max(96, Math.floor(visual.visualAfter.pixels * 0.002))
    const retainsSourceFeature = visual.sourceFeaturePixels > 0 && visual.sourceFeatureMatches > Math.max(64, Math.floor(visual.sourceFeaturePixels * 0.18))
    const visibleObject = visual.visualAfter.nonDominantPixels > Math.max(256, Math.floor(visual.visualAfter.pixels * 0.015))
    if (current.evidence?.kind === 'html') {
      assert.ok(retainsSourceFeature || enoughChange, `no visible retained-source feature or effect response for ${effect}:${String(width)}: ${JSON.stringify(visual)}`)
      if (effect === 'liquid') assert.ok(enoughChange, `Liquid did not visibly respond to real pointer input at ${String(width)}: ${JSON.stringify(visual)}`)
    } else {
      assert.ok(visibleObject, `object visual is flat after its upstream asset load at ${effect}:${String(width)}: ${JSON.stringify(visual)}`)
    }
    assert.deepEqual(page.consoleErrors, [], `browser exception for ${effect}:${String(width)}: ${JSON.stringify(page.consoleErrors)}`)
    const disposed = await page.eval(() => {
      window.__canvasExtendedDispose?.()
      return window.__canvasExtendedEvidence
    })
    await sleep(effect === 'liquid' ? 350 : 20)
    assert.equal(disposed?.disposed, true, `adapter did not dispose for ${effect}:${String(width)}`)
    if (effect !== 'liquid') assert.ok(disposed?.factory?.destroys > 0, `factory destroy was not observed for ${effect}:${String(width)}`)
    return { ...current, visual, disposed }
  } finally { await page.close() }
}

export async function runCanvasExtendedBrowserAcceptance() {
  if (!existsSync(cdpModule)) throw new Error(`CANVAS_EXTENDED_CDP_MISSING:${cdpModule}`)
  const { Browser, sleep } = await import(pathToFileURL(cdpModule).href)
  await mkdir(output, { recursive: true, mode: 0o700 })
  const preview = await startCanvasExtendedFixture()
  let browser
  try {
    const response = await fetch(preview.origin)
    assert.equal(response.status, 200)
    const csp = response.headers.get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /frame-src 'self'/)
    browser = await Browser.launch({ width: 1440, height: 900 })
    const results = []
    // One page at a time keeps the same two-slot GPU budget as the actual plugin.
    for (const effect of selectedEffects) {
      const desktop = await checkOne(browser, preview.origin, effect, 1440, sleep)
      const narrow = await checkOne(browser, preview.origin, effect, 390, sleep)
      results.push({ effect, desktop, narrow })
    }
    const receipt = {
      formatVersion: 1,
      kind: 'fixed-canvas-ui-extended-browser-acceptance',
      generatedAt: new Date().toISOString(),
      sourceCommit: 'a04a99b235299ee79a123a16ccb2e6cf9da74b6b',
      sourceModules: effects,
      viewports: [1440, 390],
      modelCalls: 0,
      results,
      limitations: ['This is a loopback fixture using fixed local source modules. It is not an installed DSH Desktop acceptance run.', 'Chrome may use SwiftShader; the receipt proves factory execution and DOM/iframe lifecycle, not hardware GPU acceleration.'],
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
  const receipt = await runCanvasExtendedBrowserAcceptance()
  process.stdout.write(`CANVAS_EXTENDED_BROWSER_RECEIPT=${JSON.stringify({ effects: receipt.results.length, modelCalls: receipt.modelCalls })}\n`)
}
