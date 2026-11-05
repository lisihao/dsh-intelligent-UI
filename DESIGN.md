---
name: DSH Intelligent Experience Platform
description: Source-led Undertow presentation inside the official DSH conversation.
colors:
  content-default: "#24262b"
  ascii-ground: "#191c19"
  ascii-gpu-ground: "#101214"
  soft-relief-ground: "#34383d"
  ascii-primary-dark: "#b9d985"
  ascii-primary-light: "#405d25"
  ascii-cyan-dark: "#89cdd1"
  ascii-sand-dark: "#d8bf91"
  ascii-rose-dark: "#cfafc6"
  ascii-cyan-light: "#275c61"
  ascii-sand-light: "#6f511f"
  ascii-rose-light: "#704b66"
  host-border-fallback: "#b9bdc4"
  content-bg-light: "#f4f6f8"
  content-card-light: "#fbfcfd"
  content-line-light: "#cdd5dc"
  content-text-light: "#1a2028"
  content-muted-light: "#4a5560"
  primary-light: "#4a6a80"
  content-soft-light: "#e9edf1"
  content-bg-dark: "#0c0e11"
  content-card-dark: "#1a1f26"
  content-line-dark: "#2a323c"
  content-text-dark: "#e8ebee"
  content-muted-dark: "#adb5bf"
  primary-dark: "#98b0c2"
  content-soft-dark: "#08090c"
  sand-light: "#946b35"
  sand-dark: "#cfb595"
  rose-light: "#8b5263"
  rose-dark: "#c49aa4"
  teal-light: "#3c6c57"
  teal-dark: "#93b3a2"
  host-label: "var(--dsw-alias-label-primary, #202124)"
  host-border: "var(--dsw-alias-border-l2, #b9bdc4)"
typography:
  ascii-body:
    fontFamily: "Menlo, 'SFMono-Regular', Consolas, 'Liberation Mono', 'DSH Recursive', 'Noto Sans Mono CJK SC', 'Sarasa Mono SC', 'Heiti SC', monospace"
    fontSize: "16px"
    lineHeight: 1.5
    fontVariation: "'MONO' 1, 'CASL' 0"
  ascii-headline:
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  ascii-section:
    fontSize: "20px"
  ascii-section-narrow:
    fontSize: "18px"
  paper-display:
    fontFamily: "'DSH Paper Sans', 'PingFang SC', system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 360
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  paper-chapter:
    fontSize: "48px"
  paper-scene:
    fontSize: "40px"
  paper-scene-narrow:
    fontSize: "26px"
  paper-record-title:
    fontSize: "24px"
  headline:
    fontFamily: "'DSH Recursive', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "30px"
    fontWeight: 360
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title:
    fontSize: "21px"
    fontWeight: 360
    lineHeight: 1.4
  body:
    fontFamily: "'DSH Recursive', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    lineHeight: 1.7
    fontVariation: "'CASL' 0, 'MONO' 0, 'slnt' 0, 'CRSV' 0"
  settings-body:
    fontSize: "14px"
    lineHeight: 1.6
  settings-title:
    fontSize: "20px"
    fontWeight: 600
  report-subheading:
    fontSize: "17px"
  code-body:
    fontSize: "16px"
  narrow-headline:
    fontSize: "23px"
  layout-heading:
    fontSize: "18px"
  card-title:
    fontSize: "13px"
    lineHeight: 1.6
  card-foot:
    fontSize: "12px"
    lineHeight: 1.75
  basis:
    fontSize: "11px"
  mode-label:
    fontSize: "13px"
  code:
    fontFamily: "'DSH Recursive', 'SF Mono', monospace"
    fontVariation: "'MONO' 1, 'CASL' 0"
  raw-content:
    fontSize: "12px"
rounded:
  ascii-panel: "12px"
  ascii-card: "8px"
  ascii-node: "8px"
  ascii-control: "6px"
  settings-preview: "12px"
  reading-narrow: "24px"
  flow-node: "20px"
  source-table: "18px"
  list-item: "16px"
  color-field: "10px"
  inline-code: "4px"
  control: "5px"
  card: "22px"
  reading-surface: "28px"
  field: "6px"
  mode-control: "999px"
spacing:
  compact: "4px"
  label: "8px"
  section: "12px"
  panel: "16px"
  chart-gap: "16px 20px"
  block: "24px"
components:
  action-button:
    backgroundColor: "transparent"
    textColor: "inherit"
    rounded: "{rounded.control}"
    padding: "4px 9px"
  output-mode-select:
    backgroundColor: "transparent"
    textColor: "inherit"
    padding: "4px 6px"
  mode-control:
    rounded: "{rounded.mode-control}"
    padding: "3px 5px 3px 10px"
  content-surface:
    rounded: "{rounded.reading-surface}"
    padding: "clamp(16px, 2.5vw, 24px)"
  chart-card:
    rounded: "{rounded.card}"
  chart-header:
    padding: "10px 16px"
  chart-footer:
    padding: "4px 16px 8px"
  source-table:
    rounded: "{rounded.card}"
  board-search:
    backgroundColor: "var(--iexp-soft)"
    textColor: "var(--iexp-text)"
    rounded: "{rounded.field}"
    padding: "8px 12px"
  flow-node:
    rounded: "{rounded.card}"
    padding: "16px 18px"
---

# Design System: DSH Intelligent Experience Platform

## Overview

**Creative North Star: "Source-led reading in Undertow"**

The user-pinned Empryo reference now informs distinct compositions rather than a uniform card wrapper: unboxed reading, compact direct-label comparisons, maintained charts, explicit relationships, task status groups, object selection and chapter orientation. The [whole-site foundation](docs/design/empryo-foundation.md) and [measured tokens](docs/design/empryo-tokens.json) govern the reference; this document records the implemented subset, not a whole-site feature port.

The official DSH application owns navigation and native settings chrome. The user’s later refinement explicitly selects a configurable translucent dark-gray content surface, rounded elevated cards and restrained hover lift; it supersedes the earlier square/flat material and host-following content preference. Local Recursive typography, Lucide outlines and the Empryo composition rules remain. OpenUI remains the chart/table/Markdown renderer; React Flow and ELK supply the relationship canvas and layout. Original text, source cells, qualifications and the single conversation display selector remain reachable.

Classic ASCII and GPU ASCII are separate selectable presentations alongside the default Empryo. Classic ASCII retains fixed-width reading and source-backed character comparison bars. GPU ASCII uses the actual Canvas UI Asciify WebGL projection for supported graphics while source geometry, text and values remain intact. Eligible GLB models and validated PNG/JPEG illustrations use the separate ASCII Object effect, with the labeled original illustration protected from the atlas. Candidate h passed the affected native header acceptance at both formerly failing window sizes, with actual pointer, keyboard, slider and cleanup checks. That unchanged header result does not establish native acceptance of candidate k's newer graphics effects, which is pending.

**Key Characteristics:**

- Continuous prose and compact comparisons share the configurable quiet gray content surface; data cards use rounded elevation.
- Composition follows explicit source structure rather than decorative tiles.
- Complete tables, records and relationship sources remain inspectable.
- One host-header selector controls presentation, original and comparison modes.
- A separate compact theme selector switches the active presentation for the conversation.

Browser finish review on 2026-10-31 accepted the expanded candidate across ten report, flow, board and record captures, including narrow, desktop and the user's wide viewport. Installed official DSH acceptance passed on 2026-10-31 for the actual source graph, task board, record selection and chapter fan; a subsequent refresh-state correction preserved disclosures across polling without changing visual tokens.

## Colors

Frontmatter retains the measured Empryo reference and chart-series palette. Active content surface roles are generated in `src/appearance.ts` from the persisted background choice. Default is #24262b at alpha 0.72, with blur(4px) saturate(110%); disabling transparency uses alpha 1 and no blur. Ink, muted ink and blue accent adapt to light/dark choices and actual composite contrast. For a midtone that cannot preserve 4.5:1 at alpha 0.72 over both white and black underlays, opacity increases only as needed. Cards and hover surfaces use subtle tonal changes.

### Primary

- **Slate blue / ice blue:** links, outline icons, selection, focus, comparison strokes and the first chart series.
- **Classic ASCII leaf green:** the light/dark accent pair on its graphite ground. GPU ASCII instead uses its own pale blue-gray accents and darker ground; appearance contrast adjustment still applies.

### Secondary

- **Sand, rose and teal:** additional chart series with the host scheme's corresponding contrast.

### Neutral

- **Pale canvas / charcoal:** the continuous reading surface.
- **Dark graphite:** Soft relief's configurable default surface, avoiding a bright white starting background.
- **Raised paper / graphite:** chart cards, task cards and relationship nodes.
- **Sunken paper:** code, table headings, board columns and the relationship canvas.
- **Slate rule:** table rows, section boundaries, controls and source disclosures.
- **Primary and softened ink:** source text and secondary explanation respectively.
- **Host label and border:** native wrappers and the shared mode control retain official tokens.

**The Content Preference Rule.** Plugin Settings → 内容外观 offers 半透明背景, a native color well, editable #RRGGBB and 恢复默认外观. The user explicitly requested this content preference; it does not change official navigation, host theme or credentials. Legacy settings without appearance use the default without an implicit file migration.

OpenUI's OS-preference fallback root selectors are removed during CSS bundling so they do not override the resolved host theme. Vendor portal styles remain available for OpenUI dialogs and dropdowns.

## Typography

**Content Font:** bundled unmodified Recursive Latin variable font, registered as DSH Recursive, with platform CJK sans fallbacks. Its WOFF2 and OFL travel together without a remote font request. The body uses CASL 0 and MONO 0; code switches to MONO 1. Shell controls retain platform sans.

Both ASCII modes switch the owned reading surface to Recursive's MONO 1 axis with a monospace fallback, tabular numerals and zero letter spacing. Their headings use the ASCII headline/section roles; source text remains ordinary readable text.

**The Native Label Rule.** The GPU character effect projects supported graphical geometry; original text, labels, units and exact source values remain native and readable.

### Hierarchy

- **Headline and title:** light Recursive report headings use the frontmatter roles; the main heading is limited to 29ch. Third-level headings use 17px, lower headings 15px, all at the same heading weight and tracking.
- **Body:** the frontmatter body role; top-level paragraphs, lists and blockquotes have a 74ch maximum measure.
- **Figure and task titles:** compact data labels; chart titles use 13px, task titles 14px and flow labels 15px. Figure basis text uses its smaller muted role.
- **Tables and disclosures:** 12px text with tabular numerals for quantitative regions. Compact comparison labels and values use 13px with 1.55 line height.
- **Raw content:** wrapping preformatted text preserves the original strings.

At the narrow breakpoint, body text becomes 14px and the main report heading 23px. These adaptations do not change the official host type system.

## Layout

The 28px rounded reading surface (24px at narrow widths) is centered with a 1240px maximum width and the responsive inset in frontmatter. The official-slot wrapper keeps its 12px grid gap/padding. Prose remains in document order; it is not divided into individual cards.

Figures use an auto-fit grid with `minmax(min(100%, 310px), 1fr)`, the chart-gap token and a 1160px maximum width. A solitary figure caps at 760px. Eligible comparisons retain direct endpoint labels inside the same rounded data-card material as other charts. Supported charts retain a separated header, plot and disclosure footer.

GPU ASCII projects supported visible chart geometry through a bounded viewport atlas. Category labels and exact values remain native, and the original renderer retains its own scale and layout across pages. Classic ASCII uses source-wide scaled character bars only for compatible categorical data.

At 560px and below, content insets and figure padding tighten, full-table summaries wrap and helper text hides. Tables scroll inside focusable labeled regions. Comparison mode uses `repeat(auto-fit, minmax(min(100%, 280px), 1fr))` with a 16px gap; raw strings wrap anywhere.

Boards use horizontally scrollable columns of at least 220px, with independently scrollable columns capped at 640px. Master/detail uses a 26% list with a 180px minimum, a flexible detail pane sized to its own content and a 20px gap; at the narrow breakpoint the list becomes horizontal above the detail. The chapter index uses two intrinsic 240px text columns. Its optional SVG fan hides at 760px and below; the complete text index remains.

## Elevation & Depth

The content surface has diffuse depth; data cards, tasks and record detail use 22px corners and a soft 0 10px 28px -14px shadow. Fine-pointer hover raises them 3px, changes the surface tone and accent boundary, and deepens the shadow over 180ms. Focus-within retains tonal/depth emphasis with visible keyboard outlines. The flow canvas lifts 2px as a whole so nodes and edge ports stay aligned; individual 20px nodes change tone and boundary. Reduced motion removes lift/transitions and stops relationship-edge animation.

ASCII data surfaces start flat with dashed separators; chart, task and detail cards acquire the theme's soft shadow on fine-pointer hover. The shared theme token sets a restrained 2px lift where the existing surface supports it.

Soft relief starts on the dark graphite theme surface. Its paired highlight and shadow are mixed from the active background so raised and inset controls follow a user's custom color without a fixed bright rim.

**The Source Stays Reachable Rule.** Visualizations supplement source content. Keep qualifications, exact selected cells, complete tables, original records and raw/comparison access available.

## Shapes

Reading surfaces use 28px corners (24px narrow); charts, tasks and record details use 22px; flow viewport/columns use 24px, nodes 20px and source tables/heading index 18px. Prose remains continuous rather than one card per paragraph. Existing code blocks retain their compact radius. Fields and flow buttons use the field radius; native output actions retain the control radius. The single mode control is a pill. One-pixel rules define data boundaries. Lucide outline SVGs remain semantic icons; no reference screenshots or brand assets ship.

ASCII uses its own smaller panel, card, node and control radii from the frontmatter. Dashed rules divide headings, figures and table rows without changing the source or foreign component structure.

## Components

### Shared mode selector and actions

One labeled native select in the conversation header offers 展示, 原文 and 对照 with the accessible name 输出显示方式. It starts in 展示, stays transient per conversation and clears on unload. Raw mode keeps the rendered region mounted. Explicit actions remain separate from display selection; native settings retain their ordinary controls and errors.

The adjacent **主题** select offers built-in and installed themes without leaving the conversation. It uses the existing revision-checked settings save, shows pending and failure states, and keeps the display-mode and transparency controls separate.

The revised header keeps display and theme controls on one row. When the nearest existing inline-size or size container is under 1100 CSS pixels wide, research (when takeover is enabled) and transparency move into one mounted panel behind **更多显示选项**; without such a container, the viewport width is used. Wide layouts show those controls inline. The native popover closes on Escape or outside input; closing or moving back to the wide layout also closes the transparency slider and cancels an unsaved preview. Returning to wide mode restores focus to a visible control when focus was in the compact controls. The more button has a visible keyboard-focus outline. A theme-save error floats outside the row instead of expanding it. Candidate h passed the affected official Desktop retest at 2560 by 1640 and Left-half 2306 by 2814 physical pixels with the sidebar open; this is scoped native evidence, not a promise for every possible host composition.

### Comparisons and maintained charts

A local thin meter adapter handles one nonnegative finite series with two to six nonempty category labels. Each original value sits beside a shared-scale organic stroke; a zero remains zero. Complex categorical and time-series plots continue through unmodified OpenUI. This is one compact benchmark grammar, not every Empryo benchmark variant.

OpenUI categorical bars retain full labels and source values. Their height follows `max(230, labels × (30 + series × 26) + 56 + (series > 1 ? 50 : 0))`; line charts use 280px. Animation is disabled. Approximation/exclusion notices remain visible; native disclosures expose selection reasons and exact source strings. Chart failure retains the complete table and reports an error.

Classic ASCII renders compatible finite categorical series sharing a unit as responsive `#` bars with a zero-inclusive scale shared across pages. Their lengths are discrete approximations; original labels, values, units and source tables remain available. Unsupported plots retain the existing renderer.

GPU ASCII projects supported visible complex SVGs, charts, images and explicitly published owned Canvas frames through one atlas using the real pinned Asciify factory. The current 5×5 glyph uses a nominal 6.25px drawing area inside an 8.75px logical cell; the screen size also follows atlas scaling. Native text, controls and SVGs no larger than 32×32px stay readable in their original form. Plain noninteractive `div`/`span` chart labels inside SVG foreign objects stay in the original DOM and are masked out of the visual copy; unsupported foreign content retains its original graphic. Visible eligible images refresh at up to five times per second, while owned graphs provide current frames. Hover or focus permits inspection of projected originals; unavailable or unsupported graphics remain original. Arbitrary iframe interiors, closed shadow roots and unpublished foreign canvases are outside this bridge; ASCII Sweep is not implemented.

GPU ASCII also uses the separate 95-character ASCII Object effect for eligible explicit GLB models and validated PNG/JPEG illustrations. Model-only view options use a 45-degree field of view and scale 3.2; the native rotation controls occupy a 40px row. Each illustration's adjacent “原图” figure is excluded from the atlas, and the original source URL and content remain accessible.

### Complete source tables

A labeled 完整原表 disclosure preserves every row, column and source wording when a supplementary chart or board exists. Unsupported tables stay directly visible. Compact tabular type, inset headings, row separators and soft hover support exact reading without widening the page.

### Relationships and explicit sequences

Ordinary strict graph JSON requires explicit nodes and edges; duplicate/missing IDs, extra fields and invalid endpoints fail visibly with original content retained. Markdown flows use top-level plain arrow chains or simple ordered lists in an explicit workflow/steps context. Code, quotes, nested/rich items and ordinary enumerated findings remain Markdown.

Published React Flow 12.12 and ELK 0.12 supply a read-only, pan/zoom canvas with rounded routed edges and 240px nodes. Initial framing prioritizes readable labels; an explicit overview can fit the whole graph. Keyboard selection highlights direct neighbors and lists exact relations. Motion can pause/resume and honors reduced motion. Ordinary relationship edges express source order or relationships without implying execution status. Layout failure preserves readable node/edge lists and source text.

Recognized execution snapshots use the same graph surface. Small diagrams use a downward layered layout; large diagrams retain the bounded, static overview and detail path. Detailed nodes show only supplied role, model, status, progress and metrics, with explicit unknown labels where the source omits status or progress; a zero total does not become a percentage. Large compact nodes show status while their other source fields remain accessible. Existing chart-series colors distinguish supplied roles: series 1 for tool, 2 for worker, 3 for lead and 4 for advisor. Node text and numbers stay native. The compact event log preserves source order, initially shows the latest eight and keeps an inspected page stable as snapshots change; full original data remains accessible through the source disclosure when supplied and the shared raw mode.

On small execution diagrams, moving points follow actual paths only for edges the source marks active. The independent point layer remains native and is excluded from the GPU ASCII atlas so its fine moving marks survive character sampling; a thin original connection remains beneath the approximate GPU projection. WebGL2 draws the points where available, with Canvas2D fallback. Pause, reduced motion, hidden or offscreen state, and disposal stop the moving layer. These visuals represent the supplied snapshot and do not advance or infer task state.

### Task board and record detail

Boards require identifiable task/title and actual status fields; Markdown tables require an explicit task header. Status labels and first-occurrence order stay exact. Local search filters title, description and status with visible counts and an empty result message. Long task titles disclose their full text. Search and selection are transient presentation state; there is no drag, task writeback or claimed synchronization.

Homogeneous named records with substantial descriptions can use master/detail. The selected object's complete description, non-internal fields and original record remain accessible. The list uses native buttons and an explicit selected state; narrow layout retains the same selection controls.

### Chapter navigation

Documents with four to one hundred H2/H3 entries receive a complete heading index with real focusable anchor targets. A small native SVG fan supplements it only for four to seven short H2 labels; long labels and narrow widths use the conventional index. Child counts come from actual headings. This orientation aid is not an execution or dependency graph.

### Embedded apps

MCP Apps retain their separate application surface and explicit open action. This system does not replace official navigation/settings or define embedded-app branding.

## Do's and Don'ts

### Do:

- **Do** choose composition from explicit source structure while keeping prose in document order.
- **Do** scope configurable surface appearance to plugin content and keep the single conversation-header selector.
- **Do** retain exact source strings, units, exclusions, qualifications and complete sources.
- **Do** keep the local Recursive font and OFL together.
- **Do** treat ASCII-projected graphics as approximate while keeping exact source values and qualifications visible.
- **Do** distinguish browser review from installed official DSH acceptance.

### Don't:

- **Don't** wrap every paragraph in a card.
- **Don't** invent data, graph edges, task status or execution success for visual effect.
- **Don't** alter host theme or introduce per-output appearance/display controls.
- **Don't** promote fixture controls, private report content or detector preferences into product rules.
- **Don't** ship reference screenshots or infer app acceptance from browser captures.

Not canonized: two already joined numeric expressions in the report source remain unchanged; presentation must not infer missing formula operators. Advisory detector preferences are not implementation rules. No shipping raster was introduced.

## Compact reading refinement (2026-10-31)

The user requested slightly denser content while retaining the accepted material. Body size stays 15px (14px narrow); line height is 1.7, paragraph spacing 10px and the maximum reading inset 24px. H2 separates chapters with 32px above plus 16px rule inset and 12px below; H3 uses 24/10px. Comparison rows use a 12px gap with a 24px mark/value region. Source table cells use 8px vertical padding. Native disclosures and search retain 36px and 40px target heights. Master/detail aligns items at the start, uses a 20px gap and a 480px scrollable list; short details are no longer stretched. Graph node and viewport geometry stay unchanged, with only outer margins tightened.

## Visible transparency shortcut (2026-10-31)

A single **开启透明** checkbox shares the existing persisted appearance state with Settings. The revised header keeps it inline when space permits and places the same mounted control in **更多显示选项** in compact layouts. It preserves the selected color and takeover/OpenUI/MCP flags, uses revision-checked saves, disables while saving and exposes failure without claiming success. Translucent dark gray starts at alpha 0.72 with 4px blur so the existing wallpaper is more visible; contrast protection can increase opacity for custom midtones. Opaque mode keeps alpha 1 and no blur. The same preference supplies neutral tokens to the public conversation-view outlet when takeover is on. Original independent page components and controls remain intact; known owner card selectors add consistent radii and depth. Turning takeover off removes the additional page rules. Unknown embedded apps, iframe interiors and portals stay separate; the explicit ThoughtDAG exception is recorded below.

## Independent conversation pages

The published `[data-slot="conversation.view"]` outlet is an inheritance boundary, not a replacement component. Neutral background, card, text, border and radius tokens apply while takeover is enabled; semantic status meanings remain with the original owner; blue focus/brand, green success, amber warning, red error and inverse-button text adapt for contrast. Persona, Mnemon, workflow studio, Bench and both context views retain their native layout, controls, scrolling and graph geometry. Known cards use 20px corners, restrained depth and hover tint without translation; no external backdrop-filter or new containing block is introduced. IEP-owned content is excluded from an extra root backing layer. The entire adapter lives in the disposable appearance stylesheet; off/unload restores the original cascade.


## Downloadable themes (2026-10-31)

The user requested selectable downloadable theme packages. [The theme contract](docs/design/experience-themes.md) owns the format and lifecycle. Empryo remains the default; Plain supplies a restrained opaque alternative. Linen is a downloadable/importable example with warm paper, serif body text and green focus. V1 packages contain validated JSON tokens only, with no executable code, CSS or remote assets. Selection, import and removal use the existing revision queue and atomic settings file. Existing settings without a theme remain readable without an implicit rewrite.

Settings exposes selection, selected-package export, example download, local import and custom-theme removal. Import does not activate automatically. Switching themes preserves mounted source disclosures and original data. Typography, semantic colors, chart palettes, density, corners, hover and depth belong to the theme; the user's color/transparency choice remains separately adjustable.

The same owned stylesheet maps compatible independent-page roles without changing their code, configuration or data. A bounded same-origin ThoughtDAG bridge owns only its injected style and listeners. Its logo lockup retains the original font metrics so the owner toolbar does not obscure the title; body/cards retain the selected theme. Turning takeover off or disposing IEP removes both styles. Unknown frames are excluded.

## Settings control refinement (2026-10-31)

The plugin settings use a 14px platform-sans body, 20px title and one 36px control height. Buttons, fields and selectors share 10px corners; fieldsets use 16px corners, preview 12px, and the settings backing 20px. Groups use 8/12/16px spacing. Current theme, repository source and local files retain their order with light rules instead of nested decorative cards. The selected theme preview shows its name, origin/version and four swatches together. Only browsing the saved catalog is emphasized; repository/export actions are text links. The file picker keeps a native input with a Chinese label, a visible keyboard focus outline and disabled behavior.

The settings backing uses the user's selected background color at full opacity so report text cannot bleed through the form. This is a local reading requirement of settings; report transparency, cards, hover behavior and the visible transparency shortcut are unchanged. Styles apply only within `.dsh-experience.iexp-settings` and leave with the plugin stylesheet. At 320px, controls wrap without hiding labels or reducing the 14px body.

## Reply hover and transparency range (2026-10-31)

Ordinary plugin-owned reply surfaces now share the accepted fine-pointer lift: 3px over 180ms, with a changed tone, accent boundary and diffuse shadow. The explicit reply modifier excludes nested-root displacement and roots containing chart/task/detail/flow/iframe surfaces; those preserve their existing local emphasis. Other root surfaces gain boundary/shadow feedback without transform. Reduced motion removes displacement and transitions. OpenUI/MCP wrappers and foreign plugin components do not acquire a new transformed containing block.

Hovering or focusing the header's existing transparency checkbox opens a native top-layer popover, 256px wide with 16px padding/corners and 14px body/13px helper text. It is positioned against its anchor and clamped to the viewport, so native header overflow does not clip it. The range exposes background transparency from 0% to 70%, previews locally, and saves once on completed pointer/keyboard gestures or blur. Escape cancels an unsaved preview. The popup keeps an opaque background; content opacity stays 1 and only background alpha changes.

Optional `appearance.backgroundOpacity` records an explicit value from .3 to 1. Omitted values preserve the previous theme-default contrast protection. Explicit slider choices honor the requested alpha; high transparency over an arbitrary wallpaper can reduce contrast, unlike the automatic default. Off/on preserves the chosen alpha. Preview ownership and disposal prevent a removed control from leaving transient appearance behind. Failures roll back to the acknowledged settings and remain visible.

## Optional Paper continuous composition (revised 2026-11-01)

[Paper flow](docs/design/paper-flow.md) is an optional composition; Empryo and the other themes retain their topology. The user rejected the first ordinary split-column implementation and approved folding long argument on 2026-11-01. The new structure is an arched title scene, full-width source figure, adjacent limitations, two complete source-paragraph captions where available, an expandable remainder, and the next chapter. A shared faint canvas grid, frame intersections and diagonal transitions connect the sequence. The grid is the explicitly requested Paper canvas reference, not a default backdrop for other screens.

Paper uses locally bundled **DSH Paper Sans** (unmodified DM Sans Latin 5.3.0, OFL-1.1) with PingFang SC/platform CJK fallbacks. The display scale is 30–56 px for the hero, 30–48 px for chapter titles, 26–40 px for scene headings and 24 px for record-detail titles; weight 360, negative tracking no lower than -.035em. Body remains 15 px and source notes 12–13 px. No commercial Matter font or reference-site assets ship.

Multiple source-derived chart plans share one primary stage with plain period tabs and optional explicit 5-second demonstration playback. Hidden chart panels stay mounted. Manual input stops playback; background tabs suspend it; reduced motion disables it and the clipped stage transition. A foreground exact-data pane occupies a reserved part of the chart's note area and stacks below on narrow containers. It does not cover plotted values or qualifications. Explicit narrative tables reuse the existing read-only list/detail component; small containers stack selection and fields vertically.

A single full-document Markdown AST preserves definitions, footnotes, original nodes and source offsets. Entire paragraphs move only inside their own source heading boundary; no summary is generated. Qualification/assumption language and its associated list remain visible. Other long reasoning stays behind “展开本节正文”, while the shared original mode retains the exact entire input. This is browser-preview acceptance; the revised composition has not been installed in formal DSH.

## Source-table viewport

Original/source tables fit their actual parent width with a measured CSS transform and reserved layout height. The compact fit toolbar reuses ThemeButton and existing13px metadata/line/accent tokens, remains unscaled and exposes native size for reading. Native size restores keyboard-accessible local horizontal scrolling; fit resets its horizontal offset. Resize follows container changes, including research comparison layouts and disclosure visibility. Full table DOM/cells/anchors remain intact; body text and other plugin/app surfaces retain their size. Very narrow dense overviews are navigation, not a claim of readable microtext.


## Data browser and Insight preview

Data browser is a plugin-owned main panel, reached through the native Tools panel list; DS Bot mode can hide that list. A compact toolbar holds import, refresh, display mode and the existing theme selector. The file list is 180–260px beside a flexible reader; below 760px it becomes a 160px-high list above the reader. Both areas scroll independently. Source labels keep their prefix on one line, file names and report links wrap, and focused reader Home/End reaches the document boundaries. Use existing theme tokens and controls; no new visual theme is introduced.

Conversation Insight preview selects an existing run and an already-produced stage/node output. Source status and complete original-run disclosure sit above the reader. PPTX waiting/manifest state is explicit. The local research workspace exposes report, judgments, sources and technical comparison without changing the conversation's research preference; its tabs form two columns at narrow widths. This is content preview rather than final slide-layout proof. Real output, units and source strings remain available in shared original/compare modes.


## Compact grouped settings (2026-11-04)

Grouped settings retain the existing opaque theme and 14px navigation type. The title/category tracks use 60/44px, navigation and header controls use 32px, and menu rows have a 2px gap. The category strip explicitly includes padding and border in its reserved track; the native list starts below it with an 8px inset. All entries use one plain 16px outline icon with the same stroke and alignment; known sections have semantic icons and unknown sections use sliders. Native decorative icons are visually suppressed only in grouped mode, without changing labels, original nodes, handlers or configuration. Cancellation removes the owned stylesheet and restores native icons and layout.
Shell layout: keep native tool rows together, place Settings and ancillary footer actions above the scrolling cost-meter block, and reserve a separate global row for the Synapse view switch so it cannot overlap session labels. Preserve native handlers and source data.

The sidebar fee block fills its slot instead of sizing to its text. DS Bot’s existing return button occupies a compact seat to the right of the DeepSeek Harness brand, while the native macOS window controls retain their positions.
