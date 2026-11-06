// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { RuneSurfaceIds, collectRuneRegionGeometry } from '../src/rune/geometry.js'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
function setRect(element: HTMLElement, value: DOMRect): void { element.getBoundingClientRect = () => value }

describe('Rune visible-region geometry', () => {
  it('uses bounded visible geometry, real material names, and keeps foreign component subtrees out of Rust', () => {
    const root = document.createElement('section')
    const source = document.createElement('article'); source.setAttribute('data-rune-source', '')
    const card = document.createElement('section'); card.setAttribute('data-iexp-block-id', 'summary')
    const button = document.createElement('button'); button.textContent = '保存'
    const glass = document.createElement('section'); glass.setAttribute('data-rune-material', 'fluted-glass')
    const code = document.createElement('pre'); code.textContent = 'const value = 1'
    const foreign = document.createElement('section'); foreign.setAttribute('data-iexp-executable-component', 'uiverse:soft-relief:card')
    const foreignButton = document.createElement('button'); foreignButton.textContent = 'Foreign'; foreign.append(foreignButton)
    const foreignTheme = document.createElement('section'); foreignTheme.setAttribute('data-iexp-block-theme', 'ascii')
    const themedButton = document.createElement('button'); themedButton.textContent = 'ASCII'; foreignTheme.append(themedButton)
    source.append(card, button, glass, code, foreign, foreignTheme); root.append(source); document.body.append(root)
    setRect(root, rect(10, -40, 390, 900)); setRect(source, rect(10, -40, 390, 900)); setRect(card, rect(26, 20, 358, 160)); setRect(button, rect(26, 200, 92, 36)); setRect(glass, rect(26, 252, 358, 108)); setRect(code, rect(26, 376, 358, 80)); setRect(foreign, rect(26, 472, 358, 90)); setRect(foreignButton, rect(34, 484, 92, 36)); setRect(foreignTheme, rect(26, 580, 358, 90)); setRect(themedButton, rect(34, 592, 92, 36))
    const geometry = collectRuneRegionGeometry(root, new RuneSurfaceIds(), () => 'idle', { viewport: { width: 390, height: 390 }, reducedMotion: true })!
    expect(geometry.visibleYOffset).toBe(40)
    expect(geometry.payload).toMatchObject({ width: 390, height: 390, reducedMotion: true })
    const byElement = new Map(geometry.surfaces.map(item => [item.element, item.surface]))
    expect(byElement.get(button)).toMatchObject({ role: 'button', material: 'liquid-metal' })
    expect(byElement.get(glass)).toMatchObject({ material: 'fluted-glass' })
    expect(byElement.has(code)).toBe(false)
    expect(byElement.has(foreign)).toBe(false)
    expect(byElement.has(foreignButton)).toBe(false)
    expect(byElement.has(themedButton)).toBe(false)
    document.body.replaceChildren()
  })

  it('caps the Rust payload at the protocol surface limit while keeping every sent rectangle finite', () => {
    const root = document.createElement('section'); const source = document.createElement('div'); source.setAttribute('data-rune-source', ''); root.append(source); document.body.append(root)
    setRect(root, rect(0, 0, 390, 720)); setRect(source, rect(0, 0, 390, 720))
    for (let index = 0; index < 80; index += 1) {
      const button = document.createElement('button'); source.append(button); setRect(button, rect(8, 8 + index * 8, 80, 24))
    }
    const geometry = collectRuneRegionGeometry(root, new RuneSurfaceIds(), () => 'idle', { viewport: { width: 390, height: 720 } })!
    expect(geometry.surfaces.length).toBeLessThanOrEqual(64)
    expect(geometry.payload.surfaces.every(surface => Number.isFinite(surface.x) && Number.isFinite(surface.y) && surface.width > 0 && surface.height > 0)).toBe(true)
    document.body.replaceChildren()
  })

  it('keeps Canvas, TuffUI, and DIL library component roots and descendants out of Rune geometry', () => {
    const root = document.createElement('section')
    const source = document.createElement('article'); source.setAttribute('data-rune-source', '')
    root.append(source); document.body.append(root)
    setRect(root, rect(0, 0, 390, 720)); setRect(source, rect(0, 0, 390, 720))
    const roots = ['data-canvas-component', 'data-tuffui-component', 'data-dil-library-component'] as const
    const excluded: HTMLElement[] = []
    for (const [index, attribute] of roots.entries()) {
      const component = document.createElement('section')
      component.setAttribute(attribute, `fixture-${String(index)}`)
      const button = document.createElement('button'); button.textContent = attribute
      component.append(button); source.append(component)
      setRect(component, rect(12, 20 + index * 86, 366, 64))
      setRect(button, rect(24, 32 + index * 86, 160, 36))
      excluded.push(component, button)
    }
    const geometry = collectRuneRegionGeometry(root, new RuneSurfaceIds(), () => 'idle', { viewport: { width: 390, height: 390 } })!
    const emitted = new Set(geometry.surfaces.map(item => item.element))
    expect(excluded.every(element => !emitted.has(element))).toBe(true)
    document.body.replaceChildren()
  })
})
