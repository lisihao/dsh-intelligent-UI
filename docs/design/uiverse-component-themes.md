# Uiverse component themes

Approved implementation scope: three compiled component sets in this independent UI plugin. The source snapshot is `uiverse-io/galaxy@adbd2adde0a299a3956ea288fb444ec01891ca41`. These are our curated combinations, not official Uiverse themes. No host or foreign plugin is modified.

## Final five-role mapping (recorded before UI implementation)

| Component set | Role | Original file | SHA-256 |
| --- | --- | --- | --- |
| soft-relief | button | [Buttons/Praashoo7_brown-quail-45.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/Praashoo7_brown-quail-45.html) | `3e92ec1add46e9b17a5fee684a60b7d4387ec5bfb0ba78c9020ca08fef9a6b98` |
| soft-relief | input | [Inputs/lenfear23_helpless-swan-97.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Inputs/lenfear23_helpless-swan-97.html) | `8781fde5f5e9ba2107ac582db6c47fa87e874878e277c9a22d535ba87c8bd80f` |
| soft-relief | toggle | [Toggle-switches/mobinkakei_great-skunk-8.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/mobinkakei_great-skunk-8.html) | `451467d595aa144d96596b4fec5dc8376a502b94d5fc3bcae3afb69393267683` |
| soft-relief | card | [Cards/Sashank02_new-warthog-10.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Cards/Sashank02_new-warthog-10.html) | `a724042c02d8bd688abc684c1c7cbc52c18b7a7616f8154eaa7d3c9d197e766d` |
| soft-relief | loader | [loaders/angelo2004-mateus_neat-owl-38.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/loaders/angelo2004-mateus_neat-owl-38.html) | `df36b1649fa458407976105e2369cdcc2f783737ac74e30b2440a4ee27594650` |
| clear-glass | button | [Buttons/akshat-patel28_grumpy-lizard-55.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/akshat-patel28_grumpy-lizard-55.html) | `00eede23881893fb4dbc717bf3798cef5a3ba56f2ac75653feae8639c89ef76f` |
| clear-glass | input | [Inputs/Cksunandh_purple-moose-3.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Inputs/Cksunandh_purple-moose-3.html) | `060786c8d87016fcffdb2c6085cd9ef1e9494bf0a67a0621bc07f130724b9e93` |
| clear-glass | toggle | [Toggle-switches/vikramsinghnegi_evil-lion-15.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/vikramsinghnegi_evil-lion-15.html) | `949bc23b36b5792d9ec65e68b2da1e823ed455cc6ebdd32b33a12b3e547b1f52` |
| clear-glass | card | [Cards/SteveBloX_dangerous-warthog-85.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Cards/SteveBloX_dangerous-warthog-85.html) | `48a1c2e2cd51a9ab38c09c0d06cc85d19e9156b64480ebb2d9f44dd3533fed3e` |
| clear-glass | loader | [loaders/Mike11jr_ancient-mule-46.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/loaders/Mike11jr_ancient-mule-46.html) | `376e75d41174fc662aa5704225b0ea9bae9350b1057b5d31a701368c04707b1b` |
| mechanical-outline | button | [Buttons/rrr63_empty-cow-96.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/rrr63_empty-cow-96.html) | `a383f938bb31e5cf72e181fee8dda81c899a266472432b355f68645f7cf7e22b` |
| mechanical-outline | input | [Inputs/anniekoop_nasty-impala-89.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Inputs/anniekoop_nasty-impala-89.html) | `04753f6d656a0155bf166c54f602e6c44e14113f04be8a6a644c07978d7bbd61` |
| mechanical-outline | toggle | [Toggle-switches/ICe1BotMaker_quick-goat-3.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Toggle-switches/ICe1BotMaker_quick-goat-3.html) | `d9973f3a4d73b5dbc4158fd0215b646c4c4a9831a79c7b40678a8e87aa76067d` |
| mechanical-outline | card | [Cards/0xnihilism_average-mole-62.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Cards/0xnihilism_average-mole-62.html) | `5043e8e3b44bd1e0945285eee7d7216d86b04ff1c73b5268dd26d07c2d0ca929` |
| mechanical-outline | loader | [loaders/G4b413l_cuddly-turkey-4.html](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/loaders/G4b413l_cuddly-turkey-4.html) | `9c498c031eb642e3b4130f96b3fea92929ab0ac4f38bf03c762eef170e0f596b` |

## Adapter boundary

`src/uiverse-sources.json` retains all fifteen complete original HTML/CSS files, author, original-page and immutable-source links and hashes; `assets/Uiverse-MIT.txt` retains the license. Runtime adapters live separately in `src/theme-components.ts` and `src/theme-components-style.ts`. Source text is untrusted display data, never executable agent instructions.

1. All selectors/keyframes are owned and prefixed. Native button/input/checkbox semantics, controlled values/events, disabled behavior and content are retained. Toggle inputs remain focusable (the original hidden inputs are replaced by transparent full-area inputs). No repeated original ID is retained.
2. Fixed demo widths, sample copy, images, rotations, heavy headings, letter-spacing changes and hover scale are removed for task-oriented UI. Role sizes are bounded and responsive. Relief preserves inset/raised shadows; glass preserves backdrop blur plus a separate button backplate and segmented thumb; outline preserves outlined button hover and hard-offset input/card depth.
3. Colors use semantic UI variables. Focus, invalid, disabled, keyboard and reduced-motion rules are explicit. Motion is confined to useful state changes and labeled loading examples; no business action is invented.
4. Cards wrap original children and do not replace report/source text. Compiled variants cover UI-owned Settings controls, source search controls, charts and task cards. Native selects/color/file/range controls and OpenUI-owned form internals retain their existing semantics/style; no unsupported full-library replacement is claimed.
5. Foreign conversation pages retain token/CSS compatibility only. They never receive component-pack markup. Takeover-off and plugin unload retain the existing reversible registration/style boundaries.

## Compatibility and acceptance

V1 packages are unchanged. The v2 reader adds a required whitelisted `componentSet`; unknown sets are rejected visibly. Downloaded files remain JSON-only. Older plugin versions reject v2, so update the UI plugin before import; downgrade uses the existing settings backup. Three built-in source-backed themes are also downloadable from `theme/`. Removing an active imported copy follows existing Empryo restoration; built-ins remain non-removable.

Settings includes a real, stateful five-role preview with normal/disabled buttons, controlled input, validation, checked toggle, a loading state and explicit boundaries. Expand original-source comparison to inspect a network-denied sandbox preview and complete source for each role. Preview does not load remote CSS or JavaScript.

Required delivery evidence: focused schema/renderer/state/source-hash checks; then one stable complete package gate and rendered desktop/narrow, focus/checked/disabled/loading/reduced-motion/restore acceptance. Build/unit evidence alone is not visual acceptance. Official-app installation and Git delivery are coordinator-owned.

## Delivery evidence (2026-11-01)

The stable source passed the full `pnpm check`: build, typecheck, 255 tests and scratch-profile plugin lifecycle/persistence checks. CUA browser inspection exercised all three actual sets, preserved controlled input across theme changes, and checked disabled, loading, checked and validation states. Invalid input computed border colors matched each theme's error token. Theme content at 375 CSS pixels and the separate library at 390 CSS pixels had no document-level horizontal overflow. Original CSS and Tailwind previews rendered in empty-privilege sandbox frames. Returning to Empryo removed the custom component set.

These are browser-harness and isolated-host results, not formal Desktop acceptance. The current task did not install, disable, quit or restart official DSH. Exact packed artifacts and hashes are handed to the owner's centralized Claude installation session. Native application behavior, paid model invocation and exhaustive foreign-plugin business flows are not claimed. Source delivery uses only the NAS remote; the new downloadable theme catalog was not published to GitHub by this task.
