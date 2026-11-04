// @vitest-environment jsdom
import {act,createElement as h} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it,vi} from 'vitest'
import {TableViewport} from '../src/table-viewport.js'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
it('fits an original wide table, follows container resizing, restores native scrolling and releases observers',async()=>{
  let available=300
  const callbacks:Array<()=>void>=[],disconnect=vi.fn()
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){callbacks.push(callback)}observe(){}disconnect=disconnect})
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('iexp-table-fit-viewport')?available:0})
  vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(function(this:HTMLElement){return this.tagName==='TABLE'?900:0})
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('iexp-table-fit-content')?600:0})
  const host=document.createElement('div'),root=createRoot(host)
  const source=h('table',null,h('tbody',null,h('tr',null,h('td',{'data-source':42},'原始列与值 123.4500'))))
  try{
    await act(async()=>root.render(h(TableViewport,{label:'原始数据表格'},source)))
    const table=host.querySelector('table'),viewport=host.querySelector<HTMLElement>('[role=region]')!
    expect(Number(host.firstElementChild!.getAttribute('data-table-scale'))).toBeCloseTo(1/3)
    expect(viewport.style.height).toBe('200px')
    await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.firstElementChild!.getAttribute('data-table-scale')).toBe('1')
    expect(viewport.style.overflowX).toBe('auto')
    expect(viewport.tabIndex).toBe(0)
    viewport.scrollLeft=600
    await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
    expect(viewport.scrollLeft).toBe(0)
    available=600;await act(async()=>callbacks.forEach(callback=>callback()))
    expect(Number(host.firstElementChild!.getAttribute('data-table-scale'))).toBeCloseTo(2/3)
    expect(viewport.style.height).toBe('400px')
    available=0;await act(async()=>callbacks.forEach(callback=>callback()))
    expect(Number(host.firstElementChild!.getAttribute('data-table-scale'))).toBeCloseTo(2/3)
    available=1200;await act(async()=>callbacks.forEach(callback=>callback()))
    expect(host.querySelector('button')).toBeNull()
    expect(viewport.style.height).toBe('')
    expect(host.querySelector('table')).toBe(table)
    expect(host.querySelector('[data-source="42"]')!.textContent).toBe('原始列与值 123.4500')
  }finally{await act(async()=>root.unmount())}
  expect(disconnect).toHaveBeenCalled()
})
