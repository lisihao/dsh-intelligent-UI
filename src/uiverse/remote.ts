import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { CatalogItem } from './catalog.js'

export const PACKAGE_ID = '@lisihao/dsh-solar-intelligent-experience-platform'
export const SERVICE_ID = 'solarUiComponents'
export const UI_TOOL_NAMES = ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview'] as const
export const toolRegistrationSchema = z.strictObject({
  scope: z.literal('host'),
  checkedAt: z.iso.datetime(),
  tools: z.array(z.strictObject({ name: z.enum(UI_TOOL_NAMES), registered: z.boolean() })).length(3)
    .refine(rows => new Set(rows.map(row => row.name)).size === UI_TOOL_NAMES.length, 'Registry observation must contain each expected tool exactly once.'),
})
export type ToolRegistrationStatus = z.infer<typeof toolRegistrationSchema>
export const searchInput = z.strictObject({
  query: z.string().trim().max(256).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(48).default(20),
  offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
})
export const idInput = z.strictObject({ id: z.string().min(1).max(256) })
export const previewInput = idInput.extend({ colorScheme: z.enum(['light', 'dark']).default('light'), reducedMotion: z.boolean().default(true) })
export type SearchInput = z.input<typeof searchInput>
export type PreviewInput = z.input<typeof previewInput>
export interface LibraryPage {
  formatVersion: 1
  commit: string
  snapshotDate: string
  archiveTotal: number
  categories: string[]
  total: number
  offset: number
  limit: number
  items: CatalogItem[]
}
export interface ComponentDetail { item: CatalogItem; source: string; html: string; warnings: string[] }
export interface LibraryContentApi {
  search(input: SearchInput): Promise<LibraryPage>
  source(input: { id: string }): Promise<{ item: CatalogItem; source: string }>
  preview(input: PreviewInput): Promise<{ item: CatalogItem; html: string; document: string; warnings: string[] }>
}
export interface LibraryApi extends LibraryContentApi {
  toolStatus(): Promise<ToolRegistrationStatus>
}

const codec = (symbol: string, schema: { parse(value: unknown): unknown }) => ({
  mode: 'strict' as const, typeSymbol: `${PACKAGE_ID}#${symbol}`, schema,
  create: () => schema, decode: (value: unknown) => schema.parse(value), encode: (value: unknown) => schema.parse(value),
})
export const RPC_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_ID,
  descriptors: [...([['search', searchInput], ['source', idInput], ['preview', previewInput]] as const).map(([method, schema]) => ({
    id: `${PACKAGE_ID}#${SERVICE_ID}/${method}`, service: SERVICE_ID, namespace: SERVICE_ID, method,
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: codec(`${method}Input`, schema) }],
    result: codec(`${method}Result`, z.unknown()),
  })), {
    id: `${PACKAGE_ID}#${SERVICE_ID}/toolStatus`, service: SERVICE_ID, namespace: SERVICE_ID, method: 'toolStatus',
    invocation: { kind: 'direct' as const }, parameters: [], result: codec('ToolRegistrationStatus', toolRegistrationSchema),
  }],
}
