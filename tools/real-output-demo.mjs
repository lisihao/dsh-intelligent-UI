import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, stat, mkdtemp, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { readLayoutOutputs } from './fixtures/intelligent-experience-real-output/index.mjs'
const PLUGIN = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ROOT = PLUGIN
const FIXTURE = join(ROOT, 'tools/fixtures/intelligent-experience-real-output')
const PACKAGE = '@lisihao/dsh-solar-intelligent-experience-platform'
const help = 'Usage: node tools/real-output-demo.mjs --dsh-home ABSOLUTE_EXISTING_HOME --package ABSOLUTE_STABLE_TGZ --report ABSOLUTE_VITEST_JSON --receipt ABSOLUTE_NEW_RECEIPT [--layouts ABSOLUTE_PRIVATE_DIRECTORY]'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function manifests(home) {
  const result = new Map()
  for (const dir of await readdir(join(home, 'profiles'), { withFileTypes: true })) if (dir.isDirectory()) {
    try { result.set(dir.name, hash(await readFile(join(home, 'profiles', dir.name, 'package.json')))) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return result
}
async function run(cli, args, env) {
  const child = spawn(cli, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64 * 1024) })
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000)
  try { const code = await new Promise((res, rej) => { child.on('error', rej); child.on('close', res) }); if (code !== 0) throw new Error(`dsh ${args.join(' ')} failed (${code}): ${output}`) } finally { clearTimeout(timer) }
}
async function main() {
  if (process.argv.includes('--help')) { process.stdout.write(help + '\n'); return }
  const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) => process.argv.slice(2 + index * 2, 4 + index * 2)))
  for (const key of ['--dsh-home', '--package', '--report', '--receipt']) if (!isAbsolute(args[key] ?? '')) throw new Error(help)
  if (Object.keys(args).some(key => !['--dsh-home', '--package', '--report', '--receipt', '--layouts'].includes(key)) || args['--layouts'] && !isAbsolute(args['--layouts'])) throw new Error(help)
  const home = args['--dsh-home'], archive = args['--package'], report = args['--report'], receipt = args['--receipt']
  if (!(await stat(home)).isDirectory() || !archive.endsWith('.tgz')) throw new Error('Existing DSH home and stable .tgz required')
  try { await stat(receipt); throw new Error('Refusing to overwrite existing receipt') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  if (manifest.name !== PACKAGE) throw new Error('Unexpected package archive')
  const reportBytes = await readFile(report), parsed = JSON.parse(reportBytes)
  if (!Array.isArray(parsed.testResults) || parsed.testResults.length < 2) throw new Error('Actual Vitest JSON report required')
  const layouts = args['--layouts'] ? await readLayoutOutputs(args['--layouts'], { root: ROOT, report, reportSha256: hash(reportBytes) }) : undefined
  const before = await manifests(home), packageSha256 = hash(await readFile(archive))
  const profile = `solar-real-output-${Date.now()}-${randomUUID().slice(0, 8)}`
  const temp = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'iexp-real-output-'))
  const overlay = join(temp, 'overlay.yml')
  await writeFile(overlay, '- id: ui-skin-blue-fantasy\n  disabled: true\n', { flag: 'wx', mode: 0o600 })
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('DSH_') || key.startsWith('SOLAR_IEP_REAL_') || key === 'NODE_OPTIONS' || key === 'NODE_PATH' || /(?:TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PROXY|AUTH)/i.test(key) || /^(?:OPENAI|ANTHROPIC|CLAUDE|CODEX|DEEPSEEK)_/.test(key)) delete env[key]
  Object.assign(env, { HOME: temp, USERPROFILE: temp, DSH_HOME: home, DSH_AGENTS_HOME: join(temp, '.agents'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'cache'), XDG_DATA_HOME: join(temp, 'data'), XDG_STATE_HOME: join(temp, 'state'), DSH_TELEMETRY_DISABLED: '1', DSH_TOOLS_MODE: 'native', DSH_PERMISSION_MODE: 'workspace-write', SOLAR_IEP_REAL_REPORT: report, SOLAR_IEP_REAL_REPORT_SHA256: hash(reportBytes), SOLAR_IEP_REAL_RECEIPT: receipt, SOLAR_IEP_REAL_CWD: ROOT })
  if (layouts) Object.assign(env, { SOLAR_IEP_REAL_LAYOUTS: args['--layouts'], SOLAR_IEP_REAL_LAYOUTS_SHA256: layouts.sourceSha256 })
  const cli = join(PLUGIN, 'node_modules/.bin/dsh')
  for (const path of [archive, FIXTURE]) await run(cli, ['plugin', '--profile', profile, 'add', '--ignore-scripts', path], env)
  await run(cli, ['--profile', profile, '--patch', overlay], env)
  const result = JSON.parse(await readFile(receipt, 'utf8'))
  if (!result.ok || result.sourceSha256 !== hash(reportBytes) || result.paidModelRequests !== 0 || result.localToolExecutions !== 1) throw new Error('Invalid demo receipt')
  if (layouts && (!result.layouts?.ok || result.layouts.sourceSha256 !== layouts.sourceSha256 || result.layouts.localToolExecutions !== 4 || result.layouts.paidModelRequests !== 0 || result.layouts.outputs?.length !== 4 || layouts.outputs.some(output => !result.layouts.outputs.some(value => value.file === output.file && value.sha256 === output.sha256 && value.durableResult && value.rawPreserved)))) throw new Error('Invalid actual layout replay receipt')
  const after = await manifests(home)
  for (const [name, digest] of before) if (after.get(name) !== digest) throw new Error(`Existing profile changed: ${name}`)
  if (hash(await readFile(archive)) !== packageSha256 || hash(await readFile(report)) !== result.sourceSha256) throw new Error('Input changed during replay')
  if (layouts) {
    if (hash(await readFile(join(args['--layouts'], 'source-receipt.json'))) !== layouts.sourceSha256) throw new Error('Layout source receipt changed during replay')
    for (const output of layouts.outputs) if (hash(await readFile(join(args['--layouts'], output.file))) !== output.sha256) throw new Error(`Layout input changed during replay: ${output.file}`)
  }
  const enriched = { ...result, profile, profilePath: join(home, 'profiles', profile), packageSha256, existingProfilesUnchanged: true }
  await writeFile(receipt, JSON.stringify(enriched, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify({ ...enriched, markdown: undefined, receiptPath: receipt }, null, 2) + '\n')
}
main().catch(error => { process.stderr.write((error.stack ?? String(error)) + '\n'); process.exitCode = 1 })
