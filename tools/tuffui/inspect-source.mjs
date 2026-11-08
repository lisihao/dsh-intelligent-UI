#!/usr/bin/env node
/**
 * Generates a provenance-only manifest from an unmodified TuffUI checkout.
 * It copies no component code: the realm build consumes that checkout behind
 * its immutable Git pin and packages its own generated artifact separately.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import ts from 'typescript'

const COMMIT = '378f3eaac693c693d2ec845baf38bf6c0488cb37'
const REPOSITORY = 'https://github.com/yurigdesigner/tuffui.git'
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const source = option('--source') && resolve(option('--source'))
const output = option('--out') && resolve(option('--out'))
if (!source) throw new Error('TUFFUI_SOURCE_REQUIRED: pass --source <fixed-tuffui-checkout>')
if (args.some(value => !['--source', source, '--out', output].includes(value))) throw new Error('TUFFUI_ARGUMENT_INVALID')
const git = value => execFileSync('git', ['-C', source, ...value], { encoding: 'utf8' }).trim()
if (git(['rev-parse', 'HEAD']) !== COMMIT) throw new Error('TUFFUI_SOURCE_COMMIT_MISMATCH')
if (git(['status', '--porcelain']) !== '') throw new Error('TUFFUI_SOURCE_DIRTY')
const sha256 = sourceText => createHash('sha256').update(sourceText).digest('hex')
const registryText = await readFile(join(source, 'registry.json'), 'utf8')
const registry = JSON.parse(registryText)
if (!Array.isArray(registry.items)) throw new Error('TUFFUI_REGISTRY_INVALID')
function propMembers(type, aliases, ast, visited = new Set()) {
  if (!type) return new Map()
  if (ts.isParenthesizedTypeNode(type)) return propMembers(type.type, aliases, ast, visited)
  if (ts.isIntersectionTypeNode(type)) {
    const merged = new Map()
    for (const member of type.types) for (const [name, value] of propMembers(member, aliases, ast, visited)) merged.set(name, value)
    return merged
  }
  if (ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type)) {
    const merged = new Map()
    for (const member of type.members) if (ts.isPropertySignature(member) && member.name) {
      const name = member.name.getText(ast).replace(/^['"]|['"]$/gu, '')
      merged.set(name, { optional: Boolean(member.questionToken), sourceType: member.type?.getText(ast) ?? 'unknown' })
    }
    return merged
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text
    if (visited.has(name)) return new Map()
    const declaration = aliases.get(name)
    if (declaration) { const next = new Set(visited); next.add(name); return propMembers(ts.isTypeAliasDeclaration(declaration) ? declaration.type : declaration, aliases, ast, next) }
  }
  return new Map()
}
function literalsFor(sourceType) {
  const strings = [...sourceType.matchAll(/(['"])(.*?)\1/gu)].map(match => match[2])
  if (strings.length && /^(?:\s*['"].+?['"]\s*\|?)+$/u.test(sourceType)) return strings
  const numbers = [...sourceType.matchAll(/(?:^|\|)\s*(-?\d+(?:\.\d+)?)\s*(?=\||$)/gu)].map(match => Number(match[1]))
  return numbers.length && /^(?:\s*-?\d+(?:\.\d+)?\s*\|?)+$/u.test(sourceType) ? numbers : undefined
}
function wireTypeFor(sourceType, name) {
  const type = sourceType.replace(/\s+/gu, ' ').trim()
  // A resolved object alias can contain nested callbacks, arrays and React
  // nodes. Its top-level transport is still one JSON object, so classify its
  // outer syntax before inspecting member text.
  if (/^\{/.test(type) || /^\bRecord</u.test(type)) return 'object'
  if (/^(?:readonly\s+)?(?:[A-Za-z][A-Za-z0-9]*|\([^)]*\))\[\]$/u.test(type) || /^(?:Readonly)?Array</u.test(type)) return 'array'
  if (name.startsWith('on') && /^[A-Z]/u.test(name.slice(2))) return 'callback'
  if (/=>|React\.Dispatch|React\.SetStateAction/u.test(type)) return 'callback'
  if (/React\.(?:ComponentType|ElementType)|\bIcon(?:\b|Props)/u.test(type) || name === 'icon' || name === 'as') return 'unsupported'
  if (/\bDate(?:Range)?\b/u.test(type)) return 'date'
  if (/React\.(?:ReactNode|ReactElement)|JSX\.Element|\bReactNode\b/u.test(type) || ['children', 'trigger', 'footer', 'aside', 'headerAction'].includes(name)) return 'renderable'
  if (/^(?:string|`[^`]*`)(?:\s*\|\s*(?:string|`[^`]*`|['"][^'"]*['"]))*$/u.test(type) || literalsFor(type)?.every(value => typeof value === 'string')) return 'string'
  if (/^number(?:\s*\|\s*number)*$/u.test(type) || literalsFor(type)?.every(value => typeof value === 'number')) return 'number'
  if (/^boolean(?:\s*\|\s*boolean)*$/u.test(type)) return 'boolean'
  if (/\b(?:[A-Za-z][A-Za-z0-9]*(?:Data|Props|State|Item|Row|Series|Option|Config|Value|Message|File|Source|Stat|Slot|Checkpoint|Memory|Attachment|Conversation|Agent|Span|Case|Metric|Request|Result|Segment|Bar|Node|Bin))\b/u.test(type)) return 'object'
  if (/\[\]|(?:Readonly)?Array<|\bArrayLike</u.test(type)) return 'array'
  return 'unknown'
}
function resolvedTypeFor(sourceType, aliases, ast, visited = new Set()) {
  const name = sourceType.trim()
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name) || visited.has(name)) return sourceType
  const declaration = aliases.get(name)
  if (!declaration || !ts.isTypeAliasDeclaration(declaration)) return sourceType
  const next = new Set(visited); next.add(name)
  return resolvedTypeFor(declaration.type.getText(ast), aliases, ast, next)
}
function exportsFor(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const output = []
  const aliases = new Map()
  const collectAliases = node => { if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) aliases.set(node.name.text, node); ts.forEachChild(node, collectAliases) }
  collectAliases(ast)
  const exported = node => Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
  const sourceProps = parameter => {
    if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return []
    const declarations = propMembers(parameter.type, aliases, ast)
    return parameter.name.elements.map(element => {
      const name = (element.propertyName ?? element.name).getText(ast)
      const declared = declarations.get(name)
      const sourceType = declared?.sourceType ?? (name.startsWith('on') ? '(...args: unknown[]) => void' : name === 'children' ? 'React.ReactNode' : 'unknown')
      const resolvedType = resolvedTypeFor(sourceType, aliases, ast)
      const literals = literalsFor(resolvedType)
      // A prop carried by React.ComponentProps or another unresolved external
      // intersection is not known to be required. Treat it as optional rather
      // than falsely rejecting a valid native default.
      return { name, optional: declared?.optional ?? true, sourceType, wireType: wireTypeFor(resolvedType, name), ...(literals ? { literals } : {}) }
    }).filter(prop => prop.name !== 'props')
  }
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && exported(node) && node.name && node.parameters[0] && ts.isObjectBindingPattern(node.parameters[0].name)) {
      output.push({ name: node.name.text, props: sourceProps(node.parameters[0]) })
    }
    if (ts.isVariableStatement(node) && exported(node)) for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isArrowFunction(declaration.initializer) || !declaration.initializer.parameters[0] || !ts.isObjectBindingPattern(declaration.initializer.parameters[0].name)) continue
      output.push({ name: declaration.name.text, props: sourceProps(declaration.initializer.parameters[0]) })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  const names = new Set()
  return output.filter(item => !names.has(item.name) && names.add(item.name))
}
const entries = []
for (const item of registry.items) {
  if (item?.type !== 'registry:ui' && item?.type !== 'registry:block') continue
  const sourcePath = item.files?.[0]?.path
  if (typeof item.name !== 'string' || typeof sourcePath !== 'string' || !/^registry\/[a-z0-9-]+\/[a-z0-9-]+\.tsx$/u.test(sourcePath)) throw new Error('TUFFUI_REGISTRY_ENTRY_INVALID')
  const text = await readFile(join(source, sourcePath), 'utf8')
  const exported = exportsFor(sourcePath, text)
  if (!exported.length) throw new Error(`TUFFUI_RENDER_EXPORT_MISSING:${item.name}`)
  entries.push({ id: item.name, kind: item.type === 'registry:ui' ? 'ui' : 'block', title: String(item.title ?? item.name), description: String(item.description ?? ''), sourcePath, sha256: sha256(text), exports: exported })
}
if (entries.length !== 76 || new Set(entries.map(entry => entry.id)).size !== 76) throw new Error(`TUFFUI_VISUAL_ENTRY_COUNT:${entries.length}`)
const manifest = { formatVersion: 1, repository: REPOSITORY, commit: COMMIT, license: 'MIT', registrySha256: sha256(registryText), entries }
const serialized = JSON.stringify(manifest, null, 2) + '\n'
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized) }
else process.stdout.write(serialized)
