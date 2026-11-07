import { Fragment, createContext, createElement as h, useCallback, useContext, type ReactElement, type ReactNode } from 'react'
import { isRuneTheme } from './theme-contracts.js'
import { usePresentationTheme } from './theme-runtime.js'
import { CompositionRuntimeContext } from './adaptive-ui/view.js'
import { RuneThemeRegion } from './rune/theme-view.js'

const RunePresentationDepth=createContext(false)

/** One Rust canvas per owned presentation region; nested semantic content keeps its actual DOM. */
export function RunePresentation({children}:{children?:ReactNode}):ReactElement{
 const theme=usePresentationTheme(),nested=useContext(RunePresentationDepth),runtime=useContext(CompositionRuntimeContext)
 const getInfo=runtime.api?.componentRuntimeInfo,sessionId=runtime.sessionId
 const getRuntimeInfo=useCallback(async()=>{
  if(!getInfo||!sessionId)throw Error('RUNE_RUNTIME_API_UNAVAILABLE')
  return getInfo({sessionId,library:'rune'})
 },[getInfo,sessionId])
 if(!isRuneTheme(theme)||nested)return h(Fragment,null,children)
 return h(RunePresentationDepth.Provider,{value:true},h(RuneThemeRegion,{getRuntimeInfo:getInfo&&sessionId?getRuntimeInfo:undefined},children))
}
