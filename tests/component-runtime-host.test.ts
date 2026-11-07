import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  COMPONENT_RUNTIME_SOURCE_COMMITS,
  ComponentRuntimeHost,
} from '../src/component-runtime-host.js'

type Library = 'rune' | 'tuffui'
type Fixture = { readonly root: string, readonly outside?: string }

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }

async function fixture(library: Library, options: { readonly sourceCommit?: string, readonly sourceManifest?: boolean, readonly typeSchemas?: boolean, readonly sourceManifestSha256?: string, readonly symlinkEscape?: boolean } = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), `component-runtime-${library}-`))
  await mkdir(join(root, 'assets'))
  const html = '<!doctype html><title>fixed component</title><script type="module" src="./assets/app.js"></script>'
  const script = `export const library = ${JSON.stringify(library)}`
  const wasm = new Uint8Array([0, 97, 115, 109])
  await writeFile(join(root, 'index.html'), html)
  let outside: string | undefined
  if (options.symlinkEscape) {
    outside = await mkdtemp(join(tmpdir(), `component-runtime-outside-${library}-`))
    const escaped = join(outside, 'app.js')
    await writeFile(escaped, script)
    await symlink(escaped, join(root, 'assets', 'app.js'))
  } else await writeFile(join(root, 'assets', 'app.js'), script)
  await writeFile(join(root, 'assets', 'app_bg.wasm'), wasm)
  const sourceManifest = JSON.stringify({ formatVersion: 7, source: 'left-unvalidated-for-tuff-catalog', entries: [{ id: 'tool-call-block' }] })
  const typeSchemas = JSON.stringify({ formatVersion: 3, schemas: { ToolCallBlock: { kind: 'object' } } })
  const assets = [
    { path: 'index.html', contentType: 'text/html; charset=utf-8', sha256: sha256(html), bytes: new TextEncoder().encode(html).byteLength },
    { path: 'assets/app.js', contentType: 'text/javascript; charset=utf-8', sha256: sha256(script), bytes: new TextEncoder().encode(script).byteLength },
    { path: 'assets/app_bg.wasm', contentType: 'application/wasm', sha256: sha256(wasm), bytes: wasm.byteLength },
  ]
  if (library === 'tuffui' && options.sourceManifest !== false) {
    await writeFile(join(root, 'source-manifest.json'), sourceManifest)
    assets.push({ path: 'source-manifest.json', contentType: 'application/json; charset=utf-8', sha256: options.sourceManifestSha256 ?? sha256(sourceManifest), bytes: new TextEncoder().encode(sourceManifest).byteLength })
  }
  if (library === 'tuffui' && options.typeSchemas !== false) {
    await writeFile(join(root, 'type-schema.json'), typeSchemas)
    assets.push({ path: 'type-schema.json', contentType: 'application/json; charset=utf-8', sha256: sha256(typeSchemas), bytes: new TextEncoder().encode(typeSchemas).byteLength })
  }
  const manifest = {
    formatVersion: 1,
    library,
    sourceCommit: options.sourceCommit ?? COMPONENT_RUNTIME_SOURCE_COMMITS[library],
    entry: 'index.html',
    assets,
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, outside }
}

async function removeFixture(value: Fixture): Promise<void> {
  await rm(value.root, { recursive: true, force: true })
  if (value.outside) await rm(value.outside, { recursive: true, force: true })
}

describe('ComponentRuntimeHost', () => {
  it('lazily verifies fixed Rune/TuffUI bundles, reuses concurrent servers, and exposes no user data', async () => {
    const rune = await fixture('rune')
    const tuffui = await fixture('tuffui')
    const host = new ComponentRuntimeHost({ assetRoots: { rune: resolve(rune.root), tuffui: resolve(tuffui.root) } })
    try {
      const [first, second] = await Promise.all([host.getInfo('rune'), host.getInfo('rune')])
      expect(first).toEqual(second)
      expect(first).toMatchObject({ protocolVersion: 1, library: 'rune', sourceCommit: COMPONENT_RUNTIME_SOURCE_COMMITS.rune })
      const frame = await fetch(first.frameUrl)
      expect(frame.status).toBe(200)
      expect(frame.headers.get('content-security-policy')).toContain("wasm-unsafe-eval")
      expect(frame.headers.get('access-control-allow-origin')).toBe('*')
      expect(await frame.text()).toContain('fixed component')
      const script = await fetch(new URL('./assets/app.js', first.frameUrl))
      expect(script.status).toBe(200)
      expect(await script.text()).toContain('rune')

      const tuffInfo = await host.getInfo('tuffui')
      expect(tuffInfo).toMatchObject({ protocolVersion: 1, library: 'tuffui', sourceCommit: COMPONENT_RUNTIME_SOURCE_COMMITS.tuffui })
      // The raw source manifest remains unknown here; Tuff's catalog validator owns its schema.
      await expect(host.getCatalog('tuffui')).resolves.toEqual({ formatVersion: 7, source: 'left-unvalidated-for-tuff-catalog', entries: [{ id: 'tool-call-block' }] })
      await expect(host.getTypeSchemas('tuffui')).resolves.toEqual({ formatVersion: 3, schemas: { ToolCallBlock: { kind: 'object' } } })
    } finally {
      await host.close()
      await host.close()
      await removeFixture(rune)
      await removeFixture(tuffui)
    }
    await expect(host.getInfo('rune')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_CLOSED' })
  })

  it('fails named verification before serving a tampered, unknown-source, or symlink-escaping bundle', async () => {
    const tampered = await fixture('rune')
    const unknown = await fixture('tuffui', { sourceCommit: 'f'.repeat(40) })
    const escaped = await fixture('rune', { symlinkEscape: true })
    const badCatalogHash = await fixture('tuffui', { sourceManifestSha256: '0'.repeat(64) })
    try {
      await writeFile(join(tampered.root, 'assets', 'app.js'), 'tampered-after-manifest')
      await expect(new ComponentRuntimeHost({ assetRoots: { rune: tampered.root, tuffui: unknown.root } }).getInfo('rune')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_ASSET_SIZE_MISMATCH' })
      const unknownHost = new ComponentRuntimeHost({ assetRoots: { rune: tampered.root, tuffui: unknown.root } })
      await expect(unknownHost.getInfo('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_SOURCE_UNKNOWN' })
      await expect(unknownHost.getCatalog('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_SOURCE_UNKNOWN' })
      await expect(new ComponentRuntimeHost({ assetRoots: { rune: escaped.root, tuffui: unknown.root } }).getInfo('rune')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_SYMLINK_ESCAPE' })
      await expect(new ComponentRuntimeHost({ assetRoots: { rune: tampered.root, tuffui: badCatalogHash.root } }).getCatalog('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_ASSET_HASH_MISMATCH' })
    } finally {
      await removeFixture(tampered)
      await removeFixture(unknown)
      await removeFixture(escaped)
      await removeFixture(badCatalogHash)
    }
  })

  it('rejects a missing Tuff source manifest with a named boundary failure', async () => {
    const rune = await fixture('rune')
    const tuffui = await fixture('tuffui')
    await rm(join(tuffui.root, 'source-manifest.json'))
    const host = new ComponentRuntimeHost({ assetRoots: { rune: rune.root, tuffui: tuffui.root } })
    try {
      await expect(host.getCatalog('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_ASSET_MISSING' })
    } finally {
      await host.close()
      await removeFixture(rune)
      await removeFixture(tuffui)
    }
  })

  it('requires each Tuff JSON boundary to be allowlisted and verified by the same bundle manifest', async () => {
    const rune = await fixture('rune')
    const missingCatalog = await fixture('tuffui', { sourceManifest: false })
    const missingTypes = await fixture('tuffui', { typeSchemas: false })
    try {
      await expect(new ComponentRuntimeHost({ assetRoots: { rune: rune.root, tuffui: missingCatalog.root } }).getCatalog('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_CATALOG_NOT_ALLOWLISTED' })
      await expect(new ComponentRuntimeHost({ assetRoots: { rune: rune.root, tuffui: missingTypes.root } }).getTypeSchemas('tuffui')).rejects.toMatchObject({ code: 'COMPONENT_RUNTIME_TYPE_SCHEMAS_NOT_ALLOWLISTED' })
    } finally {
      await removeFixture(rune)
      await removeFixture(missingCatalog)
      await removeFixture(missingTypes)
    }
  })
})
