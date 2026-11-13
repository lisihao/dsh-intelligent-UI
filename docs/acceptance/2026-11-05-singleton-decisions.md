# Decisions singleton-choice compatibility — 2026-11-05

## Observed failure and scope

An authorized live UI review reached the saved OpenAI Decisions route with ordinary Markdown content that had no eligible chart. The planner correctly offered only `chart: auto`, but the coordinator incorrectly serialized that fixed dimension as a model choice question. The provider returned HTTP 400, `invalid_request_error`, code `array_below_min_length`, naming `questions[2].choices`: a choice requires at least two options. A document with several genuine chart options succeeded through the same connection.

This failure was missing from the previous synthetic-port acceptance. It is a consumer request-shape defect, not evidence that these documents need invented charts or another model/endpoint.

## Correction

The complete source-bound candidate bundle remains in the logged state. Dimensions with one legal option are resolved locally. Only questions with at least two options are sent to Jev. Response validation accepts exactly that requested set, restores fixed local answers and validates the complete composition before adoption. Extra answers for a fixed/not-requested dimension are refused. No fake second option, source rewrite, provider configuration change or Jev implementation patch is introduced.

The built-package Host and real-browser synthetic ports enforce the same minimum-two-option condition, so this class of request cannot pass those gates again.

## Verification

`pnpm check` passed after the correction: build, typecheck, 93 test files, 1,076 tests passed and 3 skipped, plus built-package scratch Host checks. The Host fixture now rejects any request question with fewer than two options. `node tools/test-adaptive-browser.mjs` passed all nine source/rendering scenarios and nine observed mounts.

The four authorized live-file requests rejected by the old request shape were each explicitly submitted once after the fix; all returned HTTP 200 with validated choices. The original successful file result was retained and not resent. This private review therefore has five valid model selections and four retained protocol-rejection records, not five total network attempts. No automatic retry or provider/model change occurred. Private Markdown content, credentials, provider response bodies and runtime receipts remain outside Git.

The live reviewer distinguishes the final composition from model-decided dimensions and locally fixed dimensions. Layout explanations derived from source structure/component eligibility are labeled as interpretations, not as the model's words or a correctness guarantee. Native Desktop installation remains separate.
