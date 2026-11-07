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
