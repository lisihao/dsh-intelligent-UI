import { z } from 'zod'
import empryo from './themes/empryo.dsh-theme.json' with { type: 'json' }
import plain from './themes/plain.dsh-theme.json' with { type: 'json' }
import relief from './themes/uiverse-soft-relief.dsh-theme.json' with { type: 'json' }
import glass from './themes/uiverse-clear-glass.dsh-theme.json' with { type: 'json' }
import outline from './themes/uiverse-mechanical-outline.dsh-theme.json' with { type: 'json' }

export const MAX_THEME_BYTES = 32 * 1024
export const MAX_IMPORTED_THEMES = 32
export const themeIdSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const appearanceSchema = z.strictObject({ backgroundColor: hex, translucent: z.boolean(), backgroundOpacity: z.number().min(0.3).max(1).optional() })
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Portable data only: no free CSS, executable extensions or external assets. */
const themeV1Schema = z.strictObject({
  formatVersion: z.literal(1), kind: z.literal('dsh-experience-theme'),
  id: themeIdSchema, name: z.string().trim().min(1).max(80), version: z.string().max(64).regex(semver),
  author: z.string().trim().min(1).max(120).optional(), description: z.string().max(300).optional(),
  license: z.string().trim().min(1).max(120),
  appearance: appearanceSchema,
  tokens: z.strictObject({
    accentDark: hex, accentLight: hex, success: hex, warning: hex, error: hex,
    paletteDark: z.array(hex).min(4).max(8), paletteLight: z.array(hex).min(4).max(8),
    panelRadius: z.number().int().min(0).max(48), cardRadius: z.number().int().min(0).max(32),
    nodeRadius: z.number().int().min(0).max(32), controlRadius: z.number().int().min(0).max(24),
    density: z.enum(['compact', 'comfortable']), font: z.enum(['recursive', 'system', 'serif']),
    translucentAlpha: z.number().min(0.3).max(0.98), blur: z.number().min(0).max(24),
    hoverLift: z.number().min(0).max(6), shadow: z.enum(['soft', 'none']), comparison: z.enum(['organic', 'standard']),
    composition: z.enum(['document', 'continuous']).optional(),
  }),
})
export const componentSetSchema = z.enum(['soft-relief', 'clear-glass', 'mechanical-outline'])
export type ComponentSet = z.infer<typeof componentSetSchema>
const themeV2Schema = themeV1Schema.extend({ formatVersion: z.literal(2), componentSet: componentSetSchema })
export const themePackageSchema = z.discriminatedUnion('formatVersion', [themeV1Schema, themeV2Schema]).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_THEME_BYTES, { message: 'THEME_PACKAGE_TOO_LARGE: Theme package exceeds 32 KiB.' })
export type ThemePackage = z.infer<typeof themePackageSchema>

export const builtInThemes: readonly ThemePackage[] = Object.freeze([
  themePackageSchema.parse(empryo), themePackageSchema.parse(plain),
  themePackageSchema.parse(relief), themePackageSchema.parse(glass), themePackageSchema.parse(outline),
])

export const themePreferenceSchema = z.strictObject({
  activeId: themeIdSchema, installed: z.array(themePackageSchema).max(MAX_IMPORTED_THEMES),
}).superRefine((value, ctx) => {
  const ids = new Set<string>()
  const reserved = new Set(builtInThemes.map(theme => theme.id))
  for (const [index, theme] of value.installed.entries()) {
    if (reserved.has(theme.id) || ids.has(theme.id)) ctx.addIssue({ code: 'custom', path: ['installed', index, 'id'], message: 'THEME_ID_CONFLICT: Imported theme id must be unique and cannot replace a built-in.' })
    ids.add(theme.id)
  }
  if (!reserved.has(value.activeId) && !ids.has(value.activeId)) ctx.addIssue({ code: 'custom', path: ['activeId'], message: 'THEME_NOT_FOUND: Active theme is not installed.' })
})
export type ThemePreference = z.infer<typeof themePreferenceSchema>

export function resolveTheme(preference?: ThemePreference): ThemePackage {
  const selected = preference === undefined ? { activeId: 'empryo', installed: [] } : themePreferenceSchema.parse(preference)
  return builtInThemes.find(theme => theme.id === selected.activeId) ?? selected.installed.find(theme => theme.id === selected.activeId)!
}

export const installThemeSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), theme: themePackageSchema })
export const removeThemeSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), id: themeIdSchema })
export type InstallThemeInput = z.infer<typeof installThemeSchema>
export type RemoveThemeInput = z.infer<typeof removeThemeSchema>
