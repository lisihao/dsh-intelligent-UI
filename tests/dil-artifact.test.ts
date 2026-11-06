// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtifactView } from '../src/presentation.js'
import { compileDilSource } from '../src/dil/compiler.js'
import { DIL_REFERENCE_COMMIT, dilPayloadSchema, type DilApi, type ExperienceArtifact, type WidgetStateApi } from '../src/contracts.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const counters = vi.hoisted(() => ({ mounted: 0 }))
vi.mock('../src/dil/view.js', () => ({
  DilProgramView: (props: { initialState?:Record<string,unknown>,onStateChange:(s:Record<string,unknown>)=>void,onSubmit:(action:string,input:{state:Record<string,unknown>,fields:Record<string,unknown>})=>Promise<void> }) => {
    const [value, setValue] = useState(Number(props.initialState?.seats ?? 0))
    useEffect(() => { counters.mounted++; return () => { counters.mounted-- } }, [])
    return h('div', { 'data-mock-dil-view': true },
      h('input', { 'aria-label': '本地席位', value, onChange: (e:{currentTarget:HTMLInputElement}) => { const seats=Number(e.currentTarget.value);setValue(seats);props.onStateChange({seats}) } }),
      h('button', { onClick: () => { void props.onSubmit('confirm', {state:{seats:value},fields:{seats:String(value)}}) } }, '提交选择'))
  },
}))
const mounted: ReturnType<typeof createRoot>[]=[]
afterEach(async()=>{for(const root of mounted.splice(0))await act(async()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks()})
const source='{@body const [seats,setSeats]=DIL.useState(3)}\n<form action="confirm"><slider value={seats} onChange={setSeats}/><button type="submit">提交</button></form>'
const compiled=compileDilSource(source)
const payload=dilPayloadSchema.parse({formatVersion:1,source,compiled,referenceCommit:DIL_REFERENCE_COMMIT})
function artifact(id:string,callId='same-call'):ExperienceArtifact{return {formatVersion:1,id,createdAt:'',source:{sessionId:'s',kind:'tool',label:'测试界面',callId},protocol:'dil',raw:source,payload,providerId:'dil'}}
const dilApi:DilApi={dilRuntimeInfo:async()=>({protocolVersion:1,frameUrl:'http://127.0.0.1:12345/runner.html'}),dilCompilePreview:async()=>({payload})}
function edit(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}

describe('DIL artifact state and explicit submission bridge',()=>{
 it('retains local draft state while the same call becomes a durable artifact, then saves using its UUID/revision',async()=>{
  let resolveRead!:(v:Awaited<ReturnType<WidgetStateApi['widgetState']>>)=>void
  const read=new Promise<Awaited<ReturnType<WidgetStateApi['widgetState']>>>(r=>{resolveRead=r})
  const stateApi:WidgetStateApi={widgetState:vi.fn(()=>read),saveWidgetState:vi.fn(async input=>({formatVersion:1 as const,revision:input.expectedRevision+1,state:input.state}))}
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
  await act(async()=>root.render(h(ArtifactView,{artifact:artifact('stream'),dilEnabled:true,dilApi,stateApi})))
  const input=host.querySelector<HTMLInputElement>('input[aria-label="本地席位"]')!;expect(input).not.toBeNull()
  await act(async()=>edit(input,'7'))
  expect(input.value).toBe('7');expect(stateApi.saveWidgetState).not.toHaveBeenCalled()
  const id='1743cc26-6e21-4d88-a123-b477e207a115'
  await act(async()=>root.render(h(ArtifactView,{artifact:artifact(id),dilEnabled:true,dilApi,stateApi})))
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('7');expect(counters.mounted).toBe(1)
  await act(async()=>{resolveRead({formatVersion:1,revision:0,state:{}});await read})
  await act(async()=>{await new Promise(r=>setTimeout(r,330))})
  expect(stateApi.saveWidgetState).toHaveBeenCalledWith({sessionId:'s',artifactId:id,expectedRevision:0,state:{seats:7}})
 })
 it('dispatches one normal continuation for rapid explicit submit clicks and no continuation during editing',async()=>{
  let finish!:()=>void;const wait=new Promise<void>(r=>{finish=r});const submit=vi.fn<NonNullable<Parameters<typeof ArtifactView>[0]['onContinue']>>(()=>wait)
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
  await act(async()=>root.render(h(ArtifactView,{artifact:artifact('draft'),dilEnabled:true,dilApi,onContinue:submit})))
  await act(async()=>edit(host.querySelector('input')!,'9'))
  expect(submit).not.toHaveBeenCalled()
  const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='提交选择')!
  await act(async()=>{button.click();button.click()})
  expect(submit).toHaveBeenCalledTimes(1)
  expect(submit.mock.calls[0]?.[0]).toMatchObject({type:'continue_conversation',params:{action:'confirm',protocol:'dil'}})
  expect(submit.mock.calls[0]?.[1]).toEqual({state:{seats:9},fields:{seats:'9'}})
  await act(async()=>{finish();await wait})
  expect(host.textContent).toContain('已提交到当前会话')
 })
 it('shows failed restoration and explicitly leaves this interaction unsaved',async()=>{
  const stateApi:WidgetStateApi={widgetState:vi.fn(async()=>{throw new Error('读取失败')}),saveWidgetState:vi.fn()}
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
  await act(async()=>root.render(h(ArtifactView,{artifact:artifact('1743cc26-6e21-4d88-a123-b477e207a115'),dilEnabled:true,dilApi,stateApi})))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('本次使用初始状态，修改不会保存')
  await act(async()=>edit(host.querySelector('input')!,'8'))
  await act(async()=>{await new Promise(r=>setTimeout(r,330))})
  expect(stateApi.saveWidgetState).not.toHaveBeenCalled()
 })
 it('shows a failed state save while retaining the current local value',async()=>{
  const stateApi:WidgetStateApi={widgetState:vi.fn(async()=>({formatVersion:1 as const,revision:0,state:{}})),saveWidgetState:vi.fn(async()=>{throw new Error('版本冲突')})}
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push(root)
  await act(async()=>root.render(h(ArtifactView,{artifact:artifact('1743cc26-6e21-4d88-a123-b477e207a115'),dilEnabled:true,dilApi,stateApi})))
  await act(async()=>edit(host.querySelector('input')!,'8'))
  await act(async()=>{await new Promise(r=>setTimeout(r,330))})
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('8')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法保存组件状态：版本冲突')
 })

})
