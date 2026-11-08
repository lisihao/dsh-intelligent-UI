import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
const { Browser, sleep } = await import(pathToFileURL(resolve(process.env.INTELLIGENT_UI_CDP_MODULE ?? join(homedir(), '.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs'))).href)
import { buildRuntimeBrowserFixture } from './build.mjs'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const output = resolve(option('--output') ?? join('/private/tmp', `uiverse-runtime-browser-${Date.now()}`))
const ids = option('--ids')?.split(',').map(value => value.trim()).filter(Boolean)
const keepMounted = args.includes('--keep-mounted')
const maxFocusedIds = 32
const cssUpdateControlId = 'Buttons/JkHuger_brown-lion-61'
const viewports = (option('--viewports') ?? '390x844').split(',').map(value => {
  const match = /^(\d{2,4})x(\d{2,4})$/u.exec(value.trim())
  if (!match) throw new Error('UIVERSE_RUNTIME_BROWSER_VIEWPORT_INVALID')
  return { width: Number(match[1]), height: Number(match[2]) }
})
if (keepMounted && (!ids?.length || ids.length > maxFocusedIds)) throw new Error('UIVERSE_RUNTIME_BROWSER_FOCUSED_IDS_REQUIRED')
const fixture = await buildRuntimeBrowserFixture({ ...(ids === undefined ? {} : { componentIds: ids }), keepMounted })
let server
let browser
try {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;max-width:100%;overflow-x:clip}#fixture{display:block;width:100%;max-width:100%;min-width:0;overflow:hidden}</style><main id="fixture"></main><script type="module" src="/fixture.js"></script>`
  server = createServer(async (request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(await readFile(join(fixture.directory, 'fixture.js')))
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(html)
    }
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('UIVERSE_RUNTIME_BROWSER_SERVER_UNAVAILABLE')
  const origin = `http://127.0.0.1:${address.port}`
  browser = await Browser.launch({ width: Math.max(...viewports.map(viewport => viewport.width)), height: Math.max(...viewports.map(viewport => viewport.height)) })
  const observations = []
  const persist = async () => {
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'receipt.json'), JSON.stringify({ browser: 'Chrome CDP', origin, keepMounted, ids: ids ?? null, observations, timestamp: new Date().toISOString() }, null, 2))
  }
  for (const viewport of viewports) {
    const page = await browser.newPage({ ...viewport, mobile: viewport.width <= 500 })
    const requests = []
    await page.send('Network.enable')
    const unsubscribe = browser.on(page.sessionId, 'Network.requestWillBeSent', request => requests.push(request.request?.url))
    await page.goto(origin, { settleMs: 100 })
    let result
    for (let attempt = 0; attempt < 180; attempt++) {
      result = await page.eval(() => window.__uiverseRuntimeBrowserResult)
      if (result) break
      await sleep(500)
    }
    unsubscribe()
    const external = requests.filter(url => {
      try { const parsed = new URL(url); return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== origin }
      catch { return false }
    })
    observations.push({ viewport, result, requests, external })
    // Write evidence before each assertion. A timeout or a single bad source
    // never erases the screenshot or prior viewport receipt.
    await persist()
    await page.screenshot({ path: join(output, `runtime-${String(viewport.width)}.png`), format: 'png', fullPage: keepMounted })
    const expected = ids?.length ?? 3802
    assert.ok(result, 'UIVERSE_RUNTIME_BROWSER_RESULT_TIMEOUT')
    assert.equal(result.expected, expected)
    assert.equal(result.mounted, expected, JSON.stringify(result.failures.slice(0, 20)))
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.escapedHosts, [])
    assert.deepEqual(result.forbiddenNodes, [])
    if (!keepMounted) {
      assert.equal(result.styledRepresentative?.mounted, true)
      assert.equal(result.styledRepresentative?.escaped, false)
    } else {
      assert.equal(result.details.length, expected)
      for (const detail of result.details) {
        assert.ok(detail.visibleBoundText.length || detail.svgText.length || detail.inputValues.length || detail.cssBindings.some(binding => binding.applied) || detail.htmlAttributeBindings.some(binding => binding.applied), `UIVERSE_RUNTIME_FOCUSED_VISIBLE_BINDING_MISSING:${detail.id}`)
        assert.ok(detail.cssBindings.every(binding => binding.applied), `UIVERSE_RUNTIME_FOCUSED_CSS_BINDING_MISSING:${detail.id}`)
        assert.ok(detail.htmlAttributeBindings.every(binding => binding.applied && binding.sourceValueReplaced), `UIVERSE_RUNTIME_FOCUSED_HTML_ATTRIBUTE_BINDING_MISSING:${detail.id}`)
        assert.ok(detail.fieldUpdateBindings.every(binding => binding.applied), `UIVERSE_RUNTIME_FOCUSED_FIELD_BINDING_MISSING:${detail.id}`)
      }
      const cssControl = result.details.find(detail => detail.id === cssUpdateControlId)
      if (cssControl) {
        assert.equal(cssControl.dynamicCssUpdateCount, 2, 'UIVERSE_RUNTIME_FOCUSED_CSS_UPDATE_NOT_RUN')
        assert.ok(cssControl.cssBindings.length > 0 && cssControl.cssBindings.every(binding => binding.applied), 'UIVERSE_RUNTIME_FOCUSED_CSS_UPDATE_NOT_APPLIED')
        assert.equal(cssControl.dynamicFieldUpdate, true, 'UIVERSE_RUNTIME_FOCUSED_FIELD_UPDATE_NOT_RUN')
        assert.ok(cssControl.fieldUpdateBindings.length > 0 && cssControl.fieldUpdateBindings.every(binding => binding.applied), 'UIVERSE_RUNTIME_FOCUSED_FIELD_UPDATE_NOT_APPLIED')
      }
    }
    assert.deepEqual(external, [], `UIVERSE_RUNTIME_EXTERNAL_REQUESTS:${external.join(',')}`)
    await page.close()
  }
  process.stdout.write(JSON.stringify({ output, observations }) + '\n')
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolveClose => server.close(resolveClose))
  await fixture.dispose()
}
