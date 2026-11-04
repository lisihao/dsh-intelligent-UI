import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { initialSettings, type ExperienceSettings } from '../src/contracts.js'
import { builtInThemes, isAsciiTheme, themePackageSchema, themePreferenceSchema, resolveTheme, type ThemePackage, type InstallThemeInput, MAX_THEME_BYTES } from '../src/theme-contracts.js'
import { ExperienceStore, RevisionConflictError, ThemeIdConflictError, ThemeLimitError, ThemeNotFoundError, ThemePackageTooLargeError, ThemeValidationError, BuiltInThemeRemovalError, StoredDataError } from '../src/store.js'
import { ExperienceControl } from '../src/control.js'
import { RPC_REMOTE } from '../src/remote.js'
import type { McpHost } from '../src/mcp-host.js'

const roots: string[] = []
async function fixture() { const path = await mkdtemp(join(tmpdir(), 'experience-theme-')); roots.push(path); return { path, store: new ExperienceStore(path) } }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const custom = (id = 'local-study'): ThemePackage => ({ ...structuredClone(resolveTheme({ activeId: 'plain', installed: [] })), id, name: 'Local study' })
const flags = { takeover: true, openui: false, mcpApps: true }
const read = (path: string) => readFile(join(path, 'settings.json'), 'utf8')

describe('portable theme contracts', () => {
  it('resolves the accepted Empryo defaults and the distinct plain built-in from their JSON packages', () => {
    const base = resolveTheme()
    expect(base).toEqual(builtInThemes[0])
    expect(base.appearance).toEqual({ backgroundColor: '#24262b', translucent: true })
    expect(base.tokens).toMatchObject({ font: 'recursive', comparison: 'organic', translucentAlpha: 0.72, blur: 4, panelRadius: 28, cardRadius: 22, nodeRadius: 20, hoverLift: 3 })
    const plain = resolveTheme({ activeId: 'plain', installed: [] })
    expect(plain.appearance).toEqual({ backgroundColor: '#1b1b1c', translucent: false })
    expect(plain.tokens).toMatchObject({ font: 'system', comparison: 'standard', panelRadius: 12, cardRadius: 8, nodeRadius: 8, controlRadius: 6, hoverLift: 0, shadow: 'none' })
    for (const theme of builtInThemes) expect(themePackageSchema.parse(theme)).toEqual(theme)
  })

  it('rejects executable/unknown fields, unsupported versions, invalid identifiers, color injection and out-of-range tokens', () => {
    const theme = custom()
    for (const invalid of [
      { ...theme, formatVersion: 2 }, { ...theme, kind: 'other' }, { ...theme, css: 'body{display:none}' },
      { ...theme, id: '../outside' }, { ...theme, version: '1.0.0-01' }, { ...theme, description: 'x'.repeat(301) },
      { ...theme, tokens: { ...theme.tokens, accentDark: '#123456;display:none' } },
      { ...theme, tokens: { ...theme.tokens, hoverLift: 7 } }, { ...theme, tokens: { ...theme.tokens, translucentAlpha: 0.1 } },
      { ...theme, tokens: { ...theme.tokens, paletteDark: ['#123456'] } }, { ...theme, tokens: { ...theme.tokens, image: 'https://example.com/image.png' } },
    ]) expect(themePackageSchema.safeParse(invalid).success).toBe(false)
    expect(themePreferenceSchema.safeParse({ activeId: theme.id, installed: [theme] }).success).toBe(true)
    for (const installed of [[theme, theme], [builtInThemes[0]!]]) expect(themePreferenceSchema.safeParse({ activeId: 'empryo', installed }).success).toBe(false)
    expect(themePreferenceSchema.safeParse({ activeId: 'missing', installed: [] }).success).toBe(false)
  })

  it('validates the ASCII theme as a strict, mono-only V3 while preserving V1 and V2 contracts', () => {
    expect(builtInThemes.slice(0, 4).map(theme => theme.id)).toEqual(['empryo', 'ascii', 'ascii-gpu', 'plain'])
    const ascii = resolveTheme({ activeId: 'ascii', installed: [] })
    expect(isAsciiTheme(ascii)).toBe(true)
    expect(ascii).toMatchObject({ formatVersion: 3, presentation: 'ascii', id: 'ascii', name: '经典 ASCII', author: 'Solar', license: 'MIT',
      appearance: { backgroundColor: '#191c19', translucent: true, backgroundOpacity: .85 },
      tokens: { accentDark: '#b9d985', accentLight: '#405d25', font: 'mono', panelRadius: 12, cardRadius: 8, nodeRadius: 8, controlRadius: 6,
        density: 'compact', translucentAlpha: .85, hoverLift: 2, shadow: 'soft', comparison: 'standard', composition: 'document' } })
    expect(new Set(ascii.tokens.paletteDark).size).toBe(4)
    expect(new Set(ascii.tokens.paletteLight).size).toBe(4)
    expect(themePreferenceSchema.safeParse({ activeId: 'ascii', installed: [] }).success).toBe(true)
    for (const invalid of [
      { ...ascii, presentation: 'standard' }, { ...ascii, presentation: undefined },
      { ...ascii, css: 'body{display:none}' }, { ...ascii, assets: ['https://example.com/font.woff2'] },
      { ...ascii, tokens: { ...ascii.tokens, font: 'system' } }, { ...ascii, tokens: { ...ascii.tokens, css: 'display:none' } },
    ]) expect(themePackageSchema.safeParse(invalid).success).toBe(false)
    const legacy = builtInThemes[0]!, component = builtInThemes.find(theme => theme.formatVersion === 2)!
    for (const theme of [legacy, component]) {
      expect(isAsciiTheme(theme)).toBe(false)
      expect(themePackageSchema.safeParse({ ...theme, presentation: 'ascii' }).success).toBe(false)
      expect(themePackageSchema.safeParse({ ...theme, tokens: { ...theme.tokens, font: 'mono' } }).success).toBe(false)
    }
  })
})

describe('theme persistence through the existing settings CAS', () => {
  it('reads legacy settings as Empryo without overwriting appearance or migrating the file', async () => {
    const { path, store } = await fixture()
    const legacy = { formatVersion: 1, revision: 8, ...flags, appearance: { backgroundColor: '#abcdef', translucent: false } }
    const bytes = JSON.stringify(legacy)
    await writeFile(join(path, 'settings.json'), bytes)
    const loaded = await store.settings()
    expect(loaded).toEqual(legacy)
    expect(resolveTheme(loaded.theme).id).toBe('empryo')
    expect(await read(path)).toBe(bytes)
    const saved = await store.saveSettings({ expectedRevision: 8, ...flags })
    expect(saved.appearance).toEqual(legacy.appearance)
    expect(saved.theme).toBeUndefined()
  })

  it('installs without activating, notifies after persistence and restores the catalog on restart', async () => {
    const { path, store } = await fixture(), theme = custom()
    const seen: ExperienceSettings[] = []
    const unsubscribe = store.subscribe(value => seen.push(value))
    const saved = await store.installTheme({ expectedRevision: 0, theme })
    expect(saved).toMatchObject({ revision: 1, takeover: false, openui: true, mcpApps: false, theme: { activeId: 'empryo', installed: [theme] } })
    expect(saved.appearance).toEqual(initialSettings().appearance)
    expect(JSON.parse(await read(path))).toEqual(saved)
    expect(await new ExperienceStore(path).settings()).toEqual(saved)
    expect(seen).toEqual([saved])
    unsubscribe()
    await store.removeTheme({ expectedRevision: 1, id: theme.id })
    expect(seen).toHaveLength(1)
  })

  it('switches themes atomically, preserves an explicit appearance override and supports older settings callers', async () => {
    const { path, store } = await fixture(), theme = custom()
    await store.installTheme({ expectedRevision: 0, theme })
    const selected = await store.saveSettings({ expectedRevision: 1, ...flags, themeId: theme.id })
    expect(selected).toMatchObject({ ...flags, revision: 2, appearance: theme.appearance, theme: { activeId: theme.id, installed: [theme] } })
    const override = { backgroundColor: '#A1B2c3', translucent: true }
    await store.saveSettings({ expectedRevision: 2, ...flags, appearance: override })
    const unchangedSelection = await store.saveSettings({ expectedRevision: 3, ...flags, themeId: theme.id })
    expect(unchangedSelection.appearance).toEqual(override)
    const oldCaller = await store.saveSettings({ expectedRevision: 4, ...flags })
    expect(oldCaller.theme).toEqual(selected.theme)
    expect(oldCaller.appearance).toEqual(override)
    const switched = await store.saveSettings({ expectedRevision: 5, ...flags, themeId: 'empryo' })
    expect(switched.appearance).toEqual(resolveTheme().appearance)
    const explicit = await store.saveSettings({ expectedRevision: 6, ...flags, themeId: 'plain', appearance: override })
    expect(explicit.appearance).toEqual(override)
    expect(explicit.theme?.activeId).toBe('plain')
    expect(await new ExperienceStore(path).settings()).toEqual(explicit)
  })

  it('uses one revision queue across imports, selection and independent store instances', async () => {
    const { path, store } = await fixture(), other = new ExperienceStore(path), theme = custom()
    const outcomes = await Promise.allSettled([
      store.installTheme({ expectedRevision: 0, theme }),
      other.saveSettings({ expectedRevision: 0, ...flags, themeId: 'plain' }),
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(RevisionConflictError)
    expect((await store.settings()).revision).toBe(1)
    const persisted = await read(path)
    await expect(store.removeTheme({ expectedRevision: 0, id: theme.id })).rejects.toBeInstanceOf(RevisionConflictError)
    expect(await read(path)).toBe(persisted)
  })

  it('rejects duplicate/reserved/unknown themes and malformed packages without altering durable settings or notifying', async () => {
    const { path, store } = await fixture(), theme = custom()
    await store.installTheme({ expectedRevision: 0, theme })
    const before = await read(path), seen: number[] = []
    store.subscribe(settings => seen.push(settings.revision))
    await expect(store.installTheme({ expectedRevision: 1, theme })).rejects.toBeInstanceOf(ThemeIdConflictError)
    await expect(store.installTheme({ expectedRevision: 1, theme: builtInThemes[0]! })).rejects.toBeInstanceOf(ThemeIdConflictError)
    await expect(store.saveSettings({ expectedRevision: 1, ...flags, themeId: 'missing' })).rejects.toBeInstanceOf(ThemeNotFoundError)
    for (const invalid of [{ ...theme, formatVersion: 2 }, { ...theme, css: 'body{}' }]) {
      expect(() => store.installTheme({ expectedRevision: 1, theme: invalid } as InstallThemeInput)).toThrow(ThemeValidationError)
    }
    const oversized = { ...theme, extra: 'x'.repeat(MAX_THEME_BYTES) }
    expect(() => store.installTheme({ expectedRevision: 1, theme: oversized } as InstallThemeInput)).toThrow(ThemePackageTooLargeError)
    expect(await read(path)).toBe(before)
    expect(seen).toEqual([])
  })

  it('bounds the imported catalog and keeps the accepted thirty-two packages intact on overflow', async () => {
    const { path, store } = await fixture()
    for (let index = 0; index < 32; index++) await store.installTheme({ expectedRevision: index, theme: custom(`local-${index}`) })
    const before = await read(path)
    await expect(store.installTheme({ expectedRevision: 32, theme: custom('one-too-many') })).rejects.toBeInstanceOf(ThemeLimitError)
    expect(await read(path)).toBe(before)
    expect((await store.settings()).theme?.installed).toHaveLength(32)
  })

  it('removes inactive packages without changing appearance and resets an active removal to Empryo atomically', async () => {
    const { path, store } = await fixture(), first = custom(), second = custom('second')
    await store.installTheme({ expectedRevision: 0, theme: first })
    await store.installTheme({ expectedRevision: 1, theme: second })
    const appearance = { backgroundColor: '#abcdEF', translucent: true }
    await store.saveSettings({ expectedRevision: 2, ...flags, themeId: first.id, appearance })
    const inactive = await store.removeTheme({ expectedRevision: 3, id: second.id })
    expect(inactive.appearance).toEqual(appearance)
    expect(inactive.theme).toEqual({ activeId: first.id, installed: [first] })
    const active = await store.removeTheme({ expectedRevision: 4, id: first.id })
    expect(active).toMatchObject({ ...flags, revision: 5, appearance: resolveTheme().appearance, theme: { activeId: 'empryo', installed: [] } })
    const before = await read(path)
    await expect(store.removeTheme({ expectedRevision: 5, id: 'plain' })).rejects.toBeInstanceOf(BuiltInThemeRemovalError)
    await expect(store.removeTheme({ expectedRevision: 5, id: 'missing' })).rejects.toBeInstanceOf(ThemeNotFoundError)
    expect(await read(path)).toBe(before)
  })

  it('refuses malformed durable catalogs rather than silently falling back or rewriting them', async () => {
    const { path, store } = await fixture(), theme = custom()
    for (const preference of [
      { activeId: 'missing', installed: [] }, { activeId: 'empryo', installed: [theme, theme] },
      { activeId: 'empryo', installed: [{ ...theme, formatVersion: 99 }] },
    ]) {
      const bytes = JSON.stringify({ ...initialSettings(), theme: preference })
      await writeFile(join(path, 'settings.json'), bytes)
      await expect(store.settings()).rejects.toBeInstanceOf(StoredDataError)
      expect(await read(path)).toBe(bytes)
    }
  })
})

describe('theme RPC boundary', () => {
  it('publishes strict codecs and rejects non-owner installation/removal before touching the store', async () => {
    const { path, store } = await fixture(), ctx = new Context()
    const control = new ExperienceControl(ctx, store, {} as McpHost)
    try {
      Object.defineProperty(ctx, 'invocation', { configurable: true, value: { peer: { principal: { kind: 'api' } } } })
      await expect(control.installTheme({ expectedRevision: 0, theme: custom() })).rejects.toThrow('EXPERIENCE_OWNER_REQUIRED')
      await expect(control.removeTheme({ expectedRevision: 0, id: 'plain' })).rejects.toThrow('EXPERIENCE_OWNER_REQUIRED')
      expect((await store.settings()).revision).toBe(0)
      await expect(read(path)).rejects.toMatchObject({ code: 'ENOENT' })
      for (const name of ['installTheme', 'removeTheme']) {
        const descriptor = RPC_REMOTE.descriptors!.find(value => value.method === name)!
        expect(descriptor).toBeDefined()
        expect(descriptor.parameters[0]?.codec.mode).toBe('strict')
        expect(descriptor.result.mode).toBe('strict')
      }
    } finally { await ctx.fiber.dispose() }
  })
})
