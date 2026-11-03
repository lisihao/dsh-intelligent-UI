import { createHash } from 'node:crypto'
import { z } from 'zod'

import type { InsightPptxState, InsightPreviewJson, InsightPreviewOutput, InsightPreviewPorts, InsightPreviewRun, InsightPreviewSnapshot } from './insight-preview-contracts.js'

// Validate only fields this adapter reads. A provider may add unrelated fields.
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)
const legacyIdentity = z.string().min(1).max(512).refine(value => !value.includes('\0'))
const legacyStatus = z.enum(['queued', 'running', 'attention', 'completed', 'failed', 'cancelled', 'stopping'])
const legacyStageStatus = z.enum(['pending', 'running', 'completed', 'attention', 'cancelled', 'failed'])
const workflowStatus = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'unknown', 'needs-input'])
const record = z.record(z.string(), z.unknown())
const legacyOutput = z.object({ label: z.string(), text: z.string(), citations: z.array(z.string()).optional() })
const legacyStage = z.object({
  key: z.string().min(1).max(1024), label: z.string(), status: legacyStageStatus,
  nodeId: identifier.optional(), outputs: z.array(legacyOutput),
})
const legacyTask = z.object({
  kind: z.literal('insight'), runId: legacyIdentity, title: z.string(), status: legacyStatus,
  updatedAt: z.number().int().safe().refine(value => Number.isFinite(new Date(value).getTime())),
  stages: z.array(legacyStage), outputs: z.array(legacyOutput),
})
const legacySnapshot = z.object({ formatVersion: z.literal(1), sessionId: legacyIdentity, tasks: z.array(z.unknown()) })
const graph = z.object({
  formatVersion: z.literal(1), id: identifier, sessionId: identifier, providerId: z.literal('insight'),
  title: z.string(), metadata: record,
  nodes: z.array(z.object({ id: identifier, label: z.string(), kind: z.string() })),
})
const workflowRun = z.object({
  id: identifier, sessionId: identifier, providerId: z.literal('insight'), status: workflowStatus,
  updatedAt: z.string().refine(value => Number.isFinite(new Date(value).getTime())),
  nodes: z.array(z.object({ nodeId: identifier, status: workflowStatus, output: z.string().optional(), observed: record.optional() })),
  output: z.string().optional(),
})
const workflowRecord = z.object({
  formatVersion: z.literal(1), commandId: identifier, draftId: z.uuid(), draftRevision: z.number().int().nonnegative().safe(), graph, run: workflowRun,
})
const workflowSource = z.object({ id: identifier, graph, runId: identifier.optional(), run: workflowRun.optional() })
const workflowSnapshot = z.object({ sessionId: identifier, sources: z.array(z.unknown()), runs: z.array(z.unknown()) })

type WorkflowGraph = z.infer<typeof graph>
type WorkflowRun = z.infer<typeof workflowRun>

// Source records carry JSON strings. This checks for the source's own explicit
// PPTX manifest; it does not claim that the bytes were opened or verified.
function isPptxManifest(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const v = value as Record<string, unknown>
    return v.formatVersion === 1 && v.type === 'insight-pptx'
      && v.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      && typeof v.fileName === 'string' && v.fileName.length > 0
      && typeof v.base64 === 'string' && v.base64.length > 0 && v.base64.length % 4 === 0
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(v.base64)
      && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(v.sha256)
      && typeof v.width === 'number' && Number.isFinite(v.width) && v.width > 0
      && typeof v.height === 'number' && Number.isFinite(v.height) && v.height > 0
      && Number.isSafeInteger(v.slideCount) && (v.slideCount as number) > 0
      && Number.isSafeInteger(v.editableObjects) && (v.editableObjects as number) >= 0
      && Array.isArray(v.images)
  } catch { return false }
}

const key = (...parts: readonly (string | number)[]): string => JSON.stringify(parts)
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length

function identifiableOutput(runId: string, output: Omit<InsightPreviewOutput, 'documentId'>): InsightPreviewOutput {
  const documentId = `preview:${createHash('sha256').update(JSON.stringify([runId, output.id]), 'utf8').digest('hex')}`
  return { ...output, documentId }
}

/** Preserve every wire-visible field, including additive fields not projected below. */
function wireJson(value: unknown): InsightPreviewJson {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('record is not JSON serializable')
  return z.json().parse(JSON.parse(encoded))
}

function duplicateIdentities(items: readonly unknown[], identity: (value: Record<string, unknown>) => unknown): Set<string> {
  const seen = new Set<string>(), duplicate = new Set<string>()
  for (const item of items) {
    const parsed = record.safeParse(item)
    if (!parsed.success) continue
    const id = identity(parsed.data)
    if (typeof id !== 'string') continue
    if (seen.has(id)) duplicate.add(id)
    seen.add(id)
  }
  return duplicate
}

function legacyRun(value: z.infer<typeof legacyTask>, raw: InsightPreviewJson): InsightPreviewRun {
  if (!unique(value.stages.map(stage => stage.key))) throw new Error('duplicate stage keys')
  const runId = key('legacy', value.runId)
  const outputs: InsightPreviewOutput[] = value.outputs.map((output, index) => identifiableOutput(runId, {
    id: key('task-output', index), label: output.label, status: value.status, text: output.text,
    ...(output.citations === undefined ? {} : { citations: output.citations }), location: 'task-output',
  }))
  for (const stage of value.stages) {
    stage.outputs.forEach((output, index) => outputs.push(identifiableOutput(runId, {
      id: key('stage', stage.key, index), label: output.label, status: stage.status, text: output.text,
      ...(stage.nodeId === undefined ? {} : { nodeId: stage.nodeId }),
      ...(output.citations === undefined ? {} : { citations: output.citations }), stageKey: stage.key, location: 'stage',
    })))
  }
  return {
    id: runId, source: 'legacy', sourceRunId: value.runId,
    title: value.title, status: value.status, updatedAt: new Date(value.updatedAt).toISOString(), outputs, raw,
    // A task snapshot has phases but no authoritative graph/node kinds.
    pptxState: outputs.some(output => isPptxManifest(output.text)) ? 'available' : 'unknown',
  }
}

function pptxState(graphValue: WorkflowGraph, run: WorkflowRun): InsightPptxState {
  const nodes = graphValue.nodes.filter(node => node.kind === 'svg-to-pptx')
  if (nodes.length === 0) return 'not-in-flow'
  const results = nodes.map(node => run.nodes.find(result => result.nodeId === node.id))
  if (results.some(result => result?.status === 'completed' && result.output !== undefined && isPptxManifest(result.output))) return 'available'
  if ((run.status === 'pending' || run.status === 'running') && results.every(result => result === undefined || result.status === 'pending' || result.status === 'running')) return 'pending'
  return 'unknown'
}

function workflowProjection(graphValue: WorkflowGraph, run: WorkflowRun, sessionId: string, identity: { kind: 'run' | 'source'; recordId: string; runId: string }, raw: InsightPreviewJson): InsightPreviewRun {
  if (graphValue.sessionId !== sessionId || run.sessionId !== sessionId || run.id !== identity.runId) throw new Error('run identity mismatch')
  if (!unique(graphValue.nodes.map(node => node.id)) || !unique(run.nodes.map(node => node.nodeId))) throw new Error('duplicate node identity')
  const graphNodes = new Map(graphValue.nodes.map(node => [node.id, node]))
  if (run.nodes.some(node => !graphNodes.has(node.nodeId))) throw new Error('unknown node identity')
  const runId = key('workflow', identity.kind, identity.recordId)
  const outputs: InsightPreviewOutput[] = []
  for (const result of run.nodes) {
    if (result.output === undefined) continue
    outputs.push(identifiableOutput(runId, {
      id: key('node', result.nodeId), label: graphNodes.get(result.nodeId)!.label,
      status: result.status, text: result.output, nodeId: result.nodeId,
      ...(result.observed === undefined ? {} : { observed: result.observed }), location: 'node',
    }))
  }
  // StudioRun.output has no source label; name its actual field without
  // suggesting that an intermediate or incomplete output is a final report.
  if (run.output !== undefined) outputs.push(identifiableOutput(runId, { id: key('run-output'), label: '流程输出', status: run.status, text: run.output, location: 'run-output' }))
  return {
    id: runId, source: 'workflow', sourceRunId: identity.runId,
    ...(identity.kind === 'source' ? { sourceRecordId: identity.recordId } : {}),
    title: graphValue.title, status: run.status, updatedAt: run.updatedAt, outputs, raw,
    pptxState: pptxState(graphValue, run),
  }
}

type ReadResult = { ok: true; value: unknown } | { ok: false }

async function call(operation: ((input: { readonly sessionId: string }) => Promise<unknown>) | undefined, sessionId: string): Promise<ReadResult> {
  if (operation === undefined) return { ok: false }
  try { return { ok: true, value: await operation({ sessionId }) } }
  catch { return { ok: false } }
}

/**
 * Read existing observations only. This adapter cannot call execute, inspect,
 * refreshSource, resume, or any model, and never scans another plugin's store.
 */
export async function readInsightPreview(sessionId: string, ports: InsightPreviewPorts): Promise<InsightPreviewSnapshot> {
  if (!legacyIdentity.safeParse(sessionId).success) throw new Error('INSIGHT_PREVIEW_SESSION_INVALID: 会话标识无效。')
  const workflowSessionValid = identifier.safeParse(sessionId).success
  const [legacy, workflow] = await Promise.all([
    call(ports.legacyStatus, sessionId),
    workflowSessionValid ? call(ports.workflowOverview, sessionId) : Promise.resolve({ ok: false } as ReadResult),
  ])
  const warnings: string[] = []
  const runs = new Map<string, InsightPreviewRun>()
  const duplicates = new Set<string>()
  let available = false
  const add = (run: InsightPreviewRun): void => {
    if (duplicates.has(run.id)) return
    if (runs.has(run.id)) {
      runs.delete(run.id); duplicates.add(run.id)
      warnings.push('洞察来源中存在重复的运行标识，相关记录已跳过。')
    } else runs.set(run.id, run)
  }

  if (!legacy.ok) warnings.push('传统洞察来源不可用。')
  else {
    const snapshot = legacySnapshot.safeParse(legacy.value)
    if (!snapshot.success || snapshot.data.sessionId !== sessionId) warnings.push('传统洞察来源返回了无效或不属于当前会话的记录。')
    else {
      available = true
      const duplicateIds = duplicateIdentities(snapshot.data.tasks, value => value.kind === 'insight' ? value.runId : undefined)
      if (duplicateIds.size > 0) warnings.push('传统洞察来源中存在重复的运行标识，相关记录已跳过。')
      snapshot.data.tasks.forEach((raw, index) => {
        const candidate = record.safeParse(raw)
        if (!candidate.success || !['insight', 'chatgpt', 'grok'].includes(String(candidate.data.kind))) {
          warnings.push(`传统洞察第 ${index + 1} 条记录无法确认类型，已跳过。`); return
        }
        if (candidate.data.kind !== 'insight') return
        if (typeof candidate.data.runId === 'string' && duplicateIds.has(candidate.data.runId)) return
        try {
          const source = wireJson(raw)
          const normalized = record.parse(source)
          const parsed = legacyTask.parse(source)
          if (normalized.sessionId !== undefined && normalized.sessionId !== sessionId) throw new Error('session mismatch')
          if (!unique(parsed.stages.map(stage => stage.key))) {
            warnings.push(`传统洞察第 ${index + 1} 条记录的阶段标识重复，已跳过。`); return
          }
          add(legacyRun(parsed, source))
        } catch { warnings.push(`传统洞察第 ${index + 1} 条记录身份或内容无效，已跳过。`) }
      })
    }
  }

  if (!workflow.ok) warnings.push('流程洞察来源不可用。')
  else {
    const snapshot = workflowSnapshot.safeParse(workflow.value)
    if (!snapshot.success || snapshot.data.sessionId !== sessionId) warnings.push('流程洞察来源返回了无效或不属于当前会话的记录。')
    else {
      available = true
      const duplicatesFor = (items: readonly unknown[], field: 'id' | 'commandId'): Set<string> => duplicateIdentities(items, value => {
        const maybeGraph = record.safeParse(value.graph)
        return maybeGraph.success && maybeGraph.data.providerId === 'insight' ? value[field] : undefined
      })
      const runDuplicates = duplicatesFor(snapshot.data.runs, 'commandId')
      const sourceDuplicates = duplicatesFor(snapshot.data.sources, 'id')
      if (runDuplicates.size > 0 || sourceDuplicates.size > 0) warnings.push('流程洞察来源中存在重复的运行或来源标识，相关记录已跳过。')
      const inspect = (raw: unknown, index: number, kind: 'run' | 'source'): void => {
        const outer = record.safeParse(raw)
        const candidateGraph = outer.success ? record.safeParse(outer.data.graph) : undefined
        if (!candidateGraph?.success || !['native', 'web', 'insight'].includes(String(candidateGraph.data.providerId))) {
          warnings.push(`流程洞察第 ${index + 1} 条${kind === 'run' ? '运行' : '来源'}无法确认类型，已跳过。`); return
        }
        // Native planning and prompt-optimizer jobs are not Insight executions.
        if (candidateGraph.data.providerId !== 'insight') return
        const identity = outer.success ? outer.data[kind === 'run' ? 'commandId' : 'id'] : undefined
        if (typeof identity === 'string' && (kind === 'run' ? runDuplicates : sourceDuplicates).has(identity)) return
        try {
          const source = wireJson(raw)
          if (kind === 'run') {
            const parsed = workflowRecord.parse(source)
            add(workflowProjection(parsed.graph, parsed.run, sessionId, { kind, recordId: parsed.commandId, runId: parsed.commandId }, source))
          } else {
            const parsed = workflowSource.parse(source)
            if (parsed.run === undefined && parsed.runId === undefined) return // captured graph, not a run
            if (parsed.run === undefined || parsed.runId === undefined) throw new Error('missing captured run identity')
            add(workflowProjection(parsed.graph, parsed.run, sessionId, { kind, recordId: parsed.id, runId: parsed.runId }, source))
          }
        } catch { warnings.push(`流程洞察第 ${index + 1} 条${kind === 'run' ? '运行' : '来源'}身份或内容无效，已跳过。`) }
      }
      snapshot.data.runs.forEach((item, index) => inspect(item, index, 'run'))
      snapshot.data.sources.forEach((item, index) => inspect(item, index, 'source'))
    }
  }
  return { formatVersion: 1, sessionId, available, runs: [...runs.values()], warnings }
}
