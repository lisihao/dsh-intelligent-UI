// @vitest-environment jsdom
import { act, createElement as h, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompiledDil } from '../src/dil/compiler.js'
import type { DilTreeNode } from '../src/dil/view.js'

const runner = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  mountOrder: [] as string[],
  mountCounts: new Map<string, number>(),
  cleanupCounts: new Map<string, number>(),
  failIds: new Set<string>(),
  reset() {
    this.active = 0
    this.peak = 0
    this.mountOrder = []
    this.mountCounts.clear()
    this.cleanupCounts.clear()
    this.failIds.clear()
  },
  snapshot(id: string): DilTreeNode {
    return { t: 'text', c: [{ t: '#text', v: `CAPTURED_NATIVE_OUTPUT:${id}` }] }
  },
}))

vi.mock('../src/dil/view.js', () => ({
  DilProgramView: (props: {
    artifactId: string
    onSnapshot?: (tree: DilTreeNode) => void
    onRuntimeFailure?: (reason: string) => void
  }) => {
    useEffect(() => {
      const id = props.artifactId
      runner.active += 1
      runner.peak = Math.max(runner.peak, runner.active)
      runner.mountOrder.push(id)
      runner.mountCounts.set(id, (runner.mountCounts.get(id) ?? 0) + 1)
      if (runner.failIds.has(id)) props.onRuntimeFailure?.(`SYNTHETIC_RUNTIME_FAILURE:${id}`)
      else props.onSnapshot?.(runner.snapshot(id))
      return () => {
        runner.active -= 1
        runner.cleanupCounts.set(id, (runner.cleanupCounts.get(id) ?? 0) + 1)
      }
    }, [props.artifactId])
    return h('div', { 'data-mock-dil-program': true, 'data-artifact-id': props.artifactId }, `running:${props.artifactId}`)
  },
  DilNativeTreeView: (props: { tree: unknown, artifactId: string }) => {
    const record = (value: unknown): Record<string, unknown> | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
    const tree = record(props.tree)
    const children = Array.isArray(tree?.c) ? tree.c : []
    const firstChild = record(children[0])
    const label = typeof firstChild?.v === 'string' ? firstChild.v : JSON.stringify(props.tree)
    return h('div', { 'data-dil-native-tree': true, 'data-artifact-id': props.artifactId },
      h('span', { 'data-generated-tree-label': true }, label),
      h('pre', { 'data-generated-tree-json': true }, JSON.stringify(props.tree)))
  },
}))

vi.mock('../src/presentation.js', () => ({
  ContentView: ({ value }: { value: unknown }) => h('div', { 'data-dil-fallback': true }, String(value)),
}))

vi.mock('@openuidev/react-ui', () => ({
  ThemeProvider: ({ children }: { children?: ReactNode }) => h('div', { 'data-mock-theme-provider': true }, children),
}))

import { ReviewApp, type ReviewConfig } from '../tools/dil-document-review/app.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let viewportWidth = 1440
const roots: Array<{ root: Root, host: HTMLDivElement }> = []

function compiled(source: string): CompiledDil {
  return {
    ok: true,
    protocolVersion: 1,
    source,
    sourceLength: source.length,
    code: 'synthetic-inert-code',
    codeLength: 20,
    constants: {},
    constantCount: 0,
    requiredComponents: [],
    appData: {},
    genuiComponents: [],
    stateKeys: [],
    fallbackMarkdown: source,
    diagnostics: [],
    diagnosticSummary: 'synthetic test payload',
    durationMs: 0,
    compiledAt: '2026-11-06T00:00:00.000Z',
  }
}

function block(id: string, source: string, reason: string) {
  return {
    id,
    start: 0,
    end: source.length,
    kind: 'synthetic-paragraph',
    source,
    choice: {
      components: ['text', 'badge'],
      reason,
      dilSource: `<text>synthetic-program:${id}</text>`,
    },
    compiled: compiled(source),
    status: 'ready' as const,
  }
}

function documentFixture(id: string, hash: string, title: string, blocks: ReturnType<typeof block>[]) {
  return {
    id,
    fileName: `${id}.md`,
    title,
    sha256: hash,
    raw: blocks.map(item => item.source).join('\n\n'),
    blocks,
  }
}

function documentsFixture() {
  return [
    documentFixture('synthetic-document-a', 'synthetic-sha-a', 'Synthetic document A', [
      block('synthetic-a-block-1', 'SYNTHETIC_SOURCE_A_1', 'Synthetic reason A1: the block is a compact status summary.'),
      block('synthetic-a-block-2', 'SYNTHETIC_SOURCE_A_2', 'Synthetic reason A2: the block needs a small comparison badge.'),
    ]),
    documentFixture('synthetic-document-b', 'synthetic-sha-b', 'Synthetic document B', [
      block('synthetic-b-block-1', 'SYNTHETIC_SOURCE_B_1', 'Synthetic reason B1: the block is a single key metric.'),
    ]),
  ]
}

function configFixture(documents = documentsFixture()): ReviewConfig {
  return {
    state: 'ready',
    frameUrl: 'https://synthetic.invalid/dil-runner.html',
    manifest: {
      formatVersion: 1,
      session: { id: 'synthetic-session', model: 'synthetic-model', provider: 'synthetic-provider' },
      documents,
    },
  }
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
}

async function renderApp(config: ReviewConfig): Promise<{ root: Root, host: HTMLDivElement }> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const item = { root, host }
  roots.push(item)
  await act(async () => {
    root.render(h(ReviewApp, { config }))
    await Promise.resolve()
  })
  await flushEffects()
  return item
}

async function waitFor(label: string, condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return
    await flushEffects()
  }
  throw new Error(`synthetic test timeout: ${label}`)
}

async function settleDocument(host: HTMLDivElement, expectedReady: number, expectedFailed = 0): Promise<void> {
  await waitFor('document queue settled', () => {
    const progress = host.querySelector('[data-review-progress]')?.textContent ?? ''
    const states = [...host.querySelectorAll<HTMLElement>('[data-review-reader-block]')].map(node => node.dataset.reviewRenderState)
    return runtimeStateSettled(states, expectedReady, expectedFailed)
      && !progress.startsWith('正在准备界面')
      && runner.active === 0
  })
}

function runtimeStateSettled(states: Array<string | undefined>, expectedReady: number, expectedFailed: number): boolean {
  return states.filter(state => state === 'ready').length === expectedReady
    && states.filter(state => state === 'failed').length === expectedFailed
    && states.every(state => state === 'ready' || state === 'failed')
}

function readerBlock(host: HTMLDivElement, index: number): HTMLElement {
  const node = host.querySelector<HTMLElement>(`[data-review-reader-block="${String(index)}"]`)
  expect(node).not.toBeNull()
  return node!
}

beforeEach(() => {
  runner.reset()
  viewportWidth = 1440
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: viewportWidth <= 1100 && query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  })
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: (handle: number) => window.clearTimeout(handle) })
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(async () => {
  for (const item of roots.splice(0)) await act(async () => item.root.unmount())
  document.body.replaceChildren()
})

describe('ReviewApp document reader queue', () => {
  it('rejects a literal expression in place of source code, retains semantic source and continues', async () => {
    const codeBlock = block('synthetic-code', '```json\n{"value":42}\n```', 'Preserve source code')
    codeBlock.kind = 'code'
    const snapshot = vi.spyOn(runner, 'snapshot').mockImplementation(id => id === 'synthetic-code'
      ? { t: 'code', c: [{ t: '#text', v: '{body}' }] }
      : { t: 'text', c: [{ t: '#text', v: id }] })
    try {
      const view = await renderApp(configFixture([documentFixture('code-doc', 'code-hash', 'Code source', [codeBlock, block('next-block', 'Next source', 'Next reason')])]))
      await settleDocument(view.host, 1, 1)
      const recovered = readerBlock(view.host, 0)
      expect(recovered.dataset.reviewRecovery).toBe('source-code')
      expect(recovered.textContent).toContain('{"value":42}')
      expect(recovered.dataset.reviewFailure).toContain('DIL_CODE_SOURCE_MISMATCH')
      expect(recovered.textContent).toContain('代码内容与原文不一致')
      expect(recovered.querySelector('[data-dil-native-tree]')).toBeNull()
      expect(readerBlock(view.host, 1).dataset.reviewRenderState).toBe('ready')
      expect(runner.mountCounts.get('synthetic-code')).toBe(1)
    } finally { snapshot.mockRestore() }
  })

  it('serially captures every ready block, then keeps each native snapshot after the runner is gone', async () => {
    const documents = documentsFixture()
    const view = await renderApp(configFixture(documents))
    await settleDocument(view.host, 2)

    expect(runner.mountOrder).toEqual(['synthetic-a-block-1', 'synthetic-a-block-2'])
    expect(runner.mountCounts.get('synthetic-a-block-1')).toBe(1)
    expect(runner.mountCounts.get('synthetic-a-block-2')).toBe(1)
    expect(runner.cleanupCounts.get('synthetic-a-block-1')).toBe(1)
    expect(runner.cleanupCounts.get('synthetic-a-block-2')).toBe(1)
    expect(runner.peak).toBe(1)
    expect(runner.active).toBe(0)
    expect(window.__dilDocumentReview).toEqual({ mounted: 2, failures: 0 })

    for (const [index, item] of documents[0]!.blocks.entries()) {
      const article = readerBlock(view.host, index)
      expect(article.dataset.reviewRenderState).toBe('ready')
      expect(article.querySelector('[data-dil-native-tree]')?.textContent).toContain(`CAPTURED_NATIVE_OUTPUT:${item.id}`)
      expect(article.querySelector('[data-dil-fallback]')).toBeNull()
      expect(article.querySelector('[data-review-source-preview]')).toBeNull()
      expect(article.textContent).not.toContain(item.choice.dilSource)
    }
  })

  it('retains the named failed source, continues the queue, and does not retry automatically', async () => {
    runner.failIds.add('synthetic-a-block-1')
    const documents = documentsFixture()
    const view = await renderApp(configFixture(documents))
    await settleDocument(view.host, 1, 1)

    const failed = readerBlock(view.host, 0)
    const completed = readerBlock(view.host, 1)
    expect(runner.mountOrder).toEqual(['synthetic-a-block-1', 'synthetic-a-block-2'])
    expect(runner.mountCounts.get('synthetic-a-block-1')).toBe(1)
    expect(runner.mountCounts.get('synthetic-a-block-2')).toBe(1)
    expect(runner.peak).toBe(1)
    expect(runner.active).toBe(0)
    expect(failed.dataset.reviewRenderState).toBe('failed')
    expect(failed.querySelector('[data-dil-fallback]')?.textContent).toContain('SYNTHETIC_SOURCE_A_1')
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain('SYNTHETIC_RUNTIME_FAILURE:synthetic-a-block-1')
    expect(failed.querySelector('[data-dil-native-tree]')).toBeNull()
    expect(completed.dataset.reviewRenderState).toBe('ready')
    expect(completed.querySelector('[data-generated-tree-label]')?.textContent).toBe('CAPTURED_NATIVE_OUTPUT:synthetic-a-block-2')
    expect(completed.textContent).not.toContain('<text>synthetic-program:synthetic-a-block-2</text>')

    await flushEffects()
    expect(runner.mountCounts.get('synthetic-a-block-1')).toBe(1)
    expect(runner.mountCounts.get('synthetic-a-block-2')).toBe(1)
    expect(window.__dilDocumentReview).toEqual({ mounted: 1, failures: 1 })
  })

  it('keeps the inspector hidden by default and reveals the actual component choice and reason on demand', async () => {
    const view = await renderApp(configFixture())
    await settleDocument(view.host, 2)

    const inspector = view.host.querySelector<HTMLElement>('[data-review-inspector]')!
    expect(inspector.hidden).toBe(true)
    const inspectButton = view.host.querySelector<HTMLButtonElement>('[data-review-inspect-toggle]')
    expect(inspectButton).not.toBeNull()
    expect(inspectButton?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => {
      inspectButton!.click()
      await Promise.resolve()
    })
    await flushEffects()

    const openInspector = view.host.querySelector<HTMLElement>('[data-review-inspector]')!
    expect(openInspector.hidden).toBe(false)
    expect(view.host.querySelector<HTMLButtonElement>('[data-review-inspect-toggle]')?.getAttribute('aria-expanded')).toBe('true')
    expect(openInspector.querySelector('.dil-review-selected-evidence')?.textContent).toContain('text / badge')
    expect(openInspector.querySelector('.dil-review-selected-evidence')?.textContent).toContain('Synthetic reason A1: the block is a compact status summary.')
    expect(openInspector.querySelector('.dil-review-selected-evidence')?.textContent).toContain('<text>synthetic-program:synthetic-a-block-1</text>')
    expect(readerBlock(view.host, 0).querySelector('[data-generated-tree-label]')?.textContent).toBe('CAPTURED_NATIVE_OUTPUT:synthetic-a-block-1')
  })

  it('uses the native narrow document selector and reuses snapshots by document id and source hash', async () => {
    viewportWidth = 390
    const documents = documentsFixture()
    const view = await renderApp(configFixture(documents))
    await settleDocument(view.host, 2)
    const firstDocumentMounts = new Map(runner.mountCounts)

    const selector = view.host.querySelector<HTMLSelectElement>('[data-review-document-select]')!
    await act(async () => {
      selector.value = '1'
      selector.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    await waitFor('narrow selector selects second document', () => view.host.querySelector('[data-review-document-index="1"]') !== null && runner.active === 0)
    await settleDocument(view.host, 1)
    expect(view.host.querySelector('[data-review-document-index="1"] [data-generated-tree-label]')?.textContent).toBe('CAPTURED_NATIVE_OUTPUT:synthetic-b-block-1')
    expect(runner.mountCounts.get('synthetic-b-block-1')).toBe(1)

    await act(async () => {
      selector.value = '0'
      selector.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    await waitFor('narrow selector returns to cached first document', () => view.host.querySelector('[data-review-document-index="0"]') !== null && runner.active === 0)
    await settleDocument(view.host, 2)

    expect(runner.mountCounts.get('synthetic-a-block-1')).toBe(firstDocumentMounts.get('synthetic-a-block-1'))
    expect(runner.mountCounts.get('synthetic-a-block-2')).toBe(firstDocumentMounts.get('synthetic-a-block-2'))
    expect(runner.mountCounts.get('synthetic-b-block-1')).toBe(1)
    expect(view.host.querySelectorAll('[data-dil-native-tree]')).toHaveLength(2)
    expect(view.host.querySelector('[data-review-document-index="0"] [data-generated-tree-label]')?.textContent).toContain('CAPTURED_NATIVE_OUTPUT:synthetic-a-block-1')
    expect(runner.peak).toBe(1)
    expect(runner.active).toBe(0)
  })
})
