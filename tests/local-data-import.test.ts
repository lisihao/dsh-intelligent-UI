// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { importedContent, importError, readLocalText, LocalDataImport } from '../src/local-data-import.js'
import type { ExperienceArtifact, PublishInput } from '../src/contracts.js'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function artifact(value: PublishInput): ExperienceArtifact { return { ...value, formatVersion: 1, id: '310dc7ed-a21e-4d30-827e-88d88a26d3c9', createdAt: '2026-11-01T00:00:00Z' } }
async function choose(host: HTMLElement, text = '# 原文\n\n未经改写。', name = '公开样本.md', read = async () => text) {
  const input = host.querySelector('input')!
  await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size: new TextEncoder().encode(text).byteLength, arrayBuffer: async () => new TextEncoder().encode(await read()).buffer }] }); input.dispatchEvent(new Event('change', { bubbles: true })) })
}
const submit = async (host: HTMLElement) => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
describe('normal local-data entry', () => {
  it('preserves literal source bytes and exact session, while JSON only becomes content data', () => {
    const text = '\uFEFF{ "nodes": [{"id":"a","label":"<script>literal</script>"}], "edges": [] }'
    const result = importedContent('引用.JSON', text, 'existing-session')
    expect(result.raw).toBe(text); expect(result.payload).toEqual(JSON.parse(text.slice(1)))
    expect(result.source).toEqual({sessionId:'existing-session',kind:'generated',label:'本地导入：引用.JSON'})
    expect(result.protocol).toBe('content'); expect(result.providerId).toBe('local-import')
  })
  it('retains a user-supplied source/subset note in the existing visible source label', () => {
    const result = importedContent('public.json', '{\"value\":1}', 's', 'https://example.org/data · 原表前1000条')
    expect(result.source.label).toBe('本地导入：public.json · https://example.org/data · 原表前1000条')
    expect(result.raw).toBe('{\"value\":1}')
  })
  it('names empty/invalid format errors and actual Host capacity without leaking session IDs', () => {
    expect(() => importedContent('bad.json', '{', 's')).toThrow('JSON 文件格式不正确')
    expect(() => importedContent('code.html', '<h1>source</h1>', 's')).toThrow('请选择 JSON')
    expect(() => importedContent('empty.md', '  ', 's')).toThrow('文件为空')
    expect(importError(new Error('Artifact is 2000000 bytes; limit is 1048576 bytes'))).toContain('当前上限')
    expect(importError(new Error('Session private-session already has the maximum of 500 artifacts'))).not.toContain('private-session')
  })
  it('refuses invalid UTF-8 instead of silently replacing source bytes and retains a valid BOM', async () => {
    await expect(readLocalText({arrayBuffer: async () => new Uint8Array([0xff]).buffer})).rejects.toThrow('有效的 UTF-8')
    const original = new Uint8Array([0xef,0xbb,0xbf,0x7b,0x7d])
    await expect(readLocalText({arrayBuffer: async () => original.buffer})).resolves.toBe('\uFEFF{}')
  })
  it('publishes only after explicit submit and preserves the file for retry after Host failure', async () => {
    const host=document.createElement('div'),root=createRoot(host),onImported=vi.fn()
    const publish=vi.fn(async(value:PublishInput)=>artifact(value)).mockRejectedValueOnce(new Error('Artifact is 2000000 bytes; limit is 1048576 bytes'))
    await act(async()=>root.render(h(LocalDataImport,{api:{publish},sessionId:'s',onImported})))
    expect(host.querySelector('button')!.disabled).toBe(true)
    await choose(host);expect(publish).not.toHaveBeenCalled();await submit(host)
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('当前上限');expect(host.querySelector('button')!.disabled).toBe(false)
    await submit(host);expect(publish).toHaveBeenCalledTimes(2);expect(onImported).toHaveBeenCalledOnce()
    expect(publish.mock.calls[1]![0].raw).toBe('# 原文\n\n未经改写。');expect(host.querySelector('[role="status"]')!.textContent).toContain('原始内容保留')
    await act(async()=>root.unmount())
  })
  it('prevents duplicate submission while a file is being read', async()=>{
    const host=document.createElement('div'),root=createRoot(host),publish=vi.fn(async(value:PublishInput)=>artifact(value));let finish!:(text:string)=>void
    await act(async()=>root.render(h(LocalDataImport,{api:{publish},sessionId:'s',onImported:vi.fn()})))
    await choose(host,'pending','sample.md',()=>new Promise(resolve=>{finish=resolve}))
    await submit(host);await submit(host);expect(publish).not.toHaveBeenCalled()
    await act(async()=>finish('original'));expect(publish).toHaveBeenCalledOnce();await act(async()=>root.unmount())
  })
  it('does not publish into a switched session after a late file read',async()=>{
    const host=document.createElement('div'),root=createRoot(host),publish=vi.fn(async(value:PublishInput)=>artifact(value));let finish!:(text:string)=>void
    await act(async()=>root.render(h(LocalDataImport,{api:{publish},sessionId:'old',onImported:vi.fn()})))
    await choose(host,'pending','sample.md',()=>new Promise(resolve=>{finish=resolve}));await submit(host)
    await act(async()=>root.render(h(LocalDataImport,{api:{publish},sessionId:'new',onImported:vi.fn()})))
    await act(async()=>finish('late'));expect(publish).not.toHaveBeenCalled();await act(async()=>root.unmount())
  })
  it('does not forward a late publish to a replacement API or replay it',async()=>{
    const host=document.createElement('div'),root=createRoot(host),onImported=vi.fn()
    let finish!:(value:ExperienceArtifact)=>void
    const oldPublish=vi.fn((_value:PublishInput)=>new Promise<ExperienceArtifact>(resolve=>{finish=resolve}))
    const newPublish=vi.fn(async(value:PublishInput)=>artifact(value))
    const oldApi={publish:oldPublish},newApi={publish:newPublish}
    await act(async()=>root.render(h(LocalDataImport,{api:oldApi,sessionId:'same-scope',onImported})))
    await choose(host,'旧服务原文','old.txt');await submit(host)
    expect(oldPublish).toHaveBeenCalledOnce();expect(newPublish).not.toHaveBeenCalled()
    await act(async()=>root.render(h(LocalDataImport,{api:newApi,sessionId:'same-scope',onImported})))
    await act(async()=>finish(artifact(oldPublish.mock.calls[0]![0])))
    expect(onImported).not.toHaveBeenCalled();expect(oldPublish).toHaveBeenCalledOnce();expect(newPublish).not.toHaveBeenCalled()
    expect(host.querySelector('[role="status"]')).toBeNull()
    await choose(host,'新服务原文','new.txt');await submit(host)
    expect(newPublish).toHaveBeenCalledOnce();expect(onImported).toHaveBeenCalledOnce()
    expect(newPublish.mock.calls[0]![0].raw).toBe('新服务原文')
    await act(async()=>root.unmount())
  })
  it('lets a new service import while an old request is pending without releasing the new request early',async()=>{
    const host=document.createElement('div'),root=createRoot(host),onImported=vi.fn()
    let finishOld!:(value:ExperienceArtifact)=>void,finishNew!:(value:ExperienceArtifact)=>void
    const oldPublish=vi.fn((_value:PublishInput)=>new Promise<ExperienceArtifact>(resolve=>{finishOld=resolve}))
    const newPublish=vi.fn((_value:PublishInput)=>new Promise<ExperienceArtifact>(resolve=>{finishNew=resolve}))
    const oldApi={publish:oldPublish},newApi={publish:newPublish}
    await act(async()=>root.render(h(LocalDataImport,{api:oldApi,sessionId:'same-scope',onImported})))
    await choose(host,'旧服务内容','old.txt');await submit(host)
    expect(oldPublish).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true)
    await act(async()=>root.render(h(LocalDataImport,{api:newApi,sessionId:'same-scope',onImported})))
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(false)
    await choose(host,'新服务内容','new.txt');await submit(host)
    expect(newPublish).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true)
    await act(async()=>finishOld(artifact(oldPublish.mock.calls[0]![0])))
    expect(onImported).not.toHaveBeenCalled()
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true)
    expect(host.querySelector('button')!.textContent).toBe('正在导入…')
    await submit(host)
    expect(newPublish).toHaveBeenCalledOnce()
    await act(async()=>finishNew(artifact(newPublish.mock.calls[0]![0])))
    expect(onImported).toHaveBeenCalledOnce()
    expect(onImported.mock.calls[0]![0].raw).toBe('新服务内容')
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(false)
    expect(oldPublish).toHaveBeenCalledOnce();expect(newPublish).toHaveBeenCalledOnce()
    await act(async()=>root.unmount())
  })
})

import { ExperienceStore, Workspace } from '../src/client.js'
import { initialSettings } from '../src/contracts.js'
it('keeps existing generated content and legacy imports readable after the importer moves', async () => {
  const host=document.createElement('div'),root=createRoot(host),settings=initialSettings(),store=new ExperienceStore()
  const generated = artifact({source:{sessionId:'s',kind:'generated',label:'先前生成'},protocol:'content',raw:'## 先前研究内容',payload:'## 先前研究内容',providerId:'content'})
  const legacy = {...artifact({source:{sessionId:'s',kind:'generated',label:'本地导入：旧文件.md'},protocol:'content',raw:'旧文件原文',payload:'旧文件原文',providerId:'content'}),id:'d66f71a6-4817-4c12-850c-a48b5cb7e961'}
  const artifacts=vi.fn(async()=>[generated,legacy]),publish=vi.fn(async(value:PublishInput)=>artifact(value))
  store.update({settings,api:{settings:async()=>settings,saveSettings:vi.fn(),artifacts,publish}})
  await act(async()=>root.render(h(Workspace,{store,sessionId:'s'})))
  expect(host.textContent).toContain('先前研究内容');expect(host.textContent).toContain('旧文件原文')
  expect(host.querySelector('input[type=file]')).toBeNull();expect(publish).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
})
