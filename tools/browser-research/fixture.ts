import {createElement as h} from 'react'
import {createRoot} from 'react-dom/client'
import {ExperienceStore,HeaderControls} from '../../src/client.js'
import {ContentView,OutputView,experienceTheme} from '../../src/presentation.js'
import {ResearchWorkspace,researchModes} from '../../src/research-view.js'
import {installExperienceStyles} from '../../src/style.js'
import {installAppearanceStyles} from '../../src/appearance-style.js'
import type {ResearchApi} from '../../src/research-contracts.js'
import {initialSettings} from '../../src/contracts.js'
import {REPORT} from './data.mjs'
async function call(name:string,input:unknown){const response=await fetch(`/api/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw Error(result.error??`HTTP ${response.status}`);return result}
const api:ResearchApi={get:input=>call('get',input),prepare:input=>call('prepare',input),markSubmission:input=>call('markSubmission',input),saveNotes:input=>call('saveNotes',input)}
const settings={...initialSettings(),takeover:true,appearance:{backgroundColor:'#24262b',translucent:true,backgroundOpacity:0.47}}
const store=new ExperienceStore()
store.update({settings,api:{settings:async()=>settings,saveSettings:async input=>Object.assign(settings,input,{revision:settings.revision+1}),artifacts:async()=>[],publish:async()=>{throw Error('Not part of local research fixture')},research:api}})
installExperienceStyles();installAppearanceStyles(store);experienceTheme.set('dark');researchModes.set('local-research-fixture',true)
const style=document.createElement('style');style.textContent='body{--dsw-alias-label-primary:#eceef2;margin:0;background:#191c22;color:#eceef2;font-family:system-ui,sans-serif}main{max-width:1520px;margin:auto;padding:24px}.fixture-header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:20px}.fixture-header p{margin:0;font-size:13px;color:#bac2cb}';document.head.append(style)
const params=new URLSearchParams(location.search),documentId=params.has('empty')?'empty':'populated'
createRoot(document.getElementById('root')!).render(h('main',null,h('header',{className:'fixture-header'},h('p',null,'实际研究组件 · 合成验收材料 · 本地确定性回放，不调用模型'),h(HeaderControls,{store,sessionId:'local-research-fixture'})),h(OutputView,{sessionId:'local-research-fixture',raw:REPORT},h(ResearchWorkspace,{sessionId:'local-research-fixture',documentId,text:REPORT,api,onOrganize:async(prompt,signal)=>{if(signal.aborted)throw Error('Cancelled');await call('dispatch',{prompt})}},h(ContentView,{value:REPORT})))))
