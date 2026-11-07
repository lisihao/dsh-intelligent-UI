import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

import { openuiCssPlugin } from '../../build-css.mjs'
import { dilReferencePlugin } from '../dil-reference.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const acceptanceDirectory = resolve(root, '.acceptance/dil-browser-20261106')

/** The parent document deliberately cannot evaluate generated source. */
export const DIL_BROWSER_PARENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src http://127.0.0.1:*',
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

const initialSource = `{@body const [seats,setSeats] = DIL.useState(3,{key:"seats"})}
{@body const [coverage,setCoverage] = DIL.useState(false,{key:"coverage"})}
{@body const [tier,setTier] = DIL.useState("standard",{key:"tier"})}
{@body const rate = tier === "pro" ? 500 : 200}
{@body const quote = (nextSeats,nextCoverage,nextTier) => nextSeats * (nextTier === "pro" ? 500 : 200) + (nextCoverage ? 75 : 0)}
{@body const monthly = quote(seats,coverage,tier)}
{@body const chartRows = [{label:"基础金额",value:seats * rate},{label:"保障费",value:coverage ? 75 : 0}]}
<form action="confirm">
  <card gap={3}>
    <title>本地报价条件</title>
    <label>席位数 <slider name="seats" min={1} max={10} step={1} value={seats} onChange={setSeats}/></label>
    <checkbox name="coverage" checked={coverage} onChange={setCoverage}>增加保障</checkbox>
    <label>方案 <select name="tier" value={tier} options={[{label:"标准",value:"standard"},{label:"专业",value:"pro"}]} onChange={setTier}/></label>
    <text>月度金额：¥{monthly}</text>
    <chart data={chartRows} categoryKey="label" dataKey="value" height={180} title="当前构成"/>
    <button type="submit">显式提交当前条件</button>
  </card>
</form>`

const updatedSource = initialSource
  .replace('本地报价条件</title>', '本地报价条件（已更新）</title>')
  .replace('title="当前构成"', 'title="更新后的当前构成"')

const invalidSource = '<not-supported>这个错误源必须保留为可读回退。</not-supported>'
const timeoutSource = '{@body while(true){}}\n<text>这个文本不应从无限循环 Worker 返回。</text>'

function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }

async function buildHostRuntime(runtimeDirectory) {
  await build({
    absWorkingDir: root,
    entryPoints: { host: 'tools/browser-dil/host-entry.ts' },
    outdir: runtimeDirectory,
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    plugins: [dilReferencePlugin({ compiler: true })],
  })
  return import(pathToFileURL(join(runtimeDirectory, 'host.js')).href)
}

async function buildBrowserFixture(runtimeDirectory) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['tools/browser-dil/fixture.ts'],
    outfile: join(runtimeDirectory, 'fixture.js'),
    bundle: true,
    write: false,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    loader: { '.css': 'text', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [openuiCssPlugin, dilReferencePlugin()],
  })
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
  if (!script) throw new Error('DIL_BROWSER_FIXTURE_BUNDLE_MISSING')
  return script
}

function compileProgram(compileDilSource, label, source) {
  const compiled = compileDilSource(source)
  if (!record(compiled) || typeof compiled.code !== 'string' || !compiled.code.includes('DIL.render')) {
    throw new Error(`DIL_BROWSER_COMPILE_OUTPUT_INVALID:${label}`)
  }
  return { label, source, compiled }
}

function html() {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DIL local browser acceptance</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': DIL_BROWSER_PARENT_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  response.end(JSON.stringify(value))
}

/**
 * Starts a loopback-only parent page. Its Host compilation and runner document
 * are real; the authored strings are fixed local examples, never model output.
 */
export async function startDilBrowserPreview() {
  await mkdir(acceptanceDirectory, { recursive: true })
  const runtimeDirectory = await mkdtemp(join(acceptanceDirectory, 'runtime-'))
  let frameServer
  let server
  try {
    const host = await buildHostRuntime(runtimeDirectory)
    const programs = {
      initial: compileProgram(host.compileDilSource, '初始本地程序', initialSource),
      updated: compileProgram(host.compileDilSource, '保持键控状态的更新程序', updatedSource),
      invalid: compileProgram(host.compileDilSource, '错误源回退程序', invalidSource),
      timeout: compileProgram(host.compileDilSource, 'Worker watchdog 边界程序', timeoutSource),
    }
    frameServer = await host.startDilFrameServer()
    const browserScript = await buildBrowserFixture(runtimeDirectory)
    const evidence = { modelCalls: 0, requestCounts: Object.create(null) }
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      evidence.requestCounts[path] = (evidence.requestCounts[path] ?? 0) + 1
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return }
      if (path === '/' || path === '/index.html') {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': DIL_BROWSER_PARENT_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        })
        response.end(html())
        return
      }
      if (path === '/fixture.js') {
        response.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': DIL_BROWSER_PARENT_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        })
        response.end(browserScript)
        return
      }
      if (path === '/api/config') {
        writeJson(response, 200, { frameUrl: frameServer.frameUrl, programs })
        return
      }
      if (path === '/api/evidence') {
        writeJson(response, 200, { modelCalls: evidence.modelCalls, requestCounts: evidence.requestCounts })
        return
      }
      if (path === '/api/model') {
        evidence.modelCalls += 1
        writeJson(response, 403, { error: 'DIL_BROWSER_MODEL_ROUTE_FORBIDDEN' })
        return
      }
      response.writeHead(404, { 'Content-Security-Policy': DIL_BROWSER_PARENT_CSP })
      response.end()
    })
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('DIL_BROWSER_PREVIEW_ADDRESS_UNAVAILABLE')
    const origin = `http://127.0.0.1:${String(address.port)}`
    let closed = false
    return {
      origin,
      frameUrl: frameServer.frameUrl,
      parentCsp: DIL_BROWSER_PARENT_CSP,
      programs,
      acceptanceDirectory,
      async close() {
        if (closed) return
        closed = true
        server.closeAllConnections?.()
        await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
        await frameServer.close()
        await rm(runtimeDirectory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    if (server) server.closeAllConnections?.()
    if (server) await new Promise(resolveClose => server.close(() => resolveClose()))
    if (frameServer) await frameServer.close().catch(() => undefined)
    await rm(runtimeDirectory, { recursive: true, force: true })
    throw error
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const preview = await startDilBrowserPreview()
  process.stdout.write(`DIL_BROWSER_PREVIEW_URL=${preview.origin}\n`)
  process.stdout.write('DIL_BROWSER_PREVIEW_SYNTHETIC=true externalModelCalls=0\n')
  const stop = async () => { await preview.close(); process.exit(0) }
  process.once('SIGINT', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
}
