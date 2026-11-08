import{describe,it,expect}from'vitest'
import{materializeDilReview,parseDilReviewResponse}from'../tools/dil-live/materialize.js'
const source='# Original\n\nValue: 12.'
const block={id:'b1',start:0,end:source.length,kind:'prose',source,bindings:{source,segments:[{index:0,kind:'heading',source:'# Original'},{index:1,kind:'paragraph',source:'Value: 12.'}],tables:[],items:[]}}
const document={id:'doc1',fileName:'fixture.md',title:'Original',raw:source,blocks:[block]}
const dilSource='{@body const data = DIL.useAppData(a => a.opGenui.modelDataBindings)}\n<card><markdown source={data.source}/></card>'
const response={programs:[{id:'model-program',dilSource}],blocks:[{blockId:'b1',programId:'model-program',components:['card','markdown'],reason:'该块只有标题和一个明确数值，用有边距的原文区域保留单位及上下文。'}]}
describe('actual DIL model result materialization',()=>{
 it('retains exact model program/reason and original source while binding data independently',()=>{
  const result=materializeDilReview(document,response)
  expect(result.raw).toBe(source);expect(result.blocks[0]!.source).toBe(source)
  expect(result.blocks[0]!.choice.dilSource).toBe(dilSource)
  expect(result.blocks[0]!.choice.reason).toBe(response.blocks[0]!.reason)
  expect(result.blocks[0]!.status).toBe('ready')
  expect(result.blocks[0]!.compiled?.source).toBe(dilSource)
  expect(result.blocks[0]!.compiled?.appData).toMatchObject({opGenui:{modelDataBindings:block.bindings}})
 })
 it('rejects missing/reordered blocks, unknown programs, tags and uninstalled themes',()=>{
  expect(()=>materializeDilReview(document,{...response,blocks:[]})).toThrow('BLOCK_COUNT')
  expect(()=>materializeDilReview(document,{...response,blocks:[{...response.blocks[0],blockId:'wrong'}]})).toThrow('BLOCK_ID')
  expect(()=>materializeDilReview(document,{...response,programs:[]})).toThrow()
  expect(()=>materializeDilReview(document,{...response,blocks:[{...response.blocks[0],programId:'unknown'}]})).toThrow('PROGRAM_MISSING')
  expect(()=>materializeDilReview(document,{...response,blocks:[{...response.blocks[0],components:['unknown']}]})).toThrow()
  expect(()=>materializeDilReview(document,{...response,themeId:'uninstalled'})).toThrow('THEME_UNKNOWN')
 })
 it('does not invent a replacement when the model program cannot compile',()=>{
  const bad='<card>{not valid +}</card>'
  const result=materializeDilReview(document,{...response,programs:[{id:'model-program',dilSource:bad}]})
  expect(result.blocks[0]!.status).toBe('failed')
  expect(result.blocks[0]!.choice.dilSource).toBe(bad)
  expect(result.blocks[0]!.diagnostics.length).toBeGreaterThan(0)
 })
 it('allows only an optional whole JSON fence and does not guess a truncated response',()=>{
  expect(parseDilReviewResponse('```json\n'+JSON.stringify(response)+'\n```')).toEqual(response)
  expect(()=>parseDilReviewResponse('{"programs":[')).toThrow('NOT_JSON')
 })
 it('accepts only the known schema identifier as metadata and explicitly records that deviation',()=>{
  const result=materializeDilReview(document,{...response,$schema:'https://json-schema.org/draft/2020-12/schema'})
  expect(result.validationWarnings).toEqual(['MODEL_INCLUDED_STANDARD_SCHEMA_IDENTIFIER_OUTSIDE_REQUESTED_DATA_SHAPE'])
  expect(result.blocks[0]!.choice.dilSource).toBe(dilSource)
  expect(()=>materializeDilReview(document,{...response,$schema:'unrecognized'})).toThrow()
  expect(()=>materializeDilReview(document,{...response,ignoredField:true})).toThrow()
 })

})
