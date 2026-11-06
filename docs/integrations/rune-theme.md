# Rune theme integration

## Owner requirement and source identity

The owner requested Rune's visual behavior as an intelligent UI theme and explicitly rejected a JavaScript or other-language rewrite of its Rust renderer. The selected source is https://github.com/anomalyco/rune at `4ca683561a100e16b1ce32f3576f4ade61bd2924` (dev), MIT. Source and license were read from an isolated checkout before any third-party build scripts ran. No official DSH application code is changed.

## Selected boundary

Use Rune's unmodified Rust crates behind a plugin-owned adapter, pinned by Git revision. Build the Rust web target to WebAssembly and mount its WebGPU canvas through the official plugin's existing browser contribution seam. JavaScript may load the Wasm and transport bounded source data and explicit user events; it must not reproduce Rune shaders, layout, springs, text or widget painting in JavaScript/CSS. A color-token-only imitation or a screenshot is not the requested theme.

Rune's core, rune-fx and rune-light are distinct capabilities. The core supplies text/layout/material primitives and springs; named metal/glass/light effects require their actual Rust crates and a tested consumer. Do not claim every effect merely because the framework was built. Rune currently permits one app/canvas per page; any multiple-instance integration needs an isolation/lifecycle design and proof. Use an owned frame when needed, leaving original content reachable and never modifying global host styles.

## Build and distribution

Rune's official web documentation requires wasm32-unknown-unknown and wasm-bindgen-cli 0.2.129 at this pin. These are development build inputs, not installer scripts run by the DSH package manager. The built plugin must contain the identified Wasm, its generated loader/snippets and all required license/font notices, with hashes and version provenance. Normal user installation must not require Cargo, rustup or a download from the framework repository. No separately rebuilt Desktop app, native window, release or current-profile installation is authorized by this source task.

The first bounded probe builds the unmodified official web example with a locked dependency graph, serves it locally and verifies real Rust/Wasm rendering. That proves the carrier, not the theme. The subsequent adapter must bind real intelligent UI content and actions, preserve original values and source, and fit default/narrow views. Unsupported devices receive a visible capability explanation and original content; a JavaScript imitation must not be silently substituted.

## Jev and acceptance

Register the theme as executable only after its built consumer runs. Its candidate metadata must describe actual Rust capabilities, browser requirements, supported content and material/interaction costs without a current-theme preference. Jev must be able to select it when those conditions are met; unbuilt or unsupported effects remain explicit gaps, not successful choices.

Acceptance requires source-pin/license integrity, a real Rust build, actual browser/Wasm/GPU presentation and interaction, source fidelity, disable/unmount cleanup and nested bounds at default/narrow widths. Installed official Desktop behavior and released distribution remain separate evidence lanes. `UPGRADING.md` must name the Git pin, adapter API use, build toolchain, artifacts, notices and upgrade checks before delivery.

## Implemented material path and observed boundary — 2026-11-06

The adapter now uses the pinned Rune/rune-fx Rust implementation for native surfaces, LiquidMetal and FlutedGlass. Source text, math, code and controls remain semantic DOM above the owned canvas. The first production opaque-frame run exposed a missing backdrop copy on the browser surface and failed with a named diagnostic while retaining source. The corrected Rust adapter paints Rune into its own `RENDER_ATTACHMENT | COPY_SRC | TEXTURE_BINDING` texture and presents it with the official `wgpu::util::TextureBlitter`. It does not rewrite the visual effect in JavaScript, CSS or a custom replacement shader.

The resulting production broker/CSP/opaque-frame path mounted real glass and metal at 1440/390. The observed 390px page had matching viewport/client/scroll widths. An actual DOM button updated local state; reduced-motion remount succeeded. Disposal removed the frame and material markers while retaining source. Code and foreign Uiverse material were excluded from repainting. These are isolated production-component browser checks, not installed DSH acceptance or a claim to reproduce every Rune scene/widget.

The glass backdrop contains only Rune's earlier self-painted content. Exporting the theme JSON carries its data tokens, not its Rust/Wasm engine; the engine ships in this plugin's fixed component assets. The role radii and native semantic chart palette are explicit adapter mappings rather than canonical Rune-wide design tokens.

The final focused narrow-width check also confirmed that metal-button labels remain readable over the silver highlights using semantic DOM text stroke/shadow, without changing the Rust shader. Rune geometry excludes Uiverse, TuffUI, Canvas and external DIL component roots and descendants; it does not repaint a foreign component material.
