// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIL_AUTHORING_EXAMPLE } from '../src/dil/catalog.js'
import { compileDilSource } from '../src/dil/compiler.js'
import type { CompiledDil } from '../src/dil/compiler.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createDilRunner: vi.fn(),
  validateDilTree: vi.fn((value: unknown) => value),
}))
const chartMocks = vi.hoisted(() => ({
  line: vi.fn(),
  bar: vi.fn(),
  pie: vi.fn(),
}))

vi.mock('../src/dil/runtime.js', () => ({ createDilRunner: mocks.createDilRunner }))
vi.mock('../src/dil/protocol.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/dil/protocol.js')>(),
  validateDilTree: mocks.validateDilTree,
}))
vi.mock('@openuidev/react-ui', async importOriginal => ({
  ...await importOriginal<typeof import('@openuidev/react-ui')>(),
  LineChart: (props: unknown) => { chartMocks.line(props); return null },
  BarChart: (props: unknown) => { chartMocks.bar(props); return null },
  PieChart: (props: unknown) => { chartMocks.pie(props); return null },
}))

import { DilProgramView, clearDilSnapshotCache } from '../src/dil/view.js'
import { createSlotPool } from '../src/slot-pool.js'

type Callbacks = {
  onSnapshot(value: unknown): void
  onStateChange(value: Record<string, unknown>): void
  onFailure(error: unknown): void
}

const compiled = {
  ok: true,
  protocolVersion: 1,
  source: '<box/>',
  sourceLength: 6,
  code: 'inert',
  codeLength: 5,
  constants: {},
  constantCount: 0,
  requiredComponents: [],
  appData: {},
  genuiComponents: [],
  fallbackMarkdown: '# 可读回退',
  diagnostics: [],
  diagnosticSummary: 'clean',
  stateKeys: [],
  durationMs: 0,
  compiledAt: '2026-11-06T00:00:00.000Z',
} as unknown as CompiledDil

const tree = {
  t: 'form',
  p: { action: 'save' },
  c: [
    { t: 'input', p: { name: 'name', value: '', onChange: { __dilFn: 'setName' } } },
    { t: 'checkbox', p: { name: 'enabled', checked: false, onChange: { __dilFn: 'setEnabled' } }, c: [{ t: '#text', v: '启用' }] },
    { t: 'slider', p: { name: 'count', min: 0, max: 10, value: 2, onChange: { __dilFn: 'setCount' } } },
    { t: 'select', p: { name: 'mode', value: 'a', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 2 }], onChange: { __dilFn: 'setMode' } } },
    { t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交' }] },
  ],
}

const updatedTree = {
  t: 'form',
  p: { action: 'save' },
  c: [
    { t: 'input', p: { name: 'name', value: 'local value', onChange: { __dilFn: 'setName' } } },
    { t: 'checkbox', p: { name: 'enabled', checked: true, onChange: { __dilFn: 'setEnabled' } }, c: [{ t: '#text', v: '启用' }] },
    { t: 'slider', p: { name: 'count', min: 0, max: 10, value: 7, onChange: { __dilFn: 'setCount' } } },
    { t: 'select', p: { name: 'mode', value: 2, options: [{ label: 'A', value: 'a' }, { label: 'B', value: 2 }], onChange: { __dilFn: 'setMode' } } },
    { t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交' }] },
  ],
}

let mounted: Array<{ root: Root, host: HTMLDivElement }> = []

function setNativeValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('Test DOM has no native value setter.')
  setter.call(control, value)
}

async function unmount(item: { root: Root, host: HTMLDivElement }) {
  await act(async () => item.root.unmount())
  mounted = mounted.filter(candidate => candidate !== item)
}

async function mount(props: Partial<Parameters<typeof DilProgramView>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const element = h(DilProgramView, {
    source: '<form/>',
    compiled,
    enabled: true,
    artifactId: 'call-stable-id',
    sessionId: 'session-a',
    frameUrl: 'https://runner.invalid/dil-frame.html',
    ...props,
  })
  await act(async () => root.render(element))
  const item = { root, host }
  mounted.push(item)
  return {
    ...item,
    async rerender(next: Partial<Parameters<typeof DilProgramView>[0]>) {
      await act(async () => root.render(h(DilProgramView, {
        source: '<form/>',
        compiled,
        enabled: true,
        artifactId: 'call-stable-id',
        sessionId: 'session-a',
        frameUrl: 'https://runner.invalid/dil-frame.html',
        ...props,
        ...next,
      })))
    },
  }
}

afterEach(async () => {
  for (const item of mounted) await act(async () => item.root.unmount())
  mounted = []
  document.body.replaceChildren()
  clearDilSnapshotCache()
  vi.clearAllMocks()
})

describe('DilProgramView', () => {
  it('publishes a compilable guide with a stable state key and explicit submit action', () => {
    const guide = compileDilSource(DIL_AUTHORING_EXAMPLE)
    expect(guide.ok).toBe(true)
    expect(guide.stateKeys).toEqual(['seats'])
    expect(guide.diagnostics).toEqual([])
    expect(guide.code).not.toContain('submitQuote')
  })

  it('compiles an explicit lowercase markdown intrinsic with bound original source', () => {
    const original = '## 目录\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const compiledMarkdown = compileDilSource(`{@body const original = ${JSON.stringify(original)}}\n<markdown source={original}/>`)
    expect(compiledMarkdown.ok).toBe(true)
    expect(compiledMarkdown.diagnostics).toEqual([])
    expect(compiledMarkdown.code).toContain('markdown')
  })

  it('renders a snapshot shaped like the catalog guide, including title size and wrapped label control', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const view = await mount({ source: DIL_AUTHORING_EXAMPLE })
    await act(async () => callbacks!.onSnapshot({
      t: 'form', p: { action: 'submit-quote' }, c: [{
        t: 'card', p: { gap: 3 }, c: [
          { t: 'title', p: { size: 'md' }, c: [{ t: '#text', v: '报价条件' }] },
          { t: 'label', c: [{ t: '#text', v: '席位数' }, { t: 'slider', p: { name: 'seats', min: 1, max: 50, value: 3, onChange: { __dilFn: 'setSeats' } } }] },
          { t: 'text', c: [{ t: '#text', v: '当前月度费用：¥600' }] },
          { t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交当前条件' }] },
        ],
      }],
    }))
    expect(view.host.textContent).toContain('报价条件')
    expect(view.host.textContent).toContain('当前月度费用：¥600')
    expect(view.host.querySelector('label input[name="seats"]')).not.toBeNull()
  })

  it('emits only validated snapshots, keeps the runner across callback replacement, and reports the actual failure reason', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const firstSnapshot = vi.fn()
    const secondSnapshot = vi.fn()
    const onRuntimeFailure = vi.fn()
    const view = await mount({ onSnapshot: firstSnapshot, onRuntimeFailure })

    await act(async () => callbacks!.onSnapshot(tree))
    expect(firstSnapshot).toHaveBeenCalledOnce()
    expect(firstSnapshot).toHaveBeenCalledWith(expect.objectContaining({ t: 'form' }))
    const emittedTree = firstSnapshot.mock.calls[0]?.[0] as { t: string, c?: readonly { t: string, c?: readonly unknown[] }[] }
    expect(emittedTree).toMatchObject({ t: 'form' })
    expect(emittedTree.c?.[0]).toMatchObject({ t: 'input', c: [] })

    await view.rerender({ onSnapshot: secondSnapshot })
    expect(mocks.createDilRunner).toHaveBeenCalledOnce()
    await act(async () => callbacks!.onSnapshot(updatedTree))
    expect(firstSnapshot).toHaveBeenCalledOnce()
    expect(secondSnapshot).toHaveBeenCalledOnce()
    expect(secondSnapshot).toHaveBeenCalledWith(expect.objectContaining({ t: 'form' }))

    await act(async () => callbacks!.onSnapshot({ t: 'script', p: { src: 'https://invalid.example/script.js' }, c: [] }))
    expect(secondSnapshot).toHaveBeenCalledOnce()
    expect(onRuntimeFailure).toHaveBeenCalledWith(expect.stringContaining('不支持 DIL 组件'))

    await act(async () => callbacks!.onFailure(new Error('worker disconnected')))
    expect(onRuntimeFailure).toHaveBeenLastCalledWith('worker disconnected')
    expect(view.host.querySelector('[data-dil-fallback]')).not.toBeNull()
  })

  it('delegates an explicit markdown source unchanged to the host Markdown renderer', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const renderMarkdown = vi.fn((value: string) => h('article', { 'data-host-markdown': true }, value))
    const source = '## 目录\n\n- [公式](#formula)\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const view = await mount({ renderMarkdown })
    await act(async () => callbacks!.onSnapshot({ t: 'markdown', p: { source } }))
    expect(renderMarkdown).toHaveBeenCalledWith(source)
    expect(view.host.querySelector('[data-host-markdown]')?.textContent).toBe(source)
    expect(view.host.querySelector('[data-dil-fallback]')).toBeNull()
  })

  it('shows a visible source fallback when an explicit markdown node has no host renderer', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const view = await mount({ source: '<markdown source={original}/>' })
    await act(async () => callbacks!.onSnapshot({ t: 'markdown', p: { source: '# 原文' } }))
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('宿主 Markdown 渲染器')
    expect(view.host.textContent).toContain('<markdown source={original}/>')
    expect(view.host.querySelector('[data-dil-fallback]')).not.toBeNull()
  })

  it('delegates an exact external component id and JSON input to the host only after the snapshot arrives', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const renderComponent = vi.fn((id: string, input: unknown, onEvent?: (event: { kind: string, value: number }) => void) => h('button', { type: 'button', 'data-external-component': id, onClick: () => onEvent?.({ kind: 'source-change', value: 2 }) }, JSON.stringify(input)))
    const view = await mount({ renderComponent })
    await act(async () => callbacks!.onSnapshot({
      t: 'component', p: { id: 'tuffui:data-table', input: { title: 'Actual source table', rows: [{ label: 'A', value: 1 }] }, onChange: { __dilFn: 'setExternal' } },
    }))
    expect(renderComponent).toHaveBeenCalledWith('tuffui:data-table', { title: 'Actual source table', rows: [{ label: 'A', value: 1 }] }, expect.any(Function))
    expect(runner.trigger).not.toHaveBeenCalled()
    const control = view.host.querySelector<HTMLButtonElement>('[data-external-component="tuffui:data-table"]')!
    await act(async () => control.click())
    expect(runner.trigger).toHaveBeenCalledWith('setExternal', [{ kind: 'source-change', value: 2 }])
  })

  it('keeps the original source fallback when an external component snapshot has no host renderer', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const view = await mount({ source: '<component id="tuffui:data-table" input={input}/>' })
    await act(async () => callbacks!.onSnapshot({ t: 'component', p: { id: 'tuffui:data-table', input: { title: 'Actual source table' } } }))
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('宿主组件渲染器')
    expect(view.host.textContent).toContain('<component id="tuffui:data-table" input={input}/>')
    expect(view.host.querySelector('[data-dil-native-tree]')).toBeNull()
  })

  it('allows the host renderer to return a named unavailable view for an unknown exact foreign id', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const renderComponent = vi.fn((id: string) => h('p', { role: 'status', 'data-host-component-failure': true }, `COMPONENT_UNKNOWN:${id}`))
    const view = await mount({ renderComponent })
    await act(async () => callbacks!.onSnapshot({ t: 'component', p: { id: 'tuffui:not-in-host-catalog', input: { title: 'actual' } } }))
    expect(view.host.querySelector('[data-host-component-failure]')?.textContent).toBe('COMPONENT_UNKNOWN:tuffui:not-in-host-catalog')
    expect(runner.trigger).not.toHaveBeenCalled()
  })

  it('projects a single chart dataKey so extra numeric fields are not passed to OpenUI', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    await mount()
    await act(async () => callbacks!.onSnapshot({
      t: 'chart',
      p: { categoryKey: 'month', dataKey: 'sales', data: [{ month: 'Jan', sales: 10, profit: 3, ignored: 999 }, { month: 'Feb', sales: 12, profit: 4, ignored: 998 }] },
    }))
    const props = chartMocks.bar.mock.calls.at(-1)?.[0] as { categoryKey: string, data: unknown }
    expect(props.categoryKey).toBe('month')
    expect(props.data).toEqual([{ month: 'Jan', sales: 10 }, { month: 'Feb', sales: 12 }])
    expect(chartMocks.line).not.toHaveBeenCalled()
  })

  it('projects all and only same-type declared chart series', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    await mount()
    await act(async () => callbacks!.onSnapshot({
      t: 'chart',
      p: { categoryKey: 'month', series: [{ dataKey: 'sales', type: 'line' }, { dataKey: 'profit', type: 'line' }], data: [{ month: 'Jan', sales: 10, profit: 3, ignored: 999 }, { month: 'Feb', sales: 12, profit: 4, ignored: 998 }] },
    }))
    const props = chartMocks.line.mock.calls.at(-1)?.[0] as { categoryKey: string, data: unknown, legend: boolean }
    expect(props.categoryKey).toBe('month')
    expect(props.data).toEqual([{ month: 'Jan', sales: 10, profit: 3 }, { month: 'Feb', sales: 12, profit: 4 }])
    expect(props.legend).toBe(true)
    expect(chartMocks.bar).not.toHaveBeenCalled()
  })

  it('falls back visibly when one chart declares mixed series types', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const view = await mount({ source: '<chart/>' })
    await act(async () => callbacks!.onSnapshot({
      t: 'chart',
      p: { categoryKey: 'month', series: [{ dataKey: 'sales', type: 'line' }, { dataKey: 'profit', type: 'bar' }], data: [{ month: 'Jan', sales: 10, profit: 3 }] },
    }))
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('不可混用 line 与 bar')
    expect(view.host.textContent).toContain('可读回退')
    expect(view.host.textContent).toContain('<chart/>')
    expect(chartMocks.line).not.toHaveBeenCalled()
    expect(chartMocks.bar).not.toHaveBeenCalled()
  })

  it('does not create a runner without the parent-owned packaged frame URL', async () => {
    const view = await mount({ frameUrl: undefined })
    expect(mocks.createDilRunner).not.toHaveBeenCalled()
    expect(view.host.textContent).toContain('DIL 运行器地址不可用')
    expect(view.host.textContent).toContain('可读回退')
  })

  it('does not execute a failed compilation and exposes its diagnostic with the source fallback', async () => {
    const failed = { ...compiled, ok: false, diagnosticSummary: 'invalid_program', diagnostics: [{ code: 'invalid_program' }] } as CompiledDil
    const view = await mount({ compiled: failed })
    expect(mocks.createDilRunner).not.toHaveBeenCalled()
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('DIL 编译未通过')
    expect(view.host.textContent).toContain('invalid_program')
    expect(view.host.textContent).toContain('<form/>')
  })

  it('shows diagnostics for a runnable compilation without hiding its native view', async () => {
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockReturnValue(runner)
    const warning = { ...compiled, diagnosticSummary: 'repair×1', diagnostics: [{ code: 'repair' }] } as CompiledDil
    const view = await mount({ compiled: warning })
    expect(runner.start).toHaveBeenCalledOnce()
    expect(view.host.querySelector('.iexp-dil-diagnostics')?.textContent).toContain('repair×1')
  })

  it('sends native control values only to the runner, then captures fresh state for one host action submit', async () => {
    let callbacks: Callbacks | undefined
    const capturedState = { saved: false, local: 'captured' }
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => capturedState), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const onSubmit = vi.fn()
    const onStateChange = vi.fn()
    const view = await mount({ initialState: { saved: true }, onSubmit, onStateChange })
    expect(runner.start).toHaveBeenCalledOnce()
    expect(onStateChange).toHaveBeenCalledWith({ saved: true })

    await act(async () => callbacks!.onSnapshot(tree))
    expect(onSubmit).not.toHaveBeenCalled()

    const input = view.host.querySelector<HTMLInputElement>('input[name="name"]')!
    await act(async () => {
      setNativeValue(input, 'local value')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(runner.trigger).toHaveBeenLastCalledWith('setName', ['local value'])

    const checkbox = view.host.querySelector<HTMLInputElement>('input[name="enabled"]')!
    await act(async () => checkbox.click())
    expect(runner.trigger).toHaveBeenLastCalledWith('setEnabled', [true])

    const slider = view.host.querySelector<HTMLInputElement>('input[name="count"]')!
    await act(async () => {
      setNativeValue(slider, '7')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(runner.trigger).toHaveBeenLastCalledWith('setCount', [7])

    const select = view.host.querySelector<HTMLSelectElement>('select[name="mode"]')!
    await act(async () => {
      setNativeValue(select, '2')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(runner.trigger).toHaveBeenLastCalledWith('setMode', [2])

    await act(async () => callbacks!.onSnapshot(updatedTree))

    await act(async () => callbacks!.onStateChange({ saved: false, local: 'kept' }))
    expect(onStateChange).toHaveBeenLastCalledWith({ saved: false, local: 'kept' })

    const form = view.host.querySelector('form')!
    const triggerCount = runner.trigger.mock.calls.length
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(runner.captureState).toHaveBeenCalledOnce()
    expect(runner.trigger).toHaveBeenCalledTimes(triggerCount)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('save', {
      state: capturedState,
      fields: { name: 'local value', enabled: true, count: '7', mode: '2' },
    })
    expect(onStateChange).toHaveBeenLastCalledWith(capturedState)
  })

  it('does not issue a second state capture while one explicit form submit is pending', async () => {
    let callbacks: Callbacks | undefined
    let resolveCapture: ((state: Record<string, unknown>) => void) | undefined
    const captureState = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { resolveCapture = resolve }))
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState, dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const onSubmit = vi.fn()
    const view = await mount({ onSubmit })
    await act(async () => callbacks!.onSnapshot({ t: 'form', p: { action: 'save' }, c: [{ t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交' }] }] }))
    const form = view.host.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(captureState).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      resolveCapture?.({ fresh: true })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('save', { state: { fresh: true }, fields: {} })
  })

  it('submits fields from the latest rendered tree after captureState resolves', async () => {
    let callbacks: Callbacks | undefined
    let resolveCapture: ((state: Record<string, unknown>) => void) | undefined
    const captureState = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { resolveCapture = resolve }))
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState, dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const onSubmit = vi.fn()
    const view = await mount({ onSubmit })
    await act(async () => callbacks!.onSnapshot(tree))
    const form = view.host.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await act(async () => callbacks!.onSnapshot(updatedTree))
    await act(async () => {
      resolveCapture?.({ fresh: true })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onSubmit).toHaveBeenCalledWith('save', {
      state: { fresh: true },
      fields: { name: 'local value', enabled: true, count: '7', mode: '2' },
    })
  })

  it('submits fields from a snapshot whose commit is still pending when captureState resolves', async () => {
    // Browser order: the Worker's tree snapshot message, then its state reply.
    // React gives a tree set during a window message event default priority,
    // so its commit can still be pending when the state reply resolves.
    // Without a stub, jsdom committed this update within a microtask after the
    // dispatched submit (cause not determined), which hid the defect, so the
    // test pins window.event to the message being delivered.
    let callbacks: Callbacks | undefined
    let resolveCapture: ((state: Record<string, unknown>) => void) | undefined
    const captureState = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { resolveCapture = resolve }))
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState, dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const onSubmit = vi.fn()
    const view = await mount({ onSubmit })
    await act(async () => callbacks!.onSnapshot(tree))
    const form = view.host.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    const duringMessage = (action: () => void): void => {
      const windowEvent = vi.spyOn(window, 'event', 'get').mockReturnValue(new MessageEvent('message'))
      try { action() } finally { windowEvent.mockRestore() }
    }
    try {
      duringMessage(() => callbacks!.onSnapshot(updatedTree))
      duringMessage(() => resolveCapture?.({ fresh: true }))
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
      expect(onSubmit).toHaveBeenCalledWith('save', {
        state: { fresh: true },
        fields: { name: 'local value', enabled: true, count: '7', mode: '2' },
      })
    } finally {
      await new Promise(resolve => setTimeout(resolve, 0))
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    }
  })

  it('does not create a runner when disabled, and disposes the one runner on disable or unmount', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const disabledView = await mount({ enabled: false })
    expect(mocks.createDilRunner).not.toHaveBeenCalled()
    expect(disabledView.host.textContent).toContain('可读回退')
    expect(disabledView.host.textContent).toContain('<form/>')

    const view = await mount()
    await act(async () => callbacks!.onSnapshot(tree))
    await view.rerender({ enabled: false })
    expect(runner.dispose).toHaveBeenCalledOnce()
    expect(view.host.textContent).toContain('可读回退')
    expect(mocks.createDilRunner).toHaveBeenCalledOnce()
    await unmount(view)
    expect(runner.dispose).toHaveBeenCalledOnce()
  })

  it('updates a compatible compiled payload without reconstructing the runner', async () => {
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockReturnValue(runner)
    const view = await mount()
    const next = { ...compiled, code: 'compatible-new-code' }
    await view.rerender({ compiled: next })
    expect(mocks.createDilRunner).toHaveBeenCalledOnce()
    expect(runner.update).toHaveBeenCalledWith(next)
  })

  it('flushes only the newest compatible compiled payload after a delayed runner start', async () => {
    let resolveStart: (() => void) | undefined
    const start = vi.fn(() => new Promise<void>(resolve => { resolveStart = resolve }))
    const runner = { start, update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockReturnValue(runner)
    const view = await mount()
    const intermediate = { ...compiled, code: 'intermediate-code' }
    const latest = { ...compiled, code: 'latest-code' }
    await view.rerender({ compiled: intermediate })
    await view.rerender({ compiled: latest })
    expect(runner.update).not.toHaveBeenCalled()
    await act(async () => {
      resolveStart?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(start).toHaveBeenCalledWith(compiled)
    expect(runner.update).toHaveBeenCalledTimes(1)
    expect(runner.update).toHaveBeenCalledWith(latest)
  })

  it('shows a diagnostic and readable fallback for an unsafe tree without inserting arbitrary DOM', async () => {
    let callbacks: Callbacks | undefined
    const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
    mocks.createDilRunner.mockImplementation((options: Callbacks) => {
      callbacks = options
      return runner
    })
    const view = await mount()
    await act(async () => callbacks!.onSnapshot({ t: 'script', p: { src: 'https://invalid.example/script.js' }, c: [] }))
    expect(view.host.querySelector('script')).toBeNull()
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('不支持 DIL 组件')
    expect(view.host.textContent).toContain('可读回退')

    await act(async () => callbacks!.onSnapshot({ t: 'image', p: { src: 'https://invalid.example/image.png', alt: '不能加载' }, c: [] }))
    expect(view.host.querySelector('img')).toBeNull()
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('data: URL')
  })
})

describe('DilProgramView runner slots', () => {
  const staticTree = { t: 'card', c: [{ t: 'text', c: [{ t: '#text', v: '静态快照' }] }] }
  type Runner = { start: ReturnType<typeof vi.fn>, update: ReturnType<typeof vi.fn>, trigger: ReturnType<typeof vi.fn>, captureState: ReturnType<typeof vi.fn>, dispose: ReturnType<typeof vi.fn> }
  function lanes(size: number) { const pool = createSlotPool(size); return { onScreen: pool, background: pool } }
  function observeEach() {
    const observers = new Map<Element, (entries: Array<{ isIntersecting: boolean }>) => void>()
    vi.stubGlobal('IntersectionObserver', class {
      callback: (entries: Array<{ isIntersecting: boolean }>) => void
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { this.callback = callback }
      observe(target: Element) { observers.set(target, this.callback) }
      disconnect() {}
    })
    return (host: HTMLElement, isIntersecting: boolean) => act(async () => observers.get(host.querySelector('[data-dil-artifact-id]')!)!([{ isIntersecting }]))
  }
  function recordRunners() {
    const runners: Array<{ runner: Runner, callbacks: Callbacks & { initialState?: Record<string, unknown> } }> = []
    mocks.createDilRunner.mockImplementation((options: Callbacks & { initialState?: Record<string, unknown> }) => {
      const runner = { start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }
      runners.push({ runner, callbacks: options })
      return runner
    })
    return runners
  }

  it('starts at most the pool size of runners and starts the next one when a view unmounts', async () => {
    const runners = recordRunners()
    const runnerSlots = lanes(1)
    const first = await mount({ artifactId: 'a', runnerSlots })
    const second = await mount({ artifactId: 'b', runnerSlots })
    expect(runners).toHaveLength(1)
    expect(second.host.querySelector('[data-dil-queued]')).not.toBeNull()
    expect(second.host.textContent).toContain('可读回退')
    await unmount(first)
    expect(runners).toHaveLength(2)
    expect(second.host.querySelector('[data-dil-queued]')).toBeNull()
  })

  it('disposes the runner after a non-interactive snapshot settles, keeps the tree and hands the slot on', async () => {
    vi.useFakeTimers()
    try {
      const runners = recordRunners()
      const runnerSlots = lanes(1)
      const first = await mount({ artifactId: 'static-a', runnerSlots })
      await mount({ artifactId: 'static-b', runnerSlots })
      await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(1100) })
      expect(runners[0]!.runner.dispose).toHaveBeenCalled()
      expect(first.host.textContent).toContain('静态快照')
      expect(runners).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('updates the same runner for streamed revisions of a read-only tree', async () => {
    const runners = recordRunners()
    const view = await mount({ artifactId: 'streamed' })
    await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
    const next = { ...compiled, code: 'revision-2' } as CompiledDil
    await view.rerender({ compiled: next })
    expect(runners).toHaveLength(1)
    expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
    expect(runners[0]!.runner.update).toHaveBeenCalledWith(next)
  })

  it('moves a visible interactive view out of the pool so the next view can start', async () => {
    const runners = recordRunners()
    const runnerSlots = lanes(1)
    await mount({ artifactId: 'form-a', runnerSlots })
    await mount({ artifactId: 'form-b', runnerSlots })
    expect(runners).toHaveLength(1)
    await act(async () => runners[0]!.callbacks.onSnapshot(tree))
    expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
    expect(runners).toHaveLength(2)
  })

  it('releases the slot when the runner itself fails', async () => {
    const runners = recordRunners()
    const runnerSlots = lanes(1)
    const first = await mount({ artifactId: 'fail-a', runnerSlots })
    await mount({ artifactId: 'fail-b', runnerSlots })
    await act(async () => runners[0]!.callbacks.onFailure(new Error('DIL_RUNNER_TIMEOUT')))
    expect(runners[0]!.runner.dispose).toHaveBeenCalled()
    expect(first.host.querySelector('[data-dil-fallback]')).not.toBeNull()
    expect(runners).toHaveLength(2)
  })

  it('reuses one runner for a read-only preview that keeps streaming off screen', async () => {
    const report = observeEach()
    try {
      const runners = recordRunners()
      const view = await mount({ artifactId: 'streaming-off-screen' })
      await report(view.host, false)
      await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
      const second = { ...compiled, code: 'revision-2' } as CompiledDil
      await view.rerender({ compiled: second })
      expect(runners).toHaveLength(2)
      await act(async () => runners[1]!.callbacks.onSnapshot(staticTree))
      const third = { ...compiled, code: 'revision-3' } as CompiledDil
      await view.rerender({ compiled: third })
      expect(runners).toHaveLength(2)
      expect(runners[1]!.runner.update).toHaveBeenCalledWith(third)
    } finally { vi.unstubAllGlobals() }
  })

  it('never parks a form that was on screen when its program holds unkeyed state', async () => {
    vi.useFakeTimers()
    const report = observeEach()
    try {
      const runners = recordRunners()
      const unkeyed = { ...compiled, code: 'DIL.useState(1); DIL.useState(2, { key: "a" })', stateKeys: ['a'] } as unknown as CompiledDil
      const view = await mount({ artifactId: 'unkeyed-form', compiled: unkeyed })
      await report(view.host, true)
      await act(async () => runners[0]!.callbacks.onSnapshot(tree))
      await report(view.host, false)
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })

  it('keeps the runner of a program that can update itself, and never caches its tree', async () => {
    vi.useFakeTimers()
    try {
      const runners = recordRunners()
      const ticking = { ...compiled, code: 'DIL.useEffect(function () { setInterval(function () {}, 1000) }, [])' } as CompiledDil
      const first = await mount({ artifactId: 'clock', compiled: ticking })
      await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
      await unmount(first)
      await mount({ artifactId: 'clock', compiled: ticking })
      expect(runners).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('reuses a non-interactive snapshot on remount without starting a runner', async () => {
    const runners = recordRunners()
    const first = await mount({ artifactId: 'remount', compiled: { ...compiled, code: 'remount-code' } as CompiledDil })
    await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
    await unmount(first)
    const again = await mount({ artifactId: 'remount', compiled: { ...compiled, code: 'remount-code' } as CompiledDil })
    expect(again.host.textContent).toContain('静态快照')
    expect(runners).toHaveLength(1)
  })

  it('starts an on-screen view without waiting behind views off screen', async () => {
    const report = observeEach()
    try {
      const runners = recordRunners()
      const runnerSlots = { onScreen: createSlotPool(1), background: createSlotPool(1) }
      const above = [await mount({ artifactId: 'above-1', runnerSlots }), await mount({ artifactId: 'above-2', runnerSlots })]
      const latest = await mount({ artifactId: 'latest', runnerSlots })
      for (const view of above) await report(view.host, false)
      await report(latest.host, true)
      const started = runners.map(entry => (entry.callbacks as unknown as { container: HTMLElement }).container.closest('[data-dil-artifact-id]')!.getAttribute('data-dil-artifact-id'))
      expect(started).toContain('latest')
      expect(started).toHaveLength(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('releases an off-screen read-only runner as soon as its tree renders', async () => {
    const report = observeEach()
    try {
      const runners = recordRunners()
      const view = await mount({ artifactId: 'far-static' })
      await report(view.host, false)
      expect(runners).toHaveLength(1)
      await act(async () => runners[0]!.callbacks.onSnapshot(staticTree))
      expect(runners[0]!.runner.dispose).toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('parks a form that was never on screen as soon as it renders', async () => {
    vi.useFakeTimers()
    const report = observeEach()
    try {
      const runners = recordRunners()
      const view = await mount({ artifactId: 'never-seen-form' })
      await report(view.host, false)
      await act(async () => runners[0]!.callbacks.onSnapshot(tree))
      await act(async () => { vi.advanceTimersByTime(10) })
      expect(runners[0]!.runner.dispose).toHaveBeenCalled()
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })

  it('parks an off-screen form once its pending submit finishes', async () => {
    vi.useFakeTimers()
    const report = observeEach()
    try {
      const runners = recordRunners()
      let finishCapture: ((state: Record<string, unknown>) => void) | undefined
      const view = await mount({ artifactId: 'late-submit', onSubmit: vi.fn() })
      await report(view.host, true)
      await act(async () => runners[0]!.callbacks.onSnapshot(tree))
      runners[0]!.runner.captureState.mockImplementation(() => new Promise(resolve => { finishCapture = resolve }))
      await act(async () => view.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      await report(view.host, false)
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
      await act(async () => { finishCapture!({}); await Promise.resolve(); await Promise.resolve() })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).toHaveBeenCalled()
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })

  it('keeps a form that just left the screen on its own runner while a submit is pending, even with the pool full', async () => {
    vi.useFakeTimers()
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback) } observe() {} disconnect() {} })
    try {
      const runners = recordRunners()
      const runnerSlots = lanes(1)
      const form = await mount({ artifactId: 'leaving-form', runnerSlots, onSubmit: vi.fn() })
      await act(async () => observers[0]!([{ isIntersecting: true }]))
      await act(async () => runners[0]!.callbacks.onSnapshot(tree))
      await mount({ artifactId: 'warming', runnerSlots })
      expect(runners).toHaveLength(2)
      runners[0]!.runner.captureState.mockImplementation(() => new Promise(() => undefined))
      const element = form.host.querySelector('form')!
      await act(async () => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(runners[0]!.runner.captureState).toHaveBeenCalledOnce()
      await act(async () => observers[0]!([{ isIntersecting: false }]))
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('parks an interactive runner off screen and restarts it from the latest state on return', async () => {
    vi.useFakeTimers()
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback) } observe() {} disconnect() {} })
    try {
      const runners = recordRunners()
      const view = await mount({ artifactId: 'park', initialState: { count: 1 } })
      await act(async () => observers.forEach(callback => callback([{ isIntersecting: true }])))
      expect(runners).toHaveLength(1)
      await act(async () => { runners[0]!.callbacks.onSnapshot(tree); runners[0]!.callbacks.onStateChange({ count: 4 }) })
      await act(async () => observers.forEach(callback => callback([{ isIntersecting: false }])))
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(runners[0]!.runner.dispose).toHaveBeenCalledOnce()
      expect(runners[0]!.runner.dispose).toHaveBeenCalled()
      expect(view.host.querySelector('input[name="name"]')).not.toBeNull()
      await act(async () => observers.forEach(callback => callback([{ isIntersecting: true }])))
      expect(runners).toHaveLength(2)
      expect(runners[1]!.callbacks.initialState).toEqual({ count: 4 })
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
