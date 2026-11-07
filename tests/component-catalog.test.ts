import { describe, expect, it } from 'vitest'
import { executableComponentContract, type ComponentCatalogSources } from '../src/adaptive-ui/component-catalog.js'
import { createSourceBlockComponentRegistry } from '../src/adaptive-ui/source-block-components.js'

function sources(): ComponentCatalogSources {
  return { registry: createSourceBlockComponentRegistry(), tuffui: { manifest: { commit: 'fixed-source' }, byId: new Map() } as unknown as ComponentCatalogSources['tuffui'], tuffuiTypes: { formatVersion: 1, sourceManifestSha256: 'test', entries: {} }, uiverse: { archive: { commit: 'fixed-source' }, components: [] } as unknown as ComponentCatalogSources['uiverse'] }
}
describe('same-ID component contract discovery', () => {
  it('exposes a native component accepted by the actual registry', () => {
    const result = executableComponentContract('dil:code', sources()) as { id: string, native: { tag: string, sourceKinds: string[] } }
    expect(result.id).toBe('dil:code')
    expect(result.native.tag).toBe('code')
    expect(result.native.sourceKinds).toContain('code')
  })
  it('rejects unknown or unregistered library entries rather than supplying a generic contract', () => {
    expect(() => executableComponentContract('tuffui:invented', sources())).toThrow('EXECUTABLE_COMPONENT_UNKNOWN')
  })
  it('delegates registered external contracts without exposing internal mount authority', () => {
    const context = sources()
    const external = { tag: 'component', input: { content: 'actual source Markdown' }, event: 'local only' }
    context.libraryContract = id => id === 'uiverse:soft-relief:card' ? external : undefined
    expect(executableComponentContract('uiverse:soft-relief:card', context)).toMatchObject({ id: 'uiverse:soft-relief:card', dil: external })
  })
})
