# Tabbed settings navigation

The owner approved the tabbed design on 2026-11-04: four category tabs above a native group list and the original settings page, with Intelligent UI typography, colors and controls. Unknown future sections remain in Other. This replaces the rejected two-row header and popup navigation. No dropdown is used.

## Ownership and supported baseline

The published rc.2 contract has a `settings.action` contribution and public `settings.section` metadata, but no navigation-layout renderer. `SettingsRoot` alone owns the child-slot rendering authorization. The plugin does not obtain a foreign component, duplicate the shell or claim its child slots.

Instead, it leaves the official shell, launcher, shortcuts, original navigation buttons, page components, account state and save handlers in place. A component in `settings.action` owns the mode switch. A React portal adds only the plugin's category navigation before the original nav node. A plugin-owned stylesheet, scoped to the marked Settings dialog, reserves three grid rows for header, categories and page/list. Only the two existing layout wrappers use `display: contents`; original nodes are not moved, replaced, relabelled or given new handlers.

This is a bounded DOM/CSS compatibility adapter, not a new official grouping API. The supported shape is the installed `@deepseek-ai/dsh-client-ui-settings-general@0.2.1-rc.2`: a `dialog[data-shortcut-modal=settings]` with the native nav (title/list), and content (header/options). Its original header is fixed at 54 pixels, which is why the earlier multi-row action overlapped the page. Grouped mode reserves a separate category row instead of expanding that action.

The adapter validates the complete one-to-one correspondence between current public section labels and original nav buttons before applying any positional CSS mapping. It reads `aria-current` as the authority on the selected page. A group switch clicks an existing original button. The current category alone is visible in the native list; every registered destination remains available through its category, with no setting or registry entry removed. Within a category, native DOM, keyboard and display order stay the same.

Registration, removal, order and locale changes invalidate the old mapping before validation. External native navigation updates the category without issuing a competing click. Missing or duplicate labels, unknown structure and an indeterminate active page restore the unmodified navigation and display an explicit error. A failed native activation keeps the previous selection.

## Theme, focus and disposal

The surface uses existing `appearanceTokens()` and theme resolution rather than an independent palette. The Settings surface is opaque; normal reading transparency is unchanged. Navigation and header controls use a compact 32-pixel scale with 14-pixel platform sans and a 20-pixel title. The header/category tracks are 60/44 pixels, with a distinct gap before the page and menu. The category row explicitly uses border-box sizing, so its padding and divider cannot extend into the first menu item. Every native entry receives one owned 16-pixel outline icon through a CSS mask; original decorative children are only suppressed while grouped mode is active, and labels, nodes and handlers stay intact. Unknown settings use a neutral sliders icon. The original narrow header keeps a compact action when grouping is off.

The visual tabs are an accessible named navigation of pressed-state buttons. They do not claim a `tabpanel` relationship that the original settings pages do not expose. Arrow keys and Home/End switch category while preserving focus on the category control. The plugin-owned portal is inserted before the native navigation so it is reachable before the form in DOM order, not appended after the page. The official modal retains its focus trap, close operation and Escape handling.

Closing Settings or unloading the plugin disposes the observer, stylesheet and portal. Explicit cancellation saves false and restores the original flat navigation. If a plugin-owned category held focus when it is removed, focus returns to an available original selected item. No original style or DOM attribute is rewritten, so cleanup does not depend on restoring a private cached value.

## Persistent mode

`settingsNavigation` remains an optional boolean in the plugin-owned, versioned `settings.json`. Missing values read as disabled without rewriting legacy files. Existing save callers that omit it preserve its current value. Only explicit enable/cancel writes it through the normal revision-checked settings service. Page and category selection do not write this preference. Failures are visible and do not pretend a write succeeded.

## Verification boundaries

Focused checks cover complete grouping, original-handler activation, external navigation, future sections, locale and directory mismatch, disabled/ambiguous destinations, cancellation, remount, focus preservation and cleanup. Browser checks model the published host layout and slot wrappers; the source/build and exact packed-profile checks are separate from real-App acceptance.

```sh
node tools/settings-navigation/build.mjs
python3 -m http.server 17842 --bind 127.0.0.1 --directory tools/settings-navigation
python3 tools/settings-navigation/run-browser.py --output /private/tmp/dsh-settings-navigation-browser
```

Real MacBook acceptance must exercise the installed plugin in the original App, all current destinations, category retention, normal/narrow geometry, keyboard paths and restoration. The fixture alone cannot prove those native effects. No model calls are required.
