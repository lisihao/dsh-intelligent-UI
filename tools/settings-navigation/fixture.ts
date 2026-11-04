import React,{createElement as h,useState,useSyncExternalStore} from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {SlotCore,resolveSlotLabel} from '@deepseek-ai/dsh-client-ui-slots'
import {installSettingsNavigation} from '../../src/settings-navigation.js'
const names:Record<string,string>={account:'账号与余额',general:'通用设置',models:'模型','dream-skin':'Theme / 外观',plugins:'内置插件','model-subscriptions':'模型订阅','dsh-imagegen':'生图配置','agent-presets':'Agent 预设','agent-persona':'Agent 人设','cost-meter':'费用',market:'插件市场','solar-rlm':'RLM 算子','solar-native-collaboration':'智能协同','deepseek-web-login':'DeepSeek 网页登录','solar-chatgpt-web':'网页与洞察','solar-model-radar':'模型雷达','solar-intelligent-experience':'智能体验','solar-quant-research':'量化研究',bili:'bili设置','session-prefix':'会话前缀'}
let language='zh',revision=0
const localeListeners=new Set<()=>void>()
const locale={subscribe:(f:()=>void)=>{localeListeners.add(f);return()=>localeListeners.delete(f)},getSnapshot:()=>revision}
const core=new SlotCore(),register=core.register.bind(core) as (options:unknown,component:unknown)=>()=>void
register({name:'root',children:{'settings.section':{kind:'list',scope:'root'},'settings.action':{kind:'list',scope:'root'}}},()=>null)
Object.entries(names).forEach(([id,label],i)=>register({name:'settings.section',id,order:i,label:()=>language==='zh'?label:'Page '+(i+1)},()=>null))
const cleanups:Array<()=>void>=[]
const ctx={slots:{entries:core.entries.bind(core),subscribe:core.subscribe.bind(core),register,inject:(_name:string,callback:()=>()=>void)=>callback()},locale,effect:(callback:()=>()=>void)=>{const f=callback();cleanups.push(f);return f}}
installSettingsNavigation(ctx as never)
const Action=core.entries('settings.action')[0]!.component as React.ComponentType
let selected='account'
function Fixture(){
 useSyncExternalStore(f=>core.subscribe('settings.section',f),()=>core.getVersion('settings.section'))
 useSyncExternalStore(locale.subscribe,locale.getSnapshot)
 const [active,setActive]=useState(selected)
 const rows=core.entries('settings.section')
 return h('div',{role:'dialog','aria-modal':true,'aria-label':'设置',className:'fixture-dialog'},h('nav',{'aria-label':'原设置菜单'},...rows.map(row=>h('button',{key:row.options.id,'data-native-id':row.options.id,'aria-current':active===row.options.id?'page':undefined,onClick:()=>{selected=row.options.id!;setActive(selected)}},resolveSlotLabel(row.options.label)))),h('section',{className:'fixture-content'},h('header',null,h('span',null,'设置'),h(Action)),h('h1',{'data-current-page':active},resolveSlotLabel(rows.find(x=>x.options.id===active)?.options.label))))
}
const style=document.createElement('style');style.textContent=':root{--dsw-alias-bg-layer-2:#2d2f34;--dsw-alias-bg-layer-3:#34373e;--dsw-alias-label-primary:#eceef2;--dsw-alias-label-secondary:#b9bdc4;--dsw-alias-border-l2:#50545b;color-scheme:dark}body{margin:0;background:#24262b;color:var(--dsw-alias-label-primary);font:14px system-ui}.fixture-dialog{position:relative;display:grid;grid-template-columns:180px minmax(0,1fr);width:min(800px,calc(100vw - 32px));height:min(780px,calc(100vh - 32px));margin:16px auto;background:var(--dsw-alias-bg-layer-2);border-radius:12px;overflow:hidden}.fixture-dialog>nav{padding:16px 8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}.fixture-dialog>nav>button{flex-shrink:0;background:transparent;color:inherit;border:0;text-align:left;min-height:36px;padding:6px 8px;font:inherit;cursor:pointer}.fixture-dialog>nav>button[aria-current=page]{background:var(--dsw-alias-bg-layer-3)}.fixture-content{min-width:0;padding:16px}.fixture-content>header{display:flex;align-items:center;justify-content:space-between;gap:8px}.fixture-content>h1{font-size:18px}.fixture-dialog button:focus-visible{outline:2px solid currentColor;outline-offset:2px}';document.head.append(style)
flushSync(()=>createRoot(document.getElementById('root')!).render(h(Fixture)))
const delay=()=>new Promise(resolve=>setTimeout(resolve,25))
const ensure=(ok:unknown,message:string)=>{if(!ok)throw new Error(message)}
const scope=()=>document.querySelector<HTMLElement>('[data-solar-settings-navigation]')!
const trigger=()=>scope().querySelector<HTMLButtonElement>('button')!
const open=async()=>{if(trigger().getAttribute('aria-expanded')!=='true')trigger().click();await delay()}
const choice=(id:string)=>scope().querySelector<HTMLButtonElement>(`button[data-section-id="${id}"]`)!
setTimeout(()=>{void(async()=>{
 const native=[...document.querySelectorAll<HTMLButtonElement>('nav button')]
 const clicked:string[]=[]
 ensure(native.length===20,'Native fixture did not retain 20 settings')
 for(const id of Object.keys(names)){await open();const b=choice(id);ensure(b,'Missing grouped row '+id);b.click();await delay();ensure(selected===id,'Original handler did not select '+id);clicked.push(id)}
 ensure(native.every(x=>x.isConnected),'Original navigation nodes were replaced')
 const disposeFuture=register({name:'settings.section',id:'future-unknown',order:999,label:'未来功能'},()=>null);await delay();await open();ensure(choice('future-unknown'),'Unknown page was hidden');choice('future-unknown').click();await delay();ensure(selected==='future-unknown','Unknown original page was unreachable')
 language='en';revision++;localeListeners.forEach(f=>f());await delay();await open();ensure(choice('models').textContent==='Page 3','Locale labels did not refresh');choice('models').click();await delay();ensure(selected==='models','Localized route failed')
 language='zh';revision++;localeListeners.forEach(f=>f());await delay();await open();const target=native.find(x=>x.dataset.nativeId==='models')!;target.disabled=true;choice('models').click();await delay();ensure(!!scope().querySelector('[role=status]')?.textContent,'Missing target did not show a visible error');target.disabled=false
 const duplicate=target.cloneNode(true) as HTMLButtonElement;target.parentElement!.append(duplicate);choice('models').click();await delay();ensure(scope().querySelector('[role=status]')?.textContent?.includes('多个'),'Ambiguous target was not rejected');duplicate.remove()
 disposeFuture();await delay();choice('models').click();await delay();await open();const popup=scope().querySelector<HTMLElement>('[role=region]')!;const rect=popup.getBoundingClientRect();const dialogRect=document.querySelector<HTMLElement>('[role=dialog]')!.getBoundingClientRect();ensure(rect.left>=dialogRect.left&&rect.right<=dialogRect.right+1&&rect.bottom<=Math.min(innerHeight,dialogRect.bottom)+1,'Grouped panel escapes or is clipped by the original dialog')
 ensure(document.querySelectorAll('nav button').length===20,'Original row count changed')
 const categories=Object.fromEntries([...scope().querySelectorAll<HTMLElement>('section[aria-label]')].map(section=>[section.getAttribute('aria-label'),section.querySelectorAll('button[data-section-id]').length]));
 const result={categories,ready:true,ok:true,width:innerWidth,nativeRows:20,groupedRows:scope().querySelectorAll('button[data-section-id]').length,clicked,unknownPreserved:true,localeUpdated:true,missingRejected:true,ambiguousRejected:true,originalNodesPreserved:native.every(x=>x.isConnected),popup:{left:rect.left,right:rect.right,bottom:rect.bottom,width:rect.width}}
 document.getElementById('metrics')!.textContent=JSON.stringify(result)
})().catch(error=>{document.getElementById('metrics')!.textContent=JSON.stringify({ready:true,ok:false,error:String(error),width:innerWidth})})},100)
