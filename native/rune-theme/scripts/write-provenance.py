#!/usr/bin/env python3
"""Write distributable Rune provenance and asset hashes without rebuilding Wasm."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


UPSTREAM_COMMIT = "4ca683561a100e16b1ce32f3576f4ade61bd2924"
# These paths are intentionally source-root-relative. They let a consumer bind
# the shipped Wasm to this adapter source without leaking a workstation path.
ADAPTER_SOURCE_FILES = (
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "src/lib.rs",
    "runtime/frame.html",
    "runtime/frame.mjs",
    "scripts/build-wasm.sh",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_provenance(root: Path) -> tuple[list[dict[str, object]], str]:
    records: list[dict[str, object]] = []
    digest = hashlib.sha256()
    for relative in ADAPTER_SOURCE_FILES:
        source = root.joinpath(*PurePosixPath(relative).parts)
        if not source.is_file():
            raise SystemExit(f"RUNE_PROVENANCE_SOURCE_MISSING:{relative}")
        data = source.read_bytes()
        file_hash = sha256(data)
        records.append({"path": relative, "bytes": len(data), "sha256": file_hash})
        # Canonical record boundaries make sourceDigest reproducible without
        # depending on JSON whitespace or host-specific path separators.
        digest.update(f"{file_hash}  {relative}\n".encode("utf-8"))
    return records, digest.hexdigest()


def content_type(path: str) -> str:
    if path.endswith(".d.ts"):
        return "text/plain; charset=utf-8"
    return {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".wasm": "application/wasm",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
    }.get(PurePosixPath(path).suffix, "application/octet-stream")


def write_metadata(out: Path, root: Path, toolchain: str, wasm_bindgen: str) -> None:
    if not out.is_dir():
        raise SystemExit("RUNE_PROVENANCE_OUTPUT_MISSING")
    source_files, source_digest = source_provenance(root)
    provenance = {
        "formatVersion": 1,
        "adapter": {
            "name": "dsh-rune-theme",
            "version": "0.1.0",
            "sourceDigest": source_digest,
            "sourceFiles": source_files,
        },
        "upstream": {
            "repository": "https://github.com/anomalyco/rune",
            "commit": UPSTREAM_COMMIT,
            "license": "MIT",
        },
        "toolchain": {"rust": toolchain, "wasmBindgen": wasm_bindgen},
    }
    (out / "provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    excluded = {"manifest.json", "SHA256SUMS"}
    files = sorted(path for path in out.rglob("*") if path.is_file() and path.name not in excluded)
    assets: list[dict[str, object]] = []
    for path in files:
        data = path.read_bytes()
        relative = path.relative_to(out).as_posix()
        assets.append(
            {
                "path": relative,
                "contentType": content_type(relative),
                "bytes": len(data),
                "sha256": sha256(data),
            }
        )
    manifest = {
        "formatVersion": 1,
        "library": "rune",
        "sourceCommit": UPSTREAM_COMMIT,
        "entry": "frame.html",
        "assets": assets,
    }
    manifest_path = out / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    checksum_paths = files + [manifest_path]
    (out / "SHA256SUMS").write_text(
        "".join(
            f"{sha256(path.read_bytes())}  {path.relative_to(out).as_posix()}\n"
            for path in checksum_paths
        ),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--toolchain", required=True)
    parser.add_argument("--wasm-bindgen", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    write_metadata(args.out.resolve(), args.root.resolve(), args.toolchain, args.wasm_bindgen)
