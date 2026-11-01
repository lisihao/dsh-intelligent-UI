# Unslop reference theme collection

## Scope and design direction

Four optional format-v1 JSON themes extend the existing UI renderer. They change its palette, type choice, surface material, radii, density, charts and hover lift. They do not change document content, business actions, application layout, host code or other plugins. Empryo remains the built-in default; importing a package does not select it. The existing transparency control remains available for every theme, including the two opaque defaults.

The reference story image contains before/after frames. The final charcoal dashboard, not the earlier purple/glow treatment, informs Carbon. The dashboard contributes quiet borders, clear numbers, rounded panels and separated chart colors. The hero contributes Cobalt's midnight/mint pairing and Amber's warmer data accents. Porcelain is an explicitly new light adaptation of this hierarchy, not a claimed reproduction of a supplied light design. Typography uses the platform sans stack and the established renderer's scale. The package format cannot replace the product's layout or carry marketing illustrations, fonts or executable CSS.

| Package | Ground | Material | Geometry / spacing | Emphasis |
| --- | --- | --- | --- | --- |
| Carbon | `#141414` | Opaque | 24 px panel, 18 px card; compact | Warm white; gold, mint, blue, rose and lavender charts |
| Cobalt | `#090f1f` | 90% opacity, 14 px blur | 28 px panel, 22 px card; compact | Mint green with blue/orange chart companions |
| Amber | `#1c1916` | 94% opacity, 10 px blur | 22 px panel, 16 px card; comfortable | Amber and muted warm data colors |
| Porcelain | `#f3f1eb` | Opaque | 24 px panel, 16 px card; compact | Ink text and forest green |

All four retain soft offset shadows, rounded controls, standard proportional charts and 2–3 px pointer hover lift. Reduced-motion behavior stays with the existing renderer. Token colors pass through its contrast adjustment, so rendered values can differ from the package hex values. Transparency values are defaults, not changes to a user's existing slider setting.

## Reference attribution

Design references by **Damir Sokolovsky (heydamir)**, from [heydamir/unslop](https://github.com/heydamir/unslop), inspected at commit `1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc`:

- [Story dashboard frames](https://github.com/heydamir/unslop/blob/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/skills/unslop/references/refs/story-dashboard-frames.webp)
- [Dashboard after](https://github.com/heydamir/unslop/blob/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/skills/unslop/references/refs/unslop-dashboard-after.webp)
- [Hero after](https://github.com/heydamir/unslop/blob/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/skills/unslop/references/refs/unslop-hero-after.webp)

The reference repository's [license](https://github.com/heydamir/unslop/blob/1d13095e4bef6ad6c74f1dd828d84c4ba309a4dc/LICENSE) is [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The four `unslop-*.dsh-theme.json` packages are adaptations by Solar under that license: colors and materials were mapped to DSH's existing token vocabulary, with changed geometry, typography and added variants. No reference image or Unslop code is bundled. Attribution does not imply endorsement.

## Delivery and verification

The public catalog remains `theme/index.json` at the independent repository's existing default source. Entries carry exact-file SHA-256 checksums. Theme source can still be changed in Settings. No runtime rebuild or app restart is needed to browse and download these data-only packages.

`tests/theme-source.test.ts` downloads the published package set through a local HTTP fixture, verifies metadata/checksums, preserves active appearance during import, selects each package, checks restart persistence and restores the prior selection. `tests/theme-library.test.ts` checks rendered text/status/chart contrast across default and hover surfaces with black and white underlays. The preview fixture accepts `?theme=unslop-carbon` (or the other IDs) and uses the actual renderer/settings with local data. See the accompanying acceptance record for checks actually run; none of these themes implies a new market release.
