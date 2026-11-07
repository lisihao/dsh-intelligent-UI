import { createCanvasExtendedHtmlEffect, isCanvasExtendedHtmlEffectName } from '../../src/canvas-extended-adapter.js'
import { createCanvasExtendedLiquidEffect, type CanvasExtendedLiquidFrameMetrics, type CanvasExtendedLiquidTextureMetrics } from '../../src/canvas-extended-isolated-liquid.js'
import { createCanvasExtendedObjectEffect, isCanvasExtendedObjectEffectName } from '../../src/canvas-extended-object-adapter.js'

declare global {
  interface Window {
    __canvasExtendedEvidence?: unknown
    __canvasExtendedDispose?: () => void
    __canvasExtendedTrace?: string[]
  }
}

const root = document.querySelector('#root')
if (!(root instanceof HTMLElement)) throw new Error('CANVAS_EXTENDED_FIXTURE_ROOT')

const params = new URLSearchParams(location.search)
const requested = params.get('effect') ?? 'bubble'
const direct = ['ascii-sweep', 'bubble', 'cloth', 'droplets', 'flame-wrap', 'force-field', 'glass', 'glyph-rain', 'laser', 'peel', 'retro-dither'] as const
const all = [...direct, 'liquid', 'dithered-object', 'particle-object', 'liquid-object']

function factoryName(slug: string): string {
  return `create${slug === 'vhs' ? 'VHS' : slug.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')}`
}

async function factory(slug: string) {
  const module = await import(`/effects/${slug}.mjs`)
  const value = module[factoryName(slug)]
  if (typeof value !== 'function') throw new Error(`CANVAS_EXTENDED_FIXTURE_EXPORT:${slug}`)
  return value
}

type FactoryTracker = {
  readonly factory: (elements: Record<string, unknown>, options?: Record<string, unknown>) => unknown
  readonly snapshot: () => Readonly<{ calls: number, mounted: boolean, updates: number, resizes: number, destroys: number, elements: Record<string, unknown> | undefined }>
}

async function trackedFactory(slug: string): Promise<FactoryTracker> {
  const actual = await factory(slug)
  let calls = 0, mounted = false, updates = 0, resizes = 0, destroys = 0
  let elements: Record<string, unknown> | undefined
  return {
    factory(input, options) {
      calls++; elements = input
      const instance = actual(input, options)
      mounted = !!instance
      if (!instance || typeof instance !== 'object') return instance
      return new Proxy(instance as object, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            if (property === 'setOptions') updates++
            if (property === 'resize') resizes++
            if (property === 'destroy') destroys++
            return Reflect.apply(value, target, args)
          }
        },
      })
    },
    snapshot: () => Object.freeze({ calls, mounted, updates, resizes, destroys, elements }),
  }
}

function waitFor(check: () => boolean, timeout = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const tick = () => {
      if (check()) { resolve(); return }
      if (performance.now() - started >= timeout) { reject(new Error('CANVAS_EXTENDED_FIXTURE_TIMEOUT')); return }
      window.setTimeout(tick, 50)
    }
    tick()
  })
}

function source(label: string): HTMLElement {
  const section = document.createElement('section')
  section.className = 'source'
  section.innerHTML = `<h2>${label}</h2><p>Fixed local source content. It remains visible beside the GPU visual copy.</p><p>42 · immutable fixture datum</p>`
  return section
}

function layout(title: string, alternate = false) {
  root.replaceChildren()
  const heading = document.createElement('header')
  heading.innerHTML = `<h1>${title}</h1><p>Fixed local Canvas UI source. No model, external asset, or installed DSH profile is used.</p>`
  const grid = document.createElement('div')
  grid.className = alternate ? 'grid three' : 'grid'
  const primary = source('Retained source')
  const host = document.createElement('div')
  host.className = 'visual'
  grid.append(primary)
  let secondary: HTMLElement | undefined
  if (alternate) {
    secondary = source('Second retained source')
    grid.append(secondary)
  }
  grid.append(host)
  root.append(heading, grid)
  return { primary, secondary, host }
}

async function localImage(): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, 64, 64)
  gradient.addColorStop(0, '#0ad7ff'); gradient.addColorStop(1, '#f762ad')
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('CANVAS_EXTENDED_FIXTURE_PNG')), 'image/png'))
  return URL.createObjectURL(blob)
}

async function run() {
  if (!all.includes(requested as typeof all[number])) throw new Error(`CANVAS_EXTENDED_FIXTURE_EFFECT:${requested}`)
  const errors: string[] = []
  const recordError = (error: Error) => errors.push(error.message)
  let destroy: (() => void) | undefined
  let before = ''
  if (isCanvasExtendedHtmlEffectName(requested)) {
    const elements = layout(`Canvas ${requested}`, requested === 'ascii-sweep')
    before = elements.primary.textContent ?? ''
    if (requested === 'liquid') {
      const trace: string[] = []
      window.__canvasExtendedTrace = trace
      let frame: CanvasExtendedLiquidFrameMetrics | undefined
      let sourceBitmap: CanvasExtendedLiquidTextureMetrics | undefined
      const effect = await createCanvasExtendedLiquidEffect({ host: elements.host, content: elements.primary, onError: recordError, onFrame: metrics => { frame = metrics }, onSourceBitmap: metrics => { sourceBitmap = metrics }, onProtocol: event => { trace.push(event) } })
      await effect.refresh()
      await waitFor(() => effect.getSnapshot().mounted && effect.getSnapshot().bitmaps > 0)
      effect.setOptions({ density: 0.5 }); effect.resize()
      await waitFor(() => effect.getSnapshot().updates > 0 && effect.getSnapshot().resizes > 0)
      await waitFor(() => frame !== undefined || errors.length > 0)
      if (errors.length) throw new Error(errors.join('\n'))
      const evidence = {
        kind: 'html', requested, mounted: effect.getSnapshot().mounted,
        originalTextPreserved: elements.primary.textContent === before,
        originalVisible: elements.primary.getBoundingClientRect().width > 0,
        visualCanvasCount: elements.host.querySelectorAll('canvas,iframe').length,
        sourceCaptureCompleted: effect.getSnapshot().bitmaps > 0,
        sourceBitmap,
        visualFrame: frame,
        adapter: effect.getSnapshot(), errors, disposed: false,
      }
      destroy = () => { effect.destroy(); evidence.disposed = true }
      document.documentElement.dataset.fixtureReady = 'true'
      window.__canvasExtendedEvidence = evidence
      window.__canvasExtendedDispose = destroy
      return
    } else {
      const tracker = await trackedFactory(requested)
      const effect = await createCanvasExtendedHtmlEffect({
        component: requested,
        host: elements.host,
        content: elements.primary,
        ...(requested === 'ascii-sweep' ? { alternateContent: elements.secondary! } : {}),
        factory: tracker.factory,
        scope: 'visual-only',
        sourceRemainsVisible: true,
        pointer: true,
        onError: recordError,
      })
      if (requested === 'ascii-sweep') effect.sweep(1, { angle: 30 })
      if (requested === 'force-field') effect.impact(120, 70)
      effect.setOptions({ speed: 1 }); effect.resize(); await effect.refresh()
      const factorySnapshot = tracker.snapshot()
      const elementsSeen = factorySnapshot.elements ?? {}
      const contract = requested === 'ascii-sweep'
        ? { slots: Array.isArray(elementsSeen.slots) ? elementsSeen.slots.length : 0, privateSlots: Array.isArray(elementsSeen.slots) && elementsSeen.slots.every(slot => !!slot && typeof slot === 'object' && (slot as { content?: unknown }).content !== elements.primary && (slot as { content?: unknown }).content !== elements.secondary) }
        : { privateProxy: elementsSeen.content !== elements.primary, peelUnderLayer: requested === 'peel' ? elementsSeen.under instanceof HTMLCanvasElement && elementsSeen.under !== elements.primary : undefined }
      const evidence = {
        kind: 'html', requested, mounted: factorySnapshot.mounted,
        originalTextPreserved: elements.primary.textContent === before,
        originalVisible: elements.primary.getBoundingClientRect().width > 0,
        visualCanvasCount: elements.host.querySelectorAll('canvas,iframe').length,
        sourceCaptureCompleted: effect.getSnapshot().captures > 0,
        adapter: effect.getSnapshot(), factory: { calls: factorySnapshot.calls, mounted: factorySnapshot.mounted, updates: factorySnapshot.updates, resizes: factorySnapshot.resizes, destroys: factorySnapshot.destroys }, contract, errors, disposed: false,
      }
      destroy = () => { effect.dispose(); evidence.disposed = true; evidence.factory.destroys = tracker.snapshot().destroys }
      document.documentElement.dataset.fixtureReady = 'true'
      window.__canvasExtendedEvidence = evidence
      window.__canvasExtendedDispose = destroy
      return
    }
  }
  if (!isCanvasExtendedObjectEffectName(requested)) throw new Error(`CANVAS_EXTENDED_FIXTURE_UNROUTED:${requested}`)
  const tracker = await trackedFactory(requested)
  root.replaceChildren()
  const heading = document.createElement('header')
  heading.innerHTML = `<h1>Canvas ${requested}</h1><p>Derived object from a fixed, locally generated raster. The original sample remains below.</p>`
  const canvas = document.createElement('canvas')
  canvas.className = 'object'
  const original = document.createElement('div')
  original.className = 'original-object'; original.textContent = 'Original local PNG source retained by fixture.'
  root.append(heading, canvas, original)
  const objectUrl = await localImage()
  const effect = await createCanvasExtendedObjectEffect({
    component: requested,
    canvas,
    asset: { sourceRef: 'fixture:local-png', objectUrl, kind: 'image', verified: true },
    factory: tracker.factory,
    sourceRemainsVisible: true,
    effectOptions: { orbit: false, zoom: false, autoRotate: false },
    onReady: () => undefined,
    onError: recordError,
  })
  let assetLoaded = false
  effect.setOptions({ scale: 3 }); effect.resize()
  const readiness = new Promise<void>(resolve => {
    const check = () => {
      if (effect.getSnapshot().loaded) { assetLoaded = true; resolve(); return }
      window.setTimeout(check, 50)
    }
    check()
  })
  await Promise.race([readiness, new Promise((_, reject) => window.setTimeout(() => reject(new Error('CANVAS_EXTENDED_FIXTURE_OBJECT_LOAD_TIMEOUT')), 10_000))])
  const factorySnapshot = tracker.snapshot()
  const evidence = {
    kind: 'object', requested, mounted: factorySnapshot.mounted, assetLoaded,
    originalTextPreserved: original.textContent === 'Original local PNG source retained by fixture.',
    visualCanvasCount: document.querySelectorAll('canvas').length,
    adapter: effect.getSnapshot(), factory: { calls: factorySnapshot.calls, mounted: factorySnapshot.mounted, updates: factorySnapshot.updates, resizes: factorySnapshot.resizes, destroys: factorySnapshot.destroys }, errors, disposed: false,
  }
  document.documentElement.dataset.fixtureReady = 'true'
  window.__canvasExtendedEvidence = evidence
  window.__canvasExtendedDispose = () => { effect.dispose(); URL.revokeObjectURL(objectUrl); evidence.disposed = true; evidence.factory.destroys = tracker.snapshot().destroys }
}

const style = document.createElement('style')
style.textContent = `
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#10141b;color:#e6edf3}*{box-sizing:border-box}html,body{margin:0;min-width:0;overflow-x:clip}main{max-width:1280px;margin:0 auto;padding:24px;min-width:0}h1{margin:0;font-size:22px}header p{color:#aab8c5}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:stretch}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.source,.visual{min-width:0;height:220px;border:1px solid #47556a;border-radius:12px;background:#17202b;overflow:hidden}.source{padding:18px}.source h2{font-size:16px;margin:0 0 12px}.source p{margin:8px 0}.visual{position:relative}.object{display:block;width:min(100%,480px);height:320px;margin:18px 0;border:1px solid #47556a;border-radius:12px;background:#17202b}.original-object{padding:12px;border:1px solid #47556a;border-radius:12px}@media(max-width:600px){main{padding:14px}.grid,.grid.three{grid-template-columns:minmax(0,1fr)}.source,.visual{height:200px}}
`
document.head.append(style)

void run().catch(error => {
  document.documentElement.dataset.fixtureReady = 'failed'
  window.__canvasExtendedEvidence = { requested, mounted: false, error: error instanceof Error ? error.message : String(error) }
  const failure = document.createElement('pre'); failure.textContent = String(error instanceof Error ? error.stack ?? error.message : error); root.append(failure)
})
