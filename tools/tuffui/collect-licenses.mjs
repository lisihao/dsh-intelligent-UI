/**
 * Produces redistribution notices from the *actual* browser bundle inputs.
 *
 * This deliberately starts with esbuild's metafile instead of the carrier's
 * package.json: development-only packages are not automatically attributed to
 * the distributed iframe. Tailwind is the one explicit stylesheet generator
 * input because its generated CSS is copied into the realm artifact.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DISTRIBUTABLE_LICENSES = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT', 'MPL-2.0',
])
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice|copyright)(?:[._-].+)?$/iu
const MAX_RUNTIME_ASSETS = 64
const TOOL_ROOT = dirname(fileURLToPath(import.meta.url))

export const sha256 = value => createHash('sha256').update(value).digest('hex')

function fail(code, detail = '') {
  throw new Error(detail ? `${code}:${detail}` : code)
}

function isInside(root, value) {
  const difference = relative(root, value)
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
}

async function text(path, code) {
  try { return await readFile(path, 'utf8') }
  catch { fail(code, path) }
}

async function json(path, code) {
  try { return JSON.parse(await text(path, code)) }
  catch (error) {
    if (error instanceof Error && error.message.startsWith(`${code}:`)) throw error
    fail(code, path)
  }
}

function packageIdentity(raw, packageJsonPath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('TUFFUI_LICENSE_PACKAGE_METADATA_INVALID', packageJsonPath)
  if (typeof raw.name !== 'string' || !raw.name || typeof raw.version !== 'string' || !raw.version) fail('TUFFUI_LICENSE_PACKAGE_IDENTITY_INVALID', packageJsonPath)
  if (typeof raw.license !== 'string' || !DISTRIBUTABLE_LICENSES.has(raw.license)) {
    fail('TUFFUI_LICENSE_REDISTRIBUTION_BLOCKED', `${raw.name}@${raw.version}:${String(raw.license ?? 'missing')}`)
  }
  return Object.freeze({ name: raw.name, version: raw.version, license: raw.license })
}

async function packageRootForInput(carrier, sourceRoot, input) {
  const candidate = resolve(carrier, input)
  if (isInside(sourceRoot, candidate)) return Object.freeze({ kind: 'source' })
  if (!isInside(carrier, candidate)) fail('TUFFUI_LICENSE_INPUT_OUTSIDE_CARRIER', input)
  let current = dirname(candidate)
  for (;;) {
    const packageJsonPath = join(current, 'package.json')
    try {
      const metadata = await json(packageJsonPath, 'TUFFUI_LICENSE_PACKAGE_JSON_INVALID')
      const identity = packageIdentity(metadata, packageJsonPath)
      // The carrier root packages only generated realm sources; it is not a
      // distributable third-party dependency. All actual imports below it are
      // either the immutable source snapshot or a node_modules package.
      if (current !== carrier) return Object.freeze({ kind: 'package', root: current, packageJsonPath, identity })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('TUFFUI_LICENSE_PACKAGE_JSON_INVALID:')) throw error
    }
    if (current === carrier) break
    const parent = dirname(current)
    if (parent === current || !isInside(carrier, parent)) break
    current = parent
  }
  // Generated entry, registry and bridge files reside in the private carrier
  // and are not a third-party package. They are accounted for by this
  // repository, not inserted into a third-party notice.
  return Object.freeze({ kind: 'carrier' })
}

async function packageRootByName(carrier, packageName) {
  const packageJsonPath = join(carrier, 'node_modules', ...packageName.split('/'), 'package.json')
  const metadata = await json(packageJsonPath, 'TUFFUI_LICENSE_STYLESHEET_PACKAGE_MISSING')
  return Object.freeze({
    kind: 'package',
    root: dirname(packageJsonPath),
    packageJsonPath,
    identity: packageIdentity(metadata, packageJsonPath),
  })
}

async function licenseTexts(root, packageLabel) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch { fail('TUFFUI_LICENSE_PACKAGE_DIRECTORY_UNREADABLE', packageLabel) }
  const names = entries
    .filter(entry => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
  if (!names.length) fail('TUFFUI_LICENSE_TEXT_MISSING', packageLabel)
  return await Promise.all(names.map(async name => {
    const body = await text(join(root, name), 'TUFFUI_LICENSE_TEXT_UNREADABLE')
    return Object.freeze({ name, body, sha256: sha256(body) })
  }))
}

function upstreamOverride(value, key, license) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  const item = value
  if (item.npmLicense !== license || typeof item.reason !== 'string' || !item.reason || typeof item.textFile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/u.test(item.textFile) || item.textFile.includes('..')) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  const upstream = item.upstream
  if (!upstream || typeof upstream !== 'object' || Array.isArray(upstream)) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  if (typeof upstream.repository !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/u.test(upstream.repository) || typeof upstream.commit !== 'string' || !/^[a-f0-9]{40}$/u.test(upstream.commit) || typeof upstream.path !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/u.test(upstream.path) || upstream.path.includes('..') || typeof upstream.url !== 'string' || typeof upstream.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(upstream.sha256)) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  const rawBase = upstream.repository.replace(/^https:\/\/github\.com\//u, 'https://raw.githubusercontent.com/').replace(/\.git$/u, '')
  if (upstream.url !== `${rawBase}/${upstream.commit}/${upstream.path}`) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  return Object.freeze({ reason: item.reason, textFile: item.textFile, upstream: Object.freeze({ repository: upstream.repository, commit: upstream.commit, path: upstream.path, url: upstream.url, sha256: upstream.sha256 }) })
}

async function licenseOverrideFor(key, license) {
  const manifestPath = join(TOOL_ROOT, 'license-overrides.json')
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
  catch { fail('TUFFUI_LICENSE_OVERRIDE_MANIFEST_INVALID') }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.formatVersion !== 1 || !manifest.overrides || typeof manifest.overrides !== 'object' || Array.isArray(manifest.overrides)) fail('TUFFUI_LICENSE_OVERRIDE_MANIFEST_INVALID')
  const raw = manifest.overrides[key]
  if (raw === undefined) return undefined
  const override = upstreamOverride(raw, key, license)
  const textPath = resolve(TOOL_ROOT, override.textFile)
  if (!isInside(TOOL_ROOT, textPath)) fail('TUFFUI_LICENSE_OVERRIDE_INVALID', key)
  const body = await text(textPath, 'TUFFUI_LICENSE_OVERRIDE_TEXT_UNREADABLE')
  if (sha256(body) !== override.upstream.sha256) fail('TUFFUI_LICENSE_OVERRIDE_HASH_MISMATCH', key)
  return Object.freeze({
    texts: Object.freeze([Object.freeze({ name: `upstream:${override.upstream.path}`, body, sha256: override.upstream.sha256 })]),
    source: Object.freeze({ kind: 'upstream-license-override', reason: override.reason, npmPackageLicense: license, upstream: override.upstream }),
  })
}

function sourceRecord(sourceRoot, sourceManifest, sourceManifestBytes) {
  const sourceCommit = sourceManifest?.commit
  if (!sourceManifest || typeof sourceManifest !== 'object' || typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceCommit)) {
    fail('TUFFUI_LICENSE_SOURCE_MANIFEST_INVALID')
  }
  if (sourceManifest.license !== 'MIT') fail('TUFFUI_LICENSE_SOURCE_LICENSE_UNEXPECTED', String(sourceManifest.license))
  return {
    key: `tuffui-source@${sourceCommit}`,
    name: 'tuffui-source',
    version: sourceCommit,
    license: 'MIT',
    sourceCommit,
    sourceRepository: sourceManifest.repository,
    sourceManifestSha256: sha256(sourceManifestBytes),
    root: sourceRoot,
    packageJsonSha256: undefined,
    inputs: new Set(['immutable-source']),
  }
}

function packageRecord(found, inputKind) {
  const { identity } = found
  return {
    key: `${identity.name}@${identity.version}`,
    name: identity.name,
    version: identity.version,
    license: identity.license,
    sourceCommit: undefined,
    sourceManifestSha256: undefined,
    root: found.root,
    packageJsonSha256: undefined,
    packageJsonPath: found.packageJsonPath,
    inputs: new Set([inputKind]),
  }
}

function assetSafeLabel(value) {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^[_\.]+/u, '') || 'package'
  return normalized.slice(0, 120)
}

function licenseDocument(record) {
  const header = [
    `Package: ${record.name}`,
    `Version: ${record.version}`,
    `License: ${record.license}`,
    record.sourceCommit ? `Source commit: ${record.sourceCommit}` : `Package metadata SHA-256: ${record.packageJsonSha256}`,
    `Bundled input kinds: ${[...record.inputs].sort().join(', ')}`,
  ]
  if (record.licenseSource?.kind === 'immutable-source') {
    header.push(`License text origin: fixed source repository ${record.licenseSource.repository} at ${record.licenseSource.commit}.`)
  } else if (record.licenseSource?.kind === 'upstream-license-override') {
    header.push('License text origin: fixed upstream source; the npm package archive did not include LICENSE/NOTICE.')
    header.push(`NPM declaration: ${record.licenseSource.npmPackageLicense}`)
    header.push(`Exception reason: ${record.licenseSource.reason}`)
    header.push(`Upstream repository: ${record.licenseSource.upstream.repository}`)
    header.push(`Upstream commit: ${record.licenseSource.upstream.commit}`)
    header.push(`Upstream file: ${record.licenseSource.upstream.path}`)
    header.push(`Upstream URL: ${record.licenseSource.upstream.url}`)
  } else header.push('License text origin: fixed npm package archive.')
  const parts = [header.join('\n')]
  for (const item of record.licenseTexts) {
    parts.push(`License file: ${item.name}\nLicense text SHA-256: ${item.sha256}\n\n${item.body.trimEnd()}`)
  }
  return `${parts.join('\n\n-----\n\n')}\n`
}

function notices(records) {
  const rows = [
    '# TuffUI realm third-party notices',
    '',
    'This file is generated from esbuild browser-bundle inputs plus Tailwind CSS, which is compiled into the emitted stylesheet. It excludes carrier-only build tooling that is not part of the delivered realm.',
    '',
    '| package | version | license | input kinds | license text origin | metadata/source hash | license text hash |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const record of records) {
    const licenseHash = sha256(record.licenseTexts.map(item => `${item.name}\u0000${item.body}`).join('\u0000'))
    const metadataHash = record.sourceManifestSha256 ?? record.packageJsonSha256
    const origin = record.licenseSource?.kind === 'immutable-source' ? `fixed source ${record.licenseSource.commit.slice(0, 12)}` : record.licenseSource?.kind === 'upstream-license-override' ? `upstream ${record.licenseSource.upstream.commit.slice(0, 12)} (${record.licenseSource.upstream.path})` : 'npm package archive'
    rows.push(`| ${record.name} | ${record.version} | ${record.license} | ${[...record.inputs].sort().join(', ')} | ${origin} | ${metadataHash} | ${licenseHash} |`)
  }
  return `${rows.join('\n')}\n`
}

function provenance(records, metafile, sourceManifest) {
  return {
    formatVersion: 1,
    sourceCommit: sourceManifest.commit,
    esbuildInputCount: Object.keys(metafile.inputs ?? {}).length,
    packages: records.map(record => Object.freeze({
      name: record.name,
      version: record.version,
      license: record.license,
      inputKinds: Object.freeze([...record.inputs].sort()),
      ...(record.sourceCommit ? { sourceCommit: record.sourceCommit, sourceManifestSha256: record.sourceManifestSha256 } : { packageJsonSha256: record.packageJsonSha256 }),
      licenseTextSource: record.licenseSource ?? Object.freeze({ kind: 'npm-package-archive' }),
      licenseFiles: Object.freeze(record.licenseTexts.map(item => Object.freeze({ name: item.name, sha256: item.sha256 }))),
    })),
  }
}

async function writeAsset(destination, path, body, contentType) {
  const target = join(destination, path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body)
  return Object.freeze({ path, contentType, sha256: sha256(body), bytes: Buffer.byteLength(body) })
}

/**
 * Emit complete, source-derived license text and sanitized provenance.
 * Returns the assets that must be listed in the runtime manifest.
 */
export async function collectTuffUiThirdPartyNotices({ carrier, sourceRoot, sourceManifestPath, metafile, destination }) {
  if (!carrier || !sourceRoot || !sourceManifestPath || !metafile || !destination || !metafile.inputs || typeof metafile.inputs !== 'object') {
    fail('TUFFUI_LICENSE_COLLECT_ARGUMENTS')
  }
  const normalizedCarrier = resolve(carrier)
  const normalizedSourceRoot = resolve(sourceRoot)
  const sourceManifestBytes = await readFile(sourceManifestPath)
  let sourceManifest
  try { sourceManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sourceManifestBytes)) }
  catch { fail('TUFFUI_LICENSE_SOURCE_MANIFEST_INVALID') }

  const records = new Map()
  const source = sourceRecord(normalizedSourceRoot, sourceManifest, sourceManifestBytes)
  records.set(source.key, source)
  for (const input of Object.keys(metafile.inputs).sort()) {
    const found = await packageRootForInput(normalizedCarrier, normalizedSourceRoot, input)
    if (found.kind === 'carrier') continue
    if (found.kind === 'source') {
      source.inputs.add('javascript')
      continue
    }
    const candidate = packageRecord(found, 'javascript')
    const existing = records.get(candidate.key)
    if (existing) existing.inputs.add('javascript')
    else records.set(candidate.key, candidate)
  }
  // Tailwind is transformed into tuffui-realm.css outside esbuild's JS graph.
  const tailwind = await packageRootByName(normalizedCarrier, 'tailwindcss')
  const tailwindRecord = packageRecord(tailwind, 'stylesheet')
  const existingTailwind = records.get(tailwindRecord.key)
  if (existingTailwind) existingTailwind.inputs.add('stylesheet')
  else records.set(tailwindRecord.key, tailwindRecord)

  const finalized = [], missingLicenseTexts = []
  for (const record of [...records.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    if (record.packageJsonPath) record.packageJsonSha256 = sha256(await readFile(record.packageJsonPath))
    try {
      record.licenseTexts = await licenseTexts(record.root, record.key)
      record.licenseSource = record.sourceCommit
        ? Object.freeze({ kind: 'immutable-source', repository: record.sourceRepository, commit: record.sourceCommit })
        : Object.freeze({ kind: 'npm-package-archive' })
    }
    catch (error) {
      if (error instanceof Error && error.message === `TUFFUI_LICENSE_TEXT_MISSING:${record.key}`) {
        const override = await licenseOverrideFor(record.key, record.license)
        if (override) { record.licenseTexts = override.texts; record.licenseSource = override.source }
        else { missingLicenseTexts.push(record.key); continue }
      } else throw error
    }
    finalized.push(record)
  }
  if (missingLicenseTexts.length) fail('TUFFUI_LICENSE_TEXT_MISSING', `${missingLicenseTexts.join(',')};verified=${String(finalized.length)};total=${String(records.size)}`)

  const noticesBody = notices(finalized)
  const provenanceBody = `${JSON.stringify(provenance(finalized, metafile, sourceManifest), null, 2)}\n`
  const fixedAssets = [
    await writeAsset(destination, 'THIRD_PARTY_NOTICES.md', noticesBody, 'text/markdown; charset=utf-8'),
    await writeAsset(destination, 'bundle-provenance.json', provenanceBody, 'application/json; charset=utf-8'),
  ]
  const wouldUse = fixedAssets.length + finalized.length
  let licenseAssets
  if (wouldUse + 3 <= MAX_RUNTIME_ASSETS) {
    licenseAssets = []
    for (const record of finalized) {
      const path = `licenses/${assetSafeLabel(record.name)}-${sha256(record.key).slice(0, 12)}.txt`
      licenseAssets.push(await writeAsset(destination, path, licenseDocument(record), 'text/plain; charset=utf-8'))
    }
  } else {
    const combined = `${finalized.map(licenseDocument).join('\n==========\n\n')}`
    licenseAssets = [await writeAsset(destination, 'THIRD_PARTY_LICENSES.txt', combined, 'text/plain; charset=utf-8')]
  }
  return Object.freeze({
    assets: Object.freeze([...fixedAssets, ...licenseAssets]),
    packages: Object.freeze(finalized.map(record => Object.freeze({
      name: record.name,
      version: record.version,
      license: record.license,
      inputKinds: Object.freeze([...record.inputs].sort()),
      licenseTextSha256: sha256(record.licenseTexts.map(item => `${item.name}\u0000${item.body}`).join('\u0000')),
      licenseTextSource: record.licenseSource?.kind ?? 'npm-package-archive',
    }))),
    combined: licenseAssets.length === 1 && licenseAssets[0].path === 'THIRD_PARTY_LICENSES.txt',
  })
}
