# Paper continuous conversation flow

## Reference and boundary

The user requested the visual composition from [paper.design](https://paper.design/), starting at “finally a continuous loop, from Paper to code and back”. The actual page was inspected in a browser on 2026-10-31: centered chapter introduction, fine frame lines, wide animated product demonstrations, two-column supporting explanations and left-aligned subsequent chapters. The large demonstrations are editor/canvas animations, not live general-purpose research charts. Their reference reading rhythm informs this adaptation; marketing copy, brand assets, music covers and proprietary animation code are not copied or shipped.

The requested behavior belongs to the independent UI plugin. A new optional `tokens.composition` field (`document` or `continuous`) selects the arrangement. Omission preserves the existing document layout. The Paper theme selects `continuous`; older plugin builds reject this optional token visibly rather than silently losing the requested layout. No host or foreign-plugin files change.

## Spatial direction, revised 2026-11-01

The initial split-copy implementation was rejected by the user as insufficiently close to Paper. The revised preview uses one shared canvas frame with fine grid extensions, corner intersections, an arched title plane and geometric chapter transitions. It follows **chapter headline → dominant source scene → visible basis/limitations → two complete source-paragraph captions → optional remaining argument → next scene**. No equal-weight chart-card row substitutes for the primary visual.

The user explicitly permitted folding long argument while prioritizing figures. Full original AST nodes and citation/reference nodes remain intact. A paragraph/list introduction stays with its list; assumptions and detected caveats stay visible even when long. No copy is lifted across a subheading. The remaining source is available locally through “展开本节正文” and verbatim through the shared conversation original mode. Unknown or short prose stays a readable document. This deterministic conservative grouping is not a semantic proof that every possible prose qualification is recognized; the full source remains the authoritative reading path.

Multiple compatible chart plans from one table use a single large stage with actual source title/basis tabs. An explicit “演示切换” cycles real plans every five seconds; it starts paused, stops on manual input, suspends in a hidden document, and is disabled for reduced motion. The visible-default transition uses clip-path and vertical displacement, with a static fallback. Exact raw strings occupy a foreground data pane in reserved note space, never over the plot or notes. Small datasets display all selected cells; larger ones retain a disclosure. The complete original table remains separately available.

Narrative tables with explicit scenario/research/subject labels may use the already implemented read-only list/detail view. It exposes source records and original table without inventing probabilities or causal relationships. Narrow containers stack selectors, details and labels over values; period tabs remain a horizontal accessible tablist. Streaming and other themes retain the ordinary renderer.

## Material

Near-black `#08090b`, restrained frame rules, contrast-protected text, blue focus and pastel data series remain. Unmodified DM Sans Latin from Fontsource variable 5.3.0 (OFL-1.1) provides the display voice, with platform CJK sans for Chinese. The font/license are embedded locally; commercial Matter and Paper assets are not distributed. Typography roles and responsive sizes are in `DESIGN.md`. User transparency controls continue to operate independently.

## Observable acceptance

- Real unchanged research output has chapter/figure compositions, seven charts and thirteen complete source tables, preserving its source hash and data definitions.
- Arched intro, shared canvas, wide primary figures, dual captions, exact-data depth and narrow stacking are visible in actual rendered captures; uniform left-text/right-chart repetition is removed.
- Cross-section links/footnotes, streaming, source disclosures across polling and shared raw mode are exercised. Existing themes retain document mode.
- Type/build, focused behavior tests, project plugin gate and independent rendered finish review pass before delivery. Installed Desktop validation is recorded separately from browser proof.
