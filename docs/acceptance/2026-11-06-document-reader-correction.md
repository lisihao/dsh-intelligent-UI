# Document reader correction after owner visual feedback

## Failure and acceptance boundary

The owner opened the delivered document-review URL and found an empty primary panel, a large source/metadata sidebar and clipped raw formula text. The previous browser loop explicitly selected and ran individual blocks; its passing block counts did not establish a usable default entry. Presenting that debugging interface as a finished reading experience was incorrect.

This correction keeps the same five private documents, original model programs, choices, rationales and source hashes. It changes their presentation and the relevant DIL material boundary. It neither generates new model answers nor installs into the current official Desktop.

## Implemented correction

- The default view shows the complete selected document. Each original compiled program runs through the existing isolated browser runner; its accepted native tree is retained and rendered through the same native-tree renderer. A source-code mismatch is reported and recovered as described below. A single runner processes the queue. Fifty-one or 105 source blocks do not create that many concurrent Workers/iframes.
- The application shell is outside the content-theme CSS scope. Navigation and evidence controls have a compact, explicit type scale; the document alone receives its theme. A dark shell supplies a stable underlay instead of composing the saved translucent dark content surface over a pale page ground.
- The five documents remain directly selectable. Narrow screens use a native document selector rather than a compressed sidebar or a clipped row of long titles. Content remains in source order; pending local rendering shows semantic original Markdown with an honest progress count.
- Component choices, model reasons, exact source, program and binding data remain in a closed-by-default inspector. Raw source is deliberately raw; the reading surface uses the actual Markdown/code/KaTeX renderer. Escape closes the inspector and focus returns without changing the reading position.
- A failed block reports its real reason, retains source and lets the queue continue. It is not silently marked rendered or automatically retried. Empty content has an explicit state. Existing per-document snapshots are reused within the page by document identity and source hash. Snapshot views are memoized so inspector selection/search does not re-render completed document trees. A 390px counterexample previously moved block 26 entirely above the viewport after selection; the one-factor memoization check passed the same 37-block document.

## Actual material defect

A generic DIL card previously called ThemeCard with a content role but no explicit component set. The legacy V1 role rule then selected soft relief, even though the DIL program had not chosen that material. The same implicit rule affected nested controls. This produced repeated raised/inset layers in the actual preview.

Both DIL entry points now honor an explicit composition component set first, then the selected theme's real component set. V1 Empryo/Paper use their native material; V2 themes retain their declared set. The global non-DIL role rules are unchanged. The native snapshot and live runtime use the same material decision. A badge also retains its intrinsic width instead of stretching across a grid card.

The completed-state code screenshot uncovered an additional, real content failure: nine original MD2 programs used `<code>{body}</code>`. The pinned DIL parser treats code children as literal text, so these programs displayed `{body}`. A mounted native tree was not sufficient evidence of correct code content.

The reader now compares the original fenced code's MDAST value with code/Markdown code values in the actual tree before caching a code block. A mismatch reports `DIL_CODE_SOURCE_MISMATCH`, displays the original code through the semantic code renderer, preserves the original model program and rationale, and continues without retrying. This is an explicit source recovery, not a newly generated model answer or a correct original native snapshot. The readable recovery notice omits the internal error code; its full named reason remains in diagnostic data. The model-readable catalog now explains the literal rule and directs bound code to `<markdown source={data.source}/>` with original fences. This narrow guard checks source-code presence; it is not a universal semantic-fidelity proof.

Snapshot callbacks are emitted only after protocol/native validation and required renderer checks. Callback replacement does not recreate a runner. Named runtime failures are reported outside React render. No arbitrary program is evaluated in the Node Host and no model choice is replaced with a hand-authored example.

The five actual files contain no state handlers/forms; their continuous outputs are therefore faithful read-only snapshots. An interactive program remains an explicitly started live block, rather than a snapshot with pretend event handlers. The existing conversation submission authority is not granted to this private viewer.

## Verification

The original private manifest remains byte-identical: SHA-256 `c7e9d6f49c20a61e29310700741ff8a2823a1e58292d5f14dc24e3caeeb1c579`. It contains 262 ready blocks (37 / 105 / 31 / 38 / 51). No new model calls were made for this correction.

- Affected regression: 9 files, 70 tests passed and one opt-in browser entry skipped; the browser entry is checked separately below. After the inspector fix, all five reader tests and the review-entry regression passed again.
- TypeScript passed after the final reader change. Production build and the built plain-Node/published-DSH scratch-profile plugin acceptance passed; the scratch home was removed and the receipt reports zero live model calls. The earlier unrelated full-suite result is not represented as a newly run full suite.
- Independent source review found no actionable P1/P2 in the queue, callback, material or evidence boundary. Independent visual review inspected desktop/tablet/mobile folds and body sheets; full long source headings remain intact.
- Taste inspect captured 1440 / 768 / 390px. Its sole failure is the unchanged 390px document title taking three lines; cutting the source title is outside this correction. Warnings include original source H1s, mathematical glyph/font metrics, and small metadata/axis text. These are not recorded as a clean lint pass.
- Hallmark rendered 1280 / 1440 / 1920 folds and narrow/full pages. Its sole mechanical failure flags KaTeX's nested glyph spans as overlapping text. The actual formula image and horizontal scrolling are checked separately; the raw lint failure remains retained. Reference-link wrapping and existing font/heading rhythm warnings are retained rather than rewriting source or generated programs to satisfy marketing-page heuristics.

The final actual-browser matrix passed at 1440 / 768 / 390px: each viewport checked all 262 blocks, consisting of 253 original native snapshots and nine explicit source-code recoveries. Recovered code was compared character-for-character against its original fence body. There were zero unhandled failures, source ranges matched, default entry was nonempty, the page/document shell stayed within the viewport, and the observed iframe peak was one. Do not relabel the nine recoveries as successful original model programs.

Completed-state images cover all five desktop document folds plus 768/390px reading and inspector views, actual code, mathematics and the budget chart. MD5 retained twelve KaTeX formulas including three displays. At 390px, the two wide displays had client/scroll widths 292/330 and 292/505px; actual scrollLeft reached 38 and 213px. Nine native tables had client/scroll widths 290/360px and actually scrolled by 70px. These are local scroll containers, not inaccessible right-side clipping. Completed views had zero remaining runner iframes. The real selected-navigation ink/fill was rgb(237,240,242) on rgb(36,40,45), unlike the stale static-cascade contrast warning.

The existing DIL real-browser interaction acceptance passed separately (one test, approximately 40 seconds): actual Host compiler, opaque frame/Worker, native controls, derived output, submission/watchdog and three viewports. It made no model calls.

The original Chrome preview tab was no longer present. A new tab was opened at the corrected loopback URL. A read-only check of the real Chrome page observed continuous reading, a closed inspector, the corrected dark underlay, semantic mathematics and a bounded page while MD4 was preparing (4/38 snapshots, one runner). A later read found the tab absent; it was not recreated or its navigation replayed. Completed-state and all-block counts above come from the separate actual-browser acceptance, not an unobserved completed state in the user's Chrome. The loopback server remains available at port 55210. All private Markdown, runtime files and screenshots stay ignored. No official Desktop installation, merge or release was performed.
