import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { parseFragment } from 'parse5'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
const root=fileURLToPath(new URL('../../',import.meta.url))
const pin=JSON.parse(await readFile(join(root,'resources/uiverse/upstream.json'),'utf8'))
const source=process.env.UIVERSE_SOURCE_DIR
if(!source) throw new Error('Set UIVERSE_SOURCE_DIR to the verified pinned Galaxy checkout; resources are never downloaded implicitly.')
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()
if(commit!==pin.commit) throw new Error('UIVERSE_UPSTREAM_PIN_MISMATCH')
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim()) throw new Error('UIVERSE_UPSTREAM_DIRTY')
const files=[]
for(const directory of (await readdir(source,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
 for(const filename of (await readdir(join(source,directory.name))).filter(n=>n.endsWith('.html')).sort()) files.push({category:directory.name,path:join(source,directory.name,filename),filename})
}
if(files.length!==pin.expectedComponents) throw new Error('UIVERSE_INVENTORY_MISMATCH')
const sources={},items=[],categories={};let rawBytes=0
for(const file of files) {
 const sourceText=await readFile(file.path,'utf8');rawBytes+=Buffer.byteLength(sourceText)
 const nodes=parseFragment(sourceText)
 let styles=0,utility=false,remote=false,script=false
 function visit(node) {
  if(node.tagName==='style') styles++
  if(node.tagName==='script') script=true
  for(const attribute of node.attrs??[]) {
   if(attribute.name==='class'&&/(?:^|\s)(?:bg-|text-|flex|grid|p[xytblr]?-|rounded-|shadow-)/.test(attribute.value)) utility=true
   if(['src','href','xlink:href'].includes(attribute.name)&&/^https?:/i.test(attribute.value)) remote=true
  }
  if(node.nodeName==='#text'&&/url\(\s*["']?https?:/i.test(node.value))remote=true
  for(const child of node.childNodes??[]) visit(child)
 }
 visit(nodes)
 const authorMatch=sourceText.match(/From Uiverse\.io by ([^\n]*?)(?:\s+- Tags:|\s*\*\/|\s*-->)/i)
 const author=authorMatch?.[1]?.trim()||file.filename.split('_')[0]
 const tags=(sourceText.match(/Tags:\s*([^\n]*?)(?:\*\/|-->|$)/im)?.[1]??'').split(',').map(t=>t.trim()).filter(Boolean)
 const basename=file.filename.slice(0,-5)
 const slug=basename.toLowerCase().startsWith(author.toLowerCase()+'_')?basename.slice(author.length+1):basename.slice(basename.indexOf('_')+1)
 const id=file.category+'/'+basename
 const framework=styles?(utility?'mixed':'css'):(utility?'tailwind':'unspecified')
 const warnings=[]
 if(remote)warnings.push('原组件引用外部资源；离线预览阻止网络，相关图片或字体可能缺失。')
 if(script)warnings.push('原组件包含脚本；隔离预览不执行脚本。')
 if(framework==='unspecified')warnings.push('原文件未包含独立样式，无法确认完整预览；完整原始源码仍保留。')
 const humanType={'Checkboxes':'Checkbox','Toggle-switches':'Switch','Radio-buttons':'Radio','loaders':'Loader'}[file.category]??file.category.replace(/s$/,'')
 items.push({id,title:humanType+' · '+(tags.filter(t=>!t.toLowerCase().includes(humanType.toLowerCase())).slice(0,2).join(' / ')||slug.replaceAll('-',' ')),category:file.category,author,tags,sourceUrl:'https://uiverse.io/'+encodeURIComponent(author)+'/'+encodeURIComponent(slug),sha256:createHash('sha256').update(sourceText).digest('hex'),framework,warnings})
 sources[id]=sourceText;categories[file.category]=(categories[file.category]??0)+1
}
const css=await postcss([tailwind({content:files.map(f=>f.path),theme:{extend:{}},plugins:[],corePlugins:{preflight:true}})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})
const out=join(root,'resources/uiverse');await mkdir(out,{recursive:true})
const manifest={formatVersion:1,commit,snapshotDate:pin.snapshotDate,total:items.length,categories,items}
await writeFile(join(out,'catalog.json'),JSON.stringify(manifest))
await writeFile(join(out,'sources.json.gz'),gzipSync(JSON.stringify({formatVersion:1,sources}),{level:9}))
await writeFile(join(out,'tailwind.css.gz'),gzipSync(css.css,{level:9}))
await writeFile(join(out,'LICENSE'),await readFile(join(source,'LICENSE')))
console.log(JSON.stringify({components:items.length,rawBytes,categories,frameworks:items.reduce((a,i)=>(a[i.framework]=(a[i.framework]??0)+1,a),{}),warnings:items.filter(i=>i.warnings.length).length,cssBytes:Buffer.byteLength(css.css)}))
