#!/usr/bin/env python3
"""Check that each measured iteration ran the same workspace and CLI checks."""

from collections import Counter
from pathlib import Path
import csv
import re
import sys


def read(path):
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", path.read_text())


def workspace_checks(text):
    suite = None
    checks = Counter()
    for line in text.splitlines():
        label = re.match(r"\s+(Running|Doc-tests) (.+)", line)
        if label:
            suite = label.groups()
        outcome = re.fullmatch(r"test (.+) \.\.\. (ok|ignored|FAILED)(?:,.*)?", line)
        if outcome:
            if suite is None:
                raise ValueError(f"Could not identify test suite for {line}")
            checks[suite, *outcome.groups()] += 1
    if not any(key[0][0] == "Doc-tests" for key in checks):
        raise ValueError("Workspace result contains no doctests")
    return checks


def cli_checks(text):
    if "resources/bin/buzz --help ok" not in text:
        raise ValueError("Missing bundled CLI --help success")
    inventory = re.search(
        r"Desktop rejects all (\d+) bundled CLI commands and (\d+) root options", text
    )
    if inventory is None:
        raise ValueError("Missing desktop CLI rejection inventory")
    return inventory.groups()


def main():
    evidence = Path(sys.argv[1])
    baseline_workspace = workspace_checks(read(evidence / "A1-workspace.log"))
    baseline_cli = cli_checks(read(evidence / "A1-stage-and-verify.log"))

    for iteration in ("A1", "B1", "B2", "A2"):
        workspace = workspace_checks(read(evidence / f"{iteration}-workspace.log"))
        suffix = "stage-and-verify" if iteration.startswith("A") else "verify"
        cli = cli_checks(read(evidence / f"{iteration}-{suffix}.log"))
        if workspace != baseline_workspace or cli != baseline_cli:
            raise ValueError(f"{iteration} coverage differs from A1")
        print(f"{iteration}: {sum(workspace.values())} Rust test results match A1, "
              f"CLI rejected {cli[0]} commands and {cli[1]} options")

    totals = Counter()
    with (evidence / "timing.tsv").open() as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["exit_status"] != "0":
                raise ValueError(f"Failed command: {row}")
            totals[row["iteration"]] += int(row["monotonic_duration_ns"])
    for iteration, duration in totals.items():
        print(f"{iteration}: {duration / 1e9:.3f} seconds of default test and CLI work")
    for before, after in (("A1", "B1"), ("A2", "B2")):
        print(f"{before} - {after}: {(totals[before] - totals[after]) / 1e9:.3f} seconds")


if __name__ == "__main__":
    main()
