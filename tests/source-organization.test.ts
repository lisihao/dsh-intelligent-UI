// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentView } from '../src/presentation.js'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { compileBlockLayout } from '../src/adaptive-ui/block-compiler.js'
import { sourceOrganizationCandidates } from '../src/adaptive-ui/source-organization.js'
import { CompositionRuntimeContext, type CompositionApi } from '../src/adaptive-ui/view.js'
import type { ComposeInput, CompositionResult } from '../src/adaptive-ui/contracts.js'
import type { BaseCompositionSelection } from '../src/adaptive-ui/planner.js'
import type { BlockPresentationId } from '../src/adaptive-ui/presentation-recipes.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const source = `# Source organization

This qualification remains prose: the items are not a causal sequence or a comparable dataset[^note].

- First item keeps a [source link][reference] and its original unit of 12 ms.
- Second item retains an explicit exception: approximately measured, not audited.

This paragraph remains between the two source-owned lists.

- **Latency (ms)**: about 12 ms from the [same source][reference].
- **Limit**: not comparable to the prior period; the qualifier remains exact.

~~~ts
const unit = 'ms'
~~~

[^note]: A document-scoped footnote definition stays available.

[reference]: https://example.test/source
`

function baseSelection(): BaseCompositionSelection {
  return {
    themeId: 'plain', surface: 'semantic', chart: 'auto', componentSet: 'native', objectEffect: 'none', layout: 'document',
  }
}
function settings(): ExperienceSettings {
  return {
    ...initialSettings(),
    revision: 1,
    takeover: true,
    adaptive: { enabled: true, styleMode: 'automatic', blockLayout: true },
    theme: { activeId: 'plain', installed: [] },
  }
}
function selectedSourceOrganization(value: unknown, recipe: Extract<BlockPresentationId, 'source-list-grid' | 'source-label-table'>): CompositionResult {
  const compilation = compileBlockLayout(value)
  const target = compilation.blocks.find(block => block.kind === 'prose')
  if (!target) throw new Error('The fixture must retain a prose block for source organization.')
  return {
    status: 'selected',
    reason: 'JEV_SELECTION_ADOPTED',
    sourceVersion: 'sha256:source-organization',
    operationId: `source-organization-${recipe}`,
    selection: {
      ...baseSelection(),
      blockLayout: {
        version: compilation.version,
        inspection: 'none',
        blocks: compilation.blocks.map(block => ({
          id: block.id,
          path: [...block.path],
          ...(block.start === undefined ? {} : { start: block.start }),
          ...(block.end === undefined ? {} : { end: block.end }),
          kind: block.kind,
          presentation: block.id === target.id ? recipe : 'reading',
          selection: baseSelection(),
          evidence: [...block.evidence],
        })),
      },
    },
  }
}
function api(recipe: Extract<BlockPresentationId, 'source-list-grid' | 'source-label-table'>): CompositionApi {
  return {
    composition: vi.fn((input: ComposeInput) => Promise.resolve(selectedSourceOrganization(input.value, recipe))),
    compositionReceipt: vi.fn(async () => ({ status: 'observed' })),
    compositionCancel: vi.fn(async () => ({ cancelled: true })),
  }
}
async function render(recipe: Extract<BlockPresentationId, 'source-list-grid' | 'source-label-table'>): Promise<{ host: HTMLDivElement, root: Root }> {
  const host = document.createElement('div')
  const root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(h(CompositionRuntimeContext.Provider, {
    value: { api: api(recipe), sessionId: `source-organization-${recipe}`, settings: settings() },
  }, h(ContentView, { value: source, documentId: `source-organization-${recipe}`, sessionId: `source-organization-${recipe}` }))))
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-iexp-composition-status="selected"]')).not.toBeNull()) })
  return { host, root }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(async () => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('source organization candidates', () => {
  it('reports complete block-local UTF-16 mappings, including the full explicit label text', () => {
    const candidates = sourceOrganizationCandidates(source)
    expect(candidates.map(candidate => candidate.id)).toEqual(['source-list-grid', 'source-label-table'])
    const grid = candidates[0]!.mapping as { coordinateSystem: string, rangeConvention: string, lists: Array<{ start: number, end: number, items: Array<{ start: number, end: number }> }> }
    const labels = candidates[1]!.mapping as { lists: Array<{ items: Array<{ explicitLabel?: { start: number, end: number, text: string } }> }> }
    expect(grid.coordinateSystem).toBe('block-local-utf16')
    expect(grid.rangeConvention).toBe('[start,end)')
    expect(grid.lists).toHaveLength(2)
    expect(grid.lists[0]!.start).toBe(source.indexOf('- First item'))
    expect(grid.lists[0]!.items.map(item => source.slice(item.start, item.end))).toEqual(expect.arrayContaining([
      expect.stringContaining('12 ms'),
      expect.stringContaining('not audited'),
    ]))
    const latency = labels.lists[0]!.items[0]!.explicitLabel!
    expect(source.slice(latency.start, latency.end)).toBe('**Latency (ms)**')
    expect(latency.text).toBe('Latency (ms)')
  })

  it('does not offer unsupported ordered/task lists or label tables without explicit strong labels', () => {
    expect(sourceOrganizationCandidates(['not markdown'])).toEqual([])
    expect(sourceOrganizationCandidates('1. First\n2. Second')).toEqual([])
    expect(sourceOrganizationCandidates('- [ ] Draft\n- [x] Review')).toEqual([])
    expect(sourceOrganizationCandidates('- Alpha detail\n- Beta detail').map(candidate => candidate.id)).toEqual(['source-list-grid'])
    expect(sourceOrganizationCandidates('- **Alpha** detail\n  - nested source\n- **Beta** detail').map(candidate => candidate.id)).toEqual(['source-list-grid'])
  })
})

describe('source organization renderer', () => {
  it('renders every eligible list in a selected prose block as source-ordered grid items without losing surrounding source nodes', async () => {
    const mounted = await render('source-list-grid')
    try {
      const grids = mounted.host.querySelectorAll<HTMLUListElement>('ul.iexp-source-list-grid[data-iexp-source-organization="source-list-grid"]')
      expect(grids).toHaveLength(2)
      expect([...grids[0]!.children].map(item => item.textContent)).toEqual(expect.arrayContaining([
        expect.stringContaining('First item keeps a source link'),
        expect.stringContaining('Second item retains an explicit exception'),
      ]))
      expect(mounted.host.querySelectorAll('ul.iexp-source-list-grid > li')).toHaveLength(4)
      expect(mounted.host.querySelector('ul.iexp-source-list-grid > li[data-iexp-source-item-start][data-iexp-source-item-end]')).not.toBeNull()
      expect(mounted.host.querySelector('a[href="https://example.test/source"]')?.textContent).toContain('source link')
      expect(mounted.host.querySelector('pre code')?.textContent).toContain("const unit = 'ms'")
      expect(mounted.host.textContent).toContain('the items are not a causal sequence or a comparable dataset')
      expect(mounted.host.textContent).toContain('This paragraph remains between the two source-owned lists.')
      expect(mounted.host.textContent).toContain('A document-scoped footnote definition stays available.')
      expect(mounted.host.querySelector('.iexp-source-label-table')).toBeNull()
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })

  it('renders only explicitly named source items as real label/detail table rows and leaves unrelated lists in place', async () => {
    const mounted = await render('source-label-table')
    try {
      const table = mounted.host.querySelector<HTMLTableElement>('table.iexp-source-label-table[data-iexp-source-organization="source-label-table"]')
      expect(table).not.toBeNull()
      const rows = table!.querySelectorAll<HTMLTableRowElement>('tbody > tr.iexp-source-label-row')
      expect(rows).toHaveLength(2)
      expect([...rows].map(row => row.querySelector('th.iexp-source-label-cell')?.textContent)).toEqual(['Latency (ms)', 'Limit'])
      expect(rows[0]!.querySelector('td.iexp-source-label-detail')?.textContent).toContain('about 12 ms from the same source')
      expect(rows[1]!.querySelector('td.iexp-source-label-detail')?.textContent).toContain('not comparable to the prior period')
      expect(table!.querySelector('th[data-iexp-source-label-start]')?.getAttribute('data-iexp-source-label-end')).toBeTruthy()
      const ordinaryList = [...mounted.host.querySelectorAll('ul')].find(list => list.textContent?.includes('First item keeps a source link'))
      expect(ordinaryList?.querySelectorAll(':scope > li')).toHaveLength(2)
      expect(mounted.host.textContent).toContain('This paragraph remains between the two source-owned lists.')
      expect(mounted.host.querySelector('pre code')?.textContent).toContain("const unit = 'ms'")
    } finally {
      await act(async () => mounted.root.unmount())
    }
  })
})
