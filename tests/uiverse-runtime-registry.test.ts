import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  createUiverseRuntimeRegistry,
  evaluateUiverseRuntimeEligibility,
  getUiverseRuntimeComponent,
  listUiverseRuntimeCandidates,
  originalUiverseRuntimeComponentId,
  uiverseRuntimeQualifiedId,
} from '../src/uiverse/runtime-registry.js'
import type { Catalog, CatalogItem } from '../src/uiverse/catalog.js'

type SourceArchive = { readonly formatVersion: number, readonly sources: Record<string, string> }

function item(id: string, source: string): CatalogItem {
  return {
    id, title: id, category: 'Buttons', author: 'fixture', tags: [], sourceUrl: `https://uiverse.io/fixture/${id}`,
    sha256: createHash('sha256').update(source).digest('hex'), framework: 'css', warnings: [],
  }
}

function fixtureCatalog(items: readonly CatalogItem[]): Catalog {
  return { formatVersion: 1, commit: '0'.repeat(40), snapshotDate: 'fixture', total: items.length, categories: { Buttons: items.length }, items: [...items] }
}

describe('Uiverse runtime registry', () => {
  test('keeps every pinned archive ID reachable through a compact immutable runtime contract', async () => {
    const catalog = JSON.parse(await readFile(new URL('../resources/uiverse/catalog.json', import.meta.url), 'utf8')) as Catalog
    const archive = JSON.parse(gunzipSync(await readFile(new URL('../resources/uiverse/sources.json.gz', import.meta.url))).toString('utf8')) as SourceArchive
    const sharedCss = gunzipSync(await readFile(new URL('../resources/uiverse/tailwind.css.gz', import.meta.url))).toString('utf8')
    const registry = createUiverseRuntimeRegistry(catalog, { html: archive.sources, sharedCss })

    expect(registry.components).toHaveLength(3802)
    expect(registry.components.map(component => component.id)).toEqual(catalog.items.map(component => component.id))
    expect(registry.audit.coverage).toMatchObject({ catalogItemCount: 3802, sourceRecordCount: 3802, auditedCount: 3802, allIdsRepresented: true })
    expect(registry.audit.sharedCssExternalReferences).toHaveLength(1)
    expect(registry.summary.blocked).toBe(0)
    expect(registry.components.every(component => component.selectableWhenBound)).toBe(true)
    expect(listUiverseRuntimeCandidates(registry)).toHaveLength(3802)
    expect(listUiverseRuntimeCandidates(registry, 'decoration')).toHaveLength(3802)
    expect(listUiverseRuntimeCandidates(registry).some(candidate => !candidate.eligibility.eligible)).toBe(true)

    const action = registry.components.find(component => component.category === 'Buttons' && component.availability === 'interactive')
    const field = registry.components.find(component => component.category === 'Inputs' && component.availability === 'interactive')
    const toggle = registry.components.find(component => component.category === 'Toggle-switches' && component.availability === 'interactive')
    expect(action?.capabilities).toContain('action')
    expect(action?.inputSchema.actionIds.length).toBeGreaterThan(0)
    expect(field?.capabilities).toContain('field')
    expect(field?.inputSchema.fieldIds.length).toBeGreaterThan(0)
    expect(toggle?.capabilities).toContain('toggle')
    expect(getUiverseRuntimeComponent(registry, action!.id).source).toBe(archive.sources[action!.id])

    // Raw community source is retained by the registry, but no source text is
    // returned through candidate listing for a model decision request.
    expect(Object.keys(listUiverseRuntimeCandidates(registry)[0]!)).not.toContain('source')
    const knownId = 'Buttons/0x-Sarthak_hungry-penguin-30'
    expect(uiverseRuntimeQualifiedId(knownId)).toBe(`uiverse:${knownId}`)
    expect(originalUiverseRuntimeComponentId(`uiverse:${knownId}`)).toBe(knownId)
    expect(listUiverseRuntimeCandidates(registry).find(candidate => candidate.id === knownId)?.qualifiedId).toBe(`uiverse:${knownId}`)
    const cssSemantic = registry.components.flatMap(component => component.targets.filter(target => target.kind === 'css-content' || target.cssAttribute !== undefined))
    // The initial root scan found 153 simple content declarations. The
    // production parser intentionally binds every additional non-empty fixed
    // declaration too (including repeated/obfuscated glitch labels), so none
    // can survive as an author-demo fallback.
    expect(cssSemantic.length).toBeGreaterThanOrEqual(153)
    expect(cssSemantic.some(target => target.cssContent?.expected === "'for free'")).toBe(true)
    expect(cssSemantic.some(target => target.cssContent?.expected === "'GLITCH'")).toBe(true)
    const htmlSemantic = registry.components.flatMap(component => component.targets.filter(target => target.htmlAttribute !== undefined).map(target => ({ componentId: component.id, attribute: target.htmlAttribute!.attribute, target })))
    // Every nonempty fixed title/ARIA attribute that survives source sanitizing
    // is a required source-data slot, never an author-demo fallback.
    expect(htmlSemantic).toHaveLength(94)
    expect(new Set(htmlSemantic.map(target => target.componentId))).toHaveLength(45)
    expect(htmlSemantic.filter(target => target.attribute === 'title')).toHaveLength(56)
    expect(htmlSemantic.filter(target => target.attribute === 'aria-label')).toHaveLength(38)
    expect(htmlSemantic.filter(target => target.attribute === 'aria-description')).toHaveLength(0)
    expect(htmlSemantic.every(target => ['title', 'aria-label', 'aria-description'].includes(target.attribute) && target.target.cssAttribute === undefined)).toBe(true)
    expect(htmlSemantic.find(target => target.componentId === 'Cards/JkHuger_spotty-swan-68' && target.attribute === 'aria-label')?.target).toMatchObject({
      path: expect.stringMatching(/^fragment\//u), htmlAttribute: { attribute: 'aria-label' },
    })
    const valueTargets = registry.components.flatMap(component => component.targets.filter(target => target.kind === 'value').map(target => ({ component, target })))
    expect(valueTargets).toHaveLength(735)
    expect(valueTargets.every(({ component, target }) => target.fieldConstraint !== undefined && component.inputSchema.fieldConstraints?.[target.id] === target.fieldConstraint)).toBe(true)
    const selects = valueTargets.filter(({ target }) => target.fieldConstraint?.element === 'select')
    expect(selects).toHaveLength(17)
    expect(selects.reduce((sum, { target }) => sum + (target.fieldConstraint?.options?.length ?? 0), 0)).toBe(153)
    expect(valueTargets.filter(({ target }) => target.fieldConstraint?.inputType === 'date')).toHaveLength(10)
    const ranges = valueTargets.filter(({ target }) => target.fieldConstraint?.inputType === 'range')
    expect(ranges).toHaveLength(6)
    expect(ranges.every(({ target }) => target.fieldConstraint?.min !== undefined && target.fieldConstraint?.max !== undefined && target.fieldConstraint?.step !== undefined)).toBe(true)
    const svgIds = registry.components.filter(component => component.targets.some(target => target.kind === 'text' && /\/svg\[/u.test(target.path))).map(component => component.id)
    expect(svgIds).toEqual([
      'Buttons/kennyotsu_witty-bullfrog-54',
      'loaders/StealthWorm_pink-duck-62',
      'Notifications/ahmed150up_terrible-shrimp-45',
      'Toggle-switches/Nawsome_good-dragon-17',
      'Tooltips/Pipo-13_ugly-swan-20',
    ])
  }, 15000)

  test('rejects a source whose bytes no longer match the pinned catalog hash', () => {
    const source = '<button>Run</button>', catalog = fixtureCatalog([item('button', source)])
    const registry = createUiverseRuntimeRegistry(catalog, { html: { button: '<button>Changed</button>' } })
    const component = getUiverseRuntimeComponent(registry, 'button')
    expect(component).toMatchObject({ availability: 'blocked', selectableWhenBound: false })
    expect(component.blockers).toContain('source-hash-mismatch')
    expect(listUiverseRuntimeCandidates(registry)).toEqual([])
  })

  test('excludes an author product price until every semantic source slot is bound', () => {
    const source = '<article><h2>Creator Pro</h2><strong>$99/month</strong><button>Buy now</button></article>'
    const catalog = fixtureCatalog([item('price-card', source)])
    const component = getUiverseRuntimeComponent(createUiverseRuntimeRegistry(catalog, { html: { 'price-card': source } }), 'price-card')
    const missing = evaluateUiverseRuntimeEligibility(component, {})
    expect(missing.eligible).toBe(false)
    expect(missing.missing).toEqual(expect.arrayContaining([
      'fragment/article[0]/h2[0]#text[0]',
      'fragment/article[0]/strong[0]#text[0]',
      'fragment/article[0]/button[0]#text[0]',
      'fragment/article[0]/button[0]',
    ]))
    const bound = evaluateUiverseRuntimeEligibility(component, {
      mode: 'interactive',
      text: {
        'fragment/article[0]/h2[0]#text[0]': '研究计划',
        'fragment/article[0]/strong[0]#text[0]': '预算待批准',
        'fragment/article[0]/button[0]#text[0]': '查看依据',
      },
      actions: { 'fragment/article[0]/button[0]': { actionId: 'open-evidence' } },
    })
    expect(bound).toMatchObject({ eligible: true, missing: [] })
  })

  test('exposes source-declared visual capabilities without sending markup to a decision request', () => {
    const source = '<button>Run</button><style>.x{display:grid;box-shadow:0 2px 6px #112233;border-radius:12px;border:1px solid rgba(0,0,0,.2);background:linear-gradient(#fff,#eee);filter:blur(1px);transform:translateZ(1px);animation:pulse 1s}@keyframes pulse{to{opacity:.5}}.x::before{content:""}</style>'
    const registry = createUiverseRuntimeRegistry(fixtureCatalog([item('visual', source)]), { html: { visual: source } })
    const component = getUiverseRuntimeComponent(registry, 'visual')
    expect(component.visualCharacteristics).toMatchObject({
      basis: 'source-declared-css-and-markup',
      declared: { layouts: ['grid'], shadows: true, rounded: true, borders: true, gradients: true, blur: true, transform3d: true, motion: true, keyframes: true, pseudoElements: true },
    })
    const candidate = listUiverseRuntimeCandidates(registry)[0]!
    expect(candidate.visualCharacteristics.colorTokens).toContain('#112233')
    expect(Object.keys(candidate)).not.toContain('source')
  })
})
