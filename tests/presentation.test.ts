// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appearancePreferences } from '../src/appearance.js'
import { ArtifactView, ContentView, DisplayModeControl, displayModes, rawText } from '../src/presentation.js'
import type { ExperienceArtifact } from '../src/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
describe('presentation', () => {
  beforeEach(() => displayModes.clear())
  it('preserves raw strings and structured data', () => {
    expect(rawText('a\nb')).toBe('a\nb')
    expect(JSON.parse(rawText({ a: [1, 2] }))).toEqual({ a: [1, 2] })
  })
  it('renders markdown through the UI library and exposes original content', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'generated', label: 'Test' }, protocol: 'content', raw: 'untouched', payload: '**bold**', providerId: 'test' }
    await act(async () => root.render(createElement(ArtifactView, { artifact })))
    expect(host.querySelector('strong')?.textContent).toBe('Test')
    expect(host.textContent).toContain('bold')
    await act(async () => displayModes.set('s', 'raw'))
    expect(host.textContent).toContain('untouched')
    await act(async () => root.unmount()); host.remove()
  })
  it('updates a real streaming OpenUI renderer and submits local form state', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'generated', label: 'Form' }, protocol: 'openui', raw: 'raw', payload: 'root = TextContent("Partial")', providerId: 'test' }
    const received: unknown[] = []
    const onContinue = async (event: unknown, state: unknown) => { received.push({ event, state }) }
    await act(async () => root.render(createElement(ArtifactView, { artifact, isStreaming: true, onContinue })))
    expect(host.textContent).toContain('Partial')
    const payload = `root = Form("contact", btns, [nameField])
nameField = FormControl("Name", Input("name", "Your name", "text"))
btns = Buttons([Button("Submit", Action([@ToAssistant("Submit")]), "primary")])`
    await act(async () => root.render(createElement(ArtifactView, { artifact: { ...artifact, payload }, onContinue })))
    const input = host.querySelector('input')!
    expect(input).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'Alice'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => displayModes.set('s', 'raw'))
    await act(async () => displayModes.set('s', 'visual'))
    expect(host.querySelector('input')!.value).toBe('Alice')
    const button = Array.from(host.querySelectorAll('button')).find(x => x.textContent === 'Submit')!
    expect(button).toBeTruthy()
    await act(async () => button.click())
    expect(JSON.stringify(received)).toContain('Alice')
    await act(async () => root.unmount()); host.remove()
  })
  it('restores and saves form state with its revision', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const payload = `root = Form("contact", btns, [field])
field = FormControl("Name", Input("name", "Your name", "text"))
btns = Buttons([Button("Submit", Action([@ToAssistant("Submit")]), "primary")])`
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'generated', label: 'Form' }, protocol: 'openui', raw: payload, payload, providerId: 'test' }
    const stateApi = { widgetState: vi.fn(async () => ({ formatVersion: 1 as const, revision: 4, state: { contact: { name: { value: 'Before', componentType: 'Input' } } } })), saveWidgetState: vi.fn(async (input) => ({ formatVersion: 1 as const, revision: 5, state: input.state })) }
    await act(async () => root.render(createElement(ArtifactView, { artifact, stateApi })))
    const input = host.querySelector('input')!
    expect(input.value).toBe('Before')
    expect(stateApi.saveWidgetState).not.toHaveBeenCalled()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, 'After'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    expect(stateApi.saveWidgetState).toHaveBeenCalledOnce()
    expect(stateApi.saveWidgetState.mock.calls[0]![0].expectedRevision).toBe(4)
    expect(JSON.stringify(stateApi.saveWidgetState.mock.calls[0]![0].state)).toContain('After')
    await act(async () => root.unmount()); host.remove()
  })
  it('closes a late MCP instance after the view unmounts', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    let resolveOpen!: (value: { instanceId: string, proxyUrl: string, html: string, input: Record<string, unknown>, result: { content: [] } }) => void
    const api = { mcpOpen: vi.fn(() => new Promise<Parameters<typeof resolveOpen>[0]>(resolve => { resolveOpen = resolve })), mcpClose: vi.fn(async () => null), mcpAction: vi.fn(async () => ({ content: [] })) }
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'tool', label: 'MCP' }, protocol: 'mcp-app', raw: 'raw', payload: {}, providerId: 'test' }
    await act(async () => root.render(createElement(ArtifactView, { artifact, mcpApi: api })))
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '打开 MCP App')!.click())
    expect(api.mcpOpen).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
    await act(async () => resolveOpen({ instanceId: 'instance', proxyUrl: 'http://localhost:1234', html: '', input: {}, result: { content: [] } }))
    expect(api.mcpClose).toHaveBeenCalledWith({ sessionId: 's', instanceId: 'instance' })
    host.remove()
  })
  it('updates OpenUI theme styles for the chosen content background', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    await act(async () => { appearancePreferences.set({ backgroundColor: '#f4f6f8', translucent: false }); root.render(createElement(ContentView, { value: '**Readable**' })) })
    const light = document.head.innerHTML
    await act(async () => appearancePreferences.reset())
    const dark = document.head.innerHTML
    expect(dark).not.toBe(light)
    expect(dark).toContain('--openui-')
    expect(host.textContent).toContain('Readable')
    await act(async () => { root.unmount(); appearancePreferences.reset() }); host.remove()
  })
  it('shows assistant message text without internal metadata and preserves the original', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const raw = { role: 'assistant', id: 'internal-secret-id', provider: 'private-provider', content: [{ type: 'reasoning', text: '思考内容' }, { type: 'text', text: '**可读回答**' }] }
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'assistant', label: '助手回复' }, protocol: 'content', raw, payload: raw, providerId: 'test' }
    await act(async () => root.render(createElement(ArtifactView, { artifact })))
    expect(host.textContent).toContain('可读回答'); expect(host.textContent).toContain('思考内容')
    expect(host.textContent).not.toContain('internal-secret-id'); expect(host.textContent).not.toContain('private-provider')
    await act(async () => displayModes.set('s', 'raw'))
    expect(host.textContent).toContain('internal-secret-id'); expect(host.textContent).toContain('private-provider')
    await act(async () => root.unmount()); host.remove()
  })
  it('gives old tool-only assistant messages a readable fallback', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    const raw = { role: 'assistant', content: [{ type: 'tool-call', name: 'internal-tool' }] }
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 's', kind: 'assistant', label: '助手回复' }, protocol: 'content', raw, payload: raw, providerId: 'test' }
    await act(async () => root.render(createElement(ArtifactView, { artifact })))
    expect(host.textContent).toContain('助手发起了工具调用'); expect(host.textContent).not.toContain('internal-tool')
    await act(async () => root.unmount())
  })
  it('uses one conversation control for all outputs and isolates another conversation', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'f7f48ec8-fcf5-477c-977b-e0e7c372893a', createdAt: '', source: { sessionId: 'shared', kind: 'generated', label: 'First' }, protocol: 'content', raw: 'raw first', payload: 'visual first', providerId: 'test' }
    await act(async () => root.render(createElement('div', null, createElement(DisplayModeControl, { sessionId: 'shared' }), createElement(ArtifactView, { artifact }), createElement(ArtifactView, { artifact: { ...artifact, id: 'second', raw: 'raw second', payload: 'visual second' } }), createElement(ArtifactView, { artifact: { ...artifact, id: 'other', source: { ...artifact.source, sessionId: 'other' }, raw: 'other raw' } }))))
    expect(host.querySelectorAll('select')).toHaveLength(1)
    expect(host.querySelectorAll('section button')).toHaveLength(0)
    const select = host.querySelector('select')!
    await act(async () => { select.value = 'raw'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelectorAll('section [hidden]')).toHaveLength(2)
    expect(host.querySelectorAll('section pre')).toHaveLength(2)
    expect(host.textContent).toContain('raw first'); expect(host.textContent).toContain('raw second')
    expect(host.textContent).not.toContain('other raw')
    await act(async () => { select.value = 'compare'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelectorAll('section [hidden]')).toHaveLength(0)
    expect(host.querySelectorAll('section pre')).toHaveLength(2)
    await act(async () => root.unmount())
  })
  it('renders row arrays as a table' , async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => root.render(createElement(ContentView, { value: [{ name: 'one', n: 2 }] })))
    expect(host.querySelector('table')?.textContent).toContain('one')
    await act(async () => root.unmount())
  })
  it('renders ordinary GFM tables, escaped pipes, links and semantic headings without OpenUI markup', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    const text = '## 风险说明\n\n| 公司 | 口径说明 |\n| --- | --- |\n| A\\|B | 季度数据 |\n| [C](https://example.org) | TTM 数据 |'
    await act(async () => root.render(createElement(ContentView, { value: text })))
    expect(host.querySelectorAll('table')).toHaveLength(1)
    expect(host.querySelector('td')?.textContent).toBe('A|B')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.org')
    expect(host.querySelector('h2')?.textContent).toBe('风险说明')
    expect(host.querySelector('[data-auto-chart]')).toBeNull()
    await act(async () => root.unmount())
  })
  it('renders tool text-content blocks as Markdown rather than a transport table', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => root.render(createElement(ContentView, { value: [{ type: 'text', text: '## 验证通过\n\n**实际结果**' }] })))
    expect(host.querySelector('h2')?.textContent).toBe('验证通过')
    expect(host.querySelector('table')).toBeNull()
    await act(async () => root.unmount())
  })
  it('postpones automatic charts while streaming and preserves raw content after settlement', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const text = '## 各文件耗时\n\n| 文件 | 耗时（ms） |\n| --- | ---: |\n| parser.test.ts | 14.625 |\n| store.test.ts | 31.125 |'
    const artifact: ExperienceArtifact = { formatVersion: 1, id: 'stream-check', createdAt: '', source: { sessionId: 'auto', kind: 'generated', label: '普通输出' }, protocol: 'content', raw: text, payload: text, providerId: 'test' }
    await act(async () => root.render(createElement(ArtifactView, { artifact, isStreaming: true })))
    expect(host.querySelectorAll('table')).toHaveLength(1)
    expect(host.querySelector('[data-auto-chart]')).toBeNull()
    await act(async () => root.render(createElement(ArtifactView, { artifact })))
    expect(host.querySelector('[data-auto-chart]')?.getAttribute('data-auto-chart')).toBe('bar')
    expect(host.querySelector('table')?.textContent).toContain('14.625')
    await act(async () => displayModes.set('auto', 'raw'))
    expect(host.querySelector('pre')?.textContent).toBe(text)
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); canvas.mockRestore()
  })

  it('shows separately selected units, exact source cells and exclusions without losing the full table', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const text = '## 门店情况\n\n| 门店 | 费用（元） | 成功率（%） | 说明 |\n| --- | ---: | ---: | --- |\n| 东区 | 约18.75元 | 91% | 包含维护 |\n| 西区 | 21.50元 | 93% | 正常 |\n| 北区 | 未提供 | 89% | 费用未上报 |'
    await act(async () => root.render(createElement(ContentView, { value: text })))
    expect(host.querySelectorAll('[data-auto-chart]')).toHaveLength(2)
    expect(host.querySelector('[aria-label="原始数据表格"] table')?.textContent).toContain('费用未上报')
    expect(host.querySelector('[aria-label="原始数据表格"] table')?.textContent).toContain('未提供')
    expect(host.textContent).toContain('约18.75元')
    expect(host.querySelectorAll('.iexp-disclosure summary')).toHaveLength(4)
    expect(host.querySelector('.iexp-full-table summary')?.textContent).toContain('完整原表')
    expect(host.querySelector('.iexp-full-table')?.hasAttribute('open')).toBe(false)
    await act(async () => (host.querySelector('.iexp-full-table summary') as HTMLElement).click())
    expect(host.querySelector('.iexp-full-table')?.hasAttribute('open')).toBe(true)
    expect(host.textContent).toMatch(/近似|约/)
    expect(host.textContent).toContain('本图未纳入：北区（未提供）')
    await act(async () => root.unmount()); host.remove(); canvas.mockRestore(); vi.unstubAllGlobals()
  })

})
