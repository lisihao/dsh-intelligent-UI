import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createLibraryTools, dshSkillContent, UiComponentsControl } from '../src/uiverse/host.js'
import { idInput, previewInput, searchInput, UI_TOOL_NAMES, type LibraryContentApi } from '../src/uiverse/remote.js'

function api(): LibraryContentApi {
  return { search: vi.fn(async () => ({ formatVersion: 1 as const, commit: 'pinned', snapshotDate: '2024-09-02', archiveTotal: 1, categories: ['Buttons'], total: 0, items: [], offset: 0, limit: 20 })), source: vi.fn(async () => { throw new Error('MISSING_COMPONENT') }), preview: vi.fn(async () => { throw new Error('MISSING_COMPONENT') }) }
}

describe('DSH component boundary', () => {
  test('DSH skill routes to the three installed tools and preserves portable adaptation policies', async () => {
    const portable = await readFile(new URL('../skills/uiverse-components/SKILL.md', import.meta.url), 'utf8')
    const adapted = dshSkillContent(portable)
    expect(adapted.startsWith('DSH mode:')).toBe(true)
    expect(adapted).toContain('Portable CLI examples apply only to Codex/Claude installations')
    expect(adapted).not.toContain('SKILL_ROOT/lib/cli.mjs')
    for (const name of ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview']) expect(adapted).toContain(`"name":"${name}"`)
    const heading = '## Adapt within the user\'s task'
    expect(adapted.slice(adapted.indexOf(heading))).toBe(portable.slice(portable.indexOf(heading)))
    expect(adapted).toContain('Read the complete `source` result')
    expect(adapted).toContain('adbd2adde0a299a3956ea288fb444ec01891ca41')
    expect(() => dshSkillContent('# unsupported replacement')).toThrow('UIVERSE_SKILL_FORMAT_INVALID')
  })
  test('schemas reject unknown input, unsafe offsets and incompatible preview modes', () => {
    expect(searchInput.parse({ query: ' button ', limit: 3 })).toMatchObject({ query: 'button', limit: 3, offset: 0 })
    expect(() => searchInput.parse({ limit: 49 })).toThrow()
    expect(() => searchInput.parse({ offset: -1 })).toThrow()
    expect(() => searchInput.parse({ remoteUrl: 'https://example.test' })).toThrow()
    expect(() => idInput.parse({ id: '' })).toThrow()
    expect(() => previewInput.parse({ id: 'component', colorScheme: 'system' })).toThrow()
    expect(previewInput.parse({ id: 'component' })).toMatchObject({ reducedMotion: true, colorScheme: 'light' })
  })

  test('three tools execute through the published runtime and deregister exactly', async () => {
    const ctx = new Context()
    const removePrompt = ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
    const runtime = new ToolRuntime(ctx)
    const service = api()
    const unregister = createLibraryTools(service).map(tool => runtime.register(tool))
    try {
      const result = await runtime.execute({ callId: 'uiverse-search' as Parameters<typeof runtime.execute>[0]['callId'], name: 'solar_ui_search', arguments: { query: 'button' }, signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(service.search).toHaveBeenCalledWith({ query: 'button' })
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ formatVersion: 1, commit: 'pinned', snapshotDate: '2024-09-02', archiveTotal: 1, categories: ['Buttons'], total: 0, items: [], offset: 0, limit: 20 }) }])
      const failure = await runtime.execute({ callId: 'uiverse-source' as Parameters<typeof runtime.execute>[0]['callId'], name: 'solar_ui_source', arguments: { id: 'missing' }, signal: new AbortController().signal })
      expect(failure.isError).toBe(true)
      expect(JSON.stringify(failure)).toContain('MISSING_COMPONENT')
      expect(runtime.get('solar_ui_preview')).toBeDefined()
    } finally { for (const remove of unregister) remove(); await removePrompt() }
    for (const name of ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview']) expect(runtime.get(name)).toBeUndefined()
  })

  test('Host control only delegates reads and enforces local-owner invocation', async () => {
    const ctx = new Context()
    const service = api()
    const control = new UiComponentsControl(ctx, service)
    await control.search({ query: 'quiet' })
    expect(service.search).toHaveBeenCalledWith({ query: 'quiet' })
    Object.defineProperty(ctx, 'invocation', { configurable: true, value: { peer: { principal: { kind: 'anonymous' } } } })
    await expect(control.search({})).rejects.toThrow('UI_COMPONENTS_OWNER_REQUIRED')
    await expect(control.toolStatus()).rejects.toThrow('UI_COMPONENTS_OWNER_REQUIRED')
    expect(service.search).toHaveBeenCalledTimes(1)
  })

  test('registration status observes the live public registry and refreshes missing tools without execution', async () => {
    const ctx = new Context()
    const removePrompt = ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
    const runtime = new ToolRuntime(ctx)
    const service = api()
    const control = new UiComponentsControl(ctx, service)
    const execute = vi.spyOn(runtime, 'execute')
    const removers = createLibraryTools(service).map(tool => runtime.register(tool))
    try {
      expect((await control.toolStatus()).tools).toEqual(UI_TOOL_NAMES.map(name => ({ name, registered: true })))
      removers[1]?.()
      expect((await control.toolStatus()).tools).toEqual([
        { name: 'solar_ui_search', registered: true },
        { name: 'solar_ui_source', registered: false },
        { name: 'solar_ui_preview', registered: true },
      ])
      expect(execute).not.toHaveBeenCalled()
      expect(service.search).not.toHaveBeenCalled()
      expect(service.source).not.toHaveBeenCalled()
      expect(service.preview).not.toHaveBeenCalled()
      vi.spyOn(runtime, 'get').mockImplementation(() => { throw new Error('REGISTRY_UNAVAILABLE') })
      await expect(control.toolStatus()).rejects.toThrow('REGISTRY_UNAVAILABLE')
    } finally { vi.restoreAllMocks(); for (const remove of removers) remove(); await removePrompt() }
  })
})
