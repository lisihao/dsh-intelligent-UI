// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installThoughtDagThemeBridge } from '../src/thoughtdag-theme.js'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'

class SettingsSource {
  settings: ExperienceSettings = { ...initialSettings(), takeover: true }
  listeners = new Set<() => void>()
  snapshot = () => ({ settings: this.settings })
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  update(settings: ExperienceSettings) { this.settings = settings; this.listeners.forEach(listener => listener()) }
}
const tokens = (settings: ExperienceSettings) => ({ '--iexp-bg': settings.appearance?.backgroundColor ?? '#24262b', '--iexp-text': 'rgb(255,255,255)', '--iexp-card': '#30343a', '--iexp-soft': '#282a30', '--iexp-font': "'DSH Recursive',system-ui,sans-serif", '--iexp-control-radius': '18px', '--iexp-node-radius': '24px', '--iexp-panel-radius': '26px', '--iexp-color-scheme': 'dark' })
const marker = 'style[data-solar-experience-thoughtdag]'
function frameHost(known = true) {
  const host = document.createElement('div')
  if (known) host.dataset.dshThoughtdag = ''
  const frame = document.createElement('iframe'); frame.title = 'ThoughtDAG'; frame.dataset.src = '/thoughtdag/'; frame.src = '/thoughtdag/'
  host.append(frame); document.body.append(host)
  const doc = frame.contentDocument!
  doc.open(); doc.write('<!doctype html><html data-theme="light"><head><style id="owner-style">:root{--color-card:#fff}.thought-node{border-radius:12px}</style></head><body><main id="root"><div class="thought-node" style="transform:translate(12px,20px)"><input value="original"><button>Owner action</button></div></main></body></html>'); doc.close()
  return { host, frame, doc }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('ThoughtDAG same-origin theme bridge', () => {
  it('updates only the owned stylesheet and preserves original graph, drafts, handlers and theme attributes', () => {
    const { frame, doc } = frameHost(), source = new SettingsSource()
    const ownerStyle = doc.querySelector('#owner-style')!, node = doc.querySelector('.thought-node')!, input = doc.querySelector('input')!, button = doc.querySelector('button')!
    const graphStyle = node.getAttribute('style'); input.value = 'unfinished thought'
    let clicks = 0; button.addEventListener('click', () => clicks++)
    const dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      const owned = doc.querySelector(marker)!
      expect(owned.textContent).toContain('--iexp-bg:#24262b')
      expect(owned.textContent).toContain('--color-surface:transparent')
      expect(owned.textContent).toContain('#root { background:var(--iexp-bg)')
      expect(owned.textContent).toContain('html,body { background:transparent')
      expect(owned.textContent).toContain('--color-watch:var(--iexp-error)')
      expect(owned.textContent).toContain('@font-face')
      expect(owned.textContent).toContain('border-radius:var(--iexp-node-radius')
      const firstText = owned.firstChild
      source.update({ ...source.settings })
      expect(owned.firstChild).toBe(firstText)
      source.update({ ...source.settings, appearance: { backgroundColor: '#f4f5f6', translucent: false } })
      expect(doc.querySelector(marker)).toBe(owned)
      expect(owned.textContent).toContain('--iexp-bg:#f4f5f6')
      expect(frame.contentDocument).toBe(doc); expect(doc.querySelector('#owner-style')).toBe(ownerStyle)
      expect(doc.documentElement.dataset.theme).toBe('light')
      expect(doc.querySelector('input')).toBe(input); expect(input.value).toBe('unfinished thought')
      expect(node.getAttribute('style')).toBe(graphStyle)
      button.click(); expect(clicks).toBe(1)
    } finally { dispose() }
    expect(doc.querySelector(marker)).toBeNull(); expect(doc.querySelector('#owner-style')).toBe(ownerStyle)
    expect(input.value).toBe('unfinished thought'); button.click(); expect(clicks).toBe(2)
    frame.dispatchEvent(new Event('load')); expect(doc.querySelector(marker)).toBeNull()
    expect(source.listeners.size).toBe(0)
  })
  it('removes every owned style/listener while off and restores them without reloading when enabled', () => {
    const { frame, doc } = frameHost(), source = new SettingsSource()
    const dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      expect(doc.querySelectorAll(marker)).toHaveLength(1)
      source.update({ ...source.settings, takeover: false })
      expect(doc.querySelector(marker)).toBeNull()
      frame.dispatchEvent(new Event('load')); expect(doc.querySelector(marker)).toBeNull()
      source.update({ ...source.settings, takeover: true })
      expect(doc.querySelectorAll(marker)).toHaveLength(1)
      expect(frame.contentDocument).toBe(doc)
    } finally { dispose() }
  })
  it('preserves the known landing logo font metrics while keeping the selected font on body and cards', () => {
    const { doc } = frameHost(), source = new SettingsSource()
    const lockup = doc.createElement('div'); lockup.className = 'text-center mb-8'
    lockup.innerHTML = '<svg aria-hidden="true"></svg><h1 class="text-4xl font-semibold tracking-tight text-ink mb-2.5">ThoughtDAG</h1><p>Original tagline</p>'
    doc.querySelector('#root')!.prepend(lockup)
    const otherHeading = doc.createElement('h1'); otherHeading.textContent = 'Card heading'; doc.querySelector('.thought-node')!.append(otherHeading)
    const dispose = installThoughtDagThemeBridge(source, settings => ({ ...tokens(settings), '--iexp-font': 'Georgia,serif' }))
    try {
      const css = doc.querySelector(marker)!.textContent!
      expect(css).toContain('--iexp-font:Georgia,serif')
      expect(css).toContain('html,body,#root { font-family:var(--iexp-font,system-ui,sans-serif)')
      const logoSelector = '#root .text-center.mb-8 > svg[aria-hidden="true"] + h1.text-4xl.font-semibold.tracking-tight'
      expect(doc.querySelectorAll(logoSelector)).toHaveLength(1)
      expect(doc.querySelector(logoSelector)).toBe(lockup.querySelector('h1'))
      expect(doc.defaultView!.getComputedStyle(lockup.querySelector('h1')!).fontFamily).toContain('Inter Variable')
      expect(doc.defaultView!.getComputedStyle(otherHeading).fontFamily).not.toContain('Inter Variable')
      expect(css).not.toMatch(/h1\s*\{\s*font-family:/)
    } finally { dispose() }
  })
  it('catches lazy frames, reapplies after a same-origin load, and releases detached frames', async () => {
    const source = new SettingsSource(), dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      const { host, frame, doc } = frameHost()
      await settle(); expect(doc.querySelector(marker)).toBeTruthy()
      doc.querySelector(marker)!.remove(); frame.dispatchEvent(new Event('load'))
      expect(doc.querySelectorAll(marker)).toHaveLength(1)
      host.remove(); await settle()
      expect(doc.querySelector(marker)).toBeNull()
      frame.dispatchEvent(new Event('load')); expect(doc.querySelector(marker)).toBeNull()
    } finally { dispose() }
  })
  it('ignores unrelated iframes even if their title and URL resemble ThoughtDAG', () => {
    const { doc } = frameHost(false), source = new SettingsSource()
    const dispose = installThoughtDagThemeBridge(source, tokens)
    try { expect(doc.querySelector(marker)).toBeNull() } finally { dispose() }
  })
  it('waits for a lazy src assignment instead of styling the initial blank document', async () => {
    const host = document.createElement('div'); host.dataset.dshThoughtdag = ''
    const frame = document.createElement('iframe'); frame.title = 'ThoughtDAG'; frame.dataset.src = '/thoughtdag/'
    host.append(frame); document.body.append(host)
    const initialDocument = frame.contentDocument!, source = new SettingsSource(), dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      expect(initialDocument.querySelector(marker)).toBeNull()
      frame.src = '/thoughtdag/'
      const loaded = frame.contentDocument!
      loaded.open(); loaded.write('<!doctype html><html><head></head><body><main id="root">Canvas</main></body></html>'); loaded.close()
      frame.dispatchEvent(new Event('load')); await settle()
      expect(loaded.querySelectorAll(marker)).toHaveLength(1)
      expect(initialDocument.querySelector(marker)).toBeNull()
    } finally { dispose() }
  })
  it('releases the old document and reapplies after an actual same-origin document navigation', async () => {
    const { frame, doc } = frameHost(), source = new SettingsSource(), dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      expect(doc.querySelector(marker)).toBeTruthy()
      frame.src = '/thoughtdag/?dv=new-build'
      const loaded = frame.contentDocument!
      loaded.open(); loaded.write('<!doctype html><html><head></head><body><input value="new document"></body></html>'); loaded.close()
      frame.dispatchEvent(new Event('load')); await settle()
      expect(loaded).not.toBe(doc)
      expect(loaded.querySelectorAll(marker)).toHaveLength(1)
      expect(doc.querySelector(marker)).toBeNull()
      expect(loaded.querySelector('input')?.value).toBe('new document')
    } finally { dispose() }
  })
  it('does not cross origin, logs one actionable diagnostic, and clears an old style', async () => {
    const { frame, doc } = frameHost(), source = new SettingsSource(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispose = installThoughtDagThemeBridge(source, tokens)
    try {
      expect(doc.querySelector(marker)).toBeTruthy()
      frame.src = 'https://outside.example/thoughtdag/'
      await settle(); expect(doc.querySelector(marker)).toBeNull()
      source.update({ ...source.settings })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('不是同源页面')
      expect(frame.contentDocument?.querySelector(marker)).toBeNull()
    } finally { dispose() }
  })
})
