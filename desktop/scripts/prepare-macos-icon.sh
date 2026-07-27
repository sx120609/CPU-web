#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

source_png="build/icon.png"
iconset="build/icon.iconset"
output="build/icon.icns"

if [[ ! -f "$source_png" ]]; then
  echo "找不到 macOS 图标源文件：$source_png" >&2
  exit 1
fi

rm -rf "$iconset"
mkdir -p "$iconset"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$source_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$source_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$iconset" -o "$output"
rm -rf "$iconset"
echo "已生成 $output"
