import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  auditUiverseRuntimeBindings,
  type UiverseRuntimeBindingSources,
} from '../src/uiverse/runtime-binding-audit.js'
import type { Catalog, CatalogItem } from '../src/uiverse/catalog.js'

type SourceArchive = { readonly formatVersion: number; readonly sources: Record<string, string> }

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

function fixtureItem(id: string, category: string, source: string): CatalogItem {
  return {
    id,
    title: id,
    category,
    author: 'fixture',
    tags: [category.toLowerCase()],
    sourceUrl: `https://uiverse.io/fixture/${id}`,
    sha256: sha256(source),
    framework: 'css',
    warnings: [],
  }
}

function fixtureCatalog(items: readonly CatalogItem[]): Catalog {
  const categories: Record<string, number> = {}
  for (const item of items) categories[item.category] = (categories[item.category] ?? 0) + 1
  return {
    formatVersion: 1,
    commit: '0'.repeat(40),
    snapshotDate: 'fixture',
    total: items.length,
    categories,
    items: [...items],
  }
}

function fixtureSources(items: readonly CatalogItem[], overrides: Record<string, string> = {}): UiverseRuntimeBindingSources {
  return {
    html: Object.fromEntries(items.map(item => [item.id, overrides[item.id] ?? ''])),
  }
}

describe('Uiverse runtime binding audit', () => {
  test('maps every source in the pinned archive and keeps unresolved records visible', async () => {
    const catalog = JSON.parse(await readFile(new URL('../resources/uiverse/catalog.json', import.meta.url), 'utf8')) as Catalog
    const archive = JSON.parse(gunzipSync(await readFile(new URL('../resources/uiverse/sources.json.gz', import.meta.url))).toString('utf8')) as SourceArchive
    const sharedCss = gunzipSync(await readFile(new URL('../resources/uiverse/tailwind.css.gz', import.meta.url))).toString('utf8')
    const report = auditUiverseRuntimeBindings(catalog, { html: archive.sources, sharedCss })

    expect(report.coverage.catalogItemCount).toBe(catalog.items.length)
    expect(report.coverage.sourceRecordCount).toBe(Object.keys(archive.sources).length)
    expect(report.coverage.auditedCount).toBe(catalog.items.length)
    expect(report.coverage.missingIds).toEqual([])
    expect(report.coverage.extraSourceIds).toEqual([])
    expect(report.coverage.duplicateCatalogIds).toEqual([])
    expect(report.coverage.allIdsRepresented).toBe(true)
    expect(new Set(report.entries.map(entry => entry.id)).size).toBe(catalog.items.length)

    for (const entry of report.entries) {
      expect(entry.sourceSha256).toBe(sha256(archive.sources[entry.id]!))
    }
    const statusCount = Object.values(report.summary).reduce((sum, count) => sum + count, 0)
    expect(statusCount).toBe(catalog.items.length)

    // The archive is fully represented, but archive-only categories and unsafe
    // source features remain explicit blockers; they must not be hidden by an
    // “all complete” result.
    expect(report.summary.bound).toBeGreaterThan(0)
    expect(report.summary.blocked + report.summary.ambiguous).toBeGreaterThan(0)
    // The fixed shared Tailwind sheet contains one historical remote image.
    // It is reported once and stripped by the runtime, rather than making all
    // 3,802 source records appear network-dependent.
    expect(report.sharedCssExternalReferences).toHaveLength(1)
    expect(report.entries.some(entry => entry.role === 'unmapped' && entry.blockers.includes('unsupported-role'))).toBe(true)
    expect(report.allComplete).toBe(false)
  })

  test('binds distinct native roles and refuses an ambiguous author demo', () => {
    const sources: Record<string, string> = {
      button: '<style>.button{color:red}</style><button aria-label="Run">Run</button>',
      card: '<article><h2>Summary</h2><p>Body</p></article>',
      input: '<div><label for="email">Email</label><input id="email" type="text" value="a@b.test"></div>',
      toggle: '<label><input type="checkbox" checked>Ready</label>',
      loader: '<div aria-label="Loading"><span class="spinner"></span></div>',
      ambiguous: '<div><button>One</button><button>Two</button></div>',
      unsafe: '<style>@import url("https://example.test/styles.css");</style><button onclick="run()">Run</button><script src="https://example.test/demo.js"></script>',
    }
    const items = [
      fixtureItem('button', 'Buttons', sources.button!),
      fixtureItem('card', 'Cards', sources.card!),
      fixtureItem('input', 'Inputs', sources.input!),
      fixtureItem('toggle', 'Toggle-switches', sources.toggle!),
      fixtureItem('loader', 'loaders', sources.loader!),
      fixtureItem('ambiguous', 'Buttons', sources.ambiguous!),
      fixtureItem('unsafe', 'Buttons', sources.unsafe!),
    ]
    const report = auditUiverseRuntimeBindings(fixtureCatalog(items), { html: sources })
    const byId = new Map(report.entries.map(entry => [entry.id, entry]))

    expect(byId.get('button')).toMatchObject({
      role: 'button',
      status: 'bound',
      targets: {
        content: { path: 'fragment/button[0]' },
        action: { tag: 'button' },
        label: { tag: 'button', text: 'Run' },
      },
    })
    expect(byId.get('card')).toMatchObject({
      role: 'card',
      status: 'bound',
      targets: { content: { tag: 'article' }, label: { tag: 'h2', text: 'Summary' } },
    })
    expect(byId.get('input')).toMatchObject({
      role: 'input',
      status: 'bound',
      targets: { value: { tag: 'input', attribute: 'value' }, label: { tag: 'label', text: 'Email' } },
    })
    expect(byId.get('toggle')).toMatchObject({
      role: 'toggle',
      status: 'bound',
      targets: { checked: { tag: 'input', attribute: 'checked' }, label: { tag: 'label', text: 'Ready' } },
    })
    expect(byId.get('loader')).toMatchObject({ role: 'loader', status: 'bound', targets: { content: { tag: 'div' } } })

    expect(byId.get('ambiguous')).toMatchObject({ role: 'button', status: 'ambiguous' })
    expect(byId.get('ambiguous')?.blockers).toEqual(expect.arrayContaining(['ambiguous-action', 'ambiguous-label']))
    expect(byId.get('unsafe')).toMatchObject({ role: 'button', status: 'blocked' })
    expect(byId.get('unsafe')?.blockers).toEqual(expect.arrayContaining(['inline-handler', 'script', 'external-resource']))
    expect(byId.get('unsafe')?.resources.externalReferences).toEqual(expect.arrayContaining([
      'https://example.test/styles.css',
      'https://example.test/demo.js',
    ]))
  })

  test('reports a missing source instead of shrinking coverage', () => {
    const source = '<button>Run</button>'
    const item = fixtureItem('present', 'Buttons', source)
    const missing = fixtureItem('missing', 'Buttons', source)
    const report = auditUiverseRuntimeBindings(fixtureCatalog([item, missing]), fixtureSources([item]))

    expect(report.coverage.missingIds).toEqual(['missing'])
    expect(report.coverage.allIdsRepresented).toBe(false)
    expect(report.summary['missing-source']).toBe(1)
    expect(report.entries.find(entry => entry.id === 'missing')).toMatchObject({
      status: 'missing-source',
      blockers: ['source-missing'],
    })
    expect(report.allComplete).toBe(false)
  })
})
