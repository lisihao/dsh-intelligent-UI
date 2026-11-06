# Plugin dependency map

## Scope and terminology

This map records relationships visible in the package manifest and source. The main map does **not** establish what is currently installed, enabled, configured, or reachable in any DSH profile. The final section separately identifies a bounded installed-package source inspection; it still does not establish active runtime behavior.

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

Relevant source: `package.json`, `package.json`,
`cordis.patch.yml`, `src/index.ts`, `src/client.ts`,
`src/client.ts`, `src/presentation.ts`,
`src/theme-contracts.ts`, and `src/uiverse/host.ts`.

## Feature-gated dependencies

| Feature | Condition and fallback | Evidence |
| --- | --- | --- |
| Jev composition judgment | Jev is an optional public Cordis service. The plugin defines its own bounded interface rather than importing a Jev package. It attaches only through an optional `ctx.inject(['jev'])` path. A composition request needs enabled saved adaptive settings, a non-streaming source with choices, an attached service, and an enabled Jev feature; otherwise the coordinator returns a local result. | `src/adaptive-ui/contracts.ts`, `src/index.ts`, `src/adaptive-ui/host.ts`. |
| OpenUI artifact protocol | The library is packaged with the plugin. Rendering an `openui` protocol artifact additionally requires the saved `openui` setting; this is a rendering gate, not a separate plugin installation check. | `src/contracts.ts`, `src/client.ts`, `src/presentation.ts`. |
| MCP Apps | The MCP connector packages are normal dependencies, while connection/use additionally requires a non-empty configured endpoint and saved `takeover` plus `mcpApps` settings. | `src/index.ts`, `src/mcp-host.ts`. |
| DIL authoring and runtime | `adaptive.blockLayout` enables the DIL lane independently of Jev. The fixed reference is a build-only input bundled with this plugin; there is no required companion intelligent UI plugin. Optional `systemPrompt` injection adds authoring guidance, while the existing logged catalog/tool path remains available. | `src/dil/host.ts`, `src/dil/client.ts`, `src/dil/artifact.ts`, `src/contracts.ts`, `tools/dil-reference.mjs`, `package.json`. |
| Canvas runtime bridge | The server installs the canvas runtime contribution only inside the optional `connection` injection callback. | `src/index.ts`. |

## Optional associations and non-relations

- The Uiverse installer rejects a duplicate existing Uiverse service, tool, or
  skill before registering this package's bundled capability. That is a
  conflict rule for a former standalone companion, not a requirement that such
  a companion be installed. (`src/uiverse/host.ts`)
- The ThoughtDAG bridge is a style-only DOM adapter. It acts only for a
  narrowly identified same-origin iframe while takeover is enabled; no package
  or Cordis-service dependency for ThoughtDAG is declared. (`src/appearance-style.ts`,
  `src/thoughtdag-theme.ts`)
- Insight preview optionally reads `solarConversationTasks.status` and
  `solarWorkflowControl.overview` when those methods exist. It does not inject
  them, mutate them, or declare a package dependency on either service.
  (`src/control.ts`)
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

Evidence: `package.json`.


## Reverse consumers: bounded installed-package inspection

A separate read-only inspection of the current desktop profile's direct dependency package source identified an explicit client consumer in `@lisihao/dsh-solar-quantjourney`: its `observeSmartDocuments` injects `solarExperienceUi` and publishes smart-document capability only when the expected `DocumentView` or version-1 documents interface is available. Its manifest does not declare this UI package as a dependency or peer dependency. This supports **capability-gated integration**, not a claim that all QuantJourney features strongly depend on intelligent UI.

The same bounded inspection did not find a reverse call or package dependency in the inspected ChatGPT-Web, Solar/community ThoughtDAG, native-collaboration, native-resident, Bench, industry-research, research-report, claude-slides, agent-desktop, memory-context or Hindsight adapters. The search covered package manifests and eligible runtime/client/source files, excluding nested dependencies, maps, declarations and oversized bundles. These exclusions and uninstalled/indirect packages remain outside the conclusion. Installed source is not evidence that an integration is enabled or functioning in the running app.
