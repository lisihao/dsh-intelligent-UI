import { describe, expect, it } from 'vitest'
import { SlotCore, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { installCollaborationHeaderPolicy } from '../src/collaboration-header-policy.js'

const HEADER_ACTION_SLOT = 'conversation.session.header.actions' as const
const HEADER_UTILITY_SLOT = 'conversation.session.header.utilities' as const
const HIDDEN_IDS = [
  'agent-team',
  'subagent-catalog',
  'solar-pstack-status',
  'cost-meter-statistics',
  'agy-link-status',
] as const

type Register = (options: Record<string, unknown>, component: unknown) => () => void

function createFixture() {
  const core = new SlotCore()
  const rawRegister = core.register.bind(core) as unknown as Register
  const registrations: Array<Record<string, unknown>> = []
  const injectionDisposers: Array<() => void> = []

  const register: Register = (options, component) => {
    registrations.push(options)
    return rawRegister(options, component)
  }

  rawRegister({
    name: 'root',
    children: {
      [HEADER_ACTION_SLOT]: { kind: 'list', scope: 'session' },
      [HEADER_UTILITY_SLOT]: { kind: 'list', scope: 'session' },
    },
  }, () => null)

  const inject = (name: string, callback: () => Iterable<() => void>) => {
    if (name !== HEADER_ACTION_SLOT) throw new Error(`unexpected slot injection: ${name}`)
    const dispose = [...callback()].reverse()
    let active = true
    const controller = () => {
      if (!active) return
      active = false
      for (const entry of dispose) entry()
    }
    injectionDisposers.push(controller)
    return controller
  }

  const ctx = {
    slots: {
      register,
      inject,
    },
  } as unknown as Context

  return {
    core,
    ctx,
    registrations,
    disposeInjections() {
      for (const dispose of injectionDisposers.splice(0).reverse()) dispose()
    },
  }
}

function originalEntry(id: string): () => null {
  return () => null
}

function entryById(entries: readonly StoredEntry[], id: string): StoredEntry | undefined {
  return entries.find(entry => entry.options.id === id)
}

describe('collaboration header policy', () => {
  it('shadows exactly the five redundant header actions and restores originals on disposal', () => {
    const fixture = createFixture()
    const originals = new Map<string, () => null>()
    for (const id of HIDDEN_IDS) {
      const component = originalEntry(id)
      originals.set(id, component)
      fixture.core.register({ name: HEADER_ACTION_SLOT, id }, component)
    }
    const unrelated = originalEntry('keep-this-action')
    fixture.core.register({ name: HEADER_ACTION_SLOT, id: 'keep-this-action' }, unrelated)
    const utility = originalEntry('keep-this-utility')
    fixture.core.register({ name: HEADER_UTILITY_SLOT, id: 'keep-this-utility' }, utility)

    const beforeActions = fixture.core.entries(HEADER_ACTION_SLOT)
    const beforeUtilities = fixture.core.entries(HEADER_UTILITY_SLOT)
    expect(installCollaborationHeaderPolicy(fixture.ctx)).toBeUndefined()
    expect(fixture.registrations).toEqual(HIDDEN_IDS.map(id => ({
      name: HEADER_ACTION_SLOT,
      id,
      priority: -100,
    })))

    const winners = fixture.core.entriesOfSlot(HEADER_ACTION_SLOT)
    expect(HIDDEN_IDS.map(id => entryById(winners, id)?.options.priority)).toEqual([-100, -100, -100, -100, -100])
    for (const id of HIDDEN_IDS) {
      const hidden = entryById(winners, id)
      expect(hidden?.component).not.toBe(originals.get(id))
      expect((hidden?.component as () => null)()).toBeNull()
    }
    expect(entryById(winners, 'keep-this-action')?.component).toBe(unrelated)
    expect(fixture.core.entries(HEADER_UTILITY_SLOT)).toEqual(beforeUtilities)
    expect(fixture.registrations.every(options => options.name === HEADER_ACTION_SLOT)).toBe(true)

    fixture.disposeInjections()
    expect(fixture.core.entries(HEADER_ACTION_SLOT)).toEqual(beforeActions)
    expect(fixture.core.entries(HEADER_UTILITY_SLOT)).toEqual(beforeUtilities)
    expect(fixture.core.entriesOfSlot(HEADER_ACTION_SLOT).map(entry => entry.options.id)).toEqual([
      ...HIDDEN_IDS,
      'keep-this-action',
    ])
    for (const id of HIDDEN_IDS) expect(entryById(fixture.core.entriesOfSlot(HEADER_ACTION_SLOT), id)?.component).toBe(originals.get(id))

    // The public disposer is idempotent, matching SlotRegistry's lifecycle contract.
    fixture.disposeInjections()
    expect(fixture.core.entries(HEADER_ACTION_SLOT)).toEqual(beforeActions)
  })
})
