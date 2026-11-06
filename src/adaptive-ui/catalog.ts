import { CANVAS_HTML_EFFECT_NAMES } from '../canvas-html-names.js'
import { CANVAS_UI_COMPONENTS } from '../canvas-catalog.js'
import { builtInThemes, type ComponentSet, type ThemePackage } from '../theme-contracts.js'
import curatedSources from '../uiverse-sources.json' with { type: 'json' }
import { adaptiveComponentProvenanceById, type AdaptiveComponentSourceId } from './component-provenance.js'

/** JSON-safe values carried over the decision boundary. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

export const COMPOSITION_CATALOG_REVISION = 1 as const

export type CatalogAvailability = 'runtime' | 'conditional' | 'development-only' | 'metadata-only' | 'blocked'
export type CatalogEntryKind = 'surface' | 'theme' | 'uiverse-adapter' | 'uiverse-archive' | 'canvas' | 'library'

/**
 * A reason is a stable capability code, never copied user content.  `allOf`
 * describes the conditions under which an entry can become a renderer choice;
 * it is intentionally visible to the development lookup as well as the model
 * candidate planner.
 */
export interface CatalogEligibility {
  readonly allOf: readonly string[]
  readonly reason: string
}

export interface CatalogProvenance {
  readonly repository?: string
  readonly commit?: string
  readonly package?: string
  readonly version?: string
  readonly license?: string
  readonly sourceUrl?: string
  readonly sha256?: string
}

export interface CatalogEntry {
  readonly id: string
  readonly kind: CatalogEntryKind
  readonly name: string
  readonly availability: CatalogAvailability
  readonly eligibility: CatalogEligibility
  readonly metadata?: { readonly [key: string]: Json }
  readonly provenance?: CatalogProvenance
}

export interface CompositionCatalog {
  readonly revision: typeof COMPOSITION_CATALOG_REVISION
  readonly entries: readonly CatalogEntry[]
}

export class InvalidCompositionCatalogInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InvalidCompositionCatalogInputError'
    this.code = code
  }
}

type UiverseSource = {
  readonly role: 'button' | 'input' | 'toggle' | 'card' | 'loader'
  readonly file: string
  readonly author: string
  readonly url: string
  readonly sourceUrl: string
  readonly sha256: string
}

type CuratedSources = {
  readonly repository: string
  readonly commit: string
  readonly sets: Readonly<Record<ComponentSet, readonly UiverseSource[]>>
}

const curated = curatedSources as unknown as CuratedSources
const nativeCanvasObjectEffects = new Set(['ink-object', 'ascii-object', 'glass-object'])

const sourceSurfaceEntries: readonly CatalogEntry[] = [
  {
    id: 'surface:source', kind: 'surface', name: 'Original Markdown and structured source', availability: 'runtime',
    eligibility: { allOf: [], reason: 'source-preserving-fallback' },
  },
  {
    id: 'surface:semantic', kind: 'surface', name: 'Semantic content composition', availability: 'conditional',
    eligibility: { allOf: ['completed-source-block'], reason: 'semantic-source-analysis' },
  },
  {
    id: 'surface:source-table', kind: 'surface', name: 'Complete source table', availability: 'conditional',
    eligibility: { allOf: ['source-table-or-records'], reason: 'complete-source-retention' },
  },
  {
    id: 'surface:openui-chart', kind: 'surface', name: 'OpenUI chart', availability: 'conditional',
    eligibility: { allOf: ['validated-chart-plan'], reason: 'maintained-chart-renderer' },
  },
  {
    id: 'surface:compact-comparison', kind: 'surface', name: 'Compact comparison', availability: 'conditional',
    eligibility: { allOf: ['compact-comparison-plan'], reason: 'small-categorical-comparison' },
  },
  {
    id: 'surface:dense-line', kind: 'surface', name: 'Dense line chart', availability: 'conditional',
    eligibility: { allOf: ['dense-line-plan'], reason: 'irregular-or-large-time-series' },
  },
  {
    id: 'surface:ascii-chart', kind: 'surface', name: 'Classic ASCII chart', availability: 'conditional',
    eligibility: { allOf: ['ascii-theme', 'ascii-chart-plan'], reason: 'source-backed-character-chart' },
  },
  {
    id: 'surface:task-board', kind: 'surface', name: 'Read-only task board', availability: 'conditional',
    eligibility: { allOf: ['validated-task-status-records'], reason: 'source-status-groups' },
  },
  {
    id: 'surface:master-detail', kind: 'surface', name: 'Master/detail records', availability: 'conditional',
    eligibility: { allOf: ['validated-named-records'], reason: 'source-record-detail' },
  },
  {
    id: 'surface:heading-index', kind: 'surface', name: 'Heading index', availability: 'conditional',
    eligibility: { allOf: ['four-to-one-hundred-source-headings'], reason: 'source-heading-navigation' },
  },
  {
    id: 'surface:react-flow', kind: 'surface', name: 'Read-only React Flow graph', availability: 'conditional',
    eligibility: { allOf: ['validated-explicit-graph-or-flow'], reason: 'source-bound-relationships' },
  },
  {
    id: 'surface:execution-flow', kind: 'surface', name: 'Execution flow', availability: 'conditional',
    eligibility: { allOf: ['validated-execution-snapshot'], reason: 'source-supplied-execution-state' },
  },
  {
    id: 'surface:research-workspace', kind: 'surface', name: 'Research workspace', availability: 'conditional',
    eligibility: { allOf: ['research-document-structure'], reason: 'read-only-research-inspection' },
  },
  {
    id: 'surface:continuous-paper', kind: 'surface', name: 'Continuous Paper composition', availability: 'conditional',
    eligibility: { allOf: ['sectioned-mixed-media-markdown'], reason: 'source-section-composition' },
  },
  {
    id: 'surface:canvas-object', kind: 'surface', name: 'GLB or illustration object effect', availability: 'conditional',
    eligibility: { allOf: ['explicit-supported-asset', 'webgl', 'not-streaming', 'not-reduced-motion'], reason: 'native-object-route' },
  },
  {
    id: 'surface:openui-artifact', kind: 'surface', name: 'OpenUI artifact', availability: 'conditional',
    eligibility: { allOf: ['validated-openui-artifact'], reason: 'separate-artifact-protocol' },
  },
  {
    id: 'surface:arbitrary-html', kind: 'surface', name: 'Arbitrary HTML composition', availability: 'blocked',
    eligibility: { allOf: ['never'], reason: 'untrusted-html-is-not-a-composition-candidate' },
  },
  {
    id: 'surface:free-text-graph', kind: 'surface', name: 'Graph inferred from free text', availability: 'blocked',
    eligibility: { allOf: ['never'], reason: 'explicit-source-edges-required' },
  },
]

const libraryDefinitions: readonly {
  readonly sourceId: AdaptiveComponentSourceId
  readonly catalogId: string
  readonly suffix: string
  readonly eligibility: CatalogEligibility
}[] = [
  {
    sourceId: 'skullet', catalogId: 'component:skullet', suffix: ' loading frame',
    eligibility: { allOf: ['initial-loading-state', 'known-read-only-surface', 'no-visible-existing-content'], reason: 'initial-load-only' },
  },
  {
    sourceId: 'torph', catalogId: 'component:torph', suffix: ' short text motion',
    eligibility: { allOf: ['short-stable-text-update', 'not-reduced-motion'], reason: 'bounded-text-motion' },
  },
  {
    sourceId: 'liveline', catalogId: 'component:liveline', suffix: ' live series',
    eligibility: { allOf: ['explicit-live-series', 'registered-adapter', 'not-reduced-motion'], reason: 'declared-live-source-only' },
  },
  {
    sourceId: 'visx', catalogId: 'component:visx-historical', suffix: ' historical chart',
    eligibility: { allOf: ['historical-time-series', 'registered-adapter'], reason: 'source-bound-static-history' },
  },
]

/** Reuse the component adapter's exact reviewed pins; this catalog never owns a second pin. */
function libraryEntries(): CatalogEntry[] {
  return libraryDefinitions.map(definition => {
    const source = adaptiveComponentProvenanceById[definition.sourceId]
    const packageNames = source.packages.map(pkg => pkg.name)
    const versions = [...new Set(source.packages.map(pkg => pkg.version))]
    return {
      id: definition.catalogId,
      kind: 'library',
      name: `${source.title}${definition.suffix}`,
      availability: 'conditional',
      eligibility: definition.eligibility,
      metadata: {
        roles: [...source.roles],
        sourceCommit: source.sourceCommit,
        licenseAsset: source.licenseAsset,
        updatePolicy: source.updatePolicy,
        fallback: source.fallback,
        packages: source.packages.map(pkg => ({ name: pkg.name, version: pkg.version, entry: pkg.entry, integrity: pkg.integrity })),
      },
      provenance: {
        package: packageNames.join(' + '),
        version: versions.join(' + '),
        commit: source.sourceCommit,
        license: source.license,
        sourceUrl: source.sourceUrl,
      },
    }
  })
}

const archiveEntry: CatalogEntry = {
  id: 'uiverse:galaxy-archive', kind: 'uiverse-archive', name: 'Uiverse Galaxy archive (3,802 components / 11 categories)', availability: 'development-only',
  eligibility: { allOf: ['development-search-or-isolated-preview'], reason: 'archive-is-not-a-runtime-adapter-set' },
  metadata: { components: 3802, categories: 11, executable: false },
  provenance: { repository: curated.repository, commit: curated.commit, license: 'MIT' },
}

function themeEntry(theme: ThemePackage): CatalogEntry {
  const componentSet = theme.formatVersion === 2 ? theme.componentSet : 'native'
  const presentation = theme.formatVersion === 3 ? theme.presentation : 'standard'
  return {
    id: `theme:${theme.id}`, kind: 'theme', name: theme.name, availability: 'runtime',
    eligibility: { allOf: [], reason: `installed-theme:${presentation}:${componentSet}` },
    metadata: { formatVersion: theme.formatVersion, presentation, componentSet },
    provenance: { package: 'dsh-experience-theme', version: theme.version, license: theme.license },
  }
}

function adapterEntries(): CatalogEntry[] {
  return (Object.keys(curated.sets) as ComponentSet[]).flatMap(set => curated.sets[set].map(source => ({
    id: `uiverse:${set}:${source.role}`,
    kind: 'uiverse-adapter' as const,
    name: `${set} ${source.role}`,
    availability: 'runtime' as const,
    eligibility: { allOf: [`component-set:${set}`, `semantic-role:${source.role}`], reason: 'compiled-owned-adapter' },
    metadata: { componentSet: set, role: source.role, author: source.author },
    provenance: { repository: curated.repository, commit: curated.commit, license: 'MIT', sourceUrl: source.sourceUrl, sha256: source.sha256 },
  })))
}

function canvasEntries(experimentalBlocks = false): CatalogEntry[] {
  const executableHtml = new Set<string>([...CANVAS_HTML_EFFECT_NAMES, 'bend', 'hex-float', 'particle-scroll'])
  return CANVAS_UI_COMPONENTS.map(component => {
    const native = nativeCanvasObjectEffects.has(component.slug)
    const automatic = native
      ? { availability: 'conditional' as const, eligibility: { allOf: ['explicit-supported-asset', 'webgl', 'not-streaming', 'not-reduced-motion'], reason: 'native-object-route' } }
      : experimentalBlocks && executableHtml.has(component.slug)
        ? { availability: 'conditional' as const, eligibility: { allOf: ['experimental-block-layout', 'bounded-noninteractive-source', 'separate-visible-source', 'webgl', 'not-streaming', 'not-reduced-motion'], reason: 'registered-source-bound-visual-copy' } }
      : component.kind === 'html'
        ? { availability: 'blocked' as const, eligibility: { allOf: ['explicit-registered-adapter'], reason: 'arbitrary-html-effects-are-not-automatic' } }
        : { availability: 'metadata-only' as const, eligibility: { allOf: ['explicit-registered-adapter'], reason: 'catalog-object-has-no-native-auto-route' } }
    return {
      id: `canvas:${component.slug}`,
      kind: 'canvas' as const,
      name: component.name,
      ...automatic,
      metadata: { componentKind: component.kind, inputs: [...component.inputs], nativeAutomaticRoute: native },
      provenance: {
        repository: component.upstream.repository,
        commit: component.upstream.commit,
        license: component.upstream.license,
        sourceUrl: component.documentationUrl,
      },
    }
  })
}

function normalizedThemes(themes: readonly ThemePackage[]): ThemePackage[] {
  const seen = new Set<string>()
  const result = [...themes].sort((left, right) => left.id.localeCompare(right.id))
  for (const theme of result) {
    if (!theme || typeof theme.id !== 'string' || !theme.id) throw new InvalidCompositionCatalogInputError('THEME_INVALID', 'Theme packages must have a nonempty identifier.')
    if (seen.has(theme.id)) throw new InvalidCompositionCatalogInputError('THEME_DUPLICATE', `Theme identifier is duplicated: ${theme.id}`)
    seen.add(theme.id)
  }
  return result
}

/**
 * Complete discoverability catalog.  It is source-independent and therefore
 * safe for the existing `solar_ui_catalog` development lookup and the
 * composition RPC.  In particular, the 3,802-file Galaxy archive is one
 * development-only entry rather than 3,802 implied executable renderers.
 */
export function getCompositionCatalog(themes: readonly ThemePackage[] = builtInThemes, options: { experimentalBlocks?: boolean } = {}): CompositionCatalog {
  const entries = [
    ...sourceSurfaceEntries,
    ...libraryEntries(),
    archiveEntry,
    ...adapterEntries(),
    ...canvasEntries(options.experimentalBlocks === true),
    ...normalizedThemes(themes).map(themeEntry),
  ].sort((left, right) => left.id.localeCompare(right.id))
  return { revision: COMPOSITION_CATALOG_REVISION, entries }
}
