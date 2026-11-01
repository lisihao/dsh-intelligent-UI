#!/usr/bin/env node
import { loadCatalog, searchCatalog, getSource, standalonePreview } from './catalog.js'
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
const usage = 'Usage: node cli.mjs categories | search [--query text] [--category category] [--limit 12] [--offset 0] | source --id ID | preview --id ID --out /absolute/file.html [--dark] [--reduced-motion]'
async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === '--help' || command === 'help' || !command) { console.log(usage); return }
  const flags: Record<string,string|boolean> = {}
  const switches = new Set(['--dark','--reduced-motion'])
  for (let i=0;i<args.length;i++) {
    const key=args[i]!
    if (!['--query','--category','--limit','--offset','--id','--out',...switches].includes(key) || key in flags) throw new Error(`UIVERSE_ARGUMENT_INVALID: ${key}`)
    if (switches.has(key)) flags[key]=true
    else { const value=args[++i]; if (value === undefined || value.startsWith('--')) throw new Error(`UIVERSE_ARGUMENT_MISSING: ${key}`); flags[key]=value }
  }
  const catalog=await loadCatalog()
  if(command==='categories') console.log(JSON.stringify({formatVersion:1,commit:catalog.commit,snapshotDate:catalog.snapshotDate,total:catalog.total,categories:catalog.categories},null,2))
  else if(command==='search') console.log(JSON.stringify(searchCatalog(catalog,{query:flags['--query'] as string|undefined,category:flags['--category'] as string|undefined,limit:flags['--limit']===undefined?12:Number(flags['--limit']),offset:flags['--offset']===undefined?0:Number(flags['--offset'])}),null,2))
  else if(command==='source') console.log(JSON.stringify(getSource(catalog,flags['--id'] as string),null,2))
  else if(command==='preview') {
    const out=flags['--out']; if(typeof out!=='string'||!isAbsolute(out)) throw new Error('UIVERSE_OUTPUT_REQUIRED: --out must be an absolute new file path')
    const id=flags['--id'] as string
    const html=standalonePreview(catalog,id,{colorScheme:flags['--dark']?'dark':'light',reducedMotion:!!flags['--reduced-motion']})
    await writeFile(out,html,{flag:'wx'})
    console.log(JSON.stringify({path:out,item:getSource(catalog,id).item,commit:catalog.commit},null,2))
  } else throw new Error('UIVERSE_COMMAND_UNKNOWN: '+usage)
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
