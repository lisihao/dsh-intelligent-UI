import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { PACKAGE, SERVICE, artifactSchema, settingsSchema, saveSettingsSchema, publishSchema, widgetInputSchema, widgetStateSchema, saveWidgetStateSchema } from './contracts.js'
import { themeCatalogResultSchema, downloadThemeSchema } from './theme-source.js'
import { installThemeSchema, removeThemeSchema } from './theme-contracts.js'

export const sessionInputSchema = z.strictObject({ sessionId: z.string().min(1).max(200) })
const codec = (name: string, schema: z.ZodType) => ({
  mode: 'strict' as const, typeSymbol: `${PACKAGE}#${name}`,
  schema, create: () => schema, decode: (value: unknown) => schema.parse(value), encode: (value: unknown) => schema.parse(value),
})
const specs = [
  ['settings', undefined, settingsSchema],
  ['saveSettings', saveSettingsSchema, settingsSchema],
  ['installTheme', installThemeSchema, settingsSchema],
  ['removeTheme', removeThemeSchema, settingsSchema],
  ['themeCatalog', undefined, themeCatalogResultSchema],
  ['downloadTheme', downloadThemeSchema, settingsSchema],
  ['artifacts', sessionInputSchema, z.array(artifactSchema)],
  ['publish', publishSchema, artifactSchema],
  ['widgetState', widgetInputSchema, widgetStateSchema],
  ['saveWidgetState', saveWidgetStateSchema, widgetStateSchema],
  ['mcpStatus', undefined, z.json()],
  ['mcpList', undefined, z.json()],
  ['mcpOpen', widgetInputSchema.extend({ hostOrigin: z.url() }), z.json()],
  ['mcpAction', z.strictObject({ sessionId: z.string().min(1).max(200), instanceId: z.uuid(), commandId: z.uuid(), name: z.string().min(1).max(300), args: z.record(z.string(), z.json()) }), z.json()],
  ['mcpClose', z.strictObject({ sessionId: z.string().min(1).max(200), instanceId: z.uuid() }), z.null()],
] as const
export const RPC_REMOTE: TypertRemoteContribution = {
  package: PACKAGE,
  descriptors: specs.map(([method, input, output]) => ({
    id: `${PACKAGE}#${SERVICE}/${method}`, service: SERVICE, namespace: SERVICE, method,
    invocation: { kind: 'direct' as const },
    parameters: input ? [{ name: 'input', wire: 'input', source: 'json' as const, codec: codec(`${method}Input`, input) }] : [],
    result: codec(`${method}Result`, output),
  })),
}
