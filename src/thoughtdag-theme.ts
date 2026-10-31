import type { ExperienceSettings } from './contracts.js'
import recursiveFont from '../assets/recursive-latin-full-normal.woff2'

type SettingsSource = { snapshot(): { settings?: ExperienceSettings }; subscribe(listener: () => void): () => void }
type FrameTheme = { style?: HTMLStyleElement, document?: Document, load: () => void, warning?: string }
const frameSelector = 'iframe[title="ThoughtDAG"]'

/** Material-only adapter for the installed ThoughtDAG SPA's semantic CSS tokens. */
function thoughtDagCss(variables: Record<string, string>): string {
  const declarations = Object.entries(variables).filter(([name]) => /^--iexp-[a-z0-9-]+$/.test(name)).map(([name, value]) => `${name}:${value} !important;`).join('')
  return `
@font-face { font-family:'DSH Recursive';src:url('${recursiveFont}') format('woff2');font-weight:300 1000;font-style:normal;font-display:swap; }
:root {
  ${declarations}
  color-scheme:var(--iexp-color-scheme,normal);
  --font-sans:var(--iexp-font,system-ui,sans-serif) !important;
  --default-font-family:var(--iexp-font,system-ui,sans-serif) !important;
  /* #root paints the one canvas base. Nested surface aliases must not stack its alpha. */
  --color-surface:transparent !important;
  --color-card:var(--iexp-card) !important;
  --color-wash:var(--iexp-soft) !important;
  --color-line:var(--iexp-line) !important;
  --color-line-strong:var(--iexp-line) !important;
  --color-ink:var(--iexp-text) !important;
  --color-ink-muted:var(--iexp-muted) !important;
  --color-ink-faint:var(--iexp-muted) !important;
  --color-accent:var(--iexp-accent) !important;
  --color-accent-strong:var(--iexp-accent) !important;
  --color-warm:var(--iexp-warning) !important;
  --color-trace:var(--iexp-warning) !important;
  --color-watch:var(--iexp-error) !important;
  --radius-sm:var(--iexp-control-radius,4px) !important;
  --radius-md:var(--iexp-control-radius,6px) !important;
  --radius-lg:var(--iexp-card-radius,12px) !important;
  --radius-xl:var(--iexp-card-radius,16px) !important;
  --radius-2xl:var(--iexp-panel-radius,20px) !important;
  --color-red-50:var(--iexp-soft) !important;--color-red-100:var(--iexp-soft) !important;--color-red-200:var(--iexp-line) !important;
  --color-red-500:var(--iexp-error) !important;--color-red-600:var(--iexp-error) !important;--color-red-700:var(--iexp-error) !important;
  --color-green-50:var(--iexp-soft) !important;--color-green-200:var(--iexp-line) !important;
  --color-green-600:var(--iexp-success) !important;--color-green-700:var(--iexp-success) !important;
  --color-amber-50:var(--iexp-soft) !important;--color-amber-100:var(--iexp-soft) !important;--color-amber-200:var(--iexp-line) !important;
  --color-amber-400:var(--iexp-warning) !important;--color-amber-500:var(--iexp-warning) !important;--color-amber-600:var(--iexp-warning) !important;
  --color-amber-700:var(--iexp-warning) !important;--color-amber-800:var(--iexp-warning) !important;
  --canvas-dot:var(--iexp-line) !important;--canvas-grid-fine:color-mix(in srgb,var(--iexp-line) 50%,transparent) !important;--canvas-grid-major:var(--iexp-line) !important;
}
.react-flow {
  --xy-background-color:var(--iexp-bg);--xy-node-color:var(--iexp-text);--xy-node-background-color:var(--iexp-card);
  --xy-node-border:1px solid var(--iexp-line);--xy-edge-stroke:var(--iexp-muted);--xy-edge-stroke-selected:var(--iexp-accent);
  --xy-minimap-background-color:var(--iexp-card);--xy-controls-button-background-color:var(--iexp-card);
  --xy-controls-button-background-color-hover:var(--iexp-card-hover);--xy-controls-button-color:var(--iexp-text);
}
html,body,#root { font-family:var(--iexp-font,system-ui,sans-serif);caret-color:var(--iexp-accent);scrollbar-color:var(--iexp-line) var(--iexp-bg); }
/* Bounded logo exception: the installed SPA has no brand-font token. Its landing
   SVG + h1 lockup shares a row with the owner's absolute toolbar. Retain the
   original Inter metrics here; body/card typography continues to use the theme. */
#root .text-center.mb-8 > svg[aria-hidden="true"] + h1.text-4xl.font-semibold.tracking-tight {
  font-family:"Inter Variable",-apple-system,"PingFang SC","Hiragino Sans GB","Segoe UI",sans-serif;
}
html,body { background:transparent !important; }
#root { background:var(--iexp-bg) !important; }
.react-flow__background { background:transparent !important; }
.panel-card { border-radius:var(--iexp-panel-radius,14px) !important;box-shadow:var(--iexp-shadow-panel,none) !important; }
.thought-node,.content-card { border-radius:var(--iexp-node-radius,12px) !important; }
.react-flow__controls,.react-flow__minimap { border-radius:var(--iexp-control-radius,12px) !important; }
:is(.bg-accent,.bg-watch,.bg-warm):is(.text-white,.text-card) { color:var(--iexp-button-text) !important; }
::selection { background:var(--iexp-accent);color:var(--iexp-button-text); }
`
}

function knownFrame(frame: HTMLIFrameElement): boolean {
  const host = frame.closest('[data-dsh-thoughtdag]')
  if (!host || host.parentElement !== document.body || frame.title !== 'ThoughtDAG' || frame.hasAttribute('srcdoc')) return false
  // The owner initially creates a lazy frame. Register its load listener before src is assigned.
  return frame.dataset.src === '/thoughtdag/' || /^\/thoughtdag\/(?:[?#]|$)/.test(frame.getAttribute('src') ?? '')
}

/**
 * Bridge only the explicit same-origin ThoughtDAG iframe, through an owned stylesheet.
 * Original styles, nodes, attributes, event handlers, storage and graph geometry remain owner-controlled.
 */
export function installThoughtDagThemeBridge(source: SettingsSource, variables: (settings: ExperienceSettings) => Record<string, string>): () => void {
  const frames = new Map<HTMLIFrameElement, FrameTheme>()
  let css = '', disposed = false, observing = false
  const clearStyle = (entry: FrameTheme) => { entry.style?.remove(); entry.style = undefined; entry.document = undefined }
  const remove = (frame: HTMLIFrameElement, entry: FrameTheme) => { frame.removeEventListener('load', entry.load); clearStyle(entry); frames.delete(frame) }
  const apply = (frame: HTMLIFrameElement, entry: FrameTheme) => {
    if (!css || !knownFrame(frame) || !frame.isConnected) { clearStyle(entry); return }
    const warn = (reason: string) => { if (entry.warning !== reason) { entry.warning = reason; console.warn(`智能体验：ThoughtDAG 主题未应用（${reason}）。`) } }
    try {
      const src = frame.getAttribute('src')
      if (!src) return
      const url = new URL(src, document.baseURI), owner = new URL(document.baseURI)
      if (url.protocol !== owner.protocol || url.host !== owner.host) { clearStyle(entry); warn('嵌入页面不是同源页面'); return }
      if (url.pathname !== '/thoughtdag/') { clearStyle(entry); warn('嵌入页面地址已改变'); return }
      const frameDocument = frame.contentDocument
      if (!frameDocument) { clearStyle(entry); warn('无法访问嵌入页面'); return }
      // While navigation is pending, do not style the initial about:blank document.
      if (frameDocument.URL === 'about:blank' || !frameDocument.head) return
      const loaded = new URL(frameDocument.URL)
      if (loaded.protocol !== owner.protocol || loaded.host !== owner.host || loaded.pathname !== '/thoughtdag/') { clearStyle(entry); warn('加载后的嵌入页面地址已改变'); return }
      if (entry.document !== frameDocument || !entry.style?.isConnected) {
        clearStyle(entry)
        entry.document = frameDocument; entry.style = frameDocument.createElement('style')
        entry.style.dataset.solarExperienceThoughtdag = 'true'; entry.style.textContent = css
        frameDocument.head.append(entry.style)
      } else if (entry.style.textContent !== css) entry.style.textContent = css
      entry.warning = undefined
    } catch { clearStyle(entry); warn('浏览器限制了嵌入页面访问'); }
  }
  const add = (frame: HTMLIFrameElement) => {
    if (!knownFrame(frame) || frames.has(frame)) return
    const entry: FrameTheme = { load: () => apply(frame, entry) }
    frames.set(frame, entry); frame.addEventListener('load', entry.load); apply(frame, entry)
  }
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return
    if (node instanceof HTMLIFrameElement) add(node)
    node.querySelectorAll<HTMLIFrameElement>(frameSelector).forEach(add)
  }
  const observer = new MutationObserver(records => {
    if (!css || disposed) return
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLIFrameElement) {
        const entry = frames.get(record.target)
        if (entry) apply(record.target, entry); else add(record.target)
      } else for (const node of record.addedNodes) scan(node)
    }
    for (const [frame, entry] of frames) if (!frame.isConnected || !knownFrame(frame)) remove(frame, entry)
  })
  const sync = () => {
    if (disposed) return
    const settings = source.snapshot().settings
    css = settings?.takeover ? thoughtDagCss(variables(settings)) : ''
    if (!css) {
      observer.disconnect(); observing = false
      for (const [frame, entry] of frames) remove(frame, entry)
      return
    }
    if (!observing && document.body) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'title', 'srcdoc'] }); observing = true
      document.body.querySelectorAll<HTMLIFrameElement>(':scope > [data-dsh-thoughtdag] iframe[title="ThoughtDAG"]').forEach(add)
    }
    for (const [frame, entry] of frames) apply(frame, entry)
  }
  const unsubscribe = source.subscribe(sync)
  sync()
  return () => { disposed = true; unsubscribe(); observer.disconnect(); for (const [frame, entry] of frames) remove(frame, entry) }
}
