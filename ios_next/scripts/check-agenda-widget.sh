#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
check_dir="$(mktemp -d /tmp/cpu-agenda-widget.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT
cd "$repo_dir"
swiftc -swift-version 5 -parse-as-library \
    ios_next/CpuTime/CpuTime/NativeScheduleStore.swift \
    ios_next/CpuTime/CpuTime/NativeAgendaRules.swift \
    ios_next/CpuTime/CpuTime/NativeAgendaWidgetProjection.swift \
    ios_next/CpuTime/CPUWebWidgets/AgendaWidgetSnapshot.swift \
    ios_next/tests/AgendaWidgetChecks.swift \
    -o "$check_dir/checks"
"$check_dir/checks"
