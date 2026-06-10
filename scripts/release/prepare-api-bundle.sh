#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Prepare bundled Python API for Tauri release
#  Output: apps/desktop/src-tauri/resources/api-bundle/
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
BUNDLE_DIR="$REPO_ROOT/apps/desktop/src-tauri/resources/api-bundle"

echo "▶ Preparing API bundle at $BUNDLE_DIR"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "▶ Copying API source..."
cp -R "$API_DIR/app" "$BUNDLE_DIR/app"
cp "$API_DIR/run_server.py" "$BUNDLE_DIR/run_server.py"

echo "▶ Creating Python venv (release deps, no Demucs)..."
python3 -m venv "$BUNDLE_DIR/venv"
# shellcheck disable=SC1091
source "$BUNDLE_DIR/venv/bin/activate"
python -m pip install --upgrade pip wheel
pip install -r "$API_DIR/requirements-release.txt"

echo "▶ Verifying import..."
cd "$BUNDLE_DIR"
python -c "from app.main import app; print('API import OK:', app.title)"
cd "$REPO_ROOT"

deactivate

echo "✓ API bundle ready ($(du -sh "$BUNDLE_DIR" | cut -f1))"
echo "  Bundled into .app via tauri.release.conf.json resources"
