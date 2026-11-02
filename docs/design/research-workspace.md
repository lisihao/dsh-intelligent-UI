# Session research workspace

## Approved product boundary

The owner approved the report/inspector/comparison design and six initial components: core judgments, conditions, source evidence inspection, technical comparison, alternative/challenging material and an open-question queue. The workspace belongs to the current conversation and report. It does not add a global research database or change host navigation. Additional cross-report version, relationship and scenario components remain future design work.

An explicit user action may request AI organization through the normal visible current-session queue and its selected model. No provider, model, effort, permission or tool configuration is changed. The action discloses potential model charges and is confirmed inline. The prompt requests organization of supplied report text only; this is a normal session request subject to the host's existing tool policy, not a separately isolated execution environment. No external model calls are made by opening, filtering, copying or reading the workspace. Follow-up research produces an editable, copy-only draft and never sends automatically.

## Interaction and visual contract

One conversation-level research toggle joins the existing shared display and transparency controls. Ordinary content stays mounted in its original source-preserving renderer. Research mode adds report, judgments, sources and technical comparison tabs. It retains the selected Empryo/Paper/theme token system and compiled Uiverse controls. At 1000px of available content width and above, the report shares its layout with a 360px inspector. Below that width, the inspector becomes a focus-trapped dialog; Escape or closing returns focus to its source control. The wide inspector returns focus through its explicit close action. The narrow dialog uses an opaque local surface derived from the selected background, without changing report transparency. Raw/comparison display remains the original unified control.

Report citations and table cells open their exact source span. Judgment/evidence selections return to tagged Markdown source blocks without changing report text. Navigation opens containing disclosures and briefly highlights the matching rendered block. When only a table-level marker exists, it opens the complete original table and explicitly reports that the location covers the table rather than an individual row. A missing rendered marker leaves the exact snapshot excerpt visible with a location warning. A URL in a report is labelled a report reference, not a fetched or verified external source. Conditions remain alongside judgments. Support/challenge/limitation relationships are AI-supplied, visibly unreviewed and distinct from the human owner's review status. Missing information is not guessed.

Original tables retain all rows, columns, exact cell text and nearby context. Existing bounded chart eligibility is reused; a numeric table alone does not establish comparable workloads. Only existing eligible comparison plans are plotted. No unsupported causal edges, confidence probabilities or statistical significance labels are generated.

## Data and public interfaces

A separate `solarResearch` service and `solar_research_submit` tool are owned by this same UI package. Document identity comprises session identity, source document identity and report SHA-256. Exact report snapshots, structured analysis and human notes/review/question state are stored under the UI plugin's own `research/` namespace. Other plugins' state remains untouched.

The version-one analysis contract contains a question and source-anchored claims (observation/inference/hypothesis), conditions, typed evidence links and open questions. Durable anchors use exact UTF-16 start/end/quote. A model can submit a verbatim quote alone; deterministic unique matching resolves the anchor. Repeated/absent quotes or wrong supplied positions fail visibly. Source URLs must be present in actual Markdown links; no external fetching or invented source snapshots occur.

Owner-only RPCs read state, prepare a request, mark submission admission and compare-and-save human notes. The model tool accepts only a pending request from its real execution session, matching immutable report identity. Atomic durable state, revision conflicts and idempotent completed receipts prevent overwriting reviews or replaying uncertain work. Unknown outcomes remain visible and never trigger an automatic new model request. All model-visible request text and submitted analysis remain in normal session/tool logs.

## Delivery and privacy

Implement only in the independent intelligent UI repository and one plugin package. Reuse React, Zod, Markdown AST, existing OpenUI charts and compiled component adapters; add no new dependency or research engine. Screenshots, model outputs, user reports and private receipts remain local and are excluded from Git/public exports. Repository acceptance records describe the observed scope without embedding screenshots.

Required acceptance covers exact anchors, unsafe/missing links, ambiguous quotes, session/owner boundaries, CAS and restart persistence, uncertain admission, UI focus/keyboard/narrow layout, original text and table preservation, on-demand submission, lifecycle restoration, and a built-package scratch DSH Agent executing the result tool. Formal Desktop installation is delegated to the centralized installer after a stable archive and SHA-256 are supplied. Native acceptance and real-model behavior must be reported separately from deterministic local fixtures.
