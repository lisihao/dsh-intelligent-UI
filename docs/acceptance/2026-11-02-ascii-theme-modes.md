# Classic/GPU ASCII and dim relief: candidate k

## Observed problem and correction

The owner reported a glaring Soft Relief background and an ASCII appearance that looked like color/typography rather than actual GPU-built characters. The centralized install thread confirmed official Desktop still had candidate h; queued j had not been installed because the owner was using the application. This task did not install into desktop or quit/restart the app.

The existing `ascii` identity now preserves the classic character-bar presentation. A separate `ascii-gpu` identity explicitly selects real Asciify graphics and the upstream ASCII Object shader. The former 2.5px whole glyph becomes 6.25px ink in an 8.75px cell. Plain noninteractive OpenUI foreignObject labels are omitted from the inert SVG copy and remain native; the entire chart no longer falls back merely because those labels exist. Other unsafe content still fails visibly. Original text, values, labels, model sources and raw records are retained. Small functional SVG icons stay native; this is approximate visual conversion, not universal pixel-identical ASCII reproduction.

Soft Relief defaults to `#34383d` with subdued background-derived raised/inset highlights. Existing saved custom appearances are not rewritten. Native model controls have a reserved 40px row and model source records use a normal disclosure. No other plugin, model configuration or official application file is changed.

## Checks actually run

- TypeScript and production build passed.
- Complete stable suite: **79 files, 934 passed, 3 pre-existing skipped**. Loopback HTTP tests ran with the required permission. No live model call.
- Exact tarball passed the plain-Node published-DSH scratch-profile probe: `ok=true`, `scratchRemoved=true`, `liveModels=0`.
- Actual browser screenshots at 1280×900 and 320×880 for GPU ASCII, classic ASCII and Soft Relief. All six had no document horizontal overflow. GPU displayed actual character-built model and bars; classic displayed the original character bars with no graphics atlas; relief computed an opaque RGB 52/56/61 base.
- Theme changes used the real compact header selector and preserved the exact original model record. Unified raw mode matched it exactly. Original category labels remained `甲 · 18`, `乙 · 32`, `丙 · 24`, `丁 · 43`.
- The source model was generated locally with the pinned Three.js exporter and accepted through the normal ContentView/CanvasObjectView path. A private 6.4-second actual-browser recording shows character geometry changing during native rotation actions; it is synthetic demonstration data, not a model run or frame-rate benchmark.
- Actual Asciify context loss restored every temporary source marker and showed the named fallback. Switching classic → GPU recovered real rendering with no fallback and exact source bytes retained.
- Independent Impeccable finish review: `ship` for local candidate k. The sparse network-icon projection was accepted within the documented approximate-conversion boundary, not treated as proof of lossless arbitrary semantic graphs.
- ai-design-check: no findings across 49 automatic rules. Taste source lint identified existing, explicitly user-selected relief/glass/depth/loading-gradient devices in the shared component file; those pinned materials and unaffected variants were preserved rather than reported as a clean generic-style lint result. Actual rendered review remains the visual evidence.

## Package and privacy

Stable archive in the main local checkout: `artifacts/cui-20261102k-theme-modes.tgz`.

SHA-256: `eb0cd02b68187969a2b20ccd6cbc41f1c6a2276d19d8aaf8424eb8dd3b9a2dbe`.

Identity remains `@lisihao/dsh-solar-intelligent-experience-platform@0.1.0-preview.2`; this is a separately identified development candidate, not a new marketplace release. The 132-entry tarball contains no screenshots, recordings, generated GLB or browser fixture. Detailed receipts and synthetic native-import fixtures remain private under ignored local `artifacts/intelligent-ui/theme-modes-20261102/`. No media is committed or uploaded.

## Pending

Official Desktop/CSP and normal installation acceptance belongs to the centralized installer. k supersedes queued j and i; first reconcile any actual installed state and do not install all candidates sequentially. Preserve unrelated package files, sessions, credentials, latest owner preferences and the official app. These source changes and theme catalog files are NAS-delivered; this turn did not publish them to GitHub or create a tag/Release. Native use is not claimed until the installer supplies its actual receipt.
