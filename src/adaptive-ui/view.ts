import {ResearchWorkspace,researchModes} from '../research-view.js'
import { createContext, createElement as h, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { ExperienceSettings } from '../contracts.js'
import { builtInThemes, isAsciiTheme, isGpuAsciiTheme, type ThemePackage } from '../theme-contracts.js'
import { PresentationThemeContext, themePreferences, themeStyleTokens } from '../theme-runtime.js'
import { appearancePreferences, appearanceTokens } from '../appearance.js'
import { asciiThemeCss } from '../ascii-style.js'
import { CompositionDepthContext, CompositionSelectionContext } from './scope.js'
import { compositionResultSchema, type CompositionResult, type ComposeInput, type CompositionReceiptInput, type CompositionCancelInput } from './contracts.js'
import { AdaptiveText } from './components.js'
import {recognizeLiveSeries,normalizeCompositionSource} from './source-contracts.js'
import { validateBlockSourceReferences } from './block-compiler.js'

export interface CompositionApi {
  composition(input: ComposeInput): Promise<CompositionResult>
  compositionReceipt(input: CompositionReceiptInput): Promise<unknown>
  compositionCancel(input: CompositionCancelInput): Promise<unknown>
}
export interface CompositionRuntime {
  api?: CompositionApi
  settings?: ExperienceSettings
  sessionId?: string
  suspended?: boolean
}
export const CompositionRuntimeContext = createContext<CompositionRuntime>({})

function browserCapabilities() {
  let webgl = false
  if (typeof document !== 'undefined') {
    // The object-effect path requires WebGL2. A detected constructor alone is insufficient.
    const canvas = document.createElement('canvas')
    try { const gl = canvas.getContext('webgl2'); webgl = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* No GPU candidate. */ }
  }
  return { webgl, reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches }
}
function sourceText(value: unknown): string {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}

/** Reuse a layout only while every actual source block stays structurally compatible. */
function compositionSourceIdentity(value:unknown):unknown {
 const normalized=normalizeCompositionSource(value)
 if(normalized.kind==='blocks')return {kind:'blocks',values:normalized.values.map(compositionSourceIdentity)}
 const effective=normalized.kind==='structured'||normalized.kind==='scalar'?normalized.value:normalized.kind==='markdown'?normalized.markdown:null
 const live=recognizeLiveSeries(effective)
 if(live)return {type:live.type,source:live.source,unit:live.unit,timeUnit:live.timeUnit}
 if(effective&&typeof effective==='object'&&!Array.isArray(effective)){
  const record=effective as Record<string,unknown>,current=record.value??record.current,previous=record.previous??record.previousValue
  const short=(x:unknown)=>typeof x==='number'?Number.isFinite(x):typeof x==='string'&&x.length>0&&x.length<=120&&!/[\r\n`]|https?:\/\/|www\.|\[/.test(x)
  if((record.type==='metric-update'||record.type==='status-update')&&typeof record.label==='string'&&record.editable!==true&&short(current)&&short(previous))return {type:record.type,label:record.label,unit:record.unit??null}
 }
 return effective
}

/** Machine failure codes remain in transport/ledger; the reader sees an actionable local state. */
export function compositionReasonText(code:string):string {
  if(code==='JEV_FEATURE_DISABLED')return 'Jev 的“智能 UI 编排”尚未开启，当前使用本地布局。'
  if(code==='ADAPTIVE_COMPOSITION_DISABLED')return '智能编排已关闭，当前使用本地布局。'
  if(code==='JEV_UNAVAILABLE'||code==='JEV_SERVICE_CHANGED'||code==='JEV_SERVICE_DETACHED')return '当前没有可用的 Jev 判断服务，已保留本地布局。'
  if(/BLOCK.*LIMIT|QUESTION.*LIMIT/.test(code))return '内容块布局试验超出本次分析范围，原文已完整保留并使用本地布局；不会自动重试。'
  if(code==='BLOCK_SOURCE_REFERENCE_INVALID')return '内容块方案未能与当前原文逐块对应，已保留本地布局；不会自动重试。'
  if(/SOURCE_TOO_LARGE|ANALYSIS_LIMIT/.test(code))return '内容超过本次自动判断的范围，原文完整保留并使用本地布局。'
  if(/CANCEL|SOURCE_CHANGED|SETTINGS_CHANGED|CONNECTION_CHANGED|FINGERPRINT|CURRENT/.test(code))return '内容或判断设置已变化，旧方案未应用；当前保留本地布局。'
  if(/CREDENTIAL|CONNECTION_MISSING/.test(code))return 'Jev 判断连接尚未就绪，请在 Jev 设置中检查；当前保留本地布局。'
  if(/TIMEOUT|NETWORK/.test(code))return 'Jev 判断请求未完成，已保留本地布局；不会自动重试。'
  if(/LOG|RECEIPT/.test(code))return '判断记录未能确认，已保留本地布局；不会重复发送请求。'
  return '智能编排暂不可用，已保留本地布局；不会自动重试。'
}

/** The immediate content stays mounted while one source-bound auxiliary decision runs. */
export function AdaptiveCompositionView({ value, documentId: explicitId, sessionId: explicitSession, isStreaming = false, decide = true, children }: { value: unknown; documentId?: string; sessionId?: string; isStreaming?: boolean; decide?: boolean; children?: ReactNode }) {
  const runtime = useContext(CompositionRuntimeContext), nested = useContext(CompositionDepthContext)
  const fallbackTheme = useSyncExternalStore(themePreferences.subscribe, themePreferences.getSnapshot, themePreferences.getSnapshot)
  const appearance = useSyncExternalStore(appearancePreferences.subscribe, appearancePreferences.getSnapshot, appearancePreferences.getSnapshot)
  const instanceId = useId().replaceAll(':', ''), documentId = explicitId ?? `view-${instanceId}`, sessionId = explicitSession ?? runtime.sessionId
  const root = useRef<HTMLDivElement>(null), sequence = useRef(0)
  const [result, setResult] = useState<{ key: string; result: CompositionResult }>()
  const [receiptError, setReceiptError] = useState('')
  const [visible,setVisible]=useState(false)
  useEffect(()=>{
    const target=root.current
    if(!target||nested||!decide||!runtime.settings?.adaptive?.enabled||!runtime.api||!sessionId)return
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'0px'})
    observer.observe(target);return()=>observer.disconnect()
  },[nested,decide,runtime.settings?.adaptive?.enabled,runtime.api,sessionId])
  const [capabilities, setCapabilities] = useState<ReturnType<typeof browserCapabilities>>()
  useEffect(() => {
    if (nested || !decide || !runtime.settings?.adaptive?.enabled) return
    const read = () => setCapabilities(browserCapabilities())
    read()
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    media?.addEventListener?.('change', read)
    return () => media?.removeEventListener?.('change', read)
  }, [nested, decide, runtime.settings?.adaptive?.enabled])
  const adaptive = runtime.settings?.adaptive, blockLayoutEnabled = adaptive?.blockLayout === true
  // A shortcut binding changes controls only. It must not invalidate or purchase a new decision.
  const settingsKey = JSON.stringify([runtime.settings?.takeover, adaptive && { enabled: adaptive.enabled, styleMode: adaptive.styleMode, blockLayout: blockLayoutEnabled }, runtime.settings?.theme])
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { /* An unsupported value keeps its original view. */ }
  // Data ticks reuse a source-compatible composition; they never become paid layout requests.
  // Invalid/new-identity sources fall back to the full revision key and cannot borrow the old plan.
  let decisionSource=serialized
  try{decisionSource=JSON.stringify(compositionSourceIdentity(value))}catch{/* Non-JSON consumers remain local and readable. */}
  const key = JSON.stringify([sessionId, documentId, decisionSource, settingsKey, capabilities, isStreaming])
  const enabled = !!(decide && visible && !nested && runtime.api && sessionId && runtime.settings?.takeover && runtime.settings.adaptive?.enabled && !runtime.suspended && !isStreaming && serialized !== undefined && capabilities !== undefined)
  useEffect(() => {
    const epoch = ++sequence.current
    setReceiptError('')
    if (!enabled || !runtime.api || !sessionId || serialized === undefined || !capabilities) return
    let live = true
    const api = runtime.api, requestId = globalThis.crypto?.randomUUID?.() ?? `${instanceId}-${epoch}`
    const input: ComposeInput = {sessionId, documentId, requestId, value:JSON.parse(serialized), capabilities, isStreaming:false}
    let queued: CompositionResult | undefined
    const interacting = () => {
      const element = root.current, active = element?.ownerDocument.activeElement
      const selection = element?.ownerDocument.getSelection()
      return !!element && (!!active && active !== element.ownerDocument.body && element.contains(active) || !!selection && !selection.isCollapsed && !!selection.anchorNode && element.contains(selection.anchorNode))
    }
    const adopt = () => {
      if (!live || epoch !== sequence.current || !queued || interacting()) return
      setResult({key, result:queued}); queued = undefined
    }
    const events = ['focusout','pointerup','selectionchange'] as const
    events.forEach(name => document.addEventListener(name, adopt))
    void api.composition(input).then(raw => {
      if (!live || epoch !== sequence.current) return
      const parsed = compositionResultSchema.parse(raw)
      const blocks = parsed.status === 'selected' ? parsed.selection?.blockLayout?.blocks : undefined
      // The Host validates choices, and the client repeats only the source binding
      // check before any model-selected block can reach a renderer context.
      queued = blocks && (!blockLayoutEnabled || !validateBlockSourceReferences(input.value, blocks))
        ? { status: 'local', reason: 'BLOCK_SOURCE_REFERENCE_INVALID', sourceVersion: parsed.sourceVersion, requestId: parsed.requestId }
        : parsed
      adopt()
    }).catch(error => {
      if (live && epoch === sequence.current) setResult({key, result:{status:'failed',reason:`智能编排未完成：${error instanceof Error ? error.message : String(error)}`,sourceVersion:'unavailable'}})
    })
    return () => {
      live = false
      events.forEach(name => document.removeEventListener(name, adopt))
      void api.compositionCancel({sessionId,documentId,requestId}).catch(() => { /* Local lifetime ended; never replay a decision. */ })
    }
  }, [enabled, runtime.api, key])
  const current = enabled && result?.key === key ? result.result : undefined
  const themes = useMemo<readonly ThemePackage[]>(() => [...builtInThemes, ...(runtime.settings?.theme?.installed ?? [])], [JSON.stringify(runtime.settings?.theme?.installed)])
  const candidateSelection = current?.status === 'selected' ? current.selection : undefined
  // A result that was valid before a toggle changed is never rendered as a block plan.
  const selection = candidateSelection && (!candidateSelection.blockLayout || blockLayoutEnabled) ? candidateSelection : undefined
  const selectedTheme = selection && themes.find(theme => theme.id === selection.themeId)
  const theme = selectedTheme ?? fallbackTheme
  const selected = !!selection && !!selectedTheme
  const colors = appearanceTokens(appearance, theme), variables = themeStyleTokens(theme, colors)
  const scope = `[data-iexp-composition-scope="${instanceId}"]`
  const declarations = Object.entries(variables).map(([name, v]) => `${name}:${v}`).join(';')
  const scopedCss = `${scope},${scope} .dsh-experience,${scope} .dsh-experience.iexp-content[data-experience-theme]{${declarations};font-variant-ligatures:normal;font-kerning:auto;font-variation-settings:'CASL' 0,'MONO' 0,'slnt' 0,'CRSV' 0;letter-spacing:normal}` + (isAsciiTheme(theme) ? asciiThemeCss.replaceAll('.dsh-experience', `${scope} .dsh-experience`) : '')
  useEffect(() => {
    if (!selected || !current?.operationId || !runtime.api || !sessionId || !root.current) return
    // A mounted layout receipt is an observation, not chart/GPU or business execution proof.
    let live = true
    void runtime.api.compositionReceipt({sessionId,documentId,sourceVersion:current.sourceVersion,operationId:current.operationId,observed:true}).catch(error => { if (live) setReceiptError(`界面已挂载，但记录未确认：${error instanceof Error ? error.message : String(error)}`) })
    return () => { live = false }
  }, [selected, current?.operationId, runtime.api, sessionId, documentId, current?.sourceVersion])
  if (nested || !decide || !runtime.api || !sessionId) return children
  const researchInspection = selection?.layout === 'research' || selection?.blockLayout?.inspection === 'research'
  const normalizedInspectionSource = selection?.blockLayout?.inspection === 'research' ? normalizeCompositionSource(value) : undefined
  const researchText = normalizedInspectionSource?.kind === 'markdown' ? normalizedInspectionSource.markdown : typeof value === 'string' ? value : undefined
  const semanticBody=selected && researchInspection && sessionId && researchText !== undefined && !researchModes.get(sessionId) ? h(ResearchWorkspace,{sessionId,documentId,text:researchText,enabled:true},children) : children
  const body = selected && selection?.surface === 'source' ? h('pre', {className:'iexp-raw-output',style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'var(--iexp-code-font)'}},sourceText(value)) : semanticBody
  const reason = enabled && current && current.status !== 'selected' ? current.reason : ''
  return h(CompositionDepthContext.Provider, {value:true}, h(PresentationThemeContext.Provider, {value:theme}, h(CompositionSelectionContext.Provider, {value:selected ? selection : undefined},
    h('div', {ref:root, 'data-iexp-composition-scope':instanceId, 'data-iexp-adaptive-theme':theme.id, 'data-iexp-adaptive-gpu':String(isGpuAsciiTheme(theme)), 'data-iexp-composition-status':selected ? 'selected' : 'local', 'data-iexp-composition-layout':selection?.layout, style:{minWidth:0,...variables} as CSSProperties},
      h('style',null,scopedCss), body,
      reason && h('p',{role:current?.status==='failed'?'alert':'status',className:'iexp-setting-help'},h(AdaptiveText,{text:compositionReasonText(reason)})),
      receiptError && h('p',{role:'status',className:'iexp-setting-help'},receiptError)))))
}
