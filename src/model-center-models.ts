import { z } from 'zod'
import type { ConfigForm, SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { CenterModel } from './model-center-view-model.js'
import { modelCenterSource } from './model-center-compose.js'
const text=z.string().min(1).max(2048)
const providerSchema=z.object({id:text,name:text})
const directorySchema=z.object({provider:text,displayName:text,settingsNs:text,settingsPath:z.array(z.string()),error:z.string().optional()})
const catalogSchema=z.object({groups:z.array(z.object({id:text,name:text,models:z.array(z.object({id:text,name:text,reasoning:z.object({efforts:z.array(z.object({id:text,name:text}))}).optional()}))})),failures:z.array(z.object({id:text,name:text,message:z.string()}))})
type RemoteResult={ok:true,value:unknown}|{ok:false,error?:unknown}
export interface ModelCenterModelsRemote {llm:{listProviders():Promise<RemoteResult>,listConfigurableProviders():Promise<RemoteResult>},session:{modelCatalog():Promise<RemoteResult>}}
export interface ModelCenterProvider {provider:string,name:string,active:boolean,settingsNs?:string,settingsPath?:readonly string[]}
export interface ModelCenterModelsSnapshot {providers:readonly ModelCenterProvider[],models:readonly CenterModel[],failures:readonly {providerLabel:string}[],warning?:string}
function decode<T>(value:unknown,schema:z.ZodType<T>,label:string):T{const parsed=schema.safeParse(value);if(!parsed.success)throw Error(`MODEL_CENTER_MODELS_FORMAT_INVALID: ${label}格式与已验证版本不同。`);return parsed.data}
export async function readModelCenterModels(remote:ModelCenterModelsRemote):Promise<ModelCenterModelsSnapshot>{
 const [live,directory,catalog]=await Promise.allSettled([remote.llm.listProviders(),remote.llm.listConfigurableProviders(),remote.session.modelCatalog()])
 if(catalog.status!=='fulfilled'||!catalog.value.ok)throw Error('MODEL_CENTER_MODELS_UNAVAILABLE: 官方模型目录暂不可读。')
 const data=decode(catalog.value.value,catalogSchema,'模型目录')
 const registered=live.status==='fulfilled'&&live.value.ok?decode(live.value.value,z.array(providerSchema),'提供商目录'):data.groups.map(group=>({id:group.id,name:group.name}))
 const entries=directory.status==='fulfilled'&&directory.value.ok?decode(directory.value.value,z.array(directorySchema),'模型配置目录'):[]
 const providers:ModelCenterProvider[]=registered.map(row=>{const owner=entries.find(entry=>entry.provider===row.id);return{provider:row.id,name:row.name,active:true,...(owner?{settingsNs:owner.settingsNs,settingsPath:owner.settingsPath}:{})}})
 const seen=new Set<string>();const models:CenterModel[]=[]
 for(const group of data.groups)for(const row of group.models){const key=JSON.stringify([group.id,row.id]);if(seen.has(key))throw Error('MODEL_CENTER_MODELS_DUPLICATE: 同一通道返回了重复模型。');seen.add(key);models.push({key,id:row.id,provider:group.id,name:row.name,providerLabel:group.name,source:modelCenterSource(group.id),...(row.reasoning?{reasoningEfforts:row.reasoning.efforts.map(effort=>effort.id)}:{})})}
 const failures=data.failures.map(row=>({providerLabel:row.name}))
 const warning=failures.length?'部分提供商的模型目录读取失败，已显示其他可用模型。':(live.status!=='fulfilled'||!live.value.ok||directory.status!=='fulfilled'||!directory.value.ok)?'模型配置目录未完整读取，已显示可用模型。':undefined
 return {providers,models,failures,...(warning?{warning}:{})}
}
type SchemaFace=Pick<SettingsSchemaService,'getPath'|'hasPath'|'rehydrate'|'nodeAtPath'|'validate'>
export interface ExistingModelDefinition {modelPath:readonly string[],revision:number,contextWindow?:number,maxTokens?:number,input?:readonly string[],editable:boolean}
function isRecord(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function declaredModelsPath(provider:ModelCenterProvider,ns:SettingsNamespaceView):readonly string[]|undefined{
 if(provider.settingsNs!==ns.ns)return
 if(ns.ns==='llm-deepseek'&&provider.settingsPath?.length===0)return ['models']
 if(ns.ns==='llm-pi-ai'&&provider.settingsPath?.length===2&&provider.settingsPath[0]==='providers'&&provider.settingsPath[1]===provider.provider)return [...provider.settingsPath,'models']
 return
}
/** Read only a model record whose exact id and official owner/schema are established. */
export function findExistingModelDefinition(ns:SettingsNamespaceView,provider:ModelCenterProvider,modelId:string,schema:SchemaFace):ExistingModelDefinition|undefined{
 const listPath=declaredModelsPath(provider,ns);if(!listPath)return
 const list=schema.getPath(ns.value,listPath);if(!Array.isArray(list))return
 const matches=list.flatMap((value,index)=>isRecord(value)&&value.id===modelId?[{value,index}]:[]);if(matches.length!==1)return
 const {value,index}=matches[0]!;const modelPath=[...listPath,String(index)];const root=schema.rehydrate(ns.schema)
 if(!schema.nodeAtPath(root,[...modelPath,'id']))return
 const raw=schema.getPath(ns.user,modelPath);const rawMatches=isRecord(raw)&&raw.id===modelId
 const number=(field:string)=>typeof value[field]==='number'&&Number.isFinite(value[field])&&value[field]>0?value[field] as number:undefined
 const contextWindow=number('contextWindow'),maxTokens=number('maxTokens')
 const inputValue=value.input??value.inputModalities
 const input=Array.isArray(inputValue)&&inputValue.every(item=>typeof item==='string')?inputValue as string[]:undefined
 const editable=rawMatches&&['contextWindow','maxTokens'].every(field=>schema.hasPath(ns.user,[...modelPath,field])&&typeof (raw as Record<string,unknown>)[field]==='number'&&schema.nodeAtPath(root,[...modelPath,field])!==undefined)
 return {modelPath,revision:ns.revision,...(contextWindow!==undefined?{contextWindow}:{}),...(maxTokens!==undefined?{maxTokens}:{}),...(input?{input}:{}),editable}
}
const patchSchema=z.object({contextWindow:z.number().int().positive().safe().optional(),maxTokens:z.number().int().positive().safe().optional()}).strict().refine(value=>Object.keys(value).length>0)
export async function mutateExistingModelDefinition(input:{namespace:SettingsNamespaceView,provider:ModelCenterProvider,modelId:string,modelPath:readonly string[],expectedRevision:number,patch:unknown,form:Pick<ConfigForm<unknown>,'mutate'>,schema:SchemaFace}):Promise<void>{
 if(input.namespace.revision!==input.expectedRevision)throw Error('MODEL_CENTER_MODEL_REVISION_CONFLICT: 配置已变化，请重新打开模型定义。')
 const definition=findExistingModelDefinition(input.namespace,input.provider,input.modelId,input.schema)
 if(!definition?.editable||JSON.stringify(definition.modelPath)!==JSON.stringify(input.modelPath))throw Error('MODEL_CENTER_MODEL_WRITE_UNAVAILABLE: 此模型定义需要在原始模型设置中管理。')
 const patch=patchSchema.safeParse(input.patch);if(!patch.success)throw Error('MODEL_CENTER_MODEL_PATCH_INVALID: 上下文与输出上限必须为正整数。')
 const root=input.schema.rehydrate(input.namespace.schema);const ops:SettingsPathOpView[]=[]
 for(const [field,value]of Object.entries(patch.data)){const path=[...definition.modelPath,field];const node=input.schema.nodeAtPath(root,path);if(!node||input.schema.validate(node,value)!==undefined)throw Error('MODEL_CENTER_MODEL_PATCH_INVALID: 修改不符合模型来源的配置约束。');ops.push({op:'set',path,value:value!})}
 if(!await input.form.mutate(ops,input.expectedRevision))throw Error('MODEL_CENTER_MODEL_REVISION_CONFLICT: 保存未被接受，请重新打开模型定义。')
}
