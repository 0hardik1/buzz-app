#!/usr/bin/env python3
"""Inventory native Rust cache paths without changing build inputs or outputs."""

import argparse
from collections import defaultdict
import json
import os
from pathlib import Path
import re
import stat
import time
import tomllib


HASHED_NAME = re.compile(r"(.+)-([0-9a-f]{16})(?:\..+)?$")
FINGERPRINT = re.compile(r"[0-9a-f]{16}$")
ARTIFACT_DIRECTORIES = {".fingerprint", "build", "deps"}
REGISTRY_SOURCE = re.compile(r"/registry/src/[^/\s]+/([^/\s]+)/")
PROFILE_FILES = {
    ".rlib": "rust-library",
    ".rmeta": "rust-metadata",
    ".a": "native-static-library",
    ".o": "object",
    ".so": "shared-library",
    ".dylib": "shared-library",
    ".d": "dep-info",
}


def files(root):
    for directory, child_dirs, names in os.walk(root):
        child_dirs.sort()
        for name in sorted(names):
            path = Path(directory, name)
            info = path.lstat()
            if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                yield path, info


def tally(table, key, info, seen):
    row = table.setdefault(key, {"files": 0, "bytes": 0, "unique_bytes": 0})
    row["files"] += 1
    row["bytes"] += info.st_size
    inode = (info.st_dev, info.st_ino)
    if inode not in seen:
        row["unique_bytes"] += info.st_size
        seen.add(inode)


def identify_target(relative):
    parts = relative.parts
    for index, part in enumerate(parts[:-1]):
        if part in ARTIFACT_DIRECTORIES:
            profile = "/".join(parts[:index])
            entry = parts[index + 1]
            return f"target/{profile}/{part}", profile, part, HASHED_NAME.fullmatch(entry)
    if parts[0] in {"buzz-cli", "buzz-cli-build"} and len(parts) >= 2:
        return f"target/{parts[0]}/{parts[1]}", None, None, None
    return f"target/{parts[0]}" if len(parts) > 1 else "target/root-files", None, None, None


def read_fingerprint(path):
    data = json.loads(path.read_text())
    digest_path = path.with_suffix("")
    digest = digest_path.read_text() if digest_path.is_file() and digest_path.stat().st_size == 16 else None
    if digest and not FINGERPRINT.fullmatch(digest):
        digest = None
    return {
        "name": path.stem,
        "digest": digest,
        "features": data.get("features"),
        "cargo_profile": data.get("profile"),
        "dependencies": [
            [name, value.to_bytes(8, "little").hex()]
            for _, name, _, value in data.get("deps", [])
        ],
    }


def lock_packages(path):
    with path.open("rb") as handle:
        data = tomllib.load(handle)
    return [[pkg["name"], pkg["version"], pkg.get("source")] for pkg in data["package"]]


def collect(target, cargo_home):
    groups = {}
    kinds = {}
    units = defaultdict(lambda: {"packages": set(), "fingerprints": [], "registry_paths": set(), "files": {}})
    group_inodes, kind_inodes, unit_inodes = set(), set(), set()
    errors = []
    for path, info in files(target):
        relative = path.relative_to(target)
        group, profile, directory, match = identify_target(relative)
        kind = PROFILE_FILES.get(path.suffix, "other")
        tally(groups, group, info, group_inodes)
        tally(kinds, f"{group}/{kind}", info, kind_inodes)
        if not match:
            continue
        name, unit_hash = match.groups()
        unit = units[profile, unit_hash]
        tally(unit["files"], directory, info, unit_inodes)
        if directory != "deps":
            unit["packages"].add(name)
        if not stat.S_ISREG(info.st_mode):
            continue
        try:
            if directory == ".fingerprint" and path.suffix == ".json" and info.st_size <= 65536:
                unit["fingerprints"].append(read_fingerprint(path))
            if directory == "deps" and path.suffix == ".d":
                with path.open("rb") as handle:
                    first_rule = handle.readline(16384).decode(errors="replace")
                unit["registry_paths"].update(REGISTRY_SOURCE.findall(first_rule))
        except (OSError, ValueError, TypeError) as error:
            if len(errors) < 30:
                errors.append([str(relative), str(error)])

    cargo_paths = (
        "registry/src", "registry/index", "registry/cache", "git/checkouts", "git/db", "bin",
    )
    for subtree in cargo_paths:
        key = f"cargo-home/{subtree}"
        for _, info in files(cargo_home / subtree):
            tally(groups, key, info, group_inodes)
    for name in (".crates.toml", ".crates2.json"):
        path = cargo_home / name
        if path.is_file():
            tally(groups, f"cargo-home/{name}", path.lstat(), group_inodes)

    records = []
    for (profile, unit_hash), data in sorted(units.items()):
        data["packages"] = sorted(data["packages"])
        data["registry_paths"] = sorted(data["registry_paths"])
        records.append({"profile": profile, "hash": unit_hash, **data})
    return {"groups": groups, "file_types": kinds, "units": records, "read_errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target", type=Path, default=Path(os.environ.get("CARGO_TARGET_DIR", "target")))
    parser.add_argument("--cargo-home", type=Path, default=Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo")))
    args = parser.parse_args()
    start = time.monotonic()
    inventory = collect(args.target, args.cargo_home)
    inventory["phase"] = args.phase
    inventory["workspace_packages"] = lock_packages(Path("Cargo.lock"))
    inventory["cli_pin"] = re.search(
        r'buzz-audio-client\s*=\s*\{[^}]*\brev\s*=\s*"([0-9a-f]{40})"',
        Path("src-tauri/Cargo.toml").read_text(),
    ).group(1)
    checkouts = args.cargo_home / "git" / "checkouts"
    cli_locks = sorted(checkouts.glob(f"buzz-*/{inventory['cli_pin'][:7]}*/Cargo.lock"))
    inventory["cli_packages"] = lock_packages(cli_locks[0]) if len(cli_locks) == 1 else None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, separators=(",", ":")) + "\n")
    print(f"Rust cache inventory {args.phase}: {len(inventory['units'])} groups of Cargo artifacts, "
          f"{len(inventory['read_errors'])} bounded read errors, {time.monotonic() - start:.2f}s")


if __name__ == "__main__":
    main()
