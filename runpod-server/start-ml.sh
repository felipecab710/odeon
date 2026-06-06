#!/usr/bin/env bash
# Start Odeon ML server on RunPod (port 8002).
# Run after pod reset: bash /workspace/odeon/runpod-server/start-ml.sh

set -euo pipefail

cd "$(dirname "$0")"

export HF_HOME="${HF_HOME:-/workspace/hf_cache}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$HF_HOME}"

echo "Installing deps..."
pip install -q -r requirements.txt

echo "HF cache: $HF_HOME"
echo "Starting uvicorn on 0.0.0.0:8002 ..."
exec python -m uvicorn server:app --host 0.0.0.0 --port 8002
