// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createHash } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperienceStore, HeaderControls, Workspace, researchApiFromWire, submitResearchPrompt } from '../src/client.js'
import { researchModes } from '../src/research-view.js'
import { initialSettings } from '../src/contracts.js'
import type { ResearchApi, ResearchState } from '../src/research-contracts.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const text = '# 当前报告\n\n请查阅[实验原记录](https://example.test/r1)。\n\n|方案|显存（GB）|\n|---|---:|\n|A|48|\n|B|36|'
const state: ResearchState = {formatVersion:1,revision:0,reportHash:createHash('sha256').update(text).digest('hex'),notes:{},reviews:{},questions:[]}
afterEach(()=>{researchModes.clear();document.body.replaceChildren()})
test('current-session submission queues exact visible prompt once without changing model configuration',async()=>{
 const prompt=vi.fn(async()=>({ok:true as const,value:{accepted:true as const}})),abandon=vi.fn(),beginSubmission=vi.fn(()=>({requestId:'visible-identity',abandon}))
 const ctx={sessions:{using:vi.fn(async(_id:unknown,_options:unknown,fn:(ref:unknown)=>unknown)=>fn({ready:Promise.resolve({session:{prompt,beginSubmission}})}))}} as unknown as Parameters<typeof submitResearchPrompt>[0]
 await submitResearchPrompt(ctx,'session-1' as never,'用户确认的整理请求',new AbortController().signal)
 expect(beginSubmission).toHaveBeenCalledWith({mode:'queue',text:'用户确认的整理请求',attachments:[]})
 expect(prompt).toHaveBeenCalledWith([{type:'text',text:'用户确认的整理请求'}],'queue',expect.any(AbortSignal),'visible-identity')
 expect(abandon).not.toHaveBeenCalled();expect(prompt).toHaveBeenCalledOnce()
})
test('failed queue admission retires its visible echo and surfaces the host error',async()=>{
 const abandon=vi.fn(),cause=new Error('admission rejected')
 const ctx={sessions:{using:async(_id:unknown,_options:unknown,fn:(ref:unknown)=>unknown)=>fn({ready:Promise.resolve({session:{prompt:async()=>({ok:false,error:cause}),beginSubmission:()=>({requestId:'id',abandon})}})})}} as unknown as Parameters<typeof submitResearchPrompt>[0]
 await expect(submitResearchPrompt(ctx,'s' as never,'request',new AbortController().signal)).rejects.toThrow('admission rejected');expect(abandon).toHaveBeenCalledOnce()
})
test('research wire validates boundaries and remains absent on older Hosts',async()=>{
 expect(researchApiFromWire()).toBeUndefined();expect(researchApiFromWire({} as never)).toBeUndefined()
 const wire={get:vi.fn(async()=>({ok:true as const,value:state})),prepare:vi.fn(),markSubmission:vi.fn(),saveNotes:vi.fn()}
 const api=researchApiFromWire(wire as never)!
 await expect(api.get({sessionId:'s',documentId:'d',text})).resolves.toEqual(state)
 await expect(api.get({sessionId:'',documentId:'d',text})).rejects.toThrow();expect(wire.get).toHaveBeenCalledOnce()
 wire.get.mockResolvedValueOnce({ok:true,value:{...state,revision:-1}})
 await expect(api.get({sessionId:'s',documentId:'d',text})).rejects.toThrow()
})
test('normal generated-content route exposes the shared research control and original report',async()=>{
 const store=new ExperienceStore(),research:ResearchApi={get:vi.fn(async()=>state),prepare:vi.fn(),markSubmission:vi.fn(),saveNotes:vi.fn()}
 const settings={...initialSettings(),takeover:true}
 const artifact={formatVersion:1 as const,id:'80cad45d-1d9a-40ec-a6f5-ce673b4d558f',createdAt:'2026-11-01T00:00:00Z',source:{sessionId:'s',kind:'generated' as const,label:'正常报告'},protocol:'content' as const,raw:text,payload:text,providerId:'content'}
 store.update({settings,api:{settings:async()=>settings,saveSettings:vi.fn(),publish:vi.fn(),artifacts:async()=>[artifact],research}})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 await act(async()=>root.render(h('div',null,h(HeaderControls,{store,sessionId:'s'}),h(Workspace,{store,sessionId:'s'}))))
 expect(host.textContent).toContain('当前报告');expect(research.get).not.toHaveBeenCalled()
 const checkbox=host.querySelector<HTMLInputElement>('[aria-label="研究工作区"]')!
 await act(async()=>checkbox.click())
 expect(host.querySelector('[role="tablist"]')).not.toBeNull();expect(host.textContent).toContain('技术比较');expect(research.get).toHaveBeenCalledWith({sessionId:'s',documentId:`artifact:${artifact.id}`,text})
 await act(async()=>root.unmount())
})
