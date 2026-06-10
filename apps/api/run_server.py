#!/usr/bin/env python3
"""Entry point for bundled Odeon analysis API (Tauri sidecar / release)."""
from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("ODEON_API_HOST", "127.0.0.1")
    port = int(os.environ.get("ODEON_API_PORT", "8000"))
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        log_level=os.environ.get("ODEON_API_LOG", "info"),
        access_log=False,
    )


if __name__ == "__main__":
    main()
