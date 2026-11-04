# Additive grouped settings navigation

The owner selected an additional grouped navigation entry on 2026-11-04. The original request to reorder the official sidebar is still unsupported by the published rc.2 contract. This alternative adds a `settings.action` contribution and preserves the original sidebar, account launcher, page registrations and page components.

## Ownership and adapter

The plugin reads the public `settings.section` metadata through `entries()` and `resolveSlotLabel()`, following registry and locale updates. Confirmed stable IDs map to Models & accounts, Appearance & display, Solar & workflows and Plugins. Every unmatched future ID remains under Other. Once enabled, compact category buttons remain in the Settings header. Expanding one category shows its complete page list; selecting a page collapses only that list, leaving the category bar and selected settings page available. No original setting is filtered or hidden.

The public contract has no general `openSection` callback for a settings action. A user selection therefore uses a bounded DOM adapter: from the plugin's own element, find the containing dialog and uniquely match an original `nav button` by its current normalized visible/accessibility label. It clicks that existing button, retaining the host handler and page ownership. It neither reorders/reparents nodes nor changes foreign styles, attributes, stores or modules. Missing, unavailable, ambiguous or disconnected targets produce a readable error. The original menu remains the fallback.

This adapter is verified against the installed rc.2 layout; it is not a new official navigation API or an assurance for future host layouts. A future official seam can replace only this adapter. Disabling the plugin removes its action and listeners through normal slot/React disposal.

## Persistent mode

The owner clarified that classification is a mode, not a one-shot popup. `settingsNavigation` is an optional boolean in the plugin-owned, versioned `settings.json`. Missing values read as disabled without rewriting legacy files. Existing save callers that omit the field preserve its current value; only an explicit boolean changes it. The regular revision-checked settings API handles writes, and failures remain visible without claiming the requested state was saved.

Page selection and Escape never write this preference. Escape or **收起选项** dismiss only the current category’s choices. **取消分类导航** explicitly saves false; reopening Settings and a new backend instance restore the saved mode. The original sidebar is unchanged even while category mode is active.

## Verification

Focused tests cover grouping and complete metadata retention, future IDs, locale/registry refresh, original-handler activation, ambiguous/missing/disconnected targets, Escape/focus, persistent mode across component remount, explicit cancellation, failed saves and lifecycle cleanup. Store tests cover legacy reads, backend restart, omitted-field preservation, cancellation and invalid durable/input values.

The standalone browser fixture loads the real action contribution into a synthetic host boundary. It exercises all 20 current page labels, unknown-page preservation, locale changes, missing/duplicate failure paths original-node retention, persistent categories after every selection, Escape/cancel distinction and selected-page visibility at 1280, 980 and 500 pixels. It has no real profile, credentials or model calls.

```sh
node tools/settings-navigation/build.mjs
python3 -m http.server 17842 --bind 127.0.0.1 --directory tools/settings-navigation
# In another terminal, while the temporary server is running:
python3 tools/settings-navigation/run-browser.py --output /private/tmp/dsh-settings-navigation-browser
```

Source/browser evidence and installation/native App acceptance are recorded separately. None of these checks claims that the official sidebar itself has been regrouped.
