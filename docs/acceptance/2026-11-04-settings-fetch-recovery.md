# Settings fetch recovery acceptance

Accepted on the MacBook on 2026-11-04, America/Toronto (runtime checks crossed into 2026-11-05 UTC). This is a pure plugin fix; the official DSH 0.2.1-rc.2 App is unmodified.

## Changed behavior

A temporary settings read failure previously persisted after a successful read and appeared as an unsaved transparency write. Settings reads now clear their own errors on success and ignore responses superseded by newer reads or saves. An acknowledged save also clears a prior read error. A real failed transparency write remains visible after a successful read; writes are never automatically replayed.

## Source and package

- Implementation commit: `0ad406f55f5866dea9384d5e8dbdee83226309d4`.
- Regression check against the unchanged base: four tests failed, four passed.
- Stable full gate: build and typecheck passed; 93 test files, 1,051 tests passed and three skipped; published-DSH scratch installation passed with zero model calls.
- Exact packed archive scratch installation passed independently.
- Package SHA-256: `b9e55bbf73ccd3108b6021fc58469e465e0326da4d20ba562b289e0ee018a8b2`.
- No version bump, Release, tag or App build.

## Installed native App

The previous stale failure was observed in the running App before installation. After an idle check and fresh private backup, the official bundled CLI updated only this direct package dependency. All 154 archive files matched their installed copies. The other 59 direct dependencies retained their specifications.

Through the native conversation header, transparency was turned off and back on. Both actions advanced the durable revision and matched the native checkbox state; the original preferences were restored exactly apart from the revision. No unsaved, fetch-failure or connection-warning text remained through three subsequent observations covering multiple five-second settings polls.

The profile patch, Cordis config, compatibility settings, workspace configuration and web-account files remained unchanged. Cost-history fields were preserved; normal price-cache refreshes are not claimed byte-identical. The session list remained 167 entries with zero running. The independent Resident process and MacBook Tailscale remained running. Official App executable SHA-256 and strict signature verification remained unchanged/passing. Private backups, logs and account-bearing captures are not distributed.

## Evidence limits

The original transient transport failure's trigger is unknown. This repair proves recovery/error classification and the current native save/read path; it does not claim that all future network failures are prevented. Transient and delayed failures were injected only into isolated test services, never by stopping Tailscale or interrupting real model requests.
