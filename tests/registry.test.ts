import { describe, expect, it } from 'vitest'
import { ExperienceRegistry, ExperienceRegistryError } from '../src/registry.js'

describe('ExperienceRegistry', () => {
  it('lets independent providers share a capability and routes only to the selected provider', async () => {
    const registry = new ExperienceRegistry(), calls: string[] = []
    const stopA = registry.register({ id: 'provider-a', version: '1', capabilities: ['render.content'] }, (input) => { calls.push('a'); return input })
    const stopB = registry.register({ id: 'provider-b', version: '2', capabilities: ['render.content'] }, (input) => { calls.push('b'); return { provider: 'b', input } })
    expect(registry.providersFor('render.content').map(({ id }) => id)).toEqual(['provider-a', 'provider-b'])
    expect(await registry.route('render.content', 'provider-b', 'raw')).toEqual({ provider: 'b', input: 'raw' })
    expect(calls).toEqual(['b'])
    stopA()
    expect(await registry.route('render.content', 'provider-b', 'next')).toEqual({ provider: 'b', input: 'next' })
    expect(() => registry.select('render.content', 'provider-a')).toThrow(/Unknown provider: provider-a/)
    stopB()
  })

  it('rejects duplicate provider identities deterministically without replacing the incumbent', async () => {
    const registry = new ExperienceRegistry(), handler = async (value: unknown) => value
    const stop = registry.register({ id: 'stable', version: '1', capabilities: ['render'] }, handler)
    expect(() => registry.register({ id: 'stable', version: '2', capabilities: ['other'] }, handler)).toThrow(ExperienceRegistryError)
    expect(await registry.route('render', 'stable', 42)).toBe(42)
    stop()
  })

  it('rejects implicit or unsupported routes with a named error', () => {
    const registry = new ExperienceRegistry()
    expect(() => registry.select('render', 'missing')).toThrow(ExperienceRegistryError)
    const stop = registry.register({ id: 'known', version: '1', capabilities: ['render'] }, () => null)
    expect(() => registry.select('other', 'known')).toThrow(/does not provide capability/)
    stop()
  })
})
