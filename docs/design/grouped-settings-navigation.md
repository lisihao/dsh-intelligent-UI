# Additive grouped settings navigation

The owner selected an additional grouped navigation entry on 2026-11-04. The original request to reorder the official sidebar is still unsupported by the published rc.2 contract. This alternative adds a `settings.action` contribution and preserves the original sidebar, account launcher, page registrations and page components.

## Ownership and adapter

The plugin reads the public `settings.section` metadata through `entries()` and `resolveSlotLabel()`, following registry and locale updates. Confirmed stable IDs map to Models & accounts, Appearance & display, Solar & workflows and Plugins. Every unmatched future ID remains under Other. All groups are expanded; no original setting is filtered or hidden.

The public contract has no general `openSection` callback for a settings action. A user selection therefore uses a bounded DOM adapter: from the plugin's own element, find the containing dialog and uniquely match an original `nav button` by its current normalized visible/accessibility label. It clicks that existing button, retaining the host handler and page ownership. It neither reorders/reparents nodes nor changes foreign styles, attributes, stores or modules. Missing, unavailable, ambiguous or disconnected targets produce a readable error. The original menu remains the fallback.

This adapter is verified against the installed rc.2 layout; it is not a new official navigation API or an assurance for future host layouts. A future official seam can replace only this adapter. Disabling the plugin removes its action and listeners through normal slot/React disposal.

## Verification

Focused tests cover grouping and complete metadata retention, future IDs, locale/registry refresh, original-handler activation, ambiguous/missing/disconnected targets, Escape/focus and lifecycle cleanup.

The standalone browser fixture loads the real action contribution into a synthetic host boundary. It exercises all 20 current page labels, unknown-page preservation, locale changes, missing/duplicate failure paths and original-node retention at 1280, 980 and 500 pixels. It has no real profile, credentials or model calls.

```sh
node tools/settings-navigation/build.mjs
python3 -m http.server 17842 --bind 127.0.0.1 --directory tools/settings-navigation
# In another terminal, while the temporary server is running:
python3 tools/settings-navigation/run-browser.py --output /private/tmp/dsh-settings-navigation-browser
```

Source/browser evidence and installation/native App acceptance are recorded separately. None of these checks claims that the official sidebar itself has been regrouped.
