import { describe, expect, it } from 'vitest'
import type { JevJudgeOnceOptions, JevJudgeOnceResult, JevQuestion, JevRequest } from '../src/adaptive-ui/contracts.js'
import {
  decideExecutableComponent,
  decideExecutableComponentsBatch,
  executableComponentReachability,
} from '../src/adaptive-ui/component-decision.js'
import {
  ExecutableComponentRegistry,
  type ExecutableComponentDefinition,
  type ExecutableJson,
} from '../src/adaptive-ui/executable-registry.js'

type Choice = (question: JevQuestion, index: number, request: JevRequest) => string

class FakeJev {
  calls = 0
  requests: JevRequest[] = []
  constructor(private readonly choose: Choice = question => question.options[0]!.id) {}

  async judgeOnce(options: JevJudgeOnceOptions): Promise<JevJudgeOnceResult> {
    this.calls++
    const signal = options.signal ?? new AbortController().signal
    const request = await options.refresh(signal)
    options.preflight?.(request)
    this.requests.push(request)
    const response = { answers: request.questions.map((question, index) => ({ id: question.id, kind: 'choice' as const, optionId: this.choose(question, index, request) })) }
    const interpreted = await options.interpret?.(response, signal)
    if (interpreted && !interpreted.usable) return { kind: 'not-adopted', operationId: `operation-${this.calls}`, reason: interpreted.reason }
    const adopt = await options.canAdopt?.(response, signal)
    if (adopt !== undefined && adopt !== true) return { kind: 'not-adopted', operationId: `operation-${this.calls}`, reason: adopt }
    return { kind: 'ok', operationId: `operation-${this.calls}`, attemptId: `attempt-${this.calls}`, response }
  }
}

const schema = { parse(value: unknown): ExecutableJson { return value as ExecutableJson } }
function add(registry: ExecutableComponentRegistry, id: string, family: string): void {
  const definition: ExecutableComponentDefinition = {
    id,
    family,
    title: id,
    suitability: `${family} source-bound component.`,
    rendererKey: `renderer:${id}`,
    inputSchema: schema,
    bind: context => context.source && typeof context.source === 'object'
      ? { eligible: true, input: { id, sourceKind: (context.source as { kind?: unknown }).kind ?? 'unknown' }, reasons: [`source:${family}`] }
      : { eligible: false, reasons: ['source:record-required'] },
  }
  registry.register(definition)
}

function registry(): ExecutableComponentRegistry {
  const value = new ExecutableComponentRegistry()
  add(value, 'alpha:a', 'alpha')
  add(value, 'alpha:b', 'alpha')
  add(value, 'canvas:one', 'canvas')
  add(value, 'canvas:two', 'canvas')
  return value
}

const context = { source: { kind: 'report' }, capabilities: { webgl: true, reducedMotion: false } }
const link = { sessionId: 'session', inputVersion: 'source-sha' }

function countExact(value: unknown, needle: string): number {
  if (value === needle) return 1
  if (Array.isArray(value)) return value.reduce((total, item) => total + countExact(item, needle), 0)
  if (value && typeof value === 'object') return Object.values(value).reduce((total, item) => total + countExact(item, needle), 0)
  return 0
}

function sharedCatalog(request: JevRequest): { components: Array<{ id: string, title: string, suitability: string, rendererKey: string }>, memberGroups: Array<{ id: string, memberIds: string[] }> } {
  const state = request.state as { sharedCatalog?: unknown }
  if (!state.sharedCatalog || typeof state.sharedCatalog !== 'object') throw new Error('Expected shared catalog in decision state.')
  return state.sharedCatalog as { components: Array<{ id: string, title: string, suitability: string, rendererKey: string }>, memberGroups: Array<{ id: string, memberIds: string[] }> }
}

describe('executable component Jev decision', () => {
  it('reaches every legal ID through family and stable partition routes without top-K omission', () => {
    const value = new ExecutableComponentRegistry()
    for (let index = 0; index < 7; index++) add(value, `uiverse:${String(index).padStart(2, '0')}`, 'uiverse')
    add(value, 'native:reading', 'native')
    const coverage = executableComponentReachability(value, context, 2)
    expect(coverage.eligibleIds).toHaveLength(8)
    expect(coverage.allEligibleReachable).toBe(true)
    expect(coverage.unreachableIds).toEqual([])
    expect(coverage.reachability.map(item => item.id)).toEqual(coverage.eligibleIds)
    expect(coverage.reachability.find(item => item.id === 'uiverse:06')?.optionPath.length).toBeGreaterThan(2)
  })

  it('keeps an upstream opaque component identity through Jev selection and same-ID dispatch', async () => {
    const value = new ExecutableComponentRegistry()
    const sourceId = 'uiverse:Buttons/0x-Sarthak_hungry-penguin-30'
    value.register({
      id: sourceId,
      family: 'uiverse',
      title: 'Hungry penguin',
      suitability: 'A source-bound Uiverse button.',
      rendererKey: 'uiverse-runtime',
      inputSchema: schema,
      bind: () => ({ eligible: true, input: { sourceId }, reasons: ['source:bound'] }),
    })
    add(value, 'native:reading', 'native')
    const port = new FakeJev(question => (question.prompt as { scope?: unknown }).scope === 'family' ? 'uiverse' : sourceId)
    const result = await decideExecutableComponent({ port, registry: value, context, state: { source: context.source }, inputFingerprint: 'sha256:opaque', link })
    expect(result).toMatchObject({ status: 'selected', selected: { id: sourceId, rendererKey: 'uiverse-runtime', input: { sourceId } } })
  })

  it('uses only executable contract descriptions, validates the selected ID again, and keeps source out of options', async () => {
    const source = { kind: 'report', sentinel: 'SOURCE-MUST-NOT-APPEAR-IN-CANDIDATE-OPTIONS' }
    const port = new FakeJev(question => question.options.at(-1)!.id)
    const result = await decideExecutableComponent({
      port,
      registry: registry(),
      context: { ...context, source },
      state: { source },
      inputFingerprint: 'sha256:stable-source',
      link,
      maxOptionsPerQuestion: 2,
    })
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('Expected selected result.')
    expect(result.selected.id).toBe('canvas:two')
    expect(result.selected.rendererKey).toBe('renderer:canvas:two')
    expect(result.rounds.some(round => round.scope === 'family')).toBe(true)
    for (const request of port.requests) {
      expect(countExact(request.state, source.sentinel)).toBe(1)
      expect(countExact(request.questions, source.sentinel)).toBe(0)
      const catalog = sharedCatalog(request)
      expect(catalog.components).toHaveLength(4)
      for (const question of request.questions) for (const option of question.options) {
        const description = option.description as Record<string, unknown>
        expect(description).not.toHaveProperty('suitability')
        expect(description).not.toHaveProperty('rendererKey')
        expect(typeof description.memberGroupId === 'string' || typeof description.metadataKey === 'string').toBe(true)
      }
    }
  })

  it('makes every family member contract resolvable through the shared catalog instead of a count-only description', async () => {
    const port = new FakeJev()
    await decideExecutableComponent({ port, registry: registry(), context, state: { source: context.source }, inputFingerprint: 'sha256:family-catalog', link })
    const request = port.requests.find(item => (item.questions[0]?.prompt as { scope?: unknown } | undefined)?.scope === 'family')
    expect(request).toBeDefined()
    if (!request) throw new Error('Expected family question.')
    const catalog = sharedCatalog(request)
    const alpha = request.questions[0]!.options.find(option => option.id === 'alpha')!.description as { memberGroupId: string, count?: unknown }
    const group = catalog.memberGroups.find(item => item.id === alpha.memberGroupId)
    expect(group?.memberIds).toEqual(['alpha:a', 'alpha:b'])
    const metadata = new Map(catalog.components.map(item => [item.id, item]))
    expect(group?.memberIds.map(id => metadata.get(id)?.suitability)).toEqual(['alpha source-bound component.', 'alpha source-bound component.'])
    expect(alpha).not.toHaveProperty('count')
  })

  it('rejects an answer outside the current legal options instead of choosing a fallback component', async () => {
    const port = new FakeJev(() => 'not-a-legal-option')
    const result = await decideExecutableComponent({ port, registry: registry(), context, state: { source: context.source }, inputFingerprint: 'sha256:fixed', link })
    expect(result).toMatchObject({ status: 'not-adopted', reason: 'EXECUTABLE_COMPONENT_ANSWER_UNKNOWN_OPTION' })
    expect(result.status).not.toBe('selected')
  })

  it('does not send a model request when the Host says the input fingerprint is stale', async () => {
    const port = new FakeJev()
    const result = await decideExecutableComponent({
      port,
      registry: registry(),
      context,
      state: { source: context.source },
      inputFingerprint: 'sha256:old',
      link,
      callbacks: { refresh: () => ({ inputFingerprint: 'sha256:new' }) },
    })
    expect(result).toMatchObject({ status: 'stale', reason: 'EXECUTABLE_COMPONENT_DECISION_STALE' })
    expect(port.calls).toBe(0)
  })

  it('batches all blocks by phase while retaining a separate source path and strict answer mapping', async () => {
    const source = {
      blocks: [
        { value: { kind: 'one', sentinel: 'first-source' } },
        { value: { kind: 'two', sentinel: 'second-source' } },
        { value: { kind: 'three', sentinel: 'third-source' } },
      ],
    }
    const port = new FakeJev(question => {
      if (question.prompt && typeof question.prompt === 'object' && 'scope' in question.prompt && question.prompt.scope === 'family') return 'canvas'
      return question.options.at(-1)!.id
    })
    const result = await decideExecutableComponentsBatch({
      port,
      registry: registry(),
      blocks: source.blocks.map((block, index) => ({ id: `block-${String(index)}`, inputPath: ['blocks', index, 'value'], context: { ...context, source: block.value } })),
      state: source,
      inputFingerprint: 'sha256:three-blocks',
      link,
      maxOptionsPerQuestion: 20,
    })
    expect(port.calls).toBe(2)
    expect(result.modelRounds.map(round => ({ stage: round.stage, count: round.blockIds.length }))).toEqual([{ stage: 'family', count: 3 }, { stage: 'component', count: 3 }])
    expect(result.blocks.map(block => block.status)).toEqual(['selected', 'selected', 'selected'])
    expect(result.blocks.every(block => block.status === 'selected' && block.selected.id === 'canvas:two')).toBe(true)
    for (const request of port.requests) {
      expect(countExact(request.state, 'first-source')).toBe(1)
      expect(countExact(request.state, 'second-source')).toBe(1)
      expect(countExact(request.state, 'third-source')).toBe(1)
      expect(countExact(request.questions, 'first-source')).toBe(0)
      expect(request.questions).toHaveLength(3)
      expect(sharedCatalog(request).components).toHaveLength(4)
    }
  })

  it('adds stable partition waves for a large family instead of truncating its legal IDs', async () => {
    const value = new ExecutableComponentRegistry()
    for (let index = 0; index < 7; index++) add(value, `uiverse:${String(index).padStart(2, '0')}`, 'uiverse')
    const port = new FakeJev(question => question.options.length === 2 && question.options[0]!.id.startsWith('partition:')
      ? question.options[0]!.id
      : question.options.at(-1)!.id)
    const result = await decideExecutableComponentsBatch({
      port,
      registry: value,
      blocks: [{ id: 'large-family', inputPath: ['blocks', 0], context }],
      state: { blocks: [context.source] },
      inputFingerprint: 'sha256:large-family',
      link,
      maxOptionsPerQuestion: 2,
    })
    expect(port.calls).toBeGreaterThan(1)
    expect(port.calls).toBeLessThan(7)
    expect(result.blocks[0]).toMatchObject({ status: 'selected', selected: { id: 'uiverse:01' } })
    const selected = result.blocks[0]
    if (!selected || selected.status !== 'selected') throw new Error('Expected selected large-family result.')
    expect(selected.coverage.eligibleIds).toEqual(['uiverse:00', 'uiverse:01', 'uiverse:02', 'uiverse:03', 'uiverse:04', 'uiverse:05', 'uiverse:06'])
    expect(selected.coverage.allEligibleReachable).toBe(true)
    expect(selected.rounds.some(round => round.scope === 'component-partition')).toBe(true)
    const partitionRequest = port.requests.find(request => request.questions[0]?.options[0]?.id.startsWith('partition:'))
    expect(partitionRequest).toBeDefined()
    if (!partitionRequest) throw new Error('Expected partition question.')
    const catalog = sharedCatalog(partitionRequest)
    const groups = new Map(catalog.memberGroups.map(group => [group.id, group.memberIds]))
    const metadata = new Map(catalog.components.map(component => [component.id, component]))
    const memberIds = partitionRequest.questions[0]!.options.flatMap(option => groups.get((option.description as { memberGroupId: string }).memberGroupId) ?? [])
    expect([...new Set(memberIds)].sort()).toEqual(selected.coverage.eligibleIds)
    for (const id of memberIds) expect(metadata.get(id)).toMatchObject({ id, suitability: expect.any(String), rendererKey: expect.any(String) })
  })

  it('reports an explicit full-problem state boundary instead of shrinking the candidate set', async () => {
    const port = new FakeJev()
    await expect(decideExecutableComponent({
      port,
      registry: registry(),
      context,
      state: { source: 'x'.repeat(2_000) },
      inputFingerprint: 'sha256:state-limit',
      link,
      maxStateBytes: 1_024,
    })).rejects.toMatchObject({ code: 'EXECUTABLE_COMPONENT_DECISION_STATE_TOO_LARGE' })
    expect(port.calls).toBe(0)
  })

  it('keeps an ineligible block visible without making it consume a batch question', async () => {
    const port = new FakeJev()
    const result = await decideExecutableComponentsBatch({
      port,
      registry: registry(),
      blocks: [
        { id: 'eligible', inputPath: ['blocks', 0], context },
        { id: 'ineligible', inputPath: ['blocks', 1], context: { ...context, source: null } },
      ],
      state: { blocks: [{ kind: 'report' }, null] },
      inputFingerprint: 'sha256:mixed',
      link,
    })
    expect(result.blocks.find(block => block.id === 'ineligible')).toMatchObject({ status: 'no-candidate', reason: 'EXECUTABLE_COMPONENT_NO_LEGAL_CANDIDATE' })
    expect(result.blocks.find(block => block.id === 'eligible')?.status).toBe('selected')
    expect(port.requests.every(request => request.questions.every(question => !question.id.includes('ineligible')))).toBe(true)
  })
})
