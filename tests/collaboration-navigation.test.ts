// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import { expect, test, vi } from 'vitest'
import { inject } from '../src/client.js'

// A declared module is not the same as a declared Cordis service. Exercise the
// published context proxy rather than an unrestricted object-shaped mock.
async function navigationProbe(declarations: string[], check: (open: (target: SessionTarget) => void, calls: ReturnType<typeof vi.fn>) => void) {
  const root = new Context()
  const calls = vi.fn()
  root.plugin({ apply(ctx: Context) {
    for (const key of new Set([...inject, 'uiWorkspace'])) ctx.provide(key, key === 'uiWorkspace' ? { openSession: calls } : {})
  } })
  let open: ((target: SessionTarget) => void) | undefined
  root.plugin({ inject: declarations, apply(ctx: Context) { open = target => ctx.uiWorkspace.openSession(target) } })
  try {
    await vi.waitFor(() => expect(open).toBeTypeOf('function'))
    check(open!, calls)
  } finally { await root.fiber.dispose() }
}

test('the declared client context can open an exact child address; missing workspace injection cannot navigate', async () => {
  const target = { parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' } as SessionTarget
  await navigationProbe(inject.filter(key => key !== 'uiWorkspace'), (open, calls) => {
    expect(() => open(target)).toThrow('without inject')
    expect(calls).not.toHaveBeenCalled()
  })
  await navigationProbe(inject, (open, calls) => {
    open(target)
    expect(calls).toHaveBeenCalledExactlyOnceWith(target)
  })
})
