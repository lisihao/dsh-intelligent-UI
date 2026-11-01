# Unslop theme collection acceptance — 2026-10-31

## Boundary

Four downloadable format-v1 JSON themes and catalog entries, attributed design mapping, regression tests and a preview-only loader. No production renderer, host or other plugin source changed. No application restart, model call, npm/market release or automatic theme activation is part of this change. The existing Empryo file remains byte-identical.

## Checks run

- `pnpm check`: build, TypeScript, **216 tests in 23 files**, and built-package scratch-profile install/owner-RPC/restart/disposal passed. The existing slot-collision negative test emits its expected error log. No external model calls.
- Catalog checks validate every file's exact SHA-256 and manifest identity. A local HTTP test downloads all four imported packages without changing the active theme or appearance; selection and restart persistence pass for each and the previous selection is restored.
- All four packages' computed text, muted text, accent, status and chart-series roles pass 4.5:1 contrast across base/card/hover/soft surfaces over black and white underlays, using theme defaults. User-chosen opacity overrides remain user-controlled and are not covered by that default-contrast claim.
- `ai-design-check` on the four theme files and changed preview loader: zero findings. No new ignore or baseline.
- Actual browser rendering uses the shipped React renderer, settings and charts, with a report generated from a real 23-test focused run. All themes show the same source hash, counts, three file timings and units. This is real local test data, not DSH benchmark or performance evidence.
- Four desktop captures at the default 1280 × 720 viewport (full document) and four 390 × 844 responsive captures inspected. No horizontal document overflow. Each theme retains original-data disclosures and the unified display switch. Settings select actually switches through all four packages and returns to Porcelain in the disposable preview; the complete original table and raw mode were also exercised.
- Independent Impeccable finish review: **ship**, with no material fixes. It covers supplied browser captures and package definitions, not new theme activation inside Desktop.
- `git diff --check` passed. Empryo package hash remains `1665075d26b5ea40ecb7532de7fba24316c83014c9eb91f0725ed461d411fb27`.

## Unchanged and uncovered

The live Desktop appearance was only read: Empryo remains selected, takeover enabled and the saved background opacity is 0.47 (53% transparency). These data-only packages use the existing remote catalog, so the installed plugin does not need an update. Downloading or selecting these particular packages in the official Desktop UI was **not run** for this delivery; the browser's real Settings selection and local HTTP/persistence path were run. No claims cover previously unsupported foreign pages. Private runtime files, research content, screenshots and account data are excluded from Git.

See [theme packages](../../theme/README.md) and [design mapping / attribution](../design/unslop-themes.md). The themes adapt palette/material to the existing renderer; they do not reproduce the reference marketing page or introduce a new dashboard layout.
