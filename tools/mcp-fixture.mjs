import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { build } from 'esbuild'
import { z } from 'zod'

/** Keyless reference fixture; this is test infrastructure, not a production server. */
export async function startMcpFixture() {
  const bundle = await build({ stdin: { contents: `
import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({name:'Fixture view',version:'1.0.0'},{});
app.ontoolinput = p => document.querySelector('#input').textContent=JSON.stringify(p.arguments);
app.ontoolresult = p => document.querySelector('#result').textContent=JSON.stringify(p.content);
app.onteardown = async () => { document.querySelector('#state').textContent='closed'; return {}; };
document.querySelector('button').onclick=async()=>{try{const r=await app.callServerTool({name:'fixture_increment',arguments:{value:2}});document.querySelector('#action').textContent=JSON.stringify(r.content)}catch(e){document.querySelector('#action').textContent=String(e)}};
app.connect().catch(e=>document.querySelector('#state').textContent=String(e));
`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const html = `<!doctype html><meta charset="utf-8"><p id="state">ready</p><p id="input"></p><p id="result"></p><button>Increment</button><p id="action"></p><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'iexp-fixture', version: '1.0.0' })
    registerAppTool(server, 'fixture_open', { description: 'Open fixture', inputSchema: z.object({ value: z.number() }), _meta: { ui: { resourceUri: 'ui://fixture/view' } } }, async ({ value }) => ({ content: [{ type: 'text', text: `value=${value}` }] }))
    registerAppTool(server, 'fixture_increment', { description: 'Increment fixture', inputSchema: z.object({ value: z.number() }), _meta: { ui: { visibility: ['app'] } } }, async ({ value }) => ({ content: [{ type: 'text', text: String(value + 1) }] }))
    registerAppTool(server, 'fixture_model_only', { inputSchema: z.object({}), _meta: { ui: { visibility: ['model'] } } }, async () => ({ content: [{ type: 'text', text: 'model only' }] }))
    registerAppResource(server, 'view', 'ui://fixture/view', { mimeType: RESOURCE_MIME_TYPE }, async uri => ({ contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: html }] }))
    return server
  })
  const http = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
      const response = await handler.fetch(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) for await (const chunk of response.body) res.write(chunk)
      res.end()
    } catch (error) { res.writeHead(500).end(String(error)) }
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${http.address().port}/mcp`, close: () => new Promise((resolve, reject) => http.close(e => e ? reject(e) : resolve())) }
}
