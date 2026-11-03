# Imported source-table fitting

## Scope and behavior

The owner reported wide content after a Markdown import into Generated content. Reproduction used the exact owner-selected file through the ordinary LocalDataImport and Workspace, backed only by the fixture's in-memory API. At desktop and narrow sizes, the document itself remained contained, but some maintained OpenUI tables retained a natural width larger than their local viewport and required horizontal browsing. This is not recorded as a reproduced whole-document overflow.

The plugin now fits original tables to available container width by default and shows the actual scale with an unscaled native-size toggle. It scales the existing table DOM and reserves its rendered height, preserving every cell, source anchor and exact value. The native-size mode has a focusable local horizontal scrollport; returning to fit resets scrollLeft. Body text, control labels and other plugin/app surfaces are not scaled. Workspace's grid now explicitly uses a shrinkable minmax(0,1fr) track. The same table wrapper is shared by original Markdown/record tables, chart source data and research comparison tables. Existing responsive graph/model renderers remain unchanged.

## Verification

- Full stable gate: 80 files, 936 passed and 3 existing skipped; typecheck and production build passed.
- New regression covers resizing, zero-size hidden disclosures, preserved original table/cell DOM, native-size scrolling mode, nonzero scroll-offset reset and observer cleanup.
- An existing research ResizeObserver test now routes resize notifications to the actual observed research container, instead of assuming only one observer exists.
- Real owner-file browser import: all 8 source tables fit at 1280,800 and320 CSS pixels; the entire raw output remains byte-equivalent after UTF-8 decode.
- At800px, the widest table fits at approximately62%; native mode scrolls horizontally426.8px to its far edge, then fit returns to offset0 and rendered width688.95px within689px. Original cell text is exact.
- Research technical-comparison view: all8 original tables fit at800 and320px; actual320px capture inspected. No AI organization was submitted.
- AI Design Check: no findings in affected files. Impeccable component detector: []. Taste component lint:0 FAIL,0 WARN.
- Independent review accepted the corrected scroll-restoration logic and800px actual capture for the local candidate. Native Desktop installation/target Host acceptance remains the central installer's responsibility.

Very narrow tables can require a small overview scale (about20% for the widest owner table at320px); the visible native-size button is the reading/detail path. This is not a claim of readable microtext, arbitrary iframe adaptation, or lossless scaling of every third-party UI. Original data is never removed to make it fit.

The input file, screenshots, source hashes and browser receipts remain only in the ignored local artifact directory `artifacts/intelligent-ui/import-fit-20261102/`; no private content/media is committed or uploaded. No model request, real research, official app restart or official desktop package change was performed by this development session.

## Packed candidate

Exact candidate m: `cui-20261102m-import-fit.tgz`, SHA256 `121a8200c3a8fb54cd40e3b118b7b33bce14b0210fd9442a0c04f7326a855c87`, 10,759,702 bytes and133 entries. Archive inspection excludes private reports, screenshots, recordings, models and browser fixtures. Published-DSH scratch installation/boot of the exact tar returned ok=true, scratchRemoved=true, liveModels=0. All9 combinations of Empryo/classic/GPU and visual/raw/compare remained contained at320px; raw content was exact in each applicable mode. Central Desktop installation remains pending.
