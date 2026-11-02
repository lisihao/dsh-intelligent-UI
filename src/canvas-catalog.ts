/**
 * Descriptive index of the upstream Canvas UI catalog at the commit below.
 * This is metadata, not the upstream implementation or a runtime availability claim.
 * Official documentation and registry URLs may change independently of this pin.
 */
export const CANVAS_UI_COMMIT = 'a04a99b235299ee79a123a16ccb2e6cf9da74b6b'
export const CANVAS_UI_REPOSITORY = 'https://github.com/DavidHDev/canvas-ui'
export const CANVAS_UI_LICENSE = 'MIT + Commons Clause 1.0'
export const CANVAS_UI_LICENSE_URL = `${CANVAS_UI_REPOSITORY}/blob/${CANVAS_UI_COMMIT}/LICENSE.md`

export type CanvasComponentKind = 'object' | 'html'
export type CanvasFramework = 'react' | 'vue' | 'svelte' | 'solid' | 'preact' | 'vanilla'
export type CanvasRenderer = 'webgl' | 'webgpu'
export type CanvasBrowserCapability = 'webgl2' | 'webgpu' | 'html-in-canvas'

export interface CanvasComponent {
  readonly slug: string
  readonly name: string
  readonly kind: CanvasComponentKind
  readonly inputs: readonly string[]
  readonly keywords: readonly string[]
  readonly documentationUrl: string
  readonly upstream: {
    readonly repository: string
    readonly commit: string
    readonly license: string
    readonly licenseUrl: string
  }
  /** Capabilities needed for the full upstream effect, not its plain-content fallback. */
  readonly requiredCapabilities: Readonly<Record<CanvasRenderer, readonly CanvasBrowserCapability[]>>
  readonly dependencies: Readonly<Record<CanvasRenderer, readonly string[]>>
}

// Names and slugs from upstream src/data/components.ts at CANVAS_UI_COMMIT.
// Keywords are our own short search labels, not component source or code.
const definitions: ReadonlyArray<readonly [string, string, CanvasComponentKind, readonly string[]]> = [
  ['ascii-object', 'ASCII Object', 'object', ['ascii', 'characters', '字符', '艺术']],
  ['ascii-sweep', 'ASCII Sweep', 'html', ['ascii', 'characters', 'transition', '字符', '切换']],
  ['asciify', 'Asciify', 'html', ['ascii', 'characters', 'lens', '字符', '镜头']],
  ['bend', 'Bend', 'html', ['fold', 'scroll', '折叠', '滚动']],
  ['blaze', 'Blaze', 'html', ['fire', 'smoke', '火焰', '烟']],
  ['bubble', 'Bubble', 'html', ['bubble', 'glass', 'droplet', '气泡', '玻璃']],
  ['canvas', 'Canvas', 'html', ['paint', 'canvas', '画布', '油画']],
  ['cloth', 'Cloth', 'html', ['fabric', 'cloth', '布料', '织物']],
  ['clouds', 'Clouds', 'html', ['cloud', 'fog', '云', '雾']],
  ['decrypt-reveal', 'Decrypt Reveal', 'html', ['ascii', 'decrypt', 'reveal', '字符', '解密']],
  ['dithered-object', 'Dithered Object', 'object', ['dither', 'halftone', '抖动', '像素']],
  ['displacement', 'Displacement', 'html', ['warp', 'ripple', '扭曲', '位移']],
  ['droplets', 'Droplets', 'html', ['rain', 'water', 'droplet', '雨', '水滴']],
  ['flame-wrap', 'Flame Wrap', 'html', ['fire', 'flame', 'border', '火焰', '边框']],
  ['force-field', 'Force Field', 'html', ['field', 'shield', 'shockwave', '力场', '护盾']],
  ['frost', 'Frost', 'html', ['ice', 'frost', '冰', '霜']],
  ['glass', 'Glass', 'html', ['glass', 'lens', 'refraction', '玻璃', '镜头']],
  ['glass-object', 'Glass Object', 'object', ['glass', 'refraction', '玻璃', '折射']],
  ['glitch', 'Glitch', 'html', ['glitch', 'distortion', '故障', '失真']],
  ['glyph-rain', 'Glyph Rain', 'html', ['glyph', 'characters', 'rain', '字符', '雨']],
  ['grid', 'Grid', 'html', ['grid', 'tiles', '网格', '方块']],
  ['hex-float', 'Hex Float', 'html', ['hex', 'tiles', 'float', '六边形', '悬浮']],
  ['ink-object', 'Ink Object', 'object', ['ink', 'strokes', '墨线', '水墨']],
  ['laser', 'Laser', 'html', ['laser', 'scroll', 'reveal', '激光', '滚动']],
  ['liquid', 'Liquid', 'html', ['liquid', 'fluid', '液体', '流体']],
  ['magnify', 'Magnify', 'html', ['magnify', 'scanner', 'lens', '放大', '扫描']],
  ['particle-object', 'Particle Object', 'object', ['particle', 'scatter', '粒子', '散开']],
  ['particle-reveal', 'Particle Reveal', 'html', ['particle', 'reveal', '粒子', '显现']],
  ['particle-scroll', 'Particle Scroll', 'html', ['particle', 'scroll', '粒子', '滚动']],
  ['peel', 'Peel', 'html', ['peel', 'layers', '翻页', '图层']],
  ['retro-dither', 'Retro Dither', 'html', ['dither', 'retro', 'pixel', '抖动', '复古']],
  ['ripple', 'Ripple', 'html', ['water', 'ripple', '水波', '涟漪']],
  ['shatter', 'Shatter', 'html', ['shatter', 'glass', '碎裂', '玻璃']],
  ['liquid-object', 'Liquid Object', 'object', ['liquid', 'fluid', '液体', '流体']],
  ['vhs', 'VHS', 'html', ['vhs', 'tape', 'grain', '录像', '胶片']],
]

const source = Object.freeze({ repository: CANVAS_UI_REPOSITORY, commit: CANVAS_UI_COMMIT, license: CANVAS_UI_LICENSE, licenseUrl: CANVAS_UI_LICENSE_URL })
const objectInputs = Object.freeze(['glb', 'gltf', 'svg', 'image'])
const htmlInputs = Object.freeze(['html'])
const objectCapabilities = Object.freeze({ webgl: Object.freeze(['webgl2'] as const), webgpu: Object.freeze(['webgpu'] as const) })
const htmlCapabilities = Object.freeze({ webgl: Object.freeze(['webgl2', 'html-in-canvas'] as const), webgpu: Object.freeze(['webgpu', 'html-in-canvas'] as const) })
const objectDependencies = Object.freeze({ webgl: Object.freeze(['three']), webgpu: Object.freeze(['vgpu', 'three']) })
const htmlDependencies = Object.freeze({ webgl: Object.freeze([] as string[]), webgpu: Object.freeze(['vgpu']) })

export const CANVAS_UI_COMPONENTS: readonly CanvasComponent[] = Object.freeze(definitions.map(([slug, name, kind, keywords]) => Object.freeze({
  slug, name, kind, inputs: kind === 'object' ? objectInputs : htmlInputs,
  keywords: Object.freeze([...keywords]), documentationUrl: `https://canvasui.dev/docs/components/${slug}`, upstream: source,
  requiredCapabilities: kind === 'object' ? objectCapabilities : htmlCapabilities,
  dependencies: kind === 'object' ? objectDependencies : htmlDependencies,
})))

const componentsBySlug = new Map(CANVAS_UI_COMPONENTS.map(component => [component.slug, component]))

/** Slugs are upstream identifiers; names or partial matches are not accepted here. */
export function findCanvasComponent(slug: string): CanvasComponent | undefined {
  return componentsBySlug.get(slug)
}

/** Name of the WebGL vanilla factory at the pinned upstream revision. */
export function canvasFactoryName(slug: string): string | undefined {
  if (!findCanvasComponent(slug)) return undefined
  return `create${slug === 'vhs' ? 'VHS' : slug.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('')}`
}

/**
 * Developer-facing shape of the vanilla WebGL integration. These are interface
 * facts, not component code or a claim that a browser can run the effect.
 */
export function canvasFactoryContract(slug: string) {
  const component = findCanvasComponent(slug)
  const factory = canvasFactoryName(slug)
  if (!component || !factory) return undefined
  const elements = component.kind === 'object'
    ? ['canvas: HTMLCanvasElement']
    : slug === 'ascii-sweep'
      ? ['slots: [{ source: HTMLCanvasElement, content: HTMLElement }, { source: HTMLCanvasElement, content: HTMLElement }]', 'output: HTMLCanvasElement']
      : ['source: HTMLCanvasElement', 'content: HTMLElement', 'output: HTMLCanvasElement', ...(slug === 'peel' ? ['under?: HTMLElement'] : [])]
  const specialMethods: Record<string, readonly string[]> = {
    'ascii-sweep': ['sweep', 'current', 'capture'], 'force-field': ['impact'], frost: ['melt'],
    glitch: ['burst'], liquid: ['splat'], ripple: ['splash'],
  }
  return {
    factory,
    backend: 'webgl' as const,
    framework: 'vanilla' as const,
    elements,
    ...(component.kind === 'object' ? { assetOption: 'src' } : {}),
    requiresScrollableContent: slug === 'bend' || slug === 'particle-scroll',
    methods: ['setOptions', 'resize', 'destroy', ...(specialMethods[slug] ?? [])],
    execution: slug === 'bend' || slug === 'hex-float' ? 'isolated-document-required' as const : 'caller-owned-surface' as const,
    ...((slug === 'ascii-sweep' || slug === 'peel') ? {
      inputOwnership: 'private-proxies-required' as const,
      mutationWarning: slug === 'ascii-sweep'
        ? 'Changes source-layer styles, pointer and accessibility state; do not pass the original or another plugin’s elements.'
        : 'Changes upper and lower layer pointer/visibility state; do not pass the original or another plugin’s elements.',
    } : {}),
    note: 'Factory can return null when required browser or GPU capabilities are absent. Destroy every created instance; preserve original content and interaction.',
  }
}

export function searchCanvasComponents(input: { query?: string, kind?: CanvasComponentKind } = {}): readonly CanvasComponent[] {
  const tokens = (input.query ?? '').normalize('NFKC').trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return CANVAS_UI_COMPONENTS.filter(component => {
    if (input.kind && component.kind !== input.kind) return false
    const searchable = [component.slug, component.name, component.kind, ...component.inputs, ...component.keywords].join(' ').normalize('NFKC').toLowerCase()
    return tokens.every(token => searchable.includes(token))
  })
}

/** Registry addresses refer to the live official service, not a frozen source artifact. */
export function canvasRegistryName(slug: string, framework: CanvasFramework = 'react', renderer: CanvasRenderer = 'webgl'): string | undefined {
  if (!findCanvasComponent(slug)) return undefined
  return `${slug}-${framework}${renderer === 'webgpu' ? '-webgpu' : ''}`
}

export function canvasRegistryUrl(slug: string, framework: CanvasFramework = 'react', renderer: CanvasRenderer = 'webgl'): string | undefined {
  const name = canvasRegistryName(slug, framework, renderer)
  return name ? `https://canvasui.dev/r/${name}.json` : undefined
}
