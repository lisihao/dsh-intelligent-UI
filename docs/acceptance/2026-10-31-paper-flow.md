# Paper continuous conversation flow — 2026-10-31

## Boundary

A downloadable Paper theme with optional format-v1 `tokens.composition`, a source-preserving section planner/remark layout and scoped styles. Existing themes remain in document mode; no host or foreign-plugin file is edited. The normal existing OpenUI renderer, GFM parser, charts and source disclosures are reused. No model request or new dependency is added.

The reference at [paper.design](https://paper.design/) was inspected in a real browser from “finally a continuous loop, from Paper to code and back” onward. Its near-black field, fine frame lines, chapter hierarchy, wide demonstrations and supporting split content inform a **report adaptation**. This is not a pixel-identical Paper editor/demo reproduction; proprietary media, music art, logos and animation code are not shipped. See [direction and compatibility](../design/paper-flow.md).

## Run checks

- `pnpm check`: build/typecheck, **239 tests in 25 files**, built-package scratch installation, actual Gateway/owner RPC, Host restart and lifecycle disposal passed. No external model calls. The existing collision negative test logs its expected error.
- After expanding the scratch input from a generic theme to the actual Paper package, `pnpm test:plugin` passed again: the strict Gateway accepts and returns `composition: continuous`; import does not activate; selection, original flag/artifact preservation, real process restart and removal fallback are recorded in the receipt. No unchanged unit suite was repeated for this harness-input change.
- Eighteen planner tests cover exact source reassembly, UTF-16 offsets, real top-level versus quoted/fenced headings, nested subsections, ordinary prose fallback and stable offsets during append.
- Five presentation tests exercise the real renderer: cross-chapter reference links and footnotes, exact table cells/units, section/subtopic order, conditional compositions, unified raw mode, streaming fallback and equal-refresh disclosure DOM identity. Existing themes retain their charts and document layout.
- Applicable `ai-design-check` and Impeccable layout scans: zero findings, no new ignore/baseline. `git diff --check` passed.

## Actual report/browser evidence

The unchanged private research source is 22,777 characters, SHA-256 `c6dfb8b9c6279d1dfd7a2275d1bbf8a96d8d7ecbf2421328c29b517d59bdffa4`. The actual browser raw-mode text matches that hash exactly. This is a presentation check, not revalidation of the report's financial claims.

- Actual report rendering retains **7 charts and 13 complete original tables**. The four-expense source drawer exposes 23.80 / 97.41 / 38.08 / 10.50, with the original USD-hundred-million unit and 2026 H1 period; the total row remains excluded from the component comparison and available in the full original table.
- At default 1280 × 720, observed a wide first figure, separate three-period financial panels and copy/expense-figure pairing. The single full-document AST retains original order, links and data qualifiers. Each original subheading stays with its topic instead of putting a whole long chapter into one repeated card.
- At 390 × 844 and 900 × 900, all split layouts become one column in source order; no horizontal document overflow. The 390 px chart keeps labels, units and source disclosures.
- At 2304 × 1406, the report stays bounded to 1240 px and the cost pair remains readable without unbounded prose width. Captures were inspected, and the temporary viewport override was reset.
- The computed scroll-line animation uses `animation-timeline: view()` in the actual browser. Text never starts hidden or faded. Reduced motion has a static CSS fallback; an OS reduced-motion toggle was **not run**.
- A real original-data drawer and unified raw/visual mode were exercised. Source data and hash are private local acceptance material; no research source or screenshot is committed.

Independent Impeccable finish review: **ship**, no material fixes. This accepts the report adaptation shown in the supplied desktop/narrow/wide captures; it does not certify a pixel-identical Paper demo or unobserved native/motion behavior.

## Delivery state

Candidate package: `artifacts/20261031-paper-flow/lisihao-dsh-solar-intelligent-experience-platform-0.1.0-dev.0.tgz`, SHA-256 `8c5068542ce9d43c2cf82a34cc9d9e8bf05434c1db366e0074a939bcf8a751ea`.

Official Desktop update/selection is **not yet run**. Its current UI was read only, and observed page movement means the application is in use; no quit, restart, install or selection was performed. Browser evidence and scratch RPC evidence do not claim installed-app acceptance. Empryo and the saved 53% transparency remain untouched by this work. Theme download from an older plugin build will reject the new optional token visibly; update the UI plugin before selecting Paper.
