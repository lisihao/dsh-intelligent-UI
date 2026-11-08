#!/usr/bin/env node
/**
 * Builds a client-only React 19 iframe realm from the immutable TuffUI source
 * closure. The generated JS is a dependency artifact; upstream TSX is never
 * edited or copied into this repository.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { build } from 'esbuild'
import { collectTuffUiThirdPartyNotices } from './collect-licenses.mjs'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const sha256 = value => createHash('sha256').update(value).digest('hex')
async function files(directory) {
  const output = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) output.push(...await files(path))
    else output.push(path)
  }
  return output
}
function staticEntry() {
  return `import * as React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { TuffUiRealmApp } from './tuffui-realm-app'\nimport { tuffUiRealmRegistry } from './tuffui-generated-registry'\nconst root = document.getElementById('root')\nif (!root) throw new Error('TUFFUI_REALM_ROOT_MISSING')\ncreateRoot(root).render(React.createElement(TuffUiRealmApp, { registry: tuffUiRealmRegistry }))\n`
}
async function main() {
  const carrier = option('--carrier') && resolve(option('--carrier'))
  const manifestPath = option('--manifest') && resolve(option('--manifest'))
const typeManifestPath = option('--type-manifest') && resolve(option('--type-manifest'))
const destinationOption = option('--out') && resolve(option('--out'))
if (!carrier || !manifestPath || !typeManifestPath || args.some(value => !['--carrier', carrier, '--manifest', manifestPath, '--type-manifest', typeManifestPath, '--out', destinationOption].includes(value))) throw new Error('TUFFUI_STATIC_REALM_ARGUMENTS')
  const packageJson = JSON.parse(await readFile(join(carrier, 'package.json'), 'utf8'))
  if (packageJson.private !== true || packageJson.tuffUiRealmCarrier !== true) throw new Error('TUFFUI_REALM_CARRIER_UNTRUSTED')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length !== 76) throw new Error('TUFFUI_STATIC_REALM_MANIFEST_INVALID')
const typeManifestBytes = await readFile(typeManifestPath)
const typeManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typeManifestBytes))
if (typeManifest.formatVersion !== 1 || typeManifest.sourceManifestSha256 !== sha256(await readFile(manifestPath))) throw new Error('TUFFUI_STATIC_REALM_TYPE_MANIFEST_MISMATCH')
  const appRealm = join(carrier, 'app/realm')
  const destination = destinationOption ?? join(carrier, 'out/realm')
  await mkdir(appRealm, { recursive: true }); await mkdir(destination, { recursive: true })
  await writeFile(join(appRealm, 'tuffui-static-entry.tsx'), staticEntry())
  const cssRoot = join(carrier, 'out/_next')
  const cssFiles = (await files(cssRoot)).filter(path => path.endsWith('.css')).sort()
  if (!cssFiles.length) throw new Error('TUFFUI_STATIC_REALM_CSS_MISSING: run the carrier Next build first')
  const css = (await Promise.all(cssFiles.map(path => readFile(path, 'utf8')))).join('\n')
  await writeFile(join(destination, 'tuffui-realm.css'), css)
  const jsPath = join(destination, 'tuffui-realm.js')
  const esbuild = await build({
    absWorkingDir: carrier,
    entryPoints: [join(appRealm, 'tuffui-static-entry.tsx')],
    outfile: jsPath,
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': join(carrier, 'vendor/tuffui') },
    logLevel: 'silent',
    metafile: true,
  })
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none'; img-src data: blob:; font-src data:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="./tuffui-realm.css"></head><body><div id="root"></div><script src="./tuffui-realm.js"></script></body></html>\n`
  await writeFile(join(destination, 'tuffui-realm.html'), html)
  await writeFile(join(destination, 'source-manifest.json'), await readFile(manifestPath))
  await writeFile(join(destination, 'type-schema.json'), typeManifestBytes)
  const licenseClosure = await collectTuffUiThirdPartyNotices({
    carrier,
    sourceRoot: join(carrier, 'vendor/tuffui'),
    sourceManifestPath: manifestPath,
    metafile: esbuild.metafile,
    destination,
  })
  const [htmlBytes, js, writtenCss, sourceManifestBytes] = await Promise.all([readFile(join(destination, 'tuffui-realm.html')), readFile(jsPath), readFile(join(destination, 'tuffui-realm.css')), readFile(manifestPath)])
  const sourceManifestSha256 = sha256(sourceManifestBytes)
  const typeManifestSha256 = sha256(typeManifestBytes)
  const artifact = { formatVersion: 1, sourceManifestSha256, typeManifestSha256, entryCount: manifest.entries.length, assets: { html: { file: 'tuffui-realm.html', sha256: sha256(htmlBytes)}, js: { file: 'tuffui-realm.js', sha256: sha256(js) }, css: { file: 'tuffui-realm.css', sha256: sha256(writtenCss) }, sourceManifest: { file: 'source-manifest.json', sha256: sourceManifestSha256 }, typeSchemas: { file: 'type-schema.json', sha256: typeManifestSha256 } }, thirdParty: { combinedLicenseAsset: licenseClosure.combined, packages: licenseClosure.packages } }
  await writeFile(join(destination, 'tuffui-realm.manifest.json'), JSON.stringify(artifact, null, 2) + '\n')
  const runtimeAssets = [
    { path: 'tuffui-realm.html', contentType: 'text/html; charset=utf-8', sha256: artifact.assets.html.sha256, bytes: htmlBytes.byteLength },
    { path: 'tuffui-realm.js', contentType: 'text/javascript; charset=utf-8', sha256: artifact.assets.js.sha256, bytes: js.byteLength },
    { path: 'tuffui-realm.css', contentType: 'text/css; charset=utf-8', sha256: artifact.assets.css.sha256, bytes: writtenCss.byteLength },
    { path: 'source-manifest.json', contentType: 'application/json; charset=utf-8', sha256: sourceManifestSha256, bytes: sourceManifestBytes.byteLength },
    { path: 'type-schema.json', contentType: 'application/json; charset=utf-8', sha256: typeManifestSha256, bytes: typeManifestBytes.byteLength },
    ...licenseClosure.assets,
  ]
  if (runtimeAssets.length > 64) throw new Error('TUFFUI_STATIC_REALM_RUNTIME_ASSET_COUNT_EXCEEDED')
  const runtimeBytes = runtimeAssets.reduce((total, asset) => total + asset.bytes, 0)
  if (runtimeBytes > 64 * 1024 * 1024) throw new Error('TUFFUI_STATIC_REALM_RUNTIME_ASSET_BYTES_EXCEEDED')
  const runtimeManifest = { formatVersion: 1, library: 'tuffui', sourceCommit: manifest.commit, entry: 'tuffui-realm.html', assets: runtimeAssets }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ carrier, realm: destination, entryCount: artifact.entryCount, jsBytes: js.length, cssBytes: writtenCss.length, runtimeAssetCount: runtimeAssets.length, runtimeBytes, thirdPartyPackageCount: licenseClosure.packages.length, combinedLicenseAsset: licenseClosure.combined }) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main()
