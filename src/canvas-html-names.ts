/** WebGL factories exercised with the private single-source visual bridge. */
export const CANVAS_HTML_EFFECT_NAMES = ['shatter', 'ripple', 'frost', 'grid', 'displacement', 'glitch', 'blaze', 'particle-reveal', 'canvas', 'vhs', 'decrypt-reveal', 'magnify', 'clouds', 'asciify'] as const
export type CanvasHtmlEffectName = typeof CANVAS_HTML_EFFECT_NAMES[number]
export function isCanvasHtmlEffectName(value: string): value is CanvasHtmlEffectName {
  return (CANVAS_HTML_EFFECT_NAMES as readonly string[]).includes(value)
}
