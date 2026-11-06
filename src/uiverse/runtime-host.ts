import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Catalog } from './catalog.js'
import {
  createUiverseRuntimeRegistry,
  getUiverseRuntimeComponent,
  type UiverseRuntimeComponent,
  type UiverseRuntimeRegistry,
} from './runtime-registry.js'

type SourceArchive = { readonly formatVersion: number, readonly sources: Record<string, string> }
export type UiverseRuntimeComponentResponse = Readonly<{ component: UiverseRuntimeComponent, sharedCss?: string }>
/** Production deliberately accepts one inspected Galaxy snapshot only. */
export const UIVERSE_RUNTIME_ARCHIVE_PIN = Object.freeze({
  commit: 'adbd2adde0a299a3956ea288fb444ec01891ca41',
  total: 3802,
  categoryCount: 11,
})

function fault(code: string): never { throw new Error(`UIVERSE_RUNTIME_HOST_${code}`) }
async function readFirst(directory: string, plain: string, compressed: string): Promise<string> {
  try { return await readFile(join(directory, plain), 'utf8') }
  catch (plainError) {
    try { return gunzipSync(await readFile(join(directory, compressed))).toString('utf8') }
    catch { throw new Error(`UIVERSE_RUNTIME_HOST_ASSET_UNAVAILABLE:${plainError instanceof Error ? plainError.message : String(plainError)}`) }
  }
}
function catalog(value: unknown): Catalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fault('CATALOG_INVALID')
  const candidate = value as Catalog
  if (candidate.formatVersion !== 1 || candidate.commit !== UIVERSE_RUNTIME_ARCHIVE_PIN.commit || candidate.total !== UIVERSE_RUNTIME_ARCHIVE_PIN.total || !Array.isArray(candidate.items) || candidate.items.length !== UIVERSE_RUNTIME_ARCHIVE_PIN.total || !candidate.categories || typeof candidate.categories !== 'object' || Object.keys(candidate.categories).length !== UIVERSE_RUNTIME_ARCHIVE_PIN.categoryCount || Object.values(candidate.categories).some(count => !Number.isInteger(count) || count < 0) || Object.values(candidate.categories).reduce((sum, count) => sum + count, 0) !== UIVERSE_RUNTIME_ARCHIVE_PIN.total) fault('CATALOG_SNAPSHOT_INVALID')
  return candidate
}
function archive(value: unknown): SourceArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fault('SOURCES_INVALID')
  const candidate = value as SourceArchive
  if (candidate.formatVersion !== 1 || !candidate.sources || typeof candidate.sources !== 'object' || Array.isArray(candidate.sources)) fault('SOURCES_INVALID')
  return candidate
}
function cloneComponent(component: UiverseRuntimeComponent): UiverseRuntimeComponent {
  // JSON cloning deliberately omits undefined fields and prevents client code
  // from mutating the host cache. The source itself was hash-checked in open().
  const { sharedCss: _sharedCss, ...dto } = component
  return JSON.parse(JSON.stringify(dto)) as UiverseRuntimeComponent
}

/**
 * Server-only owner for the fixed local Uiverse archive. Its public method
 * accepts an opaque original component ID, never a user filesystem path or a
 * model-provided HTML/CSS payload.
 */
export class UiverseRuntimeHost {
  private constructor(readonly registry: UiverseRuntimeRegistry, private readonly sharedCss: string) {}

  static async open(resourceDirectory: string): Promise<UiverseRuntimeHost> {
    if (typeof resourceDirectory !== 'string' || !resourceDirectory) fault('RESOURCE_DIRECTORY_INVALID')
    const directory = resolve(resourceDirectory)
    const [catalogText, sourcesText, css, license] = await Promise.all([
      readFile(join(directory, 'catalog.json'), 'utf8'),
      readFirst(directory, 'sources.json', 'sources.json.gz'),
      readFirst(directory, 'tailwind.css', 'tailwind.css.gz'),
      readFile(join(directory, 'LICENSE'), 'utf8'),
    ])
    if (!license.includes('MIT License')) fault('LICENSE_INVALID')
    const manifest = catalog(JSON.parse(catalogText)), sourceArchive = archive(JSON.parse(sourcesText))
    const registry = createUiverseRuntimeRegistry(manifest, { html: sourceArchive.sources, sharedCss: css })
    if (!registry.audit.coverage.allIdsRepresented || registry.audit.coverage.extraSourceIds.length || registry.audit.coverage.missingIds.length || registry.audit.coverage.duplicateCatalogIds.length || registry.summary.blocked !== 0) {
      fault('ARCHIVE_INTEGRITY_INVALID')
    }
    return new UiverseRuntimeHost(registry, css)
  }

  component(componentId: string, includeSharedCss = false): UiverseRuntimeComponentResponse {
    if (typeof componentId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.\/-]{0,159}$/u.test(componentId)) fault('COMPONENT_ID_INVALID')
    if (typeof includeSharedCss !== 'boolean') fault('INCLUDE_SHARED_CSS_INVALID')
    const component = getUiverseRuntimeComponent(this.registry, componentId)
    if (component.availability === 'blocked' || !component.selectableWhenBound) fault('COMPONENT_UNAVAILABLE')
    return Object.freeze({ component: cloneComponent(component), ...(includeSharedCss ? { sharedCss: this.sharedCss } : {}) })
  }
}
