// @vitest-environment jsdom
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataBrowser, type DataBrowserApi } from '../src/data-browser.js'
import type { ExperienceArtifact, PublishInput } from '../src/contracts.js'
import { LOCAL_FILE_SCOPE, LOCAL_IMPORT_PROVIDER } from '../src/file-library-contracts.js'
import { displayModes } from '../src/presentation.js'
import { ExperienceStore } from '../src/store.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounts: Array<{ host: HTMLElement; root: Root }> = [], paths: string[] = [], pending = new Set<Promise<unknown>>()
afterEach(async () => {
  for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }
  displayModes.clear()
  await Promise.allSettled([...pending])
  await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
function tracked<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise)
  void promise.then(() => pending.delete(promise), () => pending.delete(promise))
  return promise
}
async function temporaryStore(): Promise<ExperienceStore> {
  const path = await mkdtemp(join(tmpdir(), 'data-browser-')); paths.push(path)
  return new ExperienceStore(path)
}
async function mount(api?: DataBrowserApi) {
  const host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); mounts.push({ host, root })
  await act(async () => root.render(h(DataBrowser, { api })))
  return { host, root }
}
function button(host: HTMLElement, text: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`Button not found: ${text}`)
  return result
}
async function click(host: HTMLElement, text: string) { await act(async () => button(host, text).click()) }
async function clickFile(host: HTMLElement, name: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="已导入文件"] button')].find(item => item.querySelector('strong')?.textContent === name)
  if (!result) throw new Error(`File not found: ${name}`)
  await act(async () => result.click())
}
async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  throw new Error('Timed out waiting for file library content')
}
async function choose(host: HTMLElement, name: string, text: string) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  const bytes = new TextEncoder().encode(text)
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function submit(host: HTMLElement) {
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
async function search(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索文件名称"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function rawMode(host: HTMLElement) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="输出显示方式"]')!
  await act(async () => { select.value = 'raw'; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
function item(id: string, name: string, raw: string): ExperienceArtifact {
  return { formatVersion: 1, id, createdAt: '2026-11-01T00:00:00.000Z', source: { sessionId: LOCAL_FILE_SCOPE, kind: 'generated', label: `本地导入：${name}` }, protocol: 'content', raw, payload: raw, providerId: LOCAL_IMPORT_PROVIDER }
}

describe('data browser', () => {
  it('imports into the independent library scope and shows the exact original content', async () => {
    const store = await temporaryStore(), publish = vi.fn((value: PublishInput) => tracked(store.publish(value)))
    const api = { publish, localFiles: vi.fn(() => tracked(store.localFiles())) }
    const { host } = await mount(api)
    const raw = '\uFEFF# 原文\r\n\r\n金额 1.00，口径不变。\r\n'
    await click(host, '导入文件'); await choose(host, '研究样本.md', raw); await submit(host)
    await waitFor(() => host.querySelector('[aria-label="已导入文件"]')?.textContent?.includes('研究样本.md') === true)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0]![0]).toMatchObject({ source: { sessionId: LOCAL_FILE_SCOPE, kind: 'generated' }, providerId: LOCAL_IMPORT_PROVIDER, raw, payload: raw })
    expect(host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('研究样本.md')
    await rawMode(host)
    expect(host.querySelector('[aria-label="文件内容"] pre')?.textContent).toBe(raw)
    expect((await store.localFiles())[0]?.raw).toBe(raw)
  })

  it('loads old and new files again after reopening and switches readable content when searching', async () => {
    const store = await temporaryStore()
    const older = await store.publish({ source: { sessionId: 'old-session', kind: 'generated', label: '本地导入：市场旧文件.md' }, protocol: 'content', providerId: 'content', raw: '旧报告原文', payload: '旧报告原文' })
    const newer = await store.publish({ source: { sessionId: LOCAL_FILE_SCOPE, kind: 'generated', label: '本地导入：技术新文件.md' }, protocol: 'content', providerId: LOCAL_IMPORT_PROVIDER, raw: '新报告原文', payload: '新报告原文' })
    const api = { localFiles: vi.fn(() => tracked(store.localFiles())), publish: (input: PublishInput) => tracked(store.publish(input)) }
    const first = await mount(api)
    await waitFor(() => first.host.querySelector('[aria-label="已导入文件"]')?.textContent?.includes('市场旧文件.md') === true)
    expect(first.host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('市场旧文件.md')
    expect(first.host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('技术新文件.md')
    await clickFile(first.host, '市场旧文件.md')
    expect(first.host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('旧报告原文')
    await search(first.host, '技术新')
    expect(first.host.querySelector('[aria-label="已导入文件"]')?.textContent).not.toContain('市场旧文件.md')
    expect(first.host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('新报告原文')
    await search(first.host, '无此文件')
    expect(first.host.textContent).toContain('没有匹配的文件')
    await search(first.host, '')
    expect(first.host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('市场旧文件.md')

    await act(async () => first.root.unmount()); mounts.splice(mounts.findIndex(entry => entry.root === first.root), 1); first.host.remove()
    const reopened = await mount(api)
    await waitFor(() => reopened.host.querySelector('[aria-label="已导入文件"]')?.textContent?.includes('市场旧文件.md') === true)
    expect(api.localFiles).toHaveBeenCalledTimes(2)
    expect(reopened.host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('市场旧文件.md')
    expect(reopened.host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('技术新文件.md')
    expect((await store.localFiles()).map(file => file.id)).toEqual(expect.arrayContaining([older.id, newer.id]))
  })

  it('keeps a newly imported file if an older refresh finishes afterwards', async () => {
    let finish!: (files: ExperienceArtifact[]) => void
    const localFiles = vi.fn(() => new Promise<ExperienceArtifact[]>(resolve => { finish = resolve }))
    const publish = vi.fn(async (input: PublishInput): Promise<ExperienceArtifact> => ({ ...input, formatVersion: 1, id: '00000000-0000-4000-8000-000000000001', createdAt: '2026-11-01T00:00:00.000Z' }))
    const { host } = await mount({ localFiles, publish })
    await click(host, '导入文件'); await choose(host, '刚导入.txt', '刚导入的原文'); await submit(host)
    expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('刚导入的原文')
    await act(async () => finish([]))
    expect(host.querySelector('[aria-label="已导入文件"]')?.textContent).toContain('刚导入.txt')
    expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('刚导入的原文')
  })

  it('does not insert or replay a late old-service publish after switching to a new service', async () => {
    let finish!: (file: ExperienceArtifact) => void
    const oldPublish = vi.fn((_input: PublishInput) => new Promise<ExperienceArtifact>(resolve => { finish = resolve }))
    const newPublish = vi.fn(async (input: PublishInput) => ({ ...input, formatVersion: 1 as const, id: '00000000-0000-4000-8000-000000000004', createdAt: '2026-11-01T00:00:00.000Z' }))
    const oldApi = { localFiles: vi.fn(async () => []), publish: oldPublish }
    const newApi = { localFiles: vi.fn(async () => [item('00000000-0000-4000-8000-000000000005', '新库文件.txt', '新库原文')]), publish: newPublish }
    const { host, root } = await mount(oldApi)
    await click(host, '导入文件'); await choose(host, '旧库文件.txt', '旧库原文'); await submit(host)
    expect(oldPublish).toHaveBeenCalledOnce()
    await act(async () => root.render(h(DataBrowser, { api: newApi })))
    expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('新库原文')
    await act(async () => finish({ ...oldPublish.mock.calls[0]![0], formatVersion: 1, id: '00000000-0000-4000-8000-000000000006', createdAt: '2026-11-01T00:00:00.000Z' }))
    expect(host.querySelector('[aria-label="已导入文件"]')?.textContent).not.toContain('旧库文件.txt')
    expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('新库原文')
    expect(oldPublish).toHaveBeenCalledOnce(); expect(newPublish).not.toHaveBeenCalled()
  })

  it('shows read errors and clears them only after a successful refresh', async () => {
    const file = item('00000000-0000-4000-8000-000000000002', '恢复.txt', '已恢复内容')
    const localFiles = vi.fn<() => Promise<ExperienceArtifact[]>>().mockRejectedValueOnce(new Error('磁盘不可用')).mockResolvedValueOnce([file])
    const { host } = await mount({ localFiles, publish: vi.fn() })
    expect(host.querySelector('[role=alert]')?.textContent).toContain('无法读取文件库：磁盘不可用')
    await click(host, '刷新')
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(host.querySelector('[aria-label="文件内容"]')?.textContent).toContain('已恢复内容')
  })

  it('shows a disconnected service without leaving a pending read active', async () => {
    let finish!: (files: ExperienceArtifact[]) => void
    const api: DataBrowserApi = { localFiles: () => new Promise(resolve => { finish = resolve }), publish: vi.fn() }
    const { host, root } = await mount(api)
    expect(host.textContent).toContain('正在读取文件')
    await act(async () => root.render(h(DataBrowser)))
    expect(host.textContent).toContain('文件库服务尚未连接')
    expect(button(host, '导入文件').disabled).toBe(true)
    expect(host.textContent).not.toContain('正在读取文件')
    await act(async () => finish([item('00000000-0000-4000-8000-000000000003', '过期.txt', '过期内容')]))
    expect(host.textContent).not.toContain('过期内容')
  })
})
