import { describe, expect, it } from 'vitest'
import {
  CANVAS_UI_COMMIT, CANVAS_UI_COMPONENTS, CANVAS_UI_LICENSE, CANVAS_UI_LICENSE_URL,
  canvasFactoryContract, canvasFactoryName, canvasRegistryName, canvasRegistryUrl, findCanvasComponent, searchCanvasComponents,
  type CanvasFramework, type CanvasRenderer,
} from '../src/canvas-catalog.js'

// Public catalog identities at the pinned upstream commit; no upstream component source is copied.
const upstreamSlugs = [
  'ascii-object', 'ascii-sweep', 'asciify', 'bend', 'blaze', 'bubble', 'canvas', 'cloth', 'clouds',
  'decrypt-reveal', 'dithered-object', 'displacement', 'droplets', 'flame-wrap', 'force-field', 'frost',
  'glass', 'glass-object', 'glitch', 'glyph-rain', 'grid', 'hex-float', 'ink-object', 'laser', 'liquid',
  'magnify', 'particle-object', 'particle-reveal', 'particle-scroll', 'peel', 'retro-dither', 'ripple',
  'shatter', 'liquid-object', 'vhs',
]
const objectSlugs = ['ascii-object', 'dithered-object', 'glass-object', 'ink-object', 'liquid-object', 'particle-object']

describe('Canvas UI metadata catalog', () => {
  it('covers the entire pinned upstream catalog once with stable attribution', () => {
    expect(CANVAS_UI_COMPONENTS.map(item => item.slug)).toEqual(upstreamSlugs)
    expect(new Set(CANVAS_UI_COMPONENTS.map(item => item.slug)).size).toBe(35)
    expect(CANVAS_UI_COMPONENTS.every(item => item.documentationUrl === `https://canvasui.dev/docs/components/${item.slug}`)).toBe(true)
    expect(CANVAS_UI_COMPONENTS.every(item => item.upstream.commit === CANVAS_UI_COMMIT && item.upstream.license === CANVAS_UI_LICENSE && item.upstream.licenseUrl === CANVAS_UI_LICENSE_URL)).toBe(true)
    expect(CANVAS_UI_LICENSE).toBe('MIT + Commons Clause 1.0')
    expect(CANVAS_UI_COMPONENTS.every(item => !('source' in item) && !('runtimeAvailable' in item))).toBe(true)
  })

  it('distinguishes model/image effects from effects requiring HTML capture for full fidelity', () => {
    const objects = searchCanvasComponents({ kind: 'object' })
    const html = searchCanvasComponents({ kind: 'html' })
    expect(objects.map(item => item.slug).sort()).toEqual(objectSlugs.slice().sort())
    expect(html).toHaveLength(29)
    expect(objects.every(item => item.inputs.includes('gltf') && item.inputs.includes('svg') && item.inputs.includes('image'))).toBe(true)
    expect(objects.every(item => item.requiredCapabilities.webgl.join() === 'webgl2' && item.requiredCapabilities.webgpu.join() === 'webgpu')).toBe(true)
    expect(html.every(item => item.requiredCapabilities.webgl.includes('html-in-canvas') && item.requiredCapabilities.webgpu.includes('html-in-canvas'))).toBe(true)
    expect(objects.every(item => item.dependencies.webgl.includes('three') && item.dependencies.webgpu.includes('vgpu') && item.dependencies.webgpu.includes('three'))).toBe(true)
    expect(html.every(item => item.dependencies.webgl.length === 0 && item.dependencies.webgpu.join() === 'vgpu')).toBe(true)
  })

  it('searches all tokens across names, formats, bilingual labels and kind', () => {
    expect(searchCanvasComponents({ query: 'ASCII GLB' }).map(item => item.slug)).toEqual(['ascii-object'])
    expect(searchCanvasComponents({ query: '水墨', kind: 'object' }).map(item => item.slug)).toEqual(['ink-object'])
    expect(searchCanvasComponents({ query: '粒子', kind: 'html' }).map(item => item.slug)).toEqual(['particle-reveal', 'particle-scroll'])
    expect(searchCanvasComponents({ query: 'glass gltf' }).map(item => item.slug)).toEqual(['glass-object'])
    expect(searchCanvasComponents({ query: 'does-not-exist' })).toEqual([])
    expect(searchCanvasComponents({ query: '  ' })).toHaveLength(35)
  })

  it('looks up exact slugs and generates the official framework and renderer registry names', () => {
    expect(findCanvasComponent('ink-object')?.name).toBe('Ink Object')
    expect(findCanvasComponent('Ink Object')).toBeUndefined()
    expect(findCanvasComponent('missing')).toBeUndefined()
    expect(canvasRegistryName('ink-object')).toBe('ink-object-react')
    expect(canvasRegistryUrl('ink-object', 'react', 'webgpu')).toBe('https://canvasui.dev/r/ink-object-react-webgpu.json')
    expect(canvasRegistryName('unknown')).toBeUndefined()
    expect(canvasRegistryUrl('unknown')).toBeUndefined()
    const frameworks: CanvasFramework[] = ['react', 'vue', 'svelte', 'solid', 'preact', 'vanilla']
    const renderers: CanvasRenderer[] = ['webgl', 'webgpu']
    const names = CANVAS_UI_COMPONENTS.flatMap(item => frameworks.flatMap(framework => renderers.map(renderer => canvasRegistryName(item.slug, framework, renderer))))
    expect(names).toHaveLength(420)
    expect(new Set(names).size).toBe(420)
    expect(names.every(Boolean)).toBe(true)
  })

  it('describes the pinned WebGL factory inputs and isolates global hover rewrites', () => {
    const contracts = CANVAS_UI_COMPONENTS.map(item => canvasFactoryContract(item.slug)!)
    expect(new Set(contracts.map(contract => contract.factory)).size).toBe(35)
    expect(canvasFactoryName('vhs')).toBe('createVHS')
    expect(canvasFactoryName('not-in-catalog')).toBeUndefined()
    expect(canvasFactoryContract('ascii-sweep')?.elements[0]).toContain('slots:')
    expect(canvasFactoryContract('peel')?.elements).toContain('under?: HTMLElement')
    expect(canvasFactoryContract('particle-scroll')?.requiresScrollableContent).toBe(true)
    expect(CANVAS_UI_COMPONENTS.filter(item => canvasFactoryContract(item.slug)?.execution === 'isolated-document-required').map(item => item.slug).sort()).toEqual(['bend', 'hex-float'])
  })
})
