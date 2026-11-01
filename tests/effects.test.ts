// @vitest-environment jsdom
import { createElement as h, act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactSchema } from '../src/contracts.js'
import { parseMarkdownLayouts } from '../src/content-layout.js'
import { VisualEffectRegistry, visualEffects, installBuiltInVisualEffects, VisualEffectSlot } from '../src/effects.js'
import { ArtifactView, displayModes } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: Array<() => void> = []
afterEach(() => { for (const stop of cleanups.splice(0).reverse()) stop(); displayModes.clear(); vi.unstubAllGlobals() })

describe('visual effect boundaries', () => {
  it('uses explicit provider identities, rejects conflicts and disposes only the owned registration', () => {
    const registry = new VisualEffectRegistry()
    const component = ({ children }: { children?: ReactNode }) => h('div', null, children)
    const stop = registry.register({ id: 'canvasui.decrypt-reveal', version: 'test', component, gpu: true })
    expect([...registry.getSnapshot().keys()]).toEqual(['canvasui.decrypt-reveal'])
    expect(() => registry.register({ id: 'canvasui.decrypt-reveal', version: 'other', component, gpu: true })).toThrow('EXPERIENCE_EFFECT_REGISTRATION_CONFLICT')
    stop(); stop()
    expect(registry.getSnapshot().size).toBe(0)
    expect(() => registry.register({ id: 'unknown' as never, version: 'test', component, gpu: true })).toThrow()
  })

  it('preserves untrusted requests as data and rejects unsupported effect IDs', () => {
    const source = { formatVersion: 1, id: 'a3703a59-3cb7-474f-84e2-4989932b24ac', createdAt: '', source: { sessionId: 'a', kind: 'generated', label: 'title' }, protocol: 'content', raw: '# Title', payload: '# Title', providerId: 'content' }
    expect(artifactSchema.parse({ ...source, effectId: 'iexp.headline-reveal' }).effectId).toBe('iexp.headline-reveal')
    expect(artifactSchema.safeParse({ ...source, effectId: 'arbitrary.javascript' }).success).toBe(false)
    expect(parseMarkdownLayouts('```md\n# Fake title\n```\n\n# Real heading').titleStart).toBeGreaterThan(0)
  })

  it('keeps heading text when provider is missing and attaches one external provider without code injection', async () => {
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node)
    await act(async () => root.render(h(VisualEffectSlot, { id: 'canvasui.decrypt-reveal' }, h('h1', null, 'Original text'))))
    expect(node.textContent).toBe('Original text')
    expect(node.querySelector('[data-iexp-effect-status]')?.getAttribute('data-iexp-effect-status')).toBe('unavailable')
    let stop!: () => void
    await act(async () => { stop = visualEffects.register({ id: 'canvasui.decrypt-reveal', version: 'test', gpu: true, component: ({ children }) => h('section', { 'data-provider': 'authorized' }, children) }) })
    cleanups.push(stop)
    expect(node.querySelector('[data-provider]')?.textContent).toBe('Original text')
    await act(async () => stop())
    expect(node.querySelector('[data-provider]')).toBeNull()
    expect(node.textContent).toBe('Original text')
    await act(async () => root.unmount()); node.remove()
  })

  it('applies CSS fallback only to the first short generated H1 in visual mode', async () => {
    const stop = installBuiltInVisualEffects(); cleanups.push(stop)
    const raw = '# Report title\n\nBody text\n\n# Later title'
    const artifact = artifactSchema.parse({ formatVersion: 1, id: '56827bcc-0b95-411e-b40e-245ed1fc5af1', createdAt: '', source: { sessionId: 'effects', kind: 'generated', label: 'Report' }, protocol: 'content', raw, payload: raw, providerId: 'content', effectId: 'iexp.headline-reveal' })
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node)
    await act(async () => root.render(h(ArtifactView, { artifact })))
    expect(node.querySelectorAll('.iexp-headline-reveal')).toHaveLength(1)
    expect(node.textContent).toContain('Later title')
    await act(async () => displayModes.set('effects', 'raw'))
    expect(node.querySelector('.iexp-headline-reveal')).toBeNull()
    expect(node.querySelector('pre')?.textContent).toBe(raw)
    await act(async () => displayModes.set('effects', 'compare'))
    expect(node.querySelector('.iexp-headline-reveal')).toBeNull()
    await act(async () => displayModes.set('effects', 'visual'))
    expect(node.querySelectorAll('.iexp-headline-reveal')).toHaveLength(1)
    await act(async () => root.render(h(ArtifactView, { artifact, isStreaming: true })))
    expect(node.querySelector('.iexp-headline-reveal')).toBeNull()
    await act(async () => root.unmount()); node.remove()
  })

  it('honors reduced motion and retains the native heading', async () => {
    const stop = installBuiltInVisualEffects(); cleanups.push(stop)
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const node = document.createElement('div'); document.body.append(node); const root = createRoot(node)
    await act(async () => root.render(h(VisualEffectSlot, { id: 'iexp.headline-reveal' }, h('h1', null, 'Unanimated text'))))
    expect(node.querySelector('[data-iexp-effect-status]')?.getAttribute('data-iexp-effect-status')).toBe('reduced-motion')
    expect(node.textContent).toBe('Unanimated text')
    expect(node.querySelector('.iexp-headline-reveal')).toBeNull()
    await act(async () => root.unmount()); node.remove()
  })
})
