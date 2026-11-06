// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const canvasScope = vi.hoisted(() => {
  const calls: Array<Record<string, unknown>> = []
  const create = vi.fn(() => ({
    createCanvasHtmlEffect: vi.fn((options: Record<string, unknown>) => {
      calls.push(options)
      return Promise.resolve({ dispose: vi.fn(), refresh: vi.fn(), resize: vi.fn(), setOptions: vi.fn(), splash: vi.fn(), melt: vi.fn(), burst: vi.fn() })
    }),
    createCanvasIsolatedEffect: vi.fn(() => Promise.resolve({ destroy: vi.fn() })),
    createCanvasParticleScrollBridge: vi.fn(() => Promise.resolve({ dispose: vi.fn(), refresh: vi.fn(), resize: vi.fn(), setOptions: vi.fn() })),
    dispose: vi.fn(),
  }))
  return { calls, create }
})

vi.mock('../src/canvas-client-scope.js', () => ({ createCanvasClientScope: canvasScope.create }))

import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { ContentView } from '../src/presentation.js'
import { compileBlockLayout, type CompiledBlock } from '../src/adaptive-ui/block-compiler.js'
import { canvasBlockCandidates } from '../src/adaptive-ui/canvas-block-recipes.js'
import type { CompositionResult } from '../src/adaptive-ui/contracts.js'
import type { BaseCompositionSelection } from '../src/adaptive-ui/planner.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import { readCanvasHtmlTextureSource } from '../src/canvas-html-texture.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Mounted = { readonly root: Root, readonly host: HTMLDivElement }
const mounted: Mounted[] = []

function rect(width = 320, height = 180): DOMRect {
  return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect
}

function computed(element: Element, pseudo?: string | null): CSSStyleDeclaration {
  const style = (element as HTMLElement).style
  return {
    position: style.position || 'static',
    transform: style.transform || 'none',
    overflowX: style.overflowX || 'visible',
    overflowY: style.overflowY || 'visible',
    display: style.display || 'block',
    visibility: style.visibility || 'visible',
    opacity: style.opacity || '1',
    content: pseudo ? 'none' : 'normal',
    length: style.length,
    item: (index: number) => style.item(index),
    getPropertyValue: (name: string) => style.getPropertyValue(name),
  } as CSSStyleDeclaration
}

function selection(overrides: Partial<BaseCompositionSelection> = {}): BaseCompositionSelection {
  return {
    themeId: 'plain',
    surface: 'semantic',
    chart: 'auto',
    componentSet: 'native',
    objectEffect: 'none',
    layout: 'document',
    ...overrides,
  }
}

function canvasResult(value: unknown): CompositionResult {
  const compiled = compileBlockLayout(value)
  return {
    status: 'selected',
    reason: 'JEV_SELECTION_ADOPTED',
    sourceVersion: 'sha256:canvas-block-dom',
    operationId: 'canvas-block-dom',
    selection: {
      ...selection(),
      blockLayout: {
        version: compiled.version,
        inspection: 'none',
        blocks: compiled.blocks.map((block: CompiledBlock) => ({
          id: block.id,
          path: [...block.path],
          ...(block.start === undefined ? {} : { start: block.start }),
          ...(block.end === undefined ? {} : { end: block.end }),
          kind: block.kind,
          presentation: 'canvas-grid' as const,
          selection: selection(),
          evidence: [...block.evidence],
        })),
      },
    },
  } as CompositionResult
}

function settings(): ExperienceSettings {
  return {
    ...initialSettings(),
    revision: 1,
    takeover: true,
    adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true },
    theme: { activeId: 'plain', installed: [] },
  }
}

function api(): CompositionApi {
  return {
    composition: vi.fn(async input => canvasResult(input.value)),
    compositionReceipt: vi.fn(async input => ({ status: 'observed', operationId: input.operationId, sourceVersion: input.sourceVersion })),
    compositionCancel: vi.fn(async () => ({ cancelled: true, reason: 'test' })),
  }
}

async function mountProductionMarkdown(value: string): Promise<Mounted> {
  const host = document.createElement('div'), root = createRoot(host), item = { root, host }
  mounted.push(item)
  document.body.append(host)
  await act(async () => {
    root.render(h(CompositionRuntimeContext.Provider, { value: { api: api(), settings: settings(), sessionId: 'canvas-dom' } },
      h(ContentView, { value, documentId: 'canvas-dom-document', sessionId: 'canvas-dom' }),
    ))
  })
  await act(async () => { await vi.waitFor(() => expect(canvasScope.calls).toHaveLength(1)) })
  return item
}

beforeEach(() => {
  canvasScope.calls.splice(0)
  canvasScope.create.mockClear()
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(window, 'getComputedStyle').mockImplementation(computed)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => kind === 'webgl2'
    ? { getExtension: () => ({ loseContext() {} }) } as unknown as RenderingContext
    : null)
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('production Markdown Canvas source qualification', () => {
  it('passes a real ContentView paragraph, inline-code, strong, and list block through the unmocked snapshot validator', async () => {
    const source = `完整段落保留 **强调事实** 与 \`inline-code\`。\n\n- 第一项保持原始顺序\n- 第二项保持完整文本`
    expect(canvasBlockCandidates(source, { webgl: true, reducedMotion: false }).map(candidate => candidate.id)).toContain('canvas-grid')

    const item = await mountProductionMarkdown(source)
    const content = canvasScope.calls[0]!.content as HTMLElement
    expect(content).toBe(item.host.querySelector('[data-canvas-block-source]'))
    expect(content.querySelector('p strong')?.textContent).toBe('强调事实')
    expect(content.querySelector('p code')?.textContent).toBe('inline-code')
    expect(content.querySelectorAll('ul > li')).toHaveLength(2)
    expect(content.querySelector('button,a,input,img,table,[tabindex],svg')).toBeNull()

    const snapshot = readCanvasHtmlTextureSource(content)
    expect(snapshot).toMatchObject({ width: 320, height: 180 })
    expect(JSON.stringify(snapshot.tree)).toContain('强调事实')
    expect(JSON.stringify(snapshot.tree)).toContain('第二项保持完整文本')
  })

  it.each([
    ['heading', '# 生产标题'],
    ['blockquote', '> 原始引文'],
    ['delete', '~~已删除的原文~~'],
    ['thematic break', '---'],
    ['fenced code with host copy control', '```ts\nconst retained = true\n```'],
  ])('does not automatically offer Canvas recipes for a production %s node', (_kind, source) => {
    expect(canvasBlockCandidates(source, { webgl: true, reducedMotion: false })).toEqual([])
  })

  it('demonstrates that a manually forced fenced-code Canvas route contains the production copy control rejected by the real validator', async () => {
    const source = '```ts\nconst retained = true\n```'
    const item = await mountProductionMarkdown(source)
    const content = canvasScope.calls[0]!.content as HTMLElement
    expect(content).toBe(item.host.querySelector('[data-canvas-block-source]'))
    expect(content.querySelector<HTMLButtonElement>('button[aria-label="复制原始代码"]')).not.toBeNull()
    expect(() => readCanvasHtmlTextureSource(content)).toThrowError(expect.objectContaining({ code: 'unsafe-content' }))
  })
})
