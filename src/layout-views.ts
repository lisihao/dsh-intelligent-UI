import { createElement as h, useState, type ReactElement } from 'react'
import { IconWrapper } from '@openuidev/react-ui'
import type { BoardItem, BoardPlan, HeadingIndexPlan, MasterDetailPlan } from './content-layout.js'

function SourceRecords({ records }: { records: unknown }): ReactElement {
  return h('details', { className: 'iexp-layout-source' }, h('summary', null, h(IconWrapper, { name: 'database', size: 15 }), '查看完整原始记录'), h('pre', null, JSON.stringify(records, null, 2)))
}

/** A board groups the exact source status. Selecting a card never changes the task. */
export function BoardView({ plan }: { plan: BoardPlan }): ReactElement {
  const count = plan.records.length
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase('en-US')
  const groups = plan.groups.map(group => ({ ...group, items: group.items.filter(item => !needle || [item.title, item.description, group.status].join(' ').toLocaleLowerCase('en-US').includes(needle)) }))
  const matched = groups.reduce((sum, group) => sum + group.items.length, 0)
  const columns = groups.map((group, index) => h('section', { key: index, className: 'iexp-board-column', 'aria-label': `状态：${group.status}` },
    h('h4', null, group.status, h('span', null, String(group.items.length))),
    ...group.items.map((item, row) => h('article', { key: row, className: 'iexp-task' }, item.title.length > 160 ? h('details', { className: 'iexp-task-long-title' }, h('summary', { 'aria-label': '展开或收起完整任务标题' }, h('h5', null, item.title))) : h('h5', null, item.title), item.description && h('p', null, item.description)))))
  return h('section', { className: 'iexp-board', 'data-content-layout': 'board', 'aria-label': '按原始状态分组的任务看板' },
    h('div', { className: 'iexp-layout-head' }, h('h3', null, h(IconWrapper, { name: 'columns-3', size: 18 }), '任务看板'), h('span', null, `${needle ? `${matched} / ` : ''}${count} 项任务 · 按原始状态分组`)),
    h('input', { type: 'search', className: 'iexp-board-search', 'aria-label': '搜索任务', placeholder: '搜索任务、说明或状态', value: query, onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value) }),
    !matched && h('p', { role: 'status', className: 'iexp-board-empty' }, '没有匹配的任务，清空搜索可查看全部记录。'),
    h('div', { className: 'iexp-board-columns', tabIndex: 0, role: 'region', 'aria-label': '任务分组，窄屏可横向滚动' }, ...columns),
    h(SourceRecords, { records: plan.records }))
}

const internalKey = /^(?:id|uuid|sessionId|providerId|internalId)$/i
function DetailFields({ item }: { item: BoardItem }): ReactElement {
  const fields = Object.entries(item.record).filter(([key, value]) => !internalKey.test(key) && value !== item.title && value !== item.description)
  return h('dl', { className: 'iexp-record-fields' }, ...fields.flatMap(([key, value]) => [h('dt', { key: `${key}-label` }, key), h('dd', { key }, typeof value === 'string' ? value : JSON.stringify(value))]))
}

/** Long named records share one detail region instead of repeating identical cards. */
export function MasterDetailView({ plan }: { plan: MasterDetailPlan }): ReactElement {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, plan.items.length - 1), item = plan.items[index]!
  return h('section', { className: 'iexp-master-detail', 'data-content-layout': 'master-detail', 'aria-label': '对象列表与详情' },
    h('div', { className: 'iexp-object-list', 'aria-label': '选择对象' }, ...plan.items.map((entry, i) => h('button', { key: i, type: 'button', onClick: () => setSelected(i), 'aria-pressed': i === index }, h('strong', null, entry.title), h('span', null, entry.description)))),
    h('div', { className: 'iexp-object-detail', 'aria-live': 'polite' }, h('h3', null, item.title), h('p', { className: 'iexp-object-description' }, item.description), h(DetailFields, { item }), h(SourceRecords, { records: item.record })))
}

export function headingAnchor(prefix: string, start: number): string { return `${prefix}-heading-${start}` }

/** A real document index: navigation follows source headings, never inferred dependencies. */
export function HeadingIndex({ plan, prefix }: { plan: HeadingIndexPlan, prefix: string }): ReactElement {
  const roots = plan.entries.filter(entry => entry.depth === 2)
  const radial = roots.length >= 4 && roots.length <= 7 && roots.every(entry => Array.from(entry.text).reduce((width, char) => width + (/[^\u0000-\u00ff]/u.test(char) ? 2 : 1), 0) <= 24)
  const go = (id: string) => { const target = document.getElementById(id); target?.scrollIntoView({ block: 'start', behavior: 'auto' }); target?.focus({ preventScroll: true }) }
  // A bounded chapter overview needs only source spokes, not an execution canvas.
  const fan = radial ? h('svg', { className: 'iexp-chapter-fan', viewBox: '0 0 880 380', role: 'img', 'aria-label': '章节与子标题数量概览；下方提供完整文字目录' },
    ...roots.map((entry, i) => {
      const angle = Math.PI + .15 + i * (Math.PI - .3) / (roots.length - 1)
      const x = 440 + Math.cos(angle) * 250, y = 330 + Math.sin(angle) * 230
      const parent = plan.entries.indexOf(entry), count = plan.entries.filter(child => child.parent === parent).length
      const anchor = x < 420 ? 'end' : x > 460 ? 'start' : 'middle'
      const textX = x + (anchor === 'end' ? -20 : anchor === 'start' ? 20 : 0)
      const textY = anchor === 'middle' ? y - 24 : y + 5
      return h('g', { key: entry.start }, h('path', { d: `M440 330 Q${(440 + x) / 2} ${330 + (y - 330) * .4} ${x} ${y}` }),
        h('a', { href: `#${headingAnchor(prefix, entry.start)}`, 'aria-label': `${entry.text}${count ? `，${count}个子标题` : ''}`, onClick: (event: { preventDefault(): void }) => { event.preventDefault(); go(headingAnchor(prefix, entry.start)) } },
          h('title', null, entry.text), h('circle', { cx: x, cy: y, r: count ? 12 : 5 }),
          count > 0 && h('text', { x, y: y + 4, textAnchor: 'middle', className: 'iexp-chapter-count' }, String(count)),
          h('text', { x: textX, y: textY, textAnchor: anchor }, entry.text)))
    }), h('circle', { cx: 440, cy: 330, r: 4, className: 'iexp-chapter-root' })) : undefined
  return h('details', { className: 'iexp-heading-index', 'data-content-layout': 'heading-index' },
    h('summary', null, h(IconWrapper, { name: 'list-tree', size: 17 }), '章节导航', h('span', null, `${plan.entries.length} 个标题`)),
    fan,
    h('nav', { 'aria-label': '报告章节' }, h('ol', null, ...plan.entries.map(entry => h('li', { key: entry.start, className: entry.depth === 3 ? 'iexp-index-child' : undefined }, h('a', { href: `#${headingAnchor(prefix, entry.start)}`, onClick: (event: { preventDefault(): void }) => { event.preventDefault(); go(headingAnchor(prefix, entry.start)) } }, entry.text))))))
}

export const layoutViewCss = `
.dsh-experience :is(.iexp-board,.iexp-master-detail,.iexp-heading-index) { margin-block: calc(20px * var(--iexp-density)); min-width: 0; }
.dsh-experience .iexp-layout-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.dsh-experience .iexp-layout-head h3 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 18px; font-weight: 500; }
.dsh-experience .iexp-layout-head > span { color: var(--iexp-muted); font-size: 12px; }
.dsh-experience .iexp-board-search { width: 100%; min-height: 40px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--iexp-line); border-radius: var(--iexp-small-control-radius); color: var(--iexp-text); background: var(--iexp-soft); font: inherit; font-size: 13px; }
.dsh-experience .iexp-board-search::placeholder { color: var(--iexp-muted); }
.dsh-experience .iexp-board-empty { color: var(--iexp-muted); font-size: 13px; }
.dsh-experience .iexp-board-columns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px,1fr); gap: 12px; overflow-x: auto; padding-bottom: 12px; }
.dsh-experience .iexp-board-column { min-width: 0; background: var(--iexp-soft); border-radius: var(--iexp-card-radius); padding: 12px; max-height: 640px; overflow-y: auto; }
.dsh-experience .iexp-board-column > h4 { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 14px; font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.dsh-experience .iexp-board-column > h4 > span { color: var(--iexp-muted); font-variant-numeric: tabular-nums; }
.dsh-experience .iexp-task { margin-top: 8px; padding: calc(10px * var(--iexp-density)) 12px; background: var(--iexp-card); border: 1px solid var(--iexp-line); border-radius: var(--iexp-card-radius); overflow-wrap: anywhere; }
.dsh-experience .iexp-task > h5 { margin: 0; font-size: 14px; font-weight: 500; line-height: 1.6; }
.dsh-experience .iexp-task-long-title > summary { align-items: start; }
.dsh-experience .iexp-task-long-title h5 { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font-size: 14px; font-weight: 500; line-height: 1.6; }
.dsh-experience .iexp-task-long-title[open] h5 { -webkit-line-clamp: unset; }
.dsh-experience .iexp-task > p { margin: 8px 0 0; color: var(--iexp-muted); font-size: 12px; line-height: 1.7; white-space: pre-wrap; }
.dsh-experience .iexp-layout-source { margin-top: 12px; font-size: 12px; }
.dsh-experience .iexp-layout-source pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto; margin-top: 12px; font-size: 12px; line-height: 1.7; }
.dsh-experience .iexp-master-detail { display: grid; grid-template-columns: minmax(180px, 26%) minmax(0,1fr); gap: calc(20px * var(--iexp-density)); align-items: start; }
.dsh-experience .iexp-object-list { min-width: 0; max-height: 480px; overflow: auto; border-inline-start: 1px solid var(--iexp-line); }
.dsh-experience .iexp-object-list button { display: block; width: 100%; text-align: start; font: inherit; color: var(--iexp-text); background: transparent; border: 0; border-radius: 0; padding: calc(10px * var(--iexp-density)) 12px; cursor: pointer; border-bottom: 1px solid var(--iexp-line); }
.dsh-experience .iexp-object-list button[aria-pressed=true] { background: var(--iexp-card); box-shadow: inset 1px 0 var(--iexp-accent); }
.dsh-experience .iexp-object-list button:hover { background: var(--iexp-soft); }
.dsh-experience .iexp-object-list strong { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.dsh-experience .iexp-object-list span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 6px; color: var(--iexp-muted); font-size: 12px; line-height: 1.7; }
.dsh-experience .iexp-object-detail { min-width: 0; }
.dsh-experience .iexp-object-detail h3 { font-size: 20px; font-weight: 400; margin: 0; overflow-wrap: anywhere; }
.dsh-experience .iexp-object-description { margin-top: 10px; max-width: 74ch; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-experience .iexp-record-fields { display: grid; grid-template-columns: minmax(80px, max-content) minmax(0,1fr); gap: 8px 18px; font-size: 13px; }
.dsh-experience .iexp-record-fields dt { color: var(--iexp-muted); overflow-wrap: anywhere; }
.dsh-experience .iexp-record-fields dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-experience .iexp-heading-index { padding-block: 12px; border-block: 1px solid var(--iexp-line); font-size: 13px; }
.dsh-experience .iexp-heading-index summary > span { color: var(--iexp-muted); font-size: 12px; }
.dsh-experience .iexp-chapter-fan { display: block; width: 100%; max-width: 900px; height: auto; margin-top: 8px; overflow: visible; }
.dsh-experience .iexp-chapter-fan path { fill: none; stroke: var(--iexp-line); stroke-width: 3; }
.dsh-experience .iexp-chapter-fan circle { fill: var(--iexp-card); stroke: var(--iexp-line); stroke-width: 1.5; }
.dsh-experience .iexp-chapter-fan text { font: 500 14px var(--iexp-font); fill: var(--iexp-text); }
.dsh-experience .iexp-chapter-fan .iexp-chapter-count { font-size: 11px; fill: var(--iexp-muted); }
.dsh-experience .iexp-chapter-fan .iexp-chapter-root { fill: var(--iexp-accent); }
.dsh-experience .iexp-chapter-fan a:hover :is(circle,text) { stroke: var(--iexp-accent); }
.dsh-experience .iexp-chapter-fan a:focus-visible { outline: none; }
.dsh-experience .iexp-chapter-fan a:focus-visible circle { stroke: var(--iexp-accent); stroke-width: 3; }
@media(max-width:760px) { .dsh-experience .iexp-chapter-fan { display: none; } }
.dsh-experience .iexp-heading-index nav ol { list-style: none; padding: 0; margin: 18px 0 6px; columns: 2 240px; column-gap: calc(20px * var(--iexp-density)); align-items: start; }
.dsh-experience .iexp-heading-index nav li { break-inside: avoid; padding: 6px 0; }
.dsh-experience .iexp-heading-index nav a { color: var(--iexp-text); text-decoration: none; line-height: 1.7; }
.dsh-experience .iexp-heading-index nav a:hover { color: var(--iexp-accent); text-decoration: underline; text-underline-offset: 4px; }
.dsh-experience .iexp-heading-index .iexp-index-child { padding-inline-start: 18px; font-size: 12px; color: var(--iexp-muted); }
@media(max-width:560px) { .dsh-experience .iexp-master-detail { grid-template-columns: minmax(0,1fr); gap: 16px; } .dsh-experience .iexp-object-list { display: flex; max-height: none; border-inline-start: 0; } .dsh-experience .iexp-object-list button { min-width: 170px; max-width: 220px; flex-shrink: 0; } }
`
