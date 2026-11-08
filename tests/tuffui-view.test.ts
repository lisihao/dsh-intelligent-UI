// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ExecutableComponentDispatch } from '../src/adaptive-ui/executable-registry.js'
import { TuffUiBlockView } from '../src/tuffui/view.js'
import { TUFFUI_VISUAL_IDS } from '../src/tuffui/catalog.js'
import type { TuffUiJson } from '../src/tuffui/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type PortCall = { readonly kind: 'connect' | 'mount' | 'update' | 'dispose' | 'close', readonly value?: unknown }
const portCalls = vi.hoisted((): PortCall[] => [])
const portMock = vi.hoisted(() => ({ errorOnMount: undefined as string | undefined }))
vi.mock('../src/tuffui/frame.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/tuffui/frame.js')>()
  class MockTuffUiPortFrameHost {
    private readonly onEvent: ((event: unknown) => void) | undefined
    constructor(...args: unknown[]) { this.onEvent = typeof args[5] === 'function' ? args[5] as (event: unknown) => void : undefined }
    connect() { portCalls.push({ kind: 'connect' }) }
    mount(value: unknown) {
      portCalls.push({ kind: 'mount', value })
      if ((value as { componentId?: unknown }).componentId === portMock.errorOnMount) this.onEvent?.({ kind: 'error', code: 'OLD_COMPONENT', message: 'synthetic old component failure' })
      return value
    }
    update(value: unknown) { portCalls.push({ kind: 'update', value }); return value }
    dispose(value: unknown) { portCalls.push({ kind: 'dispose', value }) }
    close() { portCalls.push({ kind: 'close' }) }
  }
  return { ...actual, TuffUiPortFrameHost: MockTuffUiPortFrameHost }
})

const screenIds = new Set(['ai-chat', 'coding-agent', 'data-answer', 'booking-assistant', 'agent-console', 'support-widget', 'handoff-inbox'])
const mounted: Array<{ root: Root, host: HTMLDivElement }> = []

function catalog() {
  const entries = TUFFUI_VISUAL_IDS.map(id => ({
    id, kind: screenIds.has(id) ? 'block' as const : 'ui' as const, title: id, description: `Pinned ${id}`,
    sourcePath: `registry/${id}/${id}.tsx`, sha256: 'a'.repeat(64), exports: [{ name: 'Rendered', props: [{ name: 'data', optional: false, sourceType: 'Record<string, unknown>', wireType: 'object' }] }],
  }))
  const dataTable = entries.find(entry => entry.id === 'data-table')!
  dataTable.title = 'Data Table'
  dataTable.exports = [{ name: 'DataTable', props: [
    { name: 'data', optional: false, sourceType: 'DataRow[]', wireType: 'array' },
    { name: 'columns', optional: false, sourceType: 'DataColumn[]', wireType: 'array' },
    { name: 'title', optional: false, sourceType: 'string', wireType: 'string' },
  ] }]
  return { formatVersion: 1 as const, repository: 'https://github.com/yurigdesigner/tuffui.git', commit: '378f3eaac693c693d2ec845baf38bf6c0488cb37', license: 'MIT' as const, registrySha256: 'b'.repeat(64), entries }
}

const validTypeSchemas = {
  formatVersion: 1 as const,
  sourceManifestSha256: 'c'.repeat(64),
  entries: {
    'data-table': { DataTable: {
      data: { kind: 'array' as const, items: { kind: 'object' as const, properties: { id: { optional: false, schema: { kind: 'string' as const } }, task: { optional: false, schema: { kind: 'string' as const } } } } },
      columns: { kind: 'array' as const, items: { kind: 'object' as const, properties: { key: { optional: false, schema: { kind: 'string' as const } }, label: { optional: false, schema: { kind: 'string' as const } } } } },
    } },
    surface: { Rendered: { data: { kind: 'object' as const, properties: { id: { optional: false, schema: { kind: 'string' as const } } } } } },
    'status-pill': { Rendered: { data: { kind: 'object' as const, properties: { id: { optional: false, schema: { kind: 'string' as const } } } } } },
  },
}

function selection(data: TuffUiJson): ExecutableComponentDispatch {
  return {
    id: 'tuffui:data-table', family: 'content-evidence', rendererKey: 'tuffui-v1', actionIds: [],
    input: { protocolVersion: 1, mountId: 'tuff-table', componentId: 'data-table', binding: { exportName: 'DataTable', props: { data, columns: [{ key: 'task', label: 'Task' }], title: 'Observed host data' } } },
  }
}

function simpleSelection(componentId: 'surface' | 'status-pill', data: TuffUiJson, mountId = 'tuff-shared'): ExecutableComponentDispatch {
  return {
    id: `tuffui:${componentId}`, family: 'content-surface', rendererKey: 'tuffui-v1', actionIds: [],
    input: { protocolVersion: 1, mountId, componentId, binding: { exportName: 'Rendered', props: { data } } },
  }
}

function api(typeSchemas: unknown = validTypeSchemas): CompositionApi {
  return {
    componentRuntimeInfo: async () => ({ protocolVersion: 1, library: 'tuffui', sourceCommit: '378f3eaac693c693d2ec845baf38bf6c0488cb37', frameUrl: 'http://127.0.0.1:4176/tuffui-realm.html' }),
    componentCatalog: async () => ({ library: 'tuffui', catalog: catalog(), typeSchemas }),
  } as unknown as CompositionApi
}

function tree(value: ExecutableComponentDispatch, runtime: CompositionApi) {
  return h(CompositionRuntimeContext.Provider, { value: { api: runtime, sessionId: 'tuffui-view-session' } },
    h(TuffUiBlockView, { selection: value, renderMarkdown: source => source }, h('pre', null, 'original source')),
  )
}

async function render(value: ExecutableComponentDispatch, runtime: CompositionApi): Promise<HTMLDivElement> {
  const host = document.createElement('div'), root = createRoot(host)
  mounted.push({ root, host }); document.body.append(host)
  await act(async () => { root.render(tree(value, runtime)) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return host
}

async function connectRealm(host: HTMLElement, expectedMounts = 1): Promise<void> {
  const iframe = host.querySelector('iframe')
  expect(iframe).not.toBeNull()
  await act(async () => { iframe!.dispatchEvent(new Event('load')); await new Promise(resolve => setTimeout(resolve, 0)) })
  await vi.waitFor(() => expect(portCalls.filter(call => call.kind === 'mount')).toHaveLength(expectedMounts))
}

afterEach(async () => {
  for (const item of mounted.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }
  document.body.replaceChildren(); portCalls.splice(0); portMock.errorOnMount = undefined; vi.unstubAllGlobals()
})

describe('TuffUiBlockView typed realm boundary', () => {
  test('rejects a nested prop that passed the shallow mount parser before an iframe is created', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const host = await render(selection([{ task: 'missing source id' }]), api())
    await vi.waitFor(() => expect(host.querySelector('[data-tuffui-render-failure]')?.textContent).toContain('data-table.data[0].id is required'))
    expect(host.querySelector('iframe')).toBeNull()
  })

  test('rejects an invalid type-schema response before a DIL selection can reach the frame', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const host = await render(selection([{ id: 'row-1', task: 'actual source row' }]), api({ formatVersion: 1, sourceManifestSha256: 'x'.repeat(64), entries: {} }))
    await vi.waitFor(() => expect(host.querySelector('[data-tuffui-render-failure]')?.textContent).toContain('TuffUI type schema manifest is invalid.'))
    expect(host.querySelector('iframe')).toBeNull()
  })

  test('keeps an already-created realm iframe when a same-ID source binding changes', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const runtime = api(), host = await render(selection([{ id: 'row-1', task: 'first source value' }]), runtime)
    const first = host.querySelector('iframe')
    expect(first).not.toBeNull()
    expect(first?.title).toBe('TuffUI · Data Table')
    const item = mounted.at(-1)!
    await act(async () => { item.root.render(tree(selection([{ id: 'row-1', task: 'updated source value' }]), runtime)) })
    expect(host.querySelector('iframe')).toBe(first)
  })

  test('updates props through the current PortFrameHost mount without recreating the iframe', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const runtime = api(), host = await render(simpleSelection('surface', { id: 'first' }), runtime)
    await connectRealm(host)
    expect(portCalls.map(call => call.kind)).toEqual(['connect', 'mount'])
    const frame = host.querySelector('iframe'), item = mounted.at(-1)!
    await act(async () => { item.root.render(tree(simpleSelection('surface', { id: 'second' }), runtime)); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.querySelector('iframe')).toBe(frame)
    expect(portCalls.map(call => call.kind)).toEqual(['connect', 'mount', 'update'])
    expect((portCalls.at(-1)?.value as { componentId?: string }).componentId).toBe('surface')
  })

  test('disposes then mounts when a same mountId changes fixed TuffUI component, even with identical props', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const runtime = api(), host = await render(simpleSelection('surface', { id: 'same' }, 'shared-mount'), runtime)
    await connectRealm(host)
    const frame = host.querySelector('iframe'), item = mounted.at(-1)!
    await act(async () => { item.root.render(tree(simpleSelection('status-pill', { id: 'same' }, 'shared-mount'), runtime)); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.querySelector('iframe')).toBe(frame)
    expect(portCalls.map(call => call.kind)).toEqual(['connect', 'mount', 'dispose', 'mount'])
    expect(portCalls[2]?.value).toBe('shared-mount')
    expect((portCalls[3]?.value as { componentId?: string }).componentId).toBe('status-pill')
    expect(portCalls.some(call => call.kind === 'update')).toBe(false)
    expect(portCalls.some(call => call.kind === 'close')).toBe(false)
    await act(async () => { item.root.render(tree(simpleSelection('status-pill', { id: 'updated-props' }, 'shared-mount'), runtime)); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.querySelector('iframe')).toBe(frame)
    expect(portCalls.map(call => call.kind)).toEqual(['connect', 'mount', 'dispose', 'mount', 'update'])
    expect(portCalls.some(call => call.kind === 'close')).toBe(false)
  })

  test('clears an old runtime error only when the mount identity changes, then mounts the new component once', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    portMock.errorOnMount = 'surface'
    const runtime = api(), host = await render(simpleSelection('surface', { id: 'same' }, 'shared-error-mount'), runtime)
    await connectRealm(host)
    await vi.waitFor(() => expect(host.querySelector('[data-tuffui-render-failure]')?.textContent).toContain('OLD_COMPONENT: synthetic old component failure'))
    expect(host.querySelector('iframe')).toBeNull()
    const item = mounted.at(-1)!
    await act(async () => { item.root.render(tree(simpleSelection('surface', { id: 'new-props' }, 'shared-error-mount'), runtime)); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(host.querySelector('[data-tuffui-render-failure]')?.textContent).toContain('OLD_COMPONENT: synthetic old component failure')
    await act(async () => { item.root.render(tree(simpleSelection('status-pill', { id: 'new-props' }, 'shared-error-mount'), runtime)); await new Promise(resolve => setTimeout(resolve, 0)) })
    await vi.waitFor(() => expect(host.querySelector('iframe')).not.toBeNull())
    // A replacement iframe may exist, but its old frame's load receipt must
    // not authorize a mount until this element dispatches its own load event.
    expect(portCalls.filter(call => call.kind === 'mount')).toHaveLength(1)
    await connectRealm(host, 2)
    expect(host.querySelector('[data-tuffui-render-failure]')).toBeNull()
    const mounts = portCalls.filter(call => call.kind === 'mount').map(call => (call.value as { componentId?: string }).componentId)
    expect(mounts).toEqual(['surface', 'status-pill'])
  })
})
