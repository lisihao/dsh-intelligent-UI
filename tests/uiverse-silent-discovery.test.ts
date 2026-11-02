import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry, isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installUiverse } from '../src/uiverse/host.js'
import { expect, test } from 'vitest'

// Resolve the official CLI's pinned dependency, rather than a second loader implementation.
const resolveHere = createRequire(import.meta.url)
const resolveDsh = createRequire(resolveHere.resolve('@deepseek-ai/dsh/package.json'))
const officialSkill = await import(pathToFileURL(resolveDsh.resolve('@deepseek-ai/dsh-tool-skill')).href)

test('integrated silent capability reaches the official model catalog and lazy loader without a model call', async () => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
  const tools = new ToolRuntime(ctx)
  const skills = new SkillRegistry(ctx)
  // Only the published middleware is under test. This inert agent owns no loop,
  // model, session records or project writes, and ensure merely supplies its cwd.
  ctx.provide('workingDirectory', { ensure: async () => '/private/tmp' })
  officialSkill.apply(ctx)
  const assets = fileURLToPath(new URL('../lib/uiverse/assets/', import.meta.url))
  const target = ctx.plugin({ name: 'uiverse-integrated-capability-test', async apply(owner: Context) { await installUiverse(owner, assets) } })
  await target.await()
  try {
    const summary = (await skills.list()).find(item => item.name === 'uiverse-components')
    expect(summary).toBeDefined()
    expect(summary!.description).toContain('Canvas UI')
    expect(isModelInvocable(summary!)).toBe(true)
    expect(isUserInvocable(summary!)).toBe(false)
    expect(summary!.description).toMatch(/frontend|front.end|UI|前端|界面/i)
    expect(summary!.whenToUse).toBeTruthy()

    const agent = { session: { seq: 0, surface: { nodes: [] } } }
    const signal = new AbortController().signal
    const catalogDecision = await ctx.events.waterfall('agent/pre-step', { agent, messages: [], signal }, async () => ({ kind: 'enter', messages: [] }))
    const catalogMessage = catalogDecision.messages.find((message: { source: { kind: string } }) => message.source.kind === 'skill-catalog')
    expect(catalogMessage).toBeDefined()
    expect(catalogMessage.source.entries).toContainEqual({ name: 'uiverse-components', description: summary!.description })
    const catalogText = catalogMessage.content.map((block: { text: string }) => block.text).join('\n')
    expect(catalogText).toContain('call the `skill` tool')
    expect(catalogText).toContain('Canvas UI')
    expect(catalogText).not.toContain('<skill_instructions>')

    const userMessage = { id: 'silent-probe-user', source: { kind: 'user' }, content: [{ type: 'text', text: '$uiverse-components' }] }
    const userDecision = await ctx.events.waterfall('agent/pre-step', { agent, messages: [userMessage], signal }, async () => ({ kind: 'enter', messages: [userMessage] }))
    expect(userDecision.messages.some((message: { source: { kind: string } }) => message.source.kind === 'skill-invocation')).toBe(false)

    const definition = await skills.get('uiverse-components')
    const loaded = await tools.execute({ callId: 'silent-load' as Parameters<typeof tools.execute>[0]['callId'], name: 'skill', arguments: { name: 'uiverse-components' }, signal })
    expect(loaded.isError).toBe(false)
    const full = loaded.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(full).toContain('<skill_content name="uiverse-components">')
    expect(full).toContain(definition!.content)
    expect(full).toContain('solar_ui_source')
    expect(full).toContain('createCanvasParticleScrollBridge')
    expect(full).toContain('createCanvasIsolatedEffect')
    expect(full).toContain('createCanvasHtmlEffect')
    expect(full).not.toContain('DSH sidebar')

    await target.dispose()
    expect(await skills.get('uiverse-components')).toBeUndefined()
    for (const name of ['solar_ui_search', 'solar_ui_source', 'solar_ui_preview']) expect(tools.get(name)).toBeUndefined()
    expect(tools.get('skill')).toBeDefined()
    expect(ctx.get('solarUiComponents')).toBeUndefined()
    const after = await tools.execute({ callId: 'silent-load-after' as Parameters<typeof tools.execute>[0]['callId'], name: 'skill', arguments: { name: 'uiverse-components' }, signal })
    expect(after.isError).toBe(true)
  } finally {
    await target.dispose()
    await ctx.fiber.dispose()
  }
})
