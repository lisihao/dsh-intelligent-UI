# Conversation composition scenarios — 2026-11-05

## Purpose and boundary

These repeatable, explicitly synthetic scenarios test whether source analysis produces legal UI candidates, whether a chosen candidate reaches the actual renderer, and whether source text, values, units, conditions and relationships survive. They extend the adaptive composition candidate at `c6da16f902937e6e5fc3676b7179a86830b59f31`; no installed profile or app is changed.

The Jev test port returns explicit fixture/oracle answers. The actual candidate generator, coordinator, result validation, renderer and receipt binding run normally. This can falsify a broken decision-to-view path; it cannot establish that a real model would choose these layouts, that a choice is optimal, or that the saved OpenAI Decisions endpoint is available. Real model calls and credential reads are zero. Fixtures contain no private conversation or account data. A fixture's hypothetical user prompt describes the scenario for reviewers; it is not a hidden extra input to the composition API.

## Conversation cases

All numeric values and status records below are synthetic.

| Scenario | Input and intended presentation | Observable acceptance |
| --- | --- | --- |
| Conditional short answer | A Chinese answer says detection results are unavailable; plain document. | Preserve both “cannot confirm recovery” and “does not mean still failing”; no chart, task board, live feed or relationship graph. |
| Historical data with a gap | Five rows at nonuniform dates; one missing measurement; visx under soft-relief. | Complete original table retains all five rows, exact decimals and missing marker; four measured points form two unconnected segments; seven days occupy seven times a one-day interval. No live-series candidate. |
| Task status board | Three tasks with source-owned queued/running/done statuses; mechanical-outline board. | Exactly three source tasks, descriptions and units remain; no execution or fabricated graph. Actual compiled component set is present in the DOM. |
| Signed metric update | `-0.75 ms` updates to `+0.00 ms`; clear-glass presentation. | Preserve sign, decimal places and unit; one decision and one mount receipt across the compatible update. No chart or live-feed inference. |
| Explicit live source under reduced motion | Declared millisecond timestamps and measured values; exact static source table. | Retain timestamp units and all supplied points; a third point changes the current value without another decision. Liveline is excluded by reduced-motion capability. |
| Initial known loading state | A known metric surface has no visible content and is explicitly loading. | A loading status and inspectable source state appear; no fabricated metric, chart or completed result. Reduced motion excludes animated skeleton selection. |
| Installed theme packages | Linen, Cobalt and Paper are loaded as installed theme packages, then selected for source-owned content. | Each theme is offered alongside eligible built-ins and applies its actual CSS variables; the global/manual theme stays unchanged. |
| Explicit strategy relationships | Source provides nodes, edges and labels. | The real browser renders the selected React Flow route with exactly the declared relationships, preserving source access. |
| Conditional option comparison | Named options carry assumptions, units and long descriptions. | The selected clear-glass records view preserves descriptions, conditions and units, with complete original record access. |
| Multi-section report | A source report has headings, references and qualifications. | The selected report layout reaches its actual DOM/navigation path and keeps every original section and source reference. |

The six source cases are checked both as direct conversation content and as ordinary tool text wrappers. The metric and live cases additionally test source-compatible updates; three further checks select the existing installed theme packages. Detailed tests are in `tests/fixtures/adaptive-conversation-scenarios.ts` and `tests/adaptive-conversation-scenarios.test.ts`. The real-browser fixture retains the earlier same-source board/table and visx/OpenUI comparisons and ASCII scoping case.

## Failure cases

Failure scenarios exercise the real coordinator with explicit invalid, delayed and failed test responses: invented layout/component IDs, instruction-like source text, a late response after source replacement, and a network failure while the original content remains mounted. The instruction-like text case checks that source text does not extend the legal candidate set; it is not an evaluation of a real model's prompt-injection resistance. All four failure scenarios passed; the final browser evidence is recorded below. Rejection must preserve the source and must not become a successful selection or an automatically repeated model request.

## Commands and evidence

```sh
pnpm test:adaptive:scenarios
pnpm test:adaptive:browser
pnpm typecheck
```

- `pnpm test:adaptive:scenarios`: passed; 2 files and 21 checks (17 conversation/theme checks plus 4 failure scenarios). The conversation checks include six direct/tool-wrapped source forms, two compatible data updates and three installed theme selections.
- `pnpm typecheck`: passed after both scenario test files were present.
- `pnpm test:adaptive:browser` (same command as the final `node tools/test-adaptive-browser.mjs` run): passed in real Chrome/CDP; 9 selected documents and 9 mount observations. The main scenarios use 1,440 px; the live static snapshot also exercises 390 px. External requests, real model calls, page exceptions and console errors were zero.
- `node --check tools/adaptive-ui-preview.mjs` and `node --check tools/test-adaptive-browser.mjs`: passed.
- Three new browser screenshots were visually inspected: explicit strategy flow, conditional comparison records and cited report heading index. The report test expands all five navigation links and activates a real heading anchor; original report text is compared exactly.

The strategy diagram intentionally preserves a readable initial node size and can extend beyond its initial viewport. The real **查看全图** control was clicked and all three nodes were then verified inside the viewport. This is an existing pan/overview behavior, not proof that every graph fits on first mount. The test click helper now scrolls targets into view before dispatching the real browser click; a first failed interaction check was not accepted as passing evidence.

The unchanged production renderer/build and scratch Host paths retain their passing evidence from the [adaptive composition acceptance](2026-11-05-adaptive-composition.md): 91 test files, 1,050 passed and 3 skipped, build, typecheck and built-package scratch Host gate. That historical full-gate count is not relabeled as the current expanded suite's full count. This test-only follow-up runs the affected scenario files, browser harness and typecheck; it does not repeat the unchanged full gate.

Private logs and screenshots remain under ignored `.acceptance/`. Tests and test sources are not included in the runtime package. No merge, release, package installation or real-model/native acceptance is implied.
