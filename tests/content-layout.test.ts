import { describe, expect, it } from 'vitest'
import { analyzeGraph, analyzeMasterDetail, analyzeTaskRecords, analyzeTaskTable, parseMarkdownLayouts } from '../src/content-layout.js'

describe('source-derived layout plans', () => {
  it('keeps UTF-16 source offsets and complete originals for explicit arrow sequences', () => {
    const source = '开场 🌞\n\n准备 → 验证 -> 保存\n\n后记。'
    const [flow] = parseMarkdownLayouts(source).flows
    expect(flow).toMatchObject({ kind: 'flow', relationship: 'sequence', sourceKind: 'arrow-chain', original: '准备 → 验证 -> 保存' })
    expect(flow?.steps.map(step => step.text)).toEqual(['准备', '验证', '保存'])
    expect(source.slice(flow!.start, flow!.end)).toBe(flow!.original)
    for (const step of flow!.steps) expect(source.slice(step.start, step.end)).toBe(step.original)
  })
  it('uses AST ordered lists as sequences without claiming causal or dependency edges', () => {
    const source = '## 操作步骤\n\n3. 完整读取原文\n4. 检查结果\n5. 保存记录\n\n下一段。'
    const [flow] = parseMarkdownLayouts(source).flows
    expect(flow?.sourceKind).toBe('ordered-list')
    expect(flow?.relationship).toBe('sequence')
    expect(flow?.original).toBe('3. 完整读取原文\n4. 检查结果\n5. 保存记录')
    expect(flow?.steps.map(step => step.text)).toEqual(['完整读取原文', '检查结果', '保存记录'])
    for (const step of flow!.steps) expect(source.slice(step.start, step.end)).toBe(step.original)
  })
  it('requires explicit process context rather than treating numbered findings as transitions', () => {
    expect(parseMarkdownLayouts('## 六项关键信息缺口\n\n1. 收入的定义\n2. 成本的范围\n3. 数据的来源').flows).toEqual([])
    expect(parseMarkdownLayouts('1. 第一观点\n2. 第二观点').flows).toEqual([])
    expect(parseMarkdownLayouts('按以下步骤操作：\n\n1. 读取原文\n2. 保存结果').flows).toHaveLength(1)
    expect(parseMarkdownLayouts('## Workflow\n\n1. Read\n2. Verify').flows).toHaveLength(1)
    expect(parseMarkdownLayouts('## 步骤\n\n说明。\n\n## 风险\n\n1. 数据不足\n2. 来源缺失').flows).toEqual([])
  })
  it.each([
    '```md\nA -> B\n\n1. A\n2. B\n```',
    '`A -> B`',
    'A \\-> B',
    'A \\→ B',
    '\\`A -> B\\`',
    '> A -> B',
    '| 名称 | 数值 |\n|---|---|\n|A|20|\n|B|30|',
    'A 与 B 有关。C 是另一个主题。',
    '- A\n- B',
    '1. A\n   - 限定条件\n2. B',
    '1. A\n\n   第二段属于 A。\n\n2. B',
    'A -> ',
  ])('keeps unsupported, escaped, code and non-sequential content as its source: %s', source => {
    expect(parseMarkdownLayouts(source).flows).toEqual([])
  })
  it('enforces sequence bounds without truncation', () => {
    expect(parseMarkdownLayouts('one').flows).toEqual([])
    expect(parseMarkdownLayouts('## Steps\n\n' + Array.from({ length: 12 }, (_, index) => `${index + 1}. Step ${index}`).join('\n')).flows).toHaveLength(1)
    expect(parseMarkdownLayouts('## Steps\n\n' + Array.from({ length: 13 }, (_, index) => `${index + 1}. Step ${index}`).join('\n')).flows).toEqual([])
    expect(parseMarkdownLayouts(Array.from({ length: 13 }, (_, index) => String(index)).join(' → ')).flows).toEqual([])
    expect(parseMarkdownLayouts('x'.repeat(500_001)).flows).toEqual([])
  })
  it('builds a complete heading hierarchy with exact headings and source locations', () => {
    const source = '# Report\n\n## 第一章\n\n### 子节一\n\n### 子节二\n\n## 第二章\n\n### 子节三'
    const outline = parseMarkdownLayouts(source).outline!
    expect(outline.entries.map(entry => [entry.text, entry.depth, entry.parent])).toEqual([
      ['第一章', 2, undefined], ['子节一', 3, 0], ['子节二', 3, 0], ['第二章', 2, undefined], ['子节三', 3, 3],
    ])
    for (const entry of outline.entries) expect(source.slice(entry.start, entry.end)).toBe(entry.original)
  })
  it('retains full long outlines while excluding code, quoted headings and undersized indexes', () => {
    expect(parseMarkdownLayouts('## One\n\n### Two\n\n## Three').outline).toBeUndefined()
    expect(parseMarkdownLayouts('```\n## One\n## Two\n## Three\n## Four\n```\n\n> ## Quoted').outline).toBeUndefined()
    const source = Array.from({ length: 20 }, (_, index) => `## Section ${index}`).join('\n\n')
    expect(parseMarkdownLayouts(source).outline?.entries).toHaveLength(20)
    expect(parseMarkdownLayouts(source).outline?.entries.at(-1)?.text).toBe('Section 19')
  })
})

describe('canonical explicit graph validation', () => {
  const graph = { nodes: [{ id: 'a', label: '原文 A', description: '<script>literal text</script>' }, { id: 'b', label: ' B ' }], edges: [{ source: 'a', target: 'b', label: '原文关系' }, { source: 'b', target: 'a' }] }
  it('preserves source values, direction and cycles without adding inferred edges', () => {
    expect(analyzeGraph(graph)).toEqual({ status: 'valid', plan: { kind: 'graph', ...graph } })
    expect(analyzeGraph({ nodes: [{ id: 'constructor', label: 'literal ID' }, { id: '__proto__', label: 'another ID' }], edges: [{ source: 'constructor', target: '__proto__' }] }).status).toBe('valid')
  })
  it.each([
    { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Duplicate' }], edges: [] },
    { nodes: [{ id: 'a', label: 'A' }], edges: [{ source: 'a', target: 'missing' }] },
    { nodes: [{ id: 'a', label: 'A' }], edges: [{ source: 'missing', target: 'a' }] },
    { nodes: [{ id: 1, label: 'A' }], edges: [] },
    { nodes: [{ id: 'a', label: '' }], edges: [] },
    { nodes: [{ id: 'a', label: 'A', onclick: 'alert(1)' }], edges: [] },
    { nodes: [{ id: 'a', label: 'A' }], edges: [], html: '<script>untrusted</script>' },
    { nodes: [], edges: [] },
    { nodes: [{ id: 'a', label: 'A' }] },
    JSON.parse('{"nodes":[{"id":"a","label":"A"}],"edges":[],"__proto__":{"polluted":true}}'),
  ])('returns a named error for recognized invalid graphs: %j', value => {
    const result = analyzeGraph(value)
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.error).toMatchObject({ name: 'InvalidGraphPayload', message: expect.any(String) })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it.each([
    { nodes: Array.from({ length: 41 }, (_, index) => ({ id: String(index), label: String(index) })), edges: [] },
    { nodes: [{ id: 'a', label: 'A' }], edges: Array.from({ length: 101 }, () => ({ source: 'a', target: 'a' })) },
  ])('preserves graphs beyond the former tiny limits: %j', value => {
    const result = analyzeGraph(value)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') { expect(result.plan.nodes).toEqual(value.nodes); expect(result.plan.edges).toEqual(value.edges) }
  })
  it('does not reinterpret prose, numeric tables or unrelated records as graphs', () => {
    for (const value of ['A causes B', null, [{ name: 'A', value: 20 }], { title: 'ordinary record' }]) expect(analyzeGraph(value)).toEqual({ status: 'unrecognized' })
  })
})

describe('read-only task and detail layouts', () => {
  it('retains unknown statuses and whitespace verbatim, with stable first-occurrence grouping', () => {
    const records = [{ id: 'secret-1', title: '检查', status: '等待外部 🟠', description: '保留原文' }, { id: 'secret-2', title: '保存', status: ' done ', description: '不改写' }, { id: 'secret-3', title: '重试', status: '等待外部 🟠', description: '不归一化' }]
    const plan = analyzeTaskRecords(records)!
    expect(plan.readonly).toBe(true)
    expect(plan.groups.map(group => group.status)).toEqual(['等待外部 🟠', ' done '])
    expect(plan.groups[0]?.items.map(item => item.title)).toEqual(['检查', '重试'])
    expect(plan.groups[0]?.items[0]).toEqual({ title: '检查', description: '保留原文', record: records[0] })
    expect(plan.groups[0]?.items[0]?.record).toBe(records[0])
    expect(plan.records).toBe(records)
    expect(plan.records.map(record => record.title)).toEqual(['检查', '保存', '重试'])
  })
  it('keeps original task table cells and source row indexes for grouped source access', () => {
    const headers = ['任务名称', '状态', '编号', '说明'], rows = [['部署', '待验证', 'internal-A', '按原条件'], ['确认', '自定义', 'internal-B', '检查失败条件'], ['复核', '待验证', 'internal-C', '另一次检查']]
    const plan = analyzeTaskTable(headers, rows)!
    expect(plan.headers).toEqual(headers)
    expect(plan.groups[0]?.items.map(item => item.sourceRow)).toEqual([0, 2])
    expect(plan.groups[0]?.items[1]?.cells).toEqual(rows[2])
    expect(plan.groups[0]?.items[0]?.title).toBe('部署')
    expect(plan.records.map(record => record['任务名称'])).toEqual(['部署', '确认', '复核'])
    expect(plan.records.map(record => record['状态'])).toEqual(['待验证', '自定义', '待验证'])
  })
  it('requires explicit tasks for tables and avoids financial status records', () => {
    expect(analyzeTaskTable(['公司名称', '状态', '收入'], [['A', '上市', '10'], ['B', '私有', '20']])).toBeUndefined()
    expect(analyzeTaskTable(['名称', '状态'], [['A', '上市'], ['B', '私有']])).toBeUndefined()
    expect(analyzeTaskRecords([{ name: 'A', status: 'paid', amount: 10 }, { name: 'B', status: 'unpaid', amount: 20 }])).toBeUndefined()
    expect(analyzeTaskRecords([{ taskName: '核对财务', status: '进行中', amount: 10 }, { taskName: '确认账单', status: '待检查', amount: 20 }])).toBeDefined()
  })
  it('keeps 102 interleaved tasks and table rows within the existing 200-record source limit', () => {
    const records = Array.from({ length: 102 }, (_, index) => ({ id: `source-${index}`, taskName: `原始任务 ${index}`, status: index % 2 ? '等待实际回执' : '来源自定义状态' }))
    records[73]!.taskName = '完整参数化用例名'.repeat(370) + '末' // 2961 UTF-16 code units, matching observed long task names.
    expect(records[73]!.taskName).toHaveLength(2961)
    const plan = analyzeTaskRecords(records)!
    expect(plan.records).toBe(records)
    expect(plan.records.map(record => record.taskName)).toEqual(records.map(record => record.taskName))
    expect(plan.groups.map(group => group.status)).toEqual(['来源自定义状态', '等待实际回执'])
    expect(plan.groups.map(group => group.items.length)).toEqual([51, 51])
    expect(plan.groups.flatMap(group => group.items)).toHaveLength(102)
    expect(plan.groups[1]!.items.find(item => item.record === records[73])?.title).toBe(records[73]!.taskName)
    expect(plan.records[73]!.taskName).toBe(records[73]!.taskName)
    const rows = records.map(record => [record.taskName, record.status, record.id])
    const table = analyzeTaskTable(['任务名称', '状态', '编号'], rows)!
    expect(table.records.map(record => record['任务名称'])).toEqual(rows.map(row => row[0]))
    expect(table.groups[0]!.items.at(-1)?.sourceRow).toBe(100)
    expect(table.groups[1]!.items.at(-1)?.sourceRow).toBe(101)
    expect(table.groups[1]!.items.at(-1)?.cells).toEqual(rows[101])
    expect(table.groups[1]!.items.find(item => item.sourceRow === 73)?.title).toBe(records[73]!.taskName)
    const overLimit = Array.from({ length: 201 }, (_, index) => ({ taskName: `任务 ${index}`, status: '来源状态' }))
    expect(analyzeTaskRecords(overLimit)).toBeUndefined()
    expect(analyzeTaskTable(['任务', '状态'], overLimit.map(record => [record.taskName, record.status]))).toBeUndefined()
  })
  it('falls back for task titles exceeding 10000 characters without truncating or filtering the source', () => {
    const records = [{ taskName: '原始任务', status: '来源状态' }, { taskName: 'x'.repeat(10_000), status: '来源状态' }]
    expect(analyzeTaskRecords(records)?.records[1]!.taskName).toBe(records[1]!.taskName)
    records[1]!.taskName += 'x'
    expect(analyzeTaskRecords(records)).toBeUndefined()
    expect(analyzeTaskTable(['任务', '状态'], records.map(record => [record.taskName, record.status]))).toBeUndefined()
    expect(records[1]!.taskName).toHaveLength(10_001)
  })
  it('rejects heterogeneous or missing statuses without silently dropping rows', () => {
    expect(analyzeTaskRecords([{ title: 'A', status: 'done' }, { title: 'B' }])).toBeUndefined()
    expect(analyzeTaskRecords([{ title: 'A', status: 'done' }, { title: 'B', status: 1 }])).toBeUndefined()
    expect(analyzeTaskRecords([{ title: 'A', status: 'done' }, { title: 'B', status: '' }])).toBeUndefined()
    expect(analyzeTaskTable(['任务', '状态'], [['A', 'done'], ['B']])).toBeUndefined()
  })
  it('offers master/detail only for homogeneous named records with substantial existing descriptions', () => {
    const records = [{ name: '第一项', description: '保持原本的详细论证和条件。'.repeat(10), id: 'private-A' }, { name: '第二项', description: '第二项有独立的详细内容与限制。'.repeat(10), id: 'private-B' }]
    expect(analyzeMasterDetail(records)).toEqual({ kind: 'master-detail', items: records.map(record => ({ title: record.name, description: record.description, record })) })
    expect(analyzeMasterDetail([{ name: 'A', description: 'short' }, { name: 'B', description: 'short' }])).toBeUndefined()
    expect(analyzeMasterDetail([{ name: 'A', value: 10 }, { name: 'B', value: 20 }])).toBeUndefined()
    expect(analyzeMasterDetail([records[0], { name: 'B' }])).toBeUndefined()
  })
})
