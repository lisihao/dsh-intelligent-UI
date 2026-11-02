import type { ComponentType } from 'react'
import type { DocumentViewProps } from './document-view.js'
import type { OpenUiWidgets } from './presentation.js'
import type { CanvasEffectFactory } from './canvas-runtime-client.js'

/** Client service types only. Obtain the live service from the DSH context. */
export type IntelligentUiClient = OpenUiWidgets & {
  readonly DocumentView: ComponentType<DocumentViewProps>
  /** Loads an upstream factory on demand; the consumer owns and destroys each instance. */
  readonly loadCanvasEffect: (slug: string) => Promise<CanvasEffectFactory>
}
export type { DocumentViewProps } from './document-view.js'
export type { CanvasEffectFactory, CanvasEffectInstance } from './canvas-runtime-client.js'

declare module '@deepseek-ai/cordis' {
  interface Context { solarExperienceUi: IntelligentUiClient }
}
