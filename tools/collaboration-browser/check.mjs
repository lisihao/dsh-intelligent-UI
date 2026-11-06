// Synthetic Chrome proof for the built CollaborationEntry export. It never starts DSH or reads a DSH profile.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = join(root, 'tools', 'collaboration-browser')
const client = process.env.COLLABORATION_BROWSER_CLIENT ?? join(root, 'lib', 'client.cjs')
const output = '/private/tmp/dsh-collaboration-browser'
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const playwrightCore = '/private/tmp/dsh-pstack-ui-tools-6789f692/node_modules/playwright-core/index.mjs'
const viewportHeight = 768

const assert = (value, message) => {
  if (!value) throw new Error(message)
}

if (process.env.COLLABORATION_BROWSER_CLIENT !== undefined && !isAbsolute(client)) {
  throw new Error('COLLABORATION_BROWSER_CLIENT must be an absolute path to a built lib/client.cjs file')
}

let source
try {
  source = await readFile(client)
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  throw new Error(`Missing built collaboration browser client at ${client}. Wait for the approved current build, then run this check. (${detail})`)
}

await mkdir(join(output, 'screens'), { recursive: true })
await build({
  entryPoints: [join(fixture, 'fixture.ts')],
  absWorkingDir: root,
  outfile: join(output, 'collaboration-fixture.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
})
await copyFile(client, join(output, 'client.cjs'))
await copyFile(join(fixture, 'index.html'), join(output, 'index.html'))

let chromium
try {
  ({ chromium } = await import(pathToFileURL(playwrightCore).href))
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error)
  throw new Error(`The approved local Playwright core was unavailable at ${playwrightCore}; no browser download was attempted. (${detail})`)
}

const browser = await chromium.launch({ executablePath: chrome, headless: true })
const consoleErrors = []
const pageErrors = []

async function runPage({ name, query, width, screenshot, interact }) {
  const context = await browser.newContext({ viewport: { width, height: viewportHeight }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const localConsoleErrors = []
  const localPageErrors = []
  page.on('console', message => {
    if (message.type() !== 'error') return
    const value = `[${name}] ${message.text()}`
    localConsoleErrors.push(value)
    consoleErrors.push(value)
  })
  page.on('pageerror', error => {
    const value = `[${name}] ${error.message}`
    localPageErrors.push(value)
    pageErrors.push(value)
  })
  try {
    const url = pathToFileURL(join(output, 'index.html'))
    url.search = query
    await page.goto(url.href, { waitUntil: 'load' })
    const needsAutomation = query.includes('automation=1')
    await page.waitForFunction(needsAutomation => {
      const state = document.documentElement.dataset.fixtureState
      const automation = document.documentElement.dataset.automation
      return state === 'failed' || automation === 'failed' || (needsAutomation ? automation === 'passed' : state === 'ready')
    }, needsAutomation, { timeout: 20_000 })
    const state = await page.evaluate(() => ({
      fixtureState: document.documentElement.dataset.fixtureState,
      automation: document.documentElement.dataset.automation,
      failure: document.body.dataset.fixtureError,
    }))
    assert(state.fixtureState !== 'failed' && state.automation !== 'failed', `${name} fixture failed: ${String(state.failure ?? 'unknown fixture error')}`)
    if (query.includes('automation=1')) assert(state.automation === 'passed', `${name} automation did not complete`)
    const interaction = interact === undefined ? undefined : await interact(page)
    const probe = await page.evaluate(() => {
      const fixture = window.__collaborationBrowserFixture
      return {
        evidence: fixture?.evidence(),
        layout: fixture?.auditLayout(),
        scroll: fixture?.auditScroll(),
      }
    })
    assert(probe.evidence !== undefined, `${name} did not expose fixture evidence`)
    assert(probe.layout !== undefined, `${name} did not expose a layout audit`)
    assert(probe.layout.bodyScrollWidth <= probe.layout.clientWidth, `${name} has document horizontal overflow: ${JSON.stringify(probe.layout)}`)
    assert(Array.isArray(probe.layout.offenders) && probe.layout.offenders.length === 0, `${name} has local horizontal overflow: ${JSON.stringify(probe.layout.offenders)}`)
    assert(localConsoleErrors.length === 0, `${name} browser console errors: ${JSON.stringify(localConsoleErrors)}`)
    assert(localPageErrors.length === 0, `${name} browser runtime errors: ${JSON.stringify(localPageErrors)}`)
    if (screenshot !== undefined) await page.screenshot({ path: screenshot, fullPage: false })
    return { state, probe, interaction, consoleErrors: localConsoleErrors, pageErrors: localPageErrors }
  } finally {
    await context.close()
  }
}

try {
  const automation = await runPage({
    name: 'interaction-1280-light',
    query: '?automation=1&theme=light',
    width: 1280,
  })
  assert(automation.probe.evidence.automation?.passed === true, 'fixture did not report all interaction assertions as passed')
  assert(automation.probe.evidence.builtExport?.name === 'CollaborationEntry', 'fixture did not use the built CollaborationEntry export')
  assert(automation.probe.evidence.documentView?.actualRenderer === false, 'fixture must remain a synthetic DocumentView contract probe')
  assert(automation.probe.evidence.documentView?.valueRawEqual === true, 'fixture did not prove exact DocumentView value/raw preservation')
  assert(automation.probe.evidence.openCalls?.modelSubmissions === 0, 'an open-child action attempted model submission')

  const nativePopover = await runPage({
    name: 'native-popover-1280-light',
    query: '?scenario=completed&theme=light',
    width: 1280,
    interact: async page => {
      const trigger = page.locator('.iexp-collab-trigger')
      await trigger.focus()
      await trigger.click()
      await page.locator('.iexp-collab-panel').waitFor({ state: 'visible' })
      const topLayer = await page.evaluate(() => {
        const panel = document.querySelector('.iexp-collab-panel')
        const floating = document.querySelector('#fixture-floating-control')
        if (!(panel instanceof HTMLElement) || !(floating instanceof HTMLElement)) return { overlap: false, panelTopLayer: false }
        const a = panel.getBoundingClientRect(), b = floating.getBoundingClientRect()
        const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right), top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom)
        if (right <= left || bottom <= top) return { overlap: false, panelTopLayer: false }
        const point = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        return { overlap: true, panelTopLayer: point !== null && panel.contains(point), popoverOpen: panel.matches(':popover-open') }
      })
      await page.locator('#iexp-collab-subtasks-tab').focus()
      await page.keyboard.press('ArrowLeft')
      const tabFocus = await page.evaluate(() => ({
        teamSelected: document.querySelector('#iexp-collab-team-tab')?.getAttribute('aria-selected'),
        activeId: document.activeElement?.id,
      }))
      await page.locator('.iexp-collab-close').click()
      await page.waitForFunction(() => document.querySelector('.iexp-collab-panel') === null)
      const closeFocus = await page.evaluate(() => document.activeElement?.classList.contains('iexp-collab-trigger') === true)
      await trigger.click()
      await page.locator('.iexp-collab-panel').waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('.iexp-collab-panel') === null)
      const escapeFocus = await page.evaluate(() => document.activeElement?.classList.contains('iexp-collab-trigger') === true)
      await trigger.click()
      await page.locator('.iexp-collab-panel').waitFor({ state: 'visible' })
      const outsidePoint = await page.evaluate(() => {
        const outside = document.querySelector('#fixture-outside')
        const panel = document.querySelector('.iexp-collab-panel')
        if (!(outside instanceof HTMLElement) || !(panel instanceof HTMLElement)) return undefined
        const r = outside.getBoundingClientRect(), point = { x: r.left + 20, y: r.top + 20 }
        return { ...point, outsideTarget: outside.contains(document.elementFromPoint(point.x, point.y)), panelTarget: panel.contains(document.elementFromPoint(point.x, point.y)) }
      })
      assert(outsidePoint?.outsideTarget === true && outsidePoint.panelTarget === false, `fixture did not expose an actual pointer-outside point: ${JSON.stringify(outsidePoint)}`)
      await page.mouse.click(outsidePoint.x, outsidePoint.y)
      await page.waitForFunction(() => document.querySelector('.iexp-collab-panel') === null)
      return { topLayer, tabFocus, closeFocus, escapeFocus, outsideClosed: true }
    },
  })
  assert(nativePopover.interaction?.topLayer?.overlap === true && nativePopover.interaction.topLayer.panelTopLayer === true && nativePopover.interaction.topLayer.popoverOpen === true, `native popover was obscured by the floating fixture control: ${JSON.stringify(nativePopover.interaction?.topLayer)}`)
  assert(nativePopover.interaction?.tabFocus?.teamSelected === 'true' && nativePopover.interaction.tabFocus.activeId === 'iexp-collab-team-tab', `native tab keyboard focus failed: ${JSON.stringify(nativePopover.interaction?.tabFocus)}`)
  assert(nativePopover.interaction?.closeFocus === true && nativePopover.interaction.escapeFocus === true && nativePopover.interaction.outsideClosed === true, `native close/focus behavior failed: ${JSON.stringify(nativePopover.interaction)}`)

  const screenCases = [
    { name: 'running-1280-light', query: '?scenario=running&theme=light&open=1', width: 1280 },
    { name: 'completed-800-dark', query: '?scenario=completed&theme=dark&open=1', width: 800 },
    // Component-level geometry only; this does not claim full DSH Desktop support at 390px.
    { name: 'completed-390-light-component', query: '?scenario=completed&theme=light&open=1', width: 390 },
    { name: 'long-800-dark', query: '?scenario=long&theme=dark&open=1', width: 800 },
  ]
  const screenshots = []
  for (const item of screenCases) {
    const path = join(output, 'screens', `${item.name}.png`)
    const result = await runPage({ ...item, screenshot: path })
    const evidence = result.probe.evidence
    assert(evidence.panel?.popoverOpen === true, `${item.name} did not leave the native popover open for its screenshot`)
    assert(evidence.panel?.opaqueSurface === true, `${item.name} panel surface was not opaque against the active theme`)
    if (item.name === 'long-800-dark') assert(result.probe.scroll?.independent === true, 'long output did not have a panel-local vertical scroll surface')
    screenshots.push({ name: item.name, query: item.query, viewport: { width: item.width, height: viewportHeight }, path, panel: evidence.panel, layout: result.probe.layout, scroll: result.probe.scroll })
  }

  const evidence = {
    scope: 'synthetic Chrome fixture loading the current built lib/client.cjs factory and its CollaborationEntry export; no DSH app, profile, provider, or model call',
    client: { path: client, sha256: createHash('sha256').update(source).digest('hex') },
    output,
    evidencePath: join(output, 'evidence.json'),
    Chrome: chrome,
    browser: 'Playwright core with the locally installed Google Chrome executable; no browser download',
    interaction: automation.probe,
    nativePopover: nativePopover.interaction,
    screenshots,
    consoleErrors,
    pageErrors,
    limits: [
      'DocumentView is an explicit synthetic contract stub that verifies only value/raw props; installed Markdown rendering is outside this fixture.',
      'The 390px screenshot is a component-layout probe, not a DSH Desktop product-support claim.',
      'Actual installed-app acceptance remains a separate parent-owned evidence surface.',
    ],
  }
  await writeFile(evidence.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} finally {
  await browser.close()
}
