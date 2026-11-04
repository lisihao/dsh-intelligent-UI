# Insight preview and data browser

This owner-authorized refinement has two jobs: preview existing Insight results before PPTX is available, and move local file import out of session Generated content into a dedicated tool. Implement only in the independent Intelligent UI package. Keep original runs, sessions, models and other plugins unchanged.

## Placement

- **Sidebar → Data browser:** one official keyed `main` panel and sidebar entry, with file import, search/list and a selected-document reader. Use the host navigation and reversible registration. No fake DSH conversation is created.
- **Conversation → Insight preview:** a dedicated view that reads existing runs for that exact session and offers the already-produced node/stage documents. Reuse the research report, source inspection and comparison workspace with a local explicit enabled state. Generated content retains its historical artifacts and loses the import form.

The global file library is an owned artifact bucket (`library:intelligent-ui:files`) under this plugin's existing storage, not a Host session. New imports have a stable local-import provider marker. An owner-only library read also recognizes older imports made by the exact earlier generated/content/Chinese-source-label contract, without moving or changing them. Other unlabeled generated material is not guessed to be a file import. List refresh is explicit; no background library scan or polling is installed.

## Existing Insight sources

Read only optional public `solarConversationTasks.status({sessionId})` and `solarWorkflowControl.overview({sessionId})`. Validate session/command/node identity and retain original output strings. Recognize actual Insight kinds/providers/metadata; do not mix in unrelated native planning tasks. Show completed intermediate analysis while later graphics/PPTX nodes are pending. Preserve per-node provenance, existing statuses and named unavailable/error states. Neither opening nor refreshing preview admits, resumes, stops or generates a run. Existing automatic flow scheduling remains owned by its provider.

PPTX status is a projection of supplied nodes/output manifests, not a newly inferred progress score. Preview shows content, charts, tables and supplied visual output before a deck is ready. It is not a promise that a generated deck has the identical page layout. No model call is needed. Research organization remains the existing explicit, confirmed current-session action; global imported files do not automatically submit prompts.

## Reuse and lifecycle

Reuse maintained OpenUI, current DocumentView/ContentView, source-table fitting, theme tokens and ResearchWorkspace. The owner selects the source document; original/visual/compare remains available. Narrow layouts stack the list and reader and preserve actual controls. Original bytes/values/units/conditions are available without lossy export. Optional peers can disappear while the UI is mounted; show unavailable and preserve clear source identity. Delayed results from an old session/file selection must not replace the current reader.

Register only plugin-owned official slots/services. On disabling, remove owned navigation and views; return from an active owned global panel before removing it, without closing another panel. No DOM reparenting, injected buttons into another plugin, iframe takeover, foreign storage migration or official App modifications.

## Acceptance

Unit checks cover library persistence/legacy recognition and source preservation; readonly peer/session identity, intermediate outputs/PPTX pending, errors/absence; navigation disposal; import relocation, selection/race handling and no automatic model calls. Build and exact-package scratch checks use published DSH. Browser checks exercise the actual new components at desktop and320px, file import/reopen, theme/mode switching, original report equality and pending-PPTX fixture results. Native source reads/navigation and real data acceptance belong to the central installer; screenshots/reports/receipts remain local, not Git/GitHub. Other plugin sources may be inspected as evidence but are not edited or copied.
