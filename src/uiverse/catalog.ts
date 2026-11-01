import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'

export interface CatalogItem { id: string; title: string; category: string; author: string; tags: string[]; sourceUrl: string; sha256: string; framework: 'css' | 'tailwind' | 'mixed' | 'unspecified'; warnings: string[] }
export interface Catalog { formatVersion: 1; commit: string; snapshotDate: string; total: number; categories: Record<string, number>; items: CatalogItem[] }
export interface SearchOptions { query?: string; category?: string; limit?: number; offset?: number }
const resources = new WeakMap<Catalog, { sources: Record<string, string>; css: string; license: string }>()
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function fail(message: string): never { throw new Error(`UIVERSE_RESOURCE_INVALID: ${message}`) }
export async function loadCatalog(resourceDir = fileURLToPath(new URL('./assets/', import.meta.url))): Promise<Catalog> {
  const [json, sourcesJson, css, license] = await Promise.all(['catalog.json', 'sources.json', 'tailwind.css', 'LICENSE'].map(name => readFile(join(resourceDir, name), 'utf8')))
  const candidate = JSON.parse(json!) as Catalog
  if (candidate.formatVersion !== 1) fail('unsupported catalog format version')
  if (!/^[0-9a-f]{40}$/.test(candidate.commit) || !Array.isArray(candidate.items) || candidate.total !== candidate.items.length || !candidate.categories || typeof candidate.snapshotDate !== 'string') fail('invalid catalog metadata')
  const sources = JSON.parse(sourcesJson!) as { formatVersion: number; sources: Record<string, string> }
  if (sources.formatVersion !== 1 || !sources.sources || Array.isArray(sources.sources)) fail('unsupported source format version')
  const ids = new Set<string>()
  for (const item of candidate.items) {
    if (typeof item.id !== 'string' || ids.has(item.id) || typeof item.title !== 'string' || typeof item.category !== 'string' || typeof item.author !== 'string' || !Array.isArray(item.tags) || item.tags.some(t => typeof t !== 'string') || !Array.isArray(item.warnings) || item.warnings.some(t => typeof t !== 'string') || !['css', 'tailwind', 'mixed', 'unspecified'].includes(item.framework) || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof sources.sources[item.id] !== 'string' || hash(sources.sources[item.id]!) !== item.sha256) fail('source or provenance mismatch')
    const url = new URL(item.sourceUrl)
    if (url.origin !== 'https://uiverse.io' || url.username || url.password) fail('unexpected source origin')
    ids.add(item.id)
  }
  if (Object.keys(sources.sources).length !== ids.size || !license?.includes('MIT License')) fail('source inventory/license mismatch')
  resources.set(candidate, { sources: sources.sources, css: css!, license: license! })
  return candidate
}
const synonyms: Record<string, string> = { '按钮':'button', '卡片':'card', '输入框':'input', '开关':'switch', '加载':'loader', '复选框':'checkbox', '单选':'radio', '表单':'form', '提示':'tooltip', '图案':'pattern', '通知':'notification', '玻璃':'glass', '立体':'3d', '柔和':'neumorphism', '描边':'outline' }
export function searchCatalog(catalog: Catalog, options: SearchOptions = {}) {
  const { limit = 12, offset = 0 } = options
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 48 || !Number.isSafeInteger(offset) || offset < 0 || typeof options.query !== 'undefined' && (typeof options.query !== 'string' || options.query.length > 300) || typeof options.category !== 'undefined' && typeof options.category !== 'string') throw new Error('UIVERSE_SEARCH_INVALID: limit 1..48, non-negative offset and query up to 300 characters required')
  const category = options.category?.toLocaleLowerCase('en-US')
  if (category && !Object.keys(catalog.categories).some(c => c.toLocaleLowerCase('en-US') === category)) throw new Error('UIVERSE_CATEGORY_UNKNOWN: choose a category from the catalog')
  const query = (options.query ?? '').trim().toLocaleLowerCase('en-US').replace(/按钮|卡片|输入框|开关|加载|复选框|单选|表单|提示|图案|通知|玻璃|立体|柔和|描边/g, key => synonyms[key]!)
  const words = query.split(/\s+/).filter(Boolean)
  const matched = catalog.items.filter(item => (!category || item.category.toLocaleLowerCase('en-US') === category) && words.every(word => [item.title,item.author,item.category,item.id,...item.tags].join(' ').toLocaleLowerCase('en-US').includes(word)))
  return { total: matched.length, offset, limit, items: matched.slice(offset, offset + limit) }
}
export function getSource(catalog: Catalog, id: string) {
  if (typeof id !== 'string' || id.length > 400) throw new Error('UIVERSE_ID_INVALID: a catalog component identifier is required')
  const item = catalog.items.find(item => item.id === id)
  if (!item) throw new Error('UIVERSE_COMPONENT_NOT_FOUND: search the catalog for a valid component')
  const data = resources.get(catalog)
  if (!data) fail('catalog is not loaded')
  return { item, source: data.sources[id]!, commit: catalog.commit, license: data.license }
}
type Node = DefaultTreeAdapterMap['node']
function clean(node: Node): void {
  if (!('childNodes' in node)) return
  node.childNodes = node.childNodes.filter(child => !('tagName' in child) || !['script','iframe','object','embed','base','meta','link'].includes(child.tagName))
  for (const child of node.childNodes) {
    if ('tagName' in child) {
      child.attrs = child.attrs.filter(attr => !/^on/i.test(attr.name) && !['srcdoc','action','formaction','target','autofocus'].includes(attr.name) && (!(attr.name === 'href' || attr.name === 'xlink:href') || attr.value.startsWith('#')))
    }
    clean(child)
  }
}
function escape(s: string) { return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;') }
export function previewDocument(catalog: Catalog, id: string, options: { colorScheme?: 'light' | 'dark'; reducedMotion?: boolean } = {}) {
  if (options.colorScheme !== undefined && options.colorScheme !== 'light' && options.colorScheme !== 'dark' || options.reducedMotion !== undefined && typeof options.reducedMotion !== 'boolean') throw new Error('UIVERSE_PREVIEW_INVALID: unsupported preview preference')
  const { item, source } = getSource(catalog,id)
  const fragment = parseFragment(source); clean(fragment)
  const data = resources.get(catalog)!
  const dark = options.colorScheme === 'dark'
  const css = item.framework === 'tailwind' || item.framework === 'mixed' || item.framework === 'unspecified' ? data.css : ''
  const motion = '*,:before,:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'; object-src 'none'"><title>${escape(item.title)}</title><style>${css}</style><style>html{min-height:100%;color-scheme:${dark ? 'dark':'light'}}body{margin:0;min-height:360px;box-sizing:border-box;padding:32px;display:grid;place-items:center;background:${dark?'#17191e':'#e8e8e8'};color:${dark?'#f4f4f4':'#202124'};font-family:system-ui,sans-serif}body>svg{max-width:100%}</style></head><body>${serialize(fragment)}<style>${options.reducedMotion ? motion : ''}@media(prefers-reduced-motion:reduce){${motion}}</style></body></html>`
  return { item, html, warnings: item.warnings }
}
export function standalonePreview(catalog: Catalog, id: string, options: Parameters<typeof previewDocument>[2] = {}): string {
  const { item, html, warnings } = previewDocument(catalog,id,options)
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(item.title)}</title><style>body{margin:0;padding:24px;font:15px/1.6 system-ui,sans-serif;background:#202227;color:#f5f5f5}main{max-width:1000px;margin:auto}a{color:#a7c9ef}iframe{width:100%;height:540px;border:1px solid #656971;border-radius:16px;background:#e8e8e8}p{overflow-wrap:anywhere}</style><main><h1>${escape(item.title)}</h1><p>${escape(item.author)} · MIT · <a href="${escape(item.sourceUrl)}">原始组件</a></p>${warnings.map(w=>`<p>${escape(w)}</p>`).join('')}<iframe title="组件隔离预览" sandbox="" srcdoc="${escape(html)}"></iframe><p>来源快照：${escape(catalog.snapshotDate)}；组件源码未改写，预览层阻止脚本、导航与外部资源。</p></main></html>`
}
