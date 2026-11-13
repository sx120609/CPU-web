#!/bin/bash
set -euo pipefail
# 课前提醒, 「TA 下课了」, shared free time, classes together and the watch's 日程 list: the
# rules only, compiled on their own on macOS. No device or account is needed.
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
check_dir="$(mktemp -d /tmp/cpu-class-reminders.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT
cd "$repo_dir"
swiftc -swift-version 5 -parse-as-library \
    ios_next/CpuTime/CpuTime/NativeScheduleStore.swift \
    ios_next/CpuTime/CpuTime/ScheduleDisplayRules.swift \
    ios_next/CpuTime/CpuTime/NativeClassReminderRules.swift \
    ios_next/CpuTime/WatchShared/WatchAgenda.swift \
    ios_next/tests/NativeClassReminderChecks.swift \
    -o "$check_dir/checks"
"$check_dir/checks"
