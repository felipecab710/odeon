#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Build Odeon macOS release (.app + .dmg)
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SKIP_API="${SKIP_API_BUNDLE:-0}"

echo "═══════════════════════════════════════════"
echo "  Odeon macOS Release Build"
echo "═══════════════════════════════════════════"

cd "$REPO_ROOT"

echo ""
echo "▶ [1/4] Install JS dependencies..."
corepack enable 2>/dev/null || true
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo ""
echo "▶ [2/4] Build native audio engine sidecar..."
bash "$REPO_ROOT/apps/audio-engine/scripts/build.sh"

if [[ "$SKIP_API" == "1" ]]; then
  echo ""
  echo "⚠ Skipping API bundle (SKIP_API_BUNDLE=1). Release will need external API on :8000."
else
  echo ""
  echo "▶ [3/4] Prepare bundled analysis API..."
  bash "$SCRIPT_DIR/prepare-api-bundle.sh"
fi

echo ""
echo "▶ [4/5] Tauri release build (.app)..."
cd "$REPO_ROOT/apps/desktop"
pnpm exec tsc --noEmit
pnpm tauri build --config src-tauri/tauri.release.conf.json

APP_PATH="$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Odeon.app"
DMG_DIR="$REPO_ROOT/apps/desktop/src-tauri/target/release/bundle/dmg"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
DMG_PATH="$DMG_DIR/Odeon_${VERSION}_aarch64.dmg"

echo ""
echo "▶ [5/5] Create DMG (hdiutil — Tauri bundle_dmg fails on macOS 26+)..."
mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"
hdiutil create -volname "Odeon" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Release artifacts:"
echo "  App: $APP_PATH"
echo "  DMG: $DMG_PATH ($(du -sh "$DMG_PATH" | cut -f1))"
echo "═══════════════════════════════════════════"
