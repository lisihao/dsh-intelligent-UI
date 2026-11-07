#!/usr/bin/env python3
"""Emit license text for the resolved wasm32 Rust dependency closure.

The output contains public crate identifiers and hashes only; local Cargo
registry and checkout paths are read but never distributed. No package is
downloaded by this helper.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def lock_checksums(path: pathlib.Path) -> dict[tuple[str, str, str | None], str | None]:
    result: dict[tuple[str, str, str | None], str | None] = {}
    current: dict[str, str] = {}
    def save() -> None:
        if "name" in current and "version" in current:
            result[(current["name"], current["version"], current.get("source"))] = current.get("checksum")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line == "[[package]]":
            save()
            current = {}
            continue
        if " = " not in line:
            continue
        key, value = line.split(" = ", 1)
        if key not in {"name", "version", "source", "checksum"} or not value.startswith('"'):
            continue
        try:
            current[key] = json.loads(value)
        except json.JSONDecodeError:
            continue
    save()
    return result


def resolved_closure(metadata: dict[str, object]) -> list[dict[str, object]]:
    resolve = metadata.get("resolve")
    if not isinstance(resolve, dict) or not isinstance(resolve.get("root"), str):
        raise RuntimeError("Cargo metadata did not identify the adapter root")
    nodes = {item["id"]: item for item in resolve.get("nodes", []) if isinstance(item, dict) and isinstance(item.get("id"), str)}
    todo, visited = [resolve["root"]], set()
    while todo:
        package_id = todo.pop()
        if package_id in visited:
            continue
        visited.add(package_id)
        node = nodes.get(package_id)
        if node:
            todo.extend(value for value in node.get("dependencies", []) if isinstance(value, str))
    packages = [item for item in metadata.get("packages", []) if isinstance(item, dict) and item.get("id") in visited]
    return sorted(packages, key=lambda item: (str(item.get("name")), str(item.get("version")), str(item.get("source") or "")))


def license_files(manifest: pathlib.Path) -> list[pathlib.Path]:
    directory = manifest.parent
    for _ in range(5):
        found = sorted(item for item in directory.iterdir() if item.is_file() and item.name.lower().startswith(("license", "copying", "notice", "unlicense")))
        if found:
            return found
        if directory.parent == directory:
            break
        directory = directory.parent
    return []


def public_source(package: dict[str, object]) -> str:
    source = package.get("source")
    if isinstance(source, str):
        return source
    repository = package.get("repository")
    return repository if isinstance(repository, str) else "path package"


def canonical_license_texts(packages: list[dict[str, object]]) -> dict[str, bytes]:
    """Use exact standard texts already carried by another resolved crate.

    Some crates publish only SPDX metadata in their crate tarball. A standard
    MIT/Apache expression still needs its legal text in the distributed bundle;
    use an exact local copy from the same locked closure and label it as such.
    """
    texts: dict[str, bytes] = {}
    for package in packages:
        for file in license_files(pathlib.Path(str(package["manifest_path"]))):
            name = file.name.lower()
            data = file.read_bytes()
            if "mit" in name and "MIT" not in texts:
                texts["MIT"] = data
            if "apache" in name and "Apache-2.0" not in texts:
                texts["Apache-2.0"] = data
    return texts


def fallback_records(expression: object, canonical: dict[str, bytes]) -> list[tuple[str, bytes]] | None:
    value = str(expression or "")
    if value == "MIT":
        wanted = ["MIT"]
    elif value == "Apache-2.0":
        wanted = ["Apache-2.0"]
    elif value == "MIT OR Apache-2.0":
        wanted = ["MIT", "Apache-2.0"]
    else:
        return None
    if any(item not in canonical for item in wanted):
        return None
    return [(f"CANONICAL-{item}.txt", canonical[item]) for item in wanted]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cargo", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--lock", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    manifest = pathlib.Path(args.manifest).resolve()
    metadata = json.loads(subprocess.run(
        [args.cargo, "metadata", "--manifest-path", str(manifest), "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"],
        check=True, capture_output=True, text=True,
    ).stdout)
    root_id = metadata["resolve"]["root"]
    checksums = lock_checksums(pathlib.Path(args.lock).resolve())
    output = [
        "# Third-party Rust dependency licenses", "",
        "Generated from Cargo metadata for wasm32-unknown-unknown with --locked.",
        "Each record names a public crate/version/source and hashes the exact included license text.",
        "No local Cargo registry or checkout path is distributed in this file.", "",
    ]
    packages = resolved_closure(metadata)
    canonical = canonical_license_texts(packages)
    missing, count = [], 0
    for package in packages:
        if package.get("id") == root_id:
            continue
        name, version = str(package["name"]), str(package["version"])
        source = package.get("source") if isinstance(package.get("source"), str) else None
        files = license_files(pathlib.Path(str(package["manifest_path"])))
        records = [(path.name, path.read_bytes()) for path in files]
        used_canonical = False
        if not records:
            records = fallback_records(package.get("license"), canonical) or []
            used_canonical = bool(records)
        if not records:
            missing.append(f"{name} {version} ({public_source(package)})")
            continue
        checksum = checksums.get((name, version, source))
        output.extend([
            f"## {name} {version}",
            f"License metadata: {package.get('license') or 'UNSPECIFIED'}",
            f"Source: {public_source(package)}",
            *([f"Cargo checksum: {checksum}"] if checksum else []),
            *( ["License text: canonical SPDX text from another resolved dependency because this crate archive contained metadata only"] if used_canonical else [] ),
            "Included files: " + ", ".join(f"{label} (sha256 {digest(data)})" for label, data in records),
            "",
        ])
        for label, data in records:
            output.extend([f"--- BEGIN {label} ---", data.decode("utf-8", errors="replace").replace("\r\n", "\n").rstrip(), f"--- END {label} ---", ""])
        count += 1
    if missing:
        print("Missing license text for resolved wasm dependencies:", file=sys.stderr)
        print("\n".join(missing), file=sys.stderr)
        return 2
    output.append(f"# Included dependency records: {count}")
    pathlib.Path(args.out).write_text("\n".join(output) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
