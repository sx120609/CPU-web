#!/bin/bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
check_dir="$(mktemp -d /tmp/cpu-live-activity-checks.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT

# Compile and execute the actual controller against an in-memory ActivityKit
# boundary on macOS; no device, XCTest or school account is required.
swiftc -swift-version 5 -emit-library -emit-module -module-name ActivityKit \
    "$repo_dir/ios_next/tests/fixtures/ActivityKit.swift" \
    -o "$check_dir/libActivityKit.dylib" -emit-module-path "$check_dir/ActivityKit.swiftmodule"
swiftc -swift-version 5 -I "$check_dir" -L "$check_dir" -lActivityKit \
    -Xlinker -rpath -Xlinker "$check_dir" \
    "$repo_dir/ios_next/CpuTime/CpuTime/NativeScheduleStore.swift" \
    "$repo_dir/ios_next/CpuTime/CPUWebWidgets/ScheduleLiveActivityAttributes.swift" \
    "$repo_dir/ios_next/CpuTime/CpuTime/NativeLiveActivityController.swift" \
    "$repo_dir/ios_next/CpuTime/CpuTime/LiveActivityPushService.swift" \
    "$repo_dir/ios_next/tests/NativeLiveActivityChecks.swift" \
    -o "$check_dir/checks"
"$check_dir/checks"
