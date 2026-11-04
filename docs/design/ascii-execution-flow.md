# ASCII execution visualization

## Request and reference

The owner added a dynamic execution-diagram reference to the already implemented WebGL ASCII theme: https://x.com/xsmryze/status/2117335920827371778 (36.599-second public video, inspected through its normal public player on 2026-11-02). The provided screenshot and observed later frame show role-coded panels, directional moving points, branching and joining paths, changing task progress, counters and a source-event log. The post is a visual reference, not an instruction to reconfigure models, orchestration, agents or another plugin. Its product/model and token-saving claims are not adopted as verified facts.

## Direction

- **Thesis:** make reported execution structure and changes readable as an animated ASCII diagram without manufacturing execution data.
- **Own world:** the existing graphite ASCII ground, true monospace text, restrained rectangular node frames, four existing series colors used consistently by reported role, bright points moving on actual edge geometry.
- **Story:** follow the source graph, read each reported node state and progress, inspect the corresponding source events and exact original data.
- **First viewport:** the existing conversation output, compact diagram controls and readable nodes. No new sidebar, model selector or orchestration setup.
- **Form:** existing React Flow and ELK layout, a thin owned WebGL2 moving-point layer over the actual visible edge paths, and the fixed Canvas UI Asciify projection. Native text and controls remain readable. Pause/reduced-motion/hidden/offscreen disposal is part of the feature.

## Source contract

A projection recognizes an explicit `kind: "execution-flow"` record or a nodes/edges record containing supported execution status/progress fields. Original records and unknown fields remain available in raw mode; projection is read-only and never advances source state. Invalid recognized input has a named error and leaves the original payload readable. The host's existing 1 MiB source boundary applies, not a new row/node limit.

Canonical projected nodes have `id`, `label`, optional `description`, optional `role` (`lead`, `advisor`, `worker`, `tool`), optional `model`, optional normalized `status` (`queued`, `running`, `succeeded`, `failed`, `blocked`, `cancelled`, `skipped`), optional `progress: { current, total, unit? }`, and optional `metrics: [{ label, value, unit? }]`. Common literal status aliases may normalize for display, while raw values stay intact. Progress numbers are finite nonnegative source values; ratios use the supplied current and total. No total or a zero total produces no invented percentage. Metrics are source values, not estimates.

Edges have `source`, `target`, optional `label`, optional `status` (`idle`, `active`, `done`, `error`). Only explicitly active execution edges animate. Ordinary source relationships may retain the separately labeled directional reading animation; they are not called running tasks. Event records carry `id`, `message`, optional `nodeId` and optional source `timestamp`; preserve source order and references, reject duplicate identifiers/dangling references. Do not generate a current timestamp or fake log event.

The source may contain an optional title, `updatedAt` and optional `events`. The view says execution snapshot and uses source freshness when provided. When the producer supplies a new snapshot through the existing render path, node text, progress and events update without rebuilding the graph layout for every percentage change. No subscription to a guessed private event bus is permitted.

## Integration and display

The normal ContentView path recognizes the source and selects the richer view automatically. Reuse the existing flow graph, node-selection, source disclosure and unified raw/compare behavior. Source graph structure drives layout; state-only changes preserve positions. A source-directed vertical layout may be added without changing the default layout for existing diagrams. Large graphs retain their overview/search/full-list path.

The WebGL overlay samples actual path geometry, clips to the graph viewport, leaves hit targets untouched while thin SVG connections remain as a native underlay beneath the transparent ASCII projection. Tiny moving lights are explicitly excluded from the atlas and remain native WebGL, preventing character-cell resampling from erasing execution activity. This hybrid preserves connectivity; it does not claim every pixel is an ASCII glyph. Moving points must remain smooth in real browser playback; a static snapshot at 5 Hz is insufficient for this layer. Stop animation for pause, reduced-motion, document hiding, leaving the viewport, context loss or disposal. Failure restores a readable original graph and reports the missing renderer; do not request experimental browser flags.

Node status and progress remain native DOM. Progress feedback uses transform rather than animating layout width. Role colors come from the existing theme tokens. Events remain readable and inspectable; new events do not pull a user away while they are reading earlier events. Unknown status/progress remains visibly unknown.

## Acceptance

1. An ordinary graph never acquires fake execution state, progress or events. A supported source selects the new view automatically; exact original JSON remains accessible.
2. Real source updates change only the corresponding displayed values, progress and log entries. Invalid references and malformed progress do not become plausible-looking output.
3. A deterministic, clearly labeled local replay demonstrates branch/join particles and reported status changes. It is not evidence of a live model run. Record the actual browser frames/clip privately.
4. Actual WebGL rendering, pause/resume, reduced-motion, visibility, pointer/keyboard, context loss and teardown are checked at normal and narrow widths. Snapshot comparisons alone cannot prove motion.
5. Preserve the accepted candidate i and its exact package. New candidate j is separately built and verified; centralized official DSH installation remains serial and separately recorded. No other plugin/application source changes, model calls or model configuration changes are part of this work.
