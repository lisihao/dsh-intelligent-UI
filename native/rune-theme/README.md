# Rune material layer

This is a plugin-owned Rust/WASM adapter around the unmodified Rune and
`rune-fx` crates. It paints bounded material rectangles only. DSH's actual DOM
continues to own text, Markdown, math, code blocks, semantics, focus and
actions; the adapter never receives that source.

## Contract

`mount(canvasId, payload)` and `update(payload)` accept JSON with exactly this
shape:

```json
{
  "version": 1,
  "width": 390,
  "height": 720,
  "reducedMotion": false,
  "surfaces": [{
    "id": "answer-card",
    "role": "card",
    "x": 16,
    "y": 80,
    "width": 358,
    "height": 160,
    "state": "hover",
    "material": "liquid-metal"
  }]
}
```

Only the roles `reading`, `card`, `button`, `input`, `toggle`, and `chart`; the
states `idle`, `hover`, `focus`, `pressed`, and `disabled`; and materials
`native`, `liquid-metal`, and `fluted-glass` are accepted syntactically. A
payload allows at most 64 finite, positive rectangles with unique ids.

`liquid-metal` is a real `rune_fx::Fx::fill(LiquidMetalParams)` draw. Native
surfaces use Rune core elements, `Spring`, rounded corners and shadows. Reduce
Motion is forwarded to Rune and to the effect layers.

`fluted-glass` is a real `rune_fx::Fx::fill(FlutedGlassParams)` layer. Its
Rune element requests `effect_backdrop(true)` and the adapter compositor uses
Rune's public `draw_with_backdrop` / `EffectSite::backdrop` hook with
`FxRenderer::blur_backdrop` and `draw_layer_in`. It samples only the part of
the opaque Rune-owned canvas painted before that slot. It never samples host
DOM above the canvas and has no JavaScript or CSS visual approximation.

The adapter gives Rune a Rust-owned, opaque intermediate target with
`RENDER_ATTACHMENT | COPY_SRC | TEXTURE_BINDING`. Rune performs its real
backdrop copy there, then official `wgpu::util::TextureBlitter` presents the
completed Rust pixels into the browser canvas. This avoids requiring
`COPY_SRC` from the browser surface itself. The blitter is presentation
transport only: it does not implement, approximate, or sample a glass effect.

`runtime_capability_error()` remains a named failure boundary if the pinned
public Rune renderer cannot provide a backdrop for that owned target. Thus
`fluted_glass_supported()` means the built Rust renderer implements the path;
actual browser/GPU verification is still required before the theme is exposed
as an executable choice.

## Transparency boundary

At this pinned Rune revision the public Web `App` builder exposes `canvas_id`,
but no alpha-mode selection. The web runtime calls
`surface.get_default_config(...)` and does not expose a transparent composition
configuration. Therefore `transparent_overlay_supported()` returns `false`.
The supported presentation is instead `opaque_owned_region_supported() == true`:
an entire plugin-owned content region uses Rune's original showreel background
canvas below the DSH DOM. The DOM remains above it for text, math, source,
controls and accessibility; Host regions outside that content surface are not
covered. This is not an over-DOM transparent canvas claim.

## Build

Use `scripts/build-wasm.sh`. It requires the project-local Rust 1.99.1 target
and the exact `wasm-bindgen-cli` version named in `Cargo.lock`. Build outputs go
to a supplied `dist` path and are intentionally ignored; normal DSH users must
receive the built artifacts and do not need Cargo or Rustup.

If the matching `wasm-bindgen` executable is intentionally outside `PATH`, set
the process-local `RUNE_THEME_WASM_BINDGEN` to its executable path. The helper
still verifies its exact version; it does not install or substitute a CLI.

The adapter enables wgpu's official
`fragile-send-sync-non-atomic-wasm` feature. It is needed because this Rune
revision's `rune-fx` lazy pipeline helper retains a `Sync` bound even in its
single-threaded wasm branch. wgpu only provides that marker when wasm atomics
are *not* enabled; threaded/atomic wasm is therefore outside this adapter's
supported build profile. This is a dependency feature, not a copied or modified
Rune source patch.

The build emits one fixed local frame (`frame.html` / `frame.mjs`), generated
WASM/loader/snippets, `manifest.json` hashes, Rune's MIT license, a consolidated
`THIRD_PARTY_LICENSES.txt` for the locked wasm32 dependency closure, and
`font-embedding-provenance.json`. The latter compares the final Wasm against
the pinned Rune TTF bytes; this adapter's `rune` dependency disables the
optional web `embedded-fonts` feature, while host DOM text remains native.
`provenance.json` additionally records SHA-256 values for the public,
source-root-relative adapter inputs that determine the binary and fixed frame,
plus a deterministic digest of those records. `scripts/write-provenance.py`
can refresh only this metadata, `manifest.json`, and `SHA256SUMS` for an
already-built distribution; it does not build or alter the Wasm binary.

## Lifecycle

`dispose()` calls Rune's real `AppHandle::quit()`, which unmounts the Web app,
stops its event loop, destroys the GPU device, removes listeners and restores a
borrowed canvas's styling. A second mount queues through Rune's one-canvas page
lifecycle rather than creating a concurrent canvas.
