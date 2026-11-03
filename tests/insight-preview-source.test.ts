import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { readInsightPreview } from '../src/insight-preview-source.js'
import { insightPreviewSnapshotSchema } from '../src/insight-preview-contracts.js'

const sessionId = 'session-insight-001'
const draftId = '123e4567-e89b-42d3-a456-426614174000'
const timestamp = '2026-11-02T12:03:00.000Z'
const analysis = '原始分析\n\n表格 | 32%（2025 年）\n来源 [1]'
const svg = '{"formatVersion":1,"type":"insight-svg","images":[{"id":"a","title":"图","svg":"<svg><text>原文</text></svg>"}]}'
const pptx = JSON.stringify({ formatVersion: 1, type: 'insight-pptx', fileName: '演示.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', base64: 'UEsDBA==', sha256: 'a'.repeat(64), width: 1280, height: 720, slideCount: 1, editableObjects: 1, images: [] })
const documentId = (runId: string, outputId: string) => `preview:${createHash('sha256').update(JSON.stringify([runId, outputId]), 'utf8').digest('hex')}`

function legacy(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'insight', runId: 'legacy-1', title: '已有研究', status: 'running', updatedAt: 1793620980000,
    stages: [
      { key: 'studio:legacy-1:analysis:review:1', label: '洞察分析', nodeId: 'analysis', status: 'completed', outputs: [{ label: '原文分析', text: analysis, citations: ['https://example.org/source'] }] },
      { key: 'studio:legacy-1:pptx:output:1', label: '生成演示文稿', nodeId: 'pptx', status: 'pending', outputs: [] },
    ],
    outputs: [], ...overrides,
  }
}
function legacySnapshot(tasks: unknown[] = [legacy()]) { return { formatVersion: 1, sessionId, readAt: 1, tasks, futureField: true } }
function workflow(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1, commandId: 'command-1', draftId, draftRevision: 1,
    graph: {
      formatVersion: 1, id: 'flow-1', sessionId, providerId: 'insight', title: '洞察流程', metadata: { flowDocument: { formatVersion: 1 } } as Record<string, unknown>,
      nodes: [{ id: 'analysis', label: '研究分析', kind: 'chatgpt-review' }, { id: 'svg', label: '信息图', kind: 'chatgpt-web' }, { id: 'pptx', label: '演示文稿', kind: 'svg-to-pptx' }],
    },
    run: {
      id: 'command-1', sessionId, providerId: 'insight', status: 'running', updatedAt: timestamp, output: undefined as string | undefined,
      nodes: [
        { nodeId: 'analysis', status: 'completed', output: analysis, observed: { provenance: { provider: 'chatgpt', citations: ['https://example.org/source'], limitations: ['尚未核实'] } } },
        { nodeId: 'svg', status: 'completed', output: svg },
        { nodeId: 'pptx', status: 'pending' },
      ],
    }, ...overrides,
  }
}
function workflowSnapshot(runs: unknown[] = [workflow()], sources: unknown[] = []) { return { sessionId, runs, sources, drafts: [], mode: {}, providers: [], futureField: 42 } }
const ports = (legacyValue: unknown = legacySnapshot(), workflowValue: unknown = workflowSnapshot()) => ({
  legacyStatus: vi.fn().mockResolvedValue(legacyValue), workflowOverview: vi.fn().mockResolvedValue(workflowValue),
})

describe('read-only Insight preview', () => {
  it('reads only the two owner-supplied methods and exposes completed source text before PPTX', async () => {
    const read = ports()
    const snapshot = await readInsightPreview(sessionId, read)
    expect(read.legacyStatus).toHaveBeenCalledOnce()
    expect(read.workflowOverview).toHaveBeenCalledOnce()
    expect(read.legacyStatus).toHaveBeenCalledWith({ sessionId })
    expect(read.workflowOverview).toHaveBeenCalledWith({ sessionId })
    expect(snapshot).toMatchObject({ formatVersion: 1, sessionId, available: true, warnings: [] })
    expect(snapshot.runs).toHaveLength(2)
    const old = snapshot.runs.find(run => run.source === 'legacy')!
    expect(old).toMatchObject({ sourceRunId: 'legacy-1', title: '已有研究', status: 'running', pptxState: 'unknown' })
    expect(Date.parse(old.updatedAt)).toBe(legacy().updatedAt)
    const outputId = JSON.stringify(['stage', 'studio:legacy-1:analysis:review:1', 0])
    expect(old.outputs).toEqual([{ id: outputId, documentId: documentId(old.id, outputId), label: '原文分析', text: analysis, status: 'completed', nodeId: 'analysis', citations: ['https://example.org/source'], stageKey: 'studio:legacy-1:analysis:review:1', location: 'stage' }])
    const modern = snapshot.runs.find(run => run.source === 'workflow')!
    expect(modern).toMatchObject({ sourceRunId: 'command-1', title: '洞察流程', status: 'running', updatedAt: timestamp, pptxState: 'pending' })
    expect(modern.outputs).toHaveLength(2)
    expect(modern.outputs[0]).toMatchObject({ label: '研究分析', text: analysis, nodeId: 'analysis', status: 'completed', location: 'node', observed: { provenance: { provider: 'chatgpt', citations: ['https://example.org/source'], limitations: ['尚未核实'] } } })
    expect(modern.outputs[1]).toMatchObject({ label: '信息图', text: svg, nodeId: 'svg', status: 'completed' })
    expect(modern.outputs.every(output => output.nodeId !== 'pptx')).toBe(true)
  })

  it('preserves empty strings and exact task/run-level output fields with no invented finality', async () => {
    const task = legacy({ outputs: [{ label: '阶段回收', text: '', citations: [] }] })
    const entry = workflow()
    entry.run.output = '还在等待的原始流程输出\n'
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([task]), workflowSnapshot([entry])))
    expect(result.runs[0]!.outputs[0]).toMatchObject({ label: '阶段回收', text: '', citations: [], status: 'running', location: 'task-output' })
    expect(result.runs[1]!.outputs.at(-1)).toMatchObject({ label: '流程输出', text: '还在等待的原始流程输出\n', status: 'running', location: 'run-output' })
  })

  it('retains a captured workflow source only when source, run and session identities match', async () => {
    const entry = workflow()
    const source = { id: 'captured-1', runId: 'command-1', graph: entry.graph, run: entry.run, capturedAt: timestamp }
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([], [source])))
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({ source: 'workflow', sourceRunId: 'command-1', sourceRecordId: 'captured-1', pptxState: 'pending' })
    const mismatch = { ...source, runId: 'different-command' }
    const missing = { ...source, id: 'captured-2', runId: undefined }
    const untouchedGraph = { id: 'graph-only', graph: entry.graph, capturedAt: timestamp }
    const bad = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([], [mismatch, missing, untouchedGraph])))
    expect(bad.runs).toEqual([])
    expect(bad.warnings).toHaveLength(2)
  })

  it('omits native planner and prompt optimizer even if they mention Insight', async () => {
    const optimizer = workflow()
    optimizer.graph = { ...optimizer.graph, id: 'prompt-optimizer-1', providerId: 'native', metadata: { insightPromptOptimizer: true } }
    const planner = workflow()
    planner.graph = { ...planner.graph, id: 'flow-planner-1', providerId: 'native', metadata: { insightFlowPlanner: true } }
    const otherTask = { ...legacy(), kind: 'chatgpt' }
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([otherTask]), workflowSnapshot([optimizer, planner])))
    expect(result.runs).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('keeps the healthy peer when the other is missing, throws or returns a foreign session', async () => {
    const a = await readInsightPreview(sessionId, { workflowOverview: vi.fn().mockResolvedValue(workflowSnapshot()) })
    expect(a.available).toBe(true)
    expect(a.runs).toHaveLength(1)
    expect(a.warnings.join('')).toContain('传统洞察来源不可用')
    const b = await readInsightPreview(sessionId, { legacyStatus: vi.fn().mockResolvedValue(legacySnapshot()), workflowOverview: vi.fn().mockRejectedValue(new Error('INTERNAL_RUN_ID_PRIVATE')) })
    expect(b.runs).toHaveLength(1)
    expect(b.warnings).toContain('流程洞察来源不可用。')
    expect(b.warnings.join('')).not.toContain('INTERNAL_RUN_ID_PRIVATE')
    const c = await readInsightPreview(sessionId, ports({ ...legacySnapshot(), sessionId: 'different' }, workflowSnapshot()))
    expect(c.runs).toHaveLength(1)
    expect(c.runs[0]?.source).toBe('workflow')
    expect(c.warnings.join('')).toContain('不属于当前会话')
    expect(await readInsightPreview(sessionId, {})).toMatchObject({ available: false, runs: [] })
  })

  it('treats invalid records independently, rejects identity conflicts and never borrows a node', async () => {
    const badCommand = workflow({ commandId: 'other-command' })
    const badSession = workflow()
    badSession.commandId = 'command-2'; badSession.run.id = 'command-2'; badSession.run.sessionId = 'elsewhere'
    const badNode = workflow()
    badNode.commandId = 'command-3'; badNode.run.id = 'command-3'; badNode.run.nodes[0]!.nodeId = 'foreign-node'
    const duplicateNode = workflow()
    duplicateNode.commandId = 'command-4'; duplicateNode.run.id = 'command-4'; duplicateNode.run.nodes.push({ nodeId: 'analysis', status: 'completed', output: '冲突' })
    const valid = workflow()
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([badCommand, badSession, badNode, duplicateNode, valid])))
    expect(result.runs.map(run => run.sourceRunId)).toEqual(['command-1'])
    expect(result.warnings).toHaveLength(4)
  })

  it('rejects malformed and duplicate graph identities without inventing a waiting output', async () => {
    const invalidStage = legacy()
    invalidStage.stages[0]!.nodeId = 'other/session'
    const invalidGraph = workflow()
    invalidGraph.graph.nodes.push({ ...invalidGraph.graph.nodes[0]! })
    const waiting = workflow()
    waiting.commandId = 'command-waiting'
    waiting.run.id = 'command-waiting'
    waiting.run.status = 'pending'
    waiting.run.nodes = []
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([invalidStage]), workflowSnapshot([invalidGraph, waiting])))
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]).toMatchObject({ sourceRunId: 'command-waiting', status: 'pending', outputs: [], pptxState: 'pending' })
    expect(result.warnings).toHaveLength(2)
  })

  it('skips all records with a duplicated source identity, including a corrupt duplicate', async () => {
    const badDuplicate = { ...legacy(), stages: 'corrupt' }
    const validWorkflow = workflow()
    const corruptWorkflow = { ...workflow(), run: { ...workflow().run, nodes: 'corrupt' } }
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([legacy(), badDuplicate]), workflowSnapshot([validWorkflow, corruptWorkflow])))
    expect(result.runs).toEqual([])
    expect(result.warnings.join('')).toContain('重复')
  })

  it('rejects duplicate legacy stage keys and preserves another valid task', async () => {
    const invalid = legacy()
    invalid.stages.push({ ...invalid.stages[0]! })
    const valid = legacy({ runId: 'legacy-2' })
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([invalid, valid]), workflowSnapshot([])))
    expect(result.runs.map(run => run.sourceRunId)).toEqual(['legacy-2'])
    expect(result.warnings.join('')).toContain('阶段标识重复')
  })

  it('assigns each phase its own stable 72-character document identity, including long source ids', async () => {
    const task = legacy({
      runId: 'run-' + 'x'.repeat(190),
      stages: [
        { key: 'phase-plan', label: '研究计划', status: 'completed', nodeId: 'research', outputs: [{ label: '计划', text: '计划原文' }] },
        { key: 'phase-research', label: '研究成果', status: 'completed', nodeId: 'research', outputs: [{ label: '研究', text: '研究原文' }] },
      ],
    })
    const first = await readInsightPreview(sessionId, ports(legacySnapshot([task]), workflowSnapshot([])))
    const second = await readInsightPreview(sessionId, ports(legacySnapshot([task]), workflowSnapshot([])))
    const [plan, research] = first.runs[0]!.outputs
    expect(plan!.documentId).toBe(documentId(first.runs[0]!.id, plan!.id))
    expect(research!.documentId).toBe(documentId(first.runs[0]!.id, research!.id))
    expect(plan!.documentId).not.toBe(research!.documentId)
    expect(plan!.documentId).toHaveLength(72)
    expect(second.runs[0]!.outputs.map(output => output.documentId)).toEqual(first.runs[0]!.outputs.map(output => output.documentId))
    expect(insightPreviewSnapshotSchema.parse(first)).toEqual(first)
  })

  it('preserves complete wire-normalized source records, including output-less failure details and provenance', async () => {
    const task = legacy({
      message: '原始运行信息',
      extraProvenance: { note: '未裁剪来源', futureField: [1, { unknown: '保留' }], omitted: undefined },
      stages: [{
        key: 'failed-phase', label: '核验', status: 'failed', nodeId: 'analysis', outputs: [], message: '请求失败；保留诊断',
        requested: { modelLabel: 'M1' }, observed: { modelLabel: 'M2' }, promptTrace: { binding: 'legacy-template', configPromptHash: 'abc' },
      }],
    })
    const entry = workflow()
    entry.run.status = 'failed'
    const failedNode = { nodeId: 'analysis', status: 'failed', error: '原始节点错误', observed: { provenance: { future: { unchanged: true } } } }
    const enrichedEntry = { ...entry, run: { ...entry.run, nodes: [failedNode], message: '原始流程说明', additive: { source: 'original' } }, other: { future: '保留' } }
    const source = { id: 'captured-1', runId: 'command-1', graph: entry.graph, run: enrichedEntry.run, capturedAt: timestamp, futureSource: { note: '原始来源' } }
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([task]), workflowSnapshot([enrichedEntry], [source])))
    expect(result.warnings).toEqual([])
    expect(result.runs).toHaveLength(3)
    expect(result.runs[0]!.outputs).toEqual([])
    expect(result.runs[0]!.raw).toEqual(JSON.parse(JSON.stringify(task)))
    expect(result.runs[1]!.outputs).toEqual([])
    expect(result.runs[1]!.raw).toEqual(JSON.parse(JSON.stringify(enrichedEntry)))
    expect(result.runs[2]!.raw).toEqual(JSON.parse(JSON.stringify(source)))
    expect(insightPreviewSnapshotSchema.parse(result)).toEqual(result)
  })

  it('reports non-serializable matching records without discarding valid records from either peer', async () => {
    const invalidLegacy = legacy({ runId: 'legacy-bigint', value: 1n })
    const cyclicWorkflow = workflow({ commandId: 'command-cycle' }) as ReturnType<typeof workflow> & { circular?: unknown }
    cyclicWorkflow.run.id = 'command-cycle'
    cyclicWorkflow.circular = cyclicWorkflow
    const validWorkflow = workflow()
    const result = await readInsightPreview(sessionId, ports(legacySnapshot([invalidLegacy, legacy()]), workflowSnapshot([cyclicWorkflow, validWorkflow])))
    expect(result.available).toBe(true)
    expect(result.runs.map(run => run.sourceRunId)).toEqual(['legacy-1', 'command-1'])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.every(warning => warning.includes('无效'))).toBe(true)
    expect(insightPreviewSnapshotSchema.parse(result)).toEqual(result)
  })

  it('projects PPTX only from explicit source manifests and workflow node status', async () => {
    const entry = workflow()
    entry.run.nodes[2] = { nodeId: 'pptx', status: 'completed', output: pptx }
    let result = await readInsightPreview(sessionId, ports(legacySnapshot([legacy({ outputs: [{ label: '可编辑 PPTX', text: pptx }] })]), workflowSnapshot([entry])))
    expect(result.runs.map(run => run.pptxState)).toEqual(['available', 'available'])
    expect(result.runs[1]!.outputs.at(-1)?.text).toBe(pptx)
    entry.run.nodes[2] = { nodeId: 'pptx', status: 'completed', output: '{"type":"insight-pptx"}' }
    result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([entry])))
    expect(result.runs[0]!.pptxState).toBe('unknown')
    entry.run.nodes[2] = { nodeId: 'pptx', status: 'failed' }
    result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([entry])))
    expect(result.runs[0]!.pptxState).toBe('unknown')
    entry.run.status = 'failed'
    entry.run.nodes[2] = { nodeId: 'pptx', status: 'pending' }
    result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([entry])))
    expect(result.runs[0]!.pptxState).toBe('unknown')
    entry.graph.nodes = entry.graph.nodes.filter(node => node.id !== 'pptx')
    entry.run.nodes = entry.run.nodes.filter(node => node.nodeId !== 'pptx')
    result = await readInsightPreview(sessionId, ports(legacySnapshot([]), workflowSnapshot([entry])))
    expect(result.runs[0]!.pptxState).toBe('not-in-flow')
  })

  it('rejects bad session identities before either endpoint is called', async () => {
    const read = ports()
    await expect(readInsightPreview('', read)).rejects.toThrow('INSIGHT_PREVIEW_SESSION_INVALID')
    await expect(readInsightPreview('bad\0session', read)).rejects.toThrow('INSIGHT_PREVIEW_SESSION_INVALID')
    expect(read.legacyStatus).not.toHaveBeenCalled()
    expect(read.workflowOverview).not.toHaveBeenCalled()
  })
})
