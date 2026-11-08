#!/usr/bin/env bash
# Build this pinned Rust adapter without touching the user's default Rust toolchain.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/dist"}
toolchain=${RUNE_THEME_TOOLCHAIN:-1.99.1}
wasm_bindgen_bin=${RUNE_THEME_WASM_BINDGEN:-wasm-bindgen}
# Resolve both executables from the requested toolchain. Do not inherit CARGO,
# RUSTC or RUSTUP_TOOLCHAIN: Cargo build scripts otherwise can silently route
# through the user's default Rust toolchain.
cargo_bin=$(rustup run "$toolchain" which cargo)
rustc_bin=$(rustup run "$toolchain" which rustc)
export RUSTUP_TOOLCHAIN="$toolchain"
export RUSTC="$rustc_bin"
# Keep personal build paths out of a distributable WASM. These are process-local
# build flags; they do not change a user's global Cargo or Rustup configuration.
export RUSTFLAGS="--remap-path-prefix=$HOME=/home --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_STRIP=debuginfo

version=$(awk '
  $1 == "name" && $3 == "\"wasm-bindgen\"" { wanted = 1; next }
  wanted && $1 == "version" { gsub(/"/, "", $3); print $3; exit }
' "$root/Cargo.lock")
if [[ -z $version ]]; then
  echo "wasm-bindgen package is missing from Cargo.lock" >&2
  exit 2
fi
if ! command -v "$wasm_bindgen_bin" >/dev/null || [[ $("$wasm_bindgen_bin" --version) != "wasm-bindgen $version" ]]; then
  printf 'Need wasm-bindgen-cli %s (Cargo.lock)\n' "$version" >&2
  exit 2
fi

mkdir -p "$out"
"$cargo_bin" build --manifest-path "$root/Cargo.toml" --locked --target wasm32-unknown-unknown --release
target_dir=$("$cargo_bin" metadata --manifest-path "$root/Cargo.toml" --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')
"$wasm_bindgen_bin" --target web --out-dir "$out" --out-name rune_theme "$target_dir/wasm32-unknown-unknown/release/dsh_rune_theme.wasm"
python3 "$root/scripts/verify-font-embedding.py" \
  --cargo "$cargo_bin" \
  --manifest "$root/Cargo.toml" \
  --wasm "$out/rune_theme_bg.wasm" \
  --out "$out/font-embedding-provenance.json"
cp "$root/LICENSE-RUNE-MIT.txt" "$out/LICENSE-RUNE-MIT.txt"
cp "$root/THIRD_PARTY_NOTICES.md" "$out/THIRD_PARTY_NOTICES.md"
cp "$root/runtime/frame.html" "$out/frame.html"
cp "$root/runtime/frame.mjs" "$out/frame.mjs"
python3 "$root/scripts/collect-licenses.py" \
  --cargo "$cargo_bin" \
  --manifest "$root/Cargo.toml" \
  --lock "$root/Cargo.lock" \
  --out "$out/THIRD_PARTY_LICENSES.txt"
python3 "$root/scripts/write-provenance.py" \
  --out "$out" \
  --root "$root" \
  --toolchain "$toolchain" \
  --wasm-bindgen "$version"
