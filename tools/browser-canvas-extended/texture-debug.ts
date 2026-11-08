import { createContext, destroyContext, domToCanvas } from 'modern-screenshot'
import { createCanvasHtmlTextureBridge } from '../../src/canvas-html-texture.js'

type PixelStats = Readonly<{ pixels: number, alpha: number, nonTransparent: number, nonWhite: number }>

declare global {
  interface Window { __canvasExtendedTextureDebug?: Readonly<Record<string, PixelStats>> }
}

function stats(canvas: HTMLCanvasElement): PixelStats {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let alpha = 0, nonTransparent = 0, nonWhite = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index + 3]!
    alpha += value
    if (value) nonTransparent++
    if (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255) nonWhite++
  }
  return Object.freeze({ pixels: pixels.length / 4, alpha, nonTransparent, nonWhite })
}

function source(doc: Document): HTMLElement {
  const element = doc.createElement('section')
  element.style.cssText = 'box-sizing:border-box;width:604px;height:218px;padding:18px;background:#17202b;color:#e6edf3;border:1px solid #47556a;border-radius:12px;font:16px/1.45 ui-sans-serif,system-ui,sans-serif'
  element.innerHTML = '<h2 style="margin:0 0 12px;font-size:16px">Retained source</h2><p style="margin:8px 0">Fixed local source content.</p><p style="margin:8px 0">42 · immutable fixture datum</p>'
  return element
}

async function capture(element: HTMLElement): Promise<PixelStats> {
  const context = await createContext(element, { width: 604, height: 218, scale: 1, maximumCanvasSize: 2048, font: false, timeout: 3_000, fetch: { placeholderImage: '' }, fetchFn: async () => { throw new Error('No external fetch') }, workerNumber: 0 })
  try { return stats(await domToCanvas(context)) } finally { destroyContext(context) }
}

async function run(): Promise<void> {
  const direct = source(document)
  document.body.append(direct)
  const directResult = await capture(direct)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.srcdoc = '<!doctype html><body></body>'
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:604px;height:218px;border:0;opacity:0;pointer-events:none'
  document.body.append(iframe)
  await new Promise<void>((resolve, reject) => { iframe.onload = () => resolve(); iframe.onerror = () => reject(new Error('DEBUG_FRAME')) })
  const nested = source(iframe.contentDocument!)
  iframe.contentDocument!.body.append(nested)
  const nestedResult = await capture(nested)

  const bridgeCanvas = document.createElement('canvas')
  document.body.append(bridgeCanvas)
  const bridge = createCanvasHtmlTextureBridge({ source: bridgeCanvas, content: direct, scope: 'visual-only', sourceRemainsVisible: true, onError: error => { throw error } })
  let bridgeResult: PixelStats | undefined
  bridgeCanvas.onpaint = () => { bridgeResult = stats(bridgeCanvas) }
  await bridge.refresh()
  bridge.dispose()

  window.__canvasExtendedTextureDebug = Object.freeze({ direct: directResult, nested: nestedResult, bridge: bridgeResult! })
  document.documentElement.dataset.textureDebugReady = 'true'
}

void run().catch(error => {
  document.documentElement.dataset.textureDebugReady = 'failed'
  document.body.append(Object.assign(document.createElement('pre'), { textContent: String(error instanceof Error ? error.stack ?? error.message : error) }))
})
