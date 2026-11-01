import { z } from 'zod'

export const MAX_REPORT_BYTES = 1024 * 1024
const key = z.string().min(1).max(200)
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const textField = z.string().min(1).max(16000)
export const anchorSchema = z.strictObject({ start: z.number().int().nonnegative().max(MAX_REPORT_BYTES), end: z.number().int().positive().max(MAX_REPORT_BYTES), quote: z.string().min(1).max(MAX_REPORT_BYTES) }).refine(a => a.end > a.start, 'Anchor end must follow start')
export const analysisSchema = z.strictObject({
  formatVersion: z.literal(1), reportHash: z.string().regex(/^[a-f0-9]{64}$/), question: textField,
  claims: z.array(z.strictObject({
    id, text: textField, kind: z.enum(['observation', 'inference', 'hypothesis']), anchor: anchorSchema,
    conditions: z.array(textField).max(50),
    evidence: z.array(z.strictObject({ id, relation: z.enum(['citation', 'support', 'challenge', 'limitation']), anchor: anchorSchema, sourceUrl: z.string().max(8192).optional(), note: textField.optional() })).max(100),
    openQuestions: z.array(textField).max(50),
  })).max(100),
})
export const stateSchema = z.strictObject({
  formatVersion: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  analysis: analysisSchema.optional(), notes: z.record(id, z.string().max(16000)).refine(v => Object.keys(v).length <= 100),
  reviews: z.record(id, z.enum(['confirmed', 'questioned'])).refine(v => Object.keys(v).length <= 100), questions: z.array(textField).max(100),
  request: z.strictObject({ id: z.uuid(), status: z.enum(['prepared', 'queued', 'complete', 'failed', 'unknown']), createdAt: z.iso.datetime(), error: z.string().max(2000).optional() }).optional(),
})
export const documentInput = z.strictObject({ sessionId: key, documentId: key, text: z.string().min(1).max(MAX_REPORT_BYTES) })
export const prepareInput = documentInput.extend({ expectedRevision: stateSchema.shape.revision })
export const markSubmissionInput = documentInput.extend({ requestId: z.uuid(), status: z.enum(['queued', 'failed', 'unknown']), error: z.string().max(2000).optional() })
export const saveNotesInput = prepareInput.extend({ notes: stateSchema.shape.notes, reviews: stateSchema.shape.reviews, questions: stateSchema.shape.questions })
/** The model may supply a unique verbatim quote; only durable state requires exact offsets. */
export const submissionAnchorSchema = z.strictObject({
  quote: anchorSchema.shape.quote,
  start: anchorSchema.shape.start.optional(), end: anchorSchema.shape.end.optional(),
}).refine(a => (a.start === undefined) === (a.end === undefined), 'Supply both offsets or neither')
  .refine(a => a.start === undefined || a.end! > a.start, 'Anchor end must follow start')
const submittedClaim = analysisSchema.shape.claims.element
const submittedEvidence = submittedClaim.shape.evidence.element
export const submissionAnalysisSchema = analysisSchema.extend({
  claims: z.array(submittedClaim.extend({
    anchor: submissionAnchorSchema,
    evidence: z.array(submittedEvidence.extend({ anchor: submissionAnchorSchema })).max(100),
  })).max(100),
})
export const submitInput = z.strictObject({ requestId: z.uuid(), analysis: submissionAnalysisSchema })
export type ResearchAnalysis = z.infer<typeof analysisSchema>
export type ResearchState = z.infer<typeof stateSchema>
export type ResearchDocument = z.infer<typeof documentInput>
export type PrepareInput = z.infer<typeof prepareInput>
export type MarkSubmissionInput = z.infer<typeof markSubmissionInput>
export type SaveNotesInput = z.infer<typeof saveNotesInput>
export interface ResearchApi {
  get(input: ResearchDocument): Promise<ResearchState>
  prepare(input: PrepareInput): Promise<{ state: ResearchState; requestId: string; prompt: string }>
  markSubmission(input: MarkSubmissionInput): Promise<ResearchState>
  saveNotes(input: SaveNotesInput): Promise<ResearchState>
}
