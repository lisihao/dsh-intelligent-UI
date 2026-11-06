# Rich Markdown and DIL acceptance

## Evidence boundaries

This record separates source checks, a production-component local browser preview, a built-package scratch Host run, real-model decisions and installed Desktop behavior. It does not claim an installed update or full ChatGPT runtime compatibility. No application build, installation, merge or release is included.

## Rich Markdown: original five files

The frozen browser bundle at source `629c537b00230c5ce8605021b4fa6bae829bc624` reused the completed decisions for the same five original files. No new Jev call was required for these rendering changes. All 262 source blocks and the five original source hashes were retained; the private preview checked 1440px and 390px widths, no document overflow and no external requests.

| File case | Display math | Inline math | Code blocks | Blocks with highlight tokens | Source directory |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 3 | 1 | 0 | 0 | — |
| 2 | 0 | 0 | 9 | 6 | — |
| 3 | 0 | 0 | 0 | 0 | — |
| 4 | 3 | 3 | 0 | 0 | 25 entries: 22 exact heading links; 3 original unmatched items |
| 5 | 3 | 9 | 1 | 1 | — |

Every code block retained its exact original code value. A declared language does not guarantee that a short token-free command needs a colored token. Math-bearing cases used the embedded KaTeX font. Unmatched directory entries remained readable rather than linking to guessed sections. The per-block component choices and real Decisions accounting remain in [semantic composition acceptance](2026-11-06-semantic-composition.md); an auxiliary inspection chart is not a main Jev chart choice.

Private source, raw requests/results, runtime data and browser captures remain outside Git in the ignored acceptance directory.

## DIL scope

The source implements a separate generative authoring lane behind the existing block-layout experiment. The Host compiles a source string using the pinned reference; a fixed opaque iframe/DOM-less Worker runs the program; a bounded tree becomes native controls. Reference identity, licenses, selected mechanisms and unsupported behavior are in [the integration contract](../integrations/dil-generative-ui.md).

Forms are host-action-only. Submit-time sandbox handlers and submit-button click handlers are rejected, preventing a handler's asynchronous completion from racing the conversation callback. Explicit submission reads a validated Worker state snapshot after previously posted controls and fails without submitting on timeout, protocol failure or disposal. Normal control handlers update state and calculations locally.

The source also preserves a runner across compatible stream revisions and temporary-to-durable replacement, confines compiled result metadata to the expected presentation tool, checks source/compiled-source equality, projects only declared chart columns, and exposes state restore/save failures. These are correctness checks rather than a diversity or visual-quality score.

## Verification ledger

The built-package scratch probe exercises the published DSH baseline with a disposable home and plain Node `lib/`. It covers the experiment gate, preview/runtime owner RPC, actual `solar_present` persistence, versioned widget state, static runner HTTP response and runner closure. No model call is made by this probe. A separate browser check must establish frame bootstrap, Worker execution and native interaction; a reachable URL alone is insufficient.

Final source gate: `pnpm check` completed with exit code 0: build, typecheck, all 118 test files (1,259 passed; 3 skipped), and built-package scratch Host acceptance. All seven DIL markers above were true, the scratch home was removed, and reported live/external model calls were zero. The first full run found one existing Canvas test still selecting the former English copy label; it now selects the actual Chinese label while retaining the real validator rejection assertion. The final gate also includes delayed-start/latest-source and delayed-state-capture/committed-fields regressions. The latter first reproduced stale form fields and now reads the fields only after the native tree is committed.

Real-model DIL authoring and the normal installed official Desktop CSP path are not run as part of this source delivery. Browser results are recorded separately below.


## Real browser execution of a fixed DIL sample

`DIL_BROWSER_E2E=1 pnpm exec vitest run tests/dil-browser.test.ts --reporter=verbose` passed its one real-browser test separately from the source gate. The opt-in wrapper was added after the 118-file gate; it is skipped by default. Its `node tools/browser-dil/acceptance.mjs` command ran the actual Host compiler, static runner, opaque iframe, DOM-less Worker and native `DilProgramView`, with the same OpenUI ThemeProvider contract as the production artifact wrapper. The parent CSP forbade `unsafe-eval`; only the pinned child runner carried its required evaluation permission. The source was a fixed hypothetical quote calculator, not model-authored user content.

At both 1440px and 390px, the check observed a native tree, unreadable cross-origin frame document, real Worker keyed state and a chart. A slider, checkbox and select changed the derived quote from ¥600 to ¥3,075 for six professional seats plus ¥75 coverage. The final select change was followed immediately by explicit submit; exactly one callback contained matching `state` and `fields`. Compatible program updates kept the keyed state and one frame. Disabling the experiment removed the frame and exposed source. An unsupported component quarantined the frame and retained original source and diagnostic. Neither viewport overflowed or reported page exceptions.

A separate fixed infinite-loop Worker sample reached the watchdog fallback after approximately 2.6 seconds in the fixed sample; original program source remained accessible, and the host's disable button still responded and removed its frame. This is one bounded watchdog measurement, not a general performance claim. The harness had no real model/provider connection and reported zero model calls. The assertions do not constitute a general network traffic audit.

Default and narrow screenshots were visually checked. An initial fixture omitted the production ThemeProvider and rendered dark-chart labels incorrectly; the corrected fixture includes that provider and the labels are readable. This was a fixture-context correction, not an unrelated theme redesign.

The tools use a development CDP helper, optionally supplied by `DIL_BROWSER_CDP`; the default is under the current user's Codex design-taste skill. A missing helper produces a named error. This dependency belongs to the optional browser acceptance command, not the installed plugin. `node tools/browser-dil/preview.mjs` starts the fixed local preview without invoking a model.

The browser receipt and screenshots stay in ignored local acceptance storage. Installed official Desktop execution and real-model DIL authoring remain untested in this delivery.
