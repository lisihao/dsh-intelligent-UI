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

Screenshots, private reports and native receipts remain local. The g native failure cannot be closed by synthetic or browser captures. Official h installation and affected native acceptance are pending the centralized installation session; verify both formerly failing window sizes, sidebar-open pointer reachability of all host/plugin controls, popovers, keyboard focus, disable/disposal and original appearance/window restoration.
