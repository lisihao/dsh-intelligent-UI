import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { UiverseRuntimeHost, UIVERSE_RUNTIME_ARCHIVE_PIN } from '../src/uiverse/runtime-host.js'

describe('Uiverse runtime host', () => {
  test('serves one verified opaque archive component and returns shared CSS only when requested', async () => {
    const host = await UiverseRuntimeHost.open(join(process.cwd(), 'resources/uiverse'))
    expect(host.registry.archive).toMatchObject({ commit: UIVERSE_RUNTIME_ARCHIVE_PIN.commit, declaredTotal: UIVERSE_RUNTIME_ARCHIVE_PIN.total, categoryCount: UIVERSE_RUNTIME_ARCHIVE_PIN.categoryCount })
    const id = 'Buttons/0x-Sarthak_hungry-penguin-30'
    const first = host.component(id)
    expect(first.component).toMatchObject({ id, sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(first.component.source).toContain('Contact Us')
    expect(first.component.sharedCss).toBeUndefined()
    expect(first.sharedCss).toBeUndefined()
    const second = host.component(id, true)
    expect(second.sharedCss?.length).toBeGreaterThan(100_000)
    expect(second.component.sharedCss).toBeUndefined()
    expect(() => host.component('uiverse:' + id)).toThrow('UIVERSE_RUNTIME_HOST_COMPONENT_ID_INVALID')
    expect(() => host.component('Buttons/not-in-archive')).toThrow('UIVERSE_RUNTIME_COMPONENT_UNKNOWN')
  }, 15000)

  test('rejects a truncated manifest even if it self-reports a structurally valid smaller inventory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uiverse-runtime-host-fixture-'))
    try {
      await Promise.all([
        writeFile(join(directory, 'catalog.json'), JSON.stringify({ formatVersion: 1, commit: UIVERSE_RUNTIME_ARCHIVE_PIN.commit, snapshotDate: 'fixture', total: 1, categories: { Buttons: 1 }, items: [] })),
        writeFile(join(directory, 'sources.json'), JSON.stringify({ formatVersion: 1, sources: {} })),
        writeFile(join(directory, 'tailwind.css'), ''),
        writeFile(join(directory, 'LICENSE'), 'MIT License'),
      ])
      await expect(UiverseRuntimeHost.open(directory)).rejects.toThrow('UIVERSE_RUNTIME_HOST_CATALOG_SNAPSHOT_INVALID')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
