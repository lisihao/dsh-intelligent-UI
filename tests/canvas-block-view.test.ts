// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_HTML_EFFECT_NAMES } from '../src/canvas-html-names.js'
import { CANVAS_BLOCK_PRESENTATION_IDS, canvasBlockCandidates } from '../src/adaptive-ui/canvas-block-recipes.js'

type FakeScope = {
  createCanvasHtmlEffect: ReturnType<typeof vi.fn>
  createCanvasIsolatedEffect: ReturnType<typeof vi.fn>
  createCanvasParticleScrollBridge: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const canvasClient = vi.hoisted(() => {
  const state: {
    scopes: Array<{ dependencies: { load?: unknown }, scope: FakeScope }>
    htmlFailure: unknown
    htmlHandler: ((options: Record<string, unknown>) => Promise<unknown>) | undefined
  } = { scopes: [], htmlFailure: undefined, htmlHandler: undefined }
  const create = vi.fn((dependencies: { load?: unknown } = {}) => {
    const scope = {
      createCanvasHtmlEffect: vi.fn((options: Record<string, unknown>) => state.htmlHandler
        ? state.htmlHandler(options)
        : state.htmlFailure ? Promise.reject(state.htmlFailure) : Promise.resolve({ dispose: vi.fn() })),
      createCanvasIsolatedEffect: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
      createCanvasParticleScrollBridge: vi.fn(() => Promise.resolve({ dispose: vi.fn(), refresh: vi.fn(), resize: vi.fn(), setOptions: vi.fn() })),
      dispose: vi.fn(),
    }
    state.scopes.push({ dependencies, scope })
    return scope
  })
  return Object.assign(state, { create })
})

vi.mock('../src/canvas-client-scope.js', () => ({ createCanvasClientScope: canvasClient.create }))

import { CanvasBlockView } from '../src/adaptive-ui/canvas-block-view.js'
import { CanvasRuntimeContext } from '../src/canvas-runtime-context.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Mounted = { root: Root, host: HTMLDivElement }
const mounted: Mounted[] = []
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')

async function mount(element: ReactElement): Promise<Mounted> {
  const host = document.createElement('div'), root = createRoot(host), item = { root, host }
  mounted.push(item)
  document.body.append(host)
  await act(async () => { root.render(element); await Promise.resolve(); await Promise.resolve() })
  return item
}

function view(presentation: string, options: { value?: unknown, isStreaming?: boolean } = {}): ReactElement {
  const load = vi.fn()
  return h(CanvasRuntimeContext.Provider, { value: load },
    h(CanvasBlockView, { presentation, value: options.value, isStreaming: options.isStreaming }, h('p', null, '完整原始来源文本。')),
  )
}

beforeEach(() => {
  canvasClient.scopes.splice(0)
  canvasClient.htmlFailure = undefined
  canvasClient.htmlHandler = undefined
  canvasClient.create.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() {
    return this.hasAttribute('data-canvas-particle-scroll-source') ? 320 : 100
  } })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() {
    return this.hasAttribute('data-canvas-particle-scroll-source') ? 640 : 100
  } })
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  document.body.replaceChildren()
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  if (scrollHeightDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  vi.clearAllMocks()
})

describe('CanvasBlockView', () => {
  it('dispatches every registered Canvas recipe through the owned client scope and disposes it on unmount', async () => {
    expect(CANVAS_BLOCK_PRESENTATION_IDS).toHaveLength(17)
    for (const presentation of CANVAS_BLOCK_PRESENTATION_IDS) {
      const item = await mount(view(presentation, presentation === 'canvas-magnify'
        ? { value: { role: 'decorative', color: '#123456' } }
        : {}))
      const record = canvasClient.scopes.at(-1)!
      expect(record.dependencies.load).toBeTypeOf('function')
      if (presentation === 'canvas-bend' || presentation === 'canvas-hex-float') {
        expect(record.scope.createCanvasIsolatedEffect).toHaveBeenCalledWith(expect.objectContaining({ slug: presentation.slice('canvas-'.length) }))
      } else if (presentation === 'canvas-particle-scroll') {
        const options = record.scope.createCanvasParticleScrollBridge.mock.calls[0]![0] as { scroll: HTMLElement, content: HTMLElement, output: HTMLCanvasElement }
        expect(options.scroll).not.toContain(options.output)
        expect(options.scroll.children).toHaveLength(1)
        expect(options.content.parentElement).toBe(options.scroll)
        expect(options.output.style.pointerEvents).toBe('none')
      } else {
        const options = record.scope.createCanvasHtmlEffect.mock.calls[0]![0] as Record<string, unknown>
        expect(options).toMatchObject({ component: presentation.slice('canvas-'.length), scope: 'visual-only', sourceRemainsVisible: true })
        expect(options.host).not.toBe(options.content)
        expect((options.host as HTMLElement).contains(options.content as Node)).toBe(false)
        expect((options.content as HTMLElement).contains(options.host as Node)).toBe(false)
      }
      expect(item.host.textContent).toContain('完整原始来源文本。')
      await act(async () => item.root.unmount())
      mounted.splice(mounted.indexOf(item), 1)
      item.host.remove()
      expect(record.scope.dispose).toHaveBeenCalledOnce()
    }
  })

  it('uses the text-free source-bound swatch for Magnify while retaining the full record next to it', async () => {
    const item = await mount(view('canvas-magnify', { value: { role: 'decorative', color: [0, 1, 0] } }))
    const record = canvasClient.scopes[0]!
    const options = record.scope.createCanvasHtmlEffect.mock.calls[0]![0] as Record<string, unknown>
    const source = options.content as HTMLElement
    expect(item.host.querySelector('[data-canvas-block-original-source]')?.textContent).toContain('完整原始来源文本。')
    expect(source.getAttribute('data-canvas-block-swatch')).not.toBeNull()
    expect(source.textContent).toBe('')
    expect(source.querySelector('[data-canvas-block-decorative-swatch]')?.getAttribute('style')).toContain('background-color: rgb(0, 255, 0)')
    expect(options).toMatchObject({ component: 'magnify', contentRole: 'decoration' })
  })

  it('retains the actual source and displays the named failure when an effect rejects', async () => {
    canvasClient.htmlFailure = new Error('fixed adapter failure')
    const item = await mount(view('canvas-ripple'))
    await act(async () => { await Promise.resolve() })
    expect(item.host.querySelector('[data-canvas-block-source]')?.textContent).toContain('完整原始来源文本。')
    expect(item.host.querySelector('[data-canvas-block-error]')?.textContent).toContain('Canvas ripple 效果失败：fixed adapter failure')
  })

  it('accepts explicitly supplied inert pre/code DOM without adding a control to the captured source', async () => {
    const markdownFence = '```ts\nconst retained = true\n```'
    expect(canvasBlockCandidates(markdownFence, { webgl: true, reducedMotion: false })).toEqual([])
    const item = await mount(h(CanvasRuntimeContext.Provider, { value: vi.fn() },
      h(CanvasBlockView, { presentation: 'canvas-grid' }, h('pre', null, h('code', null, 'const retained = true'))),
    ))
    const source = item.host.querySelector('[data-canvas-block-source]')!
    expect(source.querySelector('pre > code')?.textContent).toBe('const retained = true')
    expect(source.querySelector('button,input,a,table,img')).toBeNull()
    expect(canvasClient.scopes[0]!.scope.createCanvasHtmlEffect).toHaveBeenCalledWith(expect.objectContaining({ component: 'grid', content: source }))
  })

  it('aborts pending work and releases the scope when its source unmounts', async () => {
    let signal: AbortSignal | undefined
    canvasClient.htmlHandler = options => {
      signal = options.signal as AbortSignal
      return new Promise(() => {})
    }
    const item = await mount(view('canvas-grid'))
    const record = canvasClient.scopes[0]!
    expect(signal?.aborted).toBe(false)
    await act(async () => item.root.unmount())
    mounted.splice(mounted.indexOf(item), 1)
    item.host.remove()
    expect(signal?.aborted).toBe(true)
    expect(record.scope.dispose).toHaveBeenCalledOnce()
  })

  it('never starts a streaming or invalid Magnify effect, but keeps the original source visible', async () => {
    const streaming = await mount(view('canvas-grid', { isStreaming: true }))
    expect(canvasClient.scopes).toHaveLength(0)
    expect(streaming.host.textContent).toContain('完整原始来源文本。')
    expect(streaming.host.textContent).toContain('流式内容尚未稳定')
    const magnify = await mount(view('canvas-magnify'))
    expect(canvasClient.scopes).toHaveLength(0)
    expect(magnify.host.textContent).toContain('完整原始来源文本。')
    expect(magnify.host.textContent).toContain('decorative color 来源记录')
  })

  it('keeps the 14 HTML calls aligned to the pinned effect names', async () => {
    for (const slug of CANVAS_HTML_EFFECT_NAMES) {
      const item = await mount(view(`canvas-${slug}`, slug === 'magnify' ? { value: { role: 'decorative', color: 'rgb(1, 2, 3)' } } : {}))
      const record = canvasClient.scopes.at(-1)!
      expect(record.scope.createCanvasHtmlEffect).toHaveBeenCalledWith(expect.objectContaining({ component: slug }))
      await act(async () => item.root.unmount())
      mounted.splice(mounted.indexOf(item), 1)
      item.host.remove()
    }
  })
})
