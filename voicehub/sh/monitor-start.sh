#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_SCRIPT="${ROOT_DIR}/sh/monitor.sh"
LOG_FILE="${MONITOR_LOG_FILE:-/tmp/voicehub-monitor.log}"

if pgrep -f "${MONITOR_SCRIPT}" >/dev/null 2>&1; then
  echo "monitor already running"
  exit 0
fi

nohup bash "${MONITOR_SCRIPT}" >"${LOG_FILE}" 2>&1 &
PID=$!

echo "monitor started: pid=${PID}"
echo "log file: ${LOG_FILE}"
