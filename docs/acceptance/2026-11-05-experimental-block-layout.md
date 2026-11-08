# Experimental content-block layout acceptance — 2026-11-05

This is source acceptance for the independent `lisihao/dsh-intelligent-UI` development candidate, based on `d82ec6558180e828ff2dedae835c9099cb0a2fab`. It is not a release or installation record. The package remains `0.1.0-preview.2`.

## Behavior covered

The default-off `adaptive.blockLayout` gate selects a compiler-owned block program instead of the existing whole-output candidate path. One scoped Jev Decisions request carries the real choices for all blocks. The complete document retains its theme and reading frame; individual blocks can use source tables, charts, boards, record details, explicit flows and eligible state/asset adapters. Research inspection is an independent option.

Compiler references use normalized source paths and Markdown UTF-16 ranges. Table/chart eligibility reuses complete-document table parsing, including nearby units, comparison prohibitions, section boundaries and document-scoped reference definitions. Passive prose/code remains native. Candidates without a real rendering consumer are not advertised as executable. Explicit compatible block choices take precedence over theme defaults; mandatory time spacing and gap handling remain protected.

The Settings toggle and physical-key shortcut update the same revision-checked preference. The default is `Alt+Meta+KeyI` (⌥⌘I), recording a new combination rebinds it, and an empty binding disables it. Keyboard actions never silently enable takeover or adaptive/Jev prerequisites. Shortcut-only edits do not invalidate a decision. The client owns one disposable listener, ignores repeats/composition/consumed events, preserves focus navigation in the recorder and does not execute queued toggles after cleanup.

## Executed checks

| Check | Observed result |
| --- | --- |
| Plugin build and full TypeScript check | Passed during `pnpm check`. |
| Full Vitest suite | 96 files passed; 1,104 passed and 3 skipped, 1,107 total. |
| Built-package scratch DSH Host | Final `pnpm test:plugin` passed against the published baseline using built `lib/` under Node. Experimental settings persisted, one batch produced the block program, disabling restored the legacy path, original flags/artifacts were preserved, and the scratch home was removed. Zero live-model calls. |
| Real Chrome through CDP | Final `pnpm test:adaptive:browser` passed at 1,440 and 390 CSS pixels: 10 selected documents and 10 observed mounts. The mixed document simultaneously displayed a historical chart, task board and explicit arrow flow, with complete raw content, reference-style links and footnotes. |
| Production Settings and shortcut in Chrome | The real Settings component and production installer were exercised through physical-code CDP key events. Checkbox, default toggle with chat-input focus, custom recording/rebinding, old-binding inactivity and cleanup were checked. This is renderer-event evidence, not an OS/native-menu test. |
| Five previously supplied private Markdown files | Local compilation and strict selection/source-reference validation passed. Block counts: 13, 38, 31, 13, 8. Multi-option question counts: 23, 35, 51, 23, 14. No model requests were made for this check. |
| Independent source review | Reported source-context, dispatch, recording and remount defects were corrected and rechecked. No remaining P1/P2 finding in the assigned review scope. |

The first aggregate run completed build, typecheck and the full unit suite, then failed the scratch fixture's old cleanup equality assertion: partial saves intentionally preserve the new fields. The fixture now explicitly restores their effective original defaults as well. Only that affected integration gate was rerun; production source, dependency inputs and already-passing unit/browser scopes were unchanged. The corrected integration gate exited 0. JSDOM emitted existing unsupported Canvas/CSS diagnostics; these are not native GPU or browser acceptance evidence.

Private logs, browser captures, synthetic Host receipts and private-file hashes remain under ignored `.acceptance/` or the test-owned temporary directory. No private documents, account configuration, credentials or runtime receipts are committed.

## Not established by these checks

- No new real Jev/OpenAI call was made for the block experiment. The checks do not establish real-model suitability or explain why a model would prefer a particular block candidate. Displayed basis text is local eligibility evidence, not a textual rationale returned by Decisions.
- The previous five real decisions have not been replayed as new block decisions. Their old choices are not relabeled as results of this compiler.
- No plugin was installed or enabled in the official Desktop. Native shortcut delivery remains unverified: an Electron menu can intercept ⌥⌘I before renderer DOM handlers. The shortcut is configurable; no Desktop menu or DevTools configuration was changed.
- Compilation currently targets top-level semantic units. Unsupported nested rich content remains native, and development archives/metadata-only effects remain non-executable catalog entries.
- No release, merge, model-route change, account/session migration or paid probe was performed.

See the [experiment contract](../design/experimental-block-layout.md) for the source/selection boundary.
