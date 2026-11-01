# Integrated component intelligence

The owner requested a single independent open-source project and one intelligent UI plugin containing the Uiverse capability on 2026-11-01. This replaces the older standalone component-plugin architecture. No official DSH or foreign plugin source is modified.

## Shared source, two uses

The immutable official Galaxy snapshot lives under resources/uiverse with its exact commit, original source archive, catalog, compiled utility CSS and MIT license. Every one of its 3,802 source files is retained byte-for-byte. The fifteen live adapter source records in src/uiverse-sources.json are verified against that same archive and retain their author, URL and SHA-256.

The Host installs three read-only tools and a model-invocable, non-human-invocable skill as effects owned by the main UI plugin. Official DSH skill discovery supplies the frontend-task routing and official skill tool loads full instructions only when selected. No extra sidebar, page, prompt hook or task classifier is added. The renderer needs no model call to choose its layout.

Local content analyzers already identify charts, tasks, records and flows. UiverseRenderScope carries that semantic role through the existing ContentView path. Compiled ThemeCard/Button/Input/Toggle/Loader adapters choose a role-appropriate approved set for v1 themes using existing theme tokens; an explicit v2 component set wins. Ordinary prose stays prose, original data and qualification nodes remain intact, and existing interactions retain their state. Paper keeps its scene frame and flat chart chrome. OpenUI chart marks and native form internals remain its public components.

Only the curated adapters execute in the Host DOM. Arbitrary community HTML remains source data or an opaque-origin, script/network-denied sandbox preview. Component source is never treated as agent instructions. The component lookup tools are excluded from the UI's artifact mirror so their metadata does not become a generated report; normal DSH tool logs remain intact.

## Ownership and migration

The main archive contains resources, Host capability, skill, portable CLI, renderer and themes. There is no installable subpackage or runtime dependency on the former V4 repository. Disable/remove the former standalone component plugin before the centralized integrated update; registration conflicts fail clearly without removing another owner. No user data is migrated or deleted. Disabling the main plugin releases the skill, tools, diagnostic service, UI styles and display contributions together.

Formal installation belongs to the centralized Claude installation session. Development uses scratch profiles only. GitHub publication is explicitly authorized for this independent UI repository by the current owner request; DSH repository remotes remain unchanged.
