/**
 * Pure input validators shared by the public DIL catalog contract and the
 * React library bridge. This module deliberately imports no renderer, DOM,
 * browser capability, or Host runtime code.
 */
import { z } from 'zod'

/** Source-declared initial skeleton state; refresh or completed content is not valid here. */
export const skulletLibraryInputSchema = z.strictObject({
  loading: z.literal(true),
  label: z.string().max(200).optional(),
})

/** Short plain text only: prose/code/URLs stay in their semantic native renderers. */
export const torphLibraryInputSchema = z.strictObject({
  text: z.string().min(1).max(120).refine(
    value => !/[\r\n`<>]/u.test(value) && !/(?:https?:\/\/|www\.)/iu.test(value) && !/\[[^\]]+\]/u.test(value),
    'Text must not carry markup, code, or URLs.',
  ),
})

const chartSeriesSchema = z.strictObject({
  name: z.string().min(1).max(300),
  values: z.array(z.number().finite()).min(1).max(2_000),
  unit: z.string().max(100),
  originals: z.array(z.string().max(512)).min(1).max(2_000).optional(),
})
const tupleRange = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])

/** Exact, provenance-aware historical chart plan used by Visx. */
export const historicalPlanInputSchema = z.strictObject({
  kind: z.enum(['line', 'bar']),
  labels: z.array(z.string().max(512)).min(1).max(2_000),
  series: z.array(chartSeriesSchema).min(1).max(8),
  title: z.string().max(1_000).optional(),
  basis: z.string().max(2_000).optional(),
  notes: z.array(z.string().max(2_000)).max(128).optional(),
  sourceRows: z.array(z.number().int().nonnegative()).max(2_000).optional(),
  sourceColumns: z.array(z.number().int().nonnegative()).max(64).optional(),
  sourceRowCount: z.number().int().nonnegative().optional(),
  sourceColumnCount: z.number().int().nonnegative().optional(),
  omittedRowRanges: z.array(tupleRange).max(2_000).optional(),
  omittedColumnRanges: z.array(tupleRange).max(64).optional(),
  reason: z.string().max(2_000),
  icon: z.string().min(1).max(200),
}).superRefine((plan, context) => {
  for (const [index, series] of plan.series.entries()) {
    if (series.values.length !== plan.labels.length) context.addIssue({ code: 'custom', path: ['series', index, 'values'], message: 'Series values must match labels.' })
    if (series.originals !== undefined && series.originals.length !== plan.labels.length) context.addIssue({ code: 'custom', path: ['series', index, 'originals'], message: 'Series originals must match labels.' })
  }
  if (plan.sourceRows !== undefined && plan.sourceRows.length !== plan.labels.length) context.addIssue({ code: 'custom', path: ['sourceRows'], message: 'Source rows must match labels.' })
  for (const [index, range] of (plan.omittedRowRanges ?? []).entries()) if (range[1] <= range[0]) context.addIssue({ code: 'custom', path: ['omittedRowRanges', index], message: 'Range must be increasing.' })
  for (const [index, range] of (plan.omittedColumnRanges ?? []).entries()) if (range[1] <= range[0]) context.addIssue({ code: 'custom', path: ['omittedColumnRanges', index], message: 'Range must be increasing.' })
})

/** Outer DIL input shape for the historical chart renderer. */
export const historicalLibraryInputSchema = z.strictObject({ plan: historicalPlanInputSchema })

export type SkulletLibraryInput = z.infer<typeof skulletLibraryInputSchema>
export type TorphLibraryInput = z.infer<typeof torphLibraryInputSchema>
export type HistoricalPlanInput = z.infer<typeof historicalPlanInputSchema>
export type HistoricalLibraryInput = z.infer<typeof historicalLibraryInputSchema>
