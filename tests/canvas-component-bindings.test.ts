import { describe, expect, it } from 'vitest'
import { CANVAS_UI_COMPONENTS } from '../src/canvas-catalog.js'
import {
  CANVAS_COMPONENT_IDS,
  CANVAS_COMPONENT_RENDERER_KEY,
  bindCanvasComponentSource,
  getCanvasComponentInputContract,
  parseCanvasComponentInput,
  registerCanvasComponents,
} from '../src/adaptive-ui/canvas-component-bindings.js'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'

const usable = { capabilities: { webgl: true, reducedMotion: false } }

describe('Canvas executable component bindings', () => {
  it('registers every fixed Canvas catalog ID once with one real renderer key', () => {
    const registry = new ExecutableComponentRegistry()
    const dispose = registerCanvasComponents(registry)
    expect(CANVAS_COMPONENT_IDS).toEqual(CANVAS_UI_COMPONENTS.map(component => `canvas:${component.slug}`))
    expect(registry.list().map(component => component.id)).toEqual(CANVAS_COMPONENT_IDS.slice().sort())
    expect(registry.list()).toHaveLength(35)
    expect(registry.list().every(component => component.rendererKey === CANVAS_COMPONENT_RENDERER_KEY && component.family === 'canvas')).toBe(true)
    dispose()
    expect(registry.list()).toEqual([])
  })

  it('offers only source-backed text effects and keeps the original source requirement explicit', () => {
    const registry = new ExecutableComponentRegistry()
    registerCanvasComponents(registry)
    const source = 'One noninteractive paragraph.\n\nAnother retained paragraph.'
    const audit = registry.audit({ ...usable, source })
    expect(audit.eligibleIds).toEqual(expect.arrayContaining(['canvas:ripple', 'canvas:bubble', 'canvas:liquid']))
    expect(audit.eligibleIds).not.toEqual(expect.arrayContaining(['canvas:ascii-sweep', 'canvas:ascii-object', 'canvas:magnify']))
    const selected = registry.dispatch('canvas:bubble', { ...usable, source })
    expect(selected).toMatchObject({ id: 'canvas:bubble', rendererKey: 'canvas-component', input: { kind: 'canvas-html', component: 'bubble', source } })
    expect(selected.actionIds).toEqual([])
  })

  it('recognizes the actual Host decision envelope without unwrapping ordinary JSON value fields', () => {
    const registry = new ExecutableComponentRegistry()
    registerCanvasComponents(registry)
    const markdown = 'One retained paragraph.\n\nA second retained paragraph.'
    const hostEnvelope = {
      id: 'block-7',
      reference: { id: 'block-7', path: [2, 1], kind: 'paragraph', start: 12, end: 68 },
      value: markdown,
      recipes: [],
    }
    expect(registry.dispatch('canvas:bubble', { ...usable, source: hostEnvelope })).toMatchObject({ input: { kind: 'canvas-html', component: 'bubble', source: markdown } })
    const ordinary = { value: markdown, kind: 'paragraph' }
    expect(registry.audit({ ...usable, source: ordinary }).eligibleIds).not.toContain('canvas:bubble')
  })

  it('exports the same pure source binding used by the registry for DIL', () => {
    const source = 'One retained paragraph.\n\nA second retained paragraph.'
    expect(bindCanvasComponentSource('canvas:bubble', source, usable.capabilities)).toMatchObject({ eligible: true, input: { kind: 'canvas-html', component: 'bubble', source } })
    expect(bindCanvasComponentSource('canvas:particle-object', { kind: 'canvas-object-ref', sourceRef: 'blob:forged', assetKind: 'glb' }, usable.capabilities)).toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['source:actual-object-record']),
    })
  })

  it('requires two actual source panels for ASCII Sweep and never substitutes a demo panel', () => {
    const registry = new ExecutableComponentRegistry()
    registerCanvasComponents(registry)
    const primary = 'Primary source paragraph.\n\nStill retained.'
    const alternate = 'Alternate source paragraph.\n\nAlso retained.'
    const source = { kind: 'canvas-html-pair', primary, alternate }
    const selected = registry.dispatch('canvas:ascii-sweep', { ...usable, source })
    expect(selected).toMatchObject({ input: { kind: 'canvas-html-pair', component: 'ascii-sweep', primary, alternate } })
  })

  it('derives all six object candidates from a real source declaration but never accepts a self-certified model blob', () => {
    const registry = new ExecutableComponentRegistry()
    registerCanvasComponents(registry)
    const actual = { url: 'blob:https://dsh.invalid/actual-source', type: 'glb' }
    const audit = registry.audit({ ...usable, source: actual })
    const objectIds = ['ascii-object', 'dithered-object', 'glass-object', 'ink-object', 'liquid-object', 'particle-object'].map(slug => `canvas:${slug}`)
    expect(audit.eligibleIds).toEqual(expect.arrayContaining(objectIds))
    const selected = registry.dispatch('canvas:particle-object', { ...usable, source: actual })
    expect(selected).toMatchObject({
      input: { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: actual.url, assetKind: 'glb' },
    })
    expect(JSON.stringify(selected.input)).not.toContain('verified')
    expect(JSON.stringify(selected.input)).not.toContain('objectUrl')

    const fakeModelAsset = { kind: 'canvas-object-ref', component: 'particle-object', sourceRef: actual.url, assetKind: 'glb', verified: true, objectUrl: 'blob:https://dsh.invalid/forged' }
    expect(registry.audit({ ...usable, source: fakeModelAsset }).eligibleIds).not.toEqual(expect.arrayContaining(objectIds))
  })

  it('exports JSON-safe bridge contracts and rejects object URL/self-verification fields from DIL input', () => {
    const object = getCanvasComponentInputContract('canvas:liquid-object')
    expect(object).toMatchObject({ rendererKey: 'canvas-component', sourceRetention: 'required', authorInputShape: { source: 'actual-current-object-source' }, internalInputShape: { kind: 'canvas-object-ref' } })
    expect(object?.internalInputShape).not.toHaveProperty('verified')
    expect(object?.internalInputShape).not.toHaveProperty('objectUrl')
    expect(getCanvasComponentInputContract('canvas:not-real')).toBeUndefined()
    expect(() => parseCanvasComponentInput('canvas:liquid-object', { kind: 'canvas-object-ref', component: 'liquid-object', sourceRef: 'blob:source', assetKind: 'glb', verified: true })).toThrow('CANVAS_COMPONENT_INPUT_INVALID')
    expect(parseCanvasComponentInput('canvas:liquid-object', { kind: 'canvas-object-ref', component: 'liquid-object', sourceRef: 'blob:source', assetKind: 'glb' })).toMatchObject({ component: 'liquid-object' })
  })
})
