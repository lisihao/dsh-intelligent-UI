# Compatible-page card hover coverage

## Cause and scope

Solar Bench 0.1.0-dev.0 now renders its catalog/run cards as section/article surfaces without aria-label. The prior UI adapter only matched its original labeled statistic sections. Mnemon 0.5.32 had theme-variable inheritance but no card-hover selectors. The affected cards therefore did not receive hover lift.

Only this UI plugin changes. `src/page-appearance.ts` adds bounded selectors under the conversation-view outlet: Bench cards use the existing `#bench-top-panel` and neutral surface token; Mnemon uses its stable plugin/part root and full semantic CSS-module class tokens, excluding generated hashes and similarly named metadata classes. Storage-area and document-summary articles have explicit group selectors. These remain version-specific presentation adapters, not new foreign-plugin APIs.

Cards use the selected theme's lift, accent border, surface tint and shadow. A hovered descendant card suppresses ancestor hover movement, so nested cards do not move twice. Graph node transforms, table scroll wrappers, toolbars and dialogs are excluded. Displacement is restricted to fine-pointer hover with no reduced-motion preference; reduced motion keeps feedback without displacement. Existing takeover activation and stylesheet disposal remain the restoration mechanism.

## Executed evidence

- `pnpm check`: build, strict typecheck, 211 tests in 22 files, built-package scratch install, actual Gateway operations, restart and disposal passed. No external model call.
- Focused selector regression covers unlabeled benchmark articles, storage leaves, multiple class tokens, and exclusion of metadata, foreign roots, table wrappers and graph positioning. Existing takeover/disposal regression passes.
- Affected-file ai-design-check reports no findings.
- Real browser fixture with pointer hover: benchmark, memory entry and storage leaf report transform matrix Y = -3 px; the hovered storage leaf's parent and metadata remain untransformed. An existing graph translation remains (20,30). Disabling the adapter returns the memory card to no transform and its original 12 px radius.
- Official DSH on macOS arm64, captured at 4608 × 2812: BFCL catalog card visibly lifts with accent border/tint/shadow. Original Configure and run opens its unchanged configuration form, then Collapse closes it. No benchmark was started and no model call was made.
- Mnemon's Provider card and storage-area leaf exhibit the same bounded feedback; hovering the runtime-memory storage leaf does not lift the surrounding storage-domain card or sibling leaves. Independent finish review of paired native captures returned `ship`, with no required fix.
- Normal quit, official bundled CLI install with ignored lifecycle scripts, and normal launch succeeded. All 45 built files match the installed package. Immediate profile reconciliation preserved other dependency specs and resolved closure, profile files and UI settings. Takeover remains true, OpenUI true, MCP Apps false, with translucent #24262b at alpha .47 (53% transparency).

Archive: `artifacts/20261031-page-card-hover/lisihao-dsh-solar-intelligent-experience-platform-0.1.0-dev.0.tgz`; SHA-256 `0c6534e36153df2b52f4f0eb00df0c8ab33d8225e199ae95adee4113bbda0674`.

## Limits

The installed memory store had no actual runtime-memory entries to hover; their class-token behavior was exercised in the browser fixture, not claimed as native content acceptance. Reduced motion was inspected in CSS and was not toggled at the macOS level. Native takeover off/on was not repeated for these new selectors: browser disable and shared stylesheet lifecycle tests cover restoration; the unchanged owner activation path also has the previous native restoration record. Narrow-window and all foreign-plugin views were not exhaustively recaptured. Upgrades that rename owner semantic classes or change card markup require the selector review in UPGRADING.md. Private screenshots, account data, reports and profile backups stay outside Git.
