// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIL_COMPONENT_CATALOG } from '../src/dil/catalog.js'
import type { CompiledDil, DilIntrinsicTag } from '../src/dil/protocol.js'
import {
  DIL_COMPONENT_BINDING_FORMAT_VERSION,
  DIL_NATIVE_TREE_RENDERER_KEY,
  assessDilNativeComponent,
  bindDilNativeComponent,
  dilNativeComponentDefinitions,
  type DilComponentBindingInput,
} from '../src/dil/component-bindings.js'

const runner = vi.hoisted(() => ({ callbacks: undefined as undefined | { onSnapshot(value: unknown): void }, start: vi.fn(async () => undefined), update: vi.fn(), trigger: vi.fn(), captureState: vi.fn(async () => ({})), dispose: vi.fn() }))
vi.mock('../src/dil/runtime.js', () => ({
  createDilRunner: (callbacks: { onSnapshot(value: unknown): void }) => {
    runner.callbacks = callbacks
    return runner
  },
}))

import { DilProgramView } from '../src/dil/view.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const authority = { handlerIds: ['change', 'click', 'select'], formActionIds: ['submit-actual'] }
const compiled = {
  ok: true, protocolVersion: 1, source: '<box/>', sourceLength: 6, code: 'inert', codeLength: 5,
  constants: {}, constantCount: 0, requiredComponents: [], appData: {}, genuiComponents: [], fallbackMarkdown: 'fallback', diagnostics: [], diagnosticSummary: '', stateKeys: [], durationMs: 0, compiledAt: '2026-11-06T00:00:00.000Z',
} as unknown as CompiledDil

function input(tag: DilIntrinsicTag, source: unknown, extra: Partial<DilComponentBindingInput> = {}): DilComponentBindingInput {
  return { formatVersion: DIL_COMPONENT_BINDING_FORMAT_VERSION, componentId: `dil:${tag}`, source: source as DilComponentBindingInput['source'], authority, ...extra }
}

function fixture(tag: DilIntrinsicTag): DilComponentBindingInput {
  const node = (props: Record<string, unknown> = {}, text?: string, children?: readonly unknown[]) => input(tag, { kind: 'node', tag, props, ...(text === undefined ? {} : { text }), ...(children === undefined ? {} : { children }) })
  const source = `actual:${tag}`
  switch (tag) {
    case 'box': case 'row': case 'column': case 'card': return node({ gap: 2 }, undefined, [{ kind: 'node', tag: 'text', text: source }])
    case 'grid': return node({ columns: 2 }, undefined, [{ kind: 'node', tag: 'grid-item', children: [{ kind: 'node', tag: 'text', text: source }] }])
    case 'grid-item': return node({ span: 1 }, undefined, [{ kind: 'node', tag: 'text', text: source }])
    case 'divider': return node()
    case 'spacer': return node({ size: 3 })
    case 'text': case 'title': case 'caption': case 'bold': case 'label': case 'badge': return input(tag, { kind: 'text', value: source })
    case 'code': return input(tag, { kind: 'code', value: `const value = '${source}'`, language: 'ts' })
    case 'markdown': return input(tag, { kind: 'markdown', source: `## ${source}\n\n$E=mc^2$\n\n- [目录](#x)` })
    case 'component': return node({ id: 'tuffui:data-table', input: { title: source, rows: [{ label: 'actual', value: 2 }] }, onChange: { __dilFn: 'change' } })
    case 'icon': return node({ name: 'info', label: source })
    case 'button': return node({ label: source, onClick: { __dilFn: 'click' } })
    case 'input': return node({ name: 'query', value: source, onChange: { __dilFn: 'change' } })
    case 'textarea': return node({ name: 'notes', value: source, onInput: { __dilFn: 'change' } })
    case 'checkbox': case 'switch': return node({ name: 'enabled', checked: true, onChange: { __dilFn: 'change' } })
    case 'radio': return node({ name: 'mode', value: source, checked: true, onChange: { __dilFn: 'change' } })
    case 'radio-group': case 'select': case 'segmented-control': return node({ name: 'mode', value: 'one', options: [{ label: source, value: 'one' }], onChange: { __dilFn: 'select' } })
    case 'slider': return node({ name: 'amount', min: 0, max: 10, value: 4, onChange: { __dilFn: 'change' } })
    case 'table': return input(tag, { kind: 'table', label: source, header: ['source'], rows: [[source]] })
    case 'table-row': return node({}, undefined, [{ kind: 'node', tag: 'table-cell', text: source }])
    case 'table-cell': return node({}, source)
    case 'list': return input(tag, { kind: 'list', ordered: true, items: [source] })
    case 'list-item': return node({}, source)
    case 'progress': return node({ value: 3, max: 4, label: source, showValue: true })
    case 'chart': return input(tag, { kind: 'chart', data: [{ label: source, amount: 2 }], categoryKey: 'label', dataKey: 'amount', title: source })
    case 'pie-chart': return input(tag, { kind: 'chart', data: [{ label: source, amount: 2 }], categoryKey: 'label', dataKey: 'amount', title: source })
    case 'image': return node({ src: 'data:image/png;base64,AA==', alt: source, width: 8, height: 8 })
    case 'link': return node({ href: 'https://example.test/actual', label: source })
    case 'form': return node({ action: 'submit-actual' }, undefined, [{ kind: 'node', tag: 'input', props: { name: 'query', value: source, onChange: { __dilFn: 'change' } } }])
    case 'tabs': return node({}, undefined, [
      { kind: 'node', tag: 'tab', props: { value: 'one', selected: true, onClick: { __dilFn: 'select' } }, text: source },
      { kind: 'node', tag: 'tab-panel', props: { active: true }, text: source },
    ])
    case 'tab': return node({ value: 'one', selected: true, onClick: { __dilFn: 'select' } }, source)
    case 'tab-panel': return node({ active: true }, source)
  }
}

describe('native DIL component bindings', () => {
  it('has one executable, exact-id definition for every native DIL tag', () => {
    expect(dilNativeComponentDefinitions).toHaveLength(DIL_COMPONENT_CATALOG.length)
    expect(new Set(dilNativeComponentDefinitions.map(item => item.id)).size).toBe(DIL_COMPONENT_CATALOG.length)
    expect(dilNativeComponentDefinitions.map(item => item.id).sort()).toEqual(DIL_COMPONENT_CATALOG.map(item => `dil:${item.tag}`).sort())
  })

  for (const entry of DIL_COMPONENT_CATALOG) {
    const tag = entry.tag as DilIntrinsicTag
    it(`binds real source values for dil:${tag}`, () => {
      const result = assessDilNativeComponent(fixture(tag))
      expect(result.eligible).toBe(true)
      if (!result.eligible) return
      expect(result.plan.rendererKey).toBe(DIL_NATIVE_TREE_RENDERER_KEY)
      expect(result.plan.componentId).toBe(`dil:${tag}`)
      expect(result.plan.tree.t).toBe(tag)
      expect(JSON.stringify(result.plan.tree)).toContain(tag)
    })
  }

  it('preserves code, math, and a directory in the explicit host Markdown source', () => {
    const source = '## 目录\n\n- [公式](#formula)\n\n```ts\nconst total = 3\n```\n\n$E=mc^2$'
    const plan = bindDilNativeComponent(input('markdown', { kind: 'markdown', source }))
    expect(plan.tree).toEqual({ t: 'markdown', p: { source } })
  })

  it('constructs source table children instead of reducing the table to Markdown', () => {
    const plan = bindDilNativeComponent(input('table', { kind: 'table', label: '实际指标', header: ['项目', '值'], rows: [['吞吐', 42]] }))
    expect(plan.tree.t).toBe('table')
    if (plan.tree.t === '#text') throw new Error('Expected a table tree.')
    const headerRow = plan.tree.c?.[0]
    expect(headerRow).toMatchObject({ t: 'table-row' })
    if (!headerRow || headerRow.t === '#text') throw new Error('Expected a table row.')
    expect(headerRow.c?.[0]).toMatchObject({ t: 'table-cell', p: { header: true } })
    expect(JSON.stringify(plan.tree)).toContain('吞吐')
    expect(JSON.stringify(plan.tree)).toContain('42')
  })

  it('rejects unknown component props before a tree reaches the renderer', () => {
    const result = assessDilNativeComponent(input('card', { kind: 'node', tag: 'card', props: { style: { color: 'red' } }, text: 'actual' }))
    expect(result).toEqual({ eligible: false, code: 'DIL_BINDING_PROP_UNSUPPORTED' })
  })

  it('requires local control handlers and host form actions to be explicitly owned', () => {
    expect(assessDilNativeComponent(input('button', { kind: 'node', tag: 'button', props: { label: '保存', onClick: { __dilFn: 'unowned' } } }))).toEqual({ eligible: false, code: 'DIL_BINDING_HANDLER_NOT_OWNED' })
    expect(assessDilNativeComponent(input('form', { kind: 'node', tag: 'form', props: { action: 'not-owned' }, children: [{ kind: 'node', tag: 'input', props: { name: 'x', value: 'actual', disabled: true } }] }))).toEqual({ eligible: false, code: 'DIL_BINDING_ACTION_NOT_OWNED' })
  })

  it('rejects an active control that has no real source-owned update path', () => {
    expect(assessDilNativeComponent(input('checkbox', { kind: 'node', tag: 'checkbox', props: { name: 'enabled', checked: false } }))).toEqual({ eligible: false, code: 'DIL_BINDING_HANDLER_REQUIRED' })
  })

  it('requires exact source-bound external component data while preserving JSON data for the host schema', () => {
    const externalInput = { code: 'const actual = true', sources: [{ url: 'https://example.test/source', src: 'data:image/png;base64,AA==' }], props: { data: [{ action: 'inspect' }] }, binding: { actions: [{ actionId: 'actual-action' }] } }
    const valid = bindDilNativeComponent(input('component', { kind: 'node', tag: 'component', props: { id: 'uiverse:Cards/demo-card', input: externalInput, onChange: { __dilFn: 'change' } } }))
    expect(valid.tree).toEqual({ t: 'component', p: { id: 'uiverse:Cards/demo-card', input: externalInput, onChange: { __dilFn: 'change' } } })
    expect(assessDilNativeComponent(input('component', { kind: 'node', tag: 'component', props: { id: 'tuffui:data-table', input: { value: () => 'not-json' } } }))).toEqual({ eligible: false, code: 'DIL_TREE_COMPONENT_INPUT_INVALID' })
    expect(assessDilNativeComponent(input('component', { kind: 'node', tag: 'component', props: { id: 'tuffui:data-table', input: { title: 'actual' } }, children: [{ kind: 'node', tag: 'text', text: 'children prohibited' }] }))).toEqual({ eligible: false, code: 'DIL_BINDING_COMPONENT_CHILDREN_UNSUPPORTED' })
  })

  it('is consumable by the existing native DIL view without compiling a source string', async () => {
    const plan = bindDilNativeComponent(input('table', { kind: 'table', label: '实际指标', header: ['项目'], rows: [['吞吐']] }))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(h(DilProgramView, {
      source: '', compiled, enabled: true, artifactId: 'component-bindings', sessionId: 'session-a', frameUrl: 'https://runner.invalid/dil-frame.html',
    })))
    await act(async () => runner.callbacks!.onSnapshot(plan.tree))
    expect(host.querySelector('[data-dil-tag="table"]')).not.toBeNull()
    expect(host.textContent).toContain('吞吐')
    await act(async () => root.unmount())
    host.remove()
  })
})

afterEach(() => {
  document.body.replaceChildren()
  runner.callbacks = undefined
  runner.start.mockClear(); runner.update.mockClear(); runner.trigger.mockClear(); runner.captureState.mockClear(); runner.dispose.mockClear()
})
