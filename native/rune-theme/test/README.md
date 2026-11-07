# Browser fixture

After `scripts/build-wasm.sh /private/tmp/rune-theme-proof`, copy `fixture.html`
and `fixture.mjs` beside `rune_theme.js` and `rune_theme_bg.wasm`, then serve the
directory from localhost or HTTPS. The fixture deliberately contains original
DOM text above an owned Rune canvas.

The browser acceptance must verify all of the following before the root plugin
registers the theme as executable:

1. `navigator.gpu` is available, `mounted()` becomes true, and
   `opaqueOwnedRegionSupported` is true.
2. The Rune canvas is populated by the Rust/WASM module at 390px; a surface
   update changes the actual metal frame; `glass()` changes a real rune-fx
   FlutedGlass frame; Reduced Motion update succeeds; `narrow()` lays out and
   renders at 320px.
3. The DOM heading and host-owned button are above the opaque Rune canvas;
   invoking `hostAction()` increments `hostActionClicks()`. This proves the
   material canvas does not replace source text or host action ownership.
4. `flutedGlassSupported` is true and `runtimeCapabilityError()` stays empty
   after mounting and invoking `glass()`. The glass samples only the earlier
   Rune-owned native surface in the same opaque canvas; it does not sample or
   claim to refract host DOM above the canvas.
5. `dispose()` removes the Rune event loop and restores the borrowed canvas
   style; a subsequent mount is possible.
6. `transparentOverlaySupported` is false and `transparencyStatus` is
   `TRANSPARENT_COMPOSITING_UNSUPPORTED`. The fixture is the supported opaque
   owned-region mode, with original source DOM above it; it cannot prove
   transparent DOM-underlay composition.

The fixture must run serially with other browser/GPU tests because Rune's web
runtime permits one app/canvas per page.
