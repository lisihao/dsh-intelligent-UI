import type { ComponentType } from 'react'
import type { DocumentViewProps } from './document-view.js'
import type { OpenUiWidgets } from './presentation.js'
import type { CanvasEffectFactory } from './canvas-runtime-client.js'
import type { CanvasHtmlTextureBridge, CanvasHtmlTextureOptions } from './canvas-html-texture.js'

/** Client service types only. Obtain the live service from the DSH context. */
export type IntelligentUiClient = OpenUiWidgets & {
  readonly DocumentView: ComponentType<DocumentViewProps>
  /** Loads an upstream factory on demand; the consumer owns and destroys each instance. */
  readonly loadCanvasEffect: (slug: string) => Promise<CanvasEffectFactory>
  /** Visual-only fallback; the original HTML must remain visible and interactive. */
  readonly createCanvasHtmlTextureBridge: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
}
export type { DocumentViewProps } from './document-view.js'
export type { CanvasEffectFactory, CanvasEffectInstance } from './canvas-runtime-client.js'
export type { CanvasHtmlTextureBridge, CanvasHtmlTextureOptions, CanvasHtmlTextureErrorCode } from './canvas-html-texture.js'

declare module '@deepseek-ai/cordis' {
  interface Context { solarExperienceUi: IntelligentUiClient }
}
