import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { CANVAS_UI_COMMIT, CANVAS_UI_LICENSE, canvasRegistryName, canvasRegistryUrl, searchCanvasComponents } from './canvas-catalog.js'

export const CANVAS_DEVELOPMENT_TOOL = 'solar_ui_canvas_search'

const searchInput = z.strictObject({
  query: z.string().trim().max(256).optional(),
  kind: z.enum(['object', 'html']).optional(),
  framework: z.enum(['react', 'vue', 'svelte', 'solid', 'preact', 'vanilla']).default('react'),
  renderer: z.enum(['webgl', 'webgpu']).default('webgl'),
  limit: z.number().int().min(1).max(35).default(20),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
})

/** Read-only discovery; component source stays with the upstream registry. */
export function searchCanvasDevelopment(input: unknown) {
  const args = searchInput.parse(input)
  const found = searchCanvasComponents({ query: args.query, kind: args.kind })
  return {
    formatVersion: 1, commit: CANVAS_UI_COMMIT, license: CANVAS_UI_LICENSE,
    scope: 'metadata-only', runtimeAvailability: 'not-checked',
    note: 'Official registry URLs are live and may differ from the recorded commit; inspect their source and license in the destination project. Catalog discovery does not mean the effect is installed in DSH.',
    total: found.length, offset: args.offset, limit: args.limit,
    items: found.slice(args.offset, args.offset + args.limit).map(component => ({
      ...component,
      registryName: canvasRegistryName(component.slug, args.framework, args.renderer),
      registryUrl: canvasRegistryUrl(component.slug, args.framework, args.renderer),
      framework: args.framework, renderer: args.renderer,
    })),
  }
}

export function createCanvasDevelopmentTool() {
  return defineTool({
    name: CANVAS_DEVELOPMENT_TOOL,
    description: 'Find Canvas UI effects for frontend development by role or keyword. Returns only upstream metadata, requirements and official registry links, not bundled component source or a claim of installed runtime support.',
    parameters: {
      query: { type: 'string' }, kind: { type: 'string', enum: ['object', 'html'] },
      framework: { type: 'string', enum: ['react', 'vue', 'svelte', 'solid', 'preact', 'vanilla'] },
      renderer: { type: 'string', enum: ['webgl', 'webgpu'] },
      limit: { type: 'integer' }, offset: { type: 'integer' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    presentCall: () => ({ card: 'generic', kind: 'search', title: '检索 Canvas UI 组件' }),
    async execute(args, exec) { exec.signal.throwIfAborted(); return searchCanvasDevelopment(args) as never },
  })
}

/** Registration is scoped to this plugin's lifecycle. */
export function installCanvasDevelopment(ctx: Context): void {
  if (ctx.tools.get(CANVAS_DEVELOPMENT_TOOL)) throw new Error('CANVAS_TOOL_REGISTRATION_CONFLICT: Canvas UI discovery tool is already registered.')
  ctx.effect(() => ctx.tools.register(createCanvasDevelopmentTool()))
}
