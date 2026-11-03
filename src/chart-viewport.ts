import { createElement as h, Children, isValidElement, useMemo, useState, type ReactElement, type ReactNode, type FormEvent, type SyntheticEvent } from 'react'
import type { AutoChartPlan } from './content-analysis.js'
import { ThemeButton, ThemeInput } from './theme-components.js'
import { TableViewport } from './table-viewport.js'
import { SOURCE_PAGE_SIZE, chartAtRows, chartRowIndexes } from './chart-scaling.js'
const count = new Intl.NumberFormat()

export function ChartViewport({ plan, children }: { plan: AutoChartPlan, children: (view: AutoChartPlan) => ReactNode }): ReactElement {
  const length = plan.labels.length, categorical = plan.kind === 'bar', pageSize = Math.max(4, Math.floor(480 / (30 + plan.series.length * 26)))
  const [range, setRange] = useState({ start: 0, end: categorical ? Math.min(pageSize, length) : length })
  const [from, setFrom] = useState('1'), [to, setTo] = useState(String(length)), [error, setError] = useState('')
  const start = Math.min(range.start, Math.max(0, length - 1)), end = Math.min(length, Math.max(start + 1, range.end))
  const indexes = useMemo(() => chartRowIndexes(plan, start, end), [plan, start, end])
  const view = useMemo(() => chartAtRows(plan, indexes), [plan, indexes])
  const sampled = indexes.length < end - start
  const controls = categorical ? length > pageSize && h('div', { className: 'iexp-data-controls' },
    h(ThemeButton, { type: 'button', disabled: start === 0, onClick: () => { const next = Math.max(0, start - pageSize); setRange({ start: next, end: Math.min(length, next + pageSize) }) } }, '上一组'),
    h('span', { role: 'status' }, `第 ${count.format(start + 1)}–${count.format(end)} 项 / 共 ${count.format(length)} 项；按原表顺序分组，无排名筛选。`),
    h(ThemeButton, { type: 'button', disabled: end >= length, onClick: () => setRange({ start: end, end: Math.min(length, end + pageSize) }) }, '下一组')) : length > 800 && h('form', { className: 'iexp-data-controls', onSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const first = Number(from), last = Number(to)
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > length || first > last) { setError(`请输入 1–${count.format(length)} 内的有效起止行。`); return }
      setError(''); setRange({ start: first - 1, end: last })
    } },
    h('label', null, '起始项 ', h(ThemeInput, { type: 'number', min: 1, max: length, value: from, onChange: event => setFrom(event.currentTarget.value) })),
    h('label', null, '结束项 ', h(ThemeInput, { type: 'number', min: 1, max: length, value: to, onChange: event => setTo(event.currentTarget.value) })),
    h(ThemeButton, { type: 'submit' }, '查看范围'),
    h(ThemeButton, { type: 'button', disabled: start === 0 && end === length, onClick: () => { setRange({ start: 0, end: length }); setFrom('1'); setTo(String(length)); setError('') } }, '查看全序列'))
  return h('div', { className: 'iexp-chart-viewport', 'data-source-count': length, 'data-rendered-count': indexes.length }, controls,
    error && h('p', { role: 'alert' }, error),
    sampled && h('p', { className: 'iexp-chart-resolution', role: 'status' }, `${count.format(end - start)} 项原始数据以 ${count.format(indexes.length)} 个原值点展示极值包络；保留各区间每个序列的最小、最大值和首尾，不求均值。缩小到 800 项以内可查看全部点；完整原值见数据表。`),
    children(view))
}

/** Large source data is mounted one page at a time, only after explicit disclosure. */
export function ChartDataTable({ plan, inline = false }: { plan: AutoChartPlan, inline?: boolean }): ReactElement {
  const [open, setOpen] = useState(inline), [page, setPage] = useState(0), [target, setTarget] = useState('1'), [error, setError] = useState('')
  const length = plan.labels.length, pages = Math.ceil(length / SOURCE_PAGE_SIZE), current = Math.min(page, pages - 1), start = current * SOURCE_PAGE_SIZE
  const table = open && h('div', { className: 'iexp-source-page', tabIndex: 0, role: 'region', 'aria-label': '图表选取的原始数据' },
    pages > 1 && h('form', { className: 'iexp-data-controls', onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const next = Number(target); if (!Number.isInteger(next) || next < 1 || next > pages) { setError(`页码应为 1–${count.format(pages)}。`); return } setError(''); setPage(next - 1) } },
      h(ThemeButton, { type: 'button', disabled: current === 0, onClick: () => { setPage(current - 1); setTarget(String(current)) } }, '上一页数据'),
      h('span', { role: 'status' }, `第 ${count.format(start + 1)}–${count.format(Math.min(length, start + SOURCE_PAGE_SIZE))} 项 / 共 ${count.format(length)} 项`),
      h(ThemeButton, { type: 'button', disabled: current + 1 >= pages, onClick: () => { setPage(current + 1); setTarget(String(current + 2)) } }, '下一页数据'),
      h('label', null, '数据页 ', h(ThemeInput, { type: 'number', min: 1, max: pages, value: target, onChange: event => setTarget(event.currentTarget.value) })), h(ThemeButton, { type: 'submit' }, '跳转数据页')),
    error && h('p', { role: 'alert' }, error),
    h(TableViewport, {label:'图表数据表格'},h('table', null, h('thead', null, h('tr', null, h('th', { scope: 'col' }, '原表项目'), ...plan.series.map((series, i) => h('th', { key: i, scope: 'col' }, series.name, series.unit && `（${series.unit}）`)))),
      h('tbody', null, ...plan.labels.slice(start, start + SOURCE_PAGE_SIZE).map((label, index) => { const row = start + index; return h('tr', { key: row, 'data-source-row': plan.sourceRows?.[row] ?? row }, h('th', { scope: 'row' }, label), ...plan.series.map((series, column) => h('td', { key: column }, series.originals?.[row] ?? String(series.values[row])))) })))))
  return inline ? h('div', null, table) : h('details', { className: 'iexp-disclosure', onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setOpen(event.currentTarget.open) }, h('summary', null, '图表所用原始数据'), table)
}

export const chartViewportCss = `
.dsh-experience .iexp-data-controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:8px 0 12px; font-size:var(--iexp-meta-size,13px); }
.dsh-experience .iexp-data-controls label { display:inline-flex; gap:4px; align-items:center; }
.dsh-experience .iexp-data-controls input { width:10ch; min-width:80px; padding-inline:8px; }
.dsh-experience .iexp-chart-resolution { color:var(--iexp-muted); line-height:1.6; margin:8px 0; font-size:var(--iexp-meta-size,13px); }
.dsh-experience .iexp-source-page { overflow:auto; max-height:480px; }
.dsh-experience .iexp-source-page table { width:100%; border-collapse:collapse; }
.dsh-experience .iexp-source-page th,.dsh-experience .iexp-source-page td { text-align:start; font-weight:400; padding:8px; border-bottom:1px solid var(--iexp-line); }
.dsh-experience .iexp-source-page thead th { font-weight:600; }
`

/** Keeps Markdown source-cell anchors intact while bounding mounted table rows. */
export function PagedTableBody({ children }: { children?: ReactNode }): ReactElement {
  const rows = Children.toArray(children).filter(child => typeof child !== 'string' || child.trim())
  const [page, setPage] = useState(0), [draft, setDraft] = useState('1'), [error, setError] = useState('')
  const pages = Math.ceil(rows.length / SOURCE_PAGE_SIZE), current = Math.max(0, Math.min(page, pages - 1))
  const first = rows.find(child => isValidElement(child))
  const columns = isValidElement<{ children?: ReactNode }>(first) ? Math.max(1, Children.count(first.props.children)) : 1
  if (rows.length <= SOURCE_PAGE_SIZE) return h('tbody', null, children)
  const choose = (next: number) => { setPage(next); setDraft(String(next + 1)); setError('') }
  return h('tbody', null,
    h('tr', { className: 'iexp-source-pagination' }, h('td', { colSpan: columns }, h('div', { className: 'iexp-data-controls' },
      h(ThemeButton, { type: 'button', disabled: current === 0, onClick: () => choose(current - 1) }, '上一页原表'),
      h('span', { role: 'status' }, `原表第 ${count.format(current * SOURCE_PAGE_SIZE + 1)}–${count.format(Math.min(rows.length, (current + 1) * SOURCE_PAGE_SIZE))} 行 / 共 ${count.format(rows.length)} 行`),
      h(ThemeButton, { type: 'button', disabled: current + 1 === pages, onClick: () => choose(current + 1) }, '下一页原表'),
      h('label', null, '原表页 ', h(ThemeInput, { type: 'number', min: 1, max: pages, value: draft, onChange: event => setDraft(event.currentTarget.value) })),
      h(ThemeButton, { type: 'button', onClick: () => { const next = Number(draft); if (!Number.isInteger(next) || next < 1 || next > pages) { setError(`页码应为 1–${count.format(pages)}。`); return } choose(next - 1) } }, '跳转原表页')), error && h('p', { role: 'alert' }, error))),
    rows.slice(current * SOURCE_PAGE_SIZE, (current + 1) * SOURCE_PAGE_SIZE))
}
