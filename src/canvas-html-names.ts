/** WebGL factories exercised with the private single-source visual bridge. */
export const CANVAS_HTML_EFFECT_NAMES = ['shatter', 'ripple', 'frost', 'grid', 'displacement', 'glitch'] as const
export type CanvasHtmlEffectName = typeof CANVAS_HTML_EFFECT_NAMES[number]
export function isCanvasHtmlEffectName(value: string): value is CanvasHtmlEffectName {
  return (CANVAS_HTML_EFFECT_NAMES as readonly string[]).includes(value)
}
