#!/usr/bin/env node
/** Test-only source smoke page. It mounts upstream's own 76 demos, never DSH data. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }

export function generatedDemoModule(manifest) {
  if (!manifest || manifest.formatVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length !== 76) throw new Error('TUFFUI_DEMO_MANIFEST_INVALID')
  const imports = manifest.entries.map((entry, index) => `import Demo${index} from '@/${entry.sourcePath.replace(/\/[^/]+\.tsx$/u, '/demo')}'`)
  const values = manifest.entries.map((entry, index) => `  { id: ${JSON.stringify(entry.id)}, Demo: Demo${index} },`)
  return [
    '// Generated from pinned upstream demo modules; test-only.',
    ...imports,
    'export const tuffUiDemos = [',
    ...values,
    '] as const',
    `export const tuffUiDemoCount = ${manifest.entries.length} as const`,
    '',
  ].join('\n')
}

export function generatedDemoPageModule() {
  return `'use client'\nimport { tuffUiDemos, tuffUiDemoCount } from './tuffui-generated-demos'\nexport default function TuffUiDemoSmoke() { return <main data-testid="tuffui-demo-smoke" className="dark mx-auto min-h-screen max-w-[390px] space-y-3 overflow-x-hidden bg-background p-3 text-foreground"><output data-testid="tuffui-demo-count" className="sr-only">{tuffUiDemoCount}</output>{tuffUiDemos.map(({ id, Demo }) => <section key={id} data-tuffui-demo={id} className="@container min-w-0 overflow-hidden"><Demo /></section>)}</main> }\n`
}

async function main() {
  const carrier = option('--carrier') && resolve(option('--carrier'))
  const manifestPath = option('--manifest') && resolve(option('--manifest'))
  if (!carrier || !manifestPath || args.some(value => !['--carrier', carrier, '--manifest', manifestPath].includes(value))) throw new Error('TUFFUI_DEMO_ARGUMENTS')
  const packageJson = JSON.parse(await readFile(join(carrier, 'package.json'), 'utf8'))
  if (packageJson.private !== true || packageJson.tuffUiRealmCarrier !== true) throw new Error('TUFFUI_REALM_CARRIER_UNTRUSTED')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const target = join(carrier, 'app/realm')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'tuffui-generated-demos.tsx'), generatedDemoModule(manifest))
  await writeFile(join(target, 'page.tsx'), generatedDemoPageModule())
  process.stdout.write(JSON.stringify({ entries: manifest.entries.length, carrier, output: target }) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main()
