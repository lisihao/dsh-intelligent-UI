# TuffUI opaque browser proof

These are synthetic local browser-acceptance fixtures. They contain no user,
conversation, provider, tool, session, or model data. `data-table` proves an
explicit host action ID returns only the selected synthetic row to the React
18 parent. `chart-card` proves the fixed source renderer accepts a source-bound
line-series shape and its legend changes locally without a host action.

The generated parent imports the real `src/tuffui/view.ts` React 18 renderer.
It replaces only `CompositionRuntimeContext` with an equivalent empty React
context, so the harness does not bundle unrelated app views and their assets.
The production renderer, catalog validator, type-schema validator, iframe
sandbox, MessageChannel bridge, and ComponentRuntimeHost are not replaced.

Build a private parent page from the copied public assets:

```sh
node tools/tuffui/generate-react18-opaque-parent.mjs \
  --repo "$PWD" \
  --out "$TMPDIR/tuffui-react18-opaque-parent" \
  --manifest resources/components/tuffui/source-manifest.json \
  --type-manifest resources/components/tuffui/type-schema.json \
  --runtime-endpoint /runtime.json \
  --scenario data-table
```

Run it through the real ComponentRuntimeHost, not a generic static iframe
server. The server writes a private `/runtime.json` with its random fixed
asset URL and verifies the frame's CSP, CORS, and CORP headers before listening:

```sh
node tools/tuffui/serve-react18-opaque-proof.mjs \
  --repo "$PWD" \
  --parent "$TMPDIR/tuffui-react18-opaque-parent" \
  --assets "$PWD/resources/components" \
  --port 4175
```

Use the same command with `--scenario chart-card` for the local ChartCard
fixture. Generated JavaScript, screenshots, runtime JSON, and temporary
servers belong in the private output directory and are never committed.
