# ASCII terminal text candidate l

## Scope

Only the independent Intelligent UI plugin's ASCII typography changes. Classic character comparisons and GPU graphics remain separate. The official app, other plugins, sources, records and theme formats are untouched. No release or GitHub publication is requested.

## Local evidence

- Typecheck and production build passed.
- Stable test gate: 79 files, 935 passed, 3 existing skipped. The initial sandbox run could not create Vitest's temporary config; the approved retry ran successfully. No paid/model calls.
- One lifecycle regression test exercises classic/GPU selection, shared code/body font role, switch to Empryo and stylesheet disposal.
- Actual local browser at 1280x900 and 320x900: both ASCII modes use the terminal role in body, headings and plugin header controls, with no document horizontal overflow. Selecting Empryo restores its prior proportional face. All three selections preserve the exact original report (normal unified raw mode).
- Actual platform fonts: Menlo-Regular for Latin and STHeitiSC-Light for Chinese. At 16px, i/l/1/I/O/0 each measured 9.6328125px; representative Chinese glyphs each measured 16px. This is readable mixed-script fallback, not strict two-Latin-cell CJK alignment.
- Actual heading scale: 22/20/18px, weight 600. Native body sample 16px/24px, weight 400; controls 13px; ligatures none. All original content remains selectable native DOM text.
- CSS layout zoom 200% passed with readable wrapping and no horizontal overflow, then reset. Browser-native zoom shortcuts under device emulation were inconclusive; native browser/DSH 200% zoom acceptance remains pending.
- GPU chart preservation was reconciled after an early screenshot captured native bars before the atlas was ready. With the chart visible, waiting for the real paint marker yielded one target and an empty fallback list. The final ready screenshot shows actual character bars with exact native labels.
- AI Design Check: no findings in affected production files (49 automatic rules). Impeccable type detector: []. Taste app lint: 0 FAIL, 3 WARN for existing/pinned shadows and explicitly requested terminal monospace; no unrelated styling changes or ignore rules.

Screenshots, source equality receipt and supplemental captures live only in the ignored local artifact directory `artifacts/intelligent-ui/terminal-type-20261102/`. They are not committed or uploaded. The preview uses labeled synthetic data through normal ContentView and HeaderControls, with no model or official-app access. Native Desktop installation and target Host/CSP acceptance belong to the central installer and remain pending.

## Delivery candidate

Independent finish review: ship for the local typography candidate; native Desktop and native zoom remain pending. Exact packed candidate `cui-20261102l-terminal-text.tgz`, SHA256 `4f062a107e7859466908c767270888dc1d8fce797695e3776891395674db229d`, 10,755,528 bytes and 132 entries. The archive excludes screenshots, recordings, synthetic model binaries and browser fixtures. The published-DSH scratch test of this exact tarball returned ok=true, scratchRemoved=true and liveModels=0. Central installation handoff supersedes queued k only after reconciling any already-started operation.
