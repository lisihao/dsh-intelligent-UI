# DIL form submit reads the latest Worker tree

## Defect

`node tools/browser-dil/acceptance.mjs` failed intermittently at the select-then-submit step. The submitted record carried `state.tier: 'pro'` but `fields.tier: 'standard'`. On this MacBook (macOS, Node v26.7.0, headless Chrome through the design-taste CDP helper), unmodified `0787045` failed 2 of 3 runs before any change.

## Cause, as observed

Observed in Chrome with temporary trace instrumentation (reverted, not committed): a failing run's order was the trigger for `pro`, the `pro` tree snapshot passed to `setTree`, the submit, then the captured state. The `<select>` still read `standard` both before and after `flushSync(() => setState(next))`.

Explanation from reading React 18.3.1's `react-dom` development build, not observed directly: `getEventPriority('message')` gives default priority under normal scheduler priority, and `performSyncWorkOnRoot` renders only the sync lane, so the earlier `flushSync` skipped the pending tree update. Whether React's scheduled render ran before the state reply would then decide the outcome.

## Fix

`DilProgramView` records the latest received tree. The submit path applies that tree again inside `flushSync`, together with the captured state, before it reads the controlled form fields.

## Test

`tests/dil-view.test.ts`, "submits fields from a snapshot whose commit is still pending when captureState resolves", delivers the updated tree and the state reply while `window.event` reads as a `MessageEvent`. Without that stub, jsdom committed the tree within a microtask after the dispatched submit, so the test passed on the unfixed code. The cause of that jsdom behaviour was not determined. In a bare jsdom probe without React, `window.event` read `undefined` after a dispatched submit and click; inside the view test it read as an object (type not logged).

- Red on `0787045` with only the test applied (clean `src/dil/view.ts`): 3 of 3 runs failed with the stale fields (`mode: 'a'`, `count: '2'`).
- Green with the fix.
- Mutation checks: removing the tree re-apply from `flushSync` turns the test red, and so does not recording the latest tree in the ref.

## Checks

| Check | Status | Result |
| --- | --- | --- |
| `pnpm exec vitest run` | run | 159 files passed, 1 skipped; 1530 tests passed, 5 skipped. A first run before `pnpm build` failed three uiverse files that need the built `lib/`; they passed after the build. |
| `pnpm typecheck` | run | passed |
| `pnpm build` | run | passed |
| `pnpm test:plugin` | run | passed, `liveModels: 0` |
| Browser acceptance with the fix | run | 10 of 10 consecutive runs passed, each printing the `DIL_BROWSER_RECEIPT` line (baseline on `0787045`, same machine: 2 of 3 failed). |
| Installed official Desktop app | not run | Not requested; no install was authorized. |

No model calls were made. Logs stay in the ignored `.acceptance/dil-submit-race/` directory.
