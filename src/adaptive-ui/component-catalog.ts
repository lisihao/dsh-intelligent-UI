import type { ExecutableComponentRegistry } from './executable-registry.js'
import { DIL_COMPONENT_CATALOG } from '../dil/catalog.js'
import { dilNativeComponentById, type DilComponentId } from '../dil/component-bindings.js'
import type { TuffUiCatalog } from '../tuffui/catalog.js'
import type { TuffUiTypeSchemaManifest } from '../tuffui/type-schema.js'
import type { UiverseRuntimeRegistry } from '../uiverse/runtime-registry.js'

export interface ComponentCatalogSources {
  registry: ExecutableComponentRegistry
  tuffui: TuffUiCatalog
  tuffuiTypes: TuffUiTypeSchemaManifest
  uiverse: UiverseRuntimeRegistry
  libraryContract?: (id: string) => unknown
  canvasContract?: (id: string) => unknown
}

/** Discover the same exact ID that the selector validates and the renderer consumes. */
export function executableComponentContract(id: string, sources: ComponentCatalogSources): unknown {
  const definition = sources.registry.get(id)
  if (!definition) throw Error('EXECUTABLE_COMPONENT_UNKNOWN')
  const metadata = { id, family: definition.family, title: definition.title, suitability: definition.suitability, rendererKey: definition.rendererKey }
  if (id.startsWith('tuffui:')) {
    const originalId = id.slice(7), entry = sources.tuffui.byId.get(originalId)
    if (!entry) throw Error('TUFFUI_COMPONENT_UNKNOWN')
    return { ...metadata, sourceCommit: sources.tuffui.manifest.commit, dil: {
      tag: 'component', input: { exportName: 'one of exports[].name', props: 'source data checked against propsSchema', actions: 'optional [{prop: public callback name, actionId: local event token}]' },
      exports: entry.exports, propsSchema: sources.tuffuiTypes.entries[originalId],
      event: 'onChange receives local component events; it cannot invoke Host tools or submit a conversation. Explicit form submission remains separate.',
    } }
  }
  if (id.startsWith('dil:')) {
    const native = dilNativeComponentById.get(id as DilComponentId)
    if (!native) throw Error('DIL_COMPONENT_UNKNOWN')
    return { ...metadata, native: { ...native, ...DIL_COMPONENT_CATALOG.find(entry => entry.tag === native.tag) },
      sourceBinding: { formatVersion: 1, componentId: id, source: 'typed source: kind=text|markdown|code|table|list|chart|node; accepted kinds listed above', authority: 'Host-owned handler/action IDs only; never inferred from source text' } }
  }
  const curated = /^uiverse:(soft-relief|clear-glass|mechanical-outline):/u.test(id)
  if (id.startsWith('uiverse:') && !curated) {
    const entry = sources.uiverse.components.find(component => component.id === id.slice(8))
    if (!entry) throw Error('UIVERSE_RUNTIME_COMPONENT_UNKNOWN')
    return { ...metadata, sourceCommit: sources.uiverse.archive.commit, dil: {
      tag: 'component', input: 'values or {values,content?: Markdown}; content requires projectedTextIds for an actual content target',
      values: { mode: 'read-only | interactive', text: 'target ID -> source string', fields: 'target ID -> {value?,checked?,file?,disabled?}', images: 'target ID -> {src,alt?}; src must be bounded base64 data:image/png|jpeg|gif|webp|avif, not a remote URL; omitted alt clears author alt', actions: 'target ID -> {actionId,disabled?}', projectedTextIds: 'optional native source projection target IDs' },
      inputSchema: entry.inputSchema,
      targets: entry.targets.map(({ id, tag, kind, semanticRole, htmlAttribute, fieldConstraint }) => ({ id, tag, kind, ...(semanticRole ? { semanticRole } : {}), ...(htmlAttribute ? { htmlAttribute } : {}), ...(fieldConstraint ? { fieldConstraint } : {}) })),
      visualCharacteristics: entry.visualCharacteristics, notes: entry.notes,
      event: 'Interactive bindings require the local onChange handler. Read-only mode disables source actions. Every semantic target must bind source data; author demo text never fills missing inputs.',
    } }
  }
  const contract = id.startsWith('canvas:') ? sources.canvasContract?.(id) : sources.libraryContract?.(id)
  if (contract !== undefined) return { ...metadata, dil: contract }
  if (id.startsWith('presentation:')) return { ...metadata, input: 'Compiler-owned source recipe. Jev selects the ID; the compiler binds and validates its exact source selection.' }
  throw Error('EXECUTABLE_COMPONENT_PUBLIC_CONTRACT_UNAVAILABLE')
}
