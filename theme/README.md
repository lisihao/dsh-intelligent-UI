# dsh-intelligent-UI themes

Portable data-only themes for the Intelligent Experience Platform plugin.

| Theme | Package | Appearance |
| --- | --- | --- |
| Empryo | [empryo.dsh-theme.json](empryo.dsh-theme.json) | Dark-gray translucent surfaces, rounded floating cards, restrained chart colors and Recursive typography. |
| ASCII | [ascii.dsh-theme.json](ascii.dsh-theme.json) | Translucent graphite, pale green accents, monospaced reading and a WebGL character projection for supported graphics. Requires the V3-capable development candidate. |
| 炭墨 · Carbon | [unslop-carbon.dsh-theme.json](unslop-carbon.dsh-theme.json) | Opaque charcoal, warm-white focus, compact rounded panels and muted multi-color charts. |
| 钴夜 · Cobalt | [unslop-cobalt.dsh-theme.json](unslop-cobalt.dsh-theme.json) | Translucent midnight blue, mint-green focus, generous radii and stronger background blur. |
| 暖金 · Amber | [unslop-amber.dsh-theme.json](unslop-amber.dsh-theme.json) | Translucent warm charcoal, amber focus, softer lift and comfortable report spacing. |
| 雾白 · Porcelain | [unslop-porcelain.dsh-theme.json](unslop-porcelain.dsh-theme.json) | Opaque warm white, ink text, forest-green focus and compact panels. |
| Paper · 连续信息流 | [paper-flow.dsh-theme.json](paper-flow.dsh-theme.json) | Near-black framed chapters, wide figures and conditional copy/visual pairs. Requires the continuous-composition renderer update; [design and compatibility](../docs/design/paper-flow.md). |

Use **浏览来源主题 → 下载导入** in Settings, or download a `.dsh-theme.json` package, then open DSH Settings → 智能体验 → 界面主题 → 导入主题包. Importing does not activate a theme; select it explicitly. Empryo remains the built-in default. The current development candidate also includes ASCII built in and adds a conversation-header theme selector; official Desktop acceptance is pending.

Packages use format version 1, 2 or 3 and contain validated JSON only: no executable code, CSS or remote assets. V2 selects a supported bundled component set; V3 selects the ASCII presentation and requires the `mono` font token. The Empryo, ASCII and Paper-flow packages are MIT licensed; the four Unslop adaptations are CC BY 4.0. See [reference attribution and design mapping](../docs/design/unslop-themes.md). New theme packages should use a unique id and include their author, version and license.

The ASCII renderer uses the pinned Canvas UI Asciify factory in a shared WebGL atlas for supported visible graphics; eligible GLB models and validated PNG/JPEG illustrations use the separate ASCII Object effect. A labeled original illustration stays visible beside its effect and is excluded from the atlas. Native text, source data and graphic geometry remain intact. Visible eligible images can refresh at up to 5 Hz; captured SVG/image copies are released when they leave view and the view is recomposed. Unpublished foreign canvases, arbitrary iframe/closed-shadow contents and ASCII Sweep are outside this coverage. The theme's JSON is available offline, but the effect factory needs access to the pinned official source on first use after a Host restart. The newer graphics effects still require official Desktop acceptance.

The plugin source and downloadable themes belong to their own independent open-source repository. The default theme source must point to that repository, not the DSH host repository.

## Default catalog

The plugin defaults to `https://raw.githubusercontent.com/lisihao/dsh-intelligent-UI/main/theme/`. Settings accepts a replacement source directory and can restore this default. The catalog is `index.json`, format version 1, with a `themes` list. Each entry has `id`, `name`, `version`, a leaf `file` ending in `.dsh-theme.json`, and the SHA-256 of the exact UTF-8 file bytes. The downloaded package metadata must match the catalog. Keep `index.json` and package checksums together when publishing changes.

Empryo and ASCII are built in for offline use in the current candidate. Downloading an identical built-in package verifies it and reports that it is ready; it does not create a duplicate theme or change the active selection.
