import { createServer } from 'node:http'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
import { startMcpFixture } from './mcp-fixture.mjs'

const load = async entry => {
  const out = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' })
  // Resolve external packages relative to this plugin rather than a data URL.
  const file = new URL(`./mcp-fixture-${entry.includes('proxy') ? 'proxy' : 'connector'}-compiled.mjs`, import.meta.url)
  const { writeFile } = await import('node:fs/promises'); await writeFile(file, out.outputFiles[0].text)
  const loaded = await import(file.href); await (await import('node:fs/promises')).unlink(file); return loaded
}
const { McpAppsConnector } = await load('src/mcp-connector.ts')
const { createMcpSandboxProxy } = await load('src/mcp-proxy.ts')
const fixture = await startMcpFixture()
const connector = new McpAppsConnector(); await connector.connect(fixture.url)
const execute = (_name, _args, run) => run()
const resource = await connector.resource('fixture_open')
const result = await connector.callModel('fixture_open', { value: 7 }, execute)
const browserBundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {McpAppView} from './src/mcp-view.ts';
const callTool=async(name,args)=>{const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args})});if(!response.ok)throw Error(await response.text());return response.json()};
const data=await (await fetch('/config')).json();const root=createRoot(document.getElementById('root'));root.render(React.createElement(McpAppView,{...data,callTool,onError:e=>{document.querySelector('#error').textContent=e.message},onTeardown:ok=>{document.querySelector('#teardown').textContent=String(ok)}})); document.querySelector('#close').onclick=()=>root.unmount();`, resolveDir: root, loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm' })
let proxy
const host = createServer(async (req,res) => {
  if (req.url === '/config') return res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({ proxyUrl:proxy.url, html:resource.content.text, input:{value:7}, result }))
  if (req.url === '/call' && req.method === 'POST') { try { const chunks=[]; for await(const c of req)chunks.push(c);const {name,args}=JSON.parse(Buffer.concat(chunks).toString());const value=await connector.callFromView(name,args,execute);return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(value)) } catch(e){return res.writeHead(403).end(String(e))} }
  if(req.url==='/bundle.js')return res.writeHead(200,{'content-type':'text/javascript'}).end(browserBundle.outputFiles[0].text)
  res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><div id="error"></div><div id="teardown"></div><button id="close">Close</button><div id="root"></div><script type="module" src="/bundle.js"></script>')
})
await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve)})
const origin=`http://127.0.0.1:${host.address().port}`;proxy=await createMcpSandboxProxy(origin)
console.log(`FIXTURE_URL=${origin}`)
async function stop(){await proxy.close();await connector.close();await fixture.close();host.close()}
process.on('SIGTERM',()=>void stop()); process.on('SIGINT',()=>void stop())
