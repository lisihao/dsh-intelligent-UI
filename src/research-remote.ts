import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { documentInput, prepareInput, markSubmissionInput, saveNotesInput, stateSchema } from './research-contracts.js'
export const SERVICE_ID = 'solarResearch'
const PACKAGE_ID = '@lisihao/dsh-solar-intelligent-experience-platform'
const codec = (symbol: string, schema: { parse(value: unknown): unknown }) => ({ mode: 'strict' as const, typeSymbol: `${PACKAGE_ID}#Research${symbol}`, schema, create: () => schema, decode: (value: unknown) => schema.parse(value), encode: (value: unknown) => schema.parse(value) })
export const RPC_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_ID,
  descriptors: ([['get', documentInput, stateSchema], ['prepare', prepareInput, z.strictObject({ state: stateSchema, requestId: z.uuid(), prompt: z.string() })], ['markSubmission', markSubmissionInput, stateSchema], ['saveNotes', saveNotesInput, stateSchema]] as const).map(([method, input, output]) => ({
    id: `${PACKAGE_ID}#${SERVICE_ID}/${method}`, service: SERVICE_ID, namespace: SERVICE_ID, method, invocation: { kind: 'direct' as const },
    parameters: [{ name: 'input', wire: 'input', source: 'json' as const, codec: codec(`${method}Input`, input) }], result: codec(`${method}Result`, output),
  })),
}
