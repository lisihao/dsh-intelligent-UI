#!/usr/bin/env node
/** Generate recursively checked JSON transport schemas from the pinned TS source. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import ts from 'typescript'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const source = option('--source') && resolve(option('--source'))
const manifestPath = option('--manifest') && resolve(option('--manifest'))
const output = option('--out') && resolve(option('--out'))
if (!source || !manifestPath || !output || args.some(value => !['--source', source, '--manifest', manifestPath, '--out', output].includes(value))) throw new Error('TUFFUI_TYPE_SCHEMA_ARGUMENTS')
const sourceManifestBytes = await readFile(manifestPath)
const sourceManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sourceManifestBytes))
if (sourceManifest?.formatVersion !== 1 || !Array.isArray(sourceManifest.entries) || sourceManifest.entries.length !== 76) throw new Error('TUFFUI_TYPE_SOURCE_MANIFEST_INVALID')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const rootNames = sourceManifest.entries.map(entry => join(source, entry.sourcePath))
const program = ts.createProgram({ rootNames, options: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, baseUrl: source, paths: { '@/*': ['*'] }, skipLibCheck: true, strict: true, noEmit: true } })
const checker = program.getTypeChecker()

function findFunction(sourceFile, name) {
  let result
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return result
}
function typeText(type) { return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope) }
function literal(value) { return { kind: 'literal', value } }
function propertyType(type, name, node) {
  const symbol = checker.getPropertyOfType(type, name)
  if (!symbol) return undefined
  return { type: checker.getTypeOfSymbolAtLocation(symbol, node), optional: Boolean(symbol.flags & ts.SymbolFlags.Optional) }
}
function schemaFor(type, stack = new Set(), depth = 0) {
  if (depth > 12) return { kind: 'opaque', reason: 'maximum-source-schema-depth' }
  const text = typeText(type)
  if (/\bJsonValue\b/u.test(text)) return { kind: 'json' }
  if (/\bReact(?:\.ReactNode|Node|Element)|\bJSX\.Element\b/u.test(text)) return { kind: 'renderable' }
  if (/\bDate\b/u.test(text) && !/DateTimeFormatOptions/u.test(text)) return { kind: 'date' }
  if (type.flags & ts.TypeFlags.Null || type.flags & ts.TypeFlags.Undefined || type.flags & ts.TypeFlags.Void) return { kind: 'null' }
  if (type.isStringLiteral()) return literal(type.value)
  if (type.isNumberLiteral()) return literal(type.value)
  if (type.flags & ts.TypeFlags.BooleanLiteral) return literal(type.intrinsicName === 'true')
  if (type.flags & ts.TypeFlags.StringLike) return { kind: 'string' }
  if (type.flags & ts.TypeFlags.NumberLike || type.flags & ts.TypeFlags.BigIntLike) return { kind: 'number' }
  if (type.flags & ts.TypeFlags.BooleanLike) return { kind: 'boolean' }
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) {
    const constraint = checker.getBaseConstraintOfType(type)
    return constraint && constraint !== type ? schemaFor(constraint, stack, depth + 1) : text === 'unknown' || text === 'any' ? { kind: 'json' } : { kind: 'opaque', reason: `unresolved:${text.slice(0, 180)}` }
  }
  if (type.isUnion()) return { kind: 'union', variants: type.types.map(part => schemaFor(part, stack, depth + 1)) }
  if (type.isIntersection()) {
    const parts = type.types.map(part => schemaFor(part, stack, depth + 1))
    const objects = parts.filter(part => part.kind === 'object')
    const scalar = parts.find(part => ['string', 'number', 'boolean', 'date', 'renderable'].includes(part.kind))
    if (scalar && !objects.length) return scalar
    if (objects.length) {
      const properties = Object.assign({}, ...objects.map(part => part.properties))
      const additional = objects.find(part => part.additional)?.additional
      return { kind: 'object', properties, ...(additional ? { additional } : {}) }
    }
    return { kind: 'opaque', reason: `intersection-unresolved:${text.slice(0, 180)}` }
  }
  if (type.getCallSignatures().length) return { kind: 'callback' }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const values = checker.getTypeArguments(type)
    if (checker.isTupleType(type)) return { kind: 'array', items: values.length ? { kind: 'union', variants: values.map(value => schemaFor(value, stack, depth + 1)) } : { kind: 'opaque', reason: 'empty-tuple-type' } }
    return { kind: 'array', items: values[0] ? schemaFor(values[0], stack, depth + 1) : { kind: 'opaque', reason: 'array-item-unavailable' } }
  }
  if (!(type.flags & ts.TypeFlags.Object)) return { kind: 'opaque', reason: `unsupported:${text.slice(0, 180)}` }
  const identity = type.id ?? text
  if (stack.has(identity)) return { kind: 'opaque', reason: `recursive:${text.slice(0, 180)}` }
  const next = new Set(stack); next.add(identity)
  const properties = checker.getPropertiesOfType(type)
  if (properties.length > 96) return { kind: 'opaque', reason: `object-field-limit:${text.slice(0, 180)}` }
  const output = {}
  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    if (!declaration) continue
    output[property.getName()] = { optional: Boolean(property.flags & ts.SymbolFlags.Optional), schema: schemaFor(checker.getTypeOfSymbolAtLocation(property, declaration), next, depth + 1) }
  }
  const additional = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  if (!properties.length && !additional) return { kind: 'opaque', reason: `empty-object:${text.slice(0, 180)}` }
  return { kind: 'object', properties: output, ...(additional ? { additional: schemaFor(additional, next, depth + 1) } : {}) }
}

const entries = {}
for (const entry of sourceManifest.entries) {
  const file = join(source, entry.sourcePath), sourceFile = program.getSourceFile(file)
  if (!sourceFile) throw new Error(`TUFFUI_TYPE_SOURCE_FILE_MISSING:${entry.id}`)
  const exported = {}
  for (const spec of entry.exports) {
    const declaration = findFunction(sourceFile, spec.name)
    if (!declaration?.parameters[0]) throw new Error(`TUFFUI_TYPE_EXPORT_MISSING:${entry.id}:${spec.name}`)
    const parameterType = checker.getTypeAtLocation(declaration.parameters[0])
    const props = {}
    for (const prop of spec.props) {
      const current = propertyType(parameterType, prop.name, declaration.parameters[0])
      // The source extractor preserves destructured DOM/intersection props
      // even when the checker cannot recover their declaration. Keep a named
      // opaque schema so runtime validation excludes supplied values instead
      // of silently treating them as arbitrary JSON.
      props[prop.name] = current ? schemaFor(current.type) : { kind: 'opaque', reason: `checker-prop-missing:${entry.id}:${spec.name}:${prop.name}` }
    }
    exported[spec.name] = props
  }
  entries[entry.id] = exported
}
const typeManifest = { formatVersion: 1, sourceManifestSha256: sha256(sourceManifestBytes), entries }
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(typeManifest, null, 2) + '\n')
const count = Object.values(entries).reduce((sum, item) => sum + Object.values(item).reduce((inner, props) => inner + Object.keys(props).length, 0), 0)
process.stdout.write(JSON.stringify({ entries: Object.keys(entries).length, props: count, output }) + '\n')
