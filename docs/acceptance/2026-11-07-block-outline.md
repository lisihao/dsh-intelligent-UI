# Block outline in composition requests (2026-11-07)

Step 2 of [the unified composition description](../design/unified-composition-description.md). It builds on [shared option guidance](2026-11-07-shared-option-guidance.md).

## Problem

`compileBlockLayout` returned a flat block list. The model saw block kinds and ranges, but no heading tree and no record of which block belongs to which section.

## Change

- **New module.** `src/adaptive-ui/block-outline.ts` adds `outlineBlockLayout(value, compilation)`, which returns a `block-outline@1` outline.
  - **Sections.** One for each top-level Markdown heading, ATX or setext. Each section has a depth, a plain-text title, a UTF-16 range, a parent id and evidence. A section runs from its heading to the next heading of the same or a higher level.
  - **Titles.** A title over 200 characters is shortened and marked `titleTruncated: true`.
  - **Blocks.** Each compiled block gets the innermost section that contains its first character. A block before the first heading, or a structured value, gets `null`.
  - **Not sections.** Headings nested inside lists or quotes are excluded.
  - **Limit.** Above 512 sections, the outline is marked `complete: false` with `BLOCK_OUTLINE_SECTION_LIMIT_EXCEEDED` and the section count, instead of being cut silently.
- **Compiler.** `block-compiler.ts` exports `blockLayoutMarkdownLeaves`, so the outline reads the same source paths as the compiler. The compiler output itself is unchanged.
- **Frame request.** The outline goes into `composition.blockLayout.outline`. Its input format is now `block-design-context@4`.
- **Component family and component requests.** The outline also goes into their Host-built input, which now carries `inputFormat: 'source-block-component-context@1'`. Before this change, that input had no format field.
- **Out of scope.** No relations between blocks are added. Nothing is inferred from wording.

## Verification

All checks ran on this MacBook. No model was called.

- **Unit tests (run).** `tests/block-outline.test.ts` has 5 cases:
  - the heading tree, ranges, parents and the innermost section of each block;
  - top-level headings only, plain text from inline markup and HTML, two-line setext titles, and no section before the first heading;
  - shortened titles;
  - separate tool-text paths, and structured values;
  - the section limit.
- **Host tests (run).** `tests/adaptive-host.test.ts` asserts the outline in the frame request and in both later requests. With `host.ts` from step 1, 3 cases failed and 26 passed. That run was on the step 1 commit before it was rebased onto the design document; its `src` and `tests` are identical to `1003f66`.
- **Mutation check (run).** Each change below, made on its own, made at least one test fail:
  - the parent rule;
  - the section end rule;
  - the innermost-section rule;
  - the truncation flag;
  - the same-path check;
  - the section limit;
  - HTML exclusion from titles;
  - whitespace normalization of titles;
  - the outline in the frame request;
  - the outline in the component requests.
- **Full suite (run).** 1540 passed and 5 skipped. `pnpm typecheck`, `pnpm build` and `pnpm test:plugin` passed (`scratchRemoved: true`, `liveModels: 0`).
- **Five review documents (run).** Every document still ended `selected`, after 3 calls, with the first-option port. Request bytes are the sum of all three requests.

| Document | Sections (depth 1/2/3) | Blocks without a section | Outline bytes | Total request bytes: base → step 1 → step 2 |
|---|---|---|---|---|
| md-1 | 25 (1/12/12) | 0 of 37 | 8,181 | 514,847 → 387,769 → 412,443 |
| md-2 | 73 (1/13/59) | 0 of 105 | 23,538 | 1,548,022 → 1,179,476 → 1,250,221 |
| md-3 | 0 | 31 of 31 | 1,905 | 647,541 → 541,769 → 547,615 |
| md-4 | 139 (26/106/7) | 0 of 38 | 35,590 | 735,343 → 604,714 → 711,615 |
| md-5 | 46 (2/16/28) | 0 of 51 | 15,610 | 775,263 → 598,471 → 645,432 |

The outline is sent three times, once in each request, so each document's total grows by about three outline sizes. After both steps, the totals are 3%–20% below the base.

## Known limits

- **Bold-paragraph headings.** md-3 has no Markdown headings. It uses 18 paragraphs that contain only bold text as headings, 15 of them numbered. Its outline was therefore empty; the follow-up below addresses it.
- **Model quality not measured.** Whether the outline improves choices needs a real-model run, which needs paid calls and the owner's approval.
- **Not run.** A browser check (no rendered output changes) and the installed Desktop.

Probe receipts are under `.acceptance/claude-unified-description-20261107/` (not in Git).

## Follow-up: numbered bold paragraphs (`block-outline@2`)

After the owner answered "合并，执行，你干" to a list that included this option, this change reuses the existing recognizer. `isStandaloneNumberedBoldHeading` in `src/content-analysis.ts` is now exported. It accepts a paragraph whose only child is bold text, with a numeric prefix, and whose title does not refer to table data. Before this change it was used only for table-note context.

- **Sections.** Each top-level paragraph that the recognizer accepts becomes a section with evidence `source:numbered-bold-paragraph`.
- **Depth.** The source gives no level, so the depth is derived: one level below the nearest open Markdown heading, or 1 when there is none. The evidence records this as `depth:derived-from-enclosing-heading`.
- **Section end.** Such a section ends at the next bold section or at the next Markdown heading of the same or a higher level.
- **Unchanged.** Compiler block grouping.

Verification (MacBook, no model calls):
- **Tests (run).** 2 new cases:
  - a document without Markdown headings, including an unnumbered bold line and a table-note title, neither of which becomes a section;
  - bold sections mixed with Markdown headings.

  Both failed on `ede4441`.
- **Mutation check (run).** Each of these, changed on its own, failed a test:
  - recognition;
  - the depth rule;
  - closing sibling bold sections;
  - the table-note and unnumbered exclusions;
  - the derived-depth evidence.
- **Full suite (run).** 1557 passed, 5 skipped. `pnpm typecheck`, `pnpm build` and `pnpm test:plugin` passed.
- **Recognizer matches in the five documents (run).** 15 in md-3, 0 in the others, so their outlines are unchanged.

| Document | Sections | Blocks without a section | Blocks containing more than one section start | Outline bytes |
|---|---|---|---|---|
| md-3 | 15 (all depth 1) | 1 of 31 (before the first bold heading) | 0 | 6,293 |
| md-4 | 139 (unchanged) | 0 of 38 | 26 | 35,590 |

md-4's 26 blocks predate this change. All 32 of md-4's prose blocks carry `grouping:heading-depth:1`, while the document has 106 depth-2 and 7 depth-3 headings, so one block can contain several sections. The outline records only the section at each block's start.

## Outline removed from the frame request (2026-11-07)

**Why.** Live runs with `gpt-6-luna` compared base (`c2e8f4a`) with base plus the outline. In those runs, the frame request's outline lowered md-1's soft-relief material choices from 25 of 111 to 7 of 111. The details are in the [shared-guidance record](2026-11-07-shared-option-guidance.md). The frame request no longer carries the outline (`block-design-context@6`); the component requests still do.

**Offline check (run).** For md-1 and md-3, the new frame request is byte-identical to base's except the `inputFormat` string.

**Live check (run).** Base against this layout, interleaved in one session, md-1 and md-3, 3 repeats each. 36 requests, all HTTP 200, 1,740,692 input tokens. Every run ended `selected`. The rule, fixed before the run: soft-relief share of at least half of base's share in the same session, and above 5%.

| Document | soft-relief, base | soft-relief, this layout | Rule |
|---|---|---|---|
| md-1 | 24 of 111 | 28 of 111 | passed |
| md-3 | 18 of 93 | 30 of 93 | passed |

**Tokens.** The frame call matches base (md-1 about 56,580, md-3 about 60,075). A whole composition costs about 4% (md-1) and 2% (md-3) more than base, because the outline goes into calls 2 and 3.

**Component choices.** No component-choice effect of the outline was measured. Its component-stage differences in earlier runs were within run-to-run variation.
