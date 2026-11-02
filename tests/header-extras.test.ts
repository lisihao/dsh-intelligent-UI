// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperienceStore, HeaderControls } from '../src/client.js'
import { initialSettings, type ExperienceSettings, type SaveSettingsInput } from '../src/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const views: Array<{ root: Root; node: HTMLElement }> = []
const open = new WeakSet<Element>()
let showDescriptor: PropertyDescriptor | undefined, hideDescriptor: PropertyDescriptor | undefined, resizeDescriptor: PropertyDescriptor | undefined
class TestObserver implements ResizeObserver {
  static observers: TestObserver[] = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) { TestObserver.observers.push(this) }
  fire() { this.callback([], this) }
}
beforeEach(() => {
  TestObserver.observers = []
  showDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover')
  hideDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover')
  resizeDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value(this: HTMLElement) { open.add(this); this.dispatchEvent(new Event('toggle')) } })
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value(this: HTMLElement) { open.delete(this); this.dispatchEvent(new Event('toggle')) } })
  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestObserver })
  const matches = HTMLElement.prototype.matches
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) { return selector === ':popover-open' ? open.has(this) : matches.call(this, selector) })
})
afterEach(async () => {
  for (const item of views.splice(0)) { await act(async () => item.root.unmount()); item.node.remove() }
  vi.restoreAllMocks()
  if (showDescriptor) Object.defineProperty(HTMLElement.prototype, 'showPopover', showDescriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
  if (hideDescriptor) Object.defineProperty(HTMLElement.prototype, 'hidePopover', hideDescriptor); else Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover')
  if (resizeDescriptor) Object.defineProperty(window, 'ResizeObserver', resizeDescriptor); else Reflect.deleteProperty(window, 'ResizeObserver')
})

async function fixture(width: number, container = true) {
  let actual: ExperienceSettings = { ...initialSettings(), takeover: true }
  const save = vi.fn(async (input: SaveSettingsInput) => {
    actual = { ...actual, takeover: input.takeover, openui: input.openui, mcpApps: input.mcpApps, revision: actual.revision + 1,
      ...(input.appearance ? { appearance: input.appearance } : {}), ...(input.themeId ? { theme: { activeId: input.themeId, installed: [] } } : {}) }
    return actual
  })
  const store = new ExperienceStore()
  store.update({ settings: actual, api: { settings: async () => actual, saveSettings: save, artifacts: async () => [], publish: async () => { throw new Error('unused') } } })
  const outer = document.createElement('section'), host = document.createElement('div')
  if (container) outer.style.setProperty('container-type', 'inline-size')
  let currentWidth = width
  Object.defineProperty(outer, 'clientWidth', { configurable: true, get: () => currentWidth })
  outer.append(host); document.body.append(outer)
  const root = createRoot(host); views.push({ root, node: outer })
  await act(async () => root.render(h(HeaderControls, { store, sessionId: 'test' })))
  return { store, save, host, outer, root, setWidth(value: number) { currentWidth = value } }
}
function extras(host: HTMLElement) { return host.querySelector<HTMLDivElement>('.iexp-header-extras-panel')! }
function more(host: HTMLElement) { return host.querySelector<HTMLButtonElement>('button[aria-label="更多显示选项"]')! }
function input(host: HTMLElement) { return host.querySelector<HTMLInputElement>('.iexp-transparency-control input')! }

describe('compact host header extras', () => {
  it('uses the nearest host container, keeps both primary controls visible and mounts one set of extras', async () => {
    const f = await fixture(600)
    expect(f.host.querySelector('.iexp-header-controls')?.getAttribute('data-compact')).toBe('true')
    expect(f.host.querySelector('select[aria-label="输出显示方式"]')).not.toBeNull()
    expect(f.host.querySelector('select[aria-label="界面主题"]')).not.toBeNull()
    expect(f.host.querySelectorAll('.iexp-transparency-control input')).toHaveLength(1)
    expect(f.host.querySelectorAll('.iexp-research-mode input')).toHaveLength(1)
    expect(extras(f.host).getAttribute('popover')).toBe('auto')
    expect(more(f.host).getAttribute('popovertarget')).toBe(extras(f.host).id)
    expect(more(f.host).getAttribute('aria-expanded')).toBe('false')
    expect(TestObserver.observers).toHaveLength(1)
    expect(TestObserver.observers[0]!.observe).toHaveBeenCalledWith(f.outer)
  })

  it('closes the child slider and cancels an uncommitted preview when the native parent closes', async () => {
    const f = await fixture(600), parent = extras(f.host)
    await act(async () => parent.showPopover())
    expect(more(f.host).getAttribute('aria-expanded')).toBe('true')
    await act(async () => input(f.host).focus())
    const child = f.host.querySelector<HTMLDivElement>('.iexp-opacity-popover')!
    expect(open.has(child)).toBe(true)
    const slider = child.querySelector<HTMLInputElement>('input[type=range]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(slider, '53'); slider.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(f.store.snapshot().appearancePreview?.backgroundOpacity).toBe(0.47)
    await act(async () => parent.hidePopover())
    expect(more(f.host).getAttribute('aria-expanded')).toBe('false')
    expect(open.has(child)).toBe(false)
    expect(f.store.snapshot().appearancePreview).toBeUndefined()
    expect(f.save).not.toHaveBeenCalled()
  })

  it('keeps a newly focused slider open when More reopens before its native toggle event', async () => {
    const f = await fixture(600), parent = extras(f.host)
    await act(async () => parent.showPopover())
    await act(async () => parent.hidePopover())
    const child = f.host.querySelector<HTMLDivElement>('.iexp-opacity-popover')!
    await act(async () => {
      // Native auto-popover state changes before its toggle event is delivered.
      open.add(parent)
      input(f.host).focus()
      parent.dispatchEvent(new Event('toggle'))
    })
    expect(more(f.host).getAttribute('aria-expanded')).toBe('true')
    expect(open.has(child)).toBe(true)
    expect(f.save).not.toHaveBeenCalled()
  })

  it('moves the same mounted controls inline on resize, closes the popovers and preserves focus and settings', async () => {
    const f = await fixture(600), parent = extras(f.host), checkbox = input(f.host)
    const research = f.host.querySelector<HTMLInputElement>('.iexp-research-mode input')!
    await act(async () => parent.showPopover())
    await act(async () => checkbox.focus())
    const child = f.host.querySelector<HTMLElement>('.iexp-opacity-popover')!
    expect(open.has(child)).toBe(true)
    f.setWidth(1400)
    await act(async () => TestObserver.observers[0]!.fire())
    expect(f.host.querySelector('.iexp-header-controls')?.getAttribute('data-compact')).toBe('false')
    expect(f.host.querySelector('.iexp-header-extras-panel')).toBe(parent)
    expect(input(f.host)).toBe(checkbox)
    expect(f.host.querySelector('.iexp-research-mode input')).toBe(research)
    expect(parent.hasAttribute('popover')).toBe(false)
    expect(open.has(parent)).toBe(false)
    expect(open.has(child)).toBe(false)
    expect(document.activeElement).toBe(checkbox)
    expect(f.save).not.toHaveBeenCalled()
    f.setWidth(600)
    await act(async () => TestObserver.observers[0]!.fire())
    expect(extras(f.host)).toBe(parent)
    expect(input(f.host)).toBe(checkbox)
    expect(parent.getAttribute('popover')).toBe('auto')
  })

  it('moves focus out of a closing slider to a visible control before returning to wide mode', async () => {
    const f = await fixture(600), parent = extras(f.host)
    await act(async () => parent.showPopover())
    await act(async () => input(f.host).focus())
    const slider = f.host.querySelector<HTMLInputElement>('.iexp-opacity-popover input[type=range]')!
    await act(async () => slider.focus())
    expect(document.activeElement).toBe(slider)
    f.setWidth(1400)
    await act(async () => TestObserver.observers[0]!.fire())
    expect(document.activeElement).toBe(f.host.querySelector('.iexp-research-mode input'))
    expect(open.has(f.host.querySelector('.iexp-opacity-popover')!)).toBe(false)
    expect(f.save).not.toHaveBeenCalled()
  })

  it('falls back to the visible theme control if the slider closes without a research control', async () => {
    const f = await fixture(600)
    await act(async () => f.store.update({ ...f.store.snapshot(), settings: { ...f.store.snapshot().settings!, takeover: false } }))
    await act(async () => extras(f.host).showPopover())
    await act(async () => input(f.host).focus())
    const slider = f.host.querySelector<HTMLInputElement>('.iexp-opacity-popover input[type=range]')!
    await act(async () => slider.focus())
    f.setWidth(1400)
    await act(async () => TestObserver.observers[0]!.fire())
    expect(document.activeElement).toBe(f.host.querySelector('select[aria-label="界面主题"]'))
    expect(open.has(f.host.querySelector('.iexp-opacity-popover')!)).toBe(false)
  })

  it('keeps keyboard focus on a visible control when a closed More button disappears', async () => {
    const f = await fixture(600)
    await act(async () => more(f.host).focus())
    expect(document.activeElement).toBe(more(f.host))
    f.setWidth(1400)
    await act(async () => TestObserver.observers[0]!.fire())
    expect(document.activeElement).toBe(f.host.querySelector('.iexp-research-mode input'))
    expect(f.save).not.toHaveBeenCalled()
  })

  it('uses viewport width and a resize listener when no size container exists', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
      const f = await fixture(0, false)
      expect(TestObserver.observers).toHaveLength(0)
      expect(f.host.querySelector('.iexp-header-controls')?.getAttribute('data-compact')).toBe('true')
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(f.host.querySelector('.iexp-header-controls')?.getAttribute('data-compact')).toBe('false')
    } finally {
      if (descriptor) Object.defineProperty(window, 'innerWidth', descriptor)
      else Reflect.deleteProperty(window, 'innerWidth')
    }
  })

  it('disconnects the observer and closes any open native panel on unmount', async () => {
    const f = await fixture(600), parent = extras(f.host), observer = TestObserver.observers[0]!
    await act(async () => parent.showPopover())
    await act(async () => f.root.unmount())
    views.splice(views.findIndex(item => item.root === f.root), 1); f.outer.remove()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(open.has(parent)).toBe(false)
  })

  it('shows save errors in a viewport-positioned popover associated with the theme select', async () => {
    const f = await fixture(600)
    await act(async () => f.store.update({ ...f.store.snapshot(), api: { ...f.store.snapshot().api!, saveSettings: async () => { throw new Error('offline') } } }))
    const theme = f.host.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!
    await act(async () => { theme.value = 'ascii'; theme.dispatchEvent(new Event('change', { bubbles: true })) })
    const error = f.host.querySelector<HTMLElement>('.iexp-quick-theme-error')!
    expect(error.getAttribute('role')).toBe('alert')
    expect(theme.getAttribute('aria-describedby')).toBe(error.id)
    expect(error.getAttribute('popover')).toBe('auto')
    expect(open.has(error)).toBe(true)
    expect(error.style.left).toMatch(/px$/)
    expect(error.style.top).toMatch(/px$/)
    expect(error.textContent).toContain('offline')
  })

  it('keeps an accessible positioned error when the Popover API is unavailable', async () => {
    Reflect.deleteProperty(HTMLElement.prototype, 'showPopover')
    const f = await fixture(600)
    await act(async () => f.store.update({ ...f.store.snapshot(), api: { ...f.store.snapshot().api!, saveSettings: async () => { throw new Error('offline') } } }))
    const theme = f.host.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!
    await act(async () => { theme.value = 'ascii'; theme.dispatchEvent(new Event('change', { bubbles: true })) })
    const error = f.host.querySelector<HTMLElement>('.iexp-quick-theme-error')!
    expect(error.hasAttribute('popover')).toBe(false)
    expect(theme.getAttribute('aria-describedby')).toBe(error.id)
    expect(error.style.left).toMatch(/px$/)
    expect(error.textContent).toContain('offline')
    await act(async () => error.querySelector('button')!.click())
    expect(f.host.querySelector('.iexp-quick-theme-error')).toBeNull()
    expect(theme.hasAttribute('aria-describedby')).toBe(false)
  })
})
