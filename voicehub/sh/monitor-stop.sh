#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR_SCRIPT="${ROOT_DIR}/sh/monitor.sh"

PIDS="$(pgrep -f "${MONITOR_SCRIPT}" || true)"

if [ -z "${PIDS}" ]; then
  echo "monitor is not running"
  exit 0
fi

echo "${PIDS}" | xargs kill
echo "monitor stopped: ${PIDS}"
