// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DilNativeTreeView, type DilNativeTreeViewProps } from '../src/dil/view.js'
import type { DilJson } from '../src/dil/protocol.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let mounted: Array<{ root: Root, host: HTMLDivElement }> = []

function setNativeValue(control: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Test DOM has no native value setter.')
  setter.call(control, value)
}

async function mount(tree: unknown, options: Partial<DilNativeTreeViewProps> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = (nextTree: unknown, next: Partial<DilNativeTreeViewProps> = {}) => ({
    tree: nextTree,
    artifactId: 'native-tree-artifact',
    sessionId: 'native-tree-session',
    ownedHandlerIds: [],
    ownedFormActionIds: [],
    children: h('article', { 'data-original-content': true }, '保留的原始内容'),
    ...options,
    ...next,
  }) as DilNativeTreeViewProps
  await act(async () => root.render(h(DilNativeTreeView, props(tree))))
  const item = { root, host }
  mounted.push(item)
  return {
    ...item,
    async rerender(nextTree: unknown, next: Partial<DilNativeTreeViewProps> = {}) {
      await act(async () => root.render(h(DilNativeTreeView, props(nextTree, next))))
    },
  }
}

afterEach(async () => {
  for (const item of mounted) await act(async () => item.root.unmount())
  mounted = []
  document.body.replaceChildren()
})

describe('DilNativeTreeView', () => {
  it('renders source code through the existing semantic code adapter without a Worker', async () => {
    const view = await mount({ t: 'code', p: { language: 'ts' }, c: [{ t: '#text', v: 'const total = 3' }] })
    expect(view.host.querySelector('.iexp-markdown-code')).not.toBeNull()
    expect(view.host.querySelector('code[data-iexp-code-language="ts"]')?.textContent).toBe('const total = 3')
    expect(view.host.querySelector('iframe')).toBeNull()
    expect(view.host.querySelector('.iexp-dil-runner-host')).toBeNull()
    expect(view.host.querySelector('[data-dil-native-tree]')).not.toBeNull()
  })

  it('passes explicit Markdown source unchanged to the supplied semantic renderer', async () => {
    const renderMarkdown = vi.fn((source: string): ReactNode => h('article', { 'data-host-markdown': true }, source))
    const source = '## 目录\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const view = await mount({ t: 'markdown', p: { source } }, { renderMarkdown })
    expect(renderMarkdown).toHaveBeenCalledWith(source)
    expect(view.host.querySelector('[data-host-markdown]')?.textContent).toBe(source)
  })

  it('delegates a checked foreign component id, input, and local event through the native handler port', async () => {
    const onHandler = vi.fn()
    const renderComponent = vi.fn((id: string, input: DilJson, onEvent?: (event: DilJson) => void): ReactNode => h('button', { type: 'button', 'data-host-component': id, onClick: () => onEvent?.({ kind: 'toggle', value: true }) }, JSON.stringify(input)))
    const view = await mount({ t: 'component', p: { id: 'uiverse:Cards/demo-card', input: { title: 'Actual source card' }, onChange: { __dilFn: 'update-card' } } }, { ownedHandlerIds: ['update-card'], onHandler, renderComponent })
    expect(renderComponent).toHaveBeenCalledWith('uiverse:Cards/demo-card', { title: 'Actual source card' }, expect.any(Function))
    expect(onHandler).not.toHaveBeenCalled()
    await act(async () => view.host.querySelector<HTMLButtonElement>('[data-host-component="uiverse:Cards/demo-card"]')!.click())
    expect(onHandler).toHaveBeenCalledWith('update-card', [{ kind: 'toggle', value: true }])
  })

  it('keeps caller source content when a checked foreign component has no host renderer', async () => {
    const view = await mount({ t: 'component', p: { id: 'canvas:glitch', input: { title: 'Actual source effect' } } })
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('宿主组件渲染器')
    expect(view.host.querySelector('[data-original-content]')?.textContent).toBe('保留的原始内容')
  })

  it('renders source-bound table structure through native table elements', async () => {
    const view = await mount({
      t: 'table', p: { label: '实际指标' }, c: [
        { t: 'table-row', c: [{ t: 'table-cell', p: { header: true }, c: [{ t: '#text', v: '项目' }] }, { t: 'table-cell', p: { header: true }, c: [{ t: '#text', v: '值' }] }] },
        { t: 'table-row', c: [{ t: 'table-cell', c: [{ t: '#text', v: '吞吐' }] }, { t: 'table-cell', c: [{ t: '#text', v: '42' }] }] },
      ],
    })
    expect(view.host.querySelector('table.iexp-dil-table')).not.toBeNull()
    expect(view.host.querySelectorAll('th')).toHaveLength(2)
    expect(view.host.querySelectorAll('td')).toHaveLength(2)
    expect(view.host.textContent).toContain('吞吐')
  })

  it('emits a local handler only after a real input event', async () => {
    const onHandler = vi.fn()
    const view = await mount({ t: 'input', p: { name: 'title', value: 'before', onChange: { __dilFn: 'change-title' } } }, { ownedHandlerIds: ['change-title'], onHandler })
    expect(onHandler).not.toHaveBeenCalled()
    const input = view.host.querySelector<HTMLInputElement>('input[name="title"]')!
    await act(async () => {
      setNativeValue(input, 'after')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onHandler).toHaveBeenCalledOnce()
    expect(onHandler).toHaveBeenCalledWith('change-title', ['after'])
  })

  it('emits one host form action only after an explicit DOM submit and captures current fields', async () => {
    const onHandler = vi.fn()
    const onSubmit = vi.fn()
    const view = await mount({
      t: 'form', p: { action: 'save-source' }, c: [
        { t: 'input', p: { name: 'title', value: 'before', onChange: { __dilFn: 'change-title' } } },
        { t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交' }] },
      ],
    }, { ownedHandlerIds: ['change-title'], ownedFormActionIds: ['save-source'], onHandler, onSubmit })
    expect(onSubmit).not.toHaveBeenCalled()
    const input = view.host.querySelector<HTMLInputElement>('input[name="title"]')!
    await act(async () => {
      setNativeValue(input, 'after')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await view.rerender({
      t: 'form', p: { action: 'save-source' }, c: [
        { t: 'input', p: { name: 'title', value: 'after', onChange: { __dilFn: 'change-title' } } },
        { t: 'button', p: { type: 'submit' }, c: [{ t: '#text', v: '提交' }] },
      ],
    })
    const form = view.host.querySelector('form')!
    expect(form).not.toBeNull()
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(onHandler).toHaveBeenCalledWith('change-title', ['after'])
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('save-source', { fields: { title: 'after' } })
  })

  it('synchronously replaces a valid local tree when a new snapshot arrives', async () => {
    const view = await mount({ t: 'text', c: [{ t: '#text', v: 'first snapshot' }] })
    expect(view.host.textContent).toContain('first snapshot')
    await view.rerender({ t: 'text', c: [{ t: '#text', v: 'second snapshot' }] })
    expect(view.host.textContent).toContain('second snapshot')
    expect(view.host.textContent).not.toContain('first snapshot')
  })

  it('rejects an unowned handler and preserves caller source content visibly', async () => {
    const onHandler = vi.fn()
    const view = await mount({ t: 'input', p: { name: 'title', value: 'before', onChange: { __dilFn: 'not-owned' } } }, { onHandler })
    expect(onHandler).not.toHaveBeenCalled()
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('未被当前视图授权')
    expect(view.host.querySelector('[data-original-content]')?.textContent).toBe('保留的原始内容')
    expect(view.host.querySelector('input')).toBeNull()
  })

  it('rejects an otherwise owned handler when no handler port was supplied', async () => {
    const view = await mount({ t: 'input', p: { name: 'title', value: 'before', onChange: { __dilFn: 'change-title' } } }, { ownedHandlerIds: ['change-title'] })
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('onHandler')
    expect(view.host.querySelector('[data-original-content]')?.textContent).toBe('保留的原始内容')
  })

  it('rejects an otherwise owned form action when no submit port was supplied', async () => {
    const view = await mount({ t: 'form', p: { action: 'save-source' }, c: [{ t: 'input', p: { name: 'title', value: 'before', disabled: true } }] }, { ownedFormActionIds: ['save-source'] })
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('onSubmit')
    expect(view.host.querySelector('[data-original-content]')?.textContent).toBe('保留的原始内容')
  })

  it('rejects a native-unsupported prop and preserves caller source content', async () => {
    const view = await mount({ t: 'box', p: { arbitrary: 'not a DIL prop' }, c: [{ t: '#text', v: 'unsafe' }] })
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('不支持属性')
    expect(view.host.querySelector('[data-original-content]')?.textContent).toBe('保留的原始内容')
    expect(view.host.querySelector('[data-dil-native-tree]')).toBeNull()
  })
})
