# ASCII candidate h: native header follow-up

## Observed defect

Centralized native acceptance of candidate g passed theme selection, categorical ASCII plots, model/image display, transparent-background controls and disable/restore. It failed the header at 2560×1640 and macOS Left-half 2306×2814 physical pixels with the sidebar open: this plugin's right-side controls overlapped existing host badges/buttons. The restored original 4608×2812 window fit normally. Standalone browser wrapping was insufficient evidence for the host composition.

## Scoped correction

- Only this independent UI plugin changes. Its header stays in one row; display and theme selects remain directly available.
- Research and transparency are one mounted set of controls, inline in a wide header and behind a native **更多显示选项** popover below 1100 CSS px of the nearest existing size container. There is a viewport fallback. The adapter reads/observes existing geometry without changing host or foreign-plugin CSS.
- Compact select width is 110px and the extra-options trigger is 32px. The whole compact toolbar measured 241.4×36 CSS px in the local fixture.
- Native popover Escape/outside close, manual-slider cleanup, range/focus restoration and unsaved-preview cancellation preserve the saved setting. Reopening with an unchanged prior close sequence does not close a newly focused slider. Theme errors float outside the toolbar rather than widening it.

## Run before packaging

- Build and TypeScript passed; **70 files, 763 tests passed, three existing skips**.
- Actual Chromium: 1280×900 and 320×880 browser captures; no document horizontal overflow at 320. The compact auto panel and existing manual slider were simultaneously open within x=8–268 of the 320px viewport; Escape closed both and restored focus to the More trigger.
- Open → close → immediate reopen/focus remains stable after two animation frames. Wide/compact transitions retained the same range and checkbox DOM nodes, with one copy of the controls. Focus moved to a surviving visible control when the trigger or manual slider disappeared.
- A **labeled synthetic** 900px container, 36px row and 360px left-side occupancy left the 241.4px toolbar separated without overlap. This is a focused reproduction constraint, **not an official-app screenshot**.
- Source chart/input evidence from g is reused because the ASCII renderer and data analysis did not change. The preview now starts with an inline-size container so the responsive host path is represented.
- Impeccable and ai-design-check: no new static findings. Independent full finish review after seeing the contradictory g native capture: **`ship` for h browser candidate only**, with formal native retest still required.
- The exact 124-file `cui-20261102h-ascii.tgz` passed a disposable published-DSH plugin test; receipt `dsh-v4-experience-plugin-test-6ebQq6-receipt.json` reports success, no live models and scratch removal. SHA-256: `03af3081f31f45b1e257e643b3bb25ddf8b646d7ec8e848b38d7422c4da7bacb`.

## Centralized native acceptance

The centralized installer subsequently installed exact h (source `04daed89a2f2252e42c005f7b4b79a8878be1acb`, SHA above). All 124 installed files match its archive and all 94 embedded source files match the clean source commit. Only this package's lock source/integrity changed; dependencies, persistence and service contracts are unchanged. The g header defect is **closed within the observed native scope**.

- Official unmodified rc.2 Desktop, normal app path, existing local report and sidebar open: **2560×1640 and Left-half 2306×2814 physical pixels** both retain one row without overlap. Actual pointer actions reach account, expense, file-open dropdown and display menus. No account, billing or file-opening action was executed beyond these read-only menus.
- Theme remains directly reachable in compact mode. More opens by pointer and Return; Tab reaches research, transparency and range. Actual compact-layout pointer dragging persists 53% to 55% transparency, then wide-layout dragging restores 53%. Escape and outside input close both layers; immediate reopening works. Resizing while the range is focused removes overlays and moves focus to the visible research checkbox.
- Normal navigation to Plugins unmounts the conversation controls and clears both open overlays; subsequent disable/enable restores controls and persisted ASCII. Literal disabling while an overlay stays mounted and native DOM identity introspection were not performed; source/browser tests separately cover those mechanisms.
- Original conversation, display mode, 4608×2812 window, Empryo, dark gray and 53% transparency are restored. All other settings fields equal the pre-h state, apart from revision. All 53 other plugin file sets, profile YAML, bundle order and official App bytes are unchanged. Existing UI, benchmark and Progress data are unchanged apart from the settings revision; the same Resident process and terminal graphs remain.
- The local native report is distinct from the source owner's 22,777-character browser input; g's exact local-report preservation evidence is reused for unchanged rendering code. No report import, research/model call, session edit, daemon stop, database read or public upload occurred.

The primary Finder launcher itself was not executed; the adjacent file-open menu is the tested pointer path. Wide transparency was exercised by focus and real dragging, not an isolated hover-only attestation. Hardware GPU, native 320 CSS px, all chart/effect variants, live external revision-conflict gestures and general HTML Asciify/Clouds consumers remain outside this acceptance.

Screenshots, private reports and native receipts remain local. The centralized installer saved `HEADER-FIX-H-ACCEPTANCE.md` and its private receipt outside this source repository. This record distinguishes native results from the labeled synthetic header and browser evidence above.
