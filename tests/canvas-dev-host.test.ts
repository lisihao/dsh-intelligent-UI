import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, test } from 'vitest'
import { CANVAS_DEVELOPMENT_TOOL, installCanvasDevelopment, searchCanvasDevelopment } from '../src/canvas-dev-host.js'

describe('Canvas UI development discovery', () => {
  test('returns upstream references and requirements without shipping source or asserting runtime support', () => {
    const result = searchCanvasDevelopment({ query: 'ink', framework: 'react', renderer: 'webgl' })
    expect(result).toMatchObject({ scope: 'metadata-only', runtimeAvailability: 'not-checked', total: 1 })
    expect(result.items[0]).toMatchObject({ slug: 'ink-object', kind: 'object', registryName: 'ink-object-react', registryUrl: 'https://canvasui.dev/r/ink-object-react.json' })
    expect(result.items[0]?.webglVanillaContract).toMatchObject({ factory: 'createInkObject', elements: ['canvas: HTMLCanvasElement'], assetOption: 'src', execution: 'caller-owned-surface' })
    expect(searchCanvasDevelopment({ query: 'hex-float' }).items[0]?.webglVanillaContract).toMatchObject({ execution: 'isolated-document-required' })
    expect(searchCanvasDevelopment({ query: 'hex-float' }).items[0]?.dshClientAdapter).toMatchObject({ method: 'createCanvasIsolatedEffect', backend: 'webgl', maturity: 'experimental' })
    expect(searchCanvasDevelopment({ query: 'particle-scroll' }).items[0]?.dshClientAdapter).toMatchObject({ method: 'createCanvasParticleScrollBridge', maturity: 'experimental' })
    expect(searchCanvasDevelopment({ query: 'ripple', renderer: 'webgpu' }).items.find(item => item.slug === 'ripple')?.dshClientAdapter).toMatchObject({ method: 'createCanvasHtmlEffect', backend: 'webgl', maturity: 'experimental' })
    for (const slug of ['grid', 'displacement', 'glitch']) expect(searchCanvasDevelopment({ query: slug }).items.find(item => item.slug === slug)?.dshClientAdapter).toMatchObject({ method: 'createCanvasHtmlEffect', backend: 'webgl', maturity: 'experimental' })
    expect(searchCanvasDevelopment({ query: 'grid' }).items.find(item => item.slug === 'grid')?.dshClientAdapter).toMatchObject({ inputs: ['component', 'host', 'content', 'scope', 'sourceRemainsVisible', 'onError'], requiredValues: { scope: 'visual-only', sourceRemainsVisible: true } })
    expect(searchCanvasDevelopment({ query: 'particle-scroll' }).items[0]?.dshClientAdapter).toMatchObject({ inputs: ['scroll', 'content', 'output', 'scope', 'sourceRemainsVisible', 'onError'] })
    expect(searchCanvasDevelopment({ query: 'glass' }).items.find(item => item.slug === 'glass')?.dshClientAdapter).toMatchObject({ maturity: 'requires-adaptation' })
    expect(searchCanvasDevelopment({ query: 'ascii-sweep' }).items[0]?.webglVanillaContract?.methods).toContain('sweep')
    expect(searchCanvasDevelopment({ query: 'ascii-sweep' }).items[0]?.webglVanillaContract).toMatchObject({ inputOwnership: 'private-proxies-required' })
    expect(searchCanvasDevelopment({ query: 'peel' }).items[0]?.webglVanillaContract).toMatchObject({ inputOwnership: 'private-proxies-required' })
    expect(JSON.stringify(result)).not.toContain('InkObject.tsx')
    expect(searchCanvasDevelopment({ query: 'ascii', renderer: 'webgpu' }).items.map(item => item.slug)).toContain('ascii-object')
    expect(searchCanvasDevelopment({ limit: 35 }).total).toBe(35)
    expect(() => searchCanvasDevelopment({ renderer: 'invalid' })).toThrow()
    expect(() => searchCanvasDevelopment({ url: 'https://untrusted.invalid' })).toThrow()
  })

  test('published DSH tool executes and is removed with its plugin context', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
    const runtime = new ToolRuntime(ctx)
    installCanvasDevelopment(ctx)
    try {
      expect(runtime.get(CANVAS_DEVELOPMENT_TOOL)).toBeDefined()
      expect(() => installCanvasDevelopment(ctx)).toThrow('CANVAS_TOOL_REGISTRATION_CONFLICT')
      const result = await runtime.execute({ callId: 'canvas-discovery' as Parameters<typeof runtime.execute>[0]['callId'], name: CANVAS_DEVELOPMENT_TOOL, arguments: { query: '墨线' }, signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result.content)).toContain('ink-object')
      const scroll = await runtime.execute({ callId: 'canvas-scroll-discovery' as Parameters<typeof runtime.execute>[0]['callId'], name: CANVAS_DEVELOPMENT_TOOL, arguments: { query: 'particle-scroll' }, signal: new AbortController().signal })
      expect(scroll, JSON.stringify(scroll)).toMatchObject({ isError: false })
      expect(JSON.stringify(scroll.content)).toContain('createCanvasParticleScrollBridge')
      expect(JSON.stringify(scroll.content)).toContain('Desktop compatibility is unverified')
      const all = await runtime.execute({ callId: 'canvas-all-discovery' as Parameters<typeof runtime.execute>[0]['callId'], name: CANVAS_DEVELOPMENT_TOOL, arguments: { limit: 35 }, signal: new AbortController().signal })
      expect(all, JSON.stringify(all)).toMatchObject({ isError: false })
      const block = all.content.find(item => item.type === 'text')
      if (!block || block.type !== 'text') throw new Error('Expected JSON text from the Canvas discovery tool')
      const payload = JSON.parse(block.text) as { total: number, items: unknown[] }
      expect(payload.total).toBe(35)
      expect(payload.items).toHaveLength(35)
    } finally { await ctx.fiber.dispose() }
    expect(runtime.get(CANVAS_DEVELOPMENT_TOOL)).toBeUndefined()
  })
})
