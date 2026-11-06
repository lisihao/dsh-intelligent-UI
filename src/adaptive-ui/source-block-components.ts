import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { ExecutableComponentRegistry, normalizeExecutableJson, type ExecutableComponentContext, type ExecutableJson } from './executable-registry.js'
import { BLOCK_PRESENTATION_IDS, BLOCK_PRESENTATION_LABELS } from './presentation-recipes.js'
import { presentationGuidance } from './design-guidance.js'
import { baseCompositionSelectionSchema } from './contracts.js'
import { bindDilNativeComponent, assessDilNativeComponent, dilNativeComponentDefinitions, DIL_NATIVE_TREE_RENDERER_KEY } from '../dil/component-bindings.js'
import type { DilComponentId } from '../dil/component-bindings.js'
import { buildDilSourceBindings } from '../dil/source-bindings.js'
import { z } from 'zod'
import { registerLibraryComponentBindings } from './library-component-bindings.js'
import { parseMarkdownTables } from '../content-analysis.js'

export const SOURCE_PRESENTATION_RENDERER_KEY = 'source-presentation-v1'
const parser = unified().use(remarkParse).use(remarkGfm)
const recipeInput = z.strictObject({presentation:z.enum(BLOCK_PRESENTATION_IDS),selection:baseCompositionSelectionSchema})
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const containers = new Set(['box','row','column','grid','grid-item','card'])
const textTags = new Set(['text','title','caption','bold','label','badge'])

type SourceProjection = {readonly raw?:string,readonly segments:readonly {kind:string,source:string}[],readonly codes:readonly {value:string,language?:string}[],readonly tree?:ReturnType<typeof parser.parse>,readonly bindings?:ReturnType<typeof buildDilSourceBindings>}
const projectionCache = new WeakMap<object,SourceProjection>()
function projection(context: ExecutableComponentContext): SourceProjection {
  if (!record(context.source)) return {segments:[],codes:[]}
  const cached=projectionCache.get(context.source);if(cached)return cached
  const value=context.source.value
  if(typeof value!=='string')return {segments:[],codes:[]}
  const data=buildDilSourceBindings(value),tree=parser.parse(value)
  const result={raw:value,tree,bindings:data,segments:data.segments,codes:tree.children.filter(node=>node.type==='code').map(node=>({value:node.value,...(node.lang?{language:node.lang}:{})}))}
  projectionCache.set(context.source,result);return result
}

function dilInput(id: DilComponentId,context:ExecutableComponentContext): unknown {
  const tag=id.slice(4),value=record(context.source)?context.source.value:undefined
  // Typed component source is supplied data, never a model-controlled HTML/JS program.
  if(record(value)&&value.type==='ui-component-content'&&record(value.content))return {formatVersion:1,componentId:id,source:value.content,authority:{handlerIds:context.hostActionIds??[],formActionIds:context.hostActionIds??[]}}
  const data=projection(context)
  if(data.raw===undefined)return undefined
  if(tag==='markdown')return {formatVersion:1,componentId:id,source:{kind:'markdown',source:data.raw}}
  const scopedReferences=/\[[^\]]*\]\[[^\]]*\]|\[\^[^\]]+\]/u.test(data.raw)
  // Structured native candidates consume actual AST/table data. Markdown leaves
  // preserve inline math, links and code instead of displaying their syntax as text.
  const markdownNode=(source:string)=>({kind:'node',tag:'markdown',props:{source}})
  if(tag==='table'&&!scopedReferences&&data.segments.length===1&&data.bindings?.tables.length===1){
    const table=data.bindings.tables[0]!
    return {formatVersion:1,componentId:id,source:{kind:'node',tag:'table',children:[table.header,...table.rows].map((row,index)=>({kind:'node',tag:'table-row',children:row.map(cell=>({kind:'node',tag:'table-cell',props:{header:index===0},children:[markdownNode(cell)]}))}))}}
  }
  if(tag==='list'&&!scopedReferences&&data.segments.length===1&&data.tree?.children[0]?.type==='list'){
    const list=data.tree.children[0]
    if(list.ordered&&list.start!==undefined&&list.start!==null&&list.start!==1)return undefined
    if(list.children.some(item=>item.checked!==undefined&&item.checked!==null))return undefined
    const items=list.children.map(item=>{
      const first=item.children[0]?.position?.start.offset,last=item.children.at(-1)?.position?.end.offset
      return first===undefined||last===undefined?undefined:markdownNode(data.raw!.slice(first,last))
    })
    if(items.every(Boolean))return {formatVersion:1,componentId:id,source:{kind:'node',tag:'list',props:{ordered:list.ordered===true},children:items.map(item=>({kind:'node',tag:'list-item',children:[item]}))}}
  }
  if((tag==='chart'||tag==='pie-chart')&&data.segments.length===1&&data.bindings?.tables.length===1){
    const plans=parseMarkdownTables(data.raw).flatMap(table=>table.plans)
    const plan=plans.find(plan=>!plan.omittedRowRanges?.length&&!plan.omittedColumnRanges?.length&&plan.labels.length<=100&&plan.series.length<=8)
    if(plan){
      const keys=plan.series.map(series=>{const name=series.name,unit=series.unit;return name+(unit&&!name.toLowerCase().includes(`(${unit.toLowerCase()})`)&&!name.toLowerCase().includes(`（${unit.toLowerCase()}）`)?` (${unit})`:'')})
      if(new Set(keys).size===keys.length&&keys.every(key=>key.length<=80&&key!=='__source_label')){
        const chartData=plan.labels.map((label,index)=>Object.fromEntries([['__source_label',label],...plan.series.map((series,column)=>[keys[column]!,series.values[index]!])]))
        const pie=tag==='pie-chart'
        const explicitParts=plan.series.length===1&&/占比|份额|构成|比例|share|composition|allocation|%/iu.test(keys[0]!)&&plan.series[0]!.values.every(value=>value>=0)&&plan.series[0]!.values.some(value=>value>0)
        if(!pie||explicitParts){const title=[plan.title,plan.basis,...(plan.notes??[])].filter(Boolean).join('；');return {formatVersion:1,componentId:id,source:{kind:'chart',data:chartData,categoryKey:'__source_label',title,...(pie?{dataKey:keys[0]}:{series:keys.map(key=>({dataKey:key,type:plan.kind}))})}}}
      }
    }
  }

  if(tag==='code'&&data.codes.length===1&&data.segments.length===1)return {formatVersion:1,componentId:id,source:{kind:'code',...data.codes[0]}}
  if(textTags.has(tag)&&data.raw.length<=120&&!/[\r\n#$`\[\]<>|*_]/u.test(data.raw))return {formatVersion:1,componentId:id,source:{kind:'text',value:data.raw}}
  if(containers.has(tag)){
    if((tag==='row'||tag==='grid')&&data.segments.length<2)return undefined
    const scopedReferences=/\[[^\]]*\]\[[^\]]*\]|\[\^[^\]]+\]/u.test(data.raw)
    if(scopedReferences&&(tag==='row'||tag==='grid'))return undefined
    const children=(scopedReferences?[{source:data.raw}]:data.segments).map(segment=>({kind:'node',tag:'markdown',props:{source:segment.source}}))
    const organized=tag==='grid'?children.map(child=>({kind:'node',tag:'grid-item',children:[child]})):children
    return {formatVersion:1,componentId:id,source:{kind:'node',tag,...(tag==='row'?{props:{wrap:true,gap:3}}:tag==='grid'?{props:{columns:2,gap:3}}:{props:{gap:3}}),children:organized}}
  }
  return undefined
}

/** Concrete native definitions; extra libraries register their adapters on this same registry. */
export function createSourceBlockComponentRegistry():ExecutableComponentRegistry {
  const registry=new ExecutableComponentRegistry()
  for(const id of BLOCK_PRESENTATION_IDS){
    const guidance=presentationGuidance(id)
    registry.register({id:`presentation:${id}`,family:'source-composition',title:BLOCK_PRESENTATION_LABELS[id],rendererKey:SOURCE_PRESENTATION_RENDERER_KEY,
      suitability:`${guidance.purpose} ${guidance.contentFit} ${guidance.tradeoff}`,
      inputSchema:{parse:value=>normalizeExecutableJson(recipeInput.parse(value))},
      bind:context=>{
        const candidates=record(context.source)&&Array.isArray(context.source.recipes)?context.source.recipes:[]
        const candidate=candidates.find(value=>record(value)&&value.id===id)
        return record(candidate)?{eligible:true,input:{presentation:id,selection:candidate.selection},reasons:['compiler-owned-source-recipe']}:{eligible:false,reasons:['source-recipe-contract-not-met']}
      },
    })
  }
  for(const definition of dilNativeComponentDefinitions){
    const id=definition.id
    registry.register({id,family:'native-content',title:`DIL ${definition.tag}`,rendererKey:DIL_NATIVE_TREE_RENDERER_KEY,
      suitability:containers.has(definition.tag)?`Organizes actual source segments using ${definition.tag}. Choose grouping or parallel arrangement only when the source items benefit; code, links and formulas retain Markdown semantics.`:`Native ${definition.tag}; accepted source kinds: ${definition.sourceKinds.join(', ')}. Preserve source values and semantics; controls require source-provided fields and owned handlers.`,
      inputSchema:{parse:value=>{const plan=bindDilNativeComponent(value);if(plan.componentId!==id)throw Error('DIL_COMPONENT_ID_MISMATCH');return normalizeExecutableJson(value)}},
      bind:context=>{
        const input=dilInput(id,context),result=assessDilNativeComponent(input)
        if(!result.eligible)return {eligible:false,reasons:[result.code]}
        return {eligible:true,input:input as ExecutableJson,reasons:['validated-native-source-binding'],actionIds:[...result.plan.requiredHandlerIds,...result.plan.requiredFormActionIds]}
      },
    })
  }
  registerLibraryComponentBindings(registry)
  return registry
}

export function validateSourcePresentationInput(value:unknown){return recipeInput.parse(value)}
