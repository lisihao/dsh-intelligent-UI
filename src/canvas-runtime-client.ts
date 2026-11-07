import { CANVAS_UI_COMMIT, canvasFactoryContract, canvasFactoryName, findCanvasComponent } from './canvas-catalog.js'
import { createSlotPool } from './slot-pool.js'

export interface CanvasEffectInstance { destroy(): void; resize?(): void; setOptions?(options: Record<string, unknown>): void }
export type CanvasEffectFactory = (elements: Record<string, unknown>, options?: Record<string, unknown>) => CanvasEffectInstance | null
type EffectImporter = (url: string) => Promise<Record<string, unknown>>

/** Only locally authenticated routes for the fixed upstream catalog can become code. */
export function canvasEffectUrl(slug: string, attempt: number): string {
  if (!findCanvasComponent(slug) || !Number.isSafeInteger(attempt) || attempt < 0) throw new Error('CANVAS_EFFECT_INVALID: Unknown effect or attempt.')
  const query = new URLSearchParams({ slug, revision: CANVAS_UI_COMMIT, attempt: String(attempt) })
  return `/api/intelligent-ui-canvas-effect?${query}`
}

export function createCanvasEffectLoader(importer: EffectImporter = url => import(/* @vite-ignore */ url)): (slug: string) => Promise<CanvasEffectFactory> {
  const loaded = new Map<string, Promise<CanvasEffectFactory>>()
  const attempts = new Map<string, number>()
  return slug => {
    if (!findCanvasComponent(slug)) return Promise.reject(new Error('CANVAS_EFFECT_INVALID: Unknown effect.'))
    const prior = loaded.get(slug)
    if (prior) return prior
    const attempt = attempts.get(slug) ?? 0
    attempts.set(slug, attempt + 1)
    const pending = importer(canvasEffectUrl(slug, attempt)).then(module => {
      const factory = module[canvasFactoryName(slug)!]
      if (typeof factory !== 'function') throw new Error('CANVAS_EFFECT_EXPORT_MISSING: The upstream effect did not provide its expected factory.')
      if (canvasFactoryContract(slug)?.execution === 'isolated-document-required') {
        // These upstream factories can permanently rewrite the executing document's
        // hover rules. Passing an iframe-owned canvas alone does not change their
        // JavaScript realm, so refuse until an actual isolated runner is available.
        return () => { throw new Error('CANVAS_EFFECT_ISOLATION_REQUIRED: 此效果需要独立页面，暂不能在共享页面中运行。') }
      }
      return factory as CanvasEffectFactory
    }).catch(error => { if (loaded.get(slug) === pending) loaded.delete(slug); throw error })
    loaded.set(slug, pending)
    return pending
  }
}
export const loadCanvasEffect = createCanvasEffectLoader()

/** Small shared GPU budget; queued surfaces start after a visible effect releases its slot. */
export const createCanvasSlotPool = createSlotPool
export const acquireCanvasSlot = createCanvasSlotPool(2)
