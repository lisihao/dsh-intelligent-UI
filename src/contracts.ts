import { z } from 'zod'
import { themeSourceSchema, type ThemeCatalog, type DownloadThemeInput } from './theme-source.js'
import { appearanceSchema, themeIdSchema, themePreferenceSchema, type InstallThemeInput, type RemoveThemeInput } from './theme-contracts.js'
import { blockLayoutShortcutSchema } from './layout-shortcut.js'
import { validateCompiledDil, type CompiledDil } from './dil/protocol.js'
export { appearanceSchema } from './theme-contracts.js'

export const PACKAGE = '@lisihao/dsh-solar-intelligent-experience-platform'
export const SERVICE = 'solarExperience'
export const defaultAppearance = (): z.infer<typeof appearanceSchema> => ({ backgroundColor: '#24262b', translucent: true })
export const adaptiveSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  styleMode: z.enum(['selected', 'automatic']),
  blockLayout: z.boolean().optional(),
  blockLayoutShortcut: blockLayoutShortcutSchema.optional(),
})
export type AdaptiveSettings = z.infer<typeof adaptiveSettingsSchema>
export const settingsSchema = z.strictObject({
  formatVersion: z.literal(1), revision: z.number().int().nonnegative(),
  takeover: z.boolean(), openui: z.boolean(), mcpApps: z.boolean(),
  appearance: appearanceSchema.optional(),
  theme: themePreferenceSchema.optional(),
  themeSource: themeSourceSchema.optional(),
  adaptive: adaptiveSettingsSchema.optional(),
})
export type ExperienceSettings = z.infer<typeof settingsSchema>
export const initialSettings = (): ExperienceSettings => ({ formatVersion: 1, revision: 0, takeover: false, openui: true, mcpApps: false, appearance: defaultAppearance() })
export const saveSettingsSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(), takeover: z.boolean(), openui: z.boolean(), mcpApps: z.boolean(),
  appearance: appearanceSchema.optional(),
  themeId: themeIdSchema.optional(),
  themeSource: themeSourceSchema.optional(),
  adaptive: adaptiveSettingsSchema.optional(),
})
export type SaveSettingsInput = z.infer<typeof saveSettingsSchema>
export const sourceSchema = z.strictObject({
  sessionId: z.string().min(1).max(200), callId: z.string().max(200).optional(),
  seq: z.number().int().nonnegative().optional(), kind: z.enum(['tool', 'assistant', 'generated']), label: z.string().max(300),
})

/** DIL has a versioned inner payload while the outer experience artifact stays at version 1. */
export const DIL_PROTOCOL = 'dil' as const
export const DIL_PAYLOAD_FORMAT_VERSION = 1 as const
export const DIL_RUNTIME_PROTOCOL_VERSION = 1 as const
export const DIL_REFERENCE_COMMIT = 'c4920ad2327ee5dfdfb42744e4696286868d934e' as const
// The Host compiler separately enforces this as a UTF-8 byte limit before it invokes the reference compiler.
export const DIL_SOURCE_MAX_CHARACTERS = 128 * 1024
export const dilSourceSchema = z.string().max(DIL_SOURCE_MAX_CHARACTERS, 'DIL_SOURCE_TOO_LARGE: DIL source exceeds the maximum character boundary.')
const jsonValueSchema = z.json()
type JsonValue = z.infer<typeof jsonValueSchema>
/** The validator proves every compiler field is JSON; the index signature preserves that fact for host metadata. */
type JsonCompiledDil = CompiledDil & Record<string, JsonValue>
const compiledDilSchema = jsonValueSchema.refine((value) => {
  try { validateCompiledDil(value); return true } catch { return false }
}, { message: 'DIL_COMPILED_INVALID: compiled DIL does not match the supported protocol.' })
  .transform((value): JsonCompiledDil => validateCompiledDil(value) as JsonCompiledDil)
export const dilPayloadSchema = z.strictObject({
  formatVersion: z.literal(DIL_PAYLOAD_FORMAT_VERSION),
  source: dilSourceSchema,
  compiled: compiledDilSchema,
  referenceCommit: z.literal(DIL_REFERENCE_COMMIT),
}).refine((value) => value.source === value.compiled.source, {
  message: 'DIL_SOURCE_MISMATCH: durable DIL source must equal compiled.source.',
})
/** Backwards-compatible descriptive alias for durable-artifact call sites. */
export const dilArtifactPayloadSchema = dilPayloadSchema
export type DILPayload = z.infer<typeof dilPayloadSchema>

const artifactCommon = {
  formatVersion: z.literal(1), id: z.uuid(), createdAt: z.string(), source: sourceSchema,
  providerId: z.string().min(1).max(200),
}
const standardArtifactFields = { ...artifactCommon, raw: z.json(), payload: z.json() }
const contentArtifactSchema = z.strictObject({ ...standardArtifactFields, protocol: z.literal('content') })
const openuiArtifactSchema = z.strictObject({ ...standardArtifactFields, protocol: z.literal('openui') })
const mcpArtifactSchema = z.strictObject({ ...standardArtifactFields, protocol: z.literal('mcp-app') })
const dilArtifactSchema = z.strictObject({ ...artifactCommon, protocol: z.literal(DIL_PROTOCOL), raw: dilSourceSchema, payload: dilArtifactPayloadSchema })
  .refine((value) => value.raw === value.payload.source, { message: 'DIL_SOURCE_MISMATCH: raw DIL source must equal the durable payload source.' })
export const artifactSchema = z.union([contentArtifactSchema, openuiArtifactSchema, mcpArtifactSchema, dilArtifactSchema])
/**
 * Public transport shape remains compatible with existing content consumers.
 * `artifactSchema` is the strict durable boundary; DIL consumers parse
 * `dilPayloadSchema` before reading compiled fields.
 */
export type ExperienceArtifact = {
  formatVersion: 1
  id: string
  createdAt: string
  source: z.infer<typeof sourceSchema>
  protocol: 'content' | 'openui' | 'mcp-app' | typeof DIL_PROTOCOL
  raw: JsonValue
  payload: JsonValue
  providerId: string
}

const standardPublishFields = { source: sourceSchema, raw: z.json(), payload: z.json(), providerId: z.string().min(1).max(200) }
const contentPublishSchema = z.strictObject({ ...standardPublishFields, protocol: z.literal('content') })
const openuiPublishSchema = z.strictObject({ ...standardPublishFields, protocol: z.literal('openui') })
const mcpPublishSchema = z.strictObject({ ...standardPublishFields, protocol: z.literal('mcp-app') })
const dilPublishSchema = z.strictObject({ source: sourceSchema, protocol: z.literal(DIL_PROTOCOL), raw: dilSourceSchema, payload: dilSourceSchema, providerId: z.string().min(1).max(200) })
  .refine((value) => value.raw === value.payload, { message: 'DIL_SOURCE_MISMATCH: DIL publish input must carry the same source in raw and payload.' })
export const publishSchema = z.union([contentPublishSchema, openuiPublishSchema, mcpPublishSchema, dilPublishSchema])
/**
 * Preserve the public call shape used by existing clients. The strict runtime
 * schema above remains the DIL boundary and accepts only source text for DIL.
 */
export type PublishInput = {
  source: z.infer<typeof sourceSchema>
  protocol: 'content' | 'openui' | 'mcp-app' | typeof DIL_PROTOCOL
  raw: z.infer<typeof standardPublishFields.raw>
  payload: z.infer<typeof standardPublishFields.payload>
  providerId: string
}
export const dilPersistInputSchema = z.strictObject({ source: sourceSchema, protocol: z.literal(DIL_PROTOCOL), raw: dilSourceSchema, payload: dilArtifactPayloadSchema, providerId: z.string().min(1).max(200) })
  .refine((value) => value.raw === value.payload.source, { message: 'DIL_SOURCE_MISMATCH: raw DIL source must equal the compiled payload source.' })
export type DilPersistInput = z.infer<typeof dilPersistInputSchema>

export const dilRuntimeInfoInputSchema = z.strictObject({ sessionId: z.string().min(1).max(200) })
export const dilRuntimeInfoSchema = z.strictObject({ protocolVersion: z.literal(DIL_RUNTIME_PROTOCOL_VERSION), frameUrl: z.url() })
export type DilRuntimeInfo = z.infer<typeof dilRuntimeInfoSchema>
export const dilCompilePreviewInputSchema = dilRuntimeInfoInputSchema.extend({ source: dilSourceSchema })
export const dilCompilePreviewResultSchema = z.strictObject({ payload: dilArtifactPayloadSchema })
export type DilCompilePreviewInput = z.infer<typeof dilCompilePreviewInputSchema>
export type DilCompilePreviewResult = z.infer<typeof dilCompilePreviewResultSchema>

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
/** Optional DIL extension surface; legacy experience clients need not implement it. */
export interface DilApi {
  dilRuntimeInfo(input: z.infer<typeof dilRuntimeInfoInputSchema>): Promise<DilRuntimeInfo>
  dilCompilePreview(input: DilCompilePreviewInput): Promise<DilCompilePreviewResult>
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
