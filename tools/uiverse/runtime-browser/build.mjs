import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

function exportComponents(directory) {
  return new Promise((resolveOutput, rejectOutput) => {
    void build({
      absWorkingDir: root,
      entryPoints: ['tools/uiverse/runtime-browser/registry-export.ts'],
      outfile: join(directory, 'registry-export.cjs'),
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
    }).then(() => {
      const child = spawn(process.execPath, [join(directory, 'registry-export.cjs')], { cwd: root, env: { ...process.env, UIVERSE_RUNTIME_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk.toString() })
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.once('error', rejectOutput)
      child.once('exit', code => code === 0 ? resolveOutput(stdout) : rejectOutput(new Error(`UIVERSE_RUNTIME_REGISTRY_EXPORT_FAILED:${code ?? 'unknown'}:${stderr.slice(-600)}`)))
    }, rejectOutput)
  })
}

export async function buildRuntimeBrowserFixture({ componentIds, keepMounted = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'uiverse-runtime-browser-'))
  try {
    const [componentJson, compressedCss] = await Promise.all([
      exportComponents(directory),
      readFile(join(root, 'resources/uiverse/tailwind.css.gz')),
    ])
    const components = JSON.parse(componentJson)
    if (!Array.isArray(components)) throw new Error('UIVERSE_RUNTIME_BROWSER_COMPONENTS_INVALID')
    const selected = componentIds === undefined ? components : (() => {
      if (!Array.isArray(componentIds) || !componentIds.length || componentIds.length > 32 || componentIds.some(id => typeof id !== 'string')) throw new Error('UIVERSE_RUNTIME_BROWSER_IDS_INVALID')
      const byId = new Map(components.map(component => [component.id, component]))
      const missing = componentIds.filter(id => !byId.has(id))
      if (missing.length) throw new Error(`UIVERSE_RUNTIME_BROWSER_ID_UNKNOWN:${missing.join(',')}`)
      return componentIds.map(id => byId.get(id))
    })()
    await build({
      absWorkingDir: root,
      entryPoints: ['tools/uiverse/runtime-browser/fixture.ts'],
      outfile: join(directory, 'fixture.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      define: {
        UIVERSE_RUNTIME_COMPONENTS: JSON.stringify(selected),
        UIVERSE_RUNTIME_SHARED_CSS: JSON.stringify(gunzipSync(compressedCss).toString('utf8')),
        UIVERSE_RUNTIME_KEEP_MOUNTED: JSON.stringify(keepMounted === true),
      },
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    directory,
    async dispose() { await rm(directory, { recursive: true, force: true }) },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fixture = await buildRuntimeBrowserFixture()
  process.stdout.write(`UIVERSE_RUNTIME_BROWSER_FIXTURE=${fixture.directory}\n`)
}
