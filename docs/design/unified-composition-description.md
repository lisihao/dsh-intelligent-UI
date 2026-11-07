# Unified composition description (proposal, 2026-11-07)

Status: proposal. Steps 1 and 2 are implemented ([step 1 record](../acceptance/2026-11-07-shared-option-guidance.md), [step 2 record](../acceptance/2026-11-07-block-outline.md)); steps 3 and 4 are not. The measurements below ran locally and called no model.

## Owner's question

The owner proposed that the compile stage should describe the whole document — its content, how each part can render, and how the parts can be arranged — and that Jev should then make one orchestration decision from that description, instead of several separate ones.

## Current pipeline (read from code at `c2e8f4a`)

`src/index.ts` always passes `getExecutableComponents` to `AdaptiveCompositionCoordinator`. With `adaptive.blockLayout` on, one document therefore takes three `judgeOnce` calls, in sequence:

| Call | Request state | Questions | Decides |
|---|---|---|---|
| 1 frame (`host.ts` `runDecision`, `frameDecisionBundle`) | Complete source text, design rubric, capabilities, and a flat list of block references (id, path, kind, range, evidence) | Theme, layout, inspection, and one `component-set` (material) question per block. Each block's presentation is fixed to `reading` and is not sent. | Document frame and per-block material |
| 2 family (`component-decision.ts` `decideExecutableComponentsBatch`) | Every block's source value and recipe evidence, the design rubric, and a shared component catalog | One question per block | Component family per block |
| 3 component | Same as call 2 | One question per block, limited to the chosen family | Component per block |

Observed gaps:

- **Calls 2 and 3 do not see the result of call 1.** `runComponentDecision` builds their state from `blocks` and `designRubric` only. The chosen theme and layout are merged by the Host afterwards.
- **The stages can override each other.** When call 3 picks a curated component, `runComponentDecision` replaces the block's call-1 material with the curated component's own `componentSet`.
- **No content outline exists** (step 2 adds one). `compileBlockLayout` returns a flat block list. It has no heading tree, no section membership, and no block-to-block relations.
- **Text is repeated.** Call 1 sends the complete source. Calls 2 and 3 each send every block's value again. In the five documents below, the JSON size of the block values is 100.6%–101.9% of the source size.
- **Documentation mismatch.** `docs/design/experimental-block-layout.md` says the pipeline sends "one scoped Jev Decisions request" and that "the authoritative question list is sent once". With executable components, which production always supplies, it makes three requests.

The same compiler also feeds DIL generation. In the five-document DIL run (2026-11-06), the blocks given to the development DIL path (`tools/dil-live`) were taken from the composition candidate bundle, and their ids and ranges equal `compileBlockLayout` output exactly. That path made one model call per document (plus two repair calls), and the call returned components and a program for every block, with an optional theme. It is a development tool, not the production chat path.

## Measurements (run)

Inputs: the five private review documents (md-1 … md-5, 262 blocks). The probes ran on `c2e8f4a` plus this document, and earlier on `bfe59ee`; both runs wrote identical receipts. Probes and receipts are under `.acceptance/claude-unified-description-20261107/` (not in Git). Model calls: 0.

### Candidates per block

The probe runs the same `compileBlockLayout`, `buildCompositionCandidates` and `createSourceBlockComponentRegistry().audit()` calls that the Coordinator runs before Jev.

The registry has 102 components in 8 families. Every block had candidates in exactly 3 families (`native-content`, `source-composition`, `curated-card`). No block was unreachable.

| Configuration | Eligible per block, p50 | Eligible per block, max | Blocks over 100 options |
|---|---|---|---|
| WebGL, motion allowed, automatic style | 12–13 | 32 | 0 |
| Same, plus WebGPU | 12–13 | 32 | 0 |
| Reduced motion | 12 | 17 | 0 |
| No WebGL | 12 | 17 | 0 |
| Selected style mode | 12–13 | 32 | 0 |

So for these five documents, each block's complete legal list fits in one question under the current 100-option limit (`DEFAULT_MAX_COMPONENT_OPTIONS_PER_QUESTION`), with nothing dropped. This does not remove the need for the two-stage path: the registry itself (102) is already above the limit, so a future block or source shape can exceed it.

### Bytes handed to `judgeOnce`

A recording port answered the first legal option of every question, so the real Coordinator ran all three calls. Sizes are the JSON bytes of `state` and `questions` handed to `judgeOnce`, not provider tokens.

| Document | Source | Call 1 state + questions | Call 2 | Call 3 | Total | Total / source |
|---|---|---|---|---|---|---|
| md-1 | 9,235 | 25,290 + 235,448 | 71,784 + 53,530 | 71,898 + 56,897 | 514,847 | 55.7× |
| md-2 | 75,203 | 117,751 + 635,964 | 240,286 + 151,931 | 240,604 + 161,486 | 1,548,022 | 20.6× |
| md-3 | 57,137 | 70,192 + 193,064 | 145,836 + 44,848 | 145,932 + 47,669 | 647,541 | 11.3× |
| md-4 | 76,498 | 94,685 + 244,679 | 141,225 + 54,977 | 141,342 + 58,435 | 735,343 | 9.6× |
| md-5 | 41,708 | 64,287 + 321,743 | 118,430 + 73,788 | 118,586 + 78,429 | 775,263 | 18.6× |

The largest single item is call 1's per-block material questions: 218,539 of 235,448 question bytes for md-1, and 618,987 of 635,964 for md-2. Each is about 6 KB. In every document:
- at least 959 of about 1,130–1,180 prompt characters are the same in every block's question;
- at least 1,006–1,038 of about 1,070–1,160 characters of each option description are the same in every block's question.

These are common prefix plus suffix, so they are lower bounds on the shared text. Calls 2 and 3 already send component metadata once, through `DecisionCatalogBuilder` (`sharedCatalog`), and reference it from each question. Call 1 has no such sharing.

The call-1 state contained the complete source in all five documents.

## Proposal

### One description, three layers

The compiler and planner produce one versioned, deterministic description per source revision. The model never fills it. Everything in it is model-visible and therefore recorded in the session log.

- **Content.** Heading tree; each block's section, kind, size and source range; explicit relations the analyzer can prove (a table and the prose that names it, a code block and its caption, a list and its lead sentence). Each role or relation carries its compiler evidence. Roles without evidence are not added.
- **Rendering.** Each block's complete legal candidate list with eligibility evidence (the existing registry audit), plus the device and streaming capabilities. Component metadata appears once in a shared catalog; blocks reference it by id.
- **Orchestration.** Document-level choices (theme, layout, inspection) and declared cross-block guidance, for example "blocks of the same kind in one section should use the same treatment". Guidance is advice in the rubric; it is not a validation rule that rejects an otherwise legal answer.

Two consumers read it:
- Jev composition, through the request described below.
- DIL generation, which today builds its own block list from the candidate bundle (`tools/dil-live/prompt.ts`).

### Steps

1. **Share call-1 option text (implemented).** Option-description fields that are identical in every block question of a field go once into the call-1 state; each option keeps a reference and its block-specific fields. Prompts, including their constraints, stay in every question, because Jev sends state through the same input channel as the untrusted source text. This changes the request layout: the model receives the shared guidance once instead of once per block. Whether its choices change is unverified. Measured on the five documents: the call-1 request is 38–49% smaller and the three-call total 16–25% smaller.
2. **Add the content layer (implemented in part).** A versioned `block-outline@1` outline, built from the compiler's own source paths, describes the top-level Markdown heading tree and each block's innermost section. All three requests carry it, so it is sent three times (2–36 KB per document in the five measured). Not done: relations between blocks; documents that mark sections with bold paragraphs instead of headings (md-3's outline is empty); and the DIL generation path, which does not read the outline yet.
3. **One call when every block fits.** When each block's complete legal list fits within the option limit, send one request: document questions, one material question per block, and one flat component question per block. The two-stage family/component path stays for any block whose list does not fit. The existing rule stays: no legal component is dropped to a top-K list.
4. **Compare quality (needs approval).** Run the same documents through the three-call and one-call paths with a real model, and compare the choices. This costs paid model calls and needs the owner's approval first.

Rough size for step 3, md-2 (estimate, not measured): 105 blocks × 13.5 legal options on average = 1,413 options. Call 3 used about 513 question bytes per option, but only for curated-card members, because the probe always took the first family. That figure also spreads each question's prompt over only 3 options; with about 13.5 options per question the prompt share per option is smaller, while other families' metadata may be larger or smaller. The direction of the error is unknown. That gives about 725 KB of component questions. Add one block-value state of about 240 KB (call 2's state, which already includes the shared catalog), the shared material questions, and the document questions. The total is about 1.0–1.1 MB, against 1.55 MB before step 1. This estimate predates steps 1 and 2; with both, md-2's three-call total is 1.25 MB, including the outline. The estimate assumes the complete source is not sent a second time beside the block values.

## Constraints kept

- Eligibility stays compiler- and runtime-owned. The model chooses only listed ids.
- Missing or invalid answers remain errors; there is no heuristic fallback that pretends to be a model choice.
- The description and the request carry a format version. A reader refuses an unknown version with a named error.
- Stale-source and changed-settings rejection stay as they are.

## Not measured or unknown

- Short chat replies were not measured. Three serial calls likely cost the most latency there, relative to their size; that is unverified.
- All five documents came from one session and are long (9–76 KB). Other documents may have more candidates per block.
- Whether a single large request gives choices as good as three smaller ones is unknown until step 4.
- The real size of step 3's request, and the size of non-curated component metadata, are unknown until it is built.
- Provider-side token counts were not measured; only bytes handed to `judgeOnce`.
- Only built-in themes were used. The theme question (about 13.8 KB for md-1) grows with each installed theme.
- The installed Desktop was not used.
