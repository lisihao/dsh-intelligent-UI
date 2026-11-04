import {z} from 'zod'

/** Read-only projections of already-observed Insight work in one host session. */
export interface InsightPreviewOutput {
  /** Stable within this run; the source does not assign output IDs. */
  readonly id: string
  /** Stable collision-resistant local identity for research state attached to this exact output. */
  readonly documentId: string
  readonly label: string
  readonly status: string
  readonly text: string
  readonly nodeId?: string
  readonly citations?: readonly string[]
  /** The exact phase key when an output came from a legacy stage. */
  readonly stageKey?: string
  /** The workflow provider's original observed selection and provenance. */
  readonly observed?: Readonly<Record<string, unknown>>
  readonly location: 'stage' | 'task-output' | 'node' | 'run-output'
}

export type InsightPptxState = 'not-in-flow' | 'pending' | 'available' | 'unknown'
export type InsightPreviewJson = null | boolean | number | string | InsightPreviewJson[] | { [key: string]: InsightPreviewJson }

export interface InsightPreviewRun {
  /** Namespaced presentation key; never sent back to an execution service. */
  readonly id: string
  readonly source: 'legacy' | 'workflow'
  /** Original run/command ID and, for captured sources, their original source ID. */
  readonly sourceRunId: string
  readonly sourceRecordId?: string
  readonly title: string
  readonly status: string
  readonly updatedAt: string
  readonly outputs: readonly InsightPreviewOutput[]
  readonly pptxState: InsightPptxState
  /** The complete source record after the same JSON normalization as the RPC wire. */
  readonly raw: InsightPreviewJson
}

export interface InsightPreviewSnapshot {
  readonly formatVersion: 1
  readonly sessionId: string
  /** At least one peer returned a valid snapshot for this session. */
  readonly available: boolean
  readonly runs: readonly InsightPreviewRun[]
  readonly warnings: readonly string[]
}

/** The caller supplies only the two named read operations, not whole services. */
export interface InsightPreviewPorts {
  readonly legacyStatus?: (input: { readonly sessionId: string }) => Promise<unknown>
  readonly workflowOverview?: (input: { readonly sessionId: string }) => Promise<unknown>
}

/** Validate the independently owned Host/client JSON boundary. */
export const insightPreviewSnapshotSchema=z.strictObject({
  formatVersion:z.literal(1),sessionId:z.string().min(1),available:z.boolean(),warnings:z.array(z.string()),
  runs:z.array(z.strictObject({
    id:z.string(),source:z.enum(['legacy','workflow']),sourceRunId:z.string(),sourceRecordId:z.string().optional(),
    title:z.string(),status:z.string(),updatedAt:z.string(),pptxState:z.enum(['not-in-flow','pending','available','unknown']),raw:z.json(),
    outputs:z.array(z.strictObject({id:z.string(),documentId:z.string().regex(/^preview:[a-f0-9]{64}$/u),label:z.string(),status:z.string(),text:z.string(),nodeId:z.string().optional(),
      citations:z.array(z.string()).optional(),stageKey:z.string().optional(),observed:z.record(z.string(),z.json()).optional(),
      location:z.enum(['stage','task-output','node','run-output'])})),
  })),
})
