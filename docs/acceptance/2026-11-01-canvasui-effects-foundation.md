# Visual effects foundation acceptance — 2026-11-01

## Implementation boundary
Code baseline: `233bebe9d76b365d0c47cfe70410e7730dbb1daa`, PR #1.
This acceptance applies to a source-preserving **provider integration contract** and an independently authored CSS title reveal. It does not certify that original Canvas UI shaders or components execute in DSH. No Canvas UI runtime code is shipped.

## Executed automated verification

| Gate | Evidence |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | GitHub Actions succeeded, Ubuntu / Node 24 / pnpm 10.31.0 |
| `pnpm build` | Succeeded; browser bundle and TypeScript declarations built |
| `pnpm typecheck` | Succeeded |
| `pnpm test` | 35 Vitest files / 284 tests passed, including 6 new effect tests |
| `pnpm test:plugin` | Succeeded against disposable published DSH profile, with `scratchRemoved: true` |
| Original/raw/compare, stream and reduced-motion behavior | New Vitest tests passed |
| Lazy GPU provider loader and React teardown | Mock GPU provider test passed; validates the interface and unmount behavior |

GitHub Actions run: https://github.com/lisihao/dsh-intelligent-UI/actions/runs/41338483403

## Explicit unverified boundaries
- Upstream Canvas UI Decrypt Reveal module, shader compilation and visual results are not exercised.
- Actual Desktop/Electron Chromium support for experimental HTML-in-Canvas is not measured.
- No installed Desktop profile with realistic research reports was used for this change.
- GPU resource contention, WebGL context loss, multi-panel memory stability and native render timing remain unmeasured.
- Canvas UI Commons Clause redistribution authorization remains unresolved.

## Next acceptance gate
After confirming component distribution rights, add the pinned Canvas UI WebGL provider in a separate authorized integration, then run the actual Desktop canary (overlay and HTML-in-Canvas paths) with teardown/memory, source preservation and render-mode transitions.
