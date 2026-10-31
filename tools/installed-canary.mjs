import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const execFileAsync = promisify(execFile)
const PLUGIN_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PROJECT_ROOT = PLUGIN_DIR
const FIXTURE = join(PROJECT_ROOT, 'tools', 'fixtures', 'intelligent-experience-canary')
const PLUGIN_NAME = '@lisihao/dsh-solar-intelligent-experience-platform'
const FIXTURE_NAME = '@lisihao/dsh-solar-intelligent-experience-canary'
const RECEIPT_DIR = join('solar', 'intelligent-experience-platform', 'installed-canary')
const COMMAND_TIMEOUT_MS = 180_000
const CAPTURE_LIMIT = 128 * 1024
const CREDENTIAL_ENV = /(?:^|_)(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|CREDENTIALS?|PRIVATE_KEY|CLIENT_SECRET|OAUTH|BEARER)(?:$|_)/i
const PROVIDER_ENV = /^(?:DEEPSEEK|OPENAI|ANTHROPIC|CLAUDE|CODEX)(?:_|$)/i

function usage() {
  return [
    'Usage: node tools/installed-canary.mjs --dsh-home ABSOLUTE_EXISTING_PATH --package ABSOLUTE_STABLE_TGZ [--receipt ABSOLUTE_PATH]',
    'The helper creates and retains one uniquely named test profile under the supplied DSH_HOME.',
  ].join('\n')
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--help' || key === '-h') { process.stdout.write(`${usage()}\n`); process.exit(0) }
    if (!['--dsh-home', '--package', '--receipt'].includes(key)) throw new Error(`Unknown argument: ${key}\n${usage()}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`${key} requires an absolute path`)
    if (options[key]) throw new Error(`${key} may be provided only once`)
    options[key] = value
  }
  if (!options['--dsh-home'] || !options['--package']) throw new Error(usage())
  for (const key of ['--dsh-home', '--package', ...(options['--receipt'] ? ['--receipt'] : [])]) {
    if (!isAbsolute(options[key])) throw new Error(`${key} must be absolute: ${options[key]}`)
  }
  return { dshHomeInput: options['--dsh-home'], packageInput: options['--package'], receiptInput: options['--receipt'] }
}

function append(current, chunk) { return (current + String(chunk)).slice(-CAPTURE_LIMIT) }

async function run(executable, args, env, timeoutMs = COMMAND_TIMEOUT_MS) {
  const child = spawn(executable, args, { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  let stdout = '', stderr = '', timedOut = false
  child.stdout?.on('data', chunk => { stdout = append(stdout, chunk) })
  child.stderr?.on('data', chunk => { stderr = append(stderr, chunk) })
  let timer, killTimer
  const result = await new Promise(resolveResult => {
    let settled = false
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); resolveResult(value) }
    child.once('error', error => finish({ status: null, signal: null, error: String(error) }))
    child.once('close', (status, signal) => finish({ status, signal, error: undefined }))
    timer = setTimeout(() => {
      timedOut = true
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM') } catch { /* process already exited */ }
      killTimer = setTimeout(() => {
        try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') } catch { /* process already exited */ }
      }, 2000)
      killTimer.unref?.()
    }, timeoutMs)
    timer.unref?.()
  })
  if (result.status !== 0 || result.signal !== null || result.error || timedOut) {
    throw new Error(`dsh ${args.join(' ')} failed${timedOut ? ' (timeout)' : ''}: ${JSON.stringify({ ...result, timedOut, stdout, stderr })}`)
  }
  return { stdout, stderr }
}

function childEnvironment({ dshHome, home, receiptPath, mode, profile, cwd }) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('DSH_') || key === 'NODE_OPTIONS' || key === 'NODE_PATH' || CREDENTIAL_ENV.test(key) || PROVIDER_ENV.test(key) || /(?:PROXY|AUTH|CREDENTIAL)/i.test(key)
      || /^(?:npm_config_(?:userconfig|globalconfig|registry|_auth|auth_token)|NPM_CONFIG_(?:USERCONFIG|GLOBALCONFIG|REGISTRY|_AUTH|AUTH_TOKEN))$/i.test(key)) delete env[key]
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: join(home, '.agents'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    DSH_TELEMETRY_DISABLED: '1',
    DSH_TOOLS_MODE: 'native',
    DSH_PERMISSION_MODE: 'workspace-write',
    SOLAR_IEP_CANARY_MODE: mode,
    SOLAR_IEP_CANARY_PROFILE: profile,
    SOLAR_IEP_CANARY_CWD: cwd,
    SOLAR_IEP_CANARY_RECEIPT: receiptPath,
  }
}

async function requiredFile(path, label) {
  const info = await stat(path).catch(error => { throw new Error(`${label} is unavailable at ${path}: ${String(error)}`) })
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${path}`)
}

async function packageManifestFromTarball(path) {
  const output = await execFileAsync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  return JSON.parse(output.stdout)
}

async function validateArtifact(path) {
  await requiredFile(path, 'Stable packed plugin artifact')
  if (!/\.(?:tgz|tar\.gz)$/i.test(path)) throw new Error('The plugin argument must be a stable .tgz or .tar.gz package artifact')
  const manifest = await packageManifestFromTarball(path)
  if (manifest.name !== PLUGIN_NAME) throw new Error(`Packed artifact has unexpected package name ${String(manifest.name)}`)
  const archive = await execFileAsync('tar', ['-tzf', path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (!archive.stdout.split(/\r?\n/).includes('package/lib/index.js')) throw new Error('Packed artifact does not contain package/lib/index.js')
  return { manifest, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }
}

async function packageManifest(path) {
  const value = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
  if (value.name !== FIXTURE_NAME) throw new Error(`Canary fixture package has unexpected name ${String(value.name)}`)
  await requiredFile(join(path, value.main ?? 'index.mjs'), 'Canary fixture entry')
  return value
}

async function existingProfileManifests(profilesRoot) {
  let dirs
  try { dirs = await readdir(profilesRoot, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error }
  const snapshots = new Map()
  for (const dir of dirs.filter(entry => entry.isDirectory())) {
    const path = join(profilesRoot, dir.name, 'package.json')
    try {
      const text = await readFile(path, 'utf8')
      snapshots.set(dir.name, createHash('sha256').update(text).digest('hex'))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return snapshots
}

async function profileDirectoryNames(profilesRoot) {
  try { return new Set((await readdir(profilesRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)) }
  catch (error) { if (error.code === 'ENOENT') return new Set(); throw error }
}

async function assertExistingProfilesUnchanged(profilesRoot, snapshots, testProfile) {
  for (const [name, digest] of snapshots) {
    if (name === testProfile) continue
    const current = createHash('sha256').update(await readFile(join(profilesRoot, name, 'package.json'), 'utf8')).digest('hex')
    if (current !== digest) throw new Error(`Existing profile ${name} package.json changed during canary; preserve receipt and inspect before proceeding`)
  }
}

async function readReceipt(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { throw new Error(`Canary fixture receipt is missing or invalid at ${path}: ${String(error)}`) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dshHome = await realpath(args.dshHomeInput)
  if (!(await stat(dshHome)).isDirectory()) throw new Error(`DSH_HOME must already exist as a directory: ${dshHome}`)
  const artifactPath = await realpath(args.packageInput)
  const { manifest, sha256: packageSha256 } = await validateArtifact(artifactPath)
  await packageManifest(FIXTURE)

  let cli
  for (const candidate of [join(PLUGIN_DIR, 'node_modules', '.bin', 'dsh')]) {
    try { await requiredFile(candidate, 'Published DSH CLI'); cli = candidate; break } catch { /* report the missing local dependency below */ }
  }
  if (!cli) throw new Error('Published DSH CLI not found in this repository; run pnpm install --ignore-scripts')

  const profile = `solar-intelligent-experience-canary-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${process.pid}-${randomUUID().slice(0, 8)}`
  const profileRoot = join(dshHome, 'profiles', profile)
  try { await stat(profileRoot); throw new Error(`Unique canary profile already exists; refusing to reuse it: ${profileRoot}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const profilesRoot = join(dshHome, 'profiles')
  const priorProfileManifests = await existingProfileManifests(profilesRoot)
  const priorProfileDirs = await profileDirectoryNames(profilesRoot)
  const receiptPath = args.receiptInput ? resolve(args.receiptInput) : join(dshHome, RECEIPT_DIR, profile, 'receipt.json')
  try { await stat(receiptPath); throw new Error(`Receipt path already exists; refusing to overwrite it: ${receiptPath}`) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const cwd = await realpath(process.cwd())
  const tempHome = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'iep-installed-canary-home-'))
  const overlayPath = join(tempHome, 'iep-canary-overlay.yml')
  await writeFile(overlayPath, "- id: ui-skin-blue-fantasy\n  disabled: true\n", { flag: 'wx', mode: 0o600 })
  const envBase = childEnvironment({ dshHome, home: tempHome, receiptPath, profile, cwd })
  const startedAt = new Date().toISOString()
  let primaryError
  let report
  try {
    for (const packagePath of [artifactPath, FIXTURE]) {
      await run(cli, ['plugin', '--profile', profile, 'add', '--ignore-scripts', packagePath], envBase)
    }
    const installed = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
    const bundles = installed?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes(PLUGIN_NAME) || !bundles.includes(FIXTURE_NAME)) throw new Error(`Unique canary profile did not enable both packages: ${JSON.stringify(bundles)}`)
    await assertExistingProfilesUnchanged(profilesRoot, priorProfileManifests, profile)
    const newProfiles = [...await profileDirectoryNames(profilesRoot)].filter(name => !priorProfileDirs.has(name))
    if (newProfiles.some(name => name !== profile)) throw new Error(`Canary created unexpected profile directories: ${JSON.stringify(newProfiles)}`)

    await run(cli, ['--profile', profile, '--patch', overlayPath], { ...envBase, SOLAR_IEP_CANARY_MODE: 'run' })
    report = await readReceipt(receiptPath)
    if (report.ok === false || report.stage !== 'run-complete') throw new Error(`Canary AgentLoop phase did not complete: ${JSON.stringify(report)}`)
    if (!report.contentArtifactId || !report.openuiArtifactId || report.checks?.openuiRawPreserved !== true) throw new Error('Canary did not produce both source-preserving content and OpenUI artifacts')

    // A second process proves the normal JSONL Session backend and plugin-owned artifact files survive CLI shutdown.
    await run(cli, ['--profile', profile, '--patch', overlayPath], { ...envBase, SOLAR_IEP_CANARY_MODE: 'verify' })
    report = await readReceipt(receiptPath)
    if (report.ok === false || report.stage !== 'verified-after-restart') throw new Error(`Canary persistence verification failed: ${JSON.stringify(report)}`)
    if (report.checks?.noNonFixtureModelRoute !== true || report.blockedModelRequests?.length !== 0) throw new Error('Canary observed an attempted non-fixture model route')
    if (report.checks?.preservedSettings !== true || report.checks?.settingsRestored !== true) throw new Error('Canary did not restore the initial settings preferences')
    if (report.checks?.contentArtifactSurvivedRestart !== true || report.checks?.openuiArtifactSurvivedRestart !== true || report.checks?.widgetStateSurvivedRestart !== true || report.checks?.secondProcessSessionRead !== true) throw new Error('Canary did not verify both generated artifacts, widget state, and the Session after restart')
    const afterSha256 = createHash('sha256').update(await readFile(artifactPath)).digest('hex')
    if (afterSha256 !== packageSha256) throw new Error('Stable package artifact changed during canary execution')
    await assertExistingProfilesUnchanged(profilesRoot, priorProfileManifests, profile)
    const finalNewProfiles = [...await profileDirectoryNames(profilesRoot)].filter(name => !priorProfileDirs.has(name))
    if (finalNewProfiles.length !== 1 || finalNewProfiles[0] !== profile) throw new Error(`Canary profile inventory differs from its unique test profile: ${JSON.stringify(finalNewProfiles)}`)
    report = { ...report, ok: true, startedAt, completedAt: new Date().toISOString(), profile, profilePath: profileRoot, dshHome: '$DSH_HOME', sessionStore: '$DSH_HOME/sessions', artifactPath, packageName: manifest.name, packageVersion: manifest.version, packageSha256, retainedTestProfile: true, existingProfilesUnchanged: true, paidModelRequests: 0 }
  } catch (error) {
    primaryError = error
    const partial = await readReceipt(receiptPath).catch(() => undefined)
    if (partial?.initialSettings && partial.settingWriteIntent === true && !samePrefs(partial.restoredSettings, partial.initialSettings)) {
      try {
        await run(cli, ['--profile', profile, '--patch', overlayPath], { ...envBase, SOLAR_IEP_CANARY_MODE: 'restore-only' }, 90_000)
        report = await readReceipt(receiptPath)
      } catch (restoreError) {
        error.message += `\nCAS restore-only retry failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
      }
    }
    let retainedTestProfile = false
    try { retainedTestProfile = (await stat(profileRoot)).isDirectory() } catch { /* profile installation may have failed before creation */ }
    const fixtureError = partial?.error ?? report?.error
    const helperError = error instanceof Error ? error.message : String(error)
    report = { ...(report ?? partial ?? {}), ok: false, startedAt, failedAt: new Date().toISOString(), profile, profilePath: profileRoot, dshHome: '$DSH_HOME', sessionStore: '$DSH_HOME/sessions', artifactPath, packageName: manifest.name, packageVersion: manifest.version, packageSha256, retainedTestProfile, fixtureError, helperError, error: fixtureError ?? helperError }
  } finally {
    if (report) {
      const finalPath = args.receiptInput ? resolve(args.receiptInput) : join(dshHome, RECEIPT_DIR, profile, 'receipt.json')
      await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 })
      const tempPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(tempPath, `${JSON.stringify({ formatVersion: 1, ...report }, null, 2)}\n`, { mode: 0o600 })
      await rename(tempPath, finalPath)
      report.receiptPath = finalPath
    }
    if (!primaryError) await rm(tempHome, { recursive: true, force: true })
  }
  if (primaryError) {
    primaryError.message += `\nCanary profile retained for inspection: ${profileRoot}\nReceipt: ${args.receiptInput ? resolve(args.receiptInput) : join(dshHome, RECEIPT_DIR, profile, 'receipt.json')}`
    throw primaryError
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function samePrefs(actual, expected) {
  return actual && expected && actual.takeover === expected.takeover && actual.openui === expected.openui && actual.mcpApps === expected.mcpApps
}

main().catch(error => { process.stderr.write(`installed-canary: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1 })
