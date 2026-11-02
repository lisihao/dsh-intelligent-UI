# Canvas UI component progress

This is an implementation and evidence ledger for the 35 components at Canvas UI commit `a04a99b235299ee79a123a16ccb2e6cf9da74b6b`, not a claim of complete support. Original data and the independent-plugin boundary are mandatory. The upstream MIT + Commons Clause license remains in force.

Official Desktop candidate `52e26952…` rendered source-declared GLB with Ink, ASCII and Glass and a structured JPEG with Ink and its original image. Its Markdown `data:` PNG generated Ink but failed to display the adjacent original; source text remained intact. Candidate `4786545f…` fixed that original and passed Desktop display plus uninstall/reinstall checks on the same PNG; local browser checks covered 1200 and 320 CSS pixels, including reduced motion. Candidates `5a42ff3b…`, `ea5f6723…` and `4cf7ec49…` were installed and passed PNG, existing GLB, original mode and disable/restore checks. The latest also passed a native half-screen check. It contains the experimental HTML adapters described below, but they and no-domain automatic selection still lack a normal Desktop consumer for acceptance. The HTML experiment below ran in isolated Chrome 156 using SwiftShader and an exploratory snapshot shim. It does not prove hardware acceleration, DSH Chromium 152, complex layout, text/data fidelity or interaction parity. No HTML effect is automatically applied to ordinary report data or code.

| Component | Current evidence or remaining condition |
|---|---|
| ASCII Object | GLB automatic path passed earlier Desktop check; tested raster illustrations lacked sufficient structural fidelity, so they use Ink instead. |
| Dithered Object | WebGL factory and GLB experiment; not automatically selected because tested contrast was insufficient. |
| Glass Object | GLB automatic path passed earlier Desktop check; raster silhouette loses internal details and is not auto-selected. |
| Ink Object | GLB and structured JPEG automatic paths passed Desktop checks; the Markdown `data:` PNG and its adjacent original also passed Desktop reacceptance. |
| Liquid Object | WebGL factory and GLB experiment; automatic selection and Desktop remain pending. |
| Particle Object | WebGL factory and GLB experiment; automatic selection and Desktop remain pending. |
| Ascii Sweep | Two inert proxy sources animated and cleaned up in local Chromium; the factory mutates its input layers and the tested result duplicated and obscured text. Not suitable for automatic report reading; Desktop and broader interaction remain pending. |
| Asciify | Experimental visual-only adapter uses a private text-geometry proxy tied to the captured bitmap revision. Local Chromium exercised pointer effects, updates and cleanup at 1280/320. A solid opaque background is required; materially different source/sandbox text layouts are rejected, and Range geometry does not cover all glyph pixels. Desktop and automatic use remain pending. |
| Bend | The shared factory remains blocked because it changes global hover CSS. A visual-only isolated-document adapter runs in local Chromium; Desktop CSP and normal consumer acceptance remain pending. |
| Blaze | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop and automatic selection remain pending. |
| Bubble | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Canvas | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop and automatic selection remain pending. |
| Cloth | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Clouds | Experimental visual-only adapter uses an isolated pointer proxy and source-aware background color; explicit RGB is required when a solid background cannot be inferred. Local Chromium covered 1280/320, theme changes and teardown; Desktop and automatic selection remain pending. |
| Decrypt Reveal | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop and automatic selection remain pending. |
| Displacement | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; it can obscure text, and Desktop and automatic selection remain pending. |
| Droplets | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Flame Wrap | Exploratory factory and synthetic visual ran; production bridge and automatic selection pending. |
| Force Field | Exploratory factory ran; numeric content was visibly obscured, so data use is not approved. |
| Frost | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop, full interaction parity and automatic selection remain pending. |
| Glass | Exploratory factory ran; private-proxy pointer forwarding and source-target matching still need adaptation, and numeric content must not use the distorted copy as its only view. |
| Glitch | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy and exposes `burst()`; its distortion is unsuitable for facts, and Desktop and automatic selection remain pending. |
| Glyph Rain | Exploratory factory ran; characters overlay source content, so data use is not approved. |
| Grid | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop, full interaction parity and automatic selection remain pending. |
| Hex Float | The shared factory remains blocked because it changes global hover CSS. A visual-only isolated-document adapter runs in local Chromium but can crop text; Desktop CSP and interaction parity remain pending. |
| Laser | Exploratory factory and synthetic visual ran; scroll interaction and production bridge pending. |
| Liquid | Exploratory factory ran; visual fidelity and automatic selection pending. |
| Magnify | Experimental adapter accepts text-free, caller-declared non-data decoration only and forwards stage input through a private closed shadow root; scroll zoom, Desktop and full interaction parity remain pending. |
| Particle Reveal | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; the default particles obscure text, so Desktop and automatic selection remain pending. |
| Particle Scroll | A visual-only fallback runs against the real factory in local Chromium, preserving the original scroll view; SDK and Desktop acceptance remain separate and automatic selection is pending. |
| Peel | Two inert proxy layers animated and cleaned up in local Chromium; the factory mutates its input layers and mixed text during the tested turn. Original interactive/visual content and Desktop parity remain pending. |
| Retro Dither | Exploratory factory and synthetic visual ran; its text-protection mask sees an empty private proxy, so mask fidelity and automatic selection remain pending. |
| Ripple | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop, full interaction parity and automatic selection remain pending. |
| Shatter | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy and an adapter-owned static backdrop; Desktop, full interaction parity and automatic selection remain pending. |
| VHS | Experimental visual-only adapter runs the upstream factory in local Chromium using a private proxy; Desktop and automatic selection remain pending. |

The exploratory 28/29 HTML initializations are not equivalent to 28 production adapters. Factory, mount, source fidelity, interaction, disposal, automatic choice, installed Desktop and domain-specific usefulness need independent evidence for each component.
