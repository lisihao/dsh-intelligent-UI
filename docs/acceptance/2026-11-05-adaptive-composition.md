# Adaptive composition acceptance — 2026-11-05

## Scope and source boundary

This is the independent `lisihao/dsh-intelligent-UI` development candidate based on `529984522b69f0ed20cf9039c2dabae9fc3f1e65` and its approved adaptive UI design. The owner explicitly includes all previously implemented intelligent UI styles/components in the decision scope, subject to actual source eligibility and runtime availability. The package version remains `0.1.0-preview.2`; this is not a release or installation record.

The source implements a complete capability catalog, deterministic source/candidate analysis, an optional scoped Jev `judgeOnce` consumer, strict result validation, output-local theme/component/layout dispatch, exact-source access, cancellation, source/route staleness, shared-request lifetime handling and mounted-view observations. New adapters consume pinned Skullet, Torph, Liveline and visx entries. Existing source/analyzer/chart/graph/theme APIs remain the deterministic fallback.

The candidate includes installed themes, three compiled Uiverse component sets, document/heading-index/continuous/research/table/board/record/flow layouts, existing chart engines and supported source-anchored object effects. Uiverse's 3,802-item developer archive and Canvas components without a normal automatic renderer remain explicitly classified; their catalog presence is not runtime acceptance.

## Verification record

| Check | State | Evidence boundary |
| --- | --- | --- |
| Upstream pins, React entries and MIT notices | Run | Exact npm archives/lock integrity and source provenance inspected; four full notices ship through the build. No upstream source patch. |
| Source/candidate/coordinator/component/presentation regression checks | Run | Focused Vitest covers actual ContentView and client slot paths with synthetic decisions; included in the stable full gate below. |
| Full build/type/unit/scratch plugin gate | Passed | `pnpm check` exited 0: build, typecheck, 91 test files; 1,050 tests passed and 3 skipped. Built `lib/` ran under plain Node in a scratch published DSH Host; scratch removal confirmed, real model calls 0. |
| Real Chromium behavior, default/narrow layouts and source access | Passed | `node tools/test-adaptive-browser.mjs` exited 0. Six selected documents and six mounted-view observations at 1,440/390 px use the actual coordinator/candidate schemas and production browser bundle with a synthetic Jev port. Board/table, two component styles, visx/OpenUI, original/compare, static live fallback, disable and ASCII scope were exercised. No page exceptions, console errors or external requests were observed. |
| Settings visual inspection | Run | The real Settings component was mounted through a local HTTP fixture and inspected at 1,440/375 px. The new opt-in, fee notice, separate Jev switch notice and style selector remain visible in the narrow container. An earlier unmounted screenshot fixture was rejected and is not acceptance evidence. |
| Package contents | Passed | `npm pack --dry-run --json --ignore-scripts` exited 0: 153 entries include built Host/client entries, all four MIT notices and upgrade guidance; private acceptance data, tests and node_modules are excluded. |
| Real OpenAI Decisions request | Not run | No paid probe or live credential access. Synthetic decisions do not establish provider availability or judgment quality. |
| Installed official Desktop, on/off and native UI acceptance | Not run | No app build, installation, profile change or release was authorized/performed in this source-delivery task. |
| GitHub merge/release | Not run | Source PR only; no merge, tag, npm/market publication or app artifact. |

Private logs/screenshots and temporary scratch profiles stay outside Git. The checked-in browser and Host fixtures contain only explicit synthetic sources.

The scratch Host additionally exercised missing/attached/disabled Jev, catalog RPC, owner rejection, cancellation, selected result, mounted receipt, cross-session receipt rejection, no request replay and settings restoration. All corresponding assertions passed. Final review confirmed the live-series expiry race is covered: a deadline crossed between render and effect still schedules a local static fallback.

The three skipped tests are reported as skipped, not passed. These source checks do not establish installed Desktop behavior.

## Behavior exercised by focused regression tests

- All installed styles are cataloged; selected mode locks the manual theme/component set while automatic mode can choose eligible installed alternatives.
- Model choices change the actual source-owned DOM: styles/component sets, charts, table/board/record/flow/index/continuous surfaces, rather than only returning catalog metadata.
- Ordinary Markdown, JSON strings and normal tool text blocks use the same source normalizer. Independent blocks keep their boundaries. JSON live/metric/status updates reuse a compatible composition without another decision per value.
- Assistant reasoning remains locally inspectable but is not sent for composition; canonical text blocks are judged separately. OpenUI stream source IDs include the assistant anchor sequence.
- Invalid/stale/cancelled/unavailable judgments keep local content and never authorize a task action or automatic model retry. Source/settings/connection changes invalidate old results.
- Two views of the same source can share a request; one view leaving cannot abort the other. Final cancellation and all settled paths clean up active state.
- Observed receipts require the exact source/session/operation binding, follow an actual mount acknowledgement, and cannot turn a write failure into a repeated decision.
- Historical charts preserve actual time spacing and declared gaps. Existing dense-line protections still apply even if a model asks for an incompatible chart engine.
- Live rendering uses exact declared timestamp units and source values. Reduced motion, hidden/offscreen state, a future/out-of-window observation or insufficient current-window data uses a static complete source view. Source silence expires the drawable view locally without a model request.
- Existing settings load without enabling auxiliary decisions; explicit new settings persist, older callers preserve them, and malformed/stale writes are refused.

## Operating boundary

Enablement requires both the UI opt-in and Jev's separate **智能 UI 编排** feature switch. The UI consumer preserves the saved Jev protocol, endpoint, model and credential reference. Other Jev consumers are not enabled, and the primary Agent/model configuration is unchanged. Auxiliary API charges are possible only after those explicit settings are enabled.

Rendering and synthetic tests do not establish improved comprehension, speed, cost or native GPU availability. Real provider/native acceptance remains a separate, explicit next delivery boundary.
