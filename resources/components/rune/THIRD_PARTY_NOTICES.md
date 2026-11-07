# Third-party notices

This adapter links the following unmodified upstream Rust crates at the exact
revision recorded in `Cargo.toml` and `Cargo.lock`:

- Rune / rune-fx — https://github.com/anomalyco/rune
  `4ca683561a100e16b1ce32f3576f4ade61bd2924`, MIT.

The upstream repository's `LICENSE` must accompany any distributed WASM output.
The build also emits `THIRD_PARTY_LICENSES.txt`: the actual wasm32 Cargo
dependency closure's license texts, each marked with public crate name,
version, source identifier, Cargo checksum where available, and a hash of the
included license file. The generator fails when a resolved dependency has no
discoverable license text; it does not download or infer a substitute.
Rune's web `embedded-fonts` feature is absent from this adapter's resolved
dependency graph: `Cargo.toml` declares `rune` with `default-features = false`,
and the locked `cargo tree -e features -i rune` has no `embedded-fonts` edge.
At this source pin, `crates/rune/src/text/default_fonts.rs` compiles Inter and
IBM Plex Mono bytes for wasm only when that feature is present. The final WASM
artifact is compared byte-for-byte and by 256-byte prefix against every pinned
Rune TTF during the build; `font-embedding-provenance.json` records that result.
Host text, math, code and controls remain in the DSH DOM above the material
canvas.
