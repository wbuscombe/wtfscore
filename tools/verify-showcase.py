#!/usr/bin/env python3
"""Verify freshly generated showcase images and attach OCR provenance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


def normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def main() -> int:
    from PIL import Image, ImageDraw
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=".")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True, help="New verified, sanitized manifest")
    parser.add_argument("--contact-sheet", required=True, help="New review image; not a published gallery frame")
    args = parser.parse_args()
    project = Path(args.project).resolve(strict=True)
    manifest = json.loads(Path(args.manifest).read_text())
    proofs = []
    thumbnails = []
    for capture in manifest["captures"]:
        path = project / capture["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != capture["sha256"]:
            raise RuntimeError("Capture hash changed: " + capture["id"])
        with Image.open(path) as source:
            image = source.convert("RGB")
        state = capture["state"]
        ratio = 3 if state["viewport"][0] == 390 else 2
        expected = tuple(value * ratio for value in state["viewport"])
        if image.size != expected or path.stat().st_size < 10_000:
            raise RuntimeError("Wrong dimensions or suspiciously small frame: " + capture["id"])
        unique = len(image.resize((40, 40)).getcolors(1601) or [])
        if unique < 6:
            raise RuntimeError("Blank frame: " + capture["id"])
        ocr = subprocess.run(["tesseract", str(path), "stdout", "--psm", "11"], capture_output=True, text=True, timeout=20, check=True).stdout
        words = normalize(ocr)
        missing = [token for token in state["expected_ocr"] if normalize(token) not in words]
        if missing:
            raise RuntimeError("OCR did not confirm expected state: " + capture["id"] + ": " + ", ".join(missing))
        if re.search(r"\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|/(?:Users|Volumes)/", ocr):
            raise RuntimeError("Private-looking text in screenshot")
        proof = {"id": capture["id"], "pixel_size": list(image.size), "bytes": path.stat().st_size, "nonblank": True, "ocr_expected": state["expected_ocr"], "ocr_confirmed": True, "ocr_text": ocr.strip()}
        proofs.append(proof)
        capture["verification"] = proof
        image.thumbnail((580, 370))
        tile = Image.new("RGB", (600, 420), "#161b22")
        tile.paste(image, ((600 - image.width) // 2, 35))
        ImageDraw.Draw(tile).text((12, 10), capture["id"], fill="#dde2e8")
        thumbnails.append(tile)
    if len(proofs) not in (1, 16):
        raise RuntimeError("Incomplete showcase")
    sheet = Image.new("RGB", (1200, ((len(thumbnails) + 1) // 2) * 420), "#0b0e12")
    for index, tile in enumerate(thumbnails):
        sheet.paste(tile, ((index % 2) * 600, (index // 2) * 420))
    output_sheet = Path(args.contact_sheet)
    if output_sheet.exists():
        raise RuntimeError("Review sheet already exists")
    sheet.save(output_sheet)
    manifest["verification"] = {"result": "PASS", "captures": len(proofs), "ocr": "Tesseract, psm 11", "visual_review": "Required before publication"}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with Path(args.output).open("x") as handle:
        json.dump(manifest, handle, indent=2)
    print(json.dumps({"result": "PASS", "verified": len(proofs)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
