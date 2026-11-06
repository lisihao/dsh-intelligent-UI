# Plugin dependency map

## Scope and terminology

This map records relationships visible in the package manifest and source. It
does **not** establish what is currently installed, enabled, configured, or
reachable in any DSH profile.

- **Required package/host contract** means the bundle declares or directly uses
  the dependency to load its server or client capability.
- **Feature-gated dependency** means a capability is reached only after the
  documented runtime condition is true.
- **Optional association** means the code probes an independently supplied
  service or a specific DOM surface and has a no-peer path.

Source references below are relative to this package.

## Required package and host contracts

| Relationship | Evidence | Classification |
| --- | --- | --- |
| DSH and Cordis host | The package declares DSH `0.2.1-rc.2`, points its bundle at `cordis.patch.yml`, and the patch registers this package. The server entry imports Cordis and declares `tools`, `sessions`, and `skills` injection. | Required plugin/host contract; not an independent Solar plugin. |
| Web client host APIs | The manifest requests the DSH web client injections. The client entry declares `slots`, `remote`, `connection`, `sessions`, and `theme`, then mounts its remote surface and registers slot views. | Required client-side host contract for the browser contribution. |
| OpenUI libraries | `@openuidev/*` packages are normal package dependencies, and source directly imports OpenUI renderer, library, charts, Markdown UI, and icons. | Required package code dependency for OpenUI-capable builds; it is not a separately named DSH plugin. |
| Theme system | Built-in theme JSON files are imported and validated in `theme-contracts.ts`; the renderer reads those built-ins plus saved imported theme data. | Bundled plugin capability. Imported themes are data/configuration, not a companion plugin requirement. |
| Uiverse library | The server always calls `installUiverse`; that function loads bundled assets, registers this package's `solarUiComponents` service, skill, and tools. The runtime adapter reads the bundled source catalog. | Bundled plugin capability, not a required standalone Uiverse plugin. |

Relevant source: `package.json:41-61`, `package.json:75-124`,
`cordis.patch.yml:1-3`, `src/index.ts:69-89`, `src/client.ts:50-56`,
`src/client.ts:521-614`, `src/presentation.ts:18-20`,
`src/theme-contracts.ts:1-8,56-77`, and `src/uiverse/host.ts:122-136`.

## Feature-gated dependencies

| Feature | Condition and fallback | Evidence |
| --- | --- | --- |
| Jev composition judgment | Jev is an optional public Cordis service. The plugin defines its own bounded interface rather than importing a Jev package. It attaches only through an optional `ctx.inject(['jev'])` path. A composition request needs enabled saved adaptive settings, a non-streaming source with choices, an attached service, and an enabled Jev feature; otherwise the coordinator returns a local result. | `src/adaptive-ui/contracts.ts:142-194`, `src/index.ts:85-88`, `src/adaptive-ui/host.ts:207-246,304-325,693-705`. |
| OpenUI artifact protocol | The library is packaged with the plugin. Rendering an `openui` protocol artifact additionally requires the saved `openui` setting; this is a rendering gate, not a separate plugin installation check. | `src/contracts.ts:17-26,39-43`, `src/client.ts:471-485`, `src/presentation.ts:694-737`. |
| MCP Apps | The MCP connector packages are normal dependencies, while connection/use additionally requires a non-empty configured endpoint and saved `takeover` plus `mcpApps` settings. | `src/index.ts:69-91`, `src/mcp-host.ts:27-67`. |
| Canvas runtime bridge | The server installs the canvas runtime contribution only inside the optional `connection` injection callback. | `src/index.ts:75-81`. |

## Optional associations and non-relations

- The Uiverse installer rejects a duplicate existing Uiverse service, tool, or
  skill before registering this package's bundled capability. That is a
  conflict rule for a former standalone companion, not a requirement that such
  a companion be installed. (`src/uiverse/host.ts:112-135`)
- The ThoughtDAG bridge is a style-only DOM adapter. It acts only for a
  narrowly identified same-origin iframe while takeover is enabled; no package
  or Cordis-service dependency for ThoughtDAG is declared. (`src/appearance-style.ts:7-29`,
  `src/thoughtdag-theme.ts:70-147`)
- Insight preview optionally reads `solarConversationTasks.status` and
  `solarWorkflowControl.overview` when those methods exist. It does not inject
  them, mutate them, or declare a package dependency on either service.
  (`src/control.ts:63-72`)
- The reviewed `src/`, `package.json`, and `cordis.patch.yml` contain no
  reference to RLM, resident, collaboration, agent-team, or subagent services,
  and no separately named `@lisihao/dsh-solar-*` package import beyond this
  package's own identifier. This is source absence only; it says nothing about
  installed plugins or runtime services.

## Build-time versus runtime

`package.json` separates normal `dependencies`, host-supplied
`peerDependencies`, and `devDependencies`. The build, type-check, test, and
plugin-test commands are development verification commands; they do not by
themselves create a runtime plugin dependency. Conversely, a peer dependency
or requested client injection describes an expected host contract, not evidence
that the corresponding host module is installed or active in a profile.

Evidence: `package.json:64-73,75-161`.
