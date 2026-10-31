# Empryo reference foundation for DSH content presentation

This is the shared reference baseline for plugin-owned DSH content, derived from the public Empryo site. It expands the reference beyond a few chart screenshots into a language for reading, comparing, following a process, selecting an extension, and inspecting evidence. It does not introduce a product-wide V4 core or authorize additional features.

The user pinned Empryo's visual language, including its cards, icons and presentation patterns. Apply that direction concretely within the official DSH application. Preserve the official shell, settings, appearance preference, data boundaries and plugin lifecycle.

## Authority and evidence

Read this document with the [page catalog](./empryo-pages.json) and [measured tokens](./empryo-tokens.json). The catalog contains original analysis for **321 valid public HTML pages**: 77 documentation pages, 77 other pages and 167 changelog pages. It separately records the observed [configuration-link 404](https://empryo.com/reference/configuration). Resources, scripts, machine-readable documents and API endpoints are not HTML pages.

Coverage means recursive closure over visible same-origin links, not discovery of every hidden or unlinked route. Each valid page has a DOM record and full-page capture; 105 received direct visual composition inspection. Repeated release and documentation templates were analyzed through all route records and representative visual inspection. This is not 321 independent pixel-level, responsive or interaction acceptances. Raw screenshots, account context, private reports and browser artifacts remain outside Git; the repository retains the design extraction and source links.

Use these three labels consistently:

| Label | Meaning |
| --- | --- |
| **Reference measured** | A source-site value, rendered composition or explicitly exercised source-site behavior. It describes Empryo at the capture boundary. |
| **Adaptation target** | The behavior or visual rule DSH should take from the reference. It is not evidence of implementation. |
| **Current implemented** | Existing incubator behavior documented by its current design contract. This label does not substitute for current build, browser or installed-app acceptance. |

The incumbent [PRODUCT.md](../../PRODUCT.md), [VISUAL-REFERENCE.md](../../VISUAL-REFERENCE.md) and [DESIGN.md](../../DESIGN.md) define the present product boundary and source implementation. Their implementation-specific values remain explicit adaptations. A source-site measurement does not silently overwrite those values.

## The visual language

Empryo combines precise information with a small amount of organic expression. The working foundation is charcoal, graphite and pale ink; subdued pigments distinguish focus and evidence. Hand-shaped underlines, rings, small dots and curved connections provide identity. Tables, code, paragraphs and controls remain orderly. Large product images and diagrams carry meaning rather than filling decorative tiles.

The site changes measure with the task: wide comparison and directory areas, narrow long-form prose, a smaller contextual rail, and occasional full product examples. Most content sits directly on the canvas with spacing and hairlines. Raised surfaces identify an actual panel, selected object, table, code region or focused figure. The full site is not a uniform wall of chart cards.

**Adaptation target:** preserve the visible material, icon and typographic character inside plugin-owned output while choosing the composition for the content. A prose answer should still read as prose. A queue should support selection. A process should expose its edges and handoffs. A numerical comparison should show its values and conditions.

## Measured primitives and their translation

### Color and surfaces

The measured world is Undertow. The source [brand assets page](https://empryo.com/glossary/assets) exposes six worlds with day/night variants, but DSH continues to use its host-resolved light/dark preference. No second persistent world selector is implied.

| Semantic reference token | Undertow dark | Undertow day |
| --- | --- | --- |
| Paper | `#0c0e11` | `#f4f6f8` |
| Raised paper | `#1a1f26` | `#fbfcfd` |
| Sunken paper | `#08090c` | `#e9edf1` |
| Ink | `#e8ebee` | `#1a2028` |
| Soft ink | `#adb5bf` | `#4a5560` |
| Faint ink | `#838c97` | `#67727d` |
| Pigment | `#98b0c2` | `#4a6a80` |
| Rule | `#2a323c` | `#cdd5dc` |

Only these eight day values were measured after the ordinary day-mode control on Morphs. Do not invent a measured day value for an unrecorded token. Dark companion roles include alternate pigment `#c49aa4`, nucleus `#e0a9b6`, success `#93b3a2`, warning `#cfb595`, error `#d68f8f` and information `#8fadc4`. The token file preserves source color-mix expressions, glass and shadows.

**Adaptation target:** use semantic canvas, raised, sunken, ink, rule and focus roles. Keep selection, warning, failure and ordinary chart series distinguishable through text and shape as well as color. Porous atmospheric background is optional scenography; it must not obscure prose, plotted values, focus or task state. Real graph edges and atmospheric decoration have different meanings.

**Current implemented:** the incubator records its own dark/light palette, graphite cards and ice-blue/sand/rose/teal chart series. Some values differ from the measured site, such as its dark card `#1b2027` and primary `#9dbacf`. These are current adaptation values, not exact reference tokens. Styles remain scoped to plugin content and read the host scheme.

### Typography, geometry and density

Reference prose, display and code use Recursive with different variable-font voices. Undertow records `wght=360`, `CASL=0`, `MONO=0` and title tracking `-.02em`; code uses the mono face/axis. At the 1280 by 720 CSS-pixel capture viewport, common computed roles were:

| Role | Measured example |
| --- | --- |
| Body | `14.875px / 23.8px`, weight 400 |
| Lede | `15.4px / 23.1px` |
| Ordinary page H1 | `34.72px / 34.72px`, weight 360 |
| Documentation inner-page title | `25.64px / 27.6912px`, weight 360 |
| Home hero | `49px / 47.04px`, weight 360 |
| Code | `12.6px / 20.16px` |
| Ordinary reading column | about `532px` |
| Documentation rail | about `217px` |
| Release summary rail | about `238px` |

Source maximum-width tokens include `38rem` for reading, `50rem` for text, `68rem` for a page and `84rem` for a wider composition. These are not all resolved pixel widths. Gutter is `clamp(1rem, .4rem + 2.2vw, 2.5rem)`; section spacing is `clamp(2.75rem, 1.6rem + 3.4vw, 5.5rem)`. Radius roles are 6, 12, 20 and 34px, with a 999px pill and a separate irregular blob shape. Do not apply the largest radius to every region.

**Adaptation target:** keep a bounded reading measure and a compact data measure, with headers, bases and qualifications allowed to wrap. Chinese typography requires its own rendered review; a small English source label is not a universal Chinese control size. Wide tables scroll locally instead of widening the conversation.

**Current implemented:** Recursive is bundled locally with its OFL and registered as DSH Recursive, followed by platform CJK sans fallbacks. The incubator uses its documented Chinese body rhythm, 12px evidence-card radius, separate header/body/footer, intrinsic stacking and narrow-width adjustments. Do not describe this as a byte-for-byte reproduction of the website's typography or spacing.

### Icon system and identity

**Reference measured:** ordinary interface icons are Lucide outline SVGs, confirmed in the DOM. Empryo's cell/ring mark, animated mark and wordmark are independent brand assets; they are not semantic Lucide icons. Small dots and relationship marks also have context-specific meanings.

**Adaptation target:** retain one coherent Lucide outline family for task meaning, with consistent optical size and stroke. Pair icons with visible labels where the action or result would otherwise be ambiguous. Decorative heading icons are hidden from assistive reading; icon-only controls require an accessible name. Use this project's own identity rather than shipping the Empryo mark or implying endorsement.

**Current implemented:** the incubator documents Lucide heading/card icons through maintained OpenUI and a Lucide layout icon in the shared display control. A new icon family, copied brand artwork or raster screenshot asset is not required.

## Template families across the site

These are content families, not a request to reproduce the site's navigation or all its routes inside DSH. The page catalog retains every route's individual analysis.

| Family and primary reference | Reference composition | DSH adaptation target |
| --- | --- | --- |
| [Product narrative](https://empryo.com/) | Focused opening, real application example, testimony, code map, checking, device reach and cost evidence | Introduce a plugin through a concrete task, its real output and a verified next step. Keep marketing outside routine answers. |
| [Capability index](https://empryo.com/features) | Category rail with compact grouped capability entries and documentation links | Help users find a relevant capability without flattening all capabilities into equal dashboard cards. |
| [Extension directory](https://empryo.com/morphs) | Separate showcase, two filter axes, list/detail, preview, installation and compatibility | Select in context and see the useful result before a consequential install action. |
| [Extension detail](https://empryo.com/morphs/proxysoul/Empryo/github-queue) | Identity/capabilities plus preview; behavior, data, installation, requirements, network and source | Distinguish UI, data feeds and agent rules. Rule-only extensions do not need a fictitious panel. |
| [Benchmark index](https://empryo.com/benchmarks) | Conditions and limits, cumulative comparisons, billing, rounds, methodology and reproduction | Let summary values lead to the same runs and source records; preserve comparison conditions. |
| [Benchmark round](https://empryo.com/benchmarks/pi-round-2) | Specific tasks/configuration, results, representative cases, failures, run records and reproduction | Keep each attempt and anomaly; distinguish recorded demonstrations from graded benchmark tasks. |
| [Experiment and blog index](https://empryo.com/blog) | Counted categories and compact two-column article rows | Organize reader-facing experiments and updates without adding news noise to task output. |
| [Long-form engineering article](https://empryo.com/blog/the-marionette) | Author/date/context, left contents, narrow prose, relevant code/images/tables, limitations and related reading | Preserve the argument and qualifications; introduce figures where the argument needs them. |
| [Provider directory](https://empryo.com/providers) | Connection-type filters, search, count and lightweight entries | Classify how a provider connects, then show actual configuration and verification state. |
| [Provider guide](https://empryo.com/providers/custom) | Connection/payment summary, applicability, basic steps, optional advanced configuration and verification | Put the smallest working path before advanced fields; preserve host authentication and model settings. |
| [Glossary index/detail](https://empryo.com/glossary) | Searchable A–Z entries; short definition, explanation, product use, related docs/terms | Offer progressive explanation close to a confusing concept instead of expanding every answer into a manual. |
| [Workflow index/detail](https://empryo.com/workflows) | Task entries; three-step overview, prerequisites, each step's check, choices, prompt, boundary and guide links | Explain a bounded task with observable checks, especially where sending, executing and completing differ. |
| [Product comparison](https://empryo.com/compare/empryo-vs-codex) | Shared questions, two descriptions, relationship conclusion, both parties' fit and evidence limits | Compare relevant conditions with date/source scope; do not transform vendor statements into verified current rankings. |
| [Installation and setup](https://empryo.com/download), [wizard](https://empryo.com/wizard) | Local platform/way selection, exact artifacts and checks; six-step guided path | Use a wizard only when configuration warrants it; keep recommendation, complete artifacts and success criteria reachable. |
| [Quality evidence](https://empryo.com/immunity), [experiment report](https://empryo.com/typesafe) | Aggregate results, lifecycle, one-run evidence, coverage and removed approaches | Expose failures, exclusions and unimplemented work beside the useful result. A replay is not a receipt. |
| [Documentation map](https://empryo.com/docs) | Initial steps, stable chapter rail, radial overview and grouped directory | Orient before exposing the complete reference. A chapter map is not an execution graph. |
| [Documentation tutorial/recipe](https://empryo.com/docs/quickstart) | Task sequence, local tabs, small copyable examples and related guides | Separate prerequisites, action, expected result, recovery and reference. |
| [Documentation explanation/reference](https://empryo.com/docs/reference/configuration) | Reading rail plus prose, matrices, fields, commands and disclosures | Keep precise dictionaries searchable and outside the primary task canvas. Large schemas need navigable structure. |
| [Component/schema handbook](https://empryo.com/docs/tools/morphs), [preset guide](https://empryo.com/docs/tools/profiles) | A minimal example followed by surfaces, component families, field matrices, selectable examples and advanced detail | Discover reusable patterns while checking each one against an available DSH extension point. A field-compatible description is not an operational integration. |
| [FAQ](https://empryo.com/docs/faq), [troubleshooting](https://empryo.com/docs/troubleshooting), [agent-facing help](https://empryo.com/docs/agents/docs-mcp) | Question/diagnosis or consumer-specific sections within the same documentation shell | Connect a concrete obstacle to an explanation, recovery and canonical reference; maintain the same terminology for humans and agents. |
| [Interactive course](https://empryo.com/docs/terminal-guide) | Wide terminal stage, lesson selection, playback controls and lesson index | Treat an executable teaching surface as a distinct artifact, requiring its own behavior acceptance. |
| [Release index/detail](https://empryo.com/changelog) | Chronological entries, editorial introduction, summary rail, reading body and adjacent versions | Use one release template per independent plugin version; vary density instead of inventing a layout for each release. |
| [About/policy/support](https://empryo.com/about) | Clear prose, scoped promises, appropriate contact actions and linked policy detail | Explain ownership, data paths and support without copying Empryo's policy or commercial terms. |
| [Brand system](https://empryo.com/glossary/assets) | Asset variants, semantic color-role previews, variable type controls and usage rules | Document this project's own roles and assets; a palette is a system of uses rather than a screenshot swatch. |
| Error recovery | Specific unavailable path, search and meaningful destinations | Show the real failure and a recoverable next step; do not silently substitute empty or successful output. |

The 166 release details share one layout despite large length differences. The longest captured release exposed escaped raw-history text. The largest configuration and Morph manuals are also much longer than ordinary guides. Neither repeated layout nor extensive content makes raw machine history suitable reader-facing copy.

## Presentation patterns and content selection

Choose a composition from the source's structure and the reader's task. Rendering alone causes no model call. Preserve raw content, exact source strings, units, approximation notices, exclusions and provenance. A display mode changes presentation rather than meaning.

| Source/task | Preferred composition | Conditions |
| --- | --- | --- |
| Explanation or argument | Long-form prose with a bounded measure | Keep paragraph order and qualifications; do not turn each paragraph into a card. |
| Categorical measurements | Horizontal comparison bars or a table | Require explicit numeric values, units and comparable conditions. Preserve full category labels. |
| Ordered time values | Maintained time-series chart plus source | Require actual ordered observations. Do not infer timestamps or missing values. |
| Event or handoff sequence | Compact process/flow view | Edges must mean a documented transition or source relationship; show direction and terminal conditions. |
| Tasks with explicit status | Kanban or grouped task list | Require identifiable tasks and actual status; card placement must reflect the state source. |
| Select one object and inspect it | Master/detail | Preserve selection and filters; narrow layouts provide an explicit return path. |
| Small stable taxonomy | Radial overview with a linear alternative | Appropriate for orientation, not dense operational graphs or precise quantity comparison. |
| Exact fields, parameters or many rows | Table/dictionary | Keep original cells, local scrolling, readable headers and source access. |
| Unsupported, uncertain or failed extraction | Prose/table/original view | Surface the limitation; do not invent a diagram to fill the space. |

### Benchmark variants

The reference uses several chart grammars. Preserve their distinct purposes rather than standardizing every chart into a rounded progress bar.

1. **Organic strokes:** the [benchmark opening](https://empryo.com/benchmarks) and pi/Forge round stories use flattened, tapered strokes. Object labels and values sit directly beside them. Use for a few comparable headline measures, with a shared scale and explicit units.
2. **Tracks and endpoints:** cumulative comparisons use narrow tracks and identifying endpoint marks. Use for compact summaries that can open the underlying attempts.
3. **Rectangular bars, axes and reference lines:** [historical head-to-head recordings](https://empryo.com/benchmarks/head-to-head) and dense experiment figures retain quiet grids, ticks and dashed comparisons. Use when precise reading matters more than a brush motif.
4. **Run-table microplots:** [pi round one](https://empryo.com/benchmarks/pi-round-1) and [round two](https://empryo.com/benchmarks/pi-round-2) retain per-run values and success indicators, with small graphical marks as secondary cues. Failure and interrupted-run cost remain visible.

The current OpenUI horizontal bar/line implementation is a compatible presentation subset, not implementation of every reference variant. Chart animation is currently disabled in the incumbent design. Decorative shape changes must preserve measurement scale, source-cell selection and full-table access.

### Connected process and flow

The [home code map](https://empryo.com/#genome) combines code panels and curved connections; emphasis identifies a path through meaningful objects. The documentation [goal loop](https://empryo.com/docs/agents/goal-loop) and [workflow recipe](https://empryo.com/docs/agents/workflows) use process diagrams and role matrices to explain lifecycle and responsibility. These are different compositions from a free-form decorative network.

**Reference measured:** two successive `stroke-dashoffset` samples changed on active home paths. The page's ordinary motion control toggled `aria-pressed`, set `data-motion=still` and paused path animation; a second click restored the motion attribute. The control still used the label “Pause motion” while paused. Record that as observed behavior, not an accessibility pattern to reproduce blindly.

**Adaptation target:** movement may explain a handoff, active transition or current traversal. It must be stoppable and respect reduced motion. A state label and stable endpoint remain readable without animation. Distinguish planned, active, completed and failed state with words and redundant cues. Do not synthesize graph edges from an ordinary numerical table.

**Current implemented:** existing report prose, evidence charts and source access do not establish a connected process renderer. Flow rendering, source-derived graph selection and active-edge motion remain adaptation work unless separately implemented and accepted.

### Kanban and working panels

The Sprint board reference appears in the [Morphs showcase](https://empryo.com/morphs) and the user's supplied image. It places a working panel beside chat: a clear title and day/status summary, four compact counts, progress, search, then four task columns. Cards show a task title and concise ownership/priority metadata; columns retain counts.

Take the information hierarchy and spatial relationship. Do not report drag-and-drop, refresh, search, persistent state or two-way synchronization as implemented from an image. A DSH board requires an actual state source, permitted actions, error handling, keyboard alternatives and persistence acceptance. Where actions are unavailable, a clearly read-only board or grouped list is preferable to inactive controls that imply capability.

### Master/detail and extension preview

The [Morph directory](https://empryo.com/morphs) preserves a selected item beside its preview, capability explanation, installation command and compatibility. Source-site interaction inspection confirmed Focus guard selection and category radio changes. An agent-category filter can retain GitHub queue because that item includes agent rules; categories reflect capabilities and may overlap.

Adapt capability metadata rather than treating categories as exclusive product types. Keep empty feed, loading, failure and absence of a UI panel distinct. A signed/compatible label or a live preview on the reference site does not establish a DSH installation, verification or network request.

### Radial overview and long-form reading

The [documentation overview](https://empryo.com/docs) uses a radial chapter tree as an orientation aid with conventional navigation still available. The radial composition should remain small and stable. Provide a linear equivalent and clear labels; it does not become a dependency graph merely because it has edges.

Long-form articles, documentation and release notes use related but different rails. Blog pages place contents beside an editorial argument; documentation retains chapter navigation and precise references; releases use a concise consequence/summary rail with adjacent-version navigation. Keep those jobs distinct. Use tabs or disclosures for alternatives and advanced detail, not to hide qualifications that change the conclusion.

## Motion and interaction translation

The source defines short response timings around `.12s`, `.22s`, `.42s` and `.82s`, an exit/entry curve `cubic-bezier(.16,1,.3,1)`, a theme curve `cubic-bezier(.65,0,.35,1)` and a spring expression preserved in the token file. Wordmark/iris definitions are around `.56–.64s`, brush drawing around `.9s`, and mote breathing commonly `4.4s`. These CSS definitions do not prove every sequence played or every interaction worked.

Prefer the shorter timings for selection and feedback; reserve longer identity transitions for nonblocking, optional presentation. Ordinary task content must not remain in continuous motion merely to resemble the marketing site. Keyboard focus, hover, selected and disabled are distinct states. Copy feedback, local tabs, disclosures and filter results require meaningful visible outcomes. Source-site day switching was measured; this does not prove every page or DSH light rendering has passed.

The current scoped card transition and reduced-motion treatment are documented in the incubator. Active-edge motion, radial navigation, Kanban actions, source-derived master/detail and broad animated presentation are not made current merely by appearing in this baseline. The source-site behavior audit, the incubator MVP and the full DSH target are separate acceptance scopes.

## Boundaries for reuse

Reuse the reference's actual presentation language, including its restrained graphite surfaces, coherent outline icons, connected composition, direct data labels and purposeful hierarchy. Keep the difference between a visual adaptation and a feature port explicit.

- Keep the official Desktop application unmodified. Plugin content does not replace official navigation, settings or the host's appearance preference.
- Retain maintained OpenUI and MCP Apps behind thin adapters. The visual direction does not authorize copied application source, a replacement chart engine or unsupported upstream patches.
- Do not ship Empryo screenshots, brand marks, distinctive promotional images or private browser artifacts as interface assets. Keep the bundled Recursive font and its license together.
- Do not copy product, billing, privacy, security, compatibility, platform or benchmark claims into DSH. Reference-site claims are not DSH evidence.
- Keep DSH's independent plugin release/version boundaries. A website's single product chronology does not define a V4-wide release.
- Preserve exact content, qualifications, original/comparison access and model-visible/logged behavior. Presentation work must not incidentally change models, reasoning effort, parallel limits, memory or authentication.
- Validate each implemented pattern on its actual host surface, normal/narrow widths, light/dark modes and relevant keyboard/motion states. Build or catalog coverage alone does not establish installed-app usability.

This baseline supplies design authority and pattern-selection rules. Implementation and acceptance remain attached to the exact changed surface and its evidence; no new runtime capability is claimed by adding this document.
