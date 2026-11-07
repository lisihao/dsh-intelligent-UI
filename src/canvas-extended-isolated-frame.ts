/** The opaque document used only for the pinned Canvas UI Liquid factory. */
export const CANVAS_EXTENDED_LIQUID_FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

/**
 * The parent sends an integrity-checked fixed module, bounded JSON options and
 * ImageBitmap pixels. It never sends source HTML, model JavaScript or a URL.
 * Liquid's upstream window listeners are therefore scoped to this opaque frame.
 */
export function canvasExtendedLiquidFrameDocument(nonce: string): string {
  if (!/^[0-9a-f]{32}$/u.test(nonce)) throw new Error('CANVAS_EXTENDED_LIQUID_NONCE')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CANVAS_EXTENDED_LIQUID_FRAME_CSP}"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
.source{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none}.content{position:relative;display:block;width:100%;height:100%;overflow:hidden;pointer-events:none}.output{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none}
</style></head><body><canvas class="source"><div class="content"></div></canvas><canvas class="output"></canvas><script>
(() => {
  let started = false;
  const channel = new MessageChannel();
  const port = channel.port1;
  const pixelStats = pixels => {
    let alpha = 0, nonTransparent = 0, nonWhite = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const a = pixels[index + 3];
      alpha += a;
      if (a) nonTransparent++;
      if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonWhite++;
    }
    return { pixels: pixels.length / 4, alpha, nonTransparent, nonWhite };
  };
  const json = value => {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 1024;
    if (Array.isArray(value)) return value.length <= 32 && value.every(json);
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const entries = Object.entries(value);
    return entries.length <= 64 && entries.every(([key, item]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) && !['__proto__','constructor','prototype','src','dracoDecoderPath'].includes(key) && !key.startsWith('on') && json(item));
  };
  async function start(event) {
    if (started || event.data?.type !== 'canvas-extended-liquid-start') return;
    const data = event.data;
    if (data.factory !== 'createLiquid' || typeof data.module !== 'string' || data.module.length > 8388608 || !json(data.options) || (data.inspect !== undefined && typeof data.inspect !== 'boolean')) return;
    started = true;
    const source = document.querySelector('.source'), output = document.querySelector('.output'), content = document.querySelector('.content');
    const context = source.getContext('2d');
    let bitmap, instance, closed = false, lastRevision = 0, bitmapDraws = 0, animationFrames = 0, textureUploads = 0, contentTextureUploads = 0, drawCalls = 0, displayOutput;
    const send = value => { if (!closed) port.postMessage(value) };
    // The parent supplies a bitmap, not native DOM that Chrome may paint into a
    // canvas. Keep the upstream factory's html-in-canvas branch, but prevent
    // its optional experimental DOM capture attributes from replacing this
    // runner's real bitmap between reset and texture upload.
    const setSourceAttribute = source.setAttribute.bind(source);
    const setContentAttribute = content.setAttribute.bind(content);
    Object.defineProperty(source, 'setAttribute', { configurable: true, value: (name, value) => {
      if (name === 'content' || name === 'layoutsubtree') return;
      setSourceAttribute(name, value);
    } });
    Object.defineProperty(content, 'setAttribute', { configurable: true, value: (name, value) => {
      if (name === 'drawable') return;
      setContentAttribute(name, value);
    } });
    // Chromium's experimental reset path schedules native HTML capture even
    // after the attributes above are suppressed. The fixed bitmap source needs
    // the ordinary 2D reset semantics that the factory expects instead.
    Object.defineProperty(context, 'reset', { configurable: true, value: () => {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, source.width, source.height);
    } });
    if (data.inspect) {
      const schedule = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => schedule(time => { animationFrames++; callback(time); });
      const outputContext = output.getContext.bind(output);
      Object.defineProperty(output, 'getContext', { configurable: true, value: (kind, ...args) => {
        const result = outputContext(kind, ...args);
        if (kind !== 'webgl2' || !result || result.__canvasExtendedTrace) return result;
        try {
          Object.defineProperty(result, '__canvasExtendedTrace', { configurable: true, value: true });
          const upload = result.texImage2D.bind(result), draw = result.drawArrays.bind(result);
          Object.defineProperty(result, 'texImage2D', { configurable: true, value: (...uploadArgs) => { textureUploads++; if (uploadArgs.at(-1) === source) contentTextureUploads++; return upload(...uploadArgs); } });
          Object.defineProperty(result, 'drawArrays', { configurable: true, value: (...drawArgs) => {
            drawCalls++;
            const value = draw(...drawArgs);
            if (result.getParameter(result.FRAMEBUFFER_BINDING) === null) {
              const pixels = new Uint8Array(output.width * output.height * 4);
              result.readPixels(0, 0, output.width, output.height, result.RGBA, result.UNSIGNED_BYTE, pixels);
              displayOutput = pixelStats(pixels);
            }
            return value;
          } });
        } catch { /* Metrics stay zero when the implementation forbids method wrapping. */ }
        return result;
      } });
    }
    const inspectFrame = () => {
      let reported = false;
      const report = () => {
        if (reported) return;
        reported = true;
        if (closed || lastRevision < 1) return;
        try {
          const gl = output.getContext('webgl2');
          if (!gl) throw new Error('CANVAS_EXTENDED_LIQUID_WEBGL');
          const outputPixels = new Uint8Array(output.width * output.height * 4);
          gl.readPixels(0, 0, output.width, output.height, gl.RGBA, gl.UNSIGNED_BYTE, outputPixels);
          const sourcePixels = context.getImageData(0, 0, source.width, source.height).data;
          send({ type: 'frame', revision: lastRevision, source: pixelStats(sourcePixels), output: pixelStats(outputPixels), displayOutput, bitmapDraws, animationFrames, textureUploads, contentTextureUploads, drawCalls, hidden: document.hidden, sourceViewport: [source.clientWidth, source.clientHeight], outputViewport: [output.clientWidth, output.clientHeight], glError: gl.getError() });
        } catch (error) { send({ type: 'frame-error', revision: lastRevision, error: String(error) }); }
      };
      requestAnimationFrame(() => requestAnimationFrame(report));
      setTimeout(report, 250);
    };
    try {
      if (!context) throw new Error('CANVAS_EXTENDED_LIQUID_CONTEXT');
      Object.defineProperty(context, 'drawElementImage', { configurable: true, value: (_element, x, y) => { if (bitmap) { bitmapDraws++; context.drawImage(bitmap, x, y, source.width, source.height) } } });
      Object.defineProperty(source, 'requestPaint', { configurable: true, value: () => send({ type: 'paint' }) });
      const moduleUrl = URL.createObjectURL(new Blob([data.module], { type: 'text/javascript' }));
      let module;
      try { module = await import(moduleUrl) } finally { URL.revokeObjectURL(moduleUrl) }
      if (typeof module.createLiquid !== 'function') throw new Error('CANVAS_EXTENDED_LIQUID_EXPORT');
      instance = module.createLiquid({ source, content, output }, data.options);
      if (!instance) throw new Error('CANVAS_EXTENDED_LIQUID_UNAVAILABLE');
      port.onmessage = message => {
        const value = message.data;
        if (value?.type === 'bitmap' && value.bitmap instanceof ImageBitmap && Number.isSafeInteger(value.revision)) {
          if (value.revision <= lastRevision) { value.bitmap.close(); return }
          lastRevision = value.revision;
          bitmap?.close(); bitmap = value.bitmap;
          source.width = bitmap.width; source.height = bitmap.height;
          source.onpaint?.();
          send({ type: 'drawn', revision: lastRevision });
        } else if (value?.type === 'inspect') {
          inspectFrame();
        } else if (value?.type === 'resize') {
          instance.resize?.();
          send({ type: 'resized' });
        } else if (value?.type === 'options' && json(value.options)) {
          instance.setOptions?.(value.options);
          send({ type: 'updated' });
        } else if (value?.type === 'destroy') {
          try { instance.destroy(); bitmap?.close(); delete source.setAttribute; delete content.setAttribute; delete context.reset; delete output.getContext } finally { send({ type: 'destroyed' }); closed = true; port.close() }
        }
      };
      send({ type: 'mounted' });
      send({ type: 'ready' });
    } catch (error) { send({ type: 'error', error: String(error) }) }
  }
  port.onmessage = start;
  parent.postMessage({ type: 'canvas-extended-liquid-bootstrap', nonce: '${nonce}' }, '*', [channel.port2]);
})();
</script></body></html>`
}
