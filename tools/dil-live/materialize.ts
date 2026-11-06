import { z } from 'zod'
import { DIL_COMPONENT_CATALOG } from '../../src/dil/catalog.js'
import { compileDilSource } from '../../src/dil/compiler.js'
import type { DilLiveDocument } from './prompt.js'

const tags = DIL_COMPONENT_CATALOG.map(entry => entry.tag) as [string, ...string[]]
const responseSchema = z.strictObject({
  $schema: z.literal('https://json-schema.org/draft/2020-12/schema').optional(),
  themeId: z.string().min(1).max(200).optional(),
  programs: z.array(z.strictObject({id:z.string().min(1).max(200),dilSource:z.string().max(128*1024)})).min(1),
  blocks: z.array(z.strictObject({blockId:z.string(),programId:z.string(),components:z.array(z.enum(tags)).min(1),reason:z.string().min(1).max(8000)})),
})

export function parseDilReviewResponse(text:string):unknown {
  // Retain the raw response separately; accept only an optional whole JSON fence.
  const fenced=/^\s*```(?:json)?\s*\n([\s\S]*)\n```\s*$/.exec(text)
  try{return JSON.parse(fenced?.[1]??text)}catch{throw new Error('DIL_REVIEW_RESPONSE_NOT_JSON')}
}

/** Materializes only model-authored programs; it never substitutes a local UI recipe. */
export function materializeDilReview(document:DilLiveDocument,value:unknown,themeIds:readonly string[]=[]){
  const parsed=responseSchema.parse(value)
  if(parsed.themeId&&!themeIds.includes(parsed.themeId))throw new Error('DIL_REVIEW_THEME_UNKNOWN')
  if(parsed.blocks.length!==document.blocks.length)throw new Error('DIL_REVIEW_BLOCK_COUNT_MISMATCH')
  const programs=new Map<string,string>()
  for(const program of parsed.programs){
    if(programs.has(program.id))throw new Error('DIL_REVIEW_PROGRAM_DUPLICATE')
    programs.set(program.id,program.dilSource)
  }
  const blocks=document.blocks.map((block,index)=>{
    const choice=parsed.blocks[index]!
    if(choice.blockId!==block.id)throw new Error('DIL_REVIEW_BLOCK_ID_OR_ORDER_MISMATCH')
    const dilSource=programs.get(choice.programId)
    if(dilSource===undefined)throw new Error('DIL_REVIEW_PROGRAM_MISSING')
    const original={...block,choice:{components:choice.components,reason:choice.reason,dilSource},modelProgramId:choice.programId}
    try{
      const compiled=compileDilSource(dilSource,{
        source:block.source,
        segments:block.bindings.segments.map(segment=>({...segment})),
        tables:block.bindings.tables.map(table=>({header:[...table.header],rows:table.rows.map(row=>[...row]),source:table.source})),
        items:[...block.bindings.items],
      })
      return {...original,compiled,status:compiled.ok?'ready' as const:'failed' as const,diagnostics:compiled.ok?[]:[compiled.diagnosticSummary||'DIL_COMPILE_FAILED']}
    }catch(error){return {...original,compiled:undefined,status:'failed' as const,diagnostics:[error instanceof Error?error.message:String(error)]}}
  })
  return {...document,...(parsed.themeId?{themeId:parsed.themeId}:{}),blocks,modelPrograms:parsed.programs,validationWarnings:parsed.$schema?['MODEL_INCLUDED_STANDARD_SCHEMA_IDENTIFIER_OUTSIDE_REQUESTED_DATA_SHAPE']:[]}
}
