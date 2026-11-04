import { z } from 'zod'

export interface ExecutionNode {
  id: string
  label: string
  description?: string
  role?: 'lead' | 'advisor' | 'worker' | 'tool'
  model?: string
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'skipped'
  progress?: { current: number, total: number, unit?: string }
  metrics?: Array<{ label: string, value: string | number, unit?: string }>
}
export interface ExecutionEdge { source: string, target: string, label?: string, status?: 'idle' | 'active' | 'done' | 'error' }
export interface ExecutionEvent { id: string, message: string, nodeId?: string, timestamp?: string }
export interface ExecutionPlan {
  kind: 'execution-flow'
  title?: string
  nodes: ExecutionNode[]
  edges: ExecutionEdge[]
  events: ExecutionEvent[]
  updatedAt?: string
}
export type ExecutionAnalysis =
  | { status: 'unrecognized' }
  | { status: 'invalid', error: { name: 'InvalidExecutionFlowPayload', message: string } }
  | { status: 'valid', plan: ExecutionPlan }

const aliases = {
  pending: 'queued', queued: 'queued', running: 'running',
  done: 'succeeded', completed: 'succeeded', succeeded: 'succeeded',
  error: 'failed', failed: 'failed', blocked: 'blocked',
  canceled: 'cancelled', cancelled: 'cancelled', skipped: 'skipped',
} as const satisfies Record<string, ExecutionNode['status']>
function statusKey(value: unknown): keyof typeof aliases | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  return Object.hasOwn(aliases, key) ? key as keyof typeof aliases : undefined
}
const nonempty = z.string().refine(value => value.trim().length > 0, 'Expected nonempty source text')
const timestamp = z.iso.datetime({ offset: true })
const statusSchema = z.string().refine(value => statusKey(value) !== undefined, 'Unsupported execution node status').transform(value => aliases[statusKey(value)!])
const progressSchema = z.object({ current: z.number().finite().nonnegative(), total: z.number().finite().nonnegative(), unit: z.string().optional() }).superRefine((progress, context) => {
  if (progress.current > progress.total) context.addIssue({ code: 'custom', path: ['current'], message: 'Progress current exceeds supplied total' })
})
// Object schemas accept unknown JSON fields without copying them into this read-only view projection.
// The caller retains the original source, including aliases and unknown fields, for raw/compare mode.
const schema = z.object({
  title: z.string().optional(), updatedAt: timestamp.optional(),
  nodes: z.array(z.object({
    id: nonempty, label: nonempty, description: z.string().optional(),
    role: z.enum(['lead', 'advisor', 'worker', 'tool']).optional(), model: z.string().optional(),
    status: statusSchema.optional(), progress: progressSchema.optional(),
    metrics: z.array(z.object({ label: nonempty, value: z.union([z.string(), z.number().finite()]), unit: z.string().optional() })).optional(),
  })).min(1),
  edges: z.array(z.object({ source: nonempty, target: nonempty, label: z.string().optional(), status: z.enum(['idle', 'active', 'done', 'error']).optional() })),
  events: z.array(z.object({ id: nonempty, message: nonempty, nodeId: nonempty.optional(), timestamp: timestamp.optional() })).optional(),
}).superRefine((value, context) => {
  const nodes = new Set<string>()
  value.nodes.forEach((node, index) => {
    if (nodes.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: 'Duplicate node ID' })
    nodes.add(node.id)
  })
  value.edges.forEach((edge, index) => {
    for (const key of ['source', 'target'] as const) if (!nodes.has(edge[key])) context.addIssue({ code: 'custom', path: ['edges', index, key], message: 'Unknown node ID' })
  })
  const events = new Set<string>()
  value.events?.forEach((event, index) => {
    if (events.has(event.id)) context.addIssue({ code: 'custom', path: ['events', index, 'id'], message: 'Duplicate event ID' })
    events.add(event.id)
    if (event.nodeId !== undefined && !nodes.has(event.nodeId)) context.addIssue({ code: 'custom', path: ['events', index, 'nodeId'], message: 'Unknown event node ID' })
  })
})
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function invalid(message: string): ExecutionAnalysis { return { status: 'invalid', error: { name: 'InvalidExecutionFlowPayload', message } } }

/** Recognize supplied execution snapshots only; this never creates status, progress, events or a live subscription. */
export function analyzeExecutionFlow(value: unknown): ExecutionAnalysis {
  if (!isRecord(value)) return { status: 'unrecognized' }
  const executionGraph = Object.hasOwn(value, 'nodes') && Object.hasOwn(value, 'edges') && Array.isArray(value.nodes) && value.nodes.some(node => isRecord(node) && (statusKey(node.status) !== undefined || Object.hasOwn(node, 'progress')))
  if (value.kind !== 'execution-flow' && !executionGraph) return { status: 'unrecognized' }
  try {
    // Count the whole original JSON, including fields excluded from the view; do not introduce graph-count limits.
    const source = JSON.stringify(value)
    if (new TextEncoder().encode(source).byteLength > 1024 * 1024) return invalid('Execution source exceeds the host 1 MiB source boundary')
  } catch { return invalid('Execution source is not serializable JSON') }
  const parsed = schema.safeParse(value)
  if (!parsed.success) return invalid(parsed.error.issues.map(issue => `${issue.path.join('.') || 'execution'}: ${issue.message}`).join('; '))
  return { status: 'valid', plan: { kind: 'execution-flow', ...parsed.data, events: parsed.data.events ?? [] } }
}
