# Scalable source-preserving content rendering

## Scope and acceptance

The user authorized removal of the 200-row chart and 40-node/100-edge graph refusals on 2026-11-01. Only the independent intelligent UI package changes. Other plugins, the official app, tool contracts and research artifacts remain unchanged.

Completion means valid tables with 10,000 rows and graph payloads with 1,000 nodes / 5,000 edges pass the actual analyzer and browser view, with exact source access, responsive controls and bounded rendered detail. These are acceptance fixtures, not claims of unlimited capacity or frame rate. The host's existing payload byte boundary remains.

## Existing dependency adapters

Reuse pinned OpenUI 0.18.1 for charts, React Flow 12.12.0 for interactive nodes and viewport culling, and ELK 0.12.0 for layout. No new engine or copied upstream source. A thin native WebGL2 adapter batches the complete graph overview into lines and node quads; Canvas2D is the named fallback. ELK owns layout and React Flow owns detailed interaction. ELK's distributed worker is bundled locally behind a Blob Worker adapter; worker errors, unsupported policies and cancellation have explicit outcomes. All runtime operations stay local, with no CDN or experimental browser flag.

Large time-series use a declared min/max envelope: first/last and each bucket's extrema from every series, always copied from actual source rows and in original order. No average, interpolated values or invented totals. OpenUI remains the ordinary chart renderer. Its long line chart API has categorical spacing and defaults to horizontal scrolling, so the dense adapter uses a thin native SVG projection with continuous original time coordinates; it never equates irregular sampled dates. The user can choose a smaller row range to recover every point. Large categorical comparisons use contiguous source-order pages rather than silently keeping a top-N. Full originals remain accessible through paginated DOM tables and the existing whole-output raw view. Collapsed large tables do not mount all rows.

Graph scale uses overview/detail separation, viewport culling, exact node search and source lists. Overview geometry is presentation only and never a probability, strength or execution metric. Detail selection exposes original labels and incident relationships. Small graphs retain layered obstacle-aware routing; large graphs use the published ELK force algorithm for a structural overview (not a relation-strength measure). Layout runs away from the UI thread for large graphs where Worker is permitted; fallback remains explicit and source preserving. Motion respects reduced-motion and does not report real execution.

## Canvas UI boundary

Inspected upstream a04a99b235299ee79a123a16ccb2e6cf9da74b6b, https://github.com/DavidHDev/canvas-ui . Its LICENSE.md is MIT **plus Commons Clause**, not plain MIT: modification and embedding in an application/product are allowed subject to its terms; standalone/bundled/ported component redistribution is restricted. No Canvas UI source or catalog is added by this change. Ordinary WebGL capability and HTML-in-Canvas capability are distinct. Chrome's stable announcement does not establish support for Canvas UI's older requestPaint/layoutsubtree API in DSH. This capacity fix does not depend on that experimental API. Only the large graph overview uses native WebGL2; charts and readable controls retain SVG/DOM. It does not make an entire-conversation GPU claim.

## Delivery and verification boundary

Run affected unit/interaction tests during development, one full built-package scratch gate at the stable boundary, and browser desktop/narrow acceptance with exact synthetic fixture counts and timings. No model calls. Screenshots and runtime receipts remain private and outside Git. Pack one stable tarball and provide its SHA256 to the centralized installation chat; this development chat never updates or restarts desktop. Installed DSH acceptance remains separate until the installer records it.


## Real public-data native follow-up

The installed renderer lacked a normal fixture input. The user requested public sample data and actual testing on 2026-11-01. Add only a local JSON/Markdown/text picker plus an explicit Import and display action to the existing Generated content tab. Reuse the already authenticated owner publish API and UI-owned artifact store; no tool/model contract changes, hidden gateway call, session-log mutation or new dependency. Raw file text remains exact; JSON is validated as data before presentation. A failed save retains the file for retry; session changes retire late file reads. In-flight old artifact polls cannot erase a newly imported item. Completion requires official public source/provenance, exact source preservation, the real imported graph/series in installed DSH, named backend/layout outcomes and unchanged foreign plugins/settings. Data and captures stay private; only reproducible source preparation code is published.
