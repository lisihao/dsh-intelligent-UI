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

import { DilProgramView } from '../src/dil/view.js'

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
