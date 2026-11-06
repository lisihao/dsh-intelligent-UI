#!/usr/bin/env node
/** Generate the adapter files for a prepared, disposable React 19 carrier. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }

export function generatedRegistryModule(manifest) {
  if (!manifest || manifest.formatVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length !== 76) throw new Error('TUFFUI_REALM_MANIFEST_INVALID')
  const imports = manifest.entries.map((entry, index) => `import * as component${index} from '@/${entry.sourcePath.replace(/\.tsx$/u, '')}'`)
  const mappings = manifest.entries.map((entry, index) => `  ${JSON.stringify(entry.id)}: component${index},`)
  return [
    '// Generated from the pinned manifest; do not hand-edit.',
    ...imports,
    'export const tuffUiRealmRegistry = Object.freeze({',
    ...mappings,
    '})',
    `export const tuffUiRealmEntryCount = ${manifest.entries.length} as const`,
    '',
  ].join('\n')
}

export function generatedRealmPageModule() {
  return "'use client'\nimport { TuffUiRealmApp } from './tuffui-realm-app'\nimport { tuffUiRealmRegistry } from './tuffui-generated-registry'\nexport default function TuffUiRealmPage() { return <TuffUiRealmApp registry={tuffUiRealmRegistry} /> }\n"
}

async function main() {
  const carrier = option('--carrier') && resolve(option('--carrier'))
  const manifestPath = option('--manifest') && resolve(option('--manifest'))
  if (!carrier || !manifestPath || args.some(value => !['--carrier', carrier, '--manifest', manifestPath].includes(value))) throw new Error('TUFFUI_REALM_ARGUMENTS: pass --carrier <prepared-react19-carrier> --manifest <pinned-manifest.json>')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const target = join(carrier, 'app/realm')
  // A caller must prepare this disposable carrier with the pinned source at
  // vendor/tuffui and an @ alias. This script never mutates the source checkout.
  const packageJson = JSON.parse(await readFile(join(carrier, 'package.json'), 'utf8'))
  if (packageJson.private !== true || packageJson.tuffUiRealmCarrier !== true) throw new Error('TUFFUI_REALM_CARRIER_UNTRUSTED')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'tuffui-generated-registry.ts'), generatedRegistryModule(manifest))
  await writeFile(join(target, 'tuffui-realm-app.tsx'), await readFile(join(here, 'realm-app.tsx'), 'utf8'))
  await writeFile(join(target, 'page.tsx'), generatedRealmPageModule())
  process.stdout.write(JSON.stringify({ entries: manifest.entries.length, carrier, output: target }) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
