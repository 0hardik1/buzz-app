#!/usr/bin/env bash
# Compare the two default Cargo/CLI sequences using one host and one seed.
set -euo pipefail

test "${GITHUB_ACTIONS:-}" = true
test "$(pwd -P)" = "${GITHUB_WORKSPACE:?}"
test "${CARGO_HOME:?}" = "$HOME/.cargo"
test "${CARGO_INCREMENTAL:-}" = 0
test -z "${CARGO_TARGET_DIR:-}"
test ! -e .env.local

harness="${RUNNER_TEMP:?}/rust-trial-harness"
evidence="$RUNNER_TEMP/rust-trial-evidence"
seed="$RUNNER_TEMP/rust-trial-seed"

inventory() {
    timeout 90s python3 "$harness/ci-rust-cache-inventory.py" \
        --phase "$1" --output "$evidence/inventory/$1.json"
}

record_environment() {
    mkdir -p "$evidence"
    {
        printf 'revision=%s\n' "$(git rev-parse HEAD)"
        printf 'workflow_revision=%s\n' "$GITHUB_SHA"
        printf 'runner_arch=%s\n' "$RUNNER_ARCH"
        printf 'runner_name=%s\n' "$RUNNER_NAME"
        printf 'image_os=%s\n' "${ImageOS:-unknown}"
        printf 'image_version=%s\n' "${ImageVersion:-unknown}"
        printf 'logical_cpus=%s\n' "$(nproc)"
        printf 'rust_cache_exact_hit=%s\n' "${RUST_CACHE_HIT:-}"
        printf 'cargo_incremental=%s\n' "$CARGO_INCREMENTAL"
        ./bin/rustup show active-toolchain
        ./bin/cargo --version
        ./bin/rustc --version --verbose
        ./bin/node --version
        uname -sr
    } | tee "$evidence/environment.txt"
    inventory restored
}

paths=(
    "$GITHUB_WORKSPACE/target"
    "$GITHUB_WORKSPACE/src-tauri/gen"
    "$GITHUB_WORKSPACE/src-tauri/permissions"
    "$GITHUB_WORKSPACE/src-tauri/resources/bin"
    "$CARGO_HOME/git"
    "$CARGO_HOME/registry"
    "$CARGO_HOME/.global-cache"
    "$CARGO_HOME/.global-cache-wal"
    "$CARGO_HOME/.global-cache-shm"
)
# Compare restored relative paths, kinds, symlink targets, modes, sizes and
# fractional mtimes. Directory disk allocation and access times are irrelevant.
state_digest() {
    python3 - "${paths[@]}" <<'PY'
import hashlib
import os
from pathlib import Path
import stat
import sys

digest = hashlib.sha256()


def record(path):
    info = path.lstat()
    directory = stat.S_ISDIR(info.st_mode)
    link = os.readlink(path) if stat.S_ISLNK(info.st_mode) else ""
    fields = (path, info.st_mode, info.st_mtime_ns, 0 if directory else info.st_size, link)
    digest.update(b"\0".join(os.fsencode(str(field)) for field in fields) + b"\0")
    if directory:
        for child in sorted(path.iterdir()):
            record(child)


for arg in sys.argv[1:]:
    root = Path(arg)
    if root.exists():
        record(root)
    else:
        digest.update(os.fsencode(root) + b"\0missing\0")
print(digest.hexdigest())
PY
}

snapshot() {
    local free_kib seed_kib
    df -h "$RUNNER_TEMP" "$GITHUB_WORKSPACE" "$CARGO_HOME" > "$evidence/disk-before.txt"
    free_kib="$(df -k --output=avail "$RUNNER_TEMP" | tail -1)"
    seed_kib="$(du -skc target "$CARGO_HOME/git" "$CARGO_HOME/registry" | tail -1 | cut -f1)"
    if (( free_kib < seed_kib + 20 * 1024 * 1024 )); then
        cat "$evidence/disk-before.txt"
        echo 'Insufficient free disk for one seed snapshot and build growth.'
        exit 1
    fi
    mkdir "$seed"
    for i in "${!paths[@]}"; do
        path="${paths[$i]}"
        test ! -L "$path"
        if [[ -e "$path" ]]; then
            cp -a --reflink=auto -- "$path" "$seed/$i"
        fi
    done
    state_digest > "$evidence/seed.sha256"
}

reset() {
    for i in "${!paths[@]}"; do
        path="${paths[$i]}"
        test ! -L "$path"
        rm -rf -- "$path"
        if [[ -e "$seed/$i" ]]; then
            cp -a --reflink=auto -- "$seed/$i" "$path"
        fi
    done
    test ! -e .env.local
    actual="$(state_digest)"
    printf '%s\t%s\n' "$1" "$actual" | tee -a "$evidence/restored-digests.tsv"
    test "$actual" = "$(cat "$evidence/seed.sha256")"
    test -z "$(git status --porcelain)"
}

monotonic_ns() {
    python3 -c 'from time import monotonic_ns; print(monotonic_ns())'
}

run_phase() {
    local phase="$1" start end status=0
    shift
    start="$(monotonic_ns)"
    "$@" > "$evidence/$iteration-$phase.log" 2>&1 || status=$?
    end="$(monotonic_ns)"
    printf '%s\t%s\t%s\t%s\n' "$iteration" "$phase" "$((end - start))" "$status" |
        tee -a "$evidence/timing.tsv"
    if (( status != 0 )); then
        tail -100 "$evidence/$iteration-$phase.log"
        return "$status"
    fi
}

run_abba() {
    test -d target/debug/.fingerprint
    test ! -e src-tauri/resources/bin/buzz
    inventory post-clippy
    snapshot
    printf 'iteration\tphase\tmonotonic_duration_ns\texit_status\n' > "$evidence/timing.tsv"
    for iteration in A1 B1 B2 A2; do
        reset "$iteration"
        printf 'Starting %s\n' "$iteration"
        if [[ "$iteration" = A* ]]; then
            run_phase stage-and-verify ./bin/node scripts/test-buzz-cli.mjs
            run_phase workspace ./bin/cargo test --workspace --locked
        else
            run_phase stage ./bin/node scripts/build-buzz-cli.mjs --dev
            run_phase workspace ./bin/cargo test --workspace --locked
            run_phase verify ./bin/node scripts/test-buzz-cli.mjs --prebuilt
        fi
        test -z "$(git status --porcelain)"
        inventory "$iteration"
    done
    python3 "$harness/ci-rust-compile-once-audit.py" "$evidence"
}

case "${1:-}" in
    restored) record_environment ;;
    compare) run_abba ;;
    *) exit 2 ;;
esac
