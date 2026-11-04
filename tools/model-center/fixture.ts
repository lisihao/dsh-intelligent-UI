import {createElement as h,useState,useSyncExternalStore,type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'
import {themeStyleTokens} from '../../src/theme-runtime.js'
import {appearanceTokens} from '../../src/appearance.js'
import {resolveTheme} from '../../src/theme-contracts.js'
import {SlotCore} from '@deepseek-ai/dsh-client-ui-slots'
import {installModelCenter} from '../../src/model-center.js'
import {installSettingsNavigation} from '../../src/settings-navigation.js'
const core=new SlotCore();const register=core.register.bind(core) as (options:unknown,component:unknown)=>()=>void
register({name:'root',children:{'settings.section':{kind:'list',scope:'root'},'settings.action':{kind:'list',scope:'root'}}},()=>null)
const originalNames={account:'账号与余额',models:'模型','model-subscriptions':'模型订阅','cost-meter':'费用','deepseek-web-login':'DeepSeek 网页登录',general:'通用设置'}
Object.entries(originalNames).forEach(([id,label],order)=>register({name:'settings.section',id,label,order},()=>h('div',{'data-original-page':id},label)))
const namespace={ns:'llm-deepseek',autoGenerate:false,schema:{type:'object'},value:{apiKeyEnv:'DEEPSEEK_API_KEY',models:[{id:'shared',contextWindow:32000,maxTokens:4000,inputModalities:['text']}]},user:{apiKeyEnv:'DEEPSEEK_API_KEY',models:[{id:'shared',contextWindow:32000,maxTokens:4000,inputModalities:['text']}]},base:{},secrets:[],applies:'live',revision:4}
const getPath=(value:unknown,path:readonly string[]):unknown=>path.reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined,value)
const schema={getPath,hasPath:(value:unknown,path:readonly string[])=>getPath(value,path)!==undefined,rehydrate:()=>({}),nodeAtPath:(_root:unknown,path:readonly string[])=>getPath(namespace.value,path)!==undefined?{}:undefined,validate:(_node:unknown,value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>0?undefined:'invalid'}
const mutations:unknown[]=[];const configCalls:unknown[]=[];const requests:string[]=[]
const forms={describe:()=>({ensure:async()=>{},getSnapshot:()=>({status:'ready',error:null,view:{namespaces:[namespace],writable:true,hasDocument:true}}),subscribe:()=>()=>{}}),get:()=>({getSnapshot:()=>({status:'ready',value:namespace.value,user:namespace.user,revision:namespace.revision,writable:true}),mutate:async(ops:Array<{op:string,path:string[],value:number}>,expected:number)=>{if(expected!==namespace.revision)return false;mutations.push(structuredClone(ops));for(const op of ops){for(const target of[namespace.user,namespace.value]){const parent=getPath(target,op.path.slice(0,-1)) as Record<string,unknown>;parent[op.path.at(-1)!]=op.value}}namespace.revision++;return true}})}
const day={cost:12.5,apiCost:4.25,costCny:90,apiCostCny:30.6}
const costState={today:day,month:day,total:day,budgetUsed:4.25,balance:{status:'ok',currency:'CNY',totalBalance:100,grantedBalance:20,toppedUpBalance:80,fetchedAt:Date.now()},goQuota:{status:'off'},codingPlans:{},config:{currency:'USD',budget:{enabled:true,amount:50,period:'day'},secret:'fixture-secret-not-for-output',prices:{}}}
let failCost=false
const remote={llm:{listProviders:async()=>({ok:true,value:[{id:'deepseek',name:'DeepSeek 官方 API'},{id:'deepseek-web',name:'DeepSeek 网页'},{id:'openai-codex',name:'Codex'}]}),listConfigurableProviders:async()=>({ok:true,value:[{provider:'deepseek',displayName:'DeepSeek 官方 API',settingsNs:'llm-deepseek',settingsPath:[]}]})},session:{modelCatalog:async()=>({ok:true,value:{groups:[{id:'deepseek',name:'DeepSeek 官方 API',models:[{id:'shared',name:'DeepSeek 模型'}]},{id:'deepseek-web',name:'DeepSeek 网页',models:[{id:'shared',name:'DeepSeek 网页模型'}]},{id:'openai-codex',name:'Codex',models:[{id:'coding',name:'Codex 编程模型'}]}],failures:[]}})},credentials:{describe:async()=>({ok:true,value:{DEEPSEEK_API_KEY:{configured:true,writable:true}}})},costMeter:{getLocalState:async()=>failCost?{ok:false,error:{message:'fixture-secret-not-for-output'}}:{ok:true,value:structuredClone(costState)},updateConfig:async(patch:{budget:{amount:number}})=>{configCalls.push(structuredClone(patch));costState.config.budget.amount=patch.budget.amount;return{ok:true,value:structuredClone(costState)}}}}
const connection={rpc:{call:async(_channel:string,endpoint:string)=>{
 requests.push(endpoint)
 if(endpoint==='codex-subscription/status')return{ok:true,value:{authenticated:true,provider:'openai-codex',accounts:[{id:'one',label:'主账号',active:true,email:'demo@example.invalid'}]}}
 if(endpoint==='codex-subscription/usage')return{ok:true,value:{rateLimits:[{id:'codex',name:'Codex',windows:[{usedPercent:100,remainingPercent:0,windowSeconds:18000,resetsAt:1890000000}]}]}}
 return{ok:true,value:{account:{signedIn:false},usage:{status:'unavailable'}}}
}}}

const effects:Array<()=>void>=[]
const slots={entries:core.entries.bind(core),subscribe:core.subscribe.bind(core),register,inject:(_name:string,fn:()=>()=>void)=>fn()}
const ctx={slots,locale:{subscribe:()=>()=>{}},get:(name:string)=>({slots,'remote.llm':remote.llm,'remote.session':remote.session,'remote.credentials':remote.credentials,'remote.costMeter':remote.costMeter,configForms:forms,settingsSchema:schema,connection} as Record<string,unknown>)[name],inject:(_names:readonly string[],callback:(ctx:unknown)=>void)=>{callback(ctx);return()=>{}},effect:(fn:()=>void|(()=>void))=>{const dispose=fn();if(typeof dispose==='function')effects.push(dispose);return dispose},on:()=>()=>{}}
let preference={settings:{settingsNavigation:true}}
const preferenceListeners=new Set<()=>void>()
installSettingsNavigation(ctx as never,{snapshot:()=>preference,subscribe:fn=>{preferenceListeners.add(fn);return()=>preferenceListeners.delete(fn)},setEnabled:async(enabled:boolean)=>{preference={settings:{settingsNavigation:enabled}};preferenceListeners.forEach(fn=>fn())}})
const fetchReal=globalThis.fetch
const webResponses:Record<string,unknown>={'/deepseek-web-login/api/status?light=1':{provider:'deepseek-web',auth:{loggedIn:true,display:'web***@example.invalid',token:'fixture-secret-not-for-output'},config:{guest:{token:'fixture-secret-not-for-output'}}},'/deepseek-web-login/api/accounts':{activeId:'web-one',accounts:[{id:'web-one',label:'网页账号',isActive:true,token:'fixture-secret-not-for-output'}]},'/deepseek-web-login/api/models':{models:[{id:'shared',name:'DeepSeek 网页模型',inputModalities:['text']}]}}
globalThis.fetch=(async(path:RequestInfo|URL)=>{requests.push(String(path));return{ok:true,status:200,json:async()=>structuredClone(webResponses[String(path)])} as Response}) as typeof fetch
installModelCenter(ctx as never)
function Fixture(){useSyncExternalStore(listener=>core.subscribe('settings.section',listener),()=>core.getVersion('settings.section'));const[requested,setRequested]=useState('solar-model-center');const rows=core.entries('settings.section').toSorted((a,b)=>(Number(a.options.order)||0)-(Number(b.options.order)||0));const active=rows.some(row=>row.options.id===requested)?requested:rows[0]?.options.id;const current=rows.find(row=>row.options.id===active);const Action=core.entries('settings.action')[0]?.component as ComponentType|undefined;const Page=current?.component as ComponentType|undefined;return h('div',{role:'dialog','data-shortcut-modal':'settings',className:'fixture-dialog'},h('nav',null,h('div',null,'设置'),h('div',null,...rows.map(row=>h('button',{key:row.options.id,type:'button','aria-current':row.options.id===active?'true':undefined,'data-native-id':row.options.id,onClick:()=>setRequested(row.options.id!)},h('span',null,typeof row.options.label==='function'?row.options.label():row.options.label as string))))),h('div',null,h('div',null,h('div',null,Action&&h(Action)),h('button',{type:'button','aria-label':'关闭'},'×')),h('div',null,Page&&h(Page,{key:active}))))}
const style=document.createElement('style');style.textContent='body{margin:0;padding:24px;background:#191b20;color:#edf0f3;font:14px system-ui}*{box-sizing:border-box}.fixture-dialog{height:800px;width:min(1100px,calc(100vw - 48px));margin:auto;display:flex;overflow:hidden}.fixture-dialog>nav{width:188px;flex:none}.fixture-dialog>nav>div:last-child{display:flex;flex-direction:column}.fixture-dialog>nav button{height:40px}.fixture-dialog>nav+div{display:flex;flex:1;flex-direction:column;min-width:0}.fixture-dialog>nav+div>div:first-child{display:flex;justify-content:flex-end;height:54px}.fixture-dialog>nav+div>div:last-child{min-height:0;overflow:auto}';const theme=resolveTheme();style.textContent+='.dsh-experience{'+Object.entries(themeStyleTokens(theme,appearanceTokens(undefined,theme))).map(([key,value])=>key+':'+value).join(';')+'}';document.head.append(style)
createRoot(document.getElementById('root')!).render(h(Fixture))
const sleep=()=>new Promise(resolve=>setTimeout(resolve,30));const wait=async(fn:()=>unknown,label:string)=>{for(let i=0;i<200;i++){if(fn())return;await sleep()}throw Error(label)}
const ensure=(value:unknown,label:string)=>{if(!value)throw Error(label)}
const findButton=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('.iexp-model-center button')].find(button=>button.textContent?.trim()===label)
async function run(){
 await wait(()=>document.body.textContent?.includes('凭据已配置')&&!document.body.textContent?.includes('正在刷新模型中心信息'),'model center did not load')
 ensure(!document.body.textContent?.includes('fixture-secret-not-for-output'),'credential fixture leaked into UI')
 ensure(document.querySelector('.iec-account-layout > .iec-account-detail'),'account detail is nested in the list instead of the second column')
 const native=[...document.querySelectorAll<HTMLButtonElement>('[data-native-id]')]
 ensure(native.length===7,'native registry entries were removed')
 ensure(getComputedStyle(native.find(row=>row.dataset.nativeId==='models')!).display==='none','original pages not consolidated behind center')
 findButton('模型与能力')!.click();await sleep()
 ensure(document.querySelectorAll('.iec-model-select').length===3,'source-qualified model catalog missing or duplicated')
 ensure(document.body.textContent?.includes('32,000'),'saved definition missing')
 await wait(()=>document.querySelectorAll('.iec-definition .iec-definition-form input').length===2,'definition render not ready');const inputs=[...document.querySelectorAll<HTMLInputElement>('.iec-definition .iec-definition-form input')];ensure(inputs.length===2,'safe definition editor missing')
 const first=inputs[0]!;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(first,'33000');first.dispatchEvent(new Event('input',{bubbles:true}));first.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector<HTMLFormElement>('.iec-definition .iec-definition-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait(()=>mutations.length===1,'model definition did not reach owner form');ensure(namespace.user.models[0]!.contextWindow===33000,'model field not updated');ensure(namespace.user.models[0]!.maxTokens===4000,'unrelated model field overwritten')
 findButton('用量与费用')!.click();await sleep();ensure(document.body.textContent?.includes('4.25'),'API-only estimate missing');ensure(document.body.textContent?.includes('剩余 0%'),'zero remaining quota was treated as unavailable')
 failCost=true;findButton('刷新')?.click();await wait(()=>document.querySelector('[role=alert]'),'source error not visible');ensure(document.body.textContent?.includes('Codex'),'independent source disappeared')
 failCost=false;findButton('刷新')?.click();await wait(()=>!document.querySelector('[role=alert]'),'source retry did not recover')
 findButton('账号与连接')!.click();await sleep();findButton('管理高级设置')!.click();await wait(()=>document.querySelector('[data-original-page=models]'),'original settings owner not reachable');ensure(preference.settings.settingsNavigation,'advanced navigation cancelled saved mode')
 document.querySelector<HTMLButtonElement>('[data-native-id=solar-model-center]')!.click();await wait(()=>document.querySelector('.iexp-model-center'),'return to center failed')
 const capture=new URLSearchParams(location.search).get('capture');if(capture){await wait(()=>!!findButton('模型与能力'),'tabsnotready');findButton(capture==='usage'?'用量与费用':capture==='models'?'模型与能力':'账号与连接')!.click()}
 const output={ok:true,nativeEntriesRetained:native.length,models:3,sourceIsolation:true,credentialRedaction:true,fieldScopedSave:true,zeroQuota:true,originalReturn:true,onlyAllowedRequests:requests.every(path=>path.includes('/status')||path==='codex-subscription/usage'||Object.hasOwn(webResponses,path)),width:innerWidth}
 document.getElementById('metrics')!.textContent=JSON.stringify(output);document.documentElement.dataset.ready='true'
}
setTimeout(()=>void run().catch(error=>{document.getElementById('metrics')!.textContent=JSON.stringify({ok:false,error:String(error)});document.documentElement.dataset.ready='true'}),0)
void fetchReal
