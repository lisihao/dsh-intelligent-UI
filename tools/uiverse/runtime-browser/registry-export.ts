import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { createUiverseRuntimeRegistry } from '../../../src/uiverse/runtime-registry.js'
import type { Catalog } from '../../../src/uiverse/catalog.js'

async function main(): Promise<void> {
  if (!process.env.UIVERSE_RUNTIME_ROOT) throw new Error('UIVERSE_RUNTIME_ROOT_REQUIRED')
  const root = resolve(process.env.UIVERSE_RUNTIME_ROOT)
  const catalog = JSON.parse(await readFile(resolve(root, 'resources/uiverse/catalog.json'), 'utf8')) as Catalog
  const archive = JSON.parse(gunzipSync(await readFile(resolve(root, 'resources/uiverse/sources.json.gz'))).toString('utf8')) as { readonly sources: Record<string, string> }
  const runtime = createUiverseRuntimeRegistry(catalog, { html: archive.sources })

  // Deliberately omit the audit and shared utility CSS: this is a browser
  // transport only. The browser fixture gets one separately supplied shared
  // sheet for a bounded representative check, rather than repeating 438 KB for
  // every component source.
  process.stdout.write(JSON.stringify(runtime.components.map(component => ({
    ...component,
    sharedCss: undefined,
    needsSharedCss: catalog.items.find(item => item.id === component.id)?.framework !== 'css',
  }))))
}
void main().catch(error => { process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1 })
