import {createServer} from 'node:http'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ResearchStore} from '../../.acceptance/research-store.mjs'
import {REPORT,analysis} from './data.mjs'
const scratch=await mkdtemp(join(process.platform==='darwin'?'/private/tmp':tmpdir(),'iexp-research-browser-'))
const store=new ResearchStore(scratch), pending=new Map()
const seeded={sessionId:'local-research-fixture',documentId:'populated',text:REPORT}
const initial=await store.get(seeded), prepared=await store.prepare({...seeded,expectedRevision:initial.revision})
await store.submit({requestId:prepared.requestId,analysis:analysis(prepared.state.reportHash)},seeded.sessionId)
const directory=fileURLToPath(new URL('.',import.meta.url))
const server=createServer(async(req,res)=>{
 try {
  const address=`http://127.0.0.1:${server.address().port}`
  if(req.headers.origin&&req.headers.origin!==address){res.writeHead(403);res.end('Only this local acceptance page may call the fixture');return}
  const path=new URL(req.url,address).pathname
  if(req.method==='GET'&&['/','/index.html','/fixture.js'].includes(path)){
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html; charset=utf-8')
   res.end(await readFile(join(directory,path.endsWith('.js')?'fixture.js':'index.html')));return
  }
  if(req.method!=='POST'||!path.startsWith('/api/')){res.writeHead(404);res.end();return}
  let bytes=0,parts=[]
  for await(const part of req){bytes+=part.length;if(bytes>2*1024*1024)throw Error('Fixture request too large');parts.push(part)}
  const input=JSON.parse(Buffer.concat(parts).toString('utf8'))
  if(path!=='/api/dispatch'&&(input.sessionId!=='local-research-fixture'||input.text!==REPORT||!['populated','empty'].includes(input.documentId)))throw Error('Fixture accepts only labelled synthetic material')
  let result
  if(path==='/api/get')result=await store.get(input)
  else if(path==='/api/prepare'){result=await store.prepare(input);pending.set(result.prompt,{input,prepared:result})}
  else if(path==='/api/markSubmission')result=await store.markSubmission(input)
  else if(path==='/api/saveNotes')result=await store.saveNotes(input)
  else if(path==='/api/dispatch'){
   const item=pending.get(input.prompt);if(!item)throw Error('Unprepared fixture dispatch')
   await store.submit({requestId:item.prepared.requestId,analysis:analysis(item.prepared.state.reportHash)},item.input.sessionId)
   pending.delete(input.prompt);result={fixture:true,externalModelCalls:0}
  }else{res.writeHead(404);res.end();return}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
})
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,scratch,externalModelCalls:0})+'\n'))
