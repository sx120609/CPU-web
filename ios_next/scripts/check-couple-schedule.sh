#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
check_dir="$(mktemp -d /tmp/cpu-couple-schedule.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT
cd "$repo_dir"
swiftc -swift-version 5 -parse-as-library \
    ios_next/CpuTime/CpuTime/NativeCoupleRules.swift \
    ios_next/tests/NativeCoupleChecks.swift \
    -o "$check_dir/checks"
"$check_dir/checks"
