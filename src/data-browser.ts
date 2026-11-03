import {createElement as h,useCallback,useEffect,useRef,useState,type ReactElement,type ReactNode,type KeyboardEvent} from 'react'
import {IconWrapper} from '@openuidev/react-ui'
import type {ExperienceApi,ExperienceArtifact} from './contracts.js'
import {LOCAL_FILE_SCOPE} from './file-library-contracts.js'
import {LocalDataImport} from './local-data-import.js'
import {DocumentView} from './document-view.js'
import {DisplayModeControl,useDisplayMode} from './presentation.js'
import {ThemeButton,ThemeInput} from './theme-components.js'

export interface DataBrowserApi extends Pick<ExperienceApi,'publish'> {localFiles():Promise<ExperienceArtifact[]>}
const identity=(file:ExperienceArtifact)=>`${file.source.sessionId}:${file.id}`
const fileName=(file:ExperienceArtifact)=>file.source.label.replace(/^本地导入：/,'')||'未命名文件'
const date=new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short'})
function fileDate(value:string):string {const timestamp=Date.parse(value);return Number.isFinite(timestamp)?date.format(timestamp):'时间未知'}

/** A plugin-owned file library. It does not create, switch or submit a Host session. */
export function DataBrowser({api,themeControl}:{api?:DataBrowserApi;themeControl?:ReactNode}):ReactElement {
  const [files,setFiles]=useState<ExperienceArtifact[]>([]),[selectedId,setSelectedId]=useState(''),[query,setQuery]=useState('')
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[importOpen,setImportOpen]=useState(false)
  const epoch=useRef(0),alive=useRef(true),mode=useDisplayMode(LOCAL_FILE_SCOPE)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++}},[])
  const refresh=useCallback(async()=>{
    if(!api)return
    const token=++epoch.current;setLoading(true);setError('')
    try{const result=await api.localFiles();if(alive.current&&token===epoch.current)setFiles(result)}
    catch(cause){if(alive.current&&token===epoch.current)setError(`无法读取文件库：${cause instanceof Error?cause.message:String(cause)}`)}
    finally{if(alive.current&&token===epoch.current)setLoading(false)}
  },[api])
  useEffect(()=>{setFiles([]);setSelectedId('');setLoading(false);setError('');void refresh();return()=>{epoch.current++}},[refresh])
  const filtered=files.filter(file=>fileName(file).toLocaleLowerCase(date.resolvedOptions().locale).includes(query.toLocaleLowerCase(date.resolvedOptions().locale)))
  const selected=filtered.find(file=>identity(file)===selectedId)??filtered[0]
  function imported(file:ExperienceArtifact){
    epoch.current++;setLoading(false);setError('');setQuery('');setSelectedId(identity(file));setImportOpen(false)
    setFiles(current=>[file,...current.filter(item=>identity(item)!==identity(file))])
  }
  return h('section',{className:'dsh-experience iexp-document-workbench iexp-data-browser','aria-label':'数据浏览器'},
    h('header',{className:'iexp-workbench-toolbar'},h('h1',null,'数据浏览器'),
      h('div',{className:'iexp-workbench-actions'},
        h(ThemeButton,{className:'iexp-workbench-control',disabled:!api,'aria-expanded':importOpen,onClick:()=>setImportOpen(value=>!value)},h(IconWrapper,{name:'file-up',size:16}),'导入文件'),
        h(ThemeButton,{className:'iexp-workbench-control',disabled:!api||loading,onClick:()=>void refresh()},loading?'正在读取…':'刷新'),
        h(DisplayModeControl,{sessionId:LOCAL_FILE_SCOPE}),themeControl)),
    !api&&h('p',{role:'status'},'文件库服务尚未连接，请检查智能 UI 插件连接。'),
    error&&h('p',{role:'alert',className:'iexp-workbench-error'},error),
    api&&importOpen&&h('div',{className:'iexp-browser-import'},h(LocalDataImport,{api,sessionId:LOCAL_FILE_SCOPE,onImported:imported})),
    h('div',{className:'iexp-workbench-body','data-empty':files.length===0},
      files.length>0&&h('aside',{className:'iexp-workbench-list','aria-label':'已导入文件'},
        h('label',{className:'iexp-workbench-search'},h('span',null,'搜索文件'),h(ThemeInput,{className:'iexp-workbench-control',value:query,placeholder:'搜索文件名称',onChange:event=>setQuery(event.currentTarget.value)})),
        h('p',{className:'iexp-workbench-meta',role:'status'},`${new Intl.NumberFormat().format(filtered.length)} 个文件`),
        filtered.length?h('ul',null,...filtered.map(file=>h('li',{key:identity(file)},h(ThemeButton,{className:'iexp-workbench-entry','aria-current':selected&&identity(selected)===identity(file)?'true':undefined,onClick:()=>setSelectedId(identity(file))},
          h('strong',null,fileName(file)),h('span',null,fileDate(file.createdAt)))))):h('p',null,'没有匹配的文件，请换个名称试试。')),
      h('div',{className:'iexp-workbench-reader',tabIndex:0,'aria-label':'文件内容',onKeyDown:(event:KeyboardEvent<HTMLDivElement>)=>{if(event.target!==event.currentTarget||event.altKey||event.metaKey||!['Home','End'].includes(event.key))return;event.preventDefault();event.currentTarget.scrollTo({top:event.key==='Home'?0:event.currentTarget.scrollHeight,behavior:'instant'})}},
        selected?h(DocumentView,{documentId:`file:${identity(selected)}`,value:selected.payload,raw:selected.raw,source:{label:selected.source.label},mode}):
          h('div',{className:'iexp-workbench-empty'},h(IconWrapper,{name:'files',size:24}),h('h2',null,loading?'正在读取文件…':'导入文件，直接浏览内容'),h('p',null,'支持 JSON、Markdown 和 TXT，自动呈现合适的图表、表格和图谱；完整原文随时可查。'),
            api&&!loading&&h(ThemeButton,{className:'iexp-workbench-control',onClick:()=>setImportOpen(true)},'选择本地文件')))))
}
