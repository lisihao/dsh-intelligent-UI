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
    expect(result.protocol).toBe('content'); expect(result.providerId).toBe('content')
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
})

import { ExperienceStore, Workspace } from '../src/client.js'
import { initialSettings } from '../src/contracts.js'
it('keeps a freshly imported item when an older artifact poll resolves late', async () => {
  const host=document.createElement('div'),root=createRoot(host),settings=initialSettings(),store=new ExperienceStore()
  let oldPoll!:(value:ExperienceArtifact[])=>void
  const artifacts=vi.fn(()=>new Promise<ExperienceArtifact[]>(resolve=>{oldPoll=resolve}))
  store.update({settings,api:{settings:async()=>settings,saveSettings:vi.fn(),artifacts,publish:async value=>artifact(value)}})
  await act(async()=>root.render(h(Workspace,{store,sessionId:'s'})))
  await choose(host,'## 公开数据已导入','public.md');await submit(host)
  expect(host.textContent).toContain('公开数据已导入')
  await act(async()=>oldPoll([]));expect(host.textContent).toContain('公开数据已导入')
  await act(async()=>root.unmount())
})
