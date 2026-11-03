# Local ASCII GPU fixture

This fixture exercises the real plugin components and unmodified, pinned Canvas UI Asciify, ASCII Object and Ink Object factories. Its charts, graph data and raster images are deterministic synthetic samples, not measured results. It does not connect to the official DSH app or call a model.

From the plugin root, after `src/ascii-visual-theme.ts` is available:

```sh
node tools/browser-ascii-gpu/build.mjs
node tools/browser-ascii-gpu/server.mjs
```

The server binds only `127.0.0.1:8919`. Choose a different port with `ASCII_GPU_FIXTURE_PORT`. Open the printed local URL; the header's existing controls change the selected theme and the shared visual/raw output mode. The query `?theme=empryo` starts with Empryo; `?theme=ascii` starts with classic ASCII; the default starts with ASCII GPU.

The optional query `?execution=1` opens only the local execution replay. It sends eight fixed, immutable `execution-flow` snapshots through the normal `ContentView`: a lead, advisor and router fan out to three workers and join at review. Its 25-second timer supplies synthetic progress, metrics and events; pause/resume retains the remaining time, and replay starts again at the first snapshot. Nothing calls a model or reports an actual task. `data-fixture-execution`, `data-fixture-replay-step` and `data-fixture-replay-playing` identify the fixture and its current replay state. This focused query does not change the default fixture.

The optional query `?showcase=1` opens a focused synthetic model, SVG network and Markdown chart. The fixture creates a GLB locally with the project's Three.js `GLTFExporter` and passes its temporary blob URL to the ordinary `ContentView`; the original model remains available through its source link. Switching between classic ASCII and ASCII GPU uses the existing header controls and real effect loading path. The blob URL and generated geometry/materials are released when the fixture unmounts. No model inference or remote asset is used.

For an explicitly supplied local Markdown report, build with `EXPERIENCE_MARKDOWN_REPORT=/absolute/path/to/report.md`. The report is embedded only in `/private/tmp/iexp-ascii-gpu-fixture-20261102/fixture.js`; it is not copied into the repository. The output directory can be changed with `ASCII_GPU_FIXTURE_DIR` for both commands, provided it begins with `/private/tmp/iexp-ascii-gpu-`. Generated files are created outside Git with user-only permissions. Do not commit or upload private reports or screenshots.

The builder verifies SHA-256 for each fixed upstream factory, its helpers and license under `/private/tmp/dsh-canvas-ui-reference-a04a99b`, then bundles the unmodified sources and the project's pinned Three.js locally. The server supplies those modules at the same route path and revision query expected by the normal client loader; this local-only fixture route does not implement the official Host authentication. It serves only its explicit fixture routes and never proxies external URLs.

The fixture contains OpenUI Bar, Line, Pie, Radar and Scatter charts; small and large `FlowView` samples; small and large SVG icons; a native input target; a synthetic Canvas and PNG; `ArtifactView`; and `ContentView`. At the end, `data-fixture-object="synthetic-network-png"` identifies a separate transparent PNG made in the browser and passed through the normal `ContentView` illustration path. ASCII GPU selects the real ASCII Object factory; the general Empryo and classic ASCII paths select the real Ink Object factory. The original image remains beside the derived effect. Look for `data-fixture-*` attributes when checking each section. The raw-data disclosure preserves the exact synthetic inputs. The synthetic PNGs are illustrations, not real photographs.

Building or opening this fixture is not evidence of native DSH acceptance or hardware acceleration. Verify the real rendered pixels, input behavior, resizing, lifecycle and source preservation separately.

The optional query `?typography=1` renders a normal `ContentView` report with explicitly synthetic mixed Chinese/English prose, compact headings, numeric comparisons, source table and code. Use the existing header to compare classic ASCII, GPU ASCII and restored Empryo at desktop, narrow and zoomed sizes. No official DSH or model call is involved.
