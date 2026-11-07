import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Catalog, CatalogItem } from '../src/uiverse/catalog.js'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'
import { createUiverseRuntimeRegistry } from '../src/uiverse/runtime-registry.js'
import { registerUiverseRuntimeComponents } from '../src/uiverse/runtime-executable.js'
import { UiverseRuntimeHost } from '../src/uiverse/runtime-host.js'

function item(id: string, category: string, source: string): CatalogItem {
  return { id, title: id, category, author: 'fixture', tags: ['rounded'], sourceUrl: 'https://uiverse.io/fixture/x', sha256: createHash('sha256').update(source).digest('hex'), framework: 'css', warnings: [] }
}
function catalog(items: readonly CatalogItem[]): Catalog { return { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: items.length, categories: Object.fromEntries([...new Set(items.map(item => item.category))].map(category => [category, items.filter(item => item.category === category).length])), items: [...items] } }

describe('Uiverse executable registry adapter', () => {
  test('uses original archive ID in an opaque qualified executable ID and excludes missing bindings', () => {
    const buttonId = 'Buttons/demo-button', cardId = 'Cards/demo-card'
    const button = '<button>Buy now</button>', card = '<article>Author demo</article>'
    const archive = createUiverseRuntimeRegistry(catalog([item(buttonId, 'Buttons', button), item(cardId, 'Cards', card)]), { html: { [buttonId]: button, [cardId]: card } })
    const registry = new ExecutableComponentRegistry()
    const dispose = registerUiverseRuntimeComponents(registry, archive)
    expect(registry.get(`uiverse:${buttonId}`)?.rendererKey).toBe('uiverse-shadow-v1')
    expect(registry.get(`uiverse:${buttonId}`)?.family).toBe('uiverse-buttons')

    const missing = registry.evaluate(`uiverse:${buttonId}`, { source: { value: 'ordinary text' }, capabilities: { webgl: false, reducedMotion: false }, hostActionIds: ['open-evidence'] })
    expect(missing).toMatchObject({ eligible: false })
    expect(missing.reasons).toContain('UIVERSE_SOURCE_BINDING_MISSING')

    const explicit = registry.dispatch(`uiverse:${buttonId}`, {
      source: { value: { type: 'uiverse-content', bindings: {
        [buttonId]: { mode: 'interactive', text: { 'fragment/button[0]#text[0]': '查看依据' }, actions: { 'fragment/button[0]': { actionId: 'open-evidence' } } },
      } } },
      capabilities: { webgl: false, reducedMotion: false }, hostActionIds: ['open-evidence'],
    })
    expect(explicit).toMatchObject({ id: `uiverse:${buttonId}`, rendererKey: 'uiverse-shadow-v1', actionIds: ['open-evidence'], input: { componentId: buttonId } })

    const automatic = registry.dispatch(`uiverse:${cardId}`, { source: { value: '# Trustworthy Markdown' }, capabilities: { webgl: false, reducedMotion: false } })
    expect(automatic.input).toMatchObject({ componentId: cardId, values: { mode: 'read-only', projectedTextIds: ['fragment/article[0]#text[0]'] } })
    dispose()
  })

  test('registers every pinned archive ID without normalizing its slash-bearing identity', async () => {
    const host = await UiverseRuntimeHost.open(join(process.cwd(), 'resources/uiverse'))
    const registry = new ExecutableComponentRegistry()
    const dispose = registerUiverseRuntimeComponents(registry, host.registry)
    expect(registry.list()).toHaveLength(3802)
    expect(registry.get('uiverse:Buttons/0x-Sarthak_hungry-penguin-30')).toMatchObject({ rendererKey: 'uiverse-shadow-v1', family: 'uiverse-buttons' })
    dispose()
    expect(registry.list()).toEqual([])
  }, 15000)
})
