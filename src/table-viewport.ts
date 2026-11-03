import { createElement as h, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { ThemeButton } from './theme-components.js'

/** Fit the original table, never rewrite cells or shrink the surrounding prose. */
export function TableViewport({children,label,className=''}:{children?:ReactNode,label:string,className?:string}):ReactElement {
  const viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null)
  const [native,setNative]=useState(false),[size,setSize]=useState({scale:1,height:0})
  useEffect(()=>{
    const box=viewport.current,body=content.current
    if(!box||!body)return
    const measure=()=>{
      const available=box.clientWidth
      if(available<=0)return // Closed disclosures retain their last valid measurement.
      const table=body.querySelector('table')
      const width=Math.max(available,table?.scrollWidth??0,table?.offsetWidth??0)
      const next={scale:Math.min(1,available/width),height:Math.max(body.offsetHeight,body.scrollHeight)}
      setSize(old=>Math.abs(old.scale-next.scale)<.0001&&old.height===next.height?old:next)
    }
    measure()
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure)
    observer?.observe(box);observer?.observe(body)
    const table=body.querySelector('table');if(table)observer?.observe(table)
    window.addEventListener('resize',measure)
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure)}
  },[children])
  useEffect(()=>{if(!native&&viewport.current)viewport.current.scrollLeft=0},[native,size.scale])
  const wide=size.scale<.995,scale=native?1:size.scale
  return h('div',{className:`iexp-fit-table ${className}`.trim(),'data-table-scale':scale,'data-table-mode':native?'native':'fit'},
    wide&&h('div',{className:'iexp-table-fit-controls'},
      h('span',null,native?'原尺寸，可横向滚动':`适应宽度 ${Math.max(1,Math.round(scale*100))}%`),
      h(ThemeButton,{type:'button','aria-pressed':native,onClick:()=>setNative(value=>!value)},native?'适应宽度':'原尺寸')),
    h('div',{ref:viewport,className:'iexp-table-fit-viewport',tabIndex:0,role:'region','aria-label':label,
      style:{overflowX:native?'auto':'hidden',overflowY:'hidden',height:scale<1?Math.ceil(size.height*scale):undefined}},
      h('div',{ref:content,className:'iexp-table-fit-content',style:{transform:scale<1?`scale(${scale})`:undefined,transformOrigin:'top left'}},children)))
}

export const tableViewportCss=`
.dsh-experience .iexp-fit-table { min-width:0; max-width:100%; }
.dsh-experience .iexp-table-fit-controls { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; padding:8px 12px; color:var(--iexp-muted); font-size:13px; border-bottom:1px solid var(--iexp-line); }
.dsh-experience .iexp-table-fit-viewport { min-width:0; max-width:100%; scrollbar-color:var(--iexp-line) var(--iexp-bg); }
.dsh-experience .iexp-table-fit-content { min-width:0; display:flow-root; }
.dsh-experience .iexp-table-fit-viewport:focus-visible { outline:2px solid var(--iexp-accent); outline-offset:2px; }
`
