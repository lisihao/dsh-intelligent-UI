import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, unlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SessionStore, SessionId, type Session } from '@deepseek-ai/dsh-session'
import { McpHost } from '../src/mcp-host.js'
import { initialSettings } from '../src/contracts.js'
// @ts-expect-error JavaScript fixture
import { startMcpFixture } from '../tools/mcp-fixture.mjs'

describe('MCP Apps DSH host', () => {
  let fixture: { url: string, close(): Promise<void> }; let root: string; let host: McpHost
  let ctx: Context; let agent: Agent; let session: Session; let failFlush = false; let opened: Awaited<ReturnType<McpHost['open']>>
  const settings = { ...initialSettings(), takeover: true, mcpApps: true }
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-host-')); fixture = await startMcpFixture()
    ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => undefined, section: () => () => undefined, getSectionOrder: () => 0 })
    const sessionStore = new SessionStore(ctx)
    session = sessionStore.create(SessionId('fixture-session'))
    ctx.on('session/flush', async current => { if (failFlush) throw new Error('fixture flush failed'); await writeFile(join(root, 'session-flushed.json'), JSON.stringify(current.ownEvents())) })
    agent = { id: 'fixture-session', session, ctx, status: 'running' } as unknown as Agent
    ctx.provide('agents', { get: (id: Agent['id']) => id === agent.id ? agent : undefined })
    new ToolRuntime(ctx)
    host = new McpHost(ctx, { endpoint: fixture.url, root, settings: () => settings })
  })
  afterAll(async () => { await host?.dispose(); await fixture?.close(); if (root) await rm(root, { recursive: true, force: true }) })
  it('lists only model-visible tools and runs initial call through DSH', async () => {
    expect((await host.list()).map(tool => tool.name)).not.toContain('fixture_increment')
    const name = `solar_mcp_${createHash('sha256').update('fixture_open').digest('hex').slice(0, 24)}`
    const call = await ctx.tools.execute({ callId: ToolCallId('real-model-call'), name, arguments: { value: 7 }, agent, signal: new AbortController().signal })
    expect(call.isError).toBe(false)
    expect(call.meta).toMatchObject({ type: 'solar-experience', protocol: 'mcp-app', payload: { toolName: 'fixture_open', input: { value: 7 }, result: { content: [{ text: 'value=7' }] } } })
    const before = await readdir(join(root, 'mcp-actions'))
    opened = await host.open({ sessionId: String(agent.id), toolName: 'fixture_open', input: { value: 7 }, result: { content: [{ type: 'text', text: 'original-result' }] }, hostOrigin: 'http://127.0.0.1:4444' })
    expect(opened.result.content).toMatchObject([{ text: 'original-result' }])
    expect(opened.html).toContain('Fixture view')
    expect(await readdir(join(root, 'mcp-actions'))).toEqual(before)
  })
  it('rejects model-origin calls without a live capability and enforces owner', async () => {
    const result = await ctx.tools.execute({ callId: ToolCallId('bad-token'), name: 'solar_mcp_app_action', arguments: { capability: '0'.repeat(64), instanceId: opened.instanceId, mode: 'app', name: 'fixture_increment', args: { value: 2 } }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    await expect(host.action({ sessionId: 'other', instanceId: opened.instanceId, commandId: 'other', name: 'fixture_increment', args: { value: 2 } })).rejects.toThrow('unavailable')
  })
  it('enforces a real DSH guard before reaching the server', async () => {
    const remove = ctx.tools.guard(execution => execution.name === 'solar_mcp_app_action' ? 'blocked by fixture guard' : undefined)
    const result = await host.action({ sessionId: String(agent.id), instanceId: opened.instanceId, commandId: 'guarded', name: 'fixture_increment', args: { value: 2 } })
    expect(result.isError).toBe(true)
    expect(result.content).toMatchObject([{ text: expect.stringContaining('blocked by fixture guard') }])
    remove()
  })
  it('records an action, returns a prior receipt, and fences uncertain outcomes', async () => {
    const input = { sessionId: String(agent.id), instanceId: opened.instanceId, commandId: 'command-one', name: 'fixture_increment', args: { value: 2 } }
    expect((await host.action(input)).content).toMatchObject([{ text: '3' }])
    const persisted = JSON.parse(await readFile(join(root, 'session-flushed.json'), 'utf8'))
    const notices = persisted.filter((event: any) => event.type === 'user/message' && event.data.source.kind === 'solar-mcp-app' && event.data.content[0].text.includes('command-one'))
    expect(notices).toHaveLength(2)
    expect(JSON.parse(notices[0].data.content[0].text)).toMatchObject({ commandId: 'command-one', phase: 'requested', arguments: { value: 2 } })
    expect(JSON.parse(notices[1].data.content[0].text)).toMatchObject({ commandId: 'command-one', phase: 'settled', result: { content: [{ text: '3' }] } })
    const seq = session.seq
    expect((await host.action(input)).content).toMatchObject([{ text: '3' }])
    expect(session.seq).toBe(seq)
    await expect(host.action({ ...input, args: { value: 4 } })).rejects.toThrow('conflicts')
    const directory = join(root, 'mcp-actions'); const names = await readdir(directory)
    // Locate the result for this command by reading paired requests.
    for (const name of names.filter(n => n.endsWith('.request.json'))) {
      const request = JSON.parse(await readFile(join(directory, name), 'utf8'))
      if (request.commandId === input.commandId) await unlink(join(directory, name.replace('.request.json', '.result.json')))
    }
    await expect(host.action(input)).rejects.toThrow('uncertain')
  })
  it('does not dispatch when the Session durability checkpoint fails', async () => {
    let dispatches = 0
    const remove = ctx.tools.guard(execution => { if (execution.name === 'solar_mcp_app_action') dispatches++; return undefined })
    failFlush = true
    const input = { sessionId: String(agent.id), instanceId: opened.instanceId, commandId: 'flush-failure', name: 'fixture_increment', args: { value: 5 } }
    await expect(host.action(input)).rejects.toThrow('fixture flush failed')
    expect(dispatches).toBe(0)
    failFlush = false
    await expect(host.action(input)).rejects.toThrow('uncertain')
    remove()
  })
  it('disables subsequent actions and closes resources', async () => {
    settings.mcpApps = false
    await expect(host.action({ sessionId: String(agent.id), instanceId: opened.instanceId, commandId: 'disabled', name: 'fixture_increment', args: { value: 2 } })).rejects.toThrow('disabled')
    await host.closeAll(); expect(host.status().instances).toBe(0)
  })
})
