#!/usr/bin/env python3
"""Scan an explicit publication allowlist without echoing matched values."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re

ENCODED = [
    [102, 117, 99, 107], [115, 104, 105, 116],
    [101, 115, 112, 110], [100, 105, 115, 110, 101, 121],
    [103, 97, 109, 101, 99, 97, 115, 116],
]
PATTERNS = [
    ("private-address", re.compile(r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b")),
    ("private-user-path", re.compile(r"/(?:Users|Volumes)/[^\s\"']+|/" + r"home/(?!runner(?:/|\b))[^/\s]+/[^\s\"']+")),
    ("credential", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{35,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b")),
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----")),
]
for index, codes in enumerate(ENCODED):
    value = "".join(map(chr, codes))
    expression = r"(?<![A-Za-z])" + value + r"(?![A-Za-z])" if index == 1 else value
    PATTERNS.append(("wording-" + str(index + 1), re.compile(expression, re.I)))


def findings(text: str, path: str, private: list[str]) -> list[dict]:
    result = []
    for line, content in enumerate(text.splitlines(), 1):
        for category, pattern in PATTERNS:
            if pattern.search(content):
                result.append({"file": path, "line": line, "category": category})
        for value in private:
            if value and value.casefold() in content.casefold():
                result.append({"file": path, "line": line, "category": "private-configured-value"})
    return result


def canary(directory: Path) -> dict:
    directory.mkdir(parents=True, exist_ok=False)
    samples = {
        "private-address": ".".join(map(str, [192, 168, 240, 241])),
        "private-user-path": "/" + "/".join(["Users", "fixture-person", "private-fixture"]),
        "credential": "gh" + "p_" + hashlib.sha256(b"publication-scanner-canary").hexdigest()[:36],
        "private-key": "-----BEGIN " + "PRIVATE KEY-----",
    }
    samples.update({"wording-" + str(i + 1): "".join(map(chr, codes)) for i, codes in enumerate(ENCODED)})
    detected = {}
    for category, value in samples.items():
        path = directory / (category + ".txt")
        with path.open("x") as handle:
            handle.write(value + "\n")
        detected[category] = category in {row["category"] for row in findings(path.read_text(), path.name, [])}
    if not all(detected.values()):
        raise RuntimeError("Scanner canary failed: " + ",".join(key for key, found in detected.items() if not found))
    return {"positive_canaries": detected, "all_detected": True}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--private-values", help="Private, untracked JSON list; never include it in a publication tree")
    parser.add_argument("--self-test-dir", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    positive = canary(Path(args.self_test_dir))
    root = Path(args.root).resolve(strict=True)
    manifest = json.loads(Path(args.manifest).read_text())
    private = json.loads(Path(args.private_values).read_text()) if args.private_values else []
    # Runtime-only values are compared in memory and never copied into reports.
    private += [value for key, value in os.environ.items() if len(value) >= 12 and re.search(r"secret|token|password|api.?key", key, re.I)]
    hits = []
    checked = []
    for row in manifest:
        relative = Path(row["path"])
        if relative.is_absolute() or ".." in relative.parts or any(part in (".git", ".env", ".DS_Store") or part.startswith("._") for part in relative.parts):
            raise RuntimeError("Non-public path in allowlist")
        path = root / relative
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
            raise RuntimeError("Non-file or path escape in allowlist")
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != row["sha256"]:
            raise RuntimeError("Allowlisted file changed: " + row["path"])
        checked.append({"path": row["path"], "sha256": digest, "bytes": len(data)})
        if path.suffix.lower() not in (".png", ".webp"):
            text = data.decode("utf-8")
            hits.extend(findings(text, row["path"], private))
    result = {"result": "PASS" if checked and not hits else "FAIL", "canaries": positive, "files": checked, "findings": hits}
    with Path(args.report).open("x") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({"result": result["result"], "files": len(checked), "findings": len(hits), "canaries": positive["all_detected"]}))
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
