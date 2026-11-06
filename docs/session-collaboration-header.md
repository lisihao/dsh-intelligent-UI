# Session collaboration header

## Authorized objective

The owner selected a single Collaboration entry on 2026-11-06. Its Team and
Subtasks pages preserve the distinction between shared Agent Team work and
ordinary child sessions, and include observed pstack role calls. Remove the
redundant header cost-details and AGY account badges while retaining the composer
cost entry and all subscription/provider settings. No model/provider/effort
changes, model calls, upstream edits, merge, release, or public package upload.

## Scope and observable acceptance

Use the installed Intelligent UI source baseline (2d2751b, identical plugin tree
in the merged feature baseline 70d77e9). Owned paths: new src/collaboration-*.ts,
focused tests and browser fixture, src/client.ts wiring, README and UPGRADING.
Use only published rc.2 session projections, UI session/workspace APIs and slot
priority shadowing. The official app and original plugin packages stay intact.
Disabling this plugin restores the original entries through normal lifecycle.

The installed app must show one Collaboration header control instead of the
Agent Team, subagent catalog and pstack controls, with Team/Subtasks tabs and
source-preserving role results. Positive/negative existing sessions must not
leak state. Missing providers/projections, stale connections, stopped/failed and
unknown results must not be called successes. Long output scrolls inside the
panel, follows the active theme, and offers original text. Original model
subscription settings and bottom cost details remain usable. Verify normal and
narrow widths, keyboard close/focus and plugin disable cleanup using keyless
fixtures plus actual existing completed app sessions. No new paid/model task.

## Evidence boundary

Synthetic fixtures validate data projection, lifecycle and interaction. Built
package tests validate loading. Actual installed UI acceptance validates the
real integration; source/CI alone do not prove installation or efficacy.

## Design review

Hallmark component inspection ran on the final CSS and built-client synthetic
page: 0 FAIL, 35 REFLEX and 1 WARN, with five render captures. The remaining
findings are explicitly bounded:

- 24b (33 spacing findings): retain compact host-compatible row/tab spacing and
  the close-button clearance instead of applying a marketing page's 4px-only
  grid to these existing application controls.
- 26b: selected tabs, reading/source controls and the header's expanded state
  already expose pressed/selected feedback; ThemeButton retains its existing
  host behavior. No additional active animation is introduced.
- 39b: the reported tall controls are synthetic clickable record rows, not
  marketing call-to-action buttons. Their heights follow full record content.
- F3: these short Chinese panel/section headings fit on one line at the checked
  widths; balancing them would not improve the reading hierarchy.

These waivers are a component-design decision, not a claim of certification.
Synthetic renderer/geometry evidence remains separate from native acceptance.


## Browser fixture prerequisites

Run `node tools/collaboration-browser/check.mjs` after the plugin build. The
fixture requires an existing `playwright-core` installation and an installed
Chrome browser; it never downloads a browser. Node resolves `playwright-core`
from the test environment by default. For an isolated test-tool installation,
set `COLLABORATION_BROWSER_PLAYWRIGHT_MODULE` to its absolute module entry path.
`COLLABORATION_BROWSER_CHROME` overrides the macOS Chrome executable. These are
test-only inputs, not plugin/profile configuration or runtime dependencies.
