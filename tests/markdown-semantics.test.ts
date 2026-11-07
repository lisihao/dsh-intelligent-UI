// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentView } from '../src/presentation.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ComposeInput, CompositionResult } from '../src/adaptive-ui/contracts.js'
import { compileBlockLayout } from '../src/adaptive-ui/block-compiler.js'
import { initialSettings } from '../src/contracts.js'
import { markdownCodeBlocks } from '../src/markdown-code.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const source = '# 报告\n\n## 目录\n\n1. 说明\n2. 公式\n3. 代码\n\n## 说明\n\n保留 `const x = 1` 和预算 $10 to $20。\n\n## 公式\n\n内联 \\(a_1+b^2\\) 与 $x^2$。\n\n\\[\n\\frac{x}{y}=z\n\\]\n\n```math\nE=mc^2\n```\n\n## 代码\n\n```json\n\n  {\n    "label": "原文"\n  }\n\n```\n\n无效公式 $\\frac{1$。'
const base = { themeId: 'plain', surface: 'semantic', chart: 'auto', componentSet: 'native', objectEffect: 'none', layout: 'document' } as const
const mounted: ReturnType<typeof createRoot>[] = []
afterEach(async () => { for (const root of mounted.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('rich Markdown is a baseline beneath presentation choices', () => {
  it('renders embedded Markdown without a page surface while retaining math, code and directory targets', async () => {
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
    await act(async()=>root.render(h(ContentView,{value:source,embedded:true})))
    expect(host.querySelectorAll('.iexp-embedded-markdown')).toHaveLength(1)
    expect(host.querySelector('.iexp-reply-surface')).toBeNull()
    expect(host.querySelector('.katex-display math')).not.toBeNull()
    expect(host.querySelector('.iexp-markdown-code code .token')).not.toBeNull()
    const links=host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="原文目录"] a')
    expect(links).toHaveLength(3)
    for(const link of links)expect(document.getElementById(link.hash.slice(1))).not.toBeNull()
  })
  it('does not replace a selected Markdown node with a legacy inferred flow',async()=>{
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
    const original='准备 → 核验 → 保存'
    await act(async()=>root.render(h(ContentView,{value:original,embedded:true})))
    expect(host.textContent).toContain(original)
    expect(host.querySelector('.react-flow')).toBeNull()
  })
  it.each([false, true])('preserves code, math and TOC with block experiment=%s and no live model', async experiment => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const api: CompositionApi = { composition: vi.fn(async (input: ComposeInput): Promise<CompositionResult> => ({ status: 'selected', reason: 'TEST_ORACLE', operationId: 'fixture', sourceVersion: 'fixture', selection: { ...base, blockLayout: { version: 1, inspection: 'none', blocks: compileBlockLayout(input.value).blocks.map(b => ({ id: b.id, kind: b.kind, path: [...b.path], start: b.start, end: b.end, presentation: 'reading', evidence: [...b.evidence], selection: { ...base } })) } } })), compositionReceipt: vi.fn(async () => ({ status: 'observed' })), compositionCancel: vi.fn(async () => ({ cancelled: true })) }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push(root)
    const settings = { ...initialSettings(), takeover: true, adaptive: { enabled: experiment, blockLayout: experiment, styleMode: 'automatic' as const } }
    await act(async () => root.render(h(CompositionRuntimeContext.Provider, { value: { settings, api, sessionId: 'semantic-fixture' } }, h(ContentView, { value: source, documentId: 'semantic-fixture' }))))
    await act(async () => { if (experiment) await vi.waitFor(() => expect(host.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()) })
    expect(host.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
    expect(host.querySelector('.katex-display math')).not.toBeNull()
    expect(host.querySelector('math annotation[encoding="application/x-tex"]')?.textContent).toContain('a_1+b^2')
    expect(host.querySelector('.katex-error')?.textContent).toContain('frac{1')
    expect(host.textContent).toContain('$10 to $20')
    const code = host.querySelector('.iexp-markdown-code pre > code')
    expect(code?.textContent).toBe(markdownCodeBlocks(source).find(c => c.language === 'json')!.value)
    expect(code?.className).toContain('language-json')
    expect(code?.querySelector('.token')).not.toBeNull()
    expect(host.querySelector('code.openui-markdown-renderer-code')?.textContent).toBe('const x = 1')
    const toc = host.querySelector('nav[aria-label="原文目录"]')
    expect(toc?.querySelectorAll('a')).toHaveLength(3)
    for (const a of toc!.querySelectorAll('a')) expect(document.getElementById(a.hash.slice(1))?.textContent).toContain(a.textContent)
    expect(api.composition).toHaveBeenCalledTimes(experiment ? 1 : 0)
  })
})
