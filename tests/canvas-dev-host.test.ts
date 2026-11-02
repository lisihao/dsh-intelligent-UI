import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, test } from 'vitest'
import { CANVAS_DEVELOPMENT_TOOL, installCanvasDevelopment, searchCanvasDevelopment } from '../src/canvas-dev-host.js'

describe('Canvas UI development discovery', () => {
  test('returns upstream references and requirements without shipping source or asserting runtime support', () => {
    const result = searchCanvasDevelopment({ query: 'ink', framework: 'react', renderer: 'webgl' })
    expect(result).toMatchObject({ scope: 'metadata-only', runtimeAvailability: 'not-checked', total: 1 })
    expect(result.items[0]).toMatchObject({ slug: 'ink-object', kind: 'object', registryName: 'ink-object-react', registryUrl: 'https://canvasui.dev/r/ink-object-react.json' })
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
    } finally { await ctx.fiber.dispose() }
    expect(runtime.get(CANVAS_DEVELOPMENT_TOOL)).toBeUndefined()
  })
})
