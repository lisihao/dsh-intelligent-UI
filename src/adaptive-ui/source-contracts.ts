import { z } from 'zod'

const nonemptyText = z.string().refine(value => value.trim().length > 0, 'Expected nonempty text')
const finiteNumber = z.number().finite()

/**
 * A declared source protocol, deliberately narrower than a generic table or
 * array. Consumers must not infer liveness from changing prose or values.
 */
export const liveSeriesInputSchema = z.object({
  type: z.literal('live-series'),
  source: nonemptyText,
  unit: nonemptyText,
  timeUnit: z.enum(['seconds', 'milliseconds']),
  points: z.array(z.object({ time: finiteNumber, value: finiteNumber }).strict()).min(1),
  updatedAt: finiteNumber.optional(),
}).strict().superRefine((source, context) => {
  for (let index = 1; index < source.points.length; index++) {
    if (source.points[index]!.time <= source.points[index - 1]!.time) {
      context.addIssue({ code: 'custom', path: ['points', index, 'time'], message: 'Live-series point times must be strictly increasing.' })
    }
  }
  const latest = source.points.at(-1)
  if (source.updatedAt !== undefined && latest && source.updatedAt < latest.time) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Source update time cannot predate the latest observation.' })
  }
})

export type LiveSeriesInput = z.infer<typeof liveSeriesInputSchema>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Invalid explicit candidates and ordinary arrays/tables remain unrecognized. */
export function recognizeLiveSeries(value: unknown): LiveSeriesInput | undefined {
  if (!isPlainRecord(value) || value.type !== 'live-series') return undefined
  const parsed = liveSeriesInputSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export type NormalizedCompositionSource = {kind:'markdown',markdown:string}|{kind:'structured',value:unknown}|{kind:'scalar',value:unknown}|{kind:'empty'}|{kind:'blocks',values:readonly unknown[]}
/** The same canonical content boundary as the normal renderer; original input is retained separately. */
export function normalizeCompositionSource(value:unknown):NormalizedCompositionSource {
 if(typeof value==='string'){
  if(!value.trim())return {kind:'empty'}
  if(/^\s*[\[{]/.test(value)){try{return normalizeCompositionSource(JSON.parse(value))}catch{/* Ordinary Markdown. */}}
  return {kind:'markdown',markdown:value}
 }
 if(Array.isArray(value)&&value.length>0&&value.every(part=>part&&typeof part==='object'&&part.type==='text'&&typeof part.text==='string'))return value.length===1?normalizeCompositionSource(value[0].text):{kind:'blocks',values:value.map(part=>(part as {text:string}).text)}
 if(value!==null&&typeof value==='object')return {kind:'structured',value}
 return value===null||value===undefined?{kind:'empty'}:{kind:'scalar',value}
}
