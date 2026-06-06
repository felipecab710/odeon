# Odeon ML Server

GPU inference server for Odeon. Runs on your RunPod A100 pod; your Mac API calls it over HTTP.

## Quick start on RunPod

```bash
# 1. Start your pod (A100, pytorch 2.4 + CUDA 12.4 image)
# 2. SSH or open Web Terminal

cd /workspace
git clone https://github.com/felipecab710/odeon.git
cd odeon/runpod-server

pip install -r requirements.txt

# Set HuggingFace cache to persistent volume
export HF_HOME=/workspace/hf_cache
export TRANSFORMERS_CACHE=/workspace/hf_cache

# Start server (expose port 8001 in RunPod pod settings)
uvicorn server:app --host 0.0.0.0 --port 8001
```

## Expose to your Mac

In RunPod pod settings → **TCP Port Mappings** → add port **8001**.

Copy the proxy URL, e.g.:
```
https://<pod-id>-8001.proxy.runpod.net
```

On your Mac, in `apps/api/.env`:
```
RUNPOD_URL=https://<pod-id>-8001.proxy.runpod.net
```

## Smoke test

```bash
# From Mac or pod
curl https://<pod-id>-8001.proxy.runpod.net/status

# Embed a track (upload from Mac via Odeon API, or directly):
curl -X POST "http://localhost:8001/embed?models=clap" \
  -F "file=@/path/to/track.mp3"
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | GPU info, loaded models |
| POST | `/embed` | Upload audio → CLAP/MuQ/MERT vectors |
| POST | `/embed/text` | Text → CLAP vector (semantic search) |
| POST | `/embed/path` | Pod-local file path → vectors |
| POST | `/separate` | BS-RoFormer 4-stem (Phase 3) |
| POST | `/analyze` | Music Flamingo analysis (Phase 4) |
| POST | `/reason` | MOSS transition plan (Phase 5) |
| POST | `/generate/bridge` | ACE-Step bridge (Phase 6) |
| POST | `/generate/riser` | Stable Audio riser (Phase 6) |

## Model install order

1. **CLAP** — `pip install laion-clap` (included in requirements.txt)
2. **MuQ** — auto-downloads from `OpenMuQ/MuQ-large-msd-iter` on first `/embed?models=muq`
3. **MERT** — auto-downloads from `m-a-p/MERT-v1-330M` on first `/embed?models=mert`
4. **Music Flamingo** — Phase 4
5. **MOSS-Audio-8B** — Phase 5
6. **ACE-Step + Stable Audio** — Phase 6

First CLAP embed will download ~400MB of weights to `/workspace/hf_cache`.

## Costs

A100 pod at ~$1.49/hr. Stop the pod when not embedding/analyzing.
Volume storage: ~$0.03/hr for 100GB.
