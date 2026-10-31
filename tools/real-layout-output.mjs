import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const ROOT = resolve(PLUGIN)
const ENTRY = join(PLUGIN, 'src/presentation.ts')
const CATALOG = join(ROOT, 'docs/design/empryo-pages.json')
const PACKAGE = join(PLUGIN, 'package.json')
const usage = 'Usage: node tools/real-layout-output.mjs --out ABSOLUTE_PRIVATE_DIRECTORY [--tests ABSOLUTE_VITEST_JSON]'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const localPath = path => relative(ROOT, path).split(sep).join('/')
const inside = (path, root) => path === root || path.startsWith(root + sep)
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0

function argumentsFor(argv) {
  const args = {}
  if (argv.length % 2) throw new Error(usage)
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1]
    if (!['--out', '--tests'].includes(key) || key in args || !isAbsolute(value ?? '')) throw new Error(usage)
    args[key] = resolve(value)
  }
  if (!args['--out']) throw new Error(usage)
  if (inside(args['--out'], ROOT)) throw new Error('--out must be a private directory outside the repository')
  return args
}

async function jsonFile(path, name) {
  let bytes
  try { bytes = await readFile(path) } catch (error) { throw new Error(`Cannot read ${name}: ${error.code ?? error.message}`) }
  try { return { value: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) } }
  catch { throw new Error(`${name} is not valid JSON`) }
}

async function importGraph() {
  const configuration = ts.readConfigFile(join(PLUGIN, 'tsconfig.json'), ts.sys.readFile)
  if (configuration.error) throw new Error(`Cannot read TypeScript configuration: ${ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n')}`)
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, PLUGIN)
  if (parsed.errors.length) throw new Error(`Invalid TypeScript configuration: ${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n')}`)
  const cache = ts.createModuleResolutionCache(PLUGIN, path => path, parsed.options)
  const pending = [ENTRY], paths = new Map([[ENTRY, 'source-1']])
  const nodes = [], edges = [], files = [], externalImports = new Set(), seenEdges = new Set()
  for (let index = 0; index < pending.length; index++) {
    const path = pending[index], id = paths.get(path)
    const bytes = await readFile(path)
    nodes.push({ id, label: relative(PLUGIN, path).split(sep).join('/') })
    files.push({ path: localPath(path), sha256: digest(bytes) })
    // Asset imports are real graph leaves, not executable modules to parse.
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue
    const source = ts.createSourceFile(path, bytes.toString('utf8'), ts.ScriptTarget.Latest, true)
    const specifiers = []
    const visit = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) specifiers.push(node.argument.literal.text)
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0])) specifiers.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(source)
    for (const specifier of specifiers) {
      const resolution = ts.resolveModuleName(specifier, path, parsed.options, ts.sys, cache).resolvedModule
      let target = resolution?.resolvedFileName
      if (!target && specifier.startsWith('.')) {
        // Published TypeScript resolves JS source imports; literal local assets
        // remain ordinary files (for example the bundled OFL font).
        const literal = resolve(dirname(path), specifier)
        if (ts.sys.fileExists(literal)) target = literal
        else throw new Error(`Unresolved local import ${JSON.stringify(specifier)} in ${localPath(path)}`)
      }
      if (!target || target.split(sep).includes('node_modules')) { externalImports.add(specifier); continue }
      target = resolve(target)
      if (!inside(target, ROOT)) throw new Error(`Local import escapes repository in ${localPath(path)}`)
      if (!paths.has(target)) {
        if (paths.size === 40) throw new Error('Import graph exceeds the supported 40 files; no graph was truncated')
        paths.set(target, `source-${paths.size + 1}`); pending.push(target)
      }
      const edge = { source: id, target: paths.get(target), label: 'imports' }
      const identity = `${edge.source}:${edge.target}`
      if (!seenEdges.has(identity)) {
        if (edges.length === 100) throw new Error('Import graph exceeds the supported 100 edges; no graph was truncated')
        seenEdges.add(identity); edges.push(edge)
      }
    }
  }
  return { graph: { nodes, edges }, receipt: { entry: localPath(ENTRY), relationship: 'Source-level imports, including type-only imports; not runtime flow', nodeCount: nodes.length, edgeCount: edges.length, files, excludedExternalImports: [...externalImports].sort() } }
}

async function catalogRecords() {
  const input = await jsonFile(CATALOG, 'Empryo page catalog')
  if (!record(input.value) || !Array.isArray(input.value.pages)) throw new Error('Empryo page catalog must contain a pages array')
  const eligible = input.value.pages.filter(page => record(page) && text(page.title) && text(page.analysis) && page.analysis.trim().length >= 80 && text(page.url))
  if (eligible.length < 6) throw new Error(`Empryo page catalog has ${eligible.length} substantial named records; six required`)
  const records = eligible.slice(0, 6).map(page => ({ title: page.title, description: page.analysis, source: page.url }))
  return { records, receipt: { path: localPath(CATALOG), sha256: input.sha256, eligibleRecords: eligible.length, selectedRecords: records.length } }
}

async function packageCommands() {
  const input = await jsonFile(PACKAGE, 'Plugin package manifest')
  if (!record(input.value) || !record(input.value.scripts) || !Object.keys(input.value.scripts).length) throw new Error('Plugin package manifest must contain nonempty scripts')
  const scripts = Object.entries(input.value.scripts)
  if (scripts.some(([name, command]) => !text(name) || !text(command))) throw new Error('Plugin package scripts must have nonempty names and string commands')
  const markdown = ['# Package scripts', '', `Source: \`${localPath(PACKAGE)}\`. These commands come from the package manifest; this export does not execute them.`, '', ...scripts.flatMap(([name, command]) => {
    // A fence longer than any source backtick run preserves command text.
    const fence = '`'.repeat(Math.max(3, ...Array.from(command.matchAll(/`+/g), match => match[0].length + 1)))
    return [`## ${name}`, '', `${fence}sh`, command, fence, '']
  })].join('\n')
  return { markdown, receipt: { path: localPath(PACKAGE), sha256: input.sha256, scriptCount: scripts.length } }
}

async function testTasks(path) {
  const input = await jsonFile(path, 'Vitest report')
  if (!record(input.value) || !Array.isArray(input.value.testResults) || !input.value.testResults.length) throw new Error('Vitest report must contain nonempty testResults')
  const tasks = [], statuses = {}
  for (const [suiteIndex, suite] of input.value.testResults.entries()) {
    if (!record(suite) || !Array.isArray(suite.assertionResults)) throw new Error(`Vitest testResults[${suiteIndex}] is missing assertionResults`)
    for (const [index, assertion] of suite.assertionResults.entries()) {
      if (!record(assertion) || !text(assertion.status)) throw new Error(`Vitest assertion ${suiteIndex}:${index} has no actual status`)
      const task = text(assertion.fullName) ? assertion.fullName : Array.isArray(assertion.ancestorTitles) && assertion.ancestorTitles.every(value => typeof value === 'string') && text(assertion.title) ? [...assertion.ancestorTitles, assertion.title].join(' ') : undefined
      if (!text(task) || assertion.failureMessages !== undefined && (!Array.isArray(assertion.failureMessages) || !assertion.failureMessages.every(value => typeof value === 'string'))) throw new Error(`Invalid Vitest assertion ${suiteIndex}:${index}: name or failureMessages`)
      const description = (assertion.failureMessages ?? []).join('\n')
      // Keep actual failure text unchanged; decline private paths rather than
      // silently altering a receipt or exposing local account directories.
      if (/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/i.test(task + description)) throw new Error(`Vitest assertion ${suiteIndex}:${index} contains a private absolute account path`)
      tasks.push({ task, status: assertion.status, description })
      statuses[assertion.status] = (statuses[assertion.status] ?? 0) + 1
    }
  }
  if (!tasks.length) throw new Error('Vitest report contains no assertions')
  return { tasks, receipt: { file: basename(path), sha256: input.sha256, assertionCount: tasks.length, statuses } }
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') { process.stdout.write(usage + '\n'); return }
  const args = argumentsFor(process.argv.slice(2))
  const graph = await importGraph(), catalog = await catalogRecords(), commands = await packageCommands()
  const tests = args['--tests'] ? await testTasks(args['--tests']) : undefined
  const outputs = { 'graph.json': graph.graph, 'records.json': catalog.records, 'commands.md': commands.markdown, ...(tests ? { 'tasks.json': tests.tasks } : {}), 'source-receipt.json': { formatVersion: 1, evidence: 'Local source inspection and optional supplied Vitest output; no runtime or model execution claimed', graph: graph.receipt, catalog: catalog.receipt, commands: commands.receipt, ...(tests ? { tests: tests.receipt } : {}) } }
  for (const name of Object.keys(outputs)) {
    try { await access(join(args['--out'], name)); throw new Error(`Refusing to overwrite existing ${name}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  await mkdir(args['--out'], { recursive: true, mode: 0o700 })
  if (!(await stat(args['--out'])).isDirectory()) throw new Error('--out is not a directory')
  for (const [name, value] of Object.entries(outputs)) await writeFile(join(args['--out'], name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  process.stdout.write(JSON.stringify({ files: Object.keys(outputs), nodes: graph.graph.nodes.length, edges: graph.graph.edges.length, records: catalog.records.length, scripts: commands.receipt.scriptCount, ...(tests ? { tasks: tests.tasks.length } : {}) }) + '\n')
}

main().catch(error => { process.stderr.write(`real-layout-output: ${error.message}\n`); process.exitCode = 1 })
