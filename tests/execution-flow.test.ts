import { describe, expect, it } from 'vitest'
import { analyzeExecutionFlow, type ExecutionPlan } from '../src/execution-flow.js'

function plan(value: unknown): ExecutionPlan {
  const result = analyzeExecutionFlow(value)
  expect(result.status).toBe('valid')
  if (result.status !== 'valid') throw new Error('Expected a valid execution plan')
  return result.plan
}
function invalid(value: unknown, message?: string): void {
  const result = analyzeExecutionFlow(value)
  expect(result.status).toBe('invalid')
  if (result.status === 'invalid') {
    expect(result.error.name).toBe('InvalidExecutionFlowPayload')
    expect(result.error.message.length).toBeGreaterThan(0)
    if (message) expect(result.error.message).toContain(message)
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) }
  return value
}
const minimal = { kind: 'execution-flow', nodes: [{ id: 'a', label: '读取来源' }], edges: [] }

describe('source-owned execution-flow projection', () => {
  it.each([
    undefined, null, 'running', [], { title: 'Plain prose' },
    { nodes: [{ id: 'a', label: 'Ordinary concept' }], edges: [] },
    { kind: 'graph', nodes: [{ id: 'a', label: 'A', role: 'lead', model: 'reported-model' }], edges: [] },
    { nodes: [{ id: 'a', label: 'Article', status: 'published' }], edges: [] },
    { nodes: [{ id: 'a', label: 'A' }], edges: [{ source: 'a', target: 'a', status: 'active' }] },
  ])('does not assign execution meaning to an ordinary graph or unrelated input: %j', value => {
    expect(analyzeExecutionFlow(value)).toEqual({ status: 'unrecognized' })
  })

  it('recognizes explicit kind without inventing absent node state or events', () => {
    const output = plan(minimal)
    expect(output).toEqual({ kind: 'execution-flow', nodes: [{ id: 'a', label: '读取来源' }], edges: [], events: [] })
    expect(output.nodes[0]).not.toHaveProperty('status'); expect(output.nodes[0]).not.toHaveProperty('progress')
    expect(output).not.toHaveProperty('updatedAt')
  })

  it.each([
    ['pending', 'queued'], ['queued', 'queued'], ['running', 'running'],
    ['done', 'succeeded'], ['completed', 'succeeded'], ['succeeded', 'succeeded'],
    ['error', 'failed'], ['failed', 'failed'], ['blocked', 'blocked'],
    ['canceled', 'cancelled'], ['cancelled', 'cancelled'], ['skipped', 'skipped'], [' RUNNING ', 'running'],
  ])('normalizes the literal source status %s to %s without changing the input', (status, canonical) => {
    const source = freeze({ nodes: [{ id: 'a', label: 'Source task', status }], edges: [] })
    expect(plan(source).nodes[0]?.status).toBe(canonical)
    expect(source.nodes[0]?.status).toBe(status)
  })

  it('retains source order, exact event text/timestamps, metrics and roles while excluding unknown view fields', () => {
    const source = freeze({
      kind: 'execution-flow', title: '来源执行快照', updatedAt: '2026-11-02T12:01:03+08:00', privateMetadata: { retainOnlyInRaw: true },
      nodes: [{ id: 'lead', label: '入口', role: 'lead', model: 'source-model', status: 'completed', description: ' 原文说明 ', unknownNodeData: ['not a UI field'] }, { id: 'worker', label: '并行工作', role: 'worker', status: 'running', progress: { current: 7, total: 12, unit: '原始行', extra: 'raw only' }, metrics: [{ label: '输入', value: '1,024', unit: 'tokens', extra: 'keep in raw' }, { label: '失败', value: 0 }], unknown: 17 }],
      edges: [{ source: 'lead', target: 'worker', status: 'done', label: '原始条件', edgeId: 'raw-edge' }, { source: 'worker', target: 'lead', status: 'active' }],
      events: [{ id: 'e2', message: ' 后出现但源序在前 ', nodeId: 'worker', timestamp: '2026-11-02T04:00:03Z', originalPayload: { x: 1 } }, { id: 'e1', message: '先前事件', timestamp: '2026-11-02T04:00:01.123Z' }],
    })
    const before = structuredClone(source), output = plan(source)
    expect(output.nodes.map(node => node.id)).toEqual(['lead', 'worker'])
    expect(output.edges).toEqual([{ source: 'lead', target: 'worker', status: 'done', label: '原始条件' }, { source: 'worker', target: 'lead', status: 'active' }])
    expect(output.events).toEqual([{ id: 'e2', message: ' 后出现但源序在前 ', nodeId: 'worker', timestamp: '2026-11-02T04:00:03Z' }, { id: 'e1', message: '先前事件', timestamp: '2026-11-02T04:00:01.123Z' }])
    expect(output.updatedAt).toBe(source.updatedAt)
    expect(output.nodes[0]).toMatchObject({ role: 'lead', model: 'source-model', description: ' 原文说明 ', status: 'succeeded' })
    expect(output.nodes[1]?.progress).toEqual({ current: 7, total: 12, unit: '原始行' })
    expect(output.nodes[1]?.metrics).toEqual([{ label: '输入', value: '1,024', unit: 'tokens' }, { label: '失败', value: 0 }])
    expect(output).not.toHaveProperty('privateMetadata'); expect(output.nodes[0]).not.toHaveProperty('unknownNodeData')
    expect(source).toEqual(before)
    expect(source.events[0]?.originalPayload).toEqual({ x: 1 })
    expect(source.nodes[0]?.status).toBe('completed')
  })

  it('recognizes explicit progress without a status, preserving zero/zero and fractional source values without a percentage', () => {
    const output = plan({ nodes: [{ id: 'zero', label: 'Unknown total work', progress: { current: 0, total: 0 } }, { id: 'fraction', label: 'Reported fraction', progress: { current: 0.25, total: 1, unit: 'source units' } }], edges: [] })
    expect(output.nodes[0]?.progress).toEqual({ current: 0, total: 0 })
    expect(output.nodes[1]?.progress).toEqual({ current: 0.25, total: 1, unit: 'source units' })
    expect(output.nodes.every(node => !('status' in node))).toBe(true)
    expect(JSON.stringify(output)).not.toContain('percent')
  })

  it.each([
    { current: 1 }, { total: 1 }, { current: -1, total: 3 }, { current: 1, total: -3 },
    { current: 4, total: 3 }, { current: 1, total: 0 }, { current: Number.NaN, total: 3 },
    { current: 0, total: Number.POSITIVE_INFINITY }, { current: '1', total: 3 }, null,
  ])('reports malformed source progress without estimating a missing total: %j', progress => {
    invalid({ nodes: [{ id: 'a', label: 'Task', progress }], edges: [] })
  })

  it.each([
    [{ ...minimal, nodes: [] }, undefined],
    [{ ...minimal, nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }, 'Duplicate node ID'],
    [{ ...minimal, edges: [{ source: 'a', target: 'missing' }] }, 'Unknown node ID'],
    [{ ...minimal, events: [{ id: 'e', message: 'First' }, { id: 'e', message: 'Duplicate' }] }, 'Duplicate event ID'],
    [{ ...minimal, events: [{ id: 'e', message: 'Source event', nodeId: 'missing' }] }, 'Unknown event node ID'],
    [{ ...minimal, nodes: [{ id: 'a', label: '' }] }, undefined],
    [{ ...minimal, nodes: [{ id: 'a', label: 'A', status: 'invented-status' }] }, 'Unsupported execution node status'],
    [{ ...minimal, nodes: [{ id: 'a', label: 'A', role: 'provider' }] }, undefined],
    [{ ...minimal, nodes: [{ id: 'a', label: 'A', metrics: [{ label: 'Cost', value: Number.POSITIVE_INFINITY }] }] }, undefined],
    [{ ...minimal, edges: [{ source: 'a', target: 'a', status: 'running' }] }, undefined],
    [{ ...minimal, events: [{ id: 'e', message: 'Source event', timestamp: '2026-11-02 12:00' }] }, undefined],
    [{ ...minimal, updatedAt: '2026-02-30T00:00:00Z' }, undefined],
    [{ ...minimal, updatedAt: '2026-11-02T12:00:00' }, undefined],
    [{ kind: 'execution-flow' }, undefined],
    [{ nodes: [{ id: 'a', label: 'A', status: 'running' }], edges: 'invalid edges' }, undefined],
  ] as Array<[unknown, string | undefined]>)('gives recognized invalid input a named error: %j', (value, expectedMessage) => invalid(value, expectedMessage))

  it('checks UTF-8 bytes of the whole source, including unknown raw-only fields', () => {
    invalid({ ...minimal, ignoredButRetainedRaw: '界'.repeat(350_000) }, '1 MiB')
  })

  it('surfaces non-JSON source errors rather than throwing or pretending the snapshot is valid', () => {
    const circular = { ...minimal, raw: {} }; circular.raw = circular
    invalid(circular, 'serializable JSON')
    invalid({ ...minimal, raw: BigInt(1) }, 'serializable JSON')
  })

  it('keeps valid graphs beyond tiny node/edge limits and retains exact source ordering', () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({ id: `n${index}`, label: `来源${index}`, status: 'queued' }))
    const edges = nodes.map((node, index) => ({ source: node.id, target: nodes[(index + 1) % nodes.length]!.id }))
    const source = { kind: 'execution-flow', nodes, edges }
    expect(new TextEncoder().encode(JSON.stringify(source)).byteLength).toBeLessThan(1024 * 1024)
    const output = plan(source)
    expect(output.nodes).toEqual(nodes); expect(output.edges).toEqual(edges); expect(output.events).toEqual([])
  })

  it('treats special-looking original IDs as literal values, not object keys or generated states', () => {
    const source = JSON.parse('{"kind":"execution-flow","__proto__":{"polluted":true},"nodes":[{"id":"__proto__","label":"A"},{"id":"constructor","label":"B"}],"edges":[{"source":"__proto__","target":"constructor"}]}')
    const output = plan(source)
    expect(output.nodes.map(node => node.id)).toEqual(['__proto__', 'constructor'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(source.__proto__).toEqual({ polluted: true })
  })
})
