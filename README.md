# dsh-intelligent-UI

An independent open-source presentation plugin for the official DeepSeek Harness Desktop. This repository builds and tests on its own; it does not require the DeepSeek Solar Harness repository or modify the official application.

The historical package name **`@lisihao/dsh-solar-intelligent-experience-platform`**, RPC/tool names and data directory are retained for installed-user compatibility. They do not introduce a dependency on another project. The current development version is not a claim of npm or plugin-market publication.

## What it does

- Optional takeover of standard assistant/tool output and generated content. One conversation-level **显示** control switches visual, original and comparison views.
- Local content analysis chooses suitable icons, charts, table columns, relationship graphs, read-only task boards and list/detail layouts. It preserves original text, cells, units, qualifications and complete tables. Unsupported content remains readable; no model call is required to choose a layout.
- Unmodified OpenUI components supply Markdown, charts, forms and streaming UI. React Flow and ELK supply source-relationship diagrams with animated edges, pause, pan/zoom and keyboard selection. Edges describe source relationships and do not assert that work executed.
- Selectable data-only themes control color, typography, roundness, density, depth and transparency. Compatible independent conversation pages receive reversible appearance rules while retaining their original components and behavior.
- An optional, explicitly configured MCP Apps adapter preserves UI metadata and uses an isolated bridge. Existing MCP connections are untouched. This connector remains off by default.

The official DSH navigation and settings stay in place. Disabling takeover restores original output/page presentation. Disabling or uninstalling this plugin removes its owned styles, controls and listeners; retained plugin data remains in its own namespace. It does not patch foreign plugin packages, source or configuration.

## Install and use

Compatibility target: **DSH 0.2.1-rc.2**, macOS arm64. Install a built archive through the official plugin manager. Back up affected profile configuration and quit the app before updating an existing installation:

```sh
dsh plugin --profile desktop add --ignore-scripts /absolute/path/to/plugin.tgz
```

Use the official application's bundled `dsh` CLI for an installed Desktop profile. Lifecycle scripts are disabled; the published renderer does not need its optional install telemetry.

In **Settings → 智能体验**, enable **接管输出与兼容页面外观**. Initial takeover is off. The conversation header has one **开启透明** checkbox, synchronized with content appearance settings. It reveals a wallpaper already supplied by the host; this plugin does not read or change the wallpaper file, and it does not make the native window transparent to the macOS desktop.

### Themes and content appearance

The default theme source is this independent repository's [`theme/` directory](https://github.com/lisihao/dsh-intelligent-UI/tree/main/theme). In **界面主题 → 主题来源**, change the directory address and choose **保存来源**; **恢复默认来源** restores this repository. **浏览来源主题** reads its `index.json`; **下载导入** downloads and verifies the chosen package before adding it to the selector. Network/format/checksum errors are visible and leave installed themes intact. Downloading an identical built-in is acknowledged without duplicating or overwriting it. A custom source can be a GitHub `tree/branch/directory` URL or an HTTP(S) directory with the same catalog format. Source selection persists across restarts; the plugin sends no GitHub credential or private Session data to the theme source.

**界面主题** offers Empryo and **简洁**. Import a UTF-8 `.dsh-theme.json` package, then select it; importing alone does not activate it. Download the current package or an authoring example from Settings. Removing an active imported theme restores Empryo. Theme selection/import/removal are owner-only, revision-checked and durable.

Empryo uses translucent dark gray by default, rounded panels and subtle hover lift. 简洁 uses an opaque dark gray, system fonts and standard comparisons. The color picker and transparency toggle override appearance; selecting a different theme applies its defaults. Reduced-motion preferences suppress lift and animation.

Theme packages contain validated JSON tokens, with no executable code, arbitrary CSS or remote assets. Unknown fields/versions, packages above 32 KiB, duplicate/reserved IDs and more than 32 imported packages are rejected. See the [theme examples](theme/README.md), [format and lifecycle](docs/design/experience-themes.md), and [design system](DESIGN.md).

### Optional MCP Apps

Set this plugin's native `mcpEndpoint` Config to the explicitly chosen HTTP(S) server and enable MCP Apps. URLs containing embedded credentials are refused. This adapter denies external resource networks, device permissions and sampling. Model/tool actions use DSH's normal tool guards; durable action receipts prevent automatically replaying an outcome that is uncertain. Opening a saved result reuses that result rather than rerunning the original tool.

## Data and boundaries

Plugin-owned data is confined to `$DSH_HOME/solar/intelligent-experience-platform/`: versioned settings, per-session artifacts, widget state and action receipts. Config limits default to 1 MiB per artifact and 500 artifacts per Session; exceeding them fails explicitly rather than silently truncating source data. Historical sessions cannot recover metadata that the original host never saved.

Appearance support is a bounded adapter to known public conversation-view outlets and neutral variables. Persona, Mnemon memory, context, execution and benchmark controls remain owned by their respective plugins. Their appearance compatibility does not imply that every business operation has been tested. Billion-context's pre-existing unbound-proxy behavior is not fixed by this plugin. The known same-origin ThoughtDAG canvas has an explicit reversible stylesheet bridge; unknown frames, cross-origin apps and unrelated portals are excluded. See [upgrade boundaries](UPGRADING.md) before changing host or external-plugin versions.

## Development

Use Node **22.19+ within v22, or v24+**, and pnpm **10.31.0**. All required DSH packages are published dependencies pinned to the baseline; no host source checkout is required.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

`check` builds the package, typechecks, runs unit/integration tests and installs the built package into a disposable published-DSH profile. The scratch test runs plain Node and a deterministic local Agent/tool adapter, checks sources/settings/disposal, exercises owner-only theme RPCs and verifies persistence across separate Host processes. It makes no external model call and does not use the installed Desktop profile. Local HTTP transport tests require permission to bind loopback sockets.

For a browser preview:

```sh
pnpm build:preview
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/tools/browser-experience/`. This preview uses a local stub and synthetic examples by default. `EXPERIENCE_MARKDOWN_REPORT`, `EXPERIENCE_REAL_REPORT` and `EXPERIENCE_LAYOUT_OUTPUTS` accept explicit local inputs. Keep research reports, account data, receipts and captures outside Git. The preview is not installed-app acceptance.

`tools/real-layout-output.mjs --help` exports actual source imports, package commands and reference-analysis records; an explicitly supplied Vitest JSON report adds actual task records. `tools/real-output-demo.mjs --help` and `tools/installed-canary.mjs --help` describe optional retained-profile helpers. Those helpers write to an explicitly supplied DSH home and require separate installation/acceptance authorization; `pnpm check` does not invoke them.

## Verification status

Before extraction into this repository, the plugin had build/type/unit, scratch-profile and official Desktop appearance/control-restoration evidence. Theme RPC import/select/restart/remove also passed a keyless scratch run. These are provenance for the copied implementation. The independent repository has now passed its own build/typecheck, 201 tests and built-package scratch-profile/owner-RPC/restart gate. The configurable source was also exercised in the installed official application, including default/custom URL downloads, normal restart persistence and default restoration; see [acceptance](docs/acceptance/2026-10-31-theme-source.md). No paid model, exhaustive foreign-plugin business-flow test, npm publication or market release is implied. Optional MCP Apps iframe/CSP behavior in the installed Desktop remains outside the accepted subset.

The [Empryo reference analysis](docs/design/empryo-foundation.md), [token catalog](docs/design/empryo-tokens.json) and [local reference atlas](docs/design/empryo-atlas.html) document the visual foundation. They are analysis records, not copied Empryo application source or branding assets.

## License

[MIT](LICENSE). Bundled Recursive font files retain the SIL Open Font License in `assets/Recursive-OFL.txt`; dependency attribution and redistribution notes are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). OpenUI, React Flow, ELK and other projects are consumed through pinned published packages behind this plugin's adapters, without carried upstream source patches.

### Settings layout

Theme selection, online sources and local theme files use compact groups and a shared control scale. Settings have an opaque backing in the selected background color to keep underlying report text from interfering with controls; content transparency and hover effects remain independently adjustable.
