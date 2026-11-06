import { describe, expect, it } from 'vitest'
import { CANVAS_HTML_EFFECT_NAMES } from '../src/canvas-html-names.js'
import { getCompositionCatalog } from '../src/adaptive-ui/catalog.js'
import { builtInThemes } from '../src/theme-contracts.js'

describe('experimental executable effect catalog', () => {
  it('exposes the existing HTML, isolated and scroll adapters only through the experimental source-bound path', () => {
    const legacy = getCompositionCatalog()
    const experimental = getCompositionCatalog(builtInThemes, { experimentalBlocks: true })
    const slugs = [...CANVAS_HTML_EFFECT_NAMES, 'bend', 'hex-float', 'particle-scroll']
    for (const slug of slugs) {
      expect(legacy.entries.find(entry => entry.id === `canvas:${slug}`)?.availability).toBe('blocked')
      const entry = experimental.entries.find(entry => entry.id === `canvas:${slug}`)!
      expect(entry.availability).toBe('conditional')
      expect(entry.eligibility.allOf).toContain('bounded-noninteractive-source')
      expect(entry.eligibility.allOf).toContain('separate-visible-source')
    }
    expect(experimental.entries.find(entry => entry.id === 'canvas:cloth')?.availability).toBe('blocked')
    expect(experimental.entries.find(entry => entry.id === 'uiverse:galaxy-archive')?.availability).toBe('development-only')
  })
})
