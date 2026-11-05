import { z } from 'zod'
import { componentSetSchema, type ComponentSet, type ThemePackage, type ThemePreference } from '../theme-contracts.js'

/** The only Jev feature this consumer ever registers or evaluates. */
export const ADAPTIVE_COMPOSITION_FEATURE_ID = 'ui-composition'
export const ADAPTIVE_COMPOSITION_FORMAT_VERSION = 1
export const ADAPTIVE_COMPOSITION_INPUT_VERSION = 'adaptive-ui-composition@1'

export const compositionStyleModeSchema = z.enum(['selected', 'automatic'])
export const compositionCapabilitiesSchema = z.strictObject({
  webgl: z.boolean(),
  reducedMotion: z.boolean(),
})

/**
 * `styleMode` is a client-side hint only. The coordinator always resolves the
 * effective mode from the current saved adaptive settings, so a browser cannot
 * bypass a selected-theme lock by sending `automatic` here.
 */
export const composeInputSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  documentId: z.string().min(1).max(300),
  value: z.json(),
  styleMode: compositionStyleModeSchema.optional(),
  capabilities: compositionCapabilitiesSchema,
  isStreaming: z.boolean().optional(),
  requestId: z.string().min(1).max(100).optional(),
})
export type ComposeInput = z.infer<typeof composeInputSchema>

export const compositionSelectionSchema = z.strictObject({
  themeId: z.string().min(1).max(64),
  surface: z.enum(['semantic', 'source']),
  chart: z.enum(['auto', 'openui', 'compact', 'dense', 'ascii', 'visx']),
  componentSet: z.union([componentSetSchema, z.literal('native')]),
  objectEffect: z.enum(['auto', 'ink-object', 'ascii-object', 'glass-object', 'none']),
  layout: z.enum(['auto', 'board', 'records', 'flow', 'table', 'research', 'document', 'heading-index', 'continuous']),
  loading: z.enum(['skullet', 'native']).optional(),
  textMotion: z.enum(['torph', 'none']).optional(),
  live: z.enum(['liveline', 'native']).optional(),
})
export type CompositionSelection = Omit<z.infer<typeof compositionSelectionSchema>, 'componentSet'> & {
  componentSet: ComponentSet | 'native'
}

export const compositionResultStatusSchema = z.enum(['selected', 'local', 'failed', 'stale'])
export const compositionResultSchema = z.strictObject({
  status: compositionResultStatusSchema,
  reason: z.string().trim().min(1).max(500),
  sourceVersion: z.string().min(1).max(128),
  selection: compositionSelectionSchema.optional(),
  operationId: z.string().min(1).max(200).optional(),
  requestId: z.string().min(1).max(100).optional(),
})
export type CompositionResult = z.infer<typeof compositionResultSchema>

export const compositionCancelInputSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  documentId: z.string().min(1).max(300),
  requestId: z.string().min(1).max(100).optional(),
  sourceVersion: z.string().min(1).max(128).optional(),
}).superRefine((value, ctx) => {
  if (value.requestId === undefined && value.sourceVersion === undefined) {
    ctx.addIssue({ code: 'custom', message: 'COMPOSITION_CANCEL_IDENTITY_REQUIRED' })
  }
})
export type CompositionCancelInput = z.infer<typeof compositionCancelInputSchema>

export const compositionCancelResultSchema = z.strictObject({
  cancelled: z.boolean(),
  reason: z.string().trim().min(1).max(500),
  sourceVersion: z.string().min(1).max(128).optional(),
  requestId: z.string().min(1).max(100).optional(),
})
export type CompositionCancelResult = z.infer<typeof compositionCancelResultSchema>

/** The renderer calls this only after it has actually acknowledged the mount. */
export const compositionReceiptInputSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  documentId: z.string().min(1).max(300),
  sourceVersion: z.string().min(1).max(128),
  operationId: z.string().min(1).max(200),
  observed: z.literal(true),
})
export type CompositionReceiptInput = z.infer<typeof compositionReceiptInputSchema>

export const compositionReceiptResultSchema = z.strictObject({
  status: z.literal('observed'),
  operationId: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(128),
})
export type CompositionReceiptResult = z.infer<typeof compositionReceiptResultSchema>

export const compositionStatusSchema = z.strictObject({
  disposed: z.boolean(),
  attached: z.boolean(),
  featureRegistered: z.boolean(),
  featureEnabled: z.boolean(),
  takeover: z.boolean(),
  adaptiveEnabled: z.boolean(),
  activeDocuments: z.number().int().nonnegative(),
  cachedResults: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500).optional(),
})
export type CompositionStatus = z.infer<typeof compositionStatusSchema>

export interface AdaptiveCompositionSettings {
  takeover: boolean
  adaptive?: { enabled: boolean, styleMode: z.infer<typeof compositionStyleModeSchema> }
  theme?: ThemePreference
}

/** A copy of the public, bounded Jev interface; this plugin has no Jev source dependency. */
export type JevJson = null | boolean | number | string | readonly JevJson[] | { readonly [key: string]: JevJson }
export type JevQuestion = {
  id: string
  kind: 'choice'
  prompt: JevJson
  options: readonly { id: string, description: JevJson | null }[]
}
export interface JevRequest { state: JevJson, questions: readonly JevQuestion[] }
export interface JevChoiceAnswer { id: string, kind: 'choice', optionId: string }
export interface JevResponse { answers: readonly (JevChoiceAnswer | { id: string, kind: string, [key: string]: unknown })[] }
export interface JevConnectionIdentity {
  connectionId: string
  baseUrl: string
  model: string
  credentialRef: string
  timeoutMs: number
}
export interface JevOperationLink {
  sessionId?: string
  runId?: string
  stepId?: string
  inputVersion?: string
}
export interface JevJudgeOnceOptions {
  featureId: string
  link: JevOperationLink
  refresh: (signal: AbortSignal) => JevRequest | Promise<JevRequest>
  preflight?: (request: JevRequest) => void
  interpret?: (response: JevResponse, signal: AbortSignal) => { usable: true } | { usable: false, reason: string } | Promise<{ usable: true } | { usable: false, reason: string }>
  canAdopt?: (response: JevResponse, signal: AbortSignal) => true | string | Promise<true | string>
  signal?: AbortSignal
  connection?: JevConnectionIdentity
}
export type JevJudgeOnceResult =
  | { kind: 'ok', operationId: string, attemptId: string, response: JevResponse }
  | { kind: 'cancelled', operationId: string }
  | { kind: 'not-adopted', operationId: string, reason: string }
  | { kind: 'failed', operationId?: string, failure: { code: string, message: string } }
export interface JevCompositionPort {
  registerFeature(feature: { id: string, name: string, description: string, settingsDescription?: string }): () => void
  isFeatureEnabled(featureId: string): boolean
  judgmentConnectionIdentity(): JevConnectionIdentity
  judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult>
  writeReceipt(operationId: string, receipt: { id: string, status: 'observed', reason?: string, at: string }): Promise<unknown>
  onFeatureStateChange?(listener: (features: Readonly<Record<string, boolean>>) => void): () => void
}

export interface AdaptiveCompositionCoordinatorOptions {
  getSettings: () => Promise<AdaptiveCompositionSettings>
  getJev?: () => JevCompositionPort | undefined
  /** Optional catalog provider; absent means built-ins plus the saved imported themes. */
  getThemes?: (settings: AdaptiveCompositionSettings) => readonly ThemePackage[] | Promise<readonly ThemePackage[]>
  maxSourceBytes?: number
  maxCacheEntries?: number
  now?: () => Date
}
