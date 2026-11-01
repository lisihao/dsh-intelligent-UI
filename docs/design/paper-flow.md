# Paper continuous conversation flow

## Reference and boundary

The user requested the visual composition from [paper.design](https://paper.design/), starting at “finally a continuous loop, from Paper to code and back”. The actual page was inspected in a browser on 2026-10-31: centered chapter introduction, fine frame lines, wide animated product demonstrations, two-column supporting explanations and left-aligned subsequent chapters. The large demonstrations are editor/canvas animations, not live general-purpose research charts. Their reference reading rhythm informs this adaptation; marketing copy, brand assets, music covers and proprietary animation code are not copied or shipped.

The requested behavior belongs to the independent UI plugin. A new optional `tokens.composition` field (`document` or `continuous`) selects the arrangement. Omission preserves the existing document layout. The Paper theme selects `continuous`; older plugin builds reject this optional token visibly rather than silently losing the requested layout. No host or foreign-plugin files change.

## Spatial direction

Mode: Read / Operate. The original document title and introduction lead, followed by source-ordered chapters. Thin continuous frame lines connect chapters; content is not wrapped in another stack of cards. The first visual chapter is a wide feature. Later chapters may pair a short explanation with a single visual area when the actual container is at least 920 px; long descriptions, multiple visual blocks and narrow containers remain stacked. Figures fill their assigned region. No CSS order reversal, generated summary, invented KPI or extra data is introduced.

The retained renderer still chooses charts, tables, explicit graphs and workflows from the original content. A single Markdown AST is transformed structurally so cross-section links, footnotes, source offsets, table analysis, qualifications and anchor navigation stay intact. Streaming remains the original stable document renderer until a complete output can be arranged. A short reply remains a short reply.

Paper's editor-demo topology becomes real report charts and source data in this product. This is an adaptation of its visual system, not a pixel-identical copy of an editor demo. Source disclosures stay next to their visuals; the existing header controls raw/visual/compare for the whole conversation. A progressive scroll line marks the reading region where scroll timelines are supported. Text is always visible, motion is decorative, reduced motion removes the animation, and unsupported browsers retain the static frame.

## Material

Deep near-black `#08090b`, cool white readable text, blue focus, pastel data series, a light system sans and 1 px rules. Existing user-requested rounded figure cards and 3 px hover depth remain. The default is opaque; the shared transparency control still works. Active theme choice and prior appearance are not changed by downloading the package.

## Observable acceptance

- Real unchanged research output has chapter/figure compositions, seven charts and thirteen complete source tables, preserving its source hash and data definitions.
- Reference-inspired frames, wide visuals, conditional split layout and narrow stacking are visible in actual rendered captures; uniform left-text/right-chart repetition is avoided.
- Cross-section links/footnotes, streaming, source disclosures across polling and shared raw mode are exercised. Existing themes retain document mode.
- Type/build, focused behavior tests, project plugin gate and independent rendered finish review pass before delivery. Installed Desktop validation is recorded separately from browser proof.
