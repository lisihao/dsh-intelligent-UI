// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { Simulate } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Settings, ExperienceStore as ClientStore, HeaderControls } from '../src/client.js'
import { ExperienceStore as HostStore } from '../src/store.js'
import { ContentView } from '../src/presentation.js'
import { installAppearanceStyles } from '../src/appearance-style.js'
import { builtInThemes, resolveTheme, type ThemePackage } from '../src/theme-contracts.js'
import { createHash } from 'node:crypto'
import { listSourceThemes, downloadSourceTheme } from '../src/theme-download.js'
import { DEFAULT_THEME_SOURCE } from '../src/theme-source.js'
import { parseThemeFile } from '../src/theme-settings.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const temporary: string[] = []
const pending: Promise<unknown>[] = []
function tracked<T>(operation: Promise<T>): Promise<T> { pending.push(operation); return operation }
async function settle() {
  await Promise.resolve()
  while (pending.length) { await Promise.allSettled(pending.splice(0)); await Promise.resolve() }
}
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }) })

const importedTheme = (): ThemePackage => ({
  ...structuredClone(builtInThemes[1]!), id: 'linen', name: '亚麻纸', description: '适合长文阅读的暖白背景。',
  appearance: { backgroundColor: '#f6f1e8', translucent: false },
  tokens: { ...builtInThemes[1]!.tokens, accentLight: '#476559', paletteLight: ['#476559', '#85652f', '#83465c', '#315d7d'], font: 'serif', density: 'comfortable' },
})

async function setup(fetcher?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'iexp-theme-client-')); temporary.push(dir)
  const host = new HostStore(dir)
  const initial = await host.settings()
  const settings = await host.saveSettings({ expectedRevision: initial.revision, takeover: true, openui: true, mcpApps: false, appearance: { backgroundColor: '#36404f', translucent: true } })
  const store = new ClientStore()
  store.update({ settings, api: {
    settings: () => tracked(host.settings()), saveSettings: input => tracked(host.saveSettings(input)),
    themeCatalog: () => tracked(listSourceThemes(host, fetcher)), downloadTheme: input => tracked(downloadSourceTheme(host, input, fetcher)),
    installTheme: input => tracked(host.installTheme(input)), removeTheme: input => tracked(host.removeTheme(input)),
    artifacts: async () => [], publish: async () => { throw new Error('Not used') },
  } })
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element), dispose = installAppearanceStyles(store)
  return { dir, host, store, element, root, dispose, async cleanup() { await act(async () => { await settle(); root.unmount(); dispose() }); element.remove() } }
}

async function selectTheme(element: HTMLElement, id: string) {
  const select = element.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!
  await act(async () => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await settle() })
}

async function upload(element: HTMLElement, text: string) {
  const input = element.querySelector<HTMLInputElement>('input[type=file]')!
  const file = new File([text], 'downloaded.dsh-theme.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => text })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await settle() })
}

describe('downloadable themes through real settings persistence', () => {
  it('preserves legacy appearance, imports a real file, selects and survives a new store, then removes it', async () => {
    const s = await setup()
    try {
      await act(async () => s.root.render(h('div', null, h(Settings, { store: s.store }), h(HeaderControls, { store: s.store, sessionId: 'theme-test' }))))
      expect(s.element.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!.value).toBe('empryo')
      expect((await s.host.settings()).appearance).toEqual({ backgroundColor: '#36404f', translucent: true })
      const theme = importedTheme()
      await upload(s.element, JSON.stringify(theme))
      expect(s.element.textContent).toContain('已导入「亚麻纸」')
      expect(resolveTheme((await s.host.settings()).theme).id).toBe('empryo')
      await selectTheme(s.element, 'linen')
      expect(s.element.querySelector<HTMLSelectElement>('select[aria-label="界面主题"]')!.value).toBe('linen')
      const restarted = await new HostStore(s.dir).settings()
      expect(resolveTheme(restarted.theme)).toEqual(theme)
      expect(restarted.appearance).toEqual(theme.appearance)
      expect([restarted.takeover, restarted.openui, restarted.mcpApps]).toEqual([true, true, false])
      expect(s.element.querySelector<HTMLInputElement>('.iexp-transparency-control input')!.checked).toBe(false)
      const downloaded = s.element.querySelector<HTMLAnchorElement>('a[download]')!
      expect(parseThemeFile(decodeURIComponent(downloaded.getAttribute('href')!.split(',')[1]!))).toEqual(theme)
      await act(async () => { [...s.element.querySelectorAll('button')].find(button => button.textContent === '移除此主题')!.click(); await settle() })
      const removed = await s.host.settings()
      expect(removed.theme?.installed).toEqual([])
      expect(resolveTheme(removed.theme).id).toBe('empryo')
      expect(removed.appearance).toEqual(builtInThemes[0]!.appearance)
      expect(s.element.textContent).toContain('已恢复 Empryo')
    } finally { await s.cleanup() }
  })

  it('keeps the source disclosure mounted during a theme switch and invalid files leave settings untouched', async () => {
    const s = await setup()
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    try {
      const source = '# 原始报告\n\n| 费用 | 金额（亿元） |\n|---|---|\n| 训练 | 23.80 |\n| 推理 | 97.41 |\n'
      await act(async () => s.root.render(h('div', null, h(Settings, { store: s.store }), h(ContentView, { value: source }))))
      const disclosure = s.element.querySelector<HTMLDetailsElement>('.iexp-full-table')!
      expect(disclosure).not.toBeNull()
      disclosure.open = true
      expect(s.element.querySelector('[data-comparison-plot]')).not.toBeNull()
      await selectTheme(s.element, 'plain')
      expect(s.element.querySelector('[data-comparison-plot]')).toBeNull()
      expect(s.element.textContent).not.toContain('内容无法显示')
      expect(s.element.querySelector('.iexp-full-table')).toBe(disclosure)
      expect(disclosure.open).toBe(true)
      expect(s.element.textContent).toContain('23.80')
      expect(s.element.textContent).toContain('97.41')
      const before = await readFile(join(s.dir, 'settings.json'), 'utf8')
      await upload(s.element, '{broken')
      expect(s.element.querySelector('[role=alert]')?.textContent).toContain('不是有效的 JSON')
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
      await upload(s.element, JSON.stringify({ ...importedTheme(), formatVersion: 3 }))
      expect(s.element.querySelector('[role=alert]')?.textContent).toContain('不支持这个主题包版本')
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
    } finally { await s.cleanup(); canvas.mockRestore(); vi.unstubAllGlobals() }
  })

  it('does not claim a theme import succeeded when the host rejects it', async () => {
    const s = await setup()
    try {
      await act(async () => s.root.render(h(Settings, { store: s.store })))
      const file = JSON.stringify(importedTheme())
      await upload(s.element, file)
      const before = await readFile(join(s.dir, 'settings.json'), 'utf8')
      await upload(s.element, file)
      expect(s.element.querySelector('[role=alert]')?.textContent).toMatch(/already|已安装|重复|CONFLICT/i)
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
    } finally { await s.cleanup() }
  })
})


describe('configured repository themes in Settings', () => {
  it('shows actionable inline validation, blocks invalid saves, and recovers without changing settings', async () => {
    const s = await setup()
    try {
      await act(async () => s.root.render(h(Settings, { store: s.store })))
      const input = s.element.querySelector<HTMLInputElement>('[aria-label="主题来源地址"]')!
      const save = [...s.element.querySelectorAll('button')].find(button => button.textContent === '保存来源')!
      const before = await readFile(join(s.dir, 'settings.json'), 'utf8')
      for (const value of ['not a url', '', 'ftp://example.org/theme/', 'https://github.com/lisihao/dsh-intelligent-UI']) {
        await act(async () => { input.value = value; Simulate.change(input) })
        expect(input.getAttribute('aria-invalid')).toBe('true')
        expect(save.disabled).toBe(true)
        const error = s.element.querySelector('[data-theme-source-error]')!
        expect(error.textContent).toMatch(/请|HTTP/)
        expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
        await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle() })
        expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
      }
      const restore = [...s.element.querySelectorAll('button')].find(button => button.textContent === '恢复默认来源')!
      expect(restore.disabled).toBe(false)
      await act(async () => { restore.click(); await settle() })
      expect(input.value).toBe(DEFAULT_THEME_SOURCE)
      expect(s.element.querySelector('[data-theme-source-error]')).toBeNull()
      expect(save.disabled).toBe(true)
      expect(restore.disabled).toBe(true)
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
      await act(async () => { input.value = 'https://example.org/my-themes/'; Simulate.change(input) })
      expect(input.getAttribute('aria-invalid')).toBeNull()
      expect(s.element.querySelector('[data-theme-source-error]')).toBeNull()
      expect(save.disabled).toBe(false)
      await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle() })
      expect((await s.host.settings()).themeSource).toBe('https://example.org/my-themes/')
      expect(save.disabled).toBe(true)
    } finally { await s.cleanup() }
  })

  it('uses the default directory, persists a custom source, downloads from it and restores the default', async () => {
    const theme = importedTheme(), bytes = JSON.stringify(theme)
    const catalog = { formatVersion: 1, themes: [{ id: theme.id, name: theme.name, version: theme.version, file: 'linen.dsh-theme.json', sha256: createHash('sha256').update(bytes).digest('hex') }] }
    const calls: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => { calls.push(String(input)); return new Response(String(input).endsWith('/index.json') ? JSON.stringify(catalog) : bytes) }) as unknown as typeof fetch
    const s = await setup(fetcher)
    const click = async (text: string) => act(async () => { [...s.element.querySelectorAll('button')].find(button => button.textContent === text)!.click(); await settle() })
    try {
      await act(async () => s.root.render(h(Settings, { store: s.store })))
      const input = s.element.querySelector<HTMLInputElement>('[aria-label="主题来源地址"]')!
      expect(input.value).toBe(DEFAULT_THEME_SOURCE)
      expect(calls).toEqual([])
      await act(async () => { input.value = 'https://example.org/my-themes/'; Simulate.change(input) })
      await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle() })
      expect((await new HostStore(s.dir).settings()).themeSource).toBe('https://example.org/my-themes/')
      await click('浏览来源主题')
      expect(s.element.querySelector('[aria-label="来源主题"]')?.textContent).toContain('亚麻纸')
      expect(calls).toEqual(['https://example.org/my-themes/index.json'])
      await click('下载导入')
      expect((await s.host.settings()).theme?.installed[0]).toEqual(theme)
      expect(s.element.textContent).toContain('已就绪')
      expect(resolveTheme((await s.host.settings()).theme).id).toBe('empryo')
      await click('恢复默认来源')
      expect((await s.host.settings()).themeSource).toBe(DEFAULT_THEME_SOURCE)
      expect(input.value).toBe(DEFAULT_THEME_SOURCE)
      expect(s.element.querySelector('[aria-label="来源主题"]')).toBeNull()
      expect((await s.host.settings()).appearance).toEqual({ backgroundColor: '#36404f', translucent: true })
    } finally { await s.cleanup() }
  })

  it('surfaces a source download failure and accepts an unchanged built-in file without a duplicate error', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404 })) as unknown as typeof fetch
    const s = await setup(fetcher)
    try {
      await act(async () => s.root.render(h(Settings, { store: s.store })))
      const before = await readFile(join(s.dir, 'settings.json'), 'utf8')
      await act(async () => { [...s.element.querySelectorAll('button')].find(button => button.textContent === '浏览来源主题')!.click(); await settle() })
      expect(s.element.querySelector('[role=alert]')?.textContent).toContain('HTTP 404')
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
      await upload(s.element, JSON.stringify(builtInThemes[0]))
      expect(s.element.textContent).toContain('已内置')
      expect(await readFile(join(s.dir, 'settings.json'), 'utf8')).toBe(before)
    } finally { await s.cleanup() }
  })
})
