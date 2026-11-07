import { describe, expect, it } from 'vitest'
import {
  ExecutableComponentRegistry,
  ExecutableComponentRegistryError,
  executableComponentSelection,
  type ExecutableComponentDefinition,
  type ExecutableJson,
} from '../src/adaptive-ui/executable-registry.js'

const jsonSchema = { parse(value: unknown): ExecutableJson { return value as ExecutableJson } }

function component(id: string, overrides: Partial<ExecutableComponentDefinition> = {}): ExecutableComponentDefinition {
  return {
    id,
    family: 'native',
    title: id,
    suitability: 'A source-bound display component.',
    rendererKey: `renderer:${id}`,
    inputSchema: jsonSchema,
    bind: () => ({ eligible: true, input: { id }, reasons: ['source:fixture'] }),
    ...overrides,
  }
}

const context = { source: { kind: 'fixture' }, capabilities: { webgl: false, reducedMotion: false }, hostActionIds: ['submit'] }

describe('ExecutableComponentRegistry', () => {
  it('accepts only a complete executable contract and prevents duplicate IDs', () => {
    const registry = new ExecutableComponentRegistry()
    expect(() => registry.register({ id: 'metadata-only' } as unknown as ExecutableComponentDefinition)).toThrow(ExecutableComponentRegistryError)
    const dispose = registry.register(component('native:reading'))
    try { registry.register(component('native:reading')); throw new Error('Expected duplicate registration to throw.') }
    catch (error) { expect(error).toMatchObject({ code: 'EXECUTABLE_COMPONENT_DUPLICATE' }) }
    expect(registry.list().map(entry => entry.id)).toEqual(['native:reading'])
    dispose()
    expect(registry.list()).toEqual([])
  })

  it('audits every definition, preserves an ineligibility reason, and dispatches the same selected ID', () => {
    const registry = new ExecutableComponentRegistry()
    registry.register(component('native:reading'))
    registry.register(component('canvas:motion', {
      family: 'canvas',
      bind: value => value.capabilities.webgl
        ? { eligible: true, input: { kind: 'canvas' }, reasons: ['capability:webgl'] }
        : { eligible: false, reasons: ['capability:webgl-required'] },
    }))
    const audit = registry.audit(context)
    expect(audit.eligibleIds).toEqual(['native:reading'])
    expect(audit.excluded).toEqual([{ id: 'canvas:motion', reasons: ['capability:webgl-required'] }])
    const dispatch = registry.dispatch('native:reading', context)
    expect(dispatch).toEqual({ id: 'native:reading', family: 'native', rendererKey: 'renderer:native:reading', input: { id: 'native:reading' }, actionIds: [] })
    try { registry.dispatch('canvas:motion', context); throw new Error('Expected ineligible dispatch to throw.') }
    catch (error) { expect(error).toMatchObject({ code: 'EXECUTABLE_COMPONENT_SELECTION_INELIGIBLE' }) }
  })

  it('rejects non-JSON input and host actions the Host did not explicitly own', () => {
    const registry = new ExecutableComponentRegistry()
    registry.register(component('native:invalid-input', { bind: () => ({ eligible: true, input: new Date(), reasons: ['fixture'] }) }))
    registry.register(component('native:unknown-action', { bind: () => ({ eligible: true, input: { value: 1 }, reasons: ['fixture'], actionIds: ['delete'] }) }))
    const audit = registry.audit(context)
    expect(audit.excluded).toEqual([
      { id: 'native:invalid-input', reasons: ['EXECUTABLE_COMPONENT_INPUT_INVALID'] },
      { id: 'native:unknown-action', reasons: ['EXECUTABLE_COMPONENT_ACTION_NOT_HOST_OWNED'] },
    ])
  })

  it('allows a declared action ID but returns it as inert dispatch data', () => {
    const registry = new ExecutableComponentRegistry()
    registry.register(component('native:button', { bind: () => ({ eligible: true, input: { label: 'Submit' }, reasons: ['source:form'], actionIds: ['submit'] }) }))
    const dispatch = registry.dispatch('native:button', context)
    expect(dispatch.actionIds).toEqual(['submit'])
    expect(dispatch.rendererKey).toBe('renderer:native:button')
    expect(executableComponentSelection(dispatch)).toEqual({ id: 'native:button', family: 'native', rendererKey: 'renderer:native:button', actionIds: ['submit'] })
    expect(Object.hasOwn(executableComponentSelection(dispatch), 'input')).toBe(false)
  })

  it('preserves an upstream opaque source ID through registration and same-ID dispatch', () => {
    const registry = new ExecutableComponentRegistry()
    const sourceId = 'uiverse:Buttons/0x-Sarthak_hungry-penguin-30'
    registry.register({
      id: sourceId,
      family: 'uiverse',
      title: 'Hungry penguin',
      suitability: 'A bound Uiverse button source.',
      rendererKey: 'uiverse-runtime',
      inputSchema: jsonSchema,
      bind: () => ({ eligible: true, input: { sourceId }, reasons: ['source:bound'] }),
    })
    expect(registry.audit(context).eligibleIds).toEqual([sourceId])
    expect(registry.dispatch(sourceId, context)).toMatchObject({ id: sourceId, rendererKey: 'uiverse-runtime', input: { sourceId } })
  })

  it('does not retain bound source input in a large audit, but rebinds it for the selected dispatch', () => {
    const registry = new ExecutableComponentRegistry()
    const source = `AUDIT-MUST-NOT-RETAIN-SOURCE:${'x'.repeat(4_096)}`
    for (let index = 0; index < 3_802; index++) {
      const id = `archive:${String(index).padStart(4, '0')}`
      registry.register(component(id, { family: 'archive', bind: () => ({ eligible: true, input: { id, source }, reasons: ['source:archive'] }) }))
    }
    const audit = registry.audit({ ...context, source: { kind: 'archive' } })
    expect(audit.entries).toHaveLength(3_802)
    expect(audit.entries.every(entry => !Object.hasOwn(entry, 'input'))).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('AUDIT-MUST-NOT-RETAIN-SOURCE')
    const dispatch = registry.dispatch('archive:3801', { ...context, source: { kind: 'archive' } })
    expect(dispatch.input).toMatchObject({ id: 'archive:3801', source: expect.stringContaining('AUDIT-MUST-NOT-RETAIN-SOURCE') })
  })

  it('has named JSON boundary failures instead of coercing source data', () => {
    const registry = new ExecutableComponentRegistry()
    registry.register(component('native:cycle', {
      bind: () => {
        const input: { self?: unknown } = {}
        input.self = input
        return { eligible: true, input, reasons: ['fixture'] }
      },
    }))
    const entry = registry.audit(context).entries[0]!
    expect(entry).toMatchObject({ eligible: false, reasons: ['EXECUTABLE_COMPONENT_INPUT_CYCLE'] })
    expect(() => registry.evaluate('missing:component', context)).toThrow(ExecutableComponentRegistryError)
  })
})
