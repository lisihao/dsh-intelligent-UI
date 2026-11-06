import {
  RUNE_MAX_SURFACES,
  RUNE_MAX_VISIBLE_HEIGHT,
  RUNE_MAX_VISIBLE_WIDTH,
  parseRuneMaterialPayload,
  type RuneMaterialPayload,
  type RuneSurface,
  type RuneSurfaceMaterial,
  type RuneSurfaceRole,
  type RuneSurfaceState,
} from './contracts.js'

export type RuneViewport = Readonly<{ readonly width: number, readonly height: number }>
export type RuneGeometrySurface = Readonly<{ readonly element: HTMLElement, readonly surface: RuneSurface }>
export type RuneRegionGeometry = Readonly<{
  readonly payload: RuneMaterialPayload
  readonly visibleYOffset: number
  readonly frameWidth: number
  readonly frameHeight: number
  readonly surfaces: readonly RuneGeometrySurface[]
}>

type Rect = Readonly<{ left: number, top: number, right: number, bottom: number, width: number, height: number }>

const roleValues = new Set<RuneSurfaceRole>(['reading', 'card', 'button', 'input', 'toggle', 'chart'])
const materialValues = new Set<RuneSurfaceMaterial>(['native', 'liquid-metal', 'fluted-glass'])
const executableForeignPrefixes = ['uiverse:', 'tuffui:', 'canvas:'] as const
const foreignComponentRootAttributes = [
  'data-canvas-component',
  'data-tuffui-component',
  'data-dil-library-component',
] as const

/** Stable only for the life of a mounted region; neither DOM text nor source IDs enter Rust. */
export class RuneSurfaceIds {
  private next = 1
  private readonly ids = new WeakMap<HTMLElement, string>()

  for(element: HTMLElement): string {
    const prior = this.ids.get(element)
    if (prior) return prior
    const id = `rune-surface-${String(this.next++)}`
    this.ids.set(element, id)
    return id
  }
}

function finite(value: number): boolean { return Number.isFinite(value) }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function rectOf(element: HTMLElement): Rect | undefined {
  const rect = element.getBoundingClientRect()
  const right = finite(rect.right) ? rect.right : rect.left + rect.width
  const bottom = finite(rect.bottom) ? rect.bottom : rect.top + rect.height
  if (![rect.left, rect.top, right, bottom, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0) return undefined
  return { left: rect.left, top: rect.top, right, bottom, width: rect.width, height: rect.height }
}

function viewportFor(root: HTMLElement, supplied?: RuneViewport): RuneViewport {
  if (supplied && finite(supplied.width) && finite(supplied.height)) return supplied
  const view = root.ownerDocument.defaultView
  return { width: Math.max(1, view?.innerWidth ?? 1), height: Math.max(1, view?.innerHeight ?? 1) }
}

function attributeRole(element: HTMLElement): RuneSurfaceRole | undefined {
  const value = element.getAttribute('data-rune-surface-role')
  return value && roleValues.has(value as RuneSurfaceRole) ? value as RuneSurfaceRole : undefined
}

function classify(element: HTMLElement): RuneSurfaceRole | undefined {
  const explicit = attributeRole(element)
  if (explicit) return explicit
  const tag = element.tagName.toLowerCase()
  const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : ''
  if (type === 'checkbox' || type === 'radio' || element.getAttribute('role') === 'switch' || element.getAttribute('role') === 'checkbox') return 'toggle'
  if (tag === 'button' || element.getAttribute('role') === 'button') return 'button'
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || element.getAttribute('contenteditable') === 'true') return 'input'
  if (element.hasAttribute('data-iexp-chart') || element.hasAttribute('data-chart')) return 'chart'
  if (element.hasAttribute('data-iexp-block-id')) return 'card'
  if (tag === 'article' || tag === 'section' || tag === 'figure' || tag === 'details') return 'reading'
  return undefined
}

function isCodeOrMath(element: HTMLElement): boolean {
  return element.matches('pre,code,kbd,samp,math,[data-iexp-code],[data-iexp-math]')
}

function foreignComponent(element: HTMLElement, root: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current !== root && current.hasAttribute('data-rune-region')) return true
    if (current.hasAttribute('data-rune-frame') || current.tagName === 'IFRAME') return true
    if (current.hasAttribute('data-iexp-uiverse-source') || current.hasAttribute('data-uiverse-runtime-component') || current.hasAttribute('data-uiverse-runtime-host')) return true
    if (foreignComponentRootAttributes.some(attribute => current.hasAttribute(attribute))) return true
    const component = current.getAttribute('data-iexp-executable-component')
    if (component && executableForeignPrefixes.some(prefix => component.startsWith(prefix))) return true
    const theme = current.getAttribute('data-iexp-block-theme')
    if (theme !== null && theme !== 'rune') return true
    if (current === root) return false
  }
  return true
}

function sourceRoot(root: HTMLElement): HTMLElement {
  return [...root.children].find((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-rune-source')) ?? root
}

function materialFor(element: HTMLElement, role: RuneSurfaceRole, metalCount: { value: number }): RuneSurfaceMaterial {
  const explicit = element.getAttribute('data-rune-material')
  if (explicit && materialValues.has(explicit as RuneSurfaceMaterial)) return explicit as RuneSurfaceMaterial
  if ((role === 'button' || role === 'toggle') && metalCount.value < 2) {
    metalCount.value += 1
    return 'liquid-metal'
  }
  return 'native'
}

function disabled(element: HTMLElement): boolean {
  return element.matches(':disabled,[aria-disabled="true"]')
}

/**
 * Extracts only visible shell geometry. Source text, markup, values, equations,
 * code and event handlers remain in the DOM and are never sent to Rust.
 */
export function collectRuneRegionGeometry(
  root: HTMLElement,
  ids: RuneSurfaceIds,
  stateFor: (element: HTMLElement) => RuneSurfaceState,
  options: Readonly<{ viewport?: RuneViewport, reducedMotion?: boolean }> = {},
): RuneRegionGeometry | undefined {
  const viewport = viewportFor(root, options.viewport)
  const rootRect = rectOf(root)
  if (!rootRect || foreignComponent(root, root)) return undefined
  const visibleTop = Math.max(0, rootRect.top)
  const visibleBottom = Math.min(viewport.height, rootRect.bottom)
  const visibleHeight = Math.min(RUNE_MAX_VISIBLE_HEIGHT, visibleBottom - visibleTop)
  const frameWidth = Math.min(RUNE_MAX_VISIBLE_WIDTH, rootRect.width)
  if (!(visibleHeight > 0 && frameWidth > 0)) return undefined
  const source = sourceRoot(root)
  const candidates: HTMLElement[] = []
  const add = (element: HTMLElement) => {
    if (!candidates.includes(element)) candidates.push(element)
  }
  if (!foreignComponent(source, root) && !isCodeOrMath(source)) add(source)
  for (const element of source.querySelectorAll<HTMLElement>('[data-rune-surface-role],[data-rune-material],[data-iexp-block-id],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="switch"],[role="checkbox"],[data-iexp-chart],[data-chart],article,section,figure,details')) add(element)

  const metalCount = { value: 0 }
  const surfaces: RuneGeometrySurface[] = []
  for (const element of candidates) {
    if (surfaces.length >= RUNE_MAX_SURFACES || isCodeOrMath(element) || foreignComponent(element, root)) continue
    const role = element === source ? 'reading' : classify(element)
    if (!role) continue
    const rect = rectOf(element)
    if (!rect || rect.bottom <= visibleTop || rect.top >= visibleTop + visibleHeight || rect.right <= rootRect.left || rect.left >= rootRect.left + frameWidth) continue
    const left = clamp(rect.left - rootRect.left, 0, frameWidth)
    const right = clamp(rect.right - rootRect.left, 0, frameWidth)
    const top = clamp(rect.top - visibleTop, 0, visibleHeight)
    const bottom = clamp(rect.bottom - visibleTop, 0, visibleHeight)
    if (right <= left || bottom <= top) continue
    const surface = Object.freeze({
      id: ids.for(element), role, x: left, y: top, width: right - left, height: bottom - top,
      state: disabled(element) ? 'disabled' : stateFor(element), material: materialFor(element, role, metalCount),
    } satisfies RuneSurface)
    surfaces.push(Object.freeze({ element, surface }))
  }
  const payload = parseRuneMaterialPayload({
    version: 1, width: frameWidth, height: visibleHeight,
    reducedMotion: options.reducedMotion ?? root.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    surfaces: surfaces.map(item => item.surface),
  })
  return Object.freeze({ payload, visibleYOffset: visibleTop - rootRect.top, frameWidth, frameHeight: visibleHeight, surfaces: Object.freeze(surfaces) })
}
