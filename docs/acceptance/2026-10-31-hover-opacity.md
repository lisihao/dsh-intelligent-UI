# Ordinary reply hover and background-opacity control

The user reported that ordinary AI replies did not lift on hover and requested a transparency slider revealed by hovering the header checkbox. This update belongs only to the independent UI plugin. The official application, foreign plugin files/configuration and existing conversation content are unchanged.

## Implemented behavior

- Ordinary ContentView roots receive the explicit reply-surface modifier. Fine-pointer hover lifts only the outer eligible root and changes its tint/border/shadow. Nested roots, specialized chart/task/detail/flow surfaces and iframe roots avoid compounded movement; generic OpenUI/MCP wrappers are not transformed. Reduced motion removes the displacement/transitions.
- The existing header checkbox reveals a native top-layer popover on hover/focus. The range adjusts background transparency from 0% to 70%; its panel is opaque and viewport-clamped. Text and the content element retain opacity 1.
- Input previews locally through the disposable appearance stylesheet. Release, completed navigation keys or blur save via the normal owner-only revision-checked settings service. Escape cancels an unsaved preview. Failed saves restore acknowledged appearance and expose the error. Owned preview cleanup prevents stale temporary state after unmount.
- Optional appearance.backgroundOpacity is bounded to [.3,1]. Legacy preferences keep their earlier theme/default behavior. Explicit range choices honor the chosen alpha and can reduce contrast over some wallpapers. Off/on retains the chosen level; switching themes restores that theme's appearance defaults.

## Run evidence

- Independent full check: build, TypeScript, 208 tests and actual built-package scratch installation passed. The real RPC/restart probe selects a theme with backgroundOpacity .43, verifies exact appearance after a Host restart, and restores defaults. No model calls.
- Seven new client/durable tests cover multiple local previews without writes, one release save with current revision/flags, rollback/error, Escape, legacy files and a new HostStore reading custom opacity after restart.
- Browser pointer entry into a real-report excerpt card produced computed transform matrix(1,0,0,1,0,-3), 180ms transitions and a changed tint. Actual range drag 28% to 50% produced rgba(36,38,43,.5) while element opacity remained 1. The original report excerpt was not rewritten.
- Keyboard focus opened the popover and Escape closed it. At 320px the document was 305px wide, and the 256px popover occupied x=12..268 without clipping. Default appearance was restored after the preview checks.
- ai-design-check: no errors/warnings on affected UI files. Impeccable detector: no findings on the changed control/style files. Independent visual finish review: ship for the browser captures.

## Desktop boundary

The immutable development archive has SHA-256 80b9d7b6d3a70dc1efbb278f800dc5fcd825f397a4fc0d48d3c63d1f8c270c60.

Formal installation/runtime acceptance is pending an explicit update window because the user was actively navigating DSH during the final preflight. No restart or install has been attempted in that window. Source/preview evidence alone is not Desktop acceptance. Private reports, captures, settings, backups and receipts stay outside Git. No npm or plugin-market release is claimed.
