import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { readLayoutOutputs, reportToMarkdown } from './index.mjs'

// Explicit actual inputs keep this test independent of invented report fixtures.
const usage = 'Usage: node tools/fixtures/intelligent-experience-real-output/test.mjs --layouts ABSOLUTE_PRIVATE_DIRECTORY --report ABSOLUTE_VITEST_JSON'
const argv = process.argv.slice(2), args = {}
assert.equal(argv.length, 4, usage)
for (let index = 0; index < argv.length; index += 2) {
  assert.ok(['--layouts', '--report'].includes(argv[index]) && !Object.hasOwn(args, argv[index]) && isAbsolute(argv[index + 1]), usage)
  args[argv[index]] = argv[index + 1]
}
assert.ok(args['--layouts'] && args['--report'], usage)
const root = fileURLToPath(new URL('../../../', import.meta.url))
const bytes = await readFile(args['--report'])
const reportSha256 = createHash('sha256').update(bytes).digest('hex')
const input = { root, report: args['--report'], reportSha256 }
const result = await readLayoutOutputs(args['--layouts'], input)
assert.equal(result.outputs.length, 4)
for (const output of result.outputs) {
  assert.equal(output.raw, await readFile(join(args['--layouts'], output.file), 'utf8'))
  assert.deepEqual(output.payload, output.file.endsWith('.json') ? JSON.parse(output.raw) : output.raw)
}
assert.match(reportToMarkdown(JSON.parse(bytes), { sha256: reportSha256 }).markdown, new RegExp(reportSha256))
await assert.rejects(readLayoutOutputs(args['--layouts'], { ...input, reportSha256: '0'.repeat(64) }), /explicitly supplied Vitest report/)
const scratch = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'iexp-layout-boundary-'))
try {
  await cp(args['--layouts'], scratch, { recursive: true })
  const graphPath = join(scratch, 'graph.json'), graph = JSON.parse(await readFile(graphPath, 'utf8'))
  graph.nodes[0].label = 'altered boundary test input'
  await writeFile(graphPath, JSON.stringify(graph))
  await assert.rejects(readLayoutOutputs(scratch, input), /Layout content differs from actual source: graph.json/)
  await cp(join(args['--layouts'], 'graph.json'), graphPath)
  const receiptPath = join(scratch, 'source-receipt.json'), receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  receipt.graph.nodeCount++
  await writeFile(receiptPath, JSON.stringify(receipt))
  await assert.rejects(readLayoutOutputs(scratch, input), /receipt is stale or changed/)
} finally { await rm(scratch, { recursive: true, force: true }) }
process.stdout.write(JSON.stringify({ ok: true, actualOutputs: result.outputs.length, rawAndPayloadPreserved: true, reportOnlyFormattingPreserved: true, mismatchedReportRejected: true, alteredContentRejected: true, alteredReceiptRejected: true }) + '\n')
