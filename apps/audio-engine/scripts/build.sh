#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Odeon audio engine build script
#  Configures, builds, and places the binary as a Tauri sidecar.
# ─────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ENGINE_DIR/../.." && pwd)"
BUILD_DIR="$ENGINE_DIR/build"
SIDECAR_DIR="$REPO_ROOT/apps/desktop/src-tauri/binaries"

echo "▶ Checking dependencies..."
if ! command -v cmake &>/dev/null; then
    echo "  cmake not found. Installing via Homebrew..."
    brew install cmake
fi

echo "▶ Initialising Tracktion Engine submodule..."
cd "$ENGINE_DIR"
if [ ! -f "vendor/tracktion_engine/CMakeLists.txt" ]; then
    git submodule add https://github.com/Tracktion/tracktion_engine.git vendor/tracktion_engine
fi
git submodule update --init --recursive

echo "▶ Configuring CMake build..."
cmake -S "$ENGINE_DIR" \
      -B "$BUILD_DIR" \
      -DCMAKE_BUILD_TYPE=Release \
      -DTE_ADD_EXAMPLES=OFF

echo "▶ Building odeon_engine..."
cmake --build "$BUILD_DIR" --config Release --parallel

BINARY="$BUILD_DIR/odeon_engine_artefacts/Release/odeon_engine"
if [ ! -f "$BINARY" ]; then
    # Alternate output location
    BINARY=$(find "$BUILD_DIR" -name "odeon_engine" -type f | head -1)
fi

if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
    echo "✗ Build succeeded but binary not found. Check build output."
    exit 1
fi

# Get host target triple for Tauri sidecar naming
TARGET_TRIPLE=$(rustc --print host-tuple 2>/dev/null || echo "aarch64-apple-darwin")

mkdir -p "$SIDECAR_DIR"
DEST="$SIDECAR_DIR/odeon-engine-$TARGET_TRIPLE"
cp "$BINARY" "$DEST"
chmod +x "$DEST"

echo "✓ odeon-engine built and placed at: $DEST"
echo "  Target triple: $TARGET_TRIPLE"
echo ""
echo "  To test the engine standalone:"
echo "    echo '{\"id\":1,\"method\":\"createProject\",\"params\":{\"projectId\":\"test\"}}' | $DEST"
