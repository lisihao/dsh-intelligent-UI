import {describe,it,expect} from 'vitest'
import {AdaptiveCompositionCoordinator}from'../src/adaptive-ui/host.js'
import {createSourceBlockComponentRegistry}from'../src/adaptive-ui/source-block-components.js'
import type{JevCompositionPort,JevJudgeOnceOptions,JevRequest}from'../src/adaptive-ui/contracts.js'

function peer(leaf:string){
 const requests:JevRequest[]=[],receipts:string[]=[]
 const port:JevCompositionPort={registerFeature:()=>()=>{},isFeatureEnabled:()=>true,judgmentConnectionIdentity:()=>({connectionId:'fixture',baseUrl:'https://example.invalid/v1',model:'fixture',credentialRef:'fixture',timeoutMs:1000}),writeReceipt:async id=>{receipts.push(id)},judgeOnce:async(options:JevJudgeOnceOptions)=>{
  const signal=options.signal??new AbortController().signal,request=await options.refresh(signal);options.preflight?.(request);requests.push(request)
  const response={answers:request.questions.map(q=>({id:q.id,kind:'choice' as const,optionId:q.options.find(o=>o.id===(leaf.startsWith('dil:')?'native-content':'source-composition'))?.id??q.options.find(o=>o.id===leaf)?.id??q.options[0]!.id}))}
  const interpreted=await options.interpret?.(response,signal);if(interpreted&&!interpreted.usable)return{kind:'not-adopted' as const,operationId:`op-${requests.length}`,reason:interpreted.reason}
  const adopt=await options.canAdopt?.(response,signal);if(adopt&&adopt!==true)return{kind:'not-adopted' as const,operationId:`op-${requests.length}`,reason:adopt}
  return{kind:'ok' as const,operationId:`op-${requests.length}`,attemptId:`attempt-${requests.length}`,response}
 }}
 return{port,requests,receipts}
}
describe('production Host component selection stage',()=>{
 it('batches native selection and returns the same source-bound executable IDs behind the experiment',async()=>{
  const p=peer('dil:column'),registry=createSourceBlockComponentRegistry(),coordinator=new AdaptiveCompositionCoordinator({getSettings:async()=>({takeover:true,adaptive:{enabled:true,styleMode:'automatic',blockLayout:true},theme:{activeId:'empryo',installed:[]}}),getExecutableComponents:()=>registry})
  coordinator.attachJev(p.port)
  const input={sessionId:'session',documentId:'document',value:'# Topic\n\nA real statement.\n\n```rust\nlet x = 2;\n```',capabilities:{webgl:false,reducedMotion:true}}
  const result=await coordinator.compose(input)
  expect(result.status).toBe('selected')
  expect(result.reason).toBe('JEV_COMPONENT_SELECTION_ADOPTED')
  expect(p.requests).toHaveLength(3)
  expect(p.requests[0]!.questions.some(question=>/:presentation$|:live$|:loading$|:text-motion$/u.test(question.id))).toBe(false)
  const frameState=p.requests[0]!.state as {composition:{blockLayout:{blocks:{fieldBindings:Record<string,string>}[]}}}
  for(const block of frameState.composition.blockLayout.blocks)expect(block.fieldBindings).not.toHaveProperty('presentation')
  const componentRequests=p.requests.filter(request=>(request.state as {kind?:string}).kind==='executable-component-batch-decision')
  expect(componentRequests.length).toBeGreaterThan(0)
  for(const request of componentRequests){const state=request.state as {input:{blocks:{recipes:Record<string,unknown>[] }[]}};for(const block of state.input.blocks)for(const recipe of block.recipes){expect(recipe).not.toHaveProperty('selection');expect(recipe).not.toHaveProperty('componentSet');expect(recipe).not.toHaveProperty('themeId')}}
  for(const block of result.selection!.blockLayout!.blocks){expect(block.component?.id).toBe('dil:column');expect(block.component?.rendererKey).toBe('dil-native-tree-v1')}
  await coordinator.writeReceipt({sessionId:input.sessionId,documentId:input.documentId,sourceVersion:result.sourceVersion,operationId:result.operationId!,observed:true})
  expect(p.receipts).toEqual(['op-1','op-2','op-3'])
  coordinator.dispose()
 })
 it('uses the exact selected presentation leaf rather than retaining the prior recipe',async()=>{
  const p=peer('presentation:disclosure'),coordinator=new AdaptiveCompositionCoordinator({getSettings:async()=>({takeover:true,adaptive:{enabled:true,styleMode:'automatic',blockLayout:true},theme:{activeId:'empryo',installed:[]}}),getExecutableComponents:createSourceBlockComponentRegistry})
  coordinator.attachJev(p.port)
  const result=await coordinator.compose({sessionId:'s',documentId:'d',value:'# Section\n\nSource paragraph.',capabilities:{webgl:false,reducedMotion:true}})
  expect(result.status).toBe('selected')
  for(const block of result.selection!.blockLayout!.blocks){expect(block.component?.id).toBe('presentation:disclosure');expect(block.presentation).toBe('disclosure')}
  coordinator.dispose()
 })
})
