import { createElement as h, createContext, useContext, type ReactElement, type ReactNode } from 'react'
import { bindDilNativeComponent, DIL_NATIVE_TREE_RENDERER_KEY } from '../dil/component-bindings.js'
import { DilNativeTreeView } from '../dil/view.js'
import { createDilLibraryRenderer } from '../dil/library-view.js'
import type { ExecutableComponentDispatch } from './executable-registry.js'
import { TuffUiBlockView } from '../tuffui/view.js'
import { UiverseBlockView } from '../uiverse/runtime-view.js'
import { CuratedComponentView } from './curated-component-view.js'
import { CanvasComponentView } from './canvas-component-view.js'
import { CANVAS_COMPONENT_RENDERER_KEY } from './canvas-component-bindings.js'

export type ExecutableRendererProps = {selection:ExecutableComponentDispatch,renderMarkdown:(source:string)=>ReactNode,children?:ReactNode,value?:unknown,isStreaming?:boolean}
export const ExecutableRenderersContext = createContext<Readonly<Record<string,(props:ExecutableRendererProps)=>ReactElement>>>({'tuffui-v1':TuffUiBlockView,'uiverse-shadow-v1':UiverseBlockView,'curated-ui-v1':CuratedComponentView,[CANVAS_COMPONENT_RENDERER_KEY]:(props)=>h(CanvasComponentView,{selection:props.selection,value:props.value,isStreaming:props.isStreaming},props.children)})

/** Only fixed, registered adapters consume model-selected IDs. Unknown consumers fail visibly. */
export function ExecutableBlockView(props:ExecutableRendererProps):ReactElement {
  const renderers=useContext(ExecutableRenderersContext),{selection,renderMarkdown,children}=props
  try {
    if(selection.rendererKey===DIL_NATIVE_TREE_RENDERER_KEY){
      const plan=bindDilNativeComponent(selection.input)
      if(plan.componentId!==selection.id)throw Error('EXECUTABLE_COMPONENT_ID_MISMATCH')
      return h('div',{'data-iexp-executable-component':selection.id,'data-iexp-renderer':selection.rendererKey},h(DilNativeTreeView,{
        tree:plan.tree,artifactId:selection.id,sessionId:'source-bound-block',renderMarkdown,renderComponent:createDilLibraryRenderer(renderMarkdown),
        ownedHandlerIds:[],ownedFormActionIds:[],
      },children),(plan.tag==='chart'||plan.tag==='pie-chart')&&h('details',null,h('summary',null,'完整来源数据'),children))
    }
    const renderer=renderers[selection.rendererKey]
    if(renderer)return h(renderer,props)
    throw Error('EXECUTABLE_COMPONENT_RENDERER_UNAVAILABLE')
  } catch(error) {
    return h('section',{'data-iexp-executable-failure':true},h('p',{role:'alert'},`所选组件未能呈现：${error instanceof Error?error.message:String(error)}`),children)
  }
}
