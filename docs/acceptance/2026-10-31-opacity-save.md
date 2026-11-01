# Native opacity save follow-up

The first installed candidate displayed a Typert saveSettings wire-input validation error when the user adjusted the slider. Legacy checkbox saves still succeeded and the stored settings were unchanged after rejected requests. The initial rejected raw payload and its Host-side cause were not captured, so the exact trigger is not established; there is no evidence to attribute it to another plugin or a persistent schema cache.

The normal client adapter now captures an independent JSON request and validates it against saveSettingsSchema before invoking the wire method. Invalid opacity is rejected locally; fractional values are retained, optional undefined fields are omitted and caller objects are not mutated. The range gesture also holds one request snapshot. Server-side strict validation and revision checks remain enabled. A temporary owner-only diagnostic build was used locally and removed completely before delivery; its successful calls are not a substitute for the final clean-build acceptance.

## Verified

- Full clean-build gate: build, TypeScript, 210 tests and built-package scratch installation passed. The actual owner Gateway probe now directly saves appearance.backgroundOpacity .37 rather than relying only on selecting a theme containing that value, then restores the prior appearance and checks Host restart/disposal. No model calls.
- Two added adapter regressions cover fractional precision, optional undefined removal, immutable caller input and rejection before wire invocation. The boundary double uses the real strict codec; it is not labeled a real transport/Gateway test.
- With the official application normally quit and current profile files/settings privately backed up, its bundled CLI installed only this UI package with scripts disabled. All 45 built files matched the archive. Other dependency declarations, resolved lockfile closure and profile configuration were unchanged.
- In the user's existing conversation, native 0% and 70% transparency saves wrote backgroundOpacity 1 and .3; pointer midpoint adjustment wrote .65. Further keyboard adjustments wrote fractional values without the old error.
- Native off/on retained the selected .47 alpha. A complete normal quit/reopen retained the exact settings bytes and displayed 53%. Another save after restart succeeded, and the selected 53% was restored. No diagnostic interface or old error remained in the final capture.
- Current takeover/OpenUI/MCP flags, theme selection/catalog/source and foreign configuration were preserved. No new research, model execution, foreign plugin edit or official application modification occurred.

## Artifact

Accepted archive SHA-256: 960d44c00aa0e7041744d2c34a5b2f6127c7649168c5998435221ae3e3b4a928. This is a local development installation and source update, not an npm or plugin-market release. Private snapshots, captures and receipts are excluded from Git. The observed final behavior passed; the missing initial payload prevents a conclusive claim about the original error's precise cause.
