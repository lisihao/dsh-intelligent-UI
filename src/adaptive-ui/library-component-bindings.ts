import { z } from 'zod'
import { ExecutableComponentRegistry, normalizeExecutableJson, type ExecutableComponentContext } from './executable-registry.js'
import { baseCompositionSelectionSchema } from './contracts.js'
import { componentSetSchema } from '../theme-contracts.js'
import { assessDilNativeComponent, bindDilNativeComponent } from '../dil/component-bindings.js'
import curated from '../uiverse-sources.json' with {type:'json'}

export const SOURCE_LIBRARY_RENDERER_KEY='source-library-v1'
export const CURATED_UI_RENDERER_KEY='curated-ui-v1'
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const recipeAliases={
  'component:skullet':{recipe:'loading-skullet',title:'Skullet 加载骨架',fit:'Initial source-declared loading state only; never replace content that has already arrived.'},
  'component:torph':{recipe:'text-torph',title:'Torph 文字与数字变形',fit:'Short stable text/number updates with actual previous/current source values; preserve units; respect reduced motion.'},
  'component:liveline':{recipe:'live-liveline',title:'Liveline 实时序列',fit:'Actual source-declared live time series with ordered time/value pairs and units, never a historical table relabeled as live.'},
  'component:visx-historical':{recipe:'chart-visx',title:'Visx 历史图表',fit:'Source-validated historical time series with real time coordinates, units and gaps; do not fabricate observations.'},
}as const
const aliasInput=z.strictObject({componentId:z.enum(Object.keys(recipeAliases) as [keyof typeof recipeAliases,...(keyof typeof recipeAliases)[]]),presentation:z.string(),selection:baseCompositionSelectionSchema})
export function validateSourceLibraryInput(value:unknown){
 const parsed=aliasInput.parse(value)
 if(parsed.presentation!==recipeAliases[parsed.componentId].recipe)throw Error('SOURCE_LIBRARY_ID_MISMATCH')
 return parsed
}
function recipes(context:ExecutableComponentContext){return record(context.source)&&Array.isArray(context.source.recipes)?context.source.recipes:[]}
const curatedInput=z.strictObject({componentSet:componentSetSchema,role:z.enum(['card','loader','button','input','toggle']),label:z.string().max(200).optional(),content:z.string().max(20000).optional(),node:z.json().optional()})
export function validateCuratedUiInput(value:unknown){return curatedInput.parse(value)}
export function registerLibraryComponentBindings(registry:ExecutableComponentRegistry):()=>void{
 const disposers:(()=>void)[]=[]
 for(const [id,entry]of Object.entries(recipeAliases))disposers.push(registry.register({
  id,family:'source-runtime-library',title:entry.title,suitability:entry.fit,rendererKey:SOURCE_LIBRARY_RENDERER_KEY,
  inputSchema:{parse:value=>normalizeExecutableJson(validateSourceLibraryInput(value))},
  bind:context=>{
   const candidate=recipes(context).find(value=>record(value)&&value.id===entry.recipe)
   return record(candidate)?{eligible:true,input:{componentId:id,presentation:entry.recipe,selection:candidate.selection},reasons:['validated-source-library-contract']}:{eligible:false,reasons:['source-library-contract-not-met']}
  },
 }))
 for(const [set,sources]of Object.entries(curated.sets))for(const source of sources){
  const id=`uiverse:${set}:${source.role}`
  disposers.push(registry.register({id,family:`curated-${source.role}`,title:`${set} ${source.role}`,rendererKey:CURATED_UI_RENDERER_KEY,
   suitability:`Actual compiled ${source.role} adapter from the ${set} material set. Bind the source's real content/field/action; material changes do not alter facts or create control authority.`,
   inputSchema:{parse:value=>{
    const parsed=validateCuratedUiInput(value)
    if(parsed.componentSet!==set||parsed.role!==source.role)throw Error('CURATED_COMPONENT_ID_MISMATCH')
    if(parsed.node!==undefined)bindDilNativeComponent(parsed.node)
    return normalizeExecutableJson(parsed)
   }},
   bind:context=>{
    const value=record(context.source)?context.source.value:undefined
    if(source.role==='card')return value===undefined||value===null?{eligible:false,reasons:['source-content-required']}:{eligible:true,input:{componentSet:set,role:'card'},reasons:['original-source-content-consumer']}
    if(source.role==='loader'){
     const loading=recipes(context).some(value=>record(value)&&value.id==='loading-skullet')
     return loading?{eligible:true,input:{componentSet:set,role:'loader',...(record(value)&&typeof value.label==='string'?{label:value.label}:{})},reasons:['source-declared-initial-loading']}:{eligible:false,reasons:['source-declared-initial-loading-required']}
    }
    const tag=source.role==='toggle'?'switch':source.role
    const node={formatVersion:1,componentId:`dil:${tag}`,source:record(value)&&value.type==='ui-component-content'?value.content:undefined,authority:{handlerIds:context.hostActionIds??[],formActionIds:context.hostActionIds??[]}}
    const assessed=assessDilNativeComponent(node)
    return assessed.eligible?{eligible:true,input:{componentSet:set,role:source.role,node},reasons:['source-control-fields-and-owned-handlers'],actionIds:[...assessed.plan.requiredHandlerIds,...assessed.plan.requiredFormActionIds]}:{eligible:false,reasons:[assessed.code]}
   },
  }))
 }
 return()=>{for(const dispose of disposers.reverse())dispose()}
}
