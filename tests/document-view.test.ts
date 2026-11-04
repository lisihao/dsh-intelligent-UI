// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appearancePreferences } from '../src/appearance.js'
import { DocumentView, type DocumentViewProps } from '../src/document-view.js'
import { displayModes } from '../src/presentation.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('standalone DocumentView', () => {
  afterEach(() => { displayModes.clear(); appearancePreferences.reset(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('renders a source-bound document and lets its owner select one shared mode without a session', async () => {
    const element = document.createElement('div'); document.body.append(element); const root = createRoot(element)
    const raw = '# 原始报告\n\n原值：约 4.50%\n'
    const props: DocumentViewProps = { documentId: 'report-1', value: '**可视内容**', raw, source: { label: '原始研究', url: 'https://example.org/report' } }
    await act(async () => root.render(h(DocumentView, props)))
    expect(element.querySelector('[data-iexp-document-id="report-1"]')).not.toBeNull()
    expect(element.querySelector('.iexp-reply-surface strong')?.textContent).toBe('可视内容')
    expect(element.querySelector<HTMLAnchorElement>('.iexp-source-label a')?.getAttribute('href')).toBe('https://example.org/report')
    expect(element.querySelector('.iexp-raw-output')).toBeNull()

    // Changing a host session preference does not create or control a standalone session.
    await act(async () => displayModes.set('report-1', 'raw'))
    expect(element.querySelector('.iexp-raw-output')).toBeNull()
    await act(async () => root.render(h(DocumentView, { ...props, mode: 'raw' })))
    expect(element.querySelector('.iexp-reply-surface')?.parentElement?.hidden).toBe(true)
    expect(element.querySelector('.iexp-raw-output pre')?.textContent).toBe(raw)
    await act(async () => root.render(h(DocumentView, { ...props, mode: 'compare' })))
    expect(element.querySelector('.iexp-reply-surface')?.parentElement?.hidden).toBe(false)
    expect(element.querySelector('.iexp-raw-output pre')?.textContent).toBe(raw)
    expect(element.querySelectorAll('select,button')).toHaveLength(0)
    await act(async () => root.unmount()); element.remove()
  })

  it('preserves structured original data and defaults raw to the supplied value', async () => {
    const element = document.createElement('div'); document.body.append(element); const root = createRoot(element)
    const value = { records: [{ name: '样本', value: '0.0001', unit: '%', period: '2026-Q1' }] }
    await act(async () => root.render(h(DocumentView, { documentId: 'other-owner-record', value, mode: 'raw' })))
    expect(JSON.parse(element.querySelector('.iexp-raw-output pre')!.textContent!)).toEqual(value)
    expect(value.records[0]).toEqual({ name: '样本', value: '0.0001', unit: '%', period: '2026-Q1' })
    await act(async () => root.unmount()); element.remove()
  })

  it('keeps unsafe or non-web source addresses visible as plain text', async () => {
    const element = document.createElement('div'); document.body.append(element); const root = createRoot(element)
    await act(async () => root.render(h(DocumentView, { documentId: 'unsafe-source', value: '文本', source: { label: '外部资料', url: 'javascript:alert(1)' } })))
    expect(element.querySelector('.iexp-source-label')?.textContent).toContain('javascript:alert(1)')
    expect(element.querySelector('.iexp-source-label a')).toBeNull()
    await act(async () => root.unmount()); element.remove()
  })

  it('reuses automatic charts while retaining the exact original report and source table', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const element = document.createElement('div'); document.body.append(element); const root = createRoot(element)
    const report = '| 项目 | 费用（元） |\n| --- | ---: |\n| 东区 | 18.75 |\n| 西区 | 21.50 |'
    await act(async () => root.render(h(DocumentView, { documentId: 'finance-1', value: report, mode: 'compare' })))
    expect(element.querySelector('[data-auto-chart]')?.getAttribute('data-auto-chart')).toBe('bar')
    expect(element.querySelector('[aria-label="原始数据表格"] table')?.textContent).toContain('21.50')
    expect(element.querySelector('.iexp-raw-output pre')?.textContent).toBe(report)
    await act(async () => root.unmount()); element.remove()
  })
})
