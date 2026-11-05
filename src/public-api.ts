import type {CompositionCatalog} from './adaptive-ui/catalog.js'
import type { ComponentType } from 'react'
import type { DocumentViewProps } from './document-view.js'
import type { OpenUiWidgets } from './presentation.js'
import type { CanvasEffectFactory } from './canvas-runtime-client.js'
import type { CanvasHtmlTextureBridge, CanvasHtmlTextureOptions } from './canvas-html-texture.js'
import type { CanvasParticleScrollClientOptions } from './canvas-client-scope.js'
import type { CanvasParticleScrollBridge } from './canvas-scroll-texture.js'
import type { CanvasIsolatedEffect, CanvasIsolatedOptions } from './canvas-isolated-client.js'
import type { CanvasHtmlEffectAdapter } from './canvas-html-effect-adapter.js'
import type { CanvasHtmlEffectClientOptions } from './canvas-client-scope.js'

/** Client service types only. Obtain the live service from the DSH context. */
export type IntelligentUiClient = OpenUiWidgets & {
  /** Complete runtime/development catalog; unavailable entries remain explicitly classified. */
  readonly getCompositionCatalog:()=>CompositionCatalog
  readonly DocumentView: ComponentType<DocumentViewProps>
  /** Loads an upstream factory on demand; the consumer owns and destroys each instance. */
  readonly loadCanvasEffect: (slug: string) => Promise<CanvasEffectFactory>
  /** Visual-only fallback; the original HTML must remain visible and interactive. */
  readonly createCanvasHtmlTextureBridge: (options: CanvasHtmlTextureOptions) => CanvasHtmlTextureBridge
  /** Particle Scroll visual fallback; the real scrollable content remains visible. */
  readonly createCanvasParticleScrollBridge: (options: CanvasParticleScrollClientOptions) => Promise<CanvasParticleScrollBridge>
  /** Isolated visual-only Bend/Hex fallback; browser CSP compatibility is runtime-dependent. */
  readonly createCanvasIsolatedEffect: (options: CanvasIsolatedOptions) => Promise<CanvasIsolatedEffect>
  /** Experimental visual-only single-source effects; source stays separately visible. */
  readonly createCanvasHtmlEffect: (options: CanvasHtmlEffectClientOptions) => Promise<CanvasHtmlEffectAdapter>
}
export type { DocumentViewProps } from './document-view.js'
export type { CanvasEffectFactory, CanvasEffectInstance } from './canvas-runtime-client.js'
export type { CanvasHtmlTextureBridge, CanvasHtmlTextureOptions, CanvasHtmlTextureErrorCode } from './canvas-html-texture.js'
export type { CanvasParticleScrollClientOptions } from './canvas-client-scope.js'
export type { CanvasParticleScrollBridge } from './canvas-scroll-texture.js'
export type { CanvasIsolatedOptions, CanvasIsolatedEffect } from './canvas-isolated-client.js'
export type { CanvasHtmlEffectClientOptions } from './canvas-client-scope.js'
export type { CanvasHtmlEffectAdapter, CanvasHtmlEffectName } from './canvas-html-effect-adapter.js'

declare module '@deepseek-ai/cordis' {
  interface Context { solarExperienceUi: IntelligentUiClient }
}
