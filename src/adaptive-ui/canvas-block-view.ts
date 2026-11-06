import { createElement as h, useContext, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createCanvasClientScope } from '../canvas-client-scope.js'
import { isCanvasHtmlEffectName } from '../canvas-html-names.js'
import { CanvasRuntimeContext } from '../canvas-runtime-context.js'
import { canvasDecorativeColor, isCanvasBlockPresentationId } from './canvas-block-recipes.js'

export interface CanvasBlockViewProps {
  readonly presentation: string
  /** The source renderer's existing DOM. It is never copied into text or hidden. */
  readonly children?: ReactNode
  /** Required only for the strict, source-bound Magnify decorative-color path. */
  readonly value?: unknown
  readonly isStreaming?: boolean
}

type Rgb = readonly [number, number, number]

const opaqueSourceStyle: CSSProperties = {
  // Unlike a translucent card token, this is guaranteed opaque for Clouds and Asciify capture.
  backgroundColor: 'var(--iexp-solid-card)',
  color: 'var(--iexp-text, inherit)',
  backgroundImage: 'none',
  minWidth: 0,
}
const pairStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'stretch',
  gap: 'var(--iexp-space, 1rem)',
  minWidth: 0,
}
const effectHostStyle: CSSProperties = {
  ...opaqueSourceStyle,
  minHeight: '1px',
  overflow: 'hidden',
  position: 'relative',
}

function namedFailure(presentation: string, error: unknown): string {
  const slug = presentation.startsWith('canvas-') ? presentation.slice('canvas-'.length) : presentation
  const detail = error instanceof Error && error.message ? error.message : String(error)
  return `Canvas ${slug} 效果失败：${detail}`
}

function rgbFromComputedSource(source: HTMLElement): Rgb | undefined {
  const win = source.ownerDocument.defaultView
  if (!win) return undefined
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(win.getComputedStyle(source).backgroundColor)
  if (!match) return undefined
  const values = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
  return values.every(value => value >= 0 && value <= 255) ? [values[0] / 255, values[1] / 255, values[2] / 255] : undefined
}

/**
 * Runs a selected Canvas recipe next to—not in place of—the original DOM.
 * The public client scope owns every async load and is always aborted/disposed
 * when this component changes recipe or unmounts.
 */
export function CanvasBlockView({ presentation, children, value, isStreaming = false }: CanvasBlockViewProps): ReactElement {
  const loadEffect = useContext(CanvasRuntimeContext)
  const contentRef = useRef<HTMLDivElement>(null)
  const effectHostRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const particleOutputRef = useRef<HTMLCanvasElement>(null)
  const decorative = presentation === 'canvas-magnify' ? canvasDecorativeColor(value) : undefined
  const [status, setStatus] = useState<'pending' | 'ready' | 'blocked' | 'failed'>('pending')
  const [failure, setFailure] = useState<string | undefined>()
  const particle = presentation === 'canvas-particle-scroll'

  useEffect(() => {
    let live = true
    const controller = new AbortController()
    let scope: ReturnType<typeof createCanvasClientScope> | undefined
    setStatus('pending')
    setFailure(undefined)
    const fail = (error: unknown) => {
      if (!live || controller.signal.aborted) return
      setStatus('failed')
      setFailure(namedFailure(presentation, error))
    }
    if (!isCanvasBlockPresentationId(presentation)) {
      setStatus('blocked')
      setFailure(`Canvas ${presentation} 效果不可用：未知的 Canvas 配方。`)
      return () => { live = false; controller.abort() }
    }
    if (isStreaming) {
      setStatus('blocked')
      setFailure(`Canvas ${presentation.slice('canvas-'.length)} 效果不可用：流式内容尚未稳定。`)
      return () => { live = false; controller.abort() }
    }
    if (presentation === 'canvas-magnify' && !decorative) {
      setStatus('blocked')
      setFailure('Canvas magnify 效果不可用：需要严格的 decorative color 来源记录。')
      return () => { live = false; controller.abort() }
    }

    const content = contentRef.current
    const host = effectHostRef.current
    const scroll = scrollRef.current
    const output = particleOutputRef.current
    if (!content || !particle && !host || particle && (!scroll || !output)) {
      setStatus('failed')
      setFailure(`Canvas ${presentation.slice('canvas-'.length)} 效果失败：效果区域尚未装载。`)
      return () => { live = false; controller.abort() }
    }
    if (particle && (scroll!.clientHeight < 1 || scroll!.scrollHeight <= scroll!.clientHeight)) {
      setStatus('blocked')
      setFailure('Canvas particle-scroll 效果不可用：原始内容尚未形成可滚动视口。')
      return () => { live = false; controller.abort() }
    }

    try { scope = createCanvasClientScope({ load: loadEffect }) }
    catch (error) { fail(error) }
    const currentScope = scope
    if (currentScope) {
      void (async () => {
        try {
          if (particle) {
            await currentScope.createCanvasParticleScrollBridge({
              scroll: scroll!, content, output: output!,
              scope: 'visual-only', sourceRemainsVisible: true,
              onError: fail,
            })
          } else if (presentation === 'canvas-bend' || presentation === 'canvas-hex-float') {
            await currentScope.createCanvasIsolatedEffect({
              slug: presentation.slice('canvas-'.length) as 'bend' | 'hex-float',
              host: host!, content, signal: controller.signal, onError: fail,
            })
          } else {
            const component = presentation.slice('canvas-'.length)
            if (!isCanvasHtmlEffectName(component)) throw new Error('CANVAS_BLOCK_RECIPE_UNSUPPORTED')
            const color = component === 'clouds' ? rgbFromComputedSource(content) : undefined
            await currentScope.createCanvasHtmlEffect({
              component,
              host: host!,
              content,
              scope: 'visual-only',
              sourceRemainsVisible: true,
              ...(component === 'ripple' ? { pointer: true } : {}),
              ...(component === 'magnify' ? { contentRole: 'decoration' as const } : {}),
              ...(color ? { effectOptions: { color } } : {}),
              signal: controller.signal,
              onError: fail,
            })
          }
          if (live && !controller.signal.aborted) setStatus('ready')
        } catch (error) { fail(error) }
      })()
    }
    return () => {
      live = false
      controller.abort()
      try { currentScope?.dispose() } catch { /* teardown must not replace the retained source */ }
    }
  }, [decorative?.cssColor, isStreaming, loadEffect, particle, presentation])

  const statusView = failure ? h('p', { 'data-canvas-block-error': true, role: 'status' }, failure) : null

  if (particle) {
    return h('div', { 'data-canvas-block': true, 'data-canvas-presentation': presentation, 'data-canvas-block-status': status, style: pairStyle },
      h('div', { ref: scrollRef, 'data-canvas-particle-scroll-source': true, style: { ...opaqueSourceStyle, maxHeight: '320px', overflowY: 'auto', overflowX: 'hidden', padding: 0 } },
        h('div', { ref: contentRef, 'data-canvas-block-source': true, style: { ...opaqueSourceStyle, margin: 0 } }, children),
      ),
      h('canvas', { ref: particleOutputRef, 'data-canvas-particle-scroll-output': true, 'data-canvas-block-effect-host': true, 'aria-hidden': true, style: { ...effectHostStyle, width: '100%', height: '100%', pointerEvents: 'none' } }),
      statusView,
    )
  }

  const magnifySource = presentation === 'canvas-magnify' && decorative
  const capturedSource = magnifySource
    ? h('div', { ref: contentRef, 'data-canvas-block-source': true, 'data-canvas-block-swatch': true, style: { ...opaqueSourceStyle, minHeight: '7rem', overflow: 'hidden' } },
      h('span', { 'data-canvas-block-decorative-swatch': true, style: { display: 'block', width: '100%', minHeight: '7rem', backgroundColor: decorative.cssColor } }),
    )
    : h('div', { ref: contentRef, 'data-canvas-block-source': true, style: opaqueSourceStyle }, children)

  return h('div', { 'data-canvas-block': true, 'data-canvas-presentation': presentation, 'data-canvas-block-status': status },
    magnifySource ? h('div', { 'data-canvas-block-original-source': true }, children) : null,
    h('div', { style: pairStyle },
      capturedSource,
      h('div', { ref: effectHostRef, 'data-canvas-block-effect-host': true, 'aria-hidden': true, style: effectHostStyle }),
    ),
    statusView,
  )
}
