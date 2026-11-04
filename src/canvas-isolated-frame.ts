/** Fixed, plugin-owned document for effects that mutate document-global CSS. */
export const CANVAS_ISOLATED_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

/**
 * This document receives only a fixed-catalog module and an ImageBitmap. It
 * never receives source HTML or executable code from model output or a theme.
 * The client creates this fixed document locally, never from a network route.
 * The embedding page's CSP must allow blob frames and the bootstrap script.
 * The sandbox cannot prevent a script from navigating its own frame, so it
 * relies on the host's fixed, integrity-checked upstream module as trusted
 * code; it is not a sandbox for arbitrary third-party or user scripts.
 */
export function canvasIsolatedFrameDocument(nonce: string): string {
  if (!/^[0-9a-f]{32}$/u.test(nonce)) throw new Error('CANVAS_ISOLATED_NONCE')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CANVAS_ISOLATED_FRAME_CSP}"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
.source{position:absolute;width:100%;height:100%;visibility:hidden}
.output,.content{position:absolute;inset:0;width:100%;height:100%}
.output{pointer-events:none}.content{background:transparent;opacity:0}
</style></head><body><canvas class="source"></canvas><canvas class="output"></canvas><div class="content"></div><script>
(() => {
  let started = false;
  const channel = new MessageChannel();
  const port = channel.port1;
  async function start(event) {
    if (started || event.data?.type !== 'canvas-isolated-start') return;
    const data = event.data;
    if (!['createBend','createHexFloat'].includes(data.factory) || typeof data.module !== 'string' || data.module.length > 8388608) return;
    started = true;
    const source = document.querySelector('.source'), output = document.querySelector('.output'), content = document.querySelector('.content');
    const context = source.getContext('2d');
    let bitmap, instance, closed = false, lastRevision = 0;
    const send = value => { if (!closed) port.postMessage(value) };
    try {
      if (!context) throw new Error('CANVAS_ISOLATED_CONTEXT');
      if (typeof data.background === 'string' && CSS.supports('background-color', data.background)) content.style.backgroundColor = data.background;
      Object.defineProperty(context, 'drawElementImage', { configurable: true, value: (_element, x, y) => { if (bitmap) context.drawImage(bitmap, x, y, source.width, source.height) } });
      Object.defineProperty(source, 'requestPaint', { configurable: true, value: () => send({ type: 'paint' }) });
      const moduleUrl = URL.createObjectURL(new Blob([data.module], { type: 'text/javascript' }));
      let module;
      try { module = await import(moduleUrl) } finally { URL.revokeObjectURL(moduleUrl) }
      if (typeof module[data.factory] !== 'function') throw new Error('CANVAS_ISOLATED_EXPORT');
      instance = module[data.factory]({ source, content, output }, {});
      if (!instance) throw new Error('CANVAS_ISOLATED_UNAVAILABLE');
      port.onmessage = message => {
        const value = message.data;
        if (value?.type === 'bitmap' && value.bitmap instanceof ImageBitmap && Number.isSafeInteger(value.revision)) {
          if (value.revision <= lastRevision) { value.bitmap.close(); return }
          lastRevision = value.revision;
          bitmap?.close(); bitmap = value.bitmap;
          source.onpaint?.();
          send({ type: 'drawn' });
        } else if (value?.type === 'destroy') {
          try { instance.destroy(); bitmap?.close() } finally { send({ type: 'destroyed' }); closed = true; port.close() }
        }
      };
      send({ type: 'ready' });
    } catch (error) { send({ type: 'error', error: String(error) }) }
  }
  port.onmessage = start;
  parent.postMessage({ type: 'canvas-isolated-bootstrap', nonce: '${nonce}' }, '*', [channel.port2]);
})();
</script></body></html>`
}
