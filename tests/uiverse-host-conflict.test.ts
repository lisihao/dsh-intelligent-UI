import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { expect, test } from 'vitest'
import { installUiverse } from '../src/uiverse/host.js'

function context() {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
  const tools = new ToolRuntime(ctx)
  const skills = new SkillRegistry(ctx)
  return { ctx, tools, skills }
}

test('a former companion tool blocks installation before asset reads and remains registered', async () => {
  const { ctx, tools, skills } = context()
  const former = defineTool({ name: 'solar_ui_source', description: 'Former companion', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: async () => { throw new Error('FORMER_TOOL_MUST_NOT_RUN') } })
  tools.register(former)
  try {
    await expect(installUiverse(ctx, '/private/tmp/nonexistent-uiverse-assets')).rejects.toThrow('UIVERSE_REGISTRATION_CONFLICT: solar_ui_source')
    expect(tools.get('solar_ui_source')).toBe(former)
    expect(tools.get('solar_ui_search')).toBeUndefined()
    expect(await skills.get('uiverse-components')).toBeUndefined()
    expect(ctx.get('solarUiComponents')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

test('a former skill is preserved instead of being silently shadowed', async () => {
  const { ctx, tools, skills } = context()
  skills.register({ name: 'uiverse-components', description: 'Former skill', content: 'Keep me', source: 'bundled' })
  try {
    await expect(installUiverse(ctx, '/private/tmp/nonexistent-uiverse-assets')).rejects.toThrow('UIVERSE_REGISTRATION_CONFLICT: skill:uiverse-components')
    expect((await skills.get('uiverse-components'))?.content).toBe('Keep me')
    expect(tools.get('solar_ui_search')).toBeUndefined()
    expect(ctx.get('solarUiComponents')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})

test('a former read-only service is preserved without taking any tool names', async () => {
  const { ctx, tools } = context()
  const former = { former: true }
  ctx.provide('solarUiComponents', former)
  try {
    await expect(installUiverse(ctx, '/private/tmp/nonexistent-uiverse-assets')).rejects.toThrow('UIVERSE_REGISTRATION_CONFLICT: solarUiComponents')
    expect(ctx.get('solarUiComponents')).toBe(former)
    expect(tools.get('solar_ui_source')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})
