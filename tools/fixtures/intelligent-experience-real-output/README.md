# Real output replay fixture

Test-only plugin for `tools/real-output-demo.mjs`. It reads an existing Vitest JSON report through one real local DSH tool call, saves the exact formatted Markdown as a content artifact, and retains a normal persistent Session. Its local adapter replays actual output; it does not claim a live model chose the presentation. There is no OpenUI source, chart type or icon instruction in the output. The platform's ordinary content path performs that selection.

The helper requires absolute `--dsh-home`, `--package` (stable built `.tgz`), `--report` (actual Vitest JSON), and unused `--receipt` paths. It installs only in a unique retained test profile, blocks external model routes, checks existing profile manifests, and does not change shared presentation settings. Private reports and receipts remain outside Git.

`reportToMarkdown(report, { sha256 })` is a pure formatter exported from `index.mjs`. It preserves actual file durations without rounding, shows counts separately, and labels timings as this test run rather than a DSH performance benchmark.
