#!/usr/bin/env python3
"""Prove whether the built Rune wasm embeds its pinned default TTF assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cargo", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--wasm", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    metadata = json.loads(subprocess.run(
        [args.cargo, "metadata", "--manifest-path", args.manifest, "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"],
        check=True, capture_output=True, text=True,
    ).stdout)
    rune = next((item for item in metadata["packages"] if item.get("name") == "rune"), None)
    if rune is None:
        raise RuntimeError("resolved Rune package is missing")
    assets = pathlib.Path(rune["manifest_path"]).parent / "assets"
    wasm = pathlib.Path(args.wasm).read_bytes()
    fonts = []
    for font in sorted(assets.glob("*.ttf")):
        data = font.read_bytes()
        fonts.append({
            "name": font.name,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "fullBytesPresent": data in wasm,
            "prefix256Present": data[:256] in wasm,
        })
    if any(font["fullBytesPresent"] or font["prefix256Present"] for font in fonts):
        raise RuntimeError("RUNE_THEME_EMBEDDED_FONT_BYTES_PRESENT")
    pathlib.Path(args.out).write_text(json.dumps({
        "formatVersion": 1,
        "rune": {"version": rune["version"], "source": rune.get("source")},
        "embeddedFonts": False,
        "method": "exact full-byte and 256-byte-prefix comparison against pinned Rune assets",
        "fonts": fonts,
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
