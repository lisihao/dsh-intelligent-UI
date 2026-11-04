import {createElement as h,useEffect,useRef,useSyncExternalStore,type ReactElement} from 'react'
import type {Context} from '@deepseek-ai/cordis'
import type {ConfigForms,SettingsSchemaService} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {SettingsNamespaceView} from '@deepseek-ai/dsh-api-remotes/client'
import type {ConnectionHandle} from '@deepseek-ai/dsh-client-connection/client'
import {z} from 'zod'
import {ModelCenterView} from './model-center-view.js'
import {ModelCenterStore,type ModelCenterReaders} from './model-center-store.js'
import {readModelCenterCost,type ModelCenterCostWire} from './model-center-cost.js'
import {readModelCenterWeb} from './model-center-web.js'
import {readModelCenterSubscriptions} from './model-center-subscriptions.js'
import {readModelCenterModels,findExistingModelDefinition,mutateExistingModelDefinition,type ModelCenterModelsRemote,type ModelCenterProvider} from './model-center-models.js'
import {composeModelCenterUsage,composeModelCenterWeb,modelCenterSource} from './model-center-compose.js'
import {openOriginalSettingsSection} from './settings-navigation-layout.js'
import {activateNativeSettingsSection,readSettingsSections} from './settings-navigation.js'
import type {CenterAccount,CenterModel,ModelCenterViewActions} from './model-center-view-model.js'
export const MODEL_CENTER_SECTION='solar-model-center'
interface CostRemote extends ModelCenterCostWire {updateConfig(patch:unknown):Promise<{ok:true,value:unknown}|{ok:false,error?:unknown}>}
interface RuntimeRemote extends ModelCenterModelsRemote {costMeter:CostRemote,credentials:{describe(refs:string[]):Promise<{ok:true,value:unknown}|{ok:false,error?:unknown}>}}
interface Slots {entries(slot:string):readonly import('@deepseek-ai/dsh-client-ui-slots').StoredEntry[],inject(slot:'settings.section',register:()=>()=>void):()=>void,register(options:{name:'settings.section',id:string,order:number,label:()=>string},component:()=>ReactElement):()=>void}
const credentialMapSchema=z.record(z.string(),z.object({configured:z.boolean(),writable:z.boolean(),source:z.string().optional()}))
const refSchema=z.string().regex(/^[A-Z_][A-Z0-9_]*$/)
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)}
interface Runtime {store:ModelCenterStore,saveDefinition:NonNullable<ModelCenterViewActions['saveDefinition']>,saveBudget:NonNullable<ModelCenterViewActions['saveBudget']>}
/** Connects only public services; no credential values or raw owner state leave this boundary. */
export function createModelCenterRuntime(input:{remote:RuntimeRemote,forms:ConfigForms,schema:SettingsSchemaService,connection:Pick<ConnectionHandle,'rpc'>,fetcher?:typeof fetch}):Runtime{
 const {remote,forms,schema,connection}=input
 let providers:readonly ModelCenterProvider[]=[]
 let views:readonly SettingsNamespaceView[]=[]
 const readers:ModelCenterReaders={
  async models(signal){
   const [catalog,description]=await Promise.allSettled([readModelCenterModels(remote),forms.describe().ensure()]);if(signal.aborted)throw Error('aborted')
   if(catalog.status==='rejected')throw catalog.reason
   const value=catalog.value
   providers=value.providers;views=description.status==='fulfilled'?forms.describe().getSnapshot().view?.namespaces??[]:[]
   const namespaces=new Map(views.map(view=>[view.ns,view]));const profiles=new Map<string,unknown>()
   for(const provider of providers){const ns=provider.settingsNs?namespaces.get(provider.settingsNs):undefined;if(ns&&provider.settingsPath)profiles.set(provider.provider,schema.getPath(ns.value,provider.settingsPath))}
   const refs=[...new Set([...profiles.values()].flatMap(profile=>record(profile)&&refSchema.safeParse(profile.apiKeyEnv).success?[profile.apiKeyEnv as string]:[]))]
   const keyStates:Record<string,{configured:boolean}>={};let credentialWarning=description.status==='rejected'
   for(let index=0;index<refs.length;index+=64){const result=await remote.credentials.describe(refs.slice(index,index+64)).catch(()=>({ok:false as const}));if(!result.ok){credentialWarning=true;break}const parsed=credentialMapSchema.safeParse(result.value);if(!parsed.success){credentialWarning=true;break}Object.assign(keyStates,parsed.data)}
   const accounts:CenterAccount[]=providers.filter(provider=>provider.active).map(provider=>{
    const profile=profiles.get(provider.provider);const ref=record(profile)&&typeof profile.apiKeyEnv==='string'?profile.apiKeyEnv:undefined;const credential=ref?keyStates[ref]:undefined
    const source=provider.settingsNs==='llm-pi-ai'||provider.settingsNs==='llm-deepseek'?'api':modelCenterSource(provider.provider)
    return {key:JSON.stringify(['provider',provider.provider]),provider:provider.provider,active:true,label:provider.name,source,status:credential?(credential.configured?'凭据已配置':'尚未配置凭据'):'通道已注册，账号状态未核实',...(credential?{configured:credential.configured}:{}),fields:[{label:'连接来源',value:provider.name},...(credential?[{label:'凭据状态',value:credential.configured?'已配置，不显示密钥':'未配置'}]:[{label:'认证状态',value:'来源未提供可确认状态'}])],originalSection:'models'}
   })
   const models=value.models.map(model=>{
    const provider=providers.find(provider=>provider.provider===model.provider);const ns=provider?.settingsNs?namespaces.get(provider.settingsNs):undefined
    const definition=provider&&ns?findExistingModelDefinition(ns,provider,model.id,schema):undefined
    const source=provider?.settingsNs==='llm-pi-ai'||provider?.settingsNs==='llm-deepseek'?'api':modelCenterSource(model.provider)
    return {...model,source,...(definition?{...(definition.contextWindow!==undefined?{contextWindow:definition.contextWindow}:{}),...(definition.maxTokens!==undefined?{maxTokens:definition.maxTokens}:{}),...(definition.input?{input:definition.input}:{}),editable:definition.editable,...(definition.editable?{definitionAddress:{namespace:ns!.ns,modelPath:definition.modelPath,revision:definition.revision}}:{})}:{})} satisfies CenterModel
   })
   return {accounts,models,...(value.warning||credentialWarning?{warning:value.warning??'部分凭据配置状态不可读，未将其显示为已连接。'}:{})}
  },
  async cost(){return composeModelCenterUsage(await readModelCenterCost(remote.costMeter))},
  async web(signal){return composeModelCenterWeb(await readModelCenterWeb((path,options)=> (input.fetcher??globalThis.fetch)(path,{...options,signal,cache:'no-store',credentials:'same-origin'})))},
  async subscriptions(signal){const value=await readModelCenterSubscriptions(connection.rpc,signal);return{accounts:value.accounts,quotas:value.quotas,...(Object.values(value.states).some(state=>state.status==='error')?{warning:'部分订阅账号摘要不可读，已保留其他可用账号。'}:{})}},
 }
 const store=new ModelCenterStore(readers)
 return {store,
  async saveDefinition(model,patch){
   const address=model.definitionAddress;const provider=providers.find(provider=>provider.provider===model.provider)
   const ns=forms.describe().getSnapshot().view?.namespaces.find(view=>view.ns===address?.namespace)
   if(!address||!provider||!ns)throw Error('该模型需要在原始模型设置中管理。')
   try { await mutateExistingModelDefinition({namespace:ns,provider,modelId:model.id,modelPath:address.modelPath,expectedRevision:address.revision,patch,form:forms.get(ns.ns),schema}) } catch(error) { const message=error instanceof Error?error.message:'';throw Error(message.startsWith('MODEL_CENTER_MODEL_REVISION_CONFLICT')?'配置已被其他页面更改，请重新打开模型定义。':message.startsWith('MODEL_CENTER_MODEL_PATCH_INVALID')?'修改不符合模型来源的配置约束，请检查输入。':'此模型需要在原始设置中管理，当前修改未提交。') }
   await store.refresh();return store.snapshot().models.find(row=>row.key===model.key)
  },
  async saveBudget(value){
   if(!Number.isFinite(value.limit)||value.limit<0)throw Error('预算金额必须为不小于零的有限数值。')
   const result=await Promise.resolve().then(()=>remote.costMeter.updateConfig({budget:{amount:value.limit}})).catch(()=>({ok:false as const}))
   if(!result.ok)throw Error('预算保存未被费用插件接受，请在原始费用设置中检查。')
   await store.refresh()
  },
 }
}
export function installModelCenter(ctx:Context):void{
 ctx.inject(['configForms','settingsSchema'],child=>{
  const runtime=createModelCenterRuntime({remote:child.get('remote') as unknown as RuntimeRemote,forms:child.get('configForms')!,schema:child.get('settingsSchema')!,connection:child.get('connection') as unknown as ConnectionHandle})
  child.effect(()=>()=>runtime.store.dispose(),'model center: memory-only source projections')
  const slots=child.get('slots') as unknown as Slots
  function Connected():ReactElement{
   const ref=useRef<HTMLDivElement>(null);const state=useSyncExternalStore(runtime.store.subscribe,runtime.store.snapshot,runtime.store.snapshot)
   useEffect(()=>{void runtime.store.refresh();return()=>runtime.store.cancel()},[])
   const actions:ModelCenterViewActions={refresh:()=>{void runtime.store.refresh()},saveDefinition:runtime.saveDefinition,saveBudget:runtime.saveBudget,openOriginal(section){
    const root=ref.current;if(!root)return
    const id=section==='accounts'?'account':section
    const owned=openOriginalSettingsSection(root,id)
    if(owned!==undefined){if(!owned.ok)runtime.store.reportError(owned.message??'原始设置暂不可用。');return}
    const row=readSettingsSections(slots.entries('settings.section')).find(row=>row.id===id)
    if(!row){runtime.store.reportError('该原始设置页当前未注册，请检查对应插件。');return}
    const result=activateNativeSettingsSection({root,label:row.targetLabel,focus:true});if(!result.ok)runtime.store.reportError(result.message??'原始设置暂不可用。')
   }}
   return h('div',{ref},h(ModelCenterView,{state,actions}))
  }
  child.effect(()=>slots.inject('settings.section',()=>slots.register({name:'settings.section',id:MODEL_CENTER_SECTION,order:-10000,label:()=> '模型中心'},Connected)),'model center: settings section')
 })
}
