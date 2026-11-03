# ASCII presentation

User-approved scope, 2026-11-02: a selectable flagship style alongside Empryo, with direct theme selection in the conversation header. No changes to the official app or another plugin's code.

## Direction

- **Thesis:** project supported visual geometry into a GPU-rendered ASCII surface while the original text and exact source data remain accessible.
- **Own world:** graphite ground, pale green emphasis, bundled Recursive's true monospace axis and restrained rounded frames. The Canvas UI Asciify factory supplies the visual character rendering; this style does not replace Empryo.
- **Story:** read the answer, explore an ASCII visualization, inspect the original image or data, and continue reading. Theme selection stays next to display and transparency controls.
- **First viewport:** existing conversation content and controls, with a new compact theme selector. No new landing page, sidebar or decorative metrics.
- **Form:** the actual upstream Asciify WebGL effect draws one shared viewport atlas of supported chart, icon, image and owned-graph graphics. Its character projection is a visual approximation: native text, chart labels, units and interactions remain the authoritative reading layer. Existing chart renderers and their time and gap handling remain responsible for the underlying data.

## Graphics boundary

The theme discovers visible SVG, image and explicitly published Canvas graphics under the plugin's output roots and the bounded compatible conversation and ThoughtDAG page roots. It captures supported SVG geometry without its text, composes the visual copies into a viewport atlas, and asks the fixed upstream Asciify factory to render the atlas. A Canvas source must explicitly publish its current frame; an opaque canvas owned by another renderer is not automatically readable. Eligible explicit GLB models and validated PNG/JPEG illustrations use the separate Canvas UI ASCII Object effect. Their labeled illustration originals remain outside the atlas.

Native SVG text, labels and DOM hit targets remain in place. The adapter temporarily marks the source's paint-only shapes, image or published Canvas while the matching GPU frame is visible; it restores them on invalidation, inspection, failure or teardown. Hover or focus can reveal the original graphic. Raw output, source values and disclosures remain available and are not computed from ASCII pixels.

The atlas is a bounded visual copy with an opaque theme ground, not a reproduction of every native material, transparency, font or image detail. Unsupported or unreadable graphics stay original. There is no general access to iframe contents, closed shadow roots, arbitrary foreign canvases or opaque WebGL buffers. The theme does not currently implement or claim the Canvas UI ASCII Sweep effect.

## Acceptance boundary

1. Built-in ASCII can be selected from settings and the header; downloadable JSON uses a versioned, validated, data-only schema. Empryo remains the default.
2. Supported charts and other graphics use the actual Asciify factory through the shared atlas; original values, units, qualifiers and data disclosures remain accessible. Unsupported graphics retain their original rendering.
3. Conversation, tables, graph nodes, controls and compatible existing pages inherit consistent theme tokens. Only plugin-owned CSS/adapters change; disabling/unloading restores the existing cascade and temporary visual markers.
4. Eligible explicit GLB models and validated PNG/JPEG illustrations use the ASCII Object adapter under this theme. Body text and chart labels remain native; the original illustration figure and source link remain available beside its effect.
5. Theme switching preserves source strings and disclosure state. Transparency controls and revision-checked save/error behavior remain available.
6. Verify rendered output at 1280px and 320px, actual switching, interaction, error/disabled states and source preservation. Browser proof is distinct from centralized official Desktop installation acceptance; the new atlas has not yet completed that native acceptance.

## Native header refinement

Candidate g's formal native check exposed overlapping host controls at the narrower desktop window sizes; the standalone preview's expandable header did not represent this constraint. The repaired header keeps display and theme selects on one row. Below 1100px of the nearest existing inline-size container, research and transparency move into the same mounted panel behind **更多显示选项**. Wide layouts keep them inline. The adapter observes geometry; it does not change the host container or another plugin's CSS.

The native auto popover closes with Escape/outside input. Its existing manual transparency slider closes with it; resizing restores focus to a visible control and cancels only unsaved preview. Each control remains mounted once across layouts. A theme save error floats outside the row and can be dismissed, so error text cannot expand the toolbar. The current style remains visible and directly selectable in compact mode.

Screenshots and private reports stay outside Git. The existing native check above applies to the unchanged header, not to acceptance of the new atlas. The implementation does not claim general Asciify HTML coverage or universal graphics coverage.
