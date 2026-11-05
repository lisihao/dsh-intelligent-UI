import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {ExperienceStore,RevisionConflictError} from '../src/store.js'
import {saveSettingsSchema} from '../src/contracts.js'
const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function create(){const root=await mkdtemp(join(tmpdir(),'adaptive-settings-'));roots.push(root);return {root,store:new ExperienceStore(root)}}
it('reads existing settings without enabling auxiliary decisions or rewriting them',async()=>{
 const {root,store}=await create(),text=JSON.stringify({formatVersion:1,revision:6,takeover:true,openui:true,mcpApps:false})
 await writeFile(join(root,'settings.json'),text)
 expect((await store.settings()).adaptive).toBeUndefined()
 expect(await readFile(join(root,'settings.json'),'utf8')).toBe(text)
})
it('persists explicit style policy, preserves it for older callers, and rejects stale saves',async()=>{
 const {root,store}=await create(),flags={takeover:true,openui:true,mcpApps:false}
 const chosen=await store.saveSettings({expectedRevision:0,...flags,adaptive:{enabled:true,styleMode:'automatic'}})
 expect((await new ExperienceStore(root).settings()).adaptive).toEqual({enabled:true,styleMode:'automatic'})
 const next=await store.saveSettings({expectedRevision:chosen.revision,...flags,openui:false})
 expect(next.adaptive).toEqual(chosen.adaptive)
 await expect(store.saveSettings({expectedRevision:chosen.revision,...flags,adaptive:{enabled:false,styleMode:'selected'}})).rejects.toBeInstanceOf(RevisionConflictError)
 expect((await store.settings()).adaptive?.enabled).toBe(true)
})
it('validates actual saved/wire policy boundaries instead of accepting arbitrary provider configuration',async()=>{
 const {root,store}=await create(),flags={takeover:true,openui:true,mcpApps:false}
 const input={expectedRevision:0,...flags,adaptive:{enabled:true,styleMode:'automatic',apiKey:'not-a-real-key'}}
 expect(saveSettingsSchema.safeParse(input).success).toBe(false)
 expect(()=>store.saveSettings(input as never)).toThrow()
 expect((await store.settings()).revision).toBe(0)
 await writeFile(join(root,'settings.json'),JSON.stringify({formatVersion:1,revision:1,...flags,adaptive:{enabled:true,styleMode:'unknown'}}))
 await expect(store.settings()).rejects.toThrow(/Invalid stored data/)
})
