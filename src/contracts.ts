import { z } from 'zod'
import { themeSourceSchema, type ThemeCatalog, type DownloadThemeInput } from './theme-source.js'
import { appearanceSchema, themeIdSchema, themePreferenceSchema, type InstallThemeInput, type RemoveThemeInput } from './theme-contracts.js'
export { appearanceSchema } from './theme-contracts.js'

export const PACKAGE = '@lisihao/dsh-solar-intelligent-experience-platform'
export const SERVICE = 'solarExperience'
export const defaultAppearance = (): z.infer<typeof appearanceSchema> => ({ backgroundColor: '#24262b', translucent: true })
export const settingsSchema = z.strictObject({
  formatVersion: z.literal(1), revision: z.number().int().nonnegative(),
  takeover: z.boolean(), openui: z.boolean(), mcpApps: z.boolean(),
  settingsNavigation: z.boolean().optional(),
  appearance: appearanceSchema.optional(),
  theme: themePreferenceSchema.optional(),
  themeSource: themeSourceSchema.optional(),
})
export type ExperienceSettings = z.infer<typeof settingsSchema>
export const initialSettings = (): ExperienceSettings => ({ formatVersion: 1, revision: 0, takeover: false, openui: true, mcpApps: false, appearance: defaultAppearance() })
export const saveSettingsSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(), takeover: z.boolean(), openui: z.boolean(), mcpApps: z.boolean(),
  settingsNavigation: z.boolean().optional(),
  appearance: appearanceSchema.optional(),
  themeId: themeIdSchema.optional(),
  themeSource: themeSourceSchema.optional(),
})
export type SaveSettingsInput = z.infer<typeof saveSettingsSchema>
export const sourceSchema = z.strictObject({
  sessionId: z.string().min(1).max(200), callId: z.string().max(200).optional(),
  seq: z.number().int().nonnegative().optional(), kind: z.enum(['tool', 'assistant', 'generated']), label: z.string().max(300),
})
export const artifactSchema = z.strictObject({
  formatVersion: z.literal(1), id: z.uuid(), createdAt: z.string(), source: sourceSchema,
  protocol: z.enum(['content', 'openui', 'mcp-app']), raw: z.json(),
  payload: z.json(), providerId: z.string().min(1).max(200),
})
export type ExperienceArtifact = z.infer<typeof artifactSchema>
export const publishSchema = artifactSchema.omit({ id: true, createdAt: true, formatVersion: true })
export type PublishInput = z.infer<typeof publishSchema>
export const widgetInputSchema = z.strictObject({ sessionId: z.string().min(1).max(200), artifactId: z.uuid() })
export const widgetStateSchema = z.strictObject({ formatVersion: z.literal(1), revision: z.number().int().nonnegative(), state: z.record(z.string(), z.json()) })
export const saveWidgetStateSchema = widgetInputSchema.extend({ expectedRevision: z.number().int().nonnegative(), state: z.record(z.string(), z.json()) })
export type WidgetState = z.infer<typeof widgetStateSchema>
export type SaveWidgetStateInput = z.infer<typeof saveWidgetStateSchema>
export interface ExperienceApi {
  settings(): Promise<ExperienceSettings>
  saveSettings(input: SaveSettingsInput): Promise<ExperienceSettings>
  artifacts(input: { sessionId: string }): Promise<ExperienceArtifact[]>
  publish(input: PublishInput): Promise<ExperienceArtifact>
}
export interface WidgetStateApi {
  widgetState(input: {sessionId: string; artifactId: string}): Promise<WidgetState>
  saveWidgetState(input: SaveWidgetStateInput): Promise<WidgetState>
}
export interface ThemeApi {
  themeCatalog(): Promise<ThemeCatalog>
  downloadTheme(input: DownloadThemeInput): Promise<ExperienceSettings>
  installTheme(input: InstallThemeInput): Promise<ExperienceSettings>
  removeTheme(input: RemoveThemeInput): Promise<ExperienceSettings>
}
