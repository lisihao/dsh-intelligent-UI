import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSourceBlockComponentRegistry } from '../src/adaptive-ui/source-block-components.js'
import { registerCanvasComponents } from '../src/adaptive-ui/canvas-component-bindings.js'
import { registerUiverseRuntimeComponents } from '../src/uiverse/runtime-executable.js'
import { UiverseRuntimeHost } from '../src/uiverse/runtime-host.js'
import { uiverseRuntimeFixtureFieldValue } from '../src/uiverse/runtime-field-constraints.js'
import { ComponentRuntimeHost } from '../src/component-runtime-host.js'
import { createTuffUiCatalog } from '../src/tuffui/catalog.js'
import { validateTuffUiTypeSchemaManifest } from '../src/tuffui/type-schema.js'
import { registerTuffUiComponents } from '../src/tuffui/executable-components.js'
import { executableComponentReachability } from '../src/adaptive-ui/component-decision.js'
import { getCompositionCatalog } from '../src/adaptive-ui/catalog.js'
import { executableComponentContract } from '../src/adaptive-ui/component-catalog.js'
import { getCanvasComponentInputContract } from '../src/adaptive-ui/canvas-component-bindings.js'
import { getDilLibraryComponentInputSchema } from '../src/dil/library-contracts.js'
import { builtInThemes } from '../src/theme-contracts.js'

describe('complete production library registration and choice paths',()=>{
 it('keeps all pinned IDs discoverable and every bound Uiverse leaf reachable without top-K',async()=>{
  const registry=createSourceBlockComponentRegistry(),base=registry.list().length
  const runtime=new ComponentRuntimeHost({assetRoots:{rune:fileURLToPath(new URL('../resources/components/rune',import.meta.url)),tuffui:fileURLToPath(new URL('../resources/components/tuffui',import.meta.url))}})
  try{
   const archive=await UiverseRuntimeHost.open(fileURLToPath(new URL('../resources/uiverse',import.meta.url)))
   const [source,types]=await Promise.all([runtime.getCatalog('tuffui'),runtime.getTypeSchemas('tuffui')])
   const tuffui=createTuffUiCatalog(source),tuffuiTypes=validateTuffUiTypeSchemaManifest(types)
   registerCanvasComponents(registry);registerUiverseRuntimeComponents(registry,archive.registry);registerTuffUiComponents(registry,tuffui,{typeSchemas:tuffuiTypes})
   expect(registry.list()).toHaveLength(base+35+3802+76)
   const publicCatalog=getCompositionCatalog(builtInThemes,{executables:registry.list()})
   const byId=new Map(publicCatalog.entries.map(entry=>[entry.id,entry]))
   for(const entry of registry.list())expect(byId.get(entry.id)?.eligibility.reason,entry.id).toBe('same-id-executable-registry')
   const contracts={registry,tuffui,tuffuiTypes,uiverse:archive.registry,libraryContract:getDilLibraryComponentInputSchema,canvasContract:getCanvasComponentInputContract}
   for(const entry of registry.list())expect(executableComponentContract(entry.id,contracts),entry.id).toBeDefined()
   for(const element of ['select','input'] as const){
    const component=archive.registry.components.find(entry=>entry.targets.some(target=>target.kind==='value'&&target.fieldConstraint?.element===element&&(element==='select'||target.fieldConstraint.inputType==='date')))!
    const target=component.targets.find(target=>target.kind==='value'&&target.fieldConstraint?.element===element&&(element==='select'||target.fieldConstraint.inputType==='date'))!
    const contract=executableComponentContract(`uiverse:${component.id}`,contracts) as {dil:{targets:readonly {id:string,fieldConstraint?:unknown}[],inputSchema:{fieldConstraints:Readonly<Record<string,unknown>>}}}
    expect(contract.dil.targets.find(entry=>entry.id===target.id)?.fieldConstraint).toEqual(target.fieldConstraint)
    expect(contract.dil.inputSchema.fieldConstraints[target.id]).toEqual(target.fieldConstraint)
   }
   // Synthetic complete bindings test reachability, not model taste or real document data.
   const bindings=Object.fromEntries(archive.registry.components.map(component=>[component.id,{
    mode:'read-only',
    text:Object.fromEntries(component.targets.filter(target=>['text','placeholder','css-content','attribute'].includes(target.kind)).map(target=>[target.id,'Source fixture caption'])),
    fields:Object.fromEntries(component.targets.filter(target=>['value','checked','file'].includes(target.kind)).map(target=>[target.id,target.kind==='value'?{value:uiverseRuntimeFixtureFieldValue(target)}:target.kind==='checked'?{checked:false}:{file:true}])),
    images:Object.fromEntries(component.targets.filter(target=>target.kind==='image').map(target=>[target.id,{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO1sAAAAASUVORK5CYII=',alt:'Source fixture image'}])),
   }]))
   const context={source:{value:{type:'uiverse-content',bindings},recipes:[]},capabilities:{webgl:false,reducedMotion:true}}
   const coverage=executableComponentReachability(registry,context,100)
   expect(coverage.allEligibleReachable).toBe(true)
   expect(coverage.unreachableIds).toEqual([])
   for(const component of archive.registry.components)expect(coverage.eligibleIds).toContain(`uiverse:${component.id}`)
   expect(coverage.reachability.some(entry=>entry.optionPath.length>2)).toBe(true)
   for(const component of archive.registry.components){const selected=registry.dispatch(`uiverse:${component.id}`,context);expect(selected.id).toBe(`uiverse:${component.id}`);expect(selected.rendererKey).toBe('uiverse-shadow-v1')}
  }finally{await runtime.close()}
 },30000)
})
