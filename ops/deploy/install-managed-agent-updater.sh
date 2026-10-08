#!/usr/bin/env bash
# Attach a fixed GitHub-artifact updater to an existing unprivileged systemd Agent.
# Run from a reviewed checkout: sudo bash ops/deploy/install-managed-agent-updater.sh ROOT SERVICE NODE
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
root="$(realpath "${1:?installation root required}")"
service="${2:?Agent service required}"
node="$(realpath "${3:?Node.js 24 binary required}")"
[[ "$service" =~ ^jwxt-agent-[A-Za-z0-9_-]+\.service$ ]] || exit 1
[[ "$root" != / && "$root" != *[[:space:]%]* && "$node" != *[[:space:]%]* ]] || exit 1
[ "$("$node" -p 'process.versions.node.split(".")[0]')" = 24 ] || exit 1
runtime_user="$(systemctl show "$service" -p User --value)"
[[ "$runtime_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ && "$runtime_user" != root ]] || exit 1
previous="$(realpath "$(systemctl show "$service" -p WorkingDirectory --value)/..")"
[[ "$previous" == "$root/releases/"* ]] || { echo 'Existing Agent must use a retained release directory' >&2; exit 1; }
request_dir="/var/lib/$runtime_user"
request_file="$request_dir/agent-remote-update.request"
helper="/usr/local/lib/cpu-jwxt-agent/${service%.service}"
config="/etc/cpu-jwxt-agent/${service%.service}-update.json"
unit="${service%.service}-update"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 0755 -o root -g root "$helper" /etc/cpu-jwxt-agent
install -d -m 0700 -o "$runtime_user" -g "$(id -gn "$runtime_user")" "$request_dir"
for file in managed-agent-update.mjs artifact-manifest.mjs install-agent-artifact.mjs; do
  install -m 0644 -o root -g root "$source_dir/$file" "$helper/$file"
done
if [ ! -e "$root/current" ]; then
  [ ! -L "$root/current" ] || { echo 'Broken current symlink' >&2; exit 1; }
  ln -s "$previous" "$root/current"
fi
[[ "$(realpath "$root/current")" == "$previous" ]] || { echo 'Current release differs from the running service' >&2; exit 1; }
"$node" --input-type=module - "$root" "$service" "$node" "$request_file" "$config" <<'JS'
import {writeFileSync} from 'node:fs'
const [root, service, node, requestFile, config] = process.argv.slice(2)
writeFileSync(config, JSON.stringify({root, service, node, requestFile}) + '\n', {mode: 0o600})
JS
dropin="/etc/systemd/system/$service.d/release.conf"
install -d -m 0700 "$helper/backups"
if [ -f "$dropin" ]; then cp -p "$dropin" "$helper/backups/release-$(date +%s%N).conf"; fi
install -d -m 0755 "$(dirname "$dropin")"
cat > "$dropin" <<EOF
[Service]
WorkingDirectory=$root/current/server
ExecStart=
ExecStart=$node $root/current/server/dist/jwxtAgent.js
Environment=JWXT_AGENT_UPDATE_REQUEST_FILE=$request_file
EOF
cat > "/etc/systemd/system/$unit.service" <<EOF
[Unit]
Description=Verified GitHub artifact updater for $service
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=1200
StartLimitBurst=3

[Service]
Type=oneshot
User=root
ExecStart=$node $helper/managed-agent-update.mjs $config
ExecStopPost=/usr/bin/rm -f $request_file
TimeoutStartSec=20min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0022
EOF
cat > "/etc/systemd/system/$unit.path" <<EOF
[Unit]
Description=Remote update request watcher for $service

[Path]
PathExists=$request_file
Unit=$unit.service

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$unit.path"
echo "Updater installed. The running Agent is untouched; start $unit.service once to install the first compatible artifact."
