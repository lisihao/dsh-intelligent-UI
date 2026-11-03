# Classic and GPU ASCII modes

The owner clarified that the Canvas UI reference depicts graphics built from characters by GPU shaders, not a green/monospace theme. They also want to retain the earlier classic style and reduce Soft Relief's pale glare. This is a bounded refinement of the existing independent plugin, not an application rebuild or another-plugin change.

- **Thesis:** make actual character geometry visible while keeping the familiar classic mode and readable original evidence.
- **Own world:** existing terminal typography and source-first presentation; the new GPU mode has its own charcoal ground and existing muted series colors. No new navigation or model workflow.
- **Story:** choose classic or GPU in the existing header; see the same content through that renderer; inspect unchanged original values and sources.
- **First viewport:** native compact theme controls and actual content graphics. Synthetic showcase data is explicitly labeled.
- **Form:** existing character bars for classic; pinned, unmodified Canvas UI Asciify and ASCII Object factories for the explicit GPU mode. Public effect options, native labels/controls and bounded source captures remain the integration boundary.

## Modes and compatibility

The existing `ascii` identity becomes `经典 ASCII`; supported automatic bar comparisons use the preserved character renderer and its exact-value/source disclosure. New `ascii-gpu` explicitly declares the optional V3 `asciiRenderer: gpu` value. Missing renderer means classic, so legacy theme packages do not unexpectedly activate GPU graphics. Both are data-only themes selected by the existing header/settings UI. Unsupported theme fields remain errors; no arbitrary CSS or code is admitted.

GPU ASCII uses Asciify for supported visible SVG geometry, images and opted-in owned Canvas frames. Its earlier 2.5px whole glyph was too small to read as a character; public options `scale:1.25, spacing:1` produce 6.25px glyphs in 8.75px cells. Native text remains native and tiny functional SVG icons remain original. Source graph fine lines retain the previously documented readable underlay. This is an approximate visual conversion, not an assertion that every page pixel is an ASCII glyph.

Explicit eligible GLB assets use the upstream ASCII Object shader, whose printable-character shape matching differs from Asciify's density ramp. GPU-mode GLB framing uses `fov:45, scale:3.2` to make its character form visible without changing asset bytes; images keep their original framing. Native controls have a reserved 40px row and do not overlap the render. Original model records use a normal disclosure and unified raw mode retains the full source.

Automatic OpenUI bars had been falling back because their category labels use HTML inside SVG foreignObject. A strictly bounded plaintext div/span exception omits that entire subtree from the serialized SVG copy and keeps the original native label plus clear masks. Interactive tags, events, resources, foreign namespaces and unsafe reference paths still fail visibly. No HTML is serialized or executed by this exception.

## Soft relief

Use dim graphite `#34383d` instead of `#e8e8e8`; derive raised/inset highlights from the actual background with low white contribution. Preserve the material, native controls and their states. Saved user appearance values remain untouched; reselecting the updated theme applies the new defaults. Do not change another plugin's source or business behavior.

## Evidence boundary

Inspect real desktop/narrow output and actual GPU motion, select both rendering modes through normal controls, retain original data across changes, and test error/reduced-motion/disposal paths. A generated local GLB, existing SVG network and Markdown numeric table are labeled synthetic test material, not a real model run. Keep all captures/recordings private. Official Desktop/CSP acceptance belongs to the centralized installer and remains separate from browser and scratch-package tests.

## Terminal typography refinement

Both ASCII modes use the same native terminal text role: local Menlo/SFMono, then Consolas/Liberation Mono, existing bundled Recursive and available CJK fallbacks. No font download or new font redistribution is introduced. Body, headings, source, chart SVG/HTML labels, plugin-owned header controls and popovers inherit that role while other themes keep their existing typography. Ligatures and kerning are disabled, figures are tabular with a slashed-zero preference, and code tabs use four spaces. Headings use a compact fixed 22/20/18/16px scale (20/18/16px at the narrow breakpoint) with regular body and 600 emphasis. No fake prompt prefixes, source rewriting, blur or blinking are added.

CJK fallback remains platform-dependent. The local browser resolved Latin to Menlo Regular and Chinese to Heiti SC Light; representative Chinese glyphs share width but are not claimed to be exactly two Latin cells. Native DSH font/CSP acceptance remains separate. ASCII styles are removed on selecting another theme or disposing the plugin.
