import React, { createElement as h, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply } from '../../src/client.js'
import { ContentView } from '../../src/presentation.js'
import paper from '../../theme/paper-flow.dsh-theme.json' with { type: 'json' }

// Synthetic inputs only. The host boundary reproduces the published rc.2
// user bubble's white-space:pre-wrap, without loading private host UI state.
const cases = {
  "paragraphs": "第一段：保留全部文字。\n\n\n\n\n\n\n\n\n\n第二段：多余空白不应放大段间距。\n\n\n\n\n\n\n\n\n\n第三段：正常段落结束。",
  "softLines": "第一行\n第二行\n第三行",
  "hardBreaks": "第一行  \n第二行\\\n第三行",
  "fencedCode": "```python\nif True:\n    print(\"A  B\")\n\n\n    print(\"end\")\n```",
  "indentedCode": "    first\n\n\n    second",
  "whitespaceOnly": " \r\n\t\r\n\n\n",
  "mixed": "# 标题\r\n\r\n\r\n- 第一项\r\n- 第二项\r\n\r\n> 引用原文\r\n\r\n[安全示例链接](https://example.invalid)",
  "table": "| 项目 | 数量 |\n| --- | ---: |\n| 甲 | 2 |\n| 乙 | 3 |",
  "inert": "<iframe src=\"https://untrusted.invalid\"></iframe>\n\n```openui\nroot = TextContent(\"仅显示，不执行\")\n```"
}
const core = new SlotCore()
const register = core.register.bind(core) as (options: unknown, component: unknown) => () => void
register({name:'root',children:{'conversation.chat.node':{kind:'keyed',scope:'session'},'settings.section':{kind:'list',scope:'root'},'conversation.view':{kind:'list',scope:'session'},'conversation.session.header.utilities':{kind:'list',scope:'session'}}},()=>null)
core.registerFactory({name:'conversation.user.text',scope:'session',children:{'conversation.user.text.node':{kind:'keyed',scope:'session',inline:true}}} as never,(()=>null) as never)
register({name:'conversation.user.text.node',key:'text',priority:100},()=>null)
const selected = new URLSearchParams(location.search).get('theme')==='paper' ? paper : undefined
const settings = {formatVersion:1,revision:0,takeover:true,openui:true,mcpApps:false,...selected?{theme:{activeId:'paper-flow',installed:[paper]},appearance:paper.appearance}:{}}
const ok = <T,>(value:T)=>({ok:true,value})
const wire = {settings:async()=>ok(settings),artifacts:async()=>ok([]),saveSettings:async()=>{throw new Error('Fixture must not save settings')},publish:async()=>{throw new Error('Fixture must not publish')}}
const cleanups:Array<()=>void>=[]
const ctx = {inject:()=>()=>{},slots:{register,inject:(_name:string,callback:()=>()=>void)=>callback(),entriesOfSlot:core.entriesOfSlot.bind(core),subscribe:core.subscribe.bind(core)},effect:(callback:()=>()=>void)=>{const dispose=callback();cleanups.push(dispose);return dispose},provide:()=>()=>{},remote:{$mount:async()=>async()=>{}},get:(name:string)=>name==='theme'?{getTheme:()=>({active:{colorScheme:'dark'}})}:name==='remote.solarExperience'?wire:undefined,on:()=>()=>{}}
apply(ctx as never)
await new Promise(resolve=>setTimeout(resolve,50))
const User = core.entriesOfSlot('conversation.user.text.node').find(x=>x.options.key==='text')?.component as ComponentType<{raw:string}>
if(!User)throw new Error('Actual registered user renderer unavailable')
const css=document.createElement('style');css.textContent='body{margin:0;background:#24262b;color:#eceef2;font:15px system-ui}main{max-width:1100px;margin:auto;padding:16px;box-sizing:border-box}h1{font-size:20px}h2{font-size:16px}.fixture-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;margin-bottom:24px}.host-bubble{white-space:pre-wrap;line-height:22px;min-width:0}.sample{min-width:0}pre#metrics{white-space:pre-wrap}@media(max-width:700px){.fixture-pair{grid-template-columns:minmax(0,1fr)}}';document.head.append(css)
createRoot(document.getElementById('root')!).render(h(React.Fragment,null,h('h1',null,'用户消息排版验收 · 合成输入，无模型调用'),...Object.entries(cases).map(([id,raw])=>h('section',{key:id,'data-case':id},h('h2',null,id),h('div',{className:'fixture-pair'},...['before','after'].map(mode=>h('div',{key:mode},h('p',null,mode==='before'?'修复前':'修复后'),h('div',{className:'host-bubble sample','data-mode':mode},mode==='before'?h(ContentView,{value:raw}):h(User,{raw})))))))))
await document.fonts.ready
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
const measurements:Record<string,unknown>={}
for(const [id,raw] of Object.entries(cases)){
 const row:Record<string,unknown>={rawLength:raw.length}
 for(const mode of ['before','after']){
  const e=document.querySelector<HTMLElement>(`[data-case="${id}"] [data-mode="${mode}"]`)!
  const p=e.querySelector('p'),code=e.querySelector('pre code,code')
  row[mode]={height:e.getBoundingClientRect().height,width:e.clientWidth,scrollWidth:e.scrollWidth,text:e.textContent,paragraphs:e.querySelectorAll('p').length,paragraphWhitespace:p?getComputedStyle(p).whiteSpace:null,paragraphHeight:p?.getBoundingClientRect().height??0,lineHeight:p?parseFloat(getComputedStyle(p).lineHeight):0,code:code?.textContent??null,codeWhitespace:code?getComputedStyle(code).whiteSpace:null,cards:e.querySelectorAll('.iexp-reply-surface').length,iframes:e.querySelectorAll('iframe').length}
 }
 measurements[id]=row
}
const result={ready:true,width:innerWidth,theme:selected?'paper':'empryo',cases:measurements}
document.getElementById('metrics')!.textContent=JSON.stringify(result)
document.documentElement.dataset.ready='true'
