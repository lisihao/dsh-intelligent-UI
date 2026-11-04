# Model center integration

The owner approved the three-tab model-center design on 2026-11-04 after reviewing the standalone HTML preview. The delivery is a plugin feature on the MacBook, with the official App unchanged and existing credentials, configuration, sessions and billing history retained. Tailscale and the independent resident daemon remain running.

## Acceptance and ownership

The normal Settings path exposes one model center with Accounts/connections, Models/capabilities and Usage/costs. It reads authoritative source data instead of embedding the former full pages. Provider/model identity retains its source route and account scope. Monetary estimates, provider balances and subscription windows remain distinct. Missing facts remain unavailable rather than zero or configured. Every source failure has an explicit retry path. Existing advanced/original settings remain reachable; their owner continues to perform login and provider-specific operations.

The affected scope is `src/model-center*.ts`, the settings navigation adapter, its client registration, focused tests, build/plugin fixtures and this feature's documentation. No official App, installed profile or upstream file is edited during development. Installation follows a recoverable backup and a verified fixed artifact.

## Pinned integration evidence

- Official npm baseline: DSH 0.2.1-rc.2, Cordis 4.0.5; use public `session.modelCatalog`, the `llm` provider directory, credential-status metadata and shared `ConfigForms`/settings schema contracts.
- Existing unmodified dsh-cost-meter 1.9.11 (MIT, Han-1413141/dsh-cost-meter): consume `costMeter.getLocalState` for cached ledger/status; no automatic price refresh, repricing, history import/reset or cost-meter quota refresh. Whitelist only necessary output facts.
- Existing unmodified dsh-deepseek-web-login 1.0.3 (Apache-2.0, cv-superding/dsh-deepseek-web-login): consume only `/deepseek-web-login/api/status?light=1`, `/accounts`, `/models` for the initial read surface. Never forward raw status/config/guest data, export/session routes, tokens, cookies or localStorage. Full status and test routes are not summary reads.
- Existing owner-maintained Codex/Grok packages retain authentication and account storage. Models come from the host's registered route directory; account status must use confirmed source APIs rather than infer authentication from route existence.

These runtime plugins are optional capabilities already installed on the target machine; they are not copied, patched or installed by this integration. No new Python runtime, binary or model file is introduced. Source/API compatibility failures remain visible.

## Boundaries

The center does not create another credential store, model catalog, billing ledger or history migration. Model edits use the existing owner namespace with revision fencing and field-scoped operations only. Provider-specific sign-in, secret entry and advanced operations continue through an existing owner UI unless a public cooperative form interface is confirmed. No private component invocation, upstream slot ownership claim or runtime module patch is allowed. A requested operation without a safe public write seam must be identified explicitly rather than simulated.

The feature adds no automatic model calls. Tests use injected source fixtures and disposable homes. Real MacBook acceptance exercises data loading, source identity, all three tabs, original settings navigation, error handling, disable/unload restoration and configuration/data preservation. It must distinguish source tests, exact package tests and live App observations.

## Implemented projection and writes

- Accounts: use provider configuration only to locate credential references, then call the official metadata-only `credentials.describe`; API configuration does not imply a successful network connection. Codex/Grok and web account summaries replace route placeholders without merging separately saved accounts. No private credential value is stored or displayed.
- Models: the host catalog owns availability. Explicit web metadata can fill missing capability fields on the matching web route only. Equal IDs on different routes remain distinct. Unknown context/output limits are not guessed. Existing raw `llm-deepseek.models` and `llm-pi-ai.providers.<provider>.models` entries may expose context/output editing, guarded by schema, ID, exact path and expected revision; inherited/unsupported fields retain original management.
- Usage: the center shows today's API estimate, source-returned official balance, subscription windows and the existing budget. Full billing history, price tables and advanced budget controls remain in the original fees page. Plan equivalent value is never added to the displayed API charge. A normal Codex metadata read can use the owner's TTL and upstream metadata service; it is not a forced refresh or model call. Unavailable sources report a named user-facing error after at most 15 seconds; retry is explicit.
- Budget: only the amount is passed to the owner's documented deep merge. Currency, period, enabled state, account records and ledger are preserved. Editing the amount never enables a disabled budget.

## Verification record

Focused adapter/view/store/navigation tests and a real Chromium replay cover source qualification, credential-field exclusion, field-scoped model saves, stale revisions, zero/over-quota values, partial failures, explicit recovery and original navigation. The replay uses all public adapter/runtime code and registered slot components at 1280, 980 and 500 pixels; no actual accounts or model requests are used. The repository gate, exact packed install and live MacBook observations are recorded separately at delivery; they must not be inferred from this replay.

### Native acceptance follow-up

The first live inspection found defects absent from the initial replay: Cordis supplies `remote.llm`, `remote.session`, `remote.credentials` and optional `remote.costMeter` as independent service namespaces, not fields on `ctx.get('remote')`; account details were incorrectly nested inside the list; Grok exposes ISO-string expiry metadata. The replay now uses flat service lookup with no root facade and asserts that details are a direct sibling of the list. The production adapter injects required namespaces, resolves the optional fees namespace dynamically and ignores unused expiry metadata rather than rejecting it. Focused regression checks cover all three causes. The corrected fixed package passed [MacBook acceptance](../acceptance/2026-11-04-model-center.md); that record separates native checks from model-write/inference behavior that was not run.
