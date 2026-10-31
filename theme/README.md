# dsh-intelligent-UI themes

Portable data-only themes for the Intelligent Experience Platform plugin.

| Theme | Package | Appearance |
| --- | --- | --- |
| Empryo | [empryo.dsh-theme.json](empryo.dsh-theme.json) | Dark-gray translucent surfaces, rounded floating cards, restrained chart colors and Recursive typography. |

Download a `.dsh-theme.json` package, then open DSH Settings → 智能体验 → 界面主题 → 导入主题包. Importing does not activate a theme; select it explicitly. Empryo also ships as the built-in default.

Packages use format version 1 and contain validated JSON only: no executable code, CSS or remote assets. The current Empryo package is MIT licensed. New theme packages should use a unique id and include their author, version and license.

The plugin source and downloadable themes belong to their own independent open-source repository. The default theme source must point to that repository, not the DSH host repository.

## Default catalog

The plugin defaults to `https://raw.githubusercontent.com/lisihao/dsh-intelligent-UI/main/theme/`. Settings accepts a replacement source directory and can restore this default. The catalog is `index.json`, format version 1, with a `themes` list. Each entry has `id`, `name`, `version`, a leaf `file` ending in `.dsh-theme.json`, and the SHA-256 of the exact UTF-8 file bytes. The downloaded package metadata must match the catalog. Keep `index.json` and package checksums together when publishing changes.

Empryo is also built in for offline use. Downloading the identical Empryo package verifies it and reports that it is ready; it does not create a duplicate theme or change the active selection.
