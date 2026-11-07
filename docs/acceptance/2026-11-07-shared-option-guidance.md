# Shared option guidance in the frame request (2026-11-07)

Step 1 of [the unified composition description](../design/unified-composition-description.md).

## Problem

With block layout on, the first Jev request (the frame request) carries one material (`component-set`) question per block. Each question was about 6 KB. Most of each option description was the same in every block. For md-2 (105 blocks), these questions were 619 KB of the frame request's 636 KB of questions.

## Change

- `src/adaptive-ui/question-sharing.ts` groups block-scoped questions by `prompt.field`. For each option id that appears in at least two of them, it collects the description fields that are identical in every occurrence. It then sends them once, in `composition.sharedOptionGuidance` (`shared-option-guidance@1`), with a note saying how the reference is merged.
- Each such option keeps `guidanceRef` and the fields that differ between blocks (for example eligibility evidence). A rewritten description is never empty.
- Prompts, including their constraints, stay in every question. Jev sends `state` through the same input channel as the untrusted source text. Task rules therefore stay in the instructions channel, and only descriptive guidance moves to state. This follows the existing `designRubricRef` pattern.
- Rewritten prompts gain `optionGuidanceRef: 'composition.sharedOptionGuidance'`.
- Fields or option ids that do not match `^[a-z][a-z0-9-]{0,63}$` are not shared, so every reference is a plain dotted path. A field whose descriptions already use `guidanceRef` is not shared either.
- Only the block-layout request uses this. The legacy whole-output request is unchanged, and so are the component family and component requests (calls 2 and 3).
- `BLOCK_DESIGN_CONTEXT_INPUT_FORMAT` is now `block-design-context@3`.
- Answer validation is unchanged: answers are still checked against the Host's own candidate bundle, not against the sent questions.

The local Jev source (`community/deepseek-harness-jev/ledger-latency`, not a Git checkout) accepts JSON object descriptions and creates a new operation for every `judgeOnce` call. In that copy, no result is reused by `link.inputVersion`. Which Jev version the installed app uses is unknown.

## Verification

All checks ran on this MacBook. No model was called.

- **Unit tests (run).** `tests/question-sharing.test.ts` has 5 cases:
  - sharing equal fields and keeping block fields;
  - a field that differs in one block stays per block;
  - no empty descriptions;
  - root questions, and options seen once, stay unchanged;
  - identifiers that cannot form a dotted path, and pre-existing `guidanceRef`, disable sharing.

  Each case expands the sent questions back with a test-only helper and compares them exactly with the originals.
- **Host tests (run).** In `tests/adaptive-host.test.ts`, two existing cases now compare the expanded sent questions with the planner's questions. A new case covers the executable-component path in automatic and selected style mode. With `host.ts` from `c2e8f4a`, these 3 cases failed and the other 26 passed.
- **Mutation check (run).** Each of these, removed on its own, made at least one test fail:
  - equal-only sharing;
  - the reference in rewritten descriptions;
  - the option id check and the field check;
  - the pre-existing reference check;
  - the block-scope check;
  - the seen-once check;
  - the shared state section.

  A separate "at least two questions per field" check survived; it was redundant with the seen-once check, so it was removed.
- **Full suite (run).** 1535 passed and 5 skipped. `pnpm typecheck`, `pnpm build` and `pnpm test:plugin` passed (`scratchRemoved: true`, `liveModels: 0`).
- **Request bytes (run).** The local `rounds` probe drove the real Coordinator over the five review documents with a port that answers the first legal option. "Frame" is the frame request's state plus questions; "total" is all three requests. Every document still ended `selected`, after 3 calls. Calls 2 and 3 were byte-identical to before.

| Document | Frame before → after | Total before → after |
|---|---|---|
| md-1 | 260,738 → 133,660 (−49%) | 514,847 → 387,769 (−25%) |
| md-2 | 753,715 → 385,169 (−49%) | 1,548,022 → 1,179,476 (−24%) |
| md-3 | 263,256 → 157,484 (−40%) | 647,541 → 541,769 (−16%) |
| md-4 | 339,364 → 208,735 (−38%) | 735,343 → 604,714 (−18%) |
| md-5 | 386,030 → 209,238 (−46%) | 775,263 → 598,471 (−23%) |

- **Not run.**
  - A real model call, so whether choices change with the new layout is unverified. That needs paid calls and the owner's approval.
  - A browser check: this change has no rendered output.
  - The installed Desktop.

Probe receipts are under `.acceptance/claude-unified-description-20261107/` (not in Git).

## Reverted after live runs (2026-11-07)

The verification above did not run a model. Afterwards, live runs used the saved Jev route: `luna-openai`, returned model `gpt-6-luna`, `https://api.openai.com/v1/decisions`.

- **Setup.** md-1 and md-3, 3 repeats per layout, automatic style, built-in themes, `webgl: true`.
- **Layouts.**
  - base: `c2e8f4a`, before this change;
  - step 1 alone: `1003f66`;
  - current: `666a044`, step 1 plus the outline;
  - a variant (not merged) that kept `material` and `visualCharacteristics` beside each option.
- **Result.** Every run ended `selected`.

| Layout | soft-relief block choices, md-1 | soft-relief block choices, md-3 |
|---|---|---|
| base, first session | 22 of 111 | 21 of 93 |
| step 1 alone | 1 of 111 | 5 of 93 |
| current | 0 of 111 | 0 of 93 |
| base, interleaved session | 25 of 111 | 15 of 62 (2 repeats; one request returned HTTP 503) |
| per-option variant, interleaved session | 0 of 111 | 0 of 93 |

- **Where the shift came from.** It appeared with step 1 alone, and the per-option variant did not bring it back.
- **Wire format.** On this route, `state` is sent as one `input` text and each choice's description as separate text. So after step 1, each choice carried only its reference and its block evidence. Whether the service follows the reference is unknown.
- **Component choices.** They differed between runs. Calls 2 and 3 were byte-identical between the current and per-option layouts, so those differences are run-to-run variation, not an effect of this change.
- **Not measured.** Whether the shift is better or worse as a design is a judgment, and it was not assessed.
- **Tokens.** Step 1 made the frame call about 36% (md-1) and 29% (md-3) smaller in input tokens. A whole three-call composition was 8–13% smaller.

The sharing is reverted on `claude/revert-shared-guidance-20261107`, which leaves every option with its complete description. The outline (`block-outline@2`) stays. The frame request's input format is now `block-design-context@5`.

### Revert check (live, interleaved)

- **Run.** Base (`c2e8f4a`) against the revert (this branch: base plus the outline), interleaved in one session. md-1 and md-3, 3 repeats each, 36 requests, all HTTP 200, 1,754,105 input tokens. Every run ended `selected`.
- **Pass rule, fixed before the run.** For each document, the revert's soft-relief share must be at least half of base's share in the same session, and above 5%.

| Document | soft-relief, base | soft-relief, revert | Rule |
|---|---|---|---|
| md-1 | 25 of 111 (22.5%) | 7 of 111 (6.3%) | failed (needs ≥ 11.3%) |
| md-3 | 28 of 93 (30.1%) | 25 of 93 (26.9%) | passed |

- **md-1.** The rule failed, so the outline alone also moves md-1's material choices away from soft-relief, though less than the sharing did. On md-1, sharing alone gave 1 of 111 and sharing plus the outline gave 0.
- **Tokens.** The revert's frame call carries the full option descriptions plus the outline. It used about 59,030 input tokens on md-1 and 61,840 on md-3, against base's 56,580 and 60,070.
