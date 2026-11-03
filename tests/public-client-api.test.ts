// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client.js'
import { openUiWidgets } from '../src/presentation.js'
import type { DocumentViewProps, IntelligentUiClient } from '../src/public-api.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('public client document service', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('publishes the existing registry plus a document view and releases the service on disposal', async () => {
    vi.useFakeTimers()
    const services = new Map<string, unknown>()
    const cleanups: Array<() => void> = []
    const sessions = { using: vi.fn() }
    const wire = {
      settings: vi.fn(async () => ({ ok: true as const, value: { formatVersion: 1 as const, revision: 0, takeover: false, openui: true, mcpApps: false } })),
      saveSettings: vi.fn(), artifacts: vi.fn(), publish: vi.fn(),
    }
    const provide = vi.fn((key: string, service: unknown) => {
      services.set(key, service)
      return () => { if (services.get(key) === service) services.delete(key) }
    })
    const ctx = {
      inject: () => () => {},
      effect: (callback: () => () => void) => { const cleanup = callback(); cleanups.push(cleanup); return cleanup },
      provide,
      get: (key: string) => key === 'sessions' ? sessions : key === 'theme' ? { getTheme: () => ({ active: { colorScheme: 'light' } }) } : key === 'remote.solarExperience' ? wire : services.get(key),
      on: () => () => {},
      slots: { register: () => () => {}, inject: (_name: string, callback: () => () => void) => callback(), entriesOfSlot: () => [], subscribe: () => () => {} },
      remote: { $mount: async () => async () => {} },
    } as unknown as Context
    apply(ctx)
    await vi.advanceTimersByTimeAsync(0)

    const service = services.get('solarExperienceUi') as IntelligentUiClient
    expect(service).toBe(openUiWidgets)
    expect(service.register).toBe(openUiWidgets.register)
    expect(service.getSnapshot).toBe(openUiWidgets.getSnapshot)
    expect(service.subscribe).toBe(openUiWidgets.subscribe)
    expect(service.loadCanvasEffect).toBeTypeOf('function')
    expect(service.createCanvasHtmlTextureBridge).toBeTypeOf('function')
    expect(service.createCanvasParticleScrollBridge).toBeTypeOf('function')
    expect(service.createCanvasIsolatedEffect).toBeTypeOf('function')
    expect(service.createCanvasHtmlEffect).toBeTypeOf('function')
    const observed = vi.fn(), unsubscribe = service.subscribe(observed)
    const unregister = service.register('public-service-test', {})
    expect(observed).toHaveBeenCalledTimes(1)
    unregister(); expect(observed).toHaveBeenCalledTimes(2); unsubscribe()

    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
    const props: DocumentViewProps = { documentId: 'external-report', value: '**展示**', raw: '原始文档', mode: 'compare', source: { label: '公开来源' } }
    await act(async () => root.render(h(service.DocumentView, props)))
    expect(host.querySelector('.iexp-reply-surface strong')?.textContent).toBe('展示')
    expect(host.querySelector('.iexp-raw-output pre')?.textContent).toBe('原始文档')
    expect(host.querySelector('.iexp-source-label')?.textContent).toContain('公开来源')
    expect(sessions.using).not.toHaveBeenCalled()
    expect(wire.publish).not.toHaveBeenCalled()
    expect(wire.artifacts).not.toHaveBeenCalled()

    await act(async () => root.unmount()); host.remove()
    expect(document.querySelector('[data-solar-experience]')).not.toBeNull()
    for (const cleanup of cleanups.reverse()) cleanup()
    expect(services.has('solarExperienceUi')).toBe(false)
    expect(document.querySelector('[data-solar-experience]')).toBeNull()
  })

  it('publishes a type-only package path and gives host consumers typed registry and document props', () => {
    const contextClient = (context: Context): IntelligentUiClient | undefined => context.get('solarExperienceUi')
    expectTypeOf(contextClient).returns.toEqualTypeOf<IntelligentUiClient | undefined>()
    expectTypeOf<IntelligentUiClient['DocumentView']>().parameter(0).toMatchTypeOf<DocumentViewProps>()
    const packageJson = require('../package.json') as { exports: Record<string, unknown> }
    expect(packageJson.exports['./public-api']).toEqual({ types: './lib/types/public-api.d.ts' })
  })
})
