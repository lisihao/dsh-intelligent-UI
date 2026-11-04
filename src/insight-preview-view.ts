import {createElement as h,useEffect,useRef,useState,type ReactElement,type ChangeEvent,type SyntheticEvent} from 'react'
import type {InsightPreviewSnapshot} from './insight-preview-contracts.js'
import type {ResearchApi} from './research-contracts.js'
import {ResearchWorkspace} from './research-view.js'
import {DocumentView} from './document-view.js'
import {useDisplayMode} from './presentation.js'
import {ThemeButton} from './theme-components.js'

export interface InsightPreviewApi {insightPreview(input:{sessionId:string}):Promise<InsightPreviewSnapshot>}
const active=new Set(['queued','pending','running','stopping','needs-input','attention'])
const labels:Record<string,string>={queued:'等待执行',pending:'等待执行',running:'执行中',completed:'已完成',failed:'执行失败',cancelled:'已取消',stopping:'正在停止',unknown:'状态待核对',attention:'需要处理','needs-input':'等待输入'}
const status=(value:string)=>labels[value]??'状态待核对'
const pptx={pending:'等待原流程生成 PPTX',available:'来源已提供 PPTX 记录','not-in-flow':'此流程没有 PPTX 步骤',unknown:'来源未提供可确认的 PPTX 状态'}
function structuredValue(text:string):unknown {
  const body=/^```json\s*\n([\s\S]*?)\n```\s*$/u.exec(text.trim())?.[1]??text
  if(!/^[\s]*[\[{]/u.test(body))return text
  try{return JSON.parse(body)}catch{return text}
}
function RawRun({value}:{value:unknown}):ReactElement {
  const [open,setOpen]=useState(false)
  return h('details',{className:'iexp-preview-provenance',onToggle:(event:SyntheticEvent<HTMLDetailsElement>)=>setOpen(event.currentTarget.open)},h('summary',null,'原始运行记录'),open&&h('pre',null,JSON.stringify(value,null,2)))
}

/** Read existing outputs while the deck is still pending; never execute the workflow. */
export function InsightPreview({api,sessionId,researchApi,onOrganize}:{api?:InsightPreviewApi;sessionId:string;researchApi?:ResearchApi;onOrganize?:(prompt:string,signal:AbortSignal)=>Promise<void>}):ReactElement {
  const [snapshot,setSnapshot]=useState<InsightPreviewSnapshot>(),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [revision,setRevision]=useState(0),[runId,setRunId]=useState(''),[outputId,setOutputId]=useState('')
  const root=useRef<HTMLElement>(null),mode=useDisplayMode(sessionId)
  useEffect(()=>{
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined
    let inFlight=false
    setSnapshot(undefined);setError('');setRunId('');setOutputId('')
    if(!api){setLoading(false);return}
    async function read(initial=false){
      if(disposed||inFlight)return
      if(!initial&&(document.visibilityState==='hidden'||root.current?.getClientRects().length===0)){timer=setTimeout(()=>void read(),5000);return}
      inFlight=true;setLoading(true)
      try{
        const next=await api!.insightPreview({sessionId})
        if(disposed)return
        if(next.sessionId!==sessionId)throw Error('洞察结果与当前会话不一致，请重新打开原会话。')
        setSnapshot(next);setError('')
        if(next.runs.some(run=>active.has(run.status)))timer=setTimeout(()=>void read(),5000)
      }catch(cause){if(!disposed)setError(`洞察结果暂不可读：${cause instanceof Error?cause.message:String(cause)}`)}
      finally{inFlight=false;if(!disposed)setLoading(false)}
    }
    const visible=()=>{if(document.visibilityState==='visible'&&!inFlight){clearTimeout(timer);void read()}}
    document.addEventListener('visibilitychange',visible);void read(true)
    return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}
  },[api,sessionId,revision])
  const current=snapshot?.sessionId===sessionId?snapshot:undefined
  const run=current?.runs.find(value=>value.id===runId)??current?.runs[0]
  const outputs=run?.outputs.filter(output=>output.text.trim())??[]
  const output=outputs.find(value=>value.id===outputId)??outputs.find(value=>value.location==='run-output'||value.location==='task-output')??outputs[0]
  return h('section',{ref:root,className:'dsh-experience iexp-document-workbench iexp-insight-preview','aria-label':'洞察预览'},
    h('header',{className:'iexp-workbench-toolbar'},h('h2',null,'洞察预览'),h(ThemeButton,{className:'iexp-workbench-control',disabled:!api||loading,onClick:()=>setRevision(value=>value+1)},loading?'正在读取…':'刷新结果')),
    h('p',{className:'iexp-workbench-meta'},'先浏览已有分析、图表与来源；PPTX 状态来自原流程。'),
    error&&h('p',{role:'alert',className:'iexp-workbench-error'},error),
    (!api||current&&!current.available)&&h('p',{role:'status'},'洞察结果来源尚未连接。启用已有的洞察服务后可在这里预览。'),
    current?.warnings.length? h('details',{className:'iexp-preview-provenance'},h('summary',null,`来源状态（${current.warnings.length}）`),h('ul',null,...current.warnings.map((warning,index)=>h('li',{key:index},warning)))):null,
    current?.available&&!current.runs.length&&h('p',{role:'status'},'当前会话还没有洞察结果。已有分析步骤产出后，可在这里预览。'),
    run&&h('div',{className:'iexp-preview-selectors'},
      h('label',null,'洞察运行',h('select',{className:'iexp-workbench-control',value:run.id,onChange:(event:ChangeEvent<HTMLSelectElement>)=>{setRunId(event.currentTarget.value);setOutputId('')}},...current!.runs.map(item=>h('option',{key:item.id,value:item.id},`${item.title||'未命名洞察'} · ${item.source==='workflow'?'流程':'任务'} · ${status(item.status)}`)))),
      outputs.length>0&&h('label',null,'预览内容',h('select',{className:'iexp-workbench-control',value:output?.id,onChange:(event:ChangeEvent<HTMLSelectElement>)=>setOutputId(event.currentTarget.value)},...outputs.map(item=>h('option',{key:item.id,value:item.id},`${item.label||'未命名输出'} · ${status(item.status)}`))))),
    run&&h('p',{className:'iexp-workbench-meta',role:'status'},pptx[run.pptxState]),
    run&&!output&&h('p',{role:'status'},'这项运行尚无可预览正文；原始运行记录仍可查看。'),
    run&&h(RawRun,{key:run.id,value:run.raw}),
    output&&h('div',{className:'iexp-preview-document',key:JSON.stringify([sessionId,run!.id,output.id])},
      h(ResearchWorkspace,{sessionId,documentId:output.documentId,text:output.text,api:researchApi,onOrganize,enabled:mode==='visual'},
        h(DocumentView,{documentId:`preview:${run!.id}:${output.id}`,value:structuredValue(output.text),raw:output.text,mode,source:{label:`${run!.title||'未命名洞察'} · ${output.label||'已有输出'}`}}))))
}
