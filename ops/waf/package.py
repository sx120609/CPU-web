#!/usr/bin/env python3
"""Create a commit-bound, hash-verifiable WAF companion artifact in GitHub Actions."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

FILES = ["agent.py", "engine.py", "adaptive.py", "config.example.json", "nginx-http.conf", "nginx-server.conf",
         "cpu-web-waf.service", "logrotate.conf", "cpu-web-waf-logrotate.service", "cpu-web-waf-logrotate.timer"]


def build(commit, destination):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("a full lowercase Git SHA is required")
    root = Path(__file__).resolve().parent
    entries = {"ops/waf/" + name: (root / name).read_bytes() for name in FILES}
    entries["docs/dynamic-waf.md"] = (root.parent.parent / "docs/dynamic-waf.md").read_bytes()
    manifest = {"schemaVersion": 1, "commit": commit, "files": {
        name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for name, data in entries.items()
    }}
    entries["manifest.json"] = json.dumps(manifest, sort_keys=True, indent=2).encode()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    artifact = destination / f"cpu-web-waf-{commit}.tar.gz"
    with tarfile.open(artifact, "w:gz") as output:
        for name, data in sorted(entries.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            output.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_name(artifact.name + ".sha256").write_text(f"{digest}  {artifact.name}\n", encoding="ascii")
    return artifact


def verify(artifact, commit):
    with tarfile.open(artifact, "r:gz") as archive:
        members = archive.getmembers()
        if any(not m.isfile() or m.size > 1048576 for m in members):
            raise ValueError("unexpected archive member")
        manifest_file = archive.extractfile("manifest.json")
        manifest = json.load(manifest_file)
        if manifest.get("schemaVersion") != 1 or manifest.get("commit") != commit:
            raise ValueError("artifact commit/schema mismatch")
        expected = {"ops/waf/" + name for name in FILES} | {"docs/dynamic-waf.md"}
        if set(manifest["files"]) != expected or {m.name for m in members} != expected | {"manifest.json"} or len(members) != len(expected) + 1:
            raise ValueError("unexpected or duplicate artifact paths")
        for name, meta in manifest["files"].items():
            data = archive.extractfile(name).read()
            if len(data) != meta["bytes"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
                raise ValueError(f"artifact hash mismatch: {name}")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", default=".")
    parser.add_argument("--verify", help="verify an existing artifact without extracting")
    args = parser.parse_args()
    artifact = Path(args.verify) if args.verify else build(args.commit, args.output)
    verify(artifact, args.commit)
    print(artifact)
