import { z } from 'zod'

/** Closed data-only IDs. A model-supplied value never contains executable code. */
export const visualEffectSchema = z.enum(['iexp.headline-reveal', 'canvasui.decrypt-reveal'])
export type VisualEffectId = z.infer<typeof visualEffectSchema>
