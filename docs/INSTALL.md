# Installing Odeon

Odeon ships as a **macOS desktop app** (.dmg). The release bundle includes:

- **Odeon.app** — UI + native audio engine
- **Bundled analysis API** — starts automatically (no Terminal required)
- User data in `~/Library/Application Support/com.odeon.desktop/`

---

## Download (release build)

1. Download **Odeon_*_aarch64.dmg** from [GitHub Releases](https://github.com/felipecab710/odeon/releases) (Apple Silicon).
2. Open the DMG and drag **Odeon** to **Applications**.
3. Eject the disk image.
4. **Clear macOS quarantine** (required for unsigned builds):

   ```bash
   xattr -cr /Applications/Odeon.app
   ```

5. Launch Odeon from Applications. Wait for *"Starting Odeon services…"* (first launch may take ~30s).

> **"Odeon is damaged and can't be opened"** — This is Gatekeeper blocking an unsigned download, not a corrupt file. Run the `xattr` command above, then open again. Do **not** eject and give up; the app is fine.

Alternative if macOS still blocks launch:
- Right-click Odeon → **Open** → confirm, or
- **System Settings → Privacy & Security → Open Anyway**

---

## System requirements

| Requirement | Notes |
|-------------|-------|
| macOS 13+ | Apple Silicon (M1/M2/M3) recommended |
| 8 GB RAM | 16 GB for large sets + analysis |
| 2 GB disk | App + API bundle + your projects |
| **ffmpeg** | Required for MP3/AAC import — `brew install ffmpeg` |

### Optional

| Tool | Purpose |
|------|---------|
| `demucs` | Reference stem separation — `pip install demucs` (not bundled; large download) |

---

## Building from source

For developers or contributors:

```bash
git clone https://github.com/felipecab710/odeon.git
cd odeon
pnpm install

# One-time: native audio engine
./apps/audio-engine/scripts/build.sh

# Dev mode (API + desktop in separate terminals)
pnpm dev:all

# Release .dmg (engine + bundled API + Tauri)
./scripts/release/build-macos.sh
```

Output: `apps/desktop/src-tauri/target/release/bundle/dmg/Odeon_0.1.0_aarch64.dmg`

---

## Troubleshooting

### "Odeon is damaged and can't be opened"

macOS quarantine on unsigned downloads. After copying to Applications:

```bash
xattr -cr /Applications/Odeon.app
```

Then launch normally. You only need to do this once per install.

### Stuck on "Starting Odeon services…"

- Wait up to 2 minutes on first launch.
- Check Console.app for `[api]` / `[engine]` logs from Odeon.
- From source: ensure API is running — `pnpm api` in another terminal.
- Port 8000 in use: quit other apps using `:8000`.

### No audio playback

- Rebuild engine: `./apps/audio-engine/scripts/build.sh`
- Toggle **Playback Engine** in Settings and restart the app.

### Stem separation unavailable

- Demucs is optional in v0.1. Install separately:
  ```bash
  pip install demucs
  ```
- Or use pre-separated stems via **Import My Stems**.

### Native GPU timeline blank

- After updating Rust/timeline code: toggle **Native** off → on in Set Builder.
- Rebuild: `pnpm tauri build` after `cargo` changes.

---

## Data locations

| Data | Path |
|------|------|
| Release app data | `~/Library/Application Support/com.odeon.desktop/` |
| Dev mode | `<repo>/audio/` |
| Projects DB | `<data>/odeon.db` |
| Uploads / stems | `<data>/uploads/`, `<data>/stems/` |

---

## License notes

- Odeon app code: see [LICENSE](../LICENSE).
- Tracktion Engine: GPLv3 / commercial — see [apps/audio-engine/README.md](../apps/audio-engine/README.md).
- JUCE: separate license required for commercial distribution beyond GPLv3 scope.
