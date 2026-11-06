# Five real documents through the conversation-model DIL lane

## Evidence boundary

The same five owner-supplied Markdown files were submitted to the configured normal conversation provider, `deepseek-official`, model `deepseek-flash` (DeepSeek-V4.1-Flash), with the saved high reasoning setting. This used the published DSH AgentLoop in a disposable profile. It did not replace the owner's active profile or invoke Jev Engineering. Private documents, sessions, raw responses, prompts and screenshots remain in the ignored acceptance directory and are not redistributed.

Seven actual model HTTP requests returned 200: five initial generations and two syntax repairs in their original sessions. One earlier local resume invocation failed before HTTP; it was corrected to the published `resumeSessionId` contract. No indeterminate remote request was replayed. Browser rendering and source-binding repair made no additional model requests.

| Document | Source blocks | Initial distinct programs | Final rendered blocks at 1440 / 390 | Model theme choice |
| --- | ---: | ---: | ---: | --- |
| MD 1 | 37 | 22 | 37 / 37 | No theme declared |
| MD 2 | 105 | 31 | 105 / 105 | Paper flow |
| MD 3 | 31 | 31 | 31 / 31 | Paper flow |
| MD 4 | 38 | 38 | 38 / 38 | Paper flow |
| MD 5 | 51 | 51 | 51 / 51 | Empryo |

The model reused some programs across explicitly bound source blocks. A manifest display default is not reported as a model theme choice. The authoring catalog for these generations contained 41 native tags. Later library bridge additions do not retroactively change that generation evidence.

## Failures found and corrected

Twenty-five generated table programs used JSX returned from `Array.map`, outside the pinned DIL compiler's supported grammar. The actual model rewrote those programs to the supported `{#each}` grammar through two same-session repairs. The unchanged choices and rationales remain attributable to their corresponding original model outputs; local code did not substitute canned programs.

A separate host binding defect included Markdown pipe delimiters and padding in table-cell ranges. Numeric conversion consequently produced `NaN` for a source cell such as `6.0`. `src/dil/source-bindings.ts` now takes the first and last phrasing-node offsets while preserving the full original source and original inline markup. Thirty-six table bindings changed; thirty generated programs read table bindings. Original file hashes remained identical. The three affected document renders were repeated with the corrected bindings; earlier failures were retained.

The final generation/binding-revision receipts cover all 262 blocks at both widths, with no recorded DIL runtime failures or page overflow. MD 3 includes a rendered chart and pie; MD 5 includes a chart. The per-block record lists the actual selected components and the model's reason, rather than an after-the-fact host explanation.

## Scope still separate

These results establish real model generation and actual isolated browser rendering of the five files. They do not establish installed official Desktop behavior, a quality improvement against another method, or real model selection of component libraries added afterward. The later embedded-Markdown surface adjustment and new external-library consumers have their own affected checks; the earlier screenshots cannot prove those newer changes.

## Embedded Markdown follow-up — run

After the external-library consumer source stabilized, the latest review fixture repeated MD 3 at 1440/390: all 31 blocks mounted with zero failures, one chart and one pie chart. The budget cell remained the complete `6.0`, with no NaN/Infinity; embedded Markdown had zero padding/border, no shadow and a transparent background. MD 2's code case retained real code/pre nodes; MD 5 retained 12 KaTeX nodes including three display formulas. MD 4 retained its source directory text and four headings. The model had selected card plus Markdown for that directory; the check did not invent a navigation component or attribute that choice to the model. No new model call was made.
