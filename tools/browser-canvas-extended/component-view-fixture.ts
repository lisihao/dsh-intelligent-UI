import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { CanvasComponentView } from '../../src/adaptive-ui/canvas-component-view.js'
import { CANVAS_COMPONENT_RENDERER_KEY } from '../../src/adaptive-ui/canvas-component-bindings.js'
import { CanvasRuntimeContext } from '../../src/canvas-runtime-context.js'
import { createCanvasEffectLoader } from '../../src/canvas-runtime-client.js'

type ScenarioName = 'bubble' | 'liquid' | 'ascii-sweep' | 'dithered-object' | 'ripple'

interface Scenario {
  readonly id: `canvas:${string}`
  readonly input: unknown
  readonly value: unknown
  readonly sourceLabel: string
  readonly expectedLoads: readonly string[]
}

declare global {
  interface Window {
    __canvasComponentProductionFixture?: {
      readonly scenario: ScenarioName
      readonly expectedLoads: readonly string[]
      readonly loaded: readonly string[]
      snapshot(): Readonly<Record<string, unknown>>
      dispose(): void
    }
  }
}

const source = 'Synthetic retained source for a production CanvasComponentView check.\n\nThe surrounding test uses this exact local value; it does not send model-generated HTML or JavaScript.'
const primary = 'Synthetic primary retained panel.\n\nASCII Sweep must receive this text as a separately retained source.'
const alternate = 'Synthetic alternate retained panel.\n\nThis is a second explicit source, not a duplicated proxy supplied by a model.'
const objectReference = '/fixture-assets/production-object.png'

function scenario(name: ScenarioName): Scenario {
  if (name === 'ascii-sweep') return {
    id: 'canvas:ascii-sweep',
    input: { kind: 'canvas-html-pair', component: 'ascii-sweep', primary, alternate },
    value: { kind: 'canvas-html-pair', primary, alternate },
    sourceLabel: primary,
    expectedLoads: ['ascii-sweep'],
  }
  if (name === 'liquid') return {
    id: 'canvas:liquid',
    input: { kind: 'canvas-html', component: 'liquid', source },
    value: source,
    sourceLabel: source,
    expectedLoads: [],
  }
  if (name === 'dithered-object') return {
    id: 'canvas:dithered-object',
    input: { kind: 'canvas-object-ref', component: 'dithered-object', sourceRef: objectReference, assetKind: 'image' },
    value: { url: objectReference, type: 'image/png', role: 'illustration' },
    sourceLabel: 'Synthetic local PNG source, fetched and validated by the production object resolver.',
    expectedLoads: ['dithered-object'],
  }
  if (name === 'ripple') return {
    id: 'canvas:ripple',
    input: { kind: 'canvas-html', component: 'ripple', source },
    value: source,
    sourceLabel: source,
    expectedLoads: ['ripple'],
  }
  return {
    id: 'canvas:bubble',
    input: { kind: 'canvas-html', component: 'bubble', source },
    value: source,
    sourceLabel: source,
    expectedLoads: ['bubble'],
  }
}

function retainedSource(label: string) {
  return h('article', { className: 'fixture-retained-source' },
    h('h2', null, 'Retained production source'),
    ...label.split('\n\n').map((paragraph, index) => h('p', { key: index }, paragraph)),
  )
}

const selected = new URLSearchParams(location.search).get('scenario')
const name: ScenarioName = selected === 'liquid' || selected === 'ascii-sweep' || selected === 'dithered-object' || selected === 'ripple' ? selected : 'bubble'
const current = scenario(name)
const target = document.querySelector('#root')
if (!(target instanceof HTMLElement)) throw new Error('CANVAS_COMPONENT_PRODUCTION_ROOT')

const styles = document.createElement('style')
styles.textContent = `
  :root{color-scheme:dark;--iexp-solid-card:#17202b;--iexp-text:#e6edf3;--iexp-space:20px;font-family:ui-sans-serif,system-ui,sans-serif;background:#10141b;color:#e6edf3}
  *{box-sizing:border-box}html,body{margin:0;min-width:0;overflow-x:clip}main{max-width:1280px;margin:0 auto;padding:24px;min-width:0}h1{margin:0;font-size:22px}header p{color:#aab8c5}.fixture-retained-source{height:100%;padding:18px;background:#17202b;color:#e6edf3;border:1px solid #47556a;border-radius:12px}.fixture-retained-source h2{font-size:16px;margin:0 0 12px}.fixture-retained-source p{margin:8px 0}[data-canvas-component-source],[data-canvas-component-alternate-source],[data-canvas-component-effect-host],[data-canvas-block-source],[data-canvas-block-effect-host]{min-width:0!important;min-height:240px!important;height:240px!important;border:1px solid #47556a;border-radius:12px;background:#17202b;overflow:hidden}[data-canvas-component-effect-host],[data-canvas-block-effect-host]{position:relative}@media(max-width:600px){main{padding:14px}[data-canvas-component-source],[data-canvas-component-alternate-source],[data-canvas-component-effect-host],[data-canvas-block-source],[data-canvas-block-effect-host]{min-height:210px!important;height:210px!important}}
`
document.head.append(styles)

const loaded: string[] = []
const realLoad = createCanvasEffectLoader(url => import(/* @vite-ignore */ url))
const load = async (slug: string) => {
  loaded.push(slug)
  return realLoad(slug)
}
const root = createRoot(target)

root.render(h(CanvasRuntimeContext.Provider, { value: load },
  h('main', null,
    h('header', null,
      h('h1', null, `Production CanvasComponentView: ${name}`),
      h('p', null, 'Only fixed local Canvas source modules, explicit synthetic source values, and the real React consumer are used.'),
    ),
    h(CanvasComponentView, {
      selection: { id: current.id, rendererKey: CANVAS_COMPONENT_RENDERER_KEY, input: current.input },
      value: current.value,
    }, retainedSource(current.sourceLabel)),
  ),
))

function snapshot(): Readonly<Record<string, unknown>> {
  const component = document.querySelector('[data-canvas-component]')
  const block = document.querySelector('[data-canvas-block]')
  const sourceElement = document.querySelector('[data-canvas-component-source],[data-canvas-block-source]')
  const host = document.querySelector('[data-canvas-component-effect-host],[data-canvas-block-effect-host]')
  const rectangle = (element: Element | null) => {
    if (!(element instanceof HTMLElement)) return undefined
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  return Object.freeze({
    scenario: name,
    loaded: [...loaded],
    status: component?.getAttribute('data-canvas-component-status') ?? block?.getAttribute('data-canvas-block-status') ?? null,
    errors: [...document.querySelectorAll('[data-canvas-component-error],[data-canvas-block-error]')].map(element => element.textContent ?? ''),
    sourceText: sourceElement?.textContent ?? '',
    alternateText: document.querySelector('[data-canvas-component-alternate-source]')?.textContent ?? '',
    source: rectangle(sourceElement),
    host: rectangle(host),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    liquidFrames: host?.querySelectorAll('iframe').length ?? 0,
    canvases: host?.querySelectorAll('canvas').length ?? 0,
  })
}

window.__canvasComponentProductionFixture = Object.freeze({
  scenario: name,
  expectedLoads: current.expectedLoads,
  get loaded() { return Object.freeze([...loaded]) },
  snapshot,
  dispose() { root.unmount() },
})
