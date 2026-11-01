# Project state — 2026-11-01

## Baseline
- Official repository main inspected: `fc53e505e391d7be06464bcba8c8e3b9a24af0d3`.
- Product: independent DSH Desktop UI enhancement plugin with reversible output takeover, original/compare mode and user-selected themes.
- Implemented source-preserving local content layout, OpenUI, React Flow/ELK diagrams, continuous Paper report view, Uiverse source/compiled adapters and optional MCP Apps.
- Normal Host captures/saves Artifacts, and the browser owns layout. Existing Uiverse and previous browser/installed verification records remain in `docs/acceptance/`.

## Decisions
- Visual effects are solely a frontend concern, with optional GUI preference and component/scene rules.
- Retain `solar_present` and Artifact data/schema unchanged for visual enhancements.
- Protect host and foreign-plugin ownership; use only official public slots and reversible theme token adapters.
- Canvas UI remains candidate GPU visual source for optional decoration. No upstream engine, dynamic runtime code, host provider, or performance claim shipped by this design-only change.
- Legacy PR #1 was superseded due to Agent/Artifact coupling and narrowly scoped first-H1 effects.

## Known limits
- Exact DSH Desktop embedded Chromium support for Canvas UI HTML-in-Canvas and WebGL fallback remains unmeasured.
- MIT + Commons Clause redistribution clearance for embedded Canvas UI source remains to be determined.
- Chapter navigation and source focus interactions still need an end-to-end UI acceptance slice.

## Unique next task
In `src/layout-views.ts`, improve source-derived chapter navigation focus/active-state feedback, add a browser regression test preserving source/scroll behavior, run `pnpm check`, and record actual Desktop acceptance separately. Do not change Host, Agent prompts, `solar_present`, Artifact Schema, or foreign plugins.
