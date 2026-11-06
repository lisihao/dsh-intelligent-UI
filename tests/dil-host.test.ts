import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DIL_PROTOCOL, DIL_REFERENCE_COMMIT, initialSettings, type ExperienceSettings, type PublishInput } from '../src/contracts.js'
import { ExperienceControl } from '../src/control.js'
import { DilDisabledError, DilHost, DilSourceTooLargeError, installDilAuthoringPrompt } from '../src/dil/host.js'
import type { McpHost } from '../src/mcp-host.js'
import { DilHostCompilationRequiredError, ExperienceStore } from '../src/store.js'

const roots: string[] = []
async function root() { const path = await mkdtemp(join(tmpdir(), 'dil-host-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

const source = [
  'A source-owned calculator.',
  '{@body const [seats,setSeats] = DIL.useState(5)}',
  '<box gap={4}>',
  '  <title>Seats</title>',
  '  <slider value={seats} onChange={setSeats}/>',
  '  <text>{seats}</text>',
  '</box>',
].join('\n')

function settings(enabled = true): ExperienceSettings {
  return {
    ...initialSettings(),
    takeover: true,
    openui: true,
    // `enabled` deliberately stays false in the positive case: DIL is gated
    // only by the saved blockLayout experiment, not the unrelated adaptive flag.
    adaptive: { enabled: false, styleMode: 'automatic', blockLayout: enabled },
  }
}

function host(store: ExperienceStore, current: () => ExperienceSettings, options: { start?: () => Promise<{ frameUrl: string, close(): Promise<void> }>, maxArtifactBytes?: number } = {}) {
  return new DilHost({ store, maxArtifactBytes: options.maxArtifactBytes ?? 1024 * 1024, settings: async () => current() }, options.start ? { startFrameServer: options.start } : {})
}

describe('DIL Host boundary', () => {
  it('compiles preserved source, previews without writing, persists through the sole compiled path, and shares widget state', async () => {
    const path = await root(), store = new ExperienceStore(path), current = settings()
    const dil = host(store, () => current)

    const preview = await dil.compilePreview(source)
    expect(preview).toMatchObject({ formatVersion: 1, source, referenceCommit: DIL_REFERENCE_COMMIT, compiled: { source } })
    expect(await store.artifacts({ sessionId: 'session-1' })).toEqual([])

    const artifact = await dil.publish({ source: { sessionId: 'session-1', callId: 'call-1', kind: 'generated', label: 'Calculator' }, sourceText: source })
    expect(artifact).toMatchObject({ protocol: DIL_PROTOCOL, raw: source, payload: { source, referenceCommit: DIL_REFERENCE_COMMIT }, providerId: DIL_PROTOCOL })
    expect(await new ExperienceStore(path).artifacts({ sessionId: 'session-1' })).toEqual([artifact])

    const saved = await store.saveWidgetState({ sessionId: 'session-1', artifactId: artifact.id, expectedRevision: 0, state: { seats: 7 } })
    expect(saved).toEqual({ formatVersion: 1, revision: 1, state: { seats: 7 } })
    await expect(store.saveWidgetState({ sessionId: 'other-session', artifactId: artifact.id, expectedRevision: 1, state: {} })).rejects.toThrow('was not found')

    const direct: PublishInput = {
      source: { sessionId: 'session-1', kind: 'generated', label: 'Forged' },
      protocol: DIL_PROTOCOL,
      raw: source,
      payload: source,
      providerId: DIL_PROTOCOL,
    }
    await expect(store.publish(direct)).rejects.toBeInstanceOf(DilHostCompilationRequiredError)
  })

  it('rejects disabled DIL before compilation or frame-server startup', async () => {
    const store = new ExperienceStore(await root())
    const start = vi.fn(async () => ({ frameUrl: 'http://127.0.0.1:43123/runner.html', close: async () => undefined }))
    const dil = host(store, () => settings(false), { start })
    const stop = dil.start()
    await expect(dil.compilePreview(source)).rejects.toBeInstanceOf(DilDisabledError)
    await expect(dil.runtimeInfo()).rejects.toThrow('DIL_DISABLED')
    expect(start).not.toHaveBeenCalled()
    stop()
  })

  it('enforces the configured source byte boundary before invoking the compiler', async () => {
    const store = new ExperienceStore(await root()), dil = host(store, () => settings(), { maxArtifactBytes: 64 })
    await expect(dil.compilePreview('x'.repeat(65))).rejects.toBeInstanceOf(DilSourceTooLargeError)
  })

  it('starts the static frame server lazily and closes it with the plugin lifecycle', async () => {
    const store = new ExperienceStore(await root())
    const close = vi.fn(async () => undefined)
    const start = vi.fn(async () => ({ frameUrl: 'http://127.0.0.1:43123/runner.html', close }))
    const dil = host(store, () => settings(), { start })
    const stop = dil.start()
    expect(start).not.toHaveBeenCalled()
    await expect(dil.runtimeInfo()).resolves.toEqual({ protocolVersion: 1, frameUrl: 'http://127.0.0.1:43123/runner.html' })
    expect(start).toHaveBeenCalledTimes(1)
    stop()
    await Promise.resolve()
    await Promise.resolve()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('uses source-only DIL input for control publishing and preview RPCs, with owner enforcement', async () => {
    const store = new ExperienceStore(await root()), current = settings(), dil = host(store, () => current)
    const ctx = new Context()
    const control = new ExperienceControl(ctx, store, {} as McpHost, undefined, dil)
    const preview = await control.dilCompilePreview({ sessionId: 'session-1', source })
    expect(preview.payload.source).toBe(source)
    expect(await store.artifacts({ sessionId: 'session-1' })).toEqual([])

    const artifact = await control.publish({
      source: { sessionId: 'session-1', callId: 'call-1', kind: 'generated', label: 'Calculator' },
      protocol: DIL_PROTOCOL,
      raw: source,
      payload: source,
      providerId: 'untrusted-ui-provider',
    })
    expect(artifact).toMatchObject({ protocol: DIL_PROTOCOL, providerId: DIL_PROTOCOL, raw: source, payload: { source } })
    await expect(control.publish({
      source: { sessionId: 'session-1', kind: 'generated', label: 'Forged' },
      protocol: DIL_PROTOCOL,
      raw: source,
      payload: { formatVersion: 1, source, compiled: 'not allowed' },
      providerId: DIL_PROTOCOL,
    })).rejects.toThrow()

    Object.defineProperty(ctx, 'invocation', { configurable: true, value: { peer: { principal: { kind: 'api' } } } })
    await expect(control.dilCompilePreview({ sessionId: 'session-1', source })).rejects.toThrow('EXPERIENCE_OWNER_REQUIRED')
  })

  it('rejects an unknown inner durable version when loading persisted DIL', async () => {
    const path = await root(), store = new ExperienceStore(path), dil = host(store, () => settings())
    const artifact = await dil.publish({ source: { sessionId: 'session-1', kind: 'generated', label: 'Calculator' }, sourceText: source })
    const file = join(path, 'artifacts', encodeURIComponent('session-1'), `${artifact.id}.json`)
    const stored = JSON.parse(await readFile(file, 'utf8')) as { payload: Record<string, unknown> }
    await writeFile(file, JSON.stringify({ ...stored, payload: { ...stored.payload, formatVersion: 2 } }))
    await expect(new ExperienceStore(path).artifacts({ sessionId: 'session-1' })).rejects.toThrow(/Invalid stored data/)
  })

  it('registers and disposes an optional system-prompt section without requiring the service', () => {
    let current = settings()
    const dispose = vi.fn()
    const section = vi.fn((_input: { name: string, order: number, text: () => string }) => dispose)
    let cleanup: (() => void) | undefined
    const child = {
      get: () => ({ section }),
      effect: (callback: () => () => void) => { cleanup = callback(); return cleanup },
    }
    const present = { inject: (_dependencies: unknown, callback: (value: typeof child) => unknown) => callback(child) } as unknown as Context
    installDilAuthoringPrompt(present, () => current)
    expect(section).toHaveBeenCalledOnce()
    const registered = section.mock.calls[0]![0]
    expect(registered.text()).toContain('OpenUI Lang remains available')
    expect(registered.text()).toContain('solar_ui_catalog')
    cleanup?.()
    expect(dispose).toHaveBeenCalledOnce()

    const absent = { inject: () => undefined } as unknown as Context
    expect(() => installDilAuthoringPrompt(absent, () => current)).not.toThrow()
  })
})
