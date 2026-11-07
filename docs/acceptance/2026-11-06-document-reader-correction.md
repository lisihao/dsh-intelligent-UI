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

## Follow-up: reading-surface consistency (2026-11-06, after the owner's handoff)

The owner had not yet approved the corrected reader's visual design. This follow-up reviewed the same five private documents in a headless Chrome (CDP) at 1440, 768 and 390px. The built-in Claude Desktop browser pane could not be used for this: it blocked the runner iframe's second loopback port with `ERR_BLOCKED_BY_CLIENT`, while `curl` fetched the same URL with HTTP 200. No new model calls were made, and the manifest, programs, choices and rationales are unchanged.

### Observed defects

All three were observed on `ad31147` with the new presentation check described below. Counts are per document at 1440px; the 390px counts are identical.

- **Card inset.** A DIL `card` without a material adapter had no edge, fill or shadow, but kept its program-declared inline padding (for example `padding={4}`, which renders as 16px). It therefore showed no box, yet shifted text inward: up to eight distinct text left edges per document. Counts: 31 (md-1), 82 (md-2), 61 (md-3), 16 (md-4) and 123 (md-5) such cards.
- **Body font.** OpenUI's layered Markdown rules (`@layer openui`, a `font:` shorthand on `p`, `li` and `strong`) set body text in Inter instead of the theme typeface. Headings used the theme typeface only in default-theme documents (see the next item). Examples: 60 Inter paragraph and list items in md-1 and 587 in md-3.
- **Theme tokens.** The default-token rule `.dsh-experience.iexp-content{…}` also matched nested embedded-Markdown roots. Inside the `paper-flow` documents (md-2, md-3, md-4), it reset `--iexp-font` from the document's platform sans to the default Empryo typeface. Headings therefore used DSH Recursive while DIL text used the system font.

### Changes

- `src/dil/view.css` (production renderer): a native DIL card, `.iexp-dil-card:not(.iexp-uiv-card)`, now uses the theme's existing card material: line border, card radius, card fill and card shadow. This matches the explicit native card presentation (`.iexp-block-card`).
  - A card nested in another card steps down to the sunken tone, with no border or shadow, so raised surfaces do not stack.
  - At 560px and below, card insets are capped at 12px, and 8px/10px for nested cards, to keep a readable measure. This deliberately overrides the program's inline padding on narrow screens only.
  - The program's card choice and wider-screen padding are kept. Cards that already have a material adapter (`.iexp-uiv-card`) are untouched.
- `src/style.ts` (production): Markdown body elements (`p`, lists, `blockquote`, `strong`, `a`) now inherit the theme `font-family` and `font-variation-settings`. Inline code uses `--iexp-code-font`.
  - Embedded-Markdown roots are excluded from the default-token rule, so they inherit the enclosing theme.
  - In a CDP check, the production appearance rule shape (`.dsh-experience,.dsh-experience.iexp-content[data-experience-theme]`, from `src/appearance-style.ts`) still set the token on embedded roots. A mono `--iexp-font` plus `--iexp-font-mono: 1` on the surface propagated to body text, including the `MONO 1` axis. The ASCII and Paper built-in themes themselves were not rendered.
- `src/ascii-style.ts` (production): the ASCII grammar keeps data cards flat at rest; native DIL cards were added to that list. A CDP check injected the ASCII grammar block over an md-5 card: box shadow went from present to `none`, while the solid 1px border and fill remained. The full ASCII theme was not rendered.
- `tools/dil-document-review/fixture.css`: the narrow-screen document surface inset changed from 16px to 12px.
- `tools/dil-document-review/presentation-checks.mjs`, called by `review.mjs` for every settled document: asserts no embedded-Markdown theme-token mismatch, no Markdown body font that differs from the document typeface, and no invisible card with an inline inset.

Not changed: `appearance-style.ts` writes the global theme onto every nested `.dsh-experience`. Reading the source suggests this can override a block-level `BlockThemeScope` in the conversation product, but that was not reproduced and is outside this change.

### Verification (all run on this change set)

- **Presentation check on `ad31147`:** red for every document at 1440 and 390px (counts above).
- **Presentation check after the change:** zero issues at 1440, 768 and 390px.
- **Reverse control:** each of the three fixes was reverted on its own, and the check turned red for its own issue type (md-2 and md-5 at 1440px):
  - body font reverted: 246 / 191 body-font issues;
  - default-token exclusion reverted: 94 theme-scope issues in md-2 (md-5 uses the default theme);
  - card material reverted: 82 / 123 card-inset issues.
- **Real-browser matrix (`review.mjs`, 1440/768/390):** each width rendered 253 original native snapshots and 9 explicit source-code recoveries out of 262 blocks. Zero failures, iframe peak 1, zero model calls.
- **Opt-in DIL browser interaction test** (`DIL_BROWSER_E2E=1`): 1 passed (about 39 seconds).
- **Unit and integration tests:** `pnpm typecheck` passed. The full Vitest suite passed: 159 files, 1529 tests passed, 5 skipped.
- **Build and plugin acceptance:** `pnpm build` passed. `pnpm test:plugin` passed against a scratch profile: `scratchRemoved: true`, `liveModels: 0`.
- **After the ASCII selector change:** `pnpm typecheck` passed; the eight ASCII test files passed (106 tests); `pnpm build` and `pnpm test:plugin` passed again (`scratchRemoved: true`, `liveModels: 0`). The browser matrix above ran before this one-selector change; the change only applies under the ASCII grammar, which none of the five documents use.
- **Not run:** the taste/Hallmark linters. Their house rules (no borders, no shadows at rest) conflict with the locked DESIGN.md card material, so their warnings would not decide this change.
- **No user feedback yet:** the owner has not reviewed the revised screenshots, so this is not a claim of owner visual approval.

Private evidence is kept under `.acceptance/claude-visual-20261106/`: before and after screenshots, the red/green and mutation outputs, the cascade check, and all logs. The loopback preview at port 55210 was restarted on this source. The change was not installed into official Desktop, and nothing was merged or released.
