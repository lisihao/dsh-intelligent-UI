/** Builds a private React 18 opaque-parent page from committed synthetic templates. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const templateRoot = join(dirname(fileURLToPath(import.meta.url)), 'browser-proof')
function fail(code) { throw new Error(code) }
function frameOrigin(value) {
  if (typeof value !== 'string') fail('TUFFUI_REACT18_HARNESS_FRAME_ORIGIN_REQUIRED')
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/') fail('TUFFUI_REACT18_HARNESS_FRAME_ORIGIN_INVALID')
  return url.origin
}
function runtimeEndpoint(value) {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9._-]{1,120}$/u.test(value)) fail('TUFFUI_REACT18_HARNESS_RUNTIME_ENDPOINT_INVALID')
  return value
}
function template(source, replacements) {
  let output = source
  for (const [name, value] of Object.entries(replacements)) {
    const token = `__${name}__`
    if (!output.includes(token)) fail('TUFFUI_REACT18_HARNESS_TEMPLATE_TOKEN_MISSING')
    output = output.replaceAll(token, value)
  }
  if (/__[A-Z0-9_]+__/u.test(output)) fail('TUFFUI_REACT18_HARNESS_TEMPLATE_TOKEN_UNRESOLVED')
  return output
}
async function scenario(name) {
  let raw
  try { raw = JSON.parse(await readFile(join(templateRoot, 'scenarios.json'), 'utf8')) }
  catch { fail('TUFFUI_REACT18_HARNESS_SCENARIOS_INVALID') }
  const value = raw?.formatVersion === 1 && raw.scenarios?.[name]
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.selection || typeof value.original !== 'string') fail('TUFFUI_REACT18_HARNESS_SCENARIO_INVALID')
  return value
}

/** The resulting files are private browser fixtures; no compiled artifact enters this repository. */
export async function buildOpaqueParent(options) {
  if (!options || !options.repo || !options.output || !options.sourceManifestPath || !options.typeManifestPath || Boolean(options.frameOrigin) === Boolean(options.runtimeEndpoint)) fail('TUFFUI_REACT18_HARNESS_ARGUMENTS')
  const repo = resolve(options.repo), output = resolve(options.output)
  const frame = options.frameOrigin ? frameOrigin(options.frameOrigin) : undefined
  const runtime = options.runtimeEndpoint ? runtimeEndpoint(options.runtimeEndpoint) : undefined
  const selected = await scenario(options.scenario ?? 'data-table')
  const [catalogBytes, typeBytes, entryTemplate, html] = await Promise.all([
    readFile(options.sourceManifestPath), readFile(options.typeManifestPath),
    readFile(join(templateRoot, 'parent-entry.tsx.template'), 'utf8'),
    readFile(join(templateRoot, 'index.html.template'), 'utf8'),
  ])
  const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(catalogBytes))
  const typeSchemas = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typeBytes))
  if (catalog?.entries?.length !== 76 || typeSchemas?.formatVersion !== 1) fail('TUFFUI_REACT18_HARNESS_ARTIFACT_INVALID')
  await mkdir(output, { recursive: true })
  const contextModule = join(output, 'composition-runtime-context.ts')
  await writeFile(contextModule, "import { createContext } from 'react'\nexport const CompositionRuntimeContext = createContext({})\n")
  const runtimeExpression = frame
    ? JSON.stringify({ protocolVersion: 1, library: 'tuffui', sourceCommit: '378f3eaac693c693d2ec845baf38bf6c0488cb37', frameUrl: `${frame}/tuffui-realm.html` })
    : `await fetch(${JSON.stringify(runtime)}, { credentials: 'omit' }).then(async response => { if (!response.ok) throw new Error('TUFFUI_REACT18_HARNESS_RUNTIME_UNAVAILABLE'); return await response.json() })`
  const source = template(entryTemplate, {
    CONTEXT_MODULE: JSON.stringify(contextModule),
    VIEW_MODULE: JSON.stringify(join(repo, 'src/tuffui/view.ts')),
    CATALOG_JSON: JSON.stringify(catalog),
    TYPE_SCHEMAS_JSON: JSON.stringify(typeSchemas),
    RUNTIME_INFO_EXPRESSION: runtimeExpression,
    SELECTION_JSON: JSON.stringify(selected.selection),
    ORIGINAL_SOURCE_JSON: JSON.stringify(selected.original),
  })
  const entry = join(output, 'parent-entry.tsx')
  await writeFile(entry, source)
  await build({
    absWorkingDir: repo, nodePaths: [join(repo, 'node_modules')], entryPoints: [entry], outfile: join(output, 'parent.js'), bundle: true, platform: 'browser', target: 'es2022', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'tuffui-react18-context', setup(esbuild) {
      esbuild.onResolve({ filter: /^\.\.\/adaptive-ui\/view\.js$/ }, args => args.importer.endsWith('/src/tuffui/view.ts') ? { path: contextModule } : undefined)
    } }],
  })
  await writeFile(join(output, 'index.html'), html)
  return Object.freeze({ output, scenario: options.scenario ?? 'data-table', ...(frame ? { frameOrigin: frame } : { runtimeEndpoint: runtime }) })
}
