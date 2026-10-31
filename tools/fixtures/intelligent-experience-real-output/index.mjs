import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'

const PROVIDER = 'intelligent-experience-real-output-replay'
const TOOL = 'solar_real_test_report'
const LABEL = '真实测试输出演示（本地回放，无模型调用）'
const LAYOUT_LABEL = '真实内容布局演示（本地源码与测试输出）'
const LAYOUTS = [
  { file: 'graph.json', tool: 'solar_real_layout_graph', label: '真实源码依赖图（导入关系）' },
  { file: 'tasks.json', tool: 'solar_real_layout_tasks', label: '真实测试任务（原始状态）' },
  { file: 'records.json', tool: 'solar_real_layout_records', label: '真实资料记录（页面分析）' },
  { file: 'commands.md', tool: 'solar_real_layout_commands', label: '真实包脚本（仅展示，未执行）' },
]
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
function assert(ok, message) { if (!ok) throw new Error(message) }
function required(name) { const value = process.env[name]; assert(value, `Missing ${name}`); return value }
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')

/** Reconstruct actual source outputs in private scratch storage, then compare every byte. */
export async function readLayoutOutputs(directory, { root, report, reportSha256 }) {
  assert(isAbsolute(directory) && isAbsolute(root) && isAbsolute(report), 'Absolute layout, source root and report paths required')
  directory = await realpath(directory); root = await realpath(root)
  assert(directory !== root && !directory.startsWith(root + sep), 'Layout inputs must be outside the repository')
  const source = await readFile(join(directory, 'source-receipt.json'))
  const receipt = JSON.parse(source)
  assert(receipt.formatVersion === 1 && receipt.tests?.sha256 === reportSha256, 'Layout receipt must reference the explicitly supplied Vitest report')
  assert(sha256(await readFile(report)) === reportSha256, 'Input report changed before layout validation')
  const scratch = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'iexp-layout-validate-'))
  try {
    const helper = join(root, 'tools/real-layout-output.mjs')
    const check = spawnSync(process.execPath, [helper, '--out', scratch, '--tests', report], { cwd: root, encoding: 'utf8', timeout: 30_000, env: process.env })
    assert(check.status === 0, `Actual layout source validation failed: ${check.error?.message ?? check.stderr}`)
    assert(source.equals(await readFile(join(scratch, 'source-receipt.json'))), 'Layout source receipt is stale or changed; regenerate from current actual inputs')
    const outputs = []
    for (const definition of LAYOUTS) {
      const bytes = await readFile(join(directory, definition.file))
      assert(bytes.equals(await readFile(join(scratch, definition.file))), `Layout content differs from actual source: ${definition.file}`)
      const raw = bytes.toString('utf8')
      outputs.push({ ...definition, raw, payload: definition.file.endsWith('.json') ? JSON.parse(raw) : raw, sha256: sha256(bytes) })
    }
    return { sourceSha256: sha256(source), outputs }
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

async function realReport() {
  const bytes = await readFile(required('SOLAR_IEP_REAL_REPORT'))
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert(digest === required('SOLAR_IEP_REAL_REPORT_SHA256'), 'Input report changed since helper validation')
  return reportToMarkdown(JSON.parse(bytes), { sha256: digest })
}

/** Formatting only: no chart types, icons, OpenUI source or fabricated data. */
export function reportToMarkdown(report, { sha256: digest }) {
  assert(/^[0-9a-f]{64}$/.test(digest), 'Report SHA-256 required')
  assert(Array.isArray(report.testResults) && report.testResults.length >= 2, 'At least two actual Vitest file results are required')
  assert(Number.isInteger(report.numTotalTests) && Number.isInteger(report.numPassedTests), 'Invalid Vitest counts')
  const rows = report.testResults.map(file => {
    const duration = file.endTime - file.startTime
    assert(typeof file.name === 'string' && Number.isFinite(duration) && duration >= 0, 'Invalid Vitest file timing')
    return `| ${cell(basename(file.name))} | ${duration} |`
  })
  const markdown = `# ${LABEL}\n\n这是实际执行 Vitest 后保存的 JSON 报告，经本地工具读取并格式化。没有编写 OpenUI、图表类型或图标指令。\n\n## 测试耗时\n\n| 测试文件 | 耗时（ms） |\n| --- | ---: |\n${rows.join('\n')}\n\n## 验证结果\n\n实际通过 ${report.numPassedTests} / ${report.numTotalTests} 项测试，失败 ${report.numFailedTests} 项。\n\n耗时是这一次测试执行的文件耗时，包含测试内部等待；不代表 DSH 性能或优化幅度。\n\n报告 SHA-256：\`${digest}\`\n`
  return { digest, markdown, rows: report.testResults.length, counts: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests } }
}
class ReplayAdapter extends LlmAdapter {
  toolCalls = 0
  constructor(result, tools = [TOOL]) { super(); this.result = result; this.tools = tools }
  async *stream(options) {
    options.signal?.throwIfAborted()
    const nextTool = this.tools[this.toolCalls]
    if (nextTool && (options.tools ?? []).some(tool => tool.name === nextTool)) {
      this.toolCalls++
      const block = { type: 'tool-call', id: randomUUID(), name: nextTool, arguments: '{}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = this.toolCalls ? this.result.markdown : LABEL
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
async function replayLayouts(ctx) {
  const directory = required('SOLAR_IEP_REAL_LAYOUTS')
  const input = { root: required('SOLAR_IEP_REAL_CWD'), report: required('SOLAR_IEP_REAL_REPORT'), reportSha256: required('SOLAR_IEP_REAL_REPORT_SHA256') }
  const source = await readLayoutOutputs(directory, input)
  assert(source.sourceSha256 === required('SOLAR_IEP_REAL_LAYOUTS_SHA256'), 'Layout receipt changed since helper validation')
  const service = ctx.get('solarExperience'), titles = ctx.get('sessionTitle')
  assert(service && titles, 'solarExperience and sessionTitle services required for layout replay')
  const before = await service.settings()
  let executions = 0, blocked = 0
  const disposers = source.outputs.map(output => ctx.tools.register({
    name: output.tool, description: `Read the validated actual local ${output.file}; no model or network request.`, parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      exec.signal.throwIfAborted(); assert(exec.agent, 'Session required')
      assert(sha256(await readFile(join(directory, 'source-receipt.json'))) === source.sourceSha256 && sha256(await readFile(join(directory, output.file))) === output.sha256, `Layout input changed during replay: ${output.file}`)
      executions++
      await service.publish({ source: { sessionId: String(exec.agent.id), callId: String(exec.callId), kind: 'tool', label: output.label }, protocol: 'content', providerId: 'content', raw: output.raw, payload: output.payload })
      return output.raw
    },
  }))
  disposers.push(ctx.llm.registerAdapter([PROVIDER], new ReplayAdapter({ markdown: `${LAYOUT_LABEL}\n已读取四份实际本地输出；未调用外部模型，也未执行所列包脚本。` }, source.outputs.map(output => output.tool))))
  disposers.push(ctx.on('llm/stream', async function* (options, next) { if (options.provider !== PROVIDER) { blocked++; throw new Error('REAL_LAYOUT_DEMO_BLOCKED_EXTERNAL_MODEL') }; yield* next() }, { global: true }))
  const sessionId = `iep-real-layouts-${randomUUID()}`
  let handle
  try {
    handle = await ctx.agents.create({ sessionId, meta: { cwd: input.root }, agentOptions: { provider: PROVIDER, model: 'local-replay' } })
    titles.rename(handle.agent.session, LAYOUT_LABEL)
    handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${LAYOUT_LABEL}\n读取已验证的源码依赖、测试任务、资料记录和包脚本，保留原始普通工具输出。` }] })
    await handle.agent.whenIdle()
    assert(executions === 4 && blocked === 0, 'Expected four actual local layout tool executions and no external model routes')
    const artifacts = await service.artifacts({ sessionId })
    const persistence = await ctx.sessionPersistence.open(sessionId, 'read')
    let events
    try { events = (await persistence.read(0)).events } finally { await persistence.close() }
    const results = source.outputs.map(output => {
      const artifact = artifacts.find(value => value.source.label === output.label && value.source.kind === 'tool')
      assert(artifact?.raw === output.raw && JSON.stringify(artifact.payload) === JSON.stringify(output.payload) && artifact.protocol === 'content', `Layout artifact was not preserved: ${output.file}`)
      const event = events.find(event => event.type === 'tool/result' && event.data?.message?.toolCallId === artifact.source.callId)
      assert(event?.data?.message?.content?.some(block => block.type === 'text' && block.text === output.raw), `Unchanged layout result missing from durable Session: ${output.file}`)
      return { file: output.file, label: output.label, sha256: output.sha256, artifactId: artifact.id, callId: artifact.source.callId, protocol: artifact.protocol, durableResult: true, rawPreserved: true }
    })
    assert(JSON.stringify(await service.settings()) === JSON.stringify(before), 'Layout replay changed shared settings')
    return { ok: true, sessionId, title: LAYOUT_LABEL, sourceSha256: source.sourceSha256, outputs: results, paidModelRequests: 0, localToolExecutions: executions, settingsUnchanged: true }
  } finally { await handle?.dispose(); for (const dispose of disposers.reverse()) dispose() }
}
async function run(ctx) {
  const result = await realReport()
  const service = ctx.get('solarExperience')
  assert(service, 'solarExperience unavailable')
  const before = await service.settings()
  let executions = 0
  const disposeTool = ctx.tools.register({ name: TOOL, description: 'Read the explicitly supplied actual local Vitest JSON report; no network or model request.', parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      exec.signal.throwIfAborted(); assert(exec.agent, 'Session required'); executions++
      const fresh = await realReport()
      await service.publish({ source: { sessionId: String(exec.agent.id), callId: String(exec.callId), kind: 'tool', label: LABEL }, protocol: 'content', providerId: 'content', raw: fresh.markdown, payload: fresh.markdown })
      return fresh.markdown
    },
  })
  const adapter = new ReplayAdapter(result)
  const disposeAdapter = ctx.llm.registerAdapter([PROVIDER], adapter)
  let blocked = 0
  const disposeGuard = ctx.on('llm/stream', async function* (options, next) { if (options.provider !== PROVIDER) { blocked++; throw new Error('REAL_OUTPUT_DEMO_BLOCKED_EXTERNAL_MODEL') }; yield* next() }, { global: true })
  const sessionId = `iep-real-output-${randomUUID()}`
  const handle = await ctx.agents.create({ sessionId, meta: { cwd: required('SOLAR_IEP_REAL_CWD') }, agentOptions: { provider: PROVIDER, model: 'local-replay' } })
  try {
    handle.agent.followup({ id: MessageId(randomUUID()), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `${LABEL}\n读取已实际执行的测试报告并展示原始普通输出。报告摘要 ${result.digest}。` }] })
    await handle.agent.whenIdle()
    assert(executions === 1 && blocked === 0, 'Expected one real local tool execution and no external model routes')
    const artifact = (await service.artifacts({ sessionId })).find(value => value.source.label === LABEL && value.source.kind === 'tool')
    assert(artifact?.raw === result.markdown && artifact.payload === result.markdown && artifact.protocol === 'content', 'Plain output was not preserved unchanged')
    const persistence = await ctx.sessionPersistence.open(sessionId, 'read')
    let events
    try { events = (await persistence.read(0)).events } finally { await persistence.close() }
    assert(events.some(event => event.type === 'tool/result' && event.data?.message?.toolCallId === artifact.source.callId), 'Actual tool result missing from durable Session')
    assert(JSON.stringify(await service.settings()) === JSON.stringify(before), 'Demo changed shared settings')
    return { formatVersion: 1, ok: true, label: LABEL, sessionId, sourceSha256: result.digest, rows: result.rows, counts: result.counts, artifactId: artifact.id, callId: artifact.source.callId, protocol: 'content', paidModelRequests: 0, localToolExecutions: executions, settingsUnchanged: true, rawPreserved: true, markdown: result.markdown }
  } finally { await handle.dispose(); disposeGuard(); disposeAdapter(); disposeTool() }
}
export const name = 'intelligent-experience-real-output'
export const inject = ['appReady', 'sessionPersistence', 'tools', 'llm', 'agents']
export function apply(ctx) {
  let started = false
  return ctx.appReady.onReady(() => {
    if (started) return; started = true
    void run(ctx).then(async receipt => { if (process.env.SOLAR_IEP_REAL_LAYOUTS) receipt.layouts = await replayLayouts(ctx); const path = required('SOLAR_IEP_REAL_RECEIPT'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); ctx.get('appExit')(0) }).catch(error => { process.stderr.write(`real-output-demo: ${error.stack ?? error}\n`); ctx.get('appExit')(1) })
  })
}
