import { createContext, createElement as h, useContext, type ReactElement } from 'react'
import { ThemeCard, ThemeLoader } from '../theme-components.js'
import { CompositionSelectionContext, useCompositionSelection } from './scope.js'
import { usePresentationTheme } from '../theme-runtime.js'
import { bindDilNativeComponent } from '../dil/component-bindings.js'
import { DilNativeTreeView } from '../dil/view.js'
import { validateCuratedUiInput } from './library-component-bindings.js'
import type { ExecutableRendererProps } from './executable-block-view.js'
import type { ComponentSet } from '../theme-contracts.js'

/**
 * A curated Uiverse control can report a local native-control update only
 * through this explicit owner port. It never receives Host action authority.
 */
export type CuratedUiEvent = Readonly<{
 componentSet: ComponentSet
 role: 'button' | 'input' | 'toggle'
 handlerId: string
 args: readonly unknown[]
}>
export type CuratedUiEventPort = (event: CuratedUiEvent) => void | Promise<void>
export const CuratedUiEventPortContext = createContext<CuratedUiEventPort | undefined>(undefined)

export function CuratedComponentView({selection,renderMarkdown,children}:ExecutableRendererProps):ReactElement{
 const inherited=useCompositionSelection(),theme=usePresentationTheme(),eventPort=useContext(CuratedUiEventPortContext)
 try{
  const input=validateCuratedUiInput(selection.input)
  if(selection.id!==`uiverse:${input.componentSet}:${input.role}`)throw Error('CURATED_COMPONENT_ID_MISMATCH')
  if(input.role==='card')return h(ThemeCard,{componentSet:input.componentSet,renderRole:'content','data-iexp-executable-component':selection.id},children)
  if(input.role==='loader')return h(ThemeLoader,{componentSet:input.componentSet,label:input.label})
  if(input.role!=='button'&&input.role!=='input'&&input.role!=='toggle')throw Error('CURATED_COMPONENT_ROLE_INVALID')
  const role=input.role
  const plan=bindDilNativeComponent(input.node)
  const scoped={themeId:theme.id,surface:'semantic',chart:'auto',objectEffect:'none',layout:'document',...inherited,componentSet:input.componentSet}as const
  const native=h(DilNativeTreeView,{tree:plan.tree,artifactId:selection.id,sessionId:'source-bound-block',ownedHandlerIds:plan.requiredHandlerIds,ownedFormActionIds:[],
   onHandler:eventPort?((handlerId,args)=>eventPort({componentSet:input.componentSet,role,handlerId,args})):undefined,renderMarkdown},children)
  return h(CompositionSelectionContext.Provider,{value:scoped},role==='input'&&input.label?h('label',{'data-iexp-curated-input-label':true},input.label,native):native)
 }catch(error){return h('section',{'data-iexp-executable-failure':true},h('p',{role:'alert'},`所选组件未能呈现：${error instanceof Error?error.message:String(error)}`),children)}
}
