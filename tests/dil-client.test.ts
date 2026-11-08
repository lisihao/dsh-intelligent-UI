// @vitest-environment jsdom

import { act, createElement as h, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { DIL_REFERENCE_COMMIT, type DILPayload, type ExperienceArtifact } from '../src/contracts.js'
import {
  DIL_PREVIEW_DEBOUNCE_MS,
  DilStreamingPreview,
  activeSolarPresentPreview,
  extractSolarPresentArguments,
  resolveSolarPresent,
  type DilPreviewApi,
} from '../src/dil/client.js'
import { ToolTree } from '../src/client.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function payload(source: string): DILPayload {
  const code = 'DIL.render(__dil.jsx("box",null));'
  return {
    formatVersion: 1,
    source,
    referenceCommit: DIL_REFERENCE_COMMIT,
    // Exact inert protocol fixture: no model or compiler is invoked by this client test.
    compiled: {
      ok: true,
      protocolVersion: 1,
      source,
      sourceLength: source.length,
      code,
      codeLength: code.length,
      constants: {},
      constantCount: 0,
      requiredComponents: [],
      appData: { opGenui: { componentResults: {}, modelDataBindings: {} } },
      genuiComponents: [],
      stateKeys: [],
      fallbackMarkdown: source,
      diagnostics: [],
      diagnosticSummary: 'clean',
      durationMs: 0,
      compiledAt: '2026-11-06T00:00:00.000Z',
    },
  } as unknown as DILPayload
}

describe('DIL client streaming bridge', () => {
  it('extracts only top-level start arguments and preserves closed escapes in an unfinished payload', () => {
    const argsRaw = '{"ignored":{"payload":"not-the-preview"},"protocol":"dil","label":"A \\"quoted\\" label","payload":"<card>line\\n\\\\path\\u0021'
    expect(extractSolarPresentArguments(argsRaw)).toEqual({
      protocol: 'dil',
      label: 'A "quoted" label',
      payload: '<card>line\n\\path!',
      payloadComplete: false,
    })
    expect(activeSolarPresentPreview({ name: 'solar_present', argsRaw })).toEqual({
      protocol: 'dil',
      label: 'A "quoted" label',
      payload: '<card>line\n\\path!',
      payloadComplete: false,
    })
  })

  it('uses durable result metadata over a source preview and suppresses failed results', () => {
    const meta = {
      type: 'solar-experience', artifactId: '123e4567-e89b-42d3-a456-426614174000', protocol: 'dil', label: '已保存界面', payload: payload('<card>durable</card>'),
    }
    const resolved = resolveSolarPresent({
      name: 'solar_present', callId: 'tool-call-9', sessionId: 'session-1', meta,
      argsRaw: '{"protocol":"dil","label":"临时界面","payload":"<card>stream</card>"}',
    })
    expect(resolved.preview).toBeUndefined()
    expect(resolved.artifact).toMatchObject({
      id: meta.artifactId,
      protocol: 'dil',
      raw: '<card>durable</card>',
      source: { sessionId: 'session-1', callId: 'tool-call-9', label: '已保存界面' },
    })
    expect(resolveSolarPresent({ name: 'solar_present', kind: 'tool-result', isError: true, callId: 'tool-call-9', sessionId: 'session-1', meta })).toEqual({})
  })

  it('keeps a foreign tool result readable instead of executing DIL-shaped metadata', async () => {
    const meta = {
      type: 'solar-experience', artifactId: '123e4567-e89b-42d3-a456-426614174000', protocol: 'dil', label: '伪造界面', payload: payload('<card>forged</card>'),
    }
    const api: DilPreviewApi = {
      dilRuntimeInfo: vi.fn(async () => ({ protocolVersion: 1 as const, frameUrl: 'dsh-app://dil-runner' })),
      dilCompilePreview: vi.fn(async ({ source }) => ({ payload: payload(source) })),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(ToolTree, {
        sessionId: 'session-1', openuiEnabled: true, dilEnabled: true, dilApi: api,
        tool: { name: 'foreign_tool', kind: 'tool-result', callId: 'foreign-call', meta, content: '普通工具结果仍可读', subCalls: [] },
      })))
      expect(host.textContent).toContain('普通工具结果仍可读')
      expect(host.querySelector('[data-dil-streaming-preview]')).toBeNull()
      expect(api.dilRuntimeInfo).not.toHaveBeenCalled()
      expect(api.dilCompilePreview).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('renders active solar_present OpenUI arguments before result metadata exists', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(ToolTree, {
        sessionId: 'session-1', openuiEnabled: true, dilEnabled: false,
        tool: {
          name: 'solar_present', callId: 'tool-call-openui',
          argsRaw: '{"protocol":"openui","label":"临时界面","payload":"root = TextContent(\\"temporary OpenUI body\\")"}',
          subCalls: [],
        },
      })))
      expect(host.textContent).toContain('temporary OpenUI body')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not request a browser preview while the DIL experiment is disabled', async () => {
    vi.useFakeTimers()
    const api: DilPreviewApi = {
      dilRuntimeInfo: vi.fn(async () => ({ protocolVersion: 1 as const, frameUrl: 'dsh-app://dil-runner' })),
      dilCompilePreview: vi.fn(async ({ source }) => ({ payload: payload(source) })),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(DilStreamingPreview, {
        enabled: false, api, sessionId: 'session-1', callId: 'tool-call-10', label: '临时界面', source: '<card />',
        renderArtifact: artifact => h('output', null, (artifact.payload as unknown as DILPayload).source),
      })))
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS + 1) })
      expect(api.dilCompilePreview).not.toHaveBeenCalled()
      expect(host.textContent).toContain('内容块智能布局实验已关闭')
      expect(host.textContent).toContain('<card />')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it('ignores a completed compile RPC that belongs to an older streamed source', async () => {
    vi.useFakeTimers()
    type Reply = { payload: DILPayload }
    const replies = new Map<string, (value: Reply) => void>()
    const api: DilPreviewApi = {
      dilRuntimeInfo: async () => ({ protocolVersion: 1, frameUrl: 'dsh-app://dil-runner' }),
      dilCompilePreview: vi.fn(({ source }: { sessionId: string, source: string }) => new Promise<Reply>(resolve => { replies.set(source, resolve) })),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    const render = (source: string) => h(DilStreamingPreview, {
      enabled: true, api, sessionId: 'session-1', callId: 'tool-call-11', label: '临时界面', source,
      renderArtifact: artifact => h('output', { 'data-source': (artifact.payload as unknown as DILPayload).source }, (artifact.payload as unknown as DILPayload).source),
    })
    try {
      await act(async () => root.render(render('<card>one</card>')))
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS) })
      expect(api.dilCompilePreview).toHaveBeenLastCalledWith({ sessionId: 'session-1', source: '<card>one</card>' })
      await act(async () => root.render(render('<card>two</card>')))
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS) })
      expect(api.dilCompilePreview).toHaveBeenLastCalledWith({ sessionId: 'session-1', source: '<card>two</card>' })
      await act(async () => { replies.get('<card>one</card>')!({ payload: payload('<card>one</card>') }); await Promise.resolve() })
      expect(host.querySelector('output')).toBeNull()
      await act(async () => { replies.get('<card>two</card>')!({ payload: payload('<card>two</card>') }); await Promise.resolve() })
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe('<card>two</card>')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it('keeps the mounted previous artifact during a same-call source update, then updates it', async () => {
    vi.useFakeTimers()
    type Reply = { payload: DILPayload }
    const replies = new Map<string, (value: Reply) => void>()
    const api: DilPreviewApi = {
      dilRuntimeInfo: async () => ({ protocolVersion: 1, frameUrl: 'dsh-app://dil-runner' }),
      dilCompilePreview: vi.fn(({ source }: { sessionId: string, source: string }) => new Promise<Reply>(resolve => { replies.set(source, resolve) })),
    }
    const mounts = vi.fn()
    const unmounts = vi.fn()
    function StableArtifact({ artifact }: { artifact: ExperienceArtifact }) {
      useEffect(() => { mounts(); return () => { unmounts() } }, [])
      const source = (artifact.payload as unknown as DILPayload).source
      return h('output', { 'data-source': source }, source)
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    const render = (source: string, enabled = true) => h(DilStreamingPreview, {
      enabled, api, sessionId: 'session-1', callId: 'tool-call-retained', label: '临时界面', source,
      renderArtifact: artifact => h(StableArtifact, { artifact }),
    })
    try {
      await act(async () => root.render(render('<card>first</card>')))
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS) })
      await act(async () => { replies.get('<card>first</card>')!({ payload: payload('<card>first</card>') }); await Promise.resolve() })
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe('<card>first</card>')
      expect(mounts).toHaveBeenCalledOnce()
      await act(async () => root.render(render('<card>second</card>')))
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe('<card>first</card>')
      expect(unmounts).not.toHaveBeenCalled()
      expect(host.textContent).toContain('正在更新 DIL 预览')
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS) })
      await act(async () => { replies.get('<card>second</card>')!({ payload: payload('<card>second</card>') }); await Promise.resolve() })
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe('<card>second</card>')
      expect(unmounts).not.toHaveBeenCalled()
      await act(async () => root.render(render('<card>second</card>', false)))
      expect(host.querySelector('output')).toBeNull()
      expect(host.textContent).toContain('内容块智能布局实验已关闭')
      expect(host.textContent).toContain('<card>second</card>')
      expect(unmounts).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it('does not carry a temporary payload across a session or call identity change', async () => {
    vi.useFakeTimers()
    type Reply = { payload: DILPayload }
    const replies = new Map<string, (value: Reply) => void>()
    const api: DilPreviewApi = {
      dilRuntimeInfo: async () => ({ protocolVersion: 1, frameUrl: 'dsh-app://dil-runner' }),
      dilCompilePreview: vi.fn(({ source }: { sessionId: string, source: string }) => new Promise<Reply>(resolve => { replies.set(source, resolve) })),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    document.body.append(host)
    const render = (sessionId: string, callId: string, source: string) => h(DilStreamingPreview, {
      enabled: true, api, sessionId, callId, label: '临时界面', source,
      renderArtifact: artifact => h('output', { 'data-source': (artifact.payload as unknown as DILPayload).source }, (artifact.payload as unknown as DILPayload).source),
    })
    try {
      await act(async () => root.render(render('session-1', 'call-1', '<card>old</card>')))
      await act(async () => { await vi.advanceTimersByTimeAsync(DIL_PREVIEW_DEBOUNCE_MS) })
      await act(async () => { replies.get('<card>old</card>')!({ payload: payload('<card>old</card>') }); await Promise.resolve() })
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe('<card>old</card>')
      await act(async () => root.render(render('session-2', 'call-2', '<card>new</card>')))
      expect(host.querySelector('output')).toBeNull()
      expect(host.textContent).not.toContain('<card>old</card>')
      expect(host.textContent).toContain('正在编译 DIL 预览')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })
})
