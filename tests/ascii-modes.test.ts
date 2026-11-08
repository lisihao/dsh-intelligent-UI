// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAsciiTheme, isGpuAsciiTheme, resolveTheme, themePackageSchema } from '../src/theme-contracts.js'
import { themePreferences } from '../src/theme-runtime.js'
import { appearancePreferences } from '../src/appearance.js'
import { ContentView } from '../src/presentation.js'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
afterEach(()=>{themePreferences.reset();appearancePreferences.reset();vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('explicit classic and GPU ASCII selection',()=>{
  it('keeps legacy V3 themes classic and requires explicit GPU selection',()=>{
    const classic=resolveTheme({activeId:'ascii',installed:[]}),gpu=resolveTheme({activeId:'ascii-gpu',installed:[]})
    expect(isAsciiTheme(classic)).toBe(true);expect(isAsciiTheme(gpu)).toBe(true)
    expect(isGpuAsciiTheme(classic)).toBe(false);expect(isGpuAsciiTheme(gpu)).toBe(true)
    const legacy={...classic};if(legacy.formatVersion!==3)throw Error('Expected V3')
    delete legacy.asciiRenderer;expect(isGpuAsciiTheme(themePackageSchema.parse(legacy))).toBe(false)
    expect(themePackageSchema.safeParse({...gpu,asciiRenderer:'javascript'}).success).toBe(false)
  })
  it('switches the normal automatic chart between real character bars and original GPU-source geometry without changing data',async()=>{
    vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})
    vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}))
    // Only the DOM routing is under test; jsdom has no native text-measure canvas.
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({font:'',measureText:(text:string)=>({width:text.length*7})} as never)
    const text='## 处理费用\n\n| 项目 | 费用（万元） |\n|---|---:|\n|检索|12|\n|分析|24|\n|验证|18|\n\n来源：固定本地测试。'
    const host=document.createElement('div'),root=createRoot(host);document.body.append(host)
    try{
      themePreferences.set({activeId:'ascii',installed:[]})
      await act(async()=>root.render(h(ContentView,{value:text})))
      expect(host.querySelector('[data-ascii-chart=bar]')).not.toBeNull()
      expect(host.querySelector('.iexp-ascii-chart-mark')?.textContent).toContain('▉')
      const original=host.querySelector('.iexp-full-table')?.textContent
      await act(async()=>themePreferences.set({activeId:'ascii-gpu',installed:[]}))
      expect(host.querySelector('[data-ascii-chart=bar]')).toBeNull()
      expect(host.querySelector('[data-auto-chart=bar]')).not.toBeNull()
      expect(host.querySelector('.iexp-full-table')?.textContent).toBe(original)
      await act(async()=>themePreferences.set({activeId:'ascii',installed:[]}))
      expect(host.querySelector('[data-ascii-chart=bar]')).not.toBeNull()
      expect(host.querySelector('.iexp-full-table')?.textContent).toBe(original)
    }finally{await act(async()=>root.unmount());host.remove()}
  })
})
