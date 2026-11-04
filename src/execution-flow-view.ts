import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { FlowView } from './flow-view.js'
import type { ExecutionEvent, ExecutionPlan } from './execution-flow.js'
import { ThemeButton } from './theme-components.js'

const EVENT_PAGE_SIZE = 8
const format = new Intl.NumberFormat('zh-CN')
type Anchor = { id: string, index: number }

/** Bounded source-order log: following stops as soon as a reader inspects a page. */
function ExecutionEvents({ events, labels }: { events: readonly ExecutionEvent[], labels: ReadonlyMap<string, string> }): ReactElement {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const latestStart = Math.max(0, events.length - EVENT_PAGE_SIZE)
  const located = anchor ? events.findIndex(event => event.id === anchor.id) : -1
  const start = anchor ? Math.min(latestStart, Math.max(0, located < 0 ? anchor.index : located)) : latestStart
  const end = Math.min(events.length, start + EVENT_PAGE_SIZE)
  const freeze = () => {
    const current = events[start]
    if (current) setAnchor(previous => previous ?? { id: current.id, index: start })
  }
  const move = (index: number) => {
    const target = Math.max(0, Math.min(latestStart, index))
    const event = events[target]
    if (event) setAnchor({ id: event.id, index: target })
  }

  // Scrolling is permitted only while following the most recent source page.
  // Earlier pages or text inspection are never pulled away by a new snapshot.
  useEffect(() => {
    if (anchor || !log.current) return
    log.current.scrollTop = log.current.scrollHeight
  }, [anchor, events])

  return h('section', { 'aria-label': '来源事件', style: { marginTop: 12, minWidth: 0, padding: 12, border: '1px solid var(--iexp-line)', borderRadius: 'var(--iexp-card-radius)', background: 'var(--iexp-soft)' } },
    h('h3', { style: { margin: '0 0 8px', fontSize: 14 } }, '来源事件'),
    events.length === 0 ? h('p', { style: { margin: 0, color: 'var(--iexp-muted)', fontSize: 12 } }, '暂无来源事件。') : h('div', null,
      h('div', { ref: log, 'data-execution-log': true, tabIndex: 0, 'aria-label': '来源事件列表',
        style: { maxHeight: 200, overflowY: 'auto', minWidth: 0 },
        onPointerDownCapture: freeze, onFocusCapture: freeze,
        onScroll: (event: { currentTarget: HTMLDivElement }) => {
          const element = event.currentTarget
          if (element.scrollHeight - element.scrollTop - element.clientHeight > 8) freeze()
        },
      }, h('ol', { start: start + 1, style: { display: 'grid', gap: 6, listStyle: 'none', margin: 0, padding: 0 } },
        ...events.slice(start, end).map(event => h('li', { key: event.id, style: { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', fontSize: 12, lineHeight: 1.55, minWidth: 0 } },
          event.timestamp !== undefined && h('time', { dateTime: event.timestamp, style: { color: 'var(--iexp-muted)' } }, event.timestamp),
          event.nodeId !== undefined && h('strong', { style: { color: 'var(--iexp-accent)' } }, labels.get(event.nodeId) ?? event.nodeId),
          h('span', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 } }, event.message))))),
      h('div', { className: 'iexp-flow-toolbar', style: { marginTop: 8, gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { color: 'var(--iexp-muted)', fontSize: 12 } }, `来源顺序 ${format.format(start + 1)}–${format.format(end)} / ${format.format(events.length)}`),
        events.length > EVENT_PAGE_SIZE && h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: start === 0, onClick: () => move(start - EVENT_PAGE_SIZE) }, '上一页事件'),
        events.length > EVENT_PAGE_SIZE && h(ThemeButton, { renderRole: 'flow', type: 'button', disabled: end >= events.length, onClick: () => move(start + EVENT_PAGE_SIZE) }, '下一页事件'),
        anchor && h(ThemeButton, { renderRole: 'flow', type: 'button', onClick: () => setAnchor(null) }, '查看最新事件'))))
}

/** Renders only fields supplied by the producer; the caller owns the exact source text. */
export function ExecutionFlowView({ plan, sourceText }: { plan: ExecutionPlan, sourceText?: string }): ReactElement {
  const labels = useMemo(() => new Map(plan.nodes.map(node => [node.id, node.label])), [plan.nodes])
  const graph = useMemo(() => ({
    title: plan.title ?? '执行快照',
    nodes: plan.nodes.map(node => ({ id: node.id, label: node.label, ...(node.description === undefined ? {} : { description: node.description }), execution: node })),
    edges: plan.edges.map(edge => ({ source: edge.source, target: edge.target, ...(edge.label === undefined ? {} : { label: edge.label }), ...(edge.status === undefined ? {} : { executionStatus: edge.status }) })),
    direction: 'DOWN' as const,
    execution: true as const,
    ...(sourceText === undefined ? {} : { sourceText }),
  }), [plan.title, plan.nodes, plan.edges, sourceText])
  return h('section', { 'aria-label': '执行流程快照', 'data-execution-flow': true },
    h('p', { className: 'iexp-flow-help', style: { margin: '0 0 8px' } }, '执行快照，依据来源提供的信息展示。',
      plan.updatedAt !== undefined && h('span', null, ' 来源更新时间：', h('time', { dateTime: plan.updatedAt }, plan.updatedAt))),
    h(FlowView, { plan: graph }),
    h(ExecutionEvents, { events: plan.events, labels }))
}
