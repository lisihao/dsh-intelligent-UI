// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { analyzeMasterDetail, analyzeTaskRecords } from '../src/content-layout.js'
import { BoardView, MasterDetailView } from '../src/layout-views.js'
import { ContentView } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function click(button: HTMLButtonElement | null) {
  expect(button).not.toBeNull()
  await act(async () => button!.click())
}
async function search(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function buttonByText(host: Element, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find(button => button.textContent === text) ?? null
}

describe('large source-preserving task and record views', () => {
  it('bounds status columns and cards, searches all 1000 tasks and lazily exposes the exact source', async () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ taskName: `任务 ${i}`, status: `状态 ${i % 7}`, description: `原始说明 ${i}`, owner: `负责人 ${i}`, extra: { row: i } }))
    const original = JSON.stringify(records), host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(BoardView, { plan: analyzeTaskRecords(records)! })))
      expect(host.querySelectorAll('.iexp-board-column')).toHaveLength(4)
      expect(host.querySelectorAll('.iexp-task')).toHaveLength(80)
      expect(host.textContent).toContain('状态 1–4 / 7')
      expect(host.textContent).not.toContain('任务 999')
      expect(host.querySelector('.iexp-layout-source pre')).toBeNull()

      await click(host.querySelector('button[aria-label="状态 0下一页任务"]'))
      expect(host.textContent).toContain('任务 140')
      expect(host.textContent).not.toContain('任务 0')
      await click(buttonByText(host, '下一组状态'))
      expect(host.querySelectorAll('.iexp-board-column')).toHaveLength(3)
      expect(host.textContent).toContain('状态 5–7 / 7')
      expect(host.querySelectorAll('.iexp-task')).toHaveLength(60)

      await search(host.querySelector('input[type="search"]')!, '任务 999')
      expect(host.querySelectorAll('.iexp-board-column')).toHaveLength(1)
      expect(host.querySelectorAll('.iexp-task')).toHaveLength(1)
      expect(host.textContent).toContain('任务 999')
      expect(host.textContent).toContain('1 / 1000 项任务')

      const details = host.querySelector('.iexp-layout-source') as HTMLDetailsElement
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
      expect(JSON.parse(details.querySelector('pre')!.textContent!)).toEqual(records)
      expect(JSON.stringify(records)).toBe(original)
      await act(async () => { details.open = false; details.dispatchEvent(new Event('toggle')) })
      expect(details.querySelector('pre')).toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('pages 201 named records and keeps the last selected record and all fields accessible', async () => {
    const records = Array.from({ length: 201 }, (_, i) => ({ name: `对象 ${i}`, description: `原始说明 ${i} ` + '细节'.repeat(50), owner: `负责人 ${i}` }))
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(MasterDetailView, { plan: analyzeMasterDetail(records)! })))
      expect(host.querySelectorAll('.iexp-object-list button')).toHaveLength(20)
      for (let i = 0; i < 10; i++) await click(buttonByText(host, '下一组对象'))
      expect(host.querySelectorAll('.iexp-object-list button')).toHaveLength(1)
      expect(host.querySelector('.iexp-object-detail')?.textContent).toContain('对象 200')
      expect(host.querySelector('.iexp-object-detail')?.textContent).toContain('负责人 200')
      const details = host.querySelector('.iexp-object-detail .iexp-layout-source') as HTMLDetailsElement
      expect(details.querySelector('pre')).not.toBeNull()
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
      expect(JSON.parse(details.querySelector('pre')!.textContent!)).toEqual(records[200])
      expect(host.querySelector<HTMLButtonElement>('button[disabled]')?.textContent).toBe('下一组对象')
    } finally { await act(async () => root.unmount()); host.remove() }
  })

  it('automatically renders a 201-row, 31-column Markdown task table and reaches its last original row', async () => {
    const headers = ['任务', '状态', ...Array.from({ length: 29 }, (_, i) => `字段${i}`)]
    const rows = Array.from({ length: 201 }, (_, i) => [`任务${i}`, `状态${i % 3}`, ...Array.from({ length: 29 }, (_, j) => `原值${i}-${j}`)])
    const markdown = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n')
    const host = document.createElement('div'), root = createRoot(host)
    document.body.append(host)
    try {
      await act(async () => root.render(h(ContentView, { value: markdown })))
      expect(host.querySelector('[data-content-layout="board"]')?.textContent).toContain('201 项任务')
      await search(host.querySelector('input[type="search"]')!, '任务200')
      expect(host.querySelectorAll('.iexp-task')).toHaveLength(1)
      expect(host.querySelector('.iexp-task')?.textContent).toContain('任务200')
      const source = host.querySelector('.iexp-board .iexp-layout-source') as HTMLDetailsElement
      await act(async () => { source.open = true; source.dispatchEvent(new Event('toggle')) })
      const parsed = JSON.parse(source.querySelector('pre')!.textContent!)
      expect(parsed).toHaveLength(201)
      expect(headers.map(header => parsed[200][header])).toEqual(rows[200])
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
