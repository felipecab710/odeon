#!/usr/bin/env bash
# Ad-hoc codesign release .app (unsigned — users still clear quarantine on first download).
set -euo pipefail

APP_PATH="${1:?Usage: sign-macos-app.sh /path/to/Odeon.app}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

echo "▶ Ad-hoc signing Mach-O binaries in $(basename "$APP_PATH")..."

while IFS= read -r -d '' f; do
  if file "$f" | grep -q "Mach-O"; then
    codesign --force --sign - "$f" 2>/dev/null || true
  fi
done < <(find "$APP_PATH" -type f -print0)

codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep "$APP_PATH"
echo "✓ Codesign OK"
