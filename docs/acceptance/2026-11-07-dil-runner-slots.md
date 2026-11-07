# DIL runner slots and snapshot reuse (2026-11-07)

## Problem

Before this change (at `0787045`), every mounted `DilProgramView` created its own runner, which is one sandbox iframe plus its Worker. Nothing limited how many ran on a page, and a finished tree was never reused. In production, `DilArtifactView` mounts one for each `solar_present` DIL artifact (`src/dil/artifact.ts:92`). In the browser scenario below, eight DIL views on one page reached a peak of 8 sandbox iframes.

The document review tool already queued blocks and cached snapshots around `DilProgramView`, so its iframe peak was 1. That queue lived only in `tools/dil-document-review`.

## Change

- **Two pools.** The shared first-come slot pool now lives in `src/slot-pool.ts`; Canvas still uses its own 2-slot instance of it.
  - On-screen views use `DIL_RUNNER_SLOTS = 3` slots while they start, or while they settle a read-only tree.
  - Off-screen views warm up through `DIL_BACKGROUND_RUNNER_SLOTS = 1`. So when a chat opens at its latest messages, the visible pages do not wait behind the pages above them.
  - A waiting view queues by where it is now; a running view keeps the slot it got.
  - Before the first intersection report, a view counts as off screen.
  - A waiting view shows a status line, plus the program's fallback Markdown when it has one.
- **Interactive views.** A view counts as interactive once its tree has a handler or a form. It also counts as interactive when its compiled code uses `useEffect`, `setTimeout`, `setInterval` or `requestAnimationFrame`. The reference runtime runs effects after each render, and an effect may set state, so such a program can re-render with no user event; Worker timers are also reachable from the program. Both kinds of program compile with no diagnostics.
  - **On screen** (within a 200 px margin), it keeps its runner outside both pools, so a form on screen never waits.
  - **After leaving the screen**, it keeps that runner until it is parked: 1 s after leaving, or after a pending submit finishes. Leaving the screen therefore never cuts off a pending submit.
  - **Never on screen**, it parks as soon as it renders.
  - **Parked**, the last tree stays visible, and the runner restarts from the latest reported local state when the view returns.
  - **Unkeyed state.** The reference runtime reports and restores only keyed state; its source says positional slots have no stable address. So a program never parks once it has been on screen if its code has more `useState(` calls than compiled state keys, or any `useRef(`. It keeps its runner as before this change. The crowd form uses only keyed state and still parked (1 live iframe after parking), so this check does not catch keyed forms.
  - **Bound.** At most 4 iframes run in pools. Any further ones belong to interactive views that:
    - are on screen;
    - left it less than a second ago, or still have a submit pending;
    - hold unkeyed state and have been on screen. Before this change, every view kept its runner like this.
- **Read-only trees.** A read-only tree has no handler and no form.
  - **On screen**, it is final after 1 s without a new program revision. Revisions inside that second, such as a streamed preview, go to the same runner through `update()`.
  - **Off screen**, it is final as soon as it renders, but only while it is still the program the view mounted with. After a revision, as in a preview streaming while the user has scrolled up, the 1 s window applies, so the stream reuses one runner.
  - **Once final**, the runner is disposed and the tree stays on screen. The tree also goes into a 64-entry LRU, keyed by session, artifact, and a hash of the compiled code, constants, app data and state. Remounting the same program then shows the stored tree without starting a runner.
- **Failures.** A runner-level failure (start failure, watchdog timeout, quarantine, disconnect) releases the slot. A snapshot that the view rejects does not, so a later valid snapshot can still recover. A new program revision or artifact retries.
- **Diagnostics.** Each view's section carries `data-dil-runner`: `pool` (holds a pool slot), `visible` (its own runner outside the pools; this includes a form that recently left the screen and a form with unkeyed state that has been on screen), or `none`.

The pool sizes, the 1 s delay and the 64-entry cache are chosen constants, not measured optima.

## Checked and left unchanged

- **Node limits.** The protocol limit (2000 nodes) and the native view limit (512 nodes) check the same snapshot inside one callback (`src/dil/view.ts`, `onSnapshot`). The difference only changes which error is reported; it does not cause an extra run.
- **Source-code recovery.** `DIL_CODE_SOURCE_MISMATCH` in the review tool compares a program with the original Markdown code fence of a manifest block. A production DIL artifact is a program the model wrote as a whole, with no original fence, so the check does not apply to it.

## Verification

All checks below ran on this MacBook (Node v26.7.0, headless Chrome through the design-taste CDP helper). No model was called.

On the final commit itself, these ran:
- the 37 cases in `tests/dil-view.test.ts` (15 of them for runner slots), the full suite, typecheck, build and the plugin test;
- one full DIL browser acceptance, which passed every step;
- the reader matrix.

Other browser runs below came from earlier drafts of this change and are labelled as such.

### Unit tests (run)

The runner-slot cases in `tests/dil-view.test.ts` cover:
- pool limit and hand-over;
- read-only release after the idle window;
- one live runner across streamed read-only revisions;
- a visible form leaving the pool;
- an on-screen view not waiting behind off-screen ones;
- immediate off-screen read-only release;
- immediate parking of a form never on screen;
- parking after a pending submit finishes;
- failure release;
- remount reuse;
- a form that leaves the screen during a pending submit while the pool is full;
- off-screen parking with state resume;
- a program that can update itself keeping its runner, and its tree not being cached;
- a form with unkeyed state never parking once it has been on screen;
- one runner for a read-only preview that keeps streaming off screen.

Observed red runs:
- **On `0787045`:** six cases failed and the existing 22 passed. The six were pool limit, read-only release, failure release, remount reuse, off-screen parking and the first form-retention case. The form-retention case later became "a visible form leaving the pool".
- **On later drafts of this change:** three groups of cases failed.
  - The streamed-revision, visible-form and idle-window cases failed on the first draft.
  - The pending-submit case failed on the second.
  - The four on-screen-priority and parking cases failed on the third.
  - The self-updating case failed on the fourth.
  - The unkeyed-state case failed on the fifth.
  - The off-screen streaming case failed on the sixth.

All 37 cases in the file pass now, 15 of them for runner slots.

### Mutation check (run)

Reverting each of these pieces on its own made at least one case fail:
- the pool and the lane choice;
- unknown visibility counted as on screen;
- off-screen read-only release and its exception for revised programs;
- the idle window;
- the interactivity test, including self-updating programs;
- the visible-form exemption and its hold after leaving the screen;
- immediate parking, parking after a submit, and never parking with unkeyed state;
- failure release;
- the cache;
- state resume.

### Full suite (run)

1544 tests passed and 5 were skipped. `pnpm typecheck` and `pnpm build` passed. `pnpm test:plugin` passed against a scratch profile (`scratchRemoved: true`, `liveModels: 0`).

### Browser crowd scenario (run)

`exerciseCrowd` in `tools/browser-dil/acceptance.mjs` loads the fixture with `?crowd=1`. It renders eight DIL views on a 1440×900 page, four interactive forms and four read-only cards. It moves the first form's slider to 7, scrolls to the end and back, and records iframe peaks. It runs before the other acceptance steps.

- **Old `view.ts`:** the total peak was 8.
- **This change (earlier drafts and final commit):** three standalone runs and five passing full runs each recorded the values below. The final commit's run is one of the five.
  - a pooled peak of 2 and a total peak of 3;
  - 1 live iframe after parking;
  - the first form resuming with its slider at 7.

### Opening at the bottom (run)

`exerciseCrowdBottom` opens the same page scrolled to its end, the way a chat opens at its latest messages. It records the time until the last block shows its tree. Times include page load. No threshold is asserted.

| Code | Time to last block (3 standalone runs) |
|---|---|
| Old `view.ts` | 1921, 1880, 1810 ms |
| Single first-come pool (an earlier draft) | 2611, 2457, 2465 ms |
| This change (earlier drafts and final commit) | 1831, 1782, 1759 ms; 1966, 1778, 2036 and 1909 ms inside passing full runs; 1909 ms is the final commit's run |

In one more passing full run the page never scrolled down (`scrollY` 0): the fixture scrolled before the content existed. That run's 1840 ms is excluded. The fixture now waits until the page is tall before scrolling, and the check asserts that it scrolled.

### Self-updating program (run)

`exerciseTicker` opens `?ticker=1`, a program that increments its own counter from a `useEffect` interval every 250 ms. It then checks that the counter keeps advancing 3 s later, past the read-only idle window, with one live iframe.
- With the fix, it rose from 5 to 17 in the standalone run and in all four passing full runs that included this step, the final commit's run among them.
- With the detection disabled, it froze at 3.

### Reader matrix (run)

`tools/dil-document-review/review.mjs` ran on the five documents, 262 blocks at each of 1440, 768 and 390 px. Each width gave 262 ready (9 of them source-code recoveries), 0 failed, an iframe peak of 1, and 0 model calls.

### Full DIL browser acceptance (intermittent, pre-existing)

The select-then-submit step sometimes submits `tier: 'standard'` where `'pro'` is expected.

- It fails this way on unmodified `0787045`, and on `9c35ee2`, where the 2026-11-06 follow-up record reports the test passing.
- Across both versions and this change it failed 15 of 21 runs. All six passing runs were on this change.
- Once the crowd checks were moved ahead of this step, they passed in every full run on this change, including the failed ones.
- The cause was not investigated, and this change does not address it.

### Limits and not run

- **Lexical detection.** Self-updating programs and unkeyed state are detected from the compiled code text. A program that updates itself only through `Promise` or `queueMicrotask`, or reaches a timer indirectly, is not detected and can freeze off screen. A false positive only keeps a runner alive, as before this change.
- **Remount reuse** is covered only by a unit test with a mocked runner; it was not observed in a browser.
- **Not run:** the installed Desktop, and a real chat with many DIL artifacts.

Private logs are under `.acceptance/claude-dil-slots-20261107/`.
