import { describe, it, expect, beforeAll } from 'vitest'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog, searchCatalog, getSource, previewDocument, standalonePreview, type Catalog } from '../src/uiverse/catalog.js'
let catalog: Catalog
beforeAll(async()=>{catalog=await loadCatalog(join(process.cwd(),'lib/uiverse/assets'))})
describe('Pinned Uiverse archive',()=>{
 it('retains the complete official archive and attributed byte fingerprints',async()=>{
  expect(catalog.total).toBe(3802);expect(Object.keys(catalog.categories)).toHaveLength(11)
  expect(catalog.commit).toBe('adbd2adde0a299a3956ea288fb444ec01891ca41')
  const archive=JSON.parse(await readFile(join(process.cwd(),'lib/uiverse/assets/sources.json'),'utf8'))
  for(const item of catalog.items){const result=getSource(catalog,item.id);expect(result.source).toBe(archive.sources[item.id]);expect(createHash('sha256').update(result.source).digest('hex')).toBe(item.sha256);expect(result.license).toContain('Copyright (c) 2023 Uiverse.io')}
 })
 it('retrieves every category, filters Chinese component terms, and pages without dropping or duplicating matches',()=>{
  for(const category of Object.keys(catalog.categories))expect(searchCatalog(catalog,{category,limit:1}).total).toBe(catalog.categories[category])
  const a=searchCatalog(catalog,{query:'按钮',category:'Buttons',limit:12});const b=searchCatalog(catalog,{query:'button',category:'Buttons',limit:12,offset:12})
  expect(a.total).toBe(b.total);expect(a.total).toBeGreaterThan(100);expect(new Set([...a.items,...b.items].map(i=>i.id)).size).toBe(24)
  expect(searchCatalog(catalog,{query:'not-a-real-component-zzzzzz'}).total).toBe(0)
 })
 it('rejects arbitrary source paths and invalid search bounds rather than returning fake results',()=>{
  expect(()=>getSource(catalog,'../../etc/passwd')).toThrow('NOT_FOUND')
  expect(()=>searchCatalog(catalog,{limit:10000})).toThrow('INVALID')
  expect(()=>searchCatalog(catalog,{offset:-1})).toThrow('INVALID')
  expect(()=>searchCatalog(catalog,{category:'bogus'})).toThrow('UNKNOWN')
 })
 it('renders real CSS and Tailwind records offline and exposes actual external-resource limitations',()=>{
  const css=catalog.items.find(i=>i.framework==='css')!,tailwind=catalog.items.find(i=>i.framework==='tailwind')!,remote=catalog.items.find(i=>i.warnings.some(w=>w.includes('外部资源')))!
  expect(previewDocument(catalog,css.id).html).toContain('Content-Security-Policy')
  const tw=previewDocument(catalog,tailwind.id).html
  expect(tw.length).toBeGreaterThan(100000);expect(tw).not.toContain('cdn.tailwindcss.com')
  expect(previewDocument(catalog,remote.id).warnings).toContainEqual(expect.stringContaining('外部资源'))
  expect(standalonePreview(catalog,css.id)).toContain('sandbox=""')
 })
 it('keeps source unchanged while the adapter removes active markup and navigation from previews',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'uiverse-active-'))
  const source='<script>fetch("https://example.com")</script><meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com" onclick="alert(1)">Link</a><input type="checkbox"><style>.x:hover{color:red}</style>'
  const item={...catalog.items[0]!,sha256:createHash('sha256').update(source).digest('hex')}
  const small={...catalog,total:1,items:[item]}
  try{
   await Promise.all([writeFile(join(folder,'catalog.json'),JSON.stringify(small)),writeFile(join(folder,'sources.json'),JSON.stringify({formatVersion:1,sources:{[item.id]:source}})),writeFile(join(folder,'tailwind.css'),''),writeFile(join(folder,'LICENSE'),'MIT License')])
   const fixture=await loadCatalog(folder);const p=previewDocument(fixture,item.id,{reducedMotion:true})
   expect(getSource(fixture,item.id).source).toBe(source);expect(p.html).not.toContain('<script>');expect(p.html).not.toContain('http-equiv="refresh"');expect(p.html).not.toContain('onclick=');expect(p.html).not.toContain('href="https:');expect(p.html).toContain('type="checkbox"');expect(p.html).toContain('animation:none!important')
   await writeFile(join(folder,'sources.json'),JSON.stringify({formatVersion:1,sources:{[item.id]:source+'tampered'}}))
   await expect(loadCatalog(folder)).rejects.toThrow('source or provenance mismatch')
   await writeFile(join(folder,'catalog.json'),JSON.stringify({...small,formatVersion:9}))
   await expect(loadCatalog(folder)).rejects.toThrow('unsupported catalog format')
  }finally{await rm(folder,{recursive:true,force:true})}
 })
})
