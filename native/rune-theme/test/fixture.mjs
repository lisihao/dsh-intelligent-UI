// Test-only host glue. It passes geometry/state to Rust and never draws a visual approximation.
import init, * as runeTheme from './rune_theme.js'

const canvas = document.querySelector('#rune-theme-canvas')
const initialCanvasStyle = canvas.getAttribute('style')
const canvasPresentation = () => {
  const style = getComputedStyle(canvas)
  return {
    display: style.display,
    position: style.position,
    width: style.width,
    height: style.height,
    touchAction: style.touchAction,
  }
}
const initialCanvasPresentation = canvasPresentation()
const initial = {
  version: 1,
  width: 390,
  height: 640,
  reducedMotion: false,
  surfaces: [
    { id: 'reading', role: 'reading', x: 20, y: 20, width: 350, height: 190, state: 'idle', material: 'native' },
    // This native surface is painted first. The real rune-fx glass layer
    // below copies it from the opaque Rune-owned target, never from host DOM.
    { id: 'glass-backdrop', role: 'card', x: 20, y: 230, width: 350, height: 210, state: 'hover', material: 'native' },
    { id: 'glass', role: 'card', x: 20, y: 230, width: 350, height: 210, state: 'idle', material: 'fluted-glass' },
    { id: 'metal', role: 'button', x: 44, y: 160, width: 138, height: 42, state: 'idle', material: 'liquid-metal' },
    { id: 'toggle', role: 'toggle', x: 310, y: 52, width: 36, height: 22, state: 'hover', material: 'native' },
  ],
}

await init()
runeTheme.mount('rune-theme-canvas', initial)

let updated = false
let domClicks = 0
document.querySelector('#dom-button').addEventListener('click', () => { domClicks += 1 })
document.querySelector('#update').addEventListener('click', () => {
  updated = !updated
  runeTheme.update({
    ...initial,
    reducedMotion: updated,
    surfaces: initial.surfaces.map(surface => surface.id === 'metal'
      ? { ...surface, x: updated ? 54 : 44, width: updated ? 118 : 138, state: updated ? 'pressed' : 'hover' }
      : surface),
  })
})
document.querySelector('#glass').addEventListener('click', () => {
  updated = !updated
  runeTheme.update({
    ...initial,
    surfaces: initial.surfaces.map(surface => surface.id === 'glass'
      ? { ...surface, state: updated ? 'focus' : 'hover' }
      : surface),
  })
})
document.querySelector('#narrow').addEventListener('click', () => {
  document.querySelector('#stage').style.width = '320px'
  runeTheme.update({
    ...initial,
    width: 320,
    surfaces: initial.surfaces.map(surface => ({
      ...surface,
      x: Math.min(surface.x, 16),
      width: Math.min(surface.width, 288),
    })),
  })
})
document.querySelector('#dispose').addEventListener('click', () => runeTheme.dispose())

// A browser runner can poll this object without accessing Rust internals.
window.__runeThemeProof = {
  contractVersion: runeTheme.contract_version(),
  transparencyStatus: runeTheme.transparency_status(),
  transparentOverlaySupported: runeTheme.transparent_overlay_supported(),
  opaqueOwnedRegionSupported: runeTheme.opaque_owned_region_supported(),
  flutedGlassSupported: runeTheme.fluted_glass_supported(),
  runtimeCapabilityError: () => runeTheme.runtime_capability_error(),
  mounted: () => runeTheme.mounted(),
  update: () => document.querySelector('#update').click(),
  glass: () => document.querySelector('#glass').click(),
  narrow: () => document.querySelector('#narrow').click(),
  hostAction: () => document.querySelector('#dom-button').click(),
  hostActionClicks: () => domClicks,
  initialCanvasStyle,
  canvasStyle: () => canvas.getAttribute('style'),
  initialCanvasPresentation,
  canvasPresentation,
  remount: () => runeTheme.mount('rune-theme-canvas', initial),
  dispose: () => document.querySelector('#dispose').click(),
}
