# Project state — 2026-11-01

## Current mainline baseline
- Main commit inspected: `fc53e505e391d7be06464bcba8c8e3b9a24af0d3`.
- One DSH plugin contains deterministic content analysis and read-only presentation, original/compare display, OpenUI, React Flow/ELK, Uiverse adapters, JSON themes and optional MCP Apps.
- Official application is unchanged. Host writes versioned Artifact and theme settings, with source metadata retained.
- The README's integrated-Uiverse acceptance entry reports an earlier disposable-profile gate; this session has not independently rerun that gate.

## Current change scope
- Adds an optional, explicitly requested visual-effect field on generated Artifacts and an isolated frontend registry with lazy component loading and lifecycle disposal.
- Provides an in-house CSS headline reveal for end-to-end contract testing; reserves an unshipped Canvas UI provider slot.
- Visual effect requests do not change artifact content, citations, execution state, other plugin resources or theme selection.
- The existing session display control still governs visual/original/compare modes.

## Decisions
- Never copy third-party Canvas UI engines into the publicly distributed plugin until redistribution rights are clarified.
- Fail open to original content for missing providers, reduced motion and rendering errors.
- Limit the initial effect to a single short Markdown H1 to avoid GPU rendering across long reports.

## Unverified / remaining
- The Canvas UI GPU component has not been bundled, registered or tested in the DSH Desktop runtime.
- Upstream redistribution permission, Chromium HTML-in-Canvas capability, WebGL context loss and GPU perf need acceptance.
- GitHub Actions `pnpm check` passed on code commit `233bebe9d76b365d0c47cfe70410e7730dbb1daa`: build, typecheck, 35 Vitest files / 284 tests and disposable published-DSH profile; see [acceptance](acceptance/2026-11-01-canvasui-effects-foundation.md). A normal installed-app GPU smoke test remains pending.

## Unique next task
Obtain an explicit Canvas UI component distribution decision; after authorization, register the pinned Decrypt Reveal wrapper and engine in the optional provider slot, run full `pnpm check` and the installed-Dsh GPU canary with fallback/memory teardown coverage.
