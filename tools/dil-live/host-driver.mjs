import{readFile,writeFile,mkdir,open}from'node:fs/promises'
import{join}from'node:path'
import{credentialRef}from'@deepseek-ai/dsh-credentials'
const provider='deepseek-official',model='deepseek-flash',reasoningEffort='high'
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{mode:0o600})
async function drive(ctx){
 const output=process.env.DIL_LIVE_OUTPUT,mode=process.env.DIL_LIVE_MODE
 await mkdir(output,{recursive:true})
 const credential=await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY'))
 if(!credential.configured)throw new Error('DIL_LIVE_CREDENTIAL_NOT_CONFIGURED')
 const models=await ctx.llm.listModels(provider)
 const info=await ctx.llm.resolveModelInfo(provider,model)
 await save(join(output,'preflight.json'),{formatVersion:1,provider,model,reasoningEffort,credentialConfigured:true,models:models.map(m=>({id:m.id,name:m.name})),modelInfo:info,modelCalls:0})
 if(mode==='preflight'){ctx.get('appExit')(0);return}
 const request=JSON.parse(await readFile(process.env.DIL_LIVE_REQUEST,'utf8'))
 if(typeof request.prompt!=='string'||typeof request.requestId!=='string'||typeof request.sessionId!=='string')throw new Error('DIL_LIVE_REQUEST_INVALID')
 const ledgerPath=join(output,'dispatch.json')
 const ledger=await open(ledgerPath,'wx',0o600)
 await ledger.writeFile(JSON.stringify({formatVersion:1,status:'dispatching',provider,model,reasoningEffort,sessionId:request.sessionId,requestId:request.requestId,startedAt:new Date().toISOString()}));await ledger.sync();await ledger.close()
 const nativeFetch=globalThis.fetch;let posts=0;const network=[]
 globalThis.fetch=async(resource,options)=>{
  const method=options?.method??(resource instanceof Request?resource.method:'GET')
  const url=new URL(typeof resource==='string'?resource:resource instanceof URL?resource:resource.url)
  const trace={method,origin:url.origin,path:url.pathname,startedAt:new Date().toISOString()};network.push(trace)
  if(method==='POST'&&/chat\/completions|responses|messages$/.test(url.pathname)){posts++;if(posts>1)throw new Error('DIL_LIVE_ONE_MODEL_ATTEMPT_BUDGET')}
  await save(join(output,'network.json'),{posts,network})
  try{const response=await nativeFetch(resource,options);trace.status=response.status;await save(join(output,'network.json'),{posts,network});return response}
  catch(error){trace.failed=true;await save(join(output,'network.json'),{posts,network});throw error}
 }
 let handle
 try{
  handle=request.resume===true ? await ctx.agents.resume({resumeSessionId:request.sessionId,agentOptions:{provider,model,reasoningEffort}}) : await ctx.agents.create({sessionId:request.sessionId,agentOptions:{provider,model,reasoningEffort}})
  handle.agent.followup({id:request.requestId,role:'user',source:{kind:'user'},content:[{type:'text',text:request.prompt}]})
  await handle.agent.whenIdle()
  const session=ctx.sessions.get(handle.agent.id)
  if(!session)throw new Error('DIL_LIVE_SESSION_MISSING')
  const messages=session.deriveMessages()
  await save(join(output,'session-log.json'),session.log)
  await save(join(output,'messages.json'),messages)
  const requestIndex=messages.findIndex(x=>x.id===request.requestId&&x.role==='user')
  if(requestIndex<0)throw new Error('DIL_LIVE_REQUEST_NOT_IN_SESSION')
  // A resumed session already contains older replies; they cannot satisfy a new request.
  const last=messages.slice(requestIndex+1).reverse().find(x=>x.role==='assistant'&&x.content?.some(b=>b.type==='text'))
  const text=last?.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  if(text)await writeFile(join(output,'response.txt'),text,{mode:0o600})
  const receipt={formatVersion:1,status:text?'response-recorded':'no-assistant-text',provider,model,reasoningEffort,sessionId:request.sessionId,requestId:request.requestId,modelPosts:posts,network,logEvents:session.log.length,completedAt:new Date().toISOString()}
  await save(ledgerPath,receipt)
  await handle.dispose();handle=undefined
  ctx.get('appExit')(text?0:1)
 }finally{globalThis.fetch=nativeFetch;if(handle)await handle.dispose()}
}
export const name='dil-live-driver'
export const inject=['appReady','agents','llm','credentials','sessions']
export function apply(ctx){let started=false;return ctx.get('appReady').onReady(()=>{if(started)return;started=true;void drive(ctx).catch(async error=>{await save(join(process.env.DIL_LIVE_OUTPUT,'error.json'),{name:error.name,code:error.code,message:String(error.message).replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED]')});ctx.get('appExit')(1)})})}
