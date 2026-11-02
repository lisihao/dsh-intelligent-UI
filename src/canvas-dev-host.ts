import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { CANVAS_UI_COMMIT, CANVAS_UI_LICENSE, canvasFactoryContract, canvasRegistryName, canvasRegistryUrl, searchCanvasComponents } from './canvas-catalog.js'
import { isCanvasHtmlEffectName } from './canvas-html-names.js'

export const CANVAS_DEVELOPMENT_TOOL = 'solar_ui_canvas_search'

const searchInput = z.strictObject({
  query: z.string().trim().max(256).optional(),
  kind: z.enum(['object', 'html']).optional(),
  framework: z.enum(['react', 'vue', 'svelte', 'solid', 'preact', 'vanilla']).default('react'),
  renderer: z.enum(['webgl', 'webgpu']).default('webgl'),
  limit: z.number().int().min(1).max(35).default(20),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
})

/** Guidance is metadata only; native compatibility still needs checking by the consumer. */
function dshClientAdapter(slug: string, kind: 'object' | 'html') {
  if (slug === 'bend' || slug === 'hex-float') return {
    service: 'ctx.solarExperienceUi', method: 'createCanvasIsolatedEffect', backend: 'webgl', maturity: 'experimental',
    inputs: ['host', 'content', 'slug', 'onError'],
    limitations: 'Visual-only, separate source; shared-document factory remains blocked. Desktop CSP and interaction parity are unverified.',
  }
  if (slug === 'particle-scroll') return {
    service: 'ctx.solarExperienceUi', method: 'createCanvasParticleScrollBridge', backend: 'webgl', maturity: 'experimental',
    inputs: ['scroll', 'content', 'output', 'scope', 'sourceRemainsVisible', 'onError'],
    requiredValues: { scope: 'visual-only', sourceRemainsVisible: true },
    limitations: 'Visual-only, separate source and matching viewport; Desktop compatibility is unverified.',
  }
  if (isCanvasHtmlEffectName(slug)) return {
    service: 'ctx.solarExperienceUi', method: 'createCanvasHtmlEffect', backend: 'webgl', maturity: 'experimental',
    inputs: ['component', 'host', 'content', 'scope', 'sourceRemainsVisible', 'onError'],
    requiredValues: { scope: 'visual-only', sourceRemainsVisible: true },
    limitations: 'Visual-only, separate simple source; Desktop compatibility and full interaction parity are unverified.',
  }
  if (kind === 'html') return {
    service: 'ctx.solarExperienceUi', method: 'loadCanvasEffect + createCanvasHtmlTextureBridge', backend: 'webgl', maturity: 'requires-adaptation',
    limitations: 'Small non-interactive visual sources only; a factory and bridge do not prove this effect is compatible or preserve its interactions.',
  }
  return {
    service: 'ctx.solarExperienceUi', method: 'loadCanvasEffect', backend: 'webgl', maturity: 'factory-only',
    limitations: 'Supply a valid source and owned canvas, handle browser/network failures and destroy the effect; native support varies.',
  }
}

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
      webglVanillaContract: canvasFactoryContract(component.slug),
      dshClientAdapter: dshClientAdapter(component.slug, component.kind),
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
