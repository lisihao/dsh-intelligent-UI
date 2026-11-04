# Model center MacBook acceptance — 2026-11-04

Implementation commit: `c4fb290` (PR #9). Official DSH 0.2.1-rc.2 was used unchanged. The installed preview package remains `0.1.0-preview.2`; this is a fixed local candidate, not a new market release.

Package SHA-256: `ffccfb1d433963f245c56bc4bf384b73c94f6117cfe3293c7cab4f365e82c810`.

## Source and artifact evidence

The earlier full repository gate passed 1043 tests with three skipped. After the native follow-up, the affected client and model-center regression suite passed 62 tests, TypeScript and the build passed, and Chromium replay passed at 1280, 980 and 500 pixels. The replay now uses flat Cordis service namespaces and checks the account detail's correct sibling position. The exact packed candidate passed the official CLI scratch-profile install/run test without model calls. All 154 installed package files matched the archive. Only this direct dependency changed among the profile's 60 direct packages.

## Installed App observations

| Check | Observed result |
| --- | --- |
| Accounts/connections | Real provider, API credential-configuration metadata, saved web account summaries and Codex/Grok summaries loaded. Configuration status does not assert successful inference or sign-in. |
| Models/capabilities | Official catalog loaded. Same-name models retained their provider-route distinction; source-declared fields were displayed without invented limits. |
| Usage/costs | API estimate, provider balance and subscription windows loaded separately. Native money values agreed with the original displayed source after formatting. |
| Original owner pages | All 20 existing setting destinations opened through the restored original list. Account advanced management and original fees navigation returned to the center without losing classification mode. |
| Mode restoration | Cancelling classification restored native navigation; re-enabling restored grouped navigation. Other Intelligent UI settings were semantically unchanged, excluding the expected revision increments. |
| Keyboard/layout | Arrow-key tab selection passed. Default and 980-pixel window layouts were inspected; window size was restored to 1512 × 874. Model tables retained local scrolling. |
| Budget write | Saving the existing amount returned a success notice through the actual owner API. Budget configuration and historical usage fingerprints were unchanged. |
| Preservation | Web account/index and guest-storage files matched their original hashes. Usage-day records, reset state, migrations and usage cursors were unchanged. The fees owner's normal startup price-cache updates were kept. |
| Official App/network | Official executable hash remained unchanged and signature verification passed. Tailscale and the independent resident process were retained. |

## Uncovered behavior

A changed-value model-definition write was not run against the live inherited/read-only selection. Field-scoped writes, accepted-revision advancement and stale-revision rejection were exercised with injected temporary data. New login, secret entry, model inference and provider efficacy were not tested or implied. Existing advanced operations remain with their original owners. No credentials, account records, session contents or private screenshots are included in this report.
