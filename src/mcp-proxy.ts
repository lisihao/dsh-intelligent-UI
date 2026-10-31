import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'

/** Ephemeral, loopback-only proxy. A resource requesting network or device access
 * is rejected until a policy capable of granting its declared origins exists. */
export async function createMcpSandboxProxy(hostOrigin: string): Promise<{ url: string, close: () => Promise<void> }> {
  const host = new URL(hostOrigin)
  // Electron registers this exact scheme as standard and secure. Node's WHATWG
  // URL parser returns an opaque `null` origin for custom schemes, so compare
  // the single supported Desktop origin literally rather than broadening it.
  if (hostOrigin !== 'dsh-app://app' && (!['http:', 'https:'].includes(host.protocol) || host.origin !== hostOrigin)) throw new Error('MCP Apps needs an exact supported host origin')
  const token = randomBytes(24).toString('hex')
  const jsHost = JSON.stringify(hostOrigin).replaceAll('<', '\\u003c')
  const html = `<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" title="MCP application"></iframe><script>
const expected=${jsHost};const frame=document.querySelector('iframe');let loaded=false;
addEventListener('message',e=>{
 if(e.source===parent&&e.origin===expected){
  if(e.data?.method==='ui/notifications/sandbox-resource-ready'){
   if(loaded||typeof e.data?.params?.html!=='string')return;loaded=true;frame.srcdoc=e.data.params.html;
  }else if(loaded) frame.contentWindow.postMessage(e.data,'*');
 } else if(e.source===frame.contentWindow&&e.origin==='null'&&loaded){parent.postMessage(e.data,expected)}
});
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},expected);
</script>`
  const server: Server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== `/${token}`) { res.writeHead(404).end(); return }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self'; frame-ancestors ${hostOrigin}; base-uri 'none'; form-action 'none'; connect-src 'none'`,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
    }).end(html)
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Proxy failed to bind') }
  const url = `http://127.0.0.1:${address.port}/${token}`
  if (new URL(url).origin === hostOrigin) { server.close(); throw new Error('MCP Apps sandbox must use a different origin') }
  return { url, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}
