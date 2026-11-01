# Short-conversation bottom alignment

## Scope and cause

The published DSH 0.2.1-rc.2 Chat already preserves chronological order and owns tail following, reader anchors, history paging and return-to-bottom. Its short transcript uses top alignment: a physical scroll floor of zero still leaves messages near the top. No evidence was found that the UI plugin reversed message order.

The plugin now makes the active `conversation.view` outlet a bottom-justified flex container only when it contains the native `data-chat-flow` within `data-conversation-scroll` and takeover is enabled. This is a compatibility stylesheet adapter on semantic DOM anchors, not a dedicated host layout API. It does not replace Chat, write scroll positions, set viewport heights, reverse rows or edit other plugins. Turning takeover off or disposing its appearance sheet retracts the rule.

## Evidence

- `pnpm check`: build, typecheck, 210 tests in 22 files and the built-package scratch-profile Gateway/restart/disposal probe passed. No external model call.
- Affected-file ai-design-check: no findings. Independent read-only finish review accepted the short-conversation screenshot and the nine-line CSS change.
- Browser geometry fixture at 1280 × 720: with the adapter, the transcript ends 16 px above the composer; without it, a 385.7 px empty area remains below the short transcript. Growing the response keeps the first row reachable and uses the original outer scrollport (1852 px scroll height over a 660 px viewport).
- Official macOS DSH, captured at 2560 × 1640: the existing single-turn local canary now sits near the composer. Existing two-turn conversation retains its rail and order. A long real conversation can be scrolled upward, remains there, exposes the original return-to-bottom control, and returns to the last reply. Turn navigation remains available.
- Normal UI takeover-off check: the single-turn canary restores native top alignment and rendering. Re-enabling is pending the owner window after an observed concurrent session/appearance change; no subsequent write was attempted automatically.
- The exact packed candidate was installed through the official bundled CLI after normal application quit. All 45 built files match the installed package. Profile comparison immediately after installation preserved unrelated dependency specs, resolved lock closure, profile configuration and UI appearance settings.

Candidate archive: `artifacts/20261031-chat-bottom/lisihao-dsh-solar-intelligent-experience-platform-0.1.0-dev.0.tgz`, SHA-256 `1785f05fa00eca33359d82155af1501cd245187a64495541f3ffe500cd252340`.

## Limits

Native acceptance used existing recorded conversations without generating a new paid/model reply. Actual fresh streaming, an embedded conversation window, narrow native-window resizing and history prepend were not exercised in this round. The browser growth check proves layout behavior, not native streaming ownership. Screenshots, account data, profile backups and raw private reports remain outside Git.
