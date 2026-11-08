import { ADAPTIVE_COMPOSITION_FEATURE_ID } from './contracts.js'
import type {
  JevChoiceAnswer,
  JevCompositionPort,
  JevConnectionIdentity,
  JevJson,
  JevJudgeOnceResult,
  JevOperationLink,
  JevQuestion,
  JevRequest,
  JevResponse,
} from './contracts.js'
import {
  ExecutableComponentRegistry,
  ExecutableComponentRegistryError,
  stableExecutableJson,
  type ExecutableComponentAudit,
  type ExecutableComponentContext,
  type ExecutableComponentDispatch,
  type ExecutableComponentEvaluation,
  type ExecutableJson,
} from './executable-registry.js'

/** Component selection is a second phase of the already registered UI-composition feature. */
export const EXECUTABLE_COMPONENT_DECISION_FEATURE_ID = ADAPTIVE_COMPOSITION_FEATURE_ID
export const EXECUTABLE_COMPONENT_DECISION_FORMAT_VERSION = 1 as const
export const DEFAULT_MAX_COMPONENT_OPTIONS_PER_QUESTION = 100
/** Deliberately separate from the 512 KiB per-component input contract. */
export const DEFAULT_MAX_COMPONENT_DECISION_STATE_BYTES = 16 * 1024 * 1024
export const MAX_COMPONENT_DECISION_STATE_BYTES = 64 * 1024 * 1024

export class ExecutableComponentDecisionError extends Error {
  constructor(readonly code: string, message = code) {
    super(message)
    this.name = 'ExecutableComponentDecisionError'
  }
}

export interface ExecutableComponentDecisionRound {
  readonly index: number
  readonly scope: 'family' | 'family-partition' | 'component' | 'component-partition'
  readonly family?: string
  readonly questionId?: string
  readonly optionIds: readonly string[]
  readonly selectedId: string
  readonly selection: 'model' | 'singleton'
  readonly operationId?: string
  readonly attemptId?: string
}

export interface ExecutableComponentReachability {
  readonly id: string
  readonly family: string
  /** Every model/deterministic option needed to reach this exact executable ID. */
  readonly optionPath: readonly string[]
}

export interface ExecutableComponentDecisionCoverage {
  readonly eligibleIds: readonly string[]
  readonly reachability: readonly ExecutableComponentReachability[]
  readonly unreachableIds: readonly string[]
  readonly allEligibleReachable: boolean
}

export type ExecutableComponentDecisionResult = {
  readonly status: 'selected'
  readonly selected: ExecutableComponentDispatch
  readonly rounds: readonly ExecutableComponentDecisionRound[]
  readonly coverage: ExecutableComponentDecisionCoverage
  readonly audit: ExecutableComponentAudit
} | {
  readonly status: 'no-candidate' | 'failed' | 'cancelled' | 'not-adopted' | 'stale'
  readonly reason: string
  readonly rounds: readonly ExecutableComponentDecisionRound[]
  readonly coverage: ExecutableComponentDecisionCoverage
  readonly audit: ExecutableComponentAudit
}

export interface ExecutableComponentDecisionFreshness {
  readonly inputFingerprint: string
}

export interface ExecutableComponentDecisionCallbacks {
  /**
   * The Host supplies its current source/settings fingerprint. A mismatch stops
   * the current chain; it never starts a replacement model request.
   */
  readonly refresh?: (signal: AbortSignal) => ExecutableComponentDecisionFreshness | Promise<ExecutableComponentDecisionFreshness>
  readonly preflight?: (request: JevRequest) => void
  readonly canAdopt?: (response: JevResponse, signal: AbortSignal) => true | string | Promise<true | string>
}

export interface ExecutableComponentDecisionOptions {
  readonly port: Pick<JevCompositionPort, 'judgeOnce'>
  readonly registry: ExecutableComponentRegistry
  readonly context: ExecutableComponentContext
  /** Host-owned state contains source once; candidate options never copy raw source. */
  readonly state: JevJson
  readonly inputFingerprint: string
  readonly link: JevOperationLink
  readonly connection?: JevConnectionIdentity
  readonly signal?: AbortSignal
  readonly featureId?: string
  readonly maxOptionsPerQuestion?: number
  /** Explicit full-problem-state boundary; candidates are never silently truncated. */
  readonly maxStateBytes?: number
  readonly callbacks?: ExecutableComponentDecisionCallbacks
}

type Candidate = Extract<ExecutableComponentEvaluation, { eligible: true }>
type Entry = {
  readonly id: string
  readonly title: string
  readonly suitability: string
  readonly rendererKey?: string
  readonly family?: string
  readonly requirements: readonly string[]
  /** IDs resolved through state.sharedCatalog.memberGroups. */
  readonly memberIds: readonly string[]
  readonly memberGroupId: string
  /** Component IDs resolve this stable key through state.sharedCatalog.components. */
  readonly metadataKey?: string
  readonly candidate?: Candidate
}
type Branch = { readonly id: string, readonly entries: readonly Entry[], readonly memberGroupId: string, readonly requirements: readonly string[] }
type DecisionNode = {
  readonly scope: ExecutableComponentDecisionRound['scope']
  readonly family?: string
  readonly entries: readonly Entry[]
  readonly memberGroupId: string
  readonly branches?: readonly Branch[]
}

type SharedComponentMetadata = Readonly<{ id: string, title: string, suitability: string, rendererKey: string }>
type SharedMemberGroup = Readonly<{ id: string, memberIds: readonly string[] }>
type SharedDecisionCatalog = Readonly<{ components: readonly SharedComponentMetadata[], memberGroups: readonly SharedMemberGroup[] }>

/**
 * One batch shares component metadata and member sets across every block. This
 * keeps a family/partition fully inspectable without repeating 3,802 contracts
 * in each local question.
 */
class DecisionCatalogBuilder {
  private readonly componentsById = new Map<string, SharedComponentMetadata>()
  private readonly groupIdByMembers = new Map<string, string>()
  private readonly groups: SharedMemberGroup[] = []

  registerCandidate(candidate: Candidate): void {
    const metadata = Object.freeze({ id: candidate.id, title: candidate.title, suitability: candidate.suitability, rendererKey: candidate.rendererKey })
    const existing = this.componentsById.get(candidate.id)
    if (existing && (existing.title !== metadata.title || existing.suitability !== metadata.suitability || existing.rendererKey !== metadata.rendererKey)) {
      throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_CATALOG_CONFLICT')
    }
    if (!existing) this.componentsById.set(candidate.id, metadata)
  }

  registerCandidates(candidates: readonly Candidate[]): void { for (const candidate of candidates) this.registerCandidate(candidate) }

  group(memberIds: readonly string[]): string {
    const unique = [...new Set(memberIds)].sort((left, right) => left.localeCompare(right))
    if (!unique.length) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_MEMBER_GROUP_EMPTY')
    for (const id of unique) if (!this.componentsById.has(id)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_MEMBER_METADATA_MISSING')
    const identity = unique.join('\u0000')
    const existing = this.groupIdByMembers.get(identity)
    if (existing) return existing
    const id = `members-${String(this.groups.length + 1).padStart(6, '0')}`
    this.groupIdByMembers.set(identity, id)
    this.groups.push(Object.freeze({ id, memberIds: Object.freeze(unique) }))
    return id
  }

  snapshot(): SharedDecisionCatalog {
    return Object.freeze({
      components: Object.freeze([...this.componentsById.values()].sort((left, right) => left.id.localeCompare(right.id))),
      memberGroups: Object.freeze([...this.groups]),
    })
  }
}

function ensureFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_INPUT_FINGERPRINT_INVALID')
  return value
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_COMPONENT_OPTIONS_PER_QUESTION
  if (!Number.isSafeInteger(value) || value < 2 || value > 1_000) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_OPTION_LIMIT_INVALID')
  return value
}

function normalizeStateLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_COMPONENT_DECISION_STATE_BYTES
  if (!Number.isSafeInteger(value) || value < 1_024 || value > MAX_COMPONENT_DECISION_STATE_BYTES) {
    throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_STATE_LIMIT_INVALID')
  }
  return value
}

/** State is a full problem document plus a shared catalog, not one component input. */
function normalizeDecisionState(value: unknown, maximumBytes: number): JevJson {
  const serialized = stableExecutableJson(value)
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_DECISION_STATE_TOO_LARGE')
  }
  return JSON.parse(serialized) as JevJson
}

function componentEntries(audit: ExecutableComponentAudit): Candidate[] {
  return audit.entries.filter((entry): entry is Candidate => entry.eligible).sort((left, right) => left.id.localeCompare(right.id))
}

function entryForCandidate(candidate: Candidate, catalog: DecisionCatalogBuilder): Entry {
  catalog.registerCandidate(candidate)
  return Object.freeze({
    id: candidate.id,
    title: candidate.title,
    suitability: candidate.suitability,
    rendererKey: candidate.rendererKey,
    family: candidate.family,
    requirements: candidate.reasons,
    memberIds: Object.freeze([candidate.id]),
    memberGroupId: catalog.group([candidate.id]),
    metadataKey: candidate.id,
    candidate,
  })
}

function unionMemberIds(entries: readonly Entry[]): readonly string[] {
  return Object.freeze([...new Set(entries.flatMap(entry => entry.memberIds))].sort((left, right) => left.localeCompare(right)))
}

function unionRequirements(entries: readonly Entry[]): readonly string[] {
  return Object.freeze([...new Set(entries.flatMap(entry => entry.requirements))].sort((left, right) => left.localeCompare(right)))
}

function buildNode(entries: readonly Entry[], limit: number, scope: DecisionNode['scope'], family: string | undefined, path: readonly string[], catalog: DecisionCatalogBuilder): DecisionNode {
  const memberGroupId = catalog.group(unionMemberIds(entries))
  if (entries.length <= limit) return { scope, family, entries, memberGroupId }
  const branchCount = Math.min(limit, Math.ceil(entries.length / limit))
  const branchSize = Math.ceil(entries.length / branchCount)
  const branches: Branch[] = []
  for (let index = 0; index < branchCount; index++) {
    const part = entries.slice(index * branchSize, (index + 1) * branchSize)
    if (!part.length) continue
    const id = `partition:${path.join(':')}:${String(index + 1)}`
    branches.push({ id, entries: part, memberGroupId: catalog.group(unionMemberIds(part)), requirements: unionRequirements(part) })
  }
  return { scope: scope === 'family' ? 'family-partition' : 'component-partition', family, entries, memberGroupId, branches }
}

function nodeOptionIds(node: DecisionNode): readonly string[] {
  return Object.freeze(node.branches ? node.branches.map(branch => branch.id) : node.entries.map(entry => entry.id))
}

function nodeDescription(node: DecisionNode, id: string): JevJson {
  if (node.branches) {
    const branch = node.branches.find(item => item.id === id)
    if (!branch) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_NODE_OPTION_UNKNOWN')
    return { kind: 'partition', memberGroupId: branch.memberGroupId, requirements: [...branch.requirements] }
  }
  const entry = node.entries.find(item => item.id === id)
  if (!entry) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_NODE_OPTION_UNKNOWN')
  if (entry.metadataKey !== undefined) return { id: entry.id, metadataKey: entry.metadataKey, requirements: [...entry.requirements] }
  return { id: entry.id, kind: 'family', memberGroupId: entry.memberGroupId, requirements: [...entry.requirements] }
}

function childFor(node: DecisionNode, selectedId: string, limit: number, path: readonly string[], catalog: DecisionCatalogBuilder): DecisionNode | Entry {
  if (!node.branches) {
    const entry = node.entries.find(item => item.id === selectedId)
    if (!entry) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_SELECTION_UNKNOWN')
    return entry
  }
  const branch = node.branches.find(item => item.id === selectedId)
  if (!branch) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_SELECTION_UNKNOWN')
  return buildNode(branch.entries, limit, node.scope === 'family-partition' ? 'family' : 'component', node.family, [...path, selectedId], catalog)
}

function isNode(value: DecisionNode | Entry): value is DecisionNode { return 'entries' in value }

function questionFor(node: DecisionNode, questionId: string, inputFingerprint: string): JevQuestion {
  const optionIds = nodeOptionIds(node)
  const label = node.scope.startsWith('family') ? '选择组件族' : '选择可执行组件'
  return {
    id: questionId,
    kind: 'choice',
    prompt: {
      task: label,
      inputBinding: 'state.input contains the source exactly once; option descriptions contain only IDs, shared metadata references, member-group references, and block requirements.',
      sharedCatalogBinding: 'Resolve metadataKey through state.sharedCatalog.components and memberGroupId through state.sharedCatalog.memberGroups before choosing.',
      designRubricBinding: 'For production block batches, evaluate state.input.designRubric together with the source block at inputPath. Fact preservation and visual reorganization are separate criteria.',
      constraints: [
        'Choose by source fit, fidelity, readability, and declared requirements.',
        'Every listed option has an executable renderer key and a validated source binding.',
        'Do not choose for novelty or diversity.',
      ],
      inputFingerprint,
      scope: node.scope,
      ...(node.family === undefined ? {} : { family: node.family }),
    },
    options: optionIds.map(id => ({ id, description: nodeDescription(node, id) })),
  }
}

function stateFor(options: ExecutableComponentDecisionOptions, node: DecisionNode, roundIndex: number, catalog: DecisionCatalogBuilder, maximumBytes: number): JevJson {
  return normalizeDecisionState({
    formatVersion: EXECUTABLE_COMPONENT_DECISION_FORMAT_VERSION,
    kind: 'executable-component-decision',
    inputFingerprint: options.inputFingerprint,
    input: options.state,
    sharedCatalog: catalog.snapshot(),
    round: { index: roundIndex, scope: node.scope, ...(node.family === undefined ? {} : { family: node.family }) },
  }, maximumBytes)
}

function answerFor(response: JevResponse, question: JevQuestion): string {
  if (!response || !Array.isArray(response.answers) || response.answers.length !== 1) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_COUNT_INVALID')
  const answer = response.answers[0] as JevChoiceAnswer | undefined
  if (!answer || answer.kind !== 'choice' || answer.id !== question.id || typeof answer.optionId !== 'string') {
    throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_INVALID')
  }
  if (!question.options.some(option => option.id === answer.optionId)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_UNKNOWN_OPTION')
  return answer.optionId
}

function resultReason(result: JevJudgeOnceResult): string {
  if (result.kind === 'failed') return `JEV_${result.failure.code}`
  if (result.kind === 'cancelled') return 'JEV_CANCELLED'
  if (result.kind === 'not-adopted') return result.reason
  return 'EXECUTABLE_COMPONENT_DECISION_UNEXPECTED_RESULT'
}

type FreshnessBoundOptions = Pick<ExecutableComponentDecisionOptions, 'inputFingerprint' | 'callbacks' | 'signal'>

async function assertFresh(options: FreshnessBoundOptions, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_DECISION_CANCELLED')
  const current = await options.callbacks?.refresh?.(signal)
  if (current !== undefined && ensureFingerprint(current.inputFingerprint) !== options.inputFingerprint) {
    throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_DECISION_STALE')
  }
}

async function runNode(
  options: ExecutableComponentDecisionOptions,
  node: DecisionNode,
  roundIndex: number,
  limit: number,
  catalog: DecisionCatalogBuilder,
  maximumStateBytes: number,
  rounds: ExecutableComponentDecisionRound[],
  path: readonly string[],
): Promise<{ selected?: Entry, outcome?: Exclude<ExecutableComponentDecisionResult['status'], 'selected' | 'no-candidate'>, reason?: string }> {
  let current: DecisionNode | Entry = node
  let currentPath = [...path]
  let nextRound = roundIndex
  while (isNode(current)) {
    const optionIds = nodeOptionIds(current)
    if (optionIds.length === 1) {
      const selectedId = optionIds[0]!
      rounds.push(Object.freeze({ index: nextRound++, scope: current.scope, ...(current.family === undefined ? {} : { family: current.family }), optionIds, selectedId, selection: 'singleton' as const }))
      currentPath = [...currentPath, selectedId]
      current = childFor(current, selectedId, limit, currentPath, catalog)
      continue
    }
    const questionId = `component:${String(nextRound)}:${current.scope}${current.family === undefined ? '' : `:${current.family}`}`
    const question = questionFor(current, questionId, options.inputFingerprint)
    const request = Object.freeze({ state: stateFor(options, current, nextRound, catalog, maximumStateBytes), questions: Object.freeze([question]) }) as JevRequest
    const expected = stableExecutableJson(request)
    let chosen: string | undefined
    let stale = false
    let invalidReason: string | undefined
    let outcome: JevJudgeOnceResult
    try {
      await assertFresh(options, options.signal ?? new AbortController().signal)
      outcome = await options.port.judgeOnce({
        featureId: options.featureId ?? EXECUTABLE_COMPONENT_DECISION_FEATURE_ID,
        link: options.link,
        signal: options.signal,
        connection: options.connection,
        refresh: async signal => {
          try { await assertFresh(options, signal) }
          catch (error) {
            if (error instanceof ExecutableComponentDecisionError && error.code === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
            throw error
          }
          return request
        },
        preflight: candidate => {
          if (stableExecutableJson(candidate) !== expected) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_REQUEST_MUTATED')
          options.callbacks?.preflight?.(candidate)
        },
        interpret: async (response, signal) => {
          try {
            await assertFresh(options, signal)
            chosen = answerFor(response, question)
            return { usable: true }
          } catch (error) {
            invalidReason = error instanceof ExecutableComponentDecisionError ? error.code : 'EXECUTABLE_COMPONENT_RESPONSE_INVALID'
            if (invalidReason === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
            return { usable: false, reason: invalidReason }
          }
        },
        canAdopt: async (response, signal) => {
          try { await assertFresh(options, signal) }
          catch (error) {
            const code = error instanceof ExecutableComponentDecisionError ? error.code : 'EXECUTABLE_COMPONENT_DECISION_STALE'
            if (code === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
            return code
          }
          return await options.callbacks?.canAdopt?.(response, signal) ?? true
        },
      })
    } catch (error) {
      const code = error instanceof ExecutableComponentDecisionError ? error.code : 'JEV_JUDGE_FAILED'
      return { outcome: code === 'EXECUTABLE_COMPONENT_DECISION_STALE' ? 'stale' : 'failed', reason: code }
    }
    if (outcome.kind !== 'ok' || chosen === undefined) {
      const reason = stale ? 'EXECUTABLE_COMPONENT_DECISION_STALE' : invalidReason ?? resultReason(outcome)
      return { outcome: stale ? 'stale' : outcome.kind === 'cancelled' ? 'cancelled' : outcome.kind === 'not-adopted' ? 'not-adopted' : 'failed', reason }
    }
    rounds.push(Object.freeze({
      index: nextRound++, scope: current.scope, ...(current.family === undefined ? {} : { family: current.family }), questionId, optionIds, selectedId: chosen,
      selection: 'model' as const, operationId: outcome.operationId, attemptId: outcome.attemptId,
    }))
    currentPath = [...currentPath, chosen]
    current = childFor(current, chosen, limit, currentPath, catalog)
  }
  return { selected: current }
}

function pathForTree(node: DecisionNode, limit: number, catalog: DecisionCatalogBuilder, prefix: readonly string[] = []): ReadonlyMap<string, readonly string[]> {
  const paths = new Map<string, readonly string[]>()
  const visit = (current: DecisionNode | Entry, path: readonly string[]): void => {
    if (!isNode(current)) { paths.set(current.id, path); return }
    for (const id of nodeOptionIds(current)) visit(childFor(current, id, limit, [...path, id], catalog), [...path, id])
  }
  visit(node, prefix)
  return paths
}

function familyTree(candidates: readonly Candidate[], limit: number, catalog: DecisionCatalogBuilder): { readonly tree: DecisionNode, readonly families: ReadonlyMap<string, readonly Candidate[]> } {
  const families = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const bucket = families.get(candidate.family) ?? []
    bucket.push(candidate)
    families.set(candidate.family, bucket)
  }
  const entries: Entry[] = []
  for (const [family, values] of [...families.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const members = values.map(candidate => entryForCandidate(candidate, catalog))
    const memberIds = unionMemberIds(members)
    entries.push(Object.freeze({
      id: family,
      title: family,
      suitability: 'Resolve this family through its full shared component member group.',
      requirements: unionRequirements(members),
      memberIds,
      memberGroupId: catalog.group(memberIds),
    }))
  }
  return { tree: buildNode(entries, limit, 'family', undefined, ['family'], catalog), families }
}

/**
 * Enumerates every currently legal component route. The planner may present a
 * large family in multiple Jev rounds, but no legal component is silently
 * dropped to a top-K set.
 */
export function executableComponentReachability(registry: ExecutableComponentRegistry, context: ExecutableComponentContext, maxOptionsPerQuestion = DEFAULT_MAX_COMPONENT_OPTIONS_PER_QUESTION): ExecutableComponentDecisionCoverage {
  const limit = normalizeLimit(maxOptionsPerQuestion)
  const candidates = componentEntries(registry.audit(context))
  return reachabilityFromCandidates(candidates, limit)
}

function reachabilityFromCandidates(candidates: readonly Candidate[], limit: number): ExecutableComponentDecisionCoverage {
  if (!candidates.length) return Object.freeze({ eligibleIds: Object.freeze([]), reachability: Object.freeze([]), unreachableIds: Object.freeze([]), allEligibleReachable: true })
  const catalog = new DecisionCatalogBuilder()
  catalog.registerCandidates(candidates)
  const { tree, families } = familyTree(candidates, limit, catalog)
  const familyPaths = pathForTree(tree, limit, catalog)
  const paths: ExecutableComponentReachability[] = []
  for (const [family, values] of families) {
    const familyPath = familyPaths.get(family)
    if (!familyPath) continue
    const entries = values.slice().sort((left, right) => left.id.localeCompare(right.id)).map(value => entryForCandidate(value, catalog))
    // A full library can have thousands of leaves in one family. Its immutable
    // partition paths are identical for every leaf and need computing once.
    const componentPaths = pathForTree(buildNode(entries, limit, 'component', family, ['component', family], catalog), limit, catalog)
    for (const candidate of values) {
      const local = componentPaths.get(candidate.id)
      if (!local) continue
      paths.push(Object.freeze({ id: candidate.id, family, optionPath: Object.freeze([...familyPath, ...local]) }))
    }
  }
  const reachable = new Set(paths.map(path => path.id))
  const eligibleIds = candidates.map(candidate => candidate.id)
  const unreachableIds = eligibleIds.filter(id => !reachable.has(id))
  return Object.freeze({ eligibleIds: Object.freeze(eligibleIds), reachability: Object.freeze(paths.sort((left, right) => left.id.localeCompare(right.id))), unreachableIds: Object.freeze(unreachableIds), allEligibleReachable: unreachableIds.length === 0 })
}

/**
 * Performs a finite, strictly validated Jev selection. It only returns a
 * dispatch descriptor; actual rendering and host action execution stay with
 * the caller's renderer and Host event boundary.
 */
export async function decideExecutableComponent(options: ExecutableComponentDecisionOptions): Promise<ExecutableComponentDecisionResult> {
  const inputFingerprint = ensureFingerprint(options.inputFingerprint)
  if (inputFingerprint !== options.inputFingerprint) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_INPUT_FINGERPRINT_INVALID')
  const limit = normalizeLimit(options.maxOptionsPerQuestion)
  const maximumStateBytes = normalizeStateLimit(options.maxStateBytes)
  const audit = options.registry.audit(options.context)
  const coverage = reachabilityFromCandidates(componentEntries(audit), limit)
  const rounds: ExecutableComponentDecisionRound[] = []
  const candidates = componentEntries(audit)
  if (!candidates.length) return Object.freeze({ status: 'no-candidate' as const, reason: 'EXECUTABLE_COMPONENT_NO_LEGAL_CANDIDATE', rounds: Object.freeze(rounds), coverage, audit })
  if (!coverage.allEligibleReachable) return Object.freeze({ status: 'failed' as const, reason: 'EXECUTABLE_COMPONENT_REACHABILITY_INCOMPLETE', rounds: Object.freeze(rounds), coverage, audit })
  const catalog = new DecisionCatalogBuilder()
  catalog.registerCandidates(candidates)
  const { tree, families } = familyTree(candidates, limit, catalog)
  const family = await runNode(options, tree, 0, limit, catalog, maximumStateBytes, rounds, ['family'])
  if (!family.selected) return Object.freeze({ status: family.outcome ?? 'failed', reason: family.reason ?? 'EXECUTABLE_COMPONENT_FAMILY_SELECTION_FAILED', rounds: Object.freeze(rounds), coverage, audit })
  const selectedFamily = family.selected.id
  const values = families.get(selectedFamily)
  if (!values) return Object.freeze({ status: 'failed' as const, reason: 'EXECUTABLE_COMPONENT_FAMILY_UNKNOWN', rounds: Object.freeze(rounds), coverage, audit })
  const entries = values.slice().sort((left, right) => left.id.localeCompare(right.id)).map(value => entryForCandidate(value, catalog))
  const components = await runNode(options, buildNode(entries, limit, 'component', selectedFamily, ['component', selectedFamily], catalog), rounds.length, limit, catalog, maximumStateBytes, rounds, ['component', selectedFamily])
  if (!components.selected?.candidate) return Object.freeze({ status: components.outcome ?? 'failed', reason: components.reason ?? 'EXECUTABLE_COMPONENT_SELECTION_FAILED', rounds: Object.freeze(rounds), coverage, audit })
  try {
    await assertFresh(options, options.signal ?? new AbortController().signal)
    const selected = options.registry.dispatch(components.selected.candidate.id, options.context)
    return Object.freeze({ status: 'selected' as const, selected, rounds: Object.freeze(rounds), coverage, audit })
  } catch (error) {
    const reason = error instanceof ExecutableComponentDecisionError || error instanceof ExecutableComponentRegistryError ? error.code : 'EXECUTABLE_COMPONENT_DISPATCH_REJECTED'
    return Object.freeze({ status: reason === 'EXECUTABLE_COMPONENT_DECISION_STALE' ? 'stale' as const : 'failed' as const, reason, rounds: Object.freeze(rounds), coverage, audit })
  }
}

/** A compiler-owned reference into the one batch input carried in `state`. */
export interface ExecutableComponentBatchBlock {
  readonly id: string
  readonly inputPath: readonly (string | number)[]
  readonly context: ExecutableComponentContext
}

export interface ExecutableComponentBatchOptions {
  readonly port: Pick<JevCompositionPort, 'judgeOnce'>
  readonly registry: ExecutableComponentRegistry
  readonly blocks: readonly ExecutableComponentBatchBlock[]
  /**
   * The full source/document is present here once. Per-block candidate options
   * carry only `inputPath`, not a copied source string or table.
   */
  readonly state: JevJson
  readonly inputFingerprint: string
  readonly link: JevOperationLink
  readonly connection?: JevConnectionIdentity
  readonly signal?: AbortSignal
  readonly featureId?: string
  readonly maxOptionsPerQuestion?: number
  readonly maxStateBytes?: number
  readonly callbacks?: ExecutableComponentDecisionCallbacks
}

export type ExecutableComponentBatchBlockResult = {
  readonly id: string
  readonly status: 'selected'
  readonly selected: ExecutableComponentDispatch
  readonly rounds: readonly ExecutableComponentDecisionRound[]
  readonly coverage: ExecutableComponentDecisionCoverage
  readonly audit: ExecutableComponentAudit
} | {
  readonly id: string
  readonly status: 'no-candidate' | 'failed' | 'cancelled' | 'not-adopted' | 'stale'
  readonly reason: string
  readonly rounds: readonly ExecutableComponentDecisionRound[]
  readonly coverage: ExecutableComponentDecisionCoverage
  readonly audit: ExecutableComponentAudit
}

export interface ExecutableComponentBatchResult {
  readonly blocks: readonly ExecutableComponentBatchBlockResult[]
  /** One entry means one Jev call, potentially deciding many source blocks. */
  readonly modelRounds: readonly { readonly index: number, readonly stage: 'family' | 'component', readonly blockIds: readonly string[], readonly operationId?: string, readonly attemptId?: string }[]
}

type BatchPlan = {
  readonly block: ExecutableComponentBatchBlock
  readonly audit: ExecutableComponentAudit
  readonly coverage: ExecutableComponentDecisionCoverage
  readonly candidates: readonly Candidate[]
  readonly rounds: ExecutableComponentDecisionRound[]
  familyCursor?: { node: DecisionNode | Entry, path: readonly string[] }
  family?: Entry
  componentCursor?: { node: DecisionNode | Entry, path: readonly string[] }
  component?: Entry
  terminal?: { status: Exclude<ExecutableComponentBatchBlockResult['status'], 'selected'>, reason: string }
}

function normalizeBatchBlock(value: ExecutableComponentBatchBlock): ExecutableComponentBatchBlock {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200 || !Array.isArray(value.inputPath)) {
    throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_BATCH_BLOCK_INVALID')
  }
  for (const part of value.inputPath) {
    if (typeof part !== 'string' && (!Number.isSafeInteger(part) || part < 0)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_BATCH_PATH_INVALID')
    if (typeof part === 'string' && (!part || part.length > 200)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_BATCH_PATH_INVALID')
  }
  return value
}

function advanceSingleton(cursor: { node: DecisionNode | Entry, path: readonly string[] }, limit: number, catalog: DecisionCatalogBuilder, rounds: ExecutableComponentDecisionRound[]): { node: DecisionNode | Entry, path: readonly string[] } {
  let current = cursor.node
  let path = cursor.path
  while (isNode(current) && nodeOptionIds(current).length === 1) {
    const selectedId = nodeOptionIds(current)[0]!
    rounds.push(Object.freeze({
      index: rounds.length,
      scope: current.scope,
      ...(current.family === undefined ? {} : { family: current.family }),
      optionIds: nodeOptionIds(current),
      selectedId,
      selection: 'singleton' as const,
    }))
    path = [...path, selectedId]
    current = childFor(current, selectedId, limit, path, catalog)
  }
  return { node: current, path }
}

function batchQuestionId(wave: number, ordinal: number): string { return `component-batch:${String(wave)}:${String(ordinal)}` }

function batchStateFor(options: ExecutableComponentBatchOptions, stage: 'family' | 'component', wave: number, plans: readonly BatchPlan[], catalog: DecisionCatalogBuilder, maximumStateBytes: number): JevJson {
  return normalizeDecisionState({
    formatVersion: EXECUTABLE_COMPONENT_DECISION_FORMAT_VERSION,
    kind: 'executable-component-batch-decision',
    inputFingerprint: options.inputFingerprint,
    input: options.state,
    sharedCatalog: catalog.snapshot(),
    round: {
      stage,
      wave,
      blocks: plans.map(plan => {
        const cursor = stage === 'family' ? plan.familyCursor! : plan.componentCursor!
        return { id: plan.block.id, inputPath: [...plan.block.inputPath], scope: isNode(cursor.node) ? cursor.node.scope : stage }
      }),
    },
  }, maximumStateBytes)
}

function batchAnswers(response: JevResponse, questions: readonly JevQuestion[]): ReadonlyMap<string, string> {
  if (!response || !Array.isArray(response.answers) || response.answers.length !== questions.length) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_COUNT_INVALID')
  const expected = new Map(questions.map(question => [question.id, question]))
  const answers = new Map<string, string>()
  for (const raw of response.answers) {
    const answer = raw as JevChoiceAnswer
    if (!answer || answer.kind !== 'choice' || typeof answer.id !== 'string' || typeof answer.optionId !== 'string' || answers.has(answer.id)) {
      throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_INVALID')
    }
    const question = expected.get(answer.id)
    if (!question || !question.options.some(option => option.id === answer.optionId)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_UNKNOWN_OPTION')
    answers.set(answer.id, answer.optionId)
  }
  if (answers.size !== expected.size) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_ANSWER_INCOMPLETE')
  return answers
}

type BatchWaveFailure = { readonly status: Exclude<ExecutableComponentBatchBlockResult['status'], 'selected' | 'no-candidate'>, readonly reason: string }

async function runBatchWave(
  options: ExecutableComponentBatchOptions,
  stage: 'family' | 'component',
  wave: number,
  plans: readonly BatchPlan[],
  limit: number,
  catalog: DecisionCatalogBuilder,
  maximumStateBytes: number,
  modelRounds: { index: number, stage: 'family' | 'component', blockIds: readonly string[], operationId?: string, attemptId?: string }[],
): Promise<BatchWaveFailure | undefined> {
  const cursors = plans.map(plan => stage === 'family' ? plan.familyCursor! : plan.componentCursor!)
  const questions = cursors.map((cursor, ordinal) => questionFor(cursor.node as DecisionNode, batchQuestionId(wave, ordinal), options.inputFingerprint))
  const request = Object.freeze({ state: batchStateFor(options, stage, wave, plans, catalog, maximumStateBytes), questions: Object.freeze(questions) }) as JevRequest
  const expected = stableExecutableJson(request)
  let answers: ReadonlyMap<string, string> | undefined
  let stale = false
  let invalidReason: string | undefined
  let outcome: JevJudgeOnceResult
  try {
    await assertFresh(options, options.signal ?? new AbortController().signal)
    outcome = await options.port.judgeOnce({
      featureId: options.featureId ?? EXECUTABLE_COMPONENT_DECISION_FEATURE_ID,
      link: options.link,
      signal: options.signal,
      connection: options.connection,
      refresh: async signal => {
        try { await assertFresh(options, signal) }
        catch (error) {
          if (error instanceof ExecutableComponentDecisionError && error.code === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
          throw error
        }
        return request
      },
      preflight: candidate => {
        if (stableExecutableJson(candidate) !== expected) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_REQUEST_MUTATED')
        options.callbacks?.preflight?.(candidate)
      },
      interpret: async (response, signal) => {
        try {
          await assertFresh(options, signal)
          answers = batchAnswers(response, questions)
          return { usable: true }
        } catch (error) {
          invalidReason = error instanceof ExecutableComponentDecisionError ? error.code : 'EXECUTABLE_COMPONENT_RESPONSE_INVALID'
          if (invalidReason === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
          return { usable: false, reason: invalidReason }
        }
      },
      canAdopt: async (response, signal) => {
        try { await assertFresh(options, signal) }
        catch (error) {
          const code = error instanceof ExecutableComponentDecisionError ? error.code : 'EXECUTABLE_COMPONENT_DECISION_STALE'
          if (code === 'EXECUTABLE_COMPONENT_DECISION_STALE') stale = true
          return code
        }
        return await options.callbacks?.canAdopt?.(response, signal) ?? true
      },
    })
  } catch (error) {
    const code = error instanceof ExecutableComponentDecisionError ? error.code : 'JEV_JUDGE_FAILED'
    return { status: code === 'EXECUTABLE_COMPONENT_DECISION_STALE' ? 'stale' : 'failed', reason: code }
  }
  if (outcome.kind !== 'ok' || !answers) {
    const reason = stale ? 'EXECUTABLE_COMPONENT_DECISION_STALE' : invalidReason ?? resultReason(outcome)
    return { status: stale ? 'stale' : outcome.kind === 'cancelled' ? 'cancelled' : outcome.kind === 'not-adopted' ? 'not-adopted' : 'failed', reason }
  }
  modelRounds.push(Object.freeze({ index: wave, stage, blockIds: Object.freeze(plans.map(plan => plan.block.id)), operationId: outcome.operationId, attemptId: outcome.attemptId }))
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]!, cursor = cursors[index]!, question = questions[index]!, selectedId = answers.get(question.id)
    if (!selectedId) return { status: 'failed', reason: 'EXECUTABLE_COMPONENT_ANSWER_INCOMPLETE' }
    const node = cursor.node as DecisionNode
    plan.rounds.push(Object.freeze({
      index: plan.rounds.length,
      scope: node.scope,
      ...(node.family === undefined ? {} : { family: node.family }),
      questionId: question.id,
      optionIds: nodeOptionIds(node),
      selectedId,
      selection: 'model' as const,
      operationId: outcome.operationId,
      attemptId: outcome.attemptId,
    }))
    const next = childFor(node, selectedId, limit, [...cursor.path, selectedId], catalog)
    if (stage === 'family') plan.familyCursor = { node: next, path: [...cursor.path, selectedId] }
    else plan.componentCursor = { node: next, path: [...cursor.path, selectedId] }
  }
  return undefined
}

async function resolveBatchStage(
  options: ExecutableComponentBatchOptions,
  plans: readonly BatchPlan[],
  stage: 'family' | 'component',
  limit: number,
  catalog: DecisionCatalogBuilder,
  maximumStateBytes: number,
  modelRounds: { index: number, stage: 'family' | 'component', blockIds: readonly string[], operationId?: string, attemptId?: string }[],
  firstWave: number,
): Promise<BatchWaveFailure | undefined> {
  let wave = firstWave
  for (;;) {
    const waiting: BatchPlan[] = []
    for (const plan of plans) {
      if (plan.terminal) continue
      const cursor = stage === 'family' ? plan.familyCursor : plan.componentCursor
      if (!cursor) continue
      const advanced = advanceSingleton(cursor, limit, catalog, plan.rounds)
      if (stage === 'family') plan.familyCursor = advanced
      else plan.componentCursor = advanced
      if (!isNode(advanced.node)) {
        if (stage === 'family') plan.family = advanced.node
        else plan.component = advanced.node
      } else waiting.push(plan)
    }
    if (!waiting.length) return undefined
    const failure = await runBatchWave(options, stage, wave++, waiting, limit, catalog, maximumStateBytes, modelRounds)
    if (failure) return failure
  }
}

/**
 * Batches the same two-stage decision across all source blocks. Typical input
 * takes one family call and one leaf call for the entire document, rather than
 * two calls per block. Large families add only stable partition waves.
 */
export async function decideExecutableComponentsBatch(options: ExecutableComponentBatchOptions): Promise<ExecutableComponentBatchResult> {
  ensureFingerprint(options.inputFingerprint)
  const limit = normalizeLimit(options.maxOptionsPerQuestion)
  const maximumStateBytes = normalizeStateLimit(options.maxStateBytes)
  const ids = new Set<string>()
  const plans: BatchPlan[] = options.blocks.map(block => {
    const normalized = normalizeBatchBlock(block)
    if (ids.has(normalized.id)) throw new ExecutableComponentDecisionError('EXECUTABLE_COMPONENT_BATCH_BLOCK_DUPLICATE')
    ids.add(normalized.id)
    const audit = options.registry.audit(normalized.context)
    const coverage = reachabilityFromCandidates(componentEntries(audit), limit)
    const candidates = componentEntries(audit)
    const plan: BatchPlan = { block: normalized, audit, coverage, candidates, rounds: [] }
    if (!candidates.length) plan.terminal = { status: 'no-candidate', reason: 'EXECUTABLE_COMPONENT_NO_LEGAL_CANDIDATE' }
    else if (!coverage.allEligibleReachable) plan.terminal = { status: 'failed', reason: 'EXECUTABLE_COMPONENT_REACHABILITY_INCOMPLETE' }
    return plan
  })
  const catalog = new DecisionCatalogBuilder()
  for (const plan of plans) if (!plan.terminal) catalog.registerCandidates(plan.candidates)
  for (const plan of plans) {
    if (plan.terminal) continue
    plan.familyCursor = { node: familyTree(plan.candidates, limit, catalog).tree, path: ['family', plan.block.id] }
  }
  const modelRounds: { index: number, stage: 'family' | 'component', blockIds: readonly string[], operationId?: string, attemptId?: string }[] = []
  const familyFailure = await resolveBatchStage(options, plans, 'family', limit, catalog, maximumStateBytes, modelRounds, 0)
  if (familyFailure) for (const plan of plans) if (!plan.terminal && !plan.family) plan.terminal = familyFailure
  if (!familyFailure) {
    for (const plan of plans) {
      if (plan.terminal || !plan.family) continue
      const candidates = plan.candidates.filter(candidate => candidate.family === plan.family!.id)
      if (!candidates.length) { plan.terminal = { status: 'failed', reason: 'EXECUTABLE_COMPONENT_FAMILY_UNKNOWN' }; continue }
      const entries = candidates.map(candidate => entryForCandidate(candidate, catalog))
      plan.componentCursor = { node: buildNode(entries, limit, 'component', plan.family.id, ['component', plan.block.id, plan.family.id], catalog), path: ['component', plan.block.id, plan.family.id] }
    }
    const componentFailure = await resolveBatchStage(options, plans, 'component', limit, catalog, maximumStateBytes, modelRounds, modelRounds.length)
    if (componentFailure) for (const plan of plans) if (!plan.terminal && !plan.component) plan.terminal = componentFailure
  }
  const results: ExecutableComponentBatchBlockResult[] = []
  for (const plan of plans) {
    if (plan.terminal) {
      results.push(Object.freeze({ id: plan.block.id, ...plan.terminal, rounds: Object.freeze(plan.rounds), coverage: plan.coverage, audit: plan.audit }))
      continue
    }
    if (!plan.component?.candidate) {
      results.push(Object.freeze({ id: plan.block.id, status: 'failed' as const, reason: 'EXECUTABLE_COMPONENT_SELECTION_FAILED', rounds: Object.freeze(plan.rounds), coverage: plan.coverage, audit: plan.audit }))
      continue
    }
    try {
      await assertFresh(options, options.signal ?? new AbortController().signal)
      const selected = options.registry.dispatch(plan.component.candidate.id, plan.block.context)
      results.push(Object.freeze({ id: plan.block.id, status: 'selected' as const, selected, rounds: Object.freeze(plan.rounds), coverage: plan.coverage, audit: plan.audit }))
    } catch (error) {
      const reason = error instanceof ExecutableComponentDecisionError || error instanceof ExecutableComponentRegistryError ? error.code : 'EXECUTABLE_COMPONENT_DISPATCH_REJECTED'
      results.push(Object.freeze({ id: plan.block.id, status: reason === 'EXECUTABLE_COMPONENT_DECISION_STALE' ? 'stale' as const : 'failed' as const, reason, rounds: Object.freeze(plan.rounds), coverage: plan.coverage, audit: plan.audit }))
    }
  }
  return Object.freeze({ blocks: Object.freeze(results), modelRounds: Object.freeze(modelRounds) })
}
