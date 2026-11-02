# Canvas UI component progress

This is an implementation and evidence ledger for the 35 components at Canvas UI commit `a04a99b235299ee79a123a16ccb2e6cf9da74b6b`, not a claim of complete support. Original data and the independent-plugin boundary are mandatory. The upstream MIT + Commons Clause license remains in force.

An earlier official Desktop candidate rendered source-declared GLB with Ink, ASCII and Glass; the newer GLB validation, image paths and HTML bridge still need Desktop verification. The HTML experiment below ran in isolated Chrome 156 using SwiftShader and an exploratory snapshot shim. It does not prove hardware acceleration, DSH Chromium 152, complex layout, text/data fidelity or interaction parity. Only Shatter and Asciify have also been exercised with the newer restricted bridge, on simple visual-only content; no HTML effect is automatically applied to ordinary report data or code.

| Component | Current evidence or remaining condition |
|---|---|
| ASCII Object | GLB automatic path passed earlier Desktop check; tested raster illustrations lacked sufficient structural fidelity, so they use Ink instead. |
| Dithered Object | WebGL factory and GLB experiment; not automatically selected because tested contrast was insufficient. |
| Glass Object | GLB automatic path passed earlier Desktop check; raster silhouette loses internal details and is not auto-selected. |
| Ink Object | GLB automatic path passed earlier Desktop check; source-declared illustration candidate tested separately. |
| Liquid Object | WebGL factory and GLB experiment; automatic selection and Desktop remain pending. |
| Particle Object | WebGL factory and GLB experiment; automatic selection and Desktop remain pending. |
| Ascii Sweep | Exploratory factory ran with two sources; overlap in the tested presentation needs a different composition. |
| Asciify | Restricted bridge exercised on simple content; tested code rendering harmed readability, so it is not automatically used for code. |
| Bend | Exploratory factory ran but changes shared hover CSS without restoring it; blocked in the shared client until isolated execution is implemented. |
| Blaze | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Bubble | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Canvas | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Cloth | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Clouds | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Decrypt Reveal | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Displacement | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Droplets | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Flame Wrap | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Force Field | Exploratory factory ran; numeric content was visibly obscured, so data use is not approved. |
| Frost | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Glass | Exploratory factory ran; numeric content was distorted, so data use is not approved. |
| Glitch | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Glyph Rain | Exploratory factory ran; characters overlay source content, so data use is not approved. |
| Grid | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Hex Float | Changes shared hover CSS without restoring it and lost the test click; blocked in the shared client until isolated execution is implemented. |
| Laser | Exploratory factory and synthetic visual ran; scroll interaction and production bridge pending. |
| Liquid | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Magnify | Exploratory factory ran; numeric content was distorted, so data use is not approved. |
| Particle Reveal | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Particle Scroll | Did not initialize without native canvas-subtree layout; compatibility path remains pending. |
| Peel | Exploratory factory ran with an underlying element; production composition and interaction pending. |
| Retro Dither | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Ripple | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Shatter | Restricted bridge exercised on simple visual-only content; automatic selection and Desktop pending. |
| VHS | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |

The exploratory 28/29 HTML initializations are not equivalent to 28 production adapters. Factory, mount, source fidelity, interaction, disposal, automatic choice, installed Desktop and domain-specific usefulness need independent evidence for each component.
