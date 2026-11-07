import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ComponentRuntimeHost, COMPONENT_RUNTIME_SOURCE_COMMITS } from '../src/component-runtime-host.js'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { validateTuffUiTypeSchemaManifest } from '../src/tuffui/type-schema.js'
import { registerTuffUiComponents } from '../src/tuffui/executable-components.js'
import { ExecutableComponentRegistry } from '../src/adaptive-ui/executable-registry.js'
const hosts: ComponentRuntimeHost[] = []
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())) })
function host(): ComponentRuntimeHost {
 const result = new ComponentRuntimeHost({assetRoots:{rune:fileURLToPath(new URL('../resources/components/rune',import.meta.url)),tuffui:fileURLToPath(new URL('../resources/components/tuffui',import.meta.url))}})
 hosts.push(result);return result
}
describe('packaged public component runtimes', () => {
 it('verifies and serves the real pinned Rust Wasm assets',async()=>{
  const info=await host().getInfo('rune')
  expect(info.sourceCommit).toBe(COMPONENT_RUNTIME_SOURCE_COMMITS.rune)
  const response=await fetch(info.frameUrl)
  expect(response.status).toBe(200)
  const html=await response.text()
  expect(html).toContain('frame.mjs')
  const wasm=await fetch(new URL('rune_theme_bg.wasm',info.frameUrl))
  expect(wasm.status).toBe(200)
  const bytes=new Uint8Array(await wasm.arrayBuffer())
  expect([...bytes.slice(0,4)]).toEqual([0,97,115,109])
  const provenance=JSON.parse(await readFile(new URL('../resources/components/rune/provenance.json',import.meta.url),'utf8')) as {adapter:{sourceFiles:{path:string,bytes:number,sha256:string}[],sourceDigest:string}}
  const expected=['Cargo.toml','Cargo.lock','rust-toolchain.toml','src/lib.rs','runtime/frame.html','runtime/frame.mjs','scripts/build-wasm.sh']
  expect(provenance.adapter.sourceFiles.map(entry=>entry.path)).toEqual(expected)
  const digest=createHash('sha256')
  for(const entry of provenance.adapter.sourceFiles){
   const source=await readFile(new URL('../native/rune-theme/'+entry.path,import.meta.url))
   const hash=createHash('sha256').update(source).digest('hex')
   expect(source.byteLength).toBe(entry.bytes);expect(hash).toBe(entry.sha256)
   digest.update(`${hash}  ${entry.path}\n`)
  }
  expect(digest.digest('hex')).toBe(provenance.adapter.sourceDigest)

 })
 it('uses the bundled exact source and recursive props schemas to register all 76 TuffUI entries',async()=>{
  const runtime=host()
  const [source,types]=await Promise.all([runtime.getCatalog('tuffui'),runtime.getTypeSchemas('tuffui')])
  const catalog=createTuffUiCatalog(source),typeSchemas=validateTuffUiTypeSchemaManifest(types),registry=new ExecutableComponentRegistry()
  const dispose=registerTuffUiComponents(registry,catalog,{typeSchemas})
  expect(registry.list()).toHaveLength(76)
  expect(new Set(registry.list().map(item=>item.id))).toEqual(new Set(catalog.entries.map(item=>`tuffui:${item.id}`)))
  expect(Object.keys(typeSchemas.entries).sort()).toEqual(catalog.entries.map(item=>item.id).sort())
  const info=await runtime.getInfo('tuffui')
  expect(info.sourceCommit).toBe(COMPONENT_RUNTIME_SOURCE_COMMITS.tuffui)
  expect((await fetch(info.frameUrl)).status).toBe(200)
  const productionFrame=new URL(info.frameUrl);productionFrame.searchParams.set('parentOrigin','http://127.0.0.1:4175')
  expect((await fetch(productionFrame)).status).toBe(200)
  dispose();expect(registry.list()).toHaveLength(0)
 })
})
