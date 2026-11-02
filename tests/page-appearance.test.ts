// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { ExperienceStore } from '../src/client.js'
import { initialSettings } from '../src/contracts.js'
import { resolveTheme } from '../src/theme-contracts.js'
import linen from '../src/themes/linen-example.dsh-theme.json' with { type: 'json' }
import { themePackageSchema } from '../src/theme-contracts.js'
import { pageAppearanceCss } from '../src/page-appearance.js'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

describe('reversible appearance of original conversation pages', () => {
  it('turns off and disposes all page rules without replacing foreign DOM, state or registrations', () => {
    const store = new ExperienceStore(), settings = { ...initialSettings(), takeover: true }
    store.update({ settings })
    const foreign = document.createElement('section'); foreign.dataset.slot = 'conversation.view'
    foreign.innerHTML = '<div class="wsp-root"><input value="original draft"><button>Original action</button></div>'
    document.body.append(foreign)
    const input = foreign.querySelector('input')!; input.value = 'unfinished draft'
    let clicks = 0; foreign.querySelector('button')!.addEventListener('click', () => clicks++)
    const core = new SlotCore(), register = core.register.bind(core) as (options: unknown, component: unknown) => () => void
    const component = () => null
    const removeRoot = register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } }, () => null)
    const removePage = register({ name: 'conversation.view', id: 'mnemon', locale: 'original-memory' }, component)
    const before = core.entries('conversation.view')
    const dispose = installAppearanceStyles(store)
    try {
      const css = () => document.querySelector('[data-solar-experience-appearance]')!.textContent!
      expect(css()).toContain('[data-slot="conversation.view"]')
      expect(css()).toContain('--dsw-alias-settings-card-fill: var(--iexp-card)')
      const chat = document.createElement('div'); chat.dataset.slot = 'conversation.view'
      chat.innerHTML = '<div data-chat-flow><p>First</p><p>Latest</p></div>'
      const scrollport = document.createElement('div'); scrollport.dataset.conversationScroll = ''
      scrollport.append(chat, foreign); document.body.append(scrollport)
      const rules = [...document.querySelector<HTMLStyleElement>('[data-solar-experience-appearance]')!.sheet!.cssRules]
      const layout = rules.find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('justify-content') === 'flex-end')!
      expect(chat.matches(layout.selectorText)).toBe(true)
      expect(foreign.matches(layout.selectorText)).toBe(false)
      expect(layout.style.getPropertyPriority('display')).toBe('important')
      expect([...chat.querySelectorAll('p')].map(p => p.textContent)).toEqual(['First', 'Latest'])
      scrollport.replaceWith(foreign)
      store.update({ settings: { ...settings, takeover: false } })
      expect(css()).not.toContain('[data-slot="conversation.view"]')
      store.update({ settings })
      expect(css()).toContain('[data-slot="conversation.view"]')
      const first = document.querySelector('[data-solar-experience-appearance]')!.firstChild
      store.update({ settings: { ...settings } })
      expect(document.querySelector('[data-solar-experience-appearance]')!.firstChild).toBe(first)
      const base = resolveTheme()
      if (base.formatVersion !== 1) throw new Error('The default Empryo fixture must remain V1.')
      const theme = { ...base, id: 'compact-purple', name: 'Purple', tokens: { ...base.tokens, panelRadius: 16, font: 'serif' as const } }
      store.update({settings:{...settings, theme:{activeId:theme.id, installed:[theme]}}})
      expect(css()).toContain('--iexp-panel-radius:16px')
      expect(css()).toContain('.wsp-card-panel')
      expect(css()).toContain('--mn-sans: var(--iexp-font)')
      expect(css()).toContain('--dsw-radius-xl: var(--iexp-card-radius)')
      expect(core.entries('conversation.view')).toEqual(before)
      expect(foreign.querySelector('input')).toBe(input)
      expect(input.value).toBe('unfinished draft')
      foreign.querySelector('button')!.click(); expect(clicks).toBe(1)
    } finally { dispose(); removePage(); removeRoot() }
    expect(document.querySelector('[data-solar-experience-appearance]')).toBeNull()
    expect(foreign.querySelector('input')).toBe(input)
    expect(input.value).toBe('unfinished draft')
    foreign.querySelector('button')!.click(); expect(clicks).toBe(2)
    foreign.remove()
  })
  it('maps the published Mnemon warning-banner label role to readable light and dark theme ink', () => {
    const store = new ExperienceStore(), light = themePackageSchema.parse(linen)
    const dispose = installAppearanceStyles(store)
    const luminance = (color: number[]) => color.slice(0,3).reduce((sum, value, index) => { const s = value / 255; return sum + (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [.2126,.7152,.0722][index]! },0)
    const contrast = (a: number[], b: number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x,y) + .05) / (Math.min(x,y) + .05) }
    const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number)
    try {
      for (const theme of [light, resolveTheme()]) {
        store.update({ settings: { ...initialSettings(), takeover: true, appearance: theme.appearance, theme: theme.id === 'empryo' ? { activeId: 'empryo', installed: [] } : { activeId: theme.id, installed: [theme] } } })
        const element = document.querySelector<HTMLStyleElement>('[data-solar-experience-appearance]')!
        const rules = [...element.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        const outlet = rules.find(rule => rule.selectorText === '[data-slot="conversation.view"]')!.style
        // Mnemon's real status banner consumes this public role, rather than --mn-warn.
        expect(outlet.getPropertyValue('--dsw-alias-state-warn-label').trim()).toBe('var(--iexp-warning)')
        const variables = rules.find(rule => rule.selectorText.includes('[data-experience-theme]'))!.style
        const ink = channels(variables.getPropertyValue('--iexp-warning'))
        const surface = channels(variables.getPropertyValue('--iexp-soft'))
        for (const underlay of [0,255]) expect(contrast(ink, surface.slice(0,3).map(value => value * surface[3]! + underlay * (1-surface[3]!)))).toBeGreaterThanOrEqual(4.5)
        store.update({ settings: { ...initialSettings(), takeover: false } })
        expect(element.textContent).not.toContain('--dsw-alias-state-warn-label:')
      }
    } finally { dispose() }
  })

  it('covers catalog and memory cards without treating labels, tables or graph positioning as cards', () => {
    const sheet = document.createElement('style'); sheet.textContent = pageAppearanceCss(true); document.head.append(sheet)
    const host = document.createElement('div'); host.dataset.slot = 'conversation.view'
    host.innerHTML = `<main id="bench-top-panel"><article id="catalog" style="background:var(--dsw-alias-settings-card-fill)"><button>Configure</button></article><div id="table" style="background:var(--dsw-alias-settings-card-fill)"></div></main>
      <div data-dsh-plugin="dsh-mnemon" data-dsh-part="mnemon-view"><section class="abc_storageDomains"><div class="abc_storageAreaGrid"><article id="storage" data-status="empty"></article></div></section><article id="entry" class="abc_runtimeEntry abc_active"></article><span id="label" class="abc_runtimeEntryMeta"></span><div id="graph" class="abc_graphNode" style="transform:translate(20px,30px)"></div></div>
      <div id="foreign" class="abc_runtimeEntry"></div>`
    document.body.append(host)
    try {
      const styles = [...sheet.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      const selector = styles.find(rule => rule.style.getPropertyValue('box-shadow') === 'var(--iexp-shadow-node)')!.selectorText
      for (const id of ['catalog','storage','entry']) expect(host.querySelector('#'+id)!.matches(selector), id).toBe(true)
      for (const id of ['table','label','graph','foreign']) expect(host.querySelector('#'+id)!.matches(selector), id).toBe(false)
      expect(host.querySelector<HTMLElement>('#graph')!.style.transform).toBe('translate(20px,30px)')
      expect(pageAppearanceCss(false)).toBe('')
    } finally { sheet.remove(); host.remove() }
  })

})
