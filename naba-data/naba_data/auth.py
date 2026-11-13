"""Earthdata Login.

Credentials come from `naba-data/.env` (gitignored) or the environment:

    EARTHDATA_USERNAME=...
    EARTHDATA_PASSWORD=...

Nothing credential-shaped is ever written into the repo or into the exported dataset.
Searching the catalog needs no login; only streaming pixels does.
"""
from __future__ import annotations

import getpass
import logging
import os
from pathlib import Path

from .config import DATA_DIR

log = logging.getLogger("naba_data")
_STATE: dict[str, object] = {}


def load_dotenv(path: Path | None = None) -> None:
    """Read KEY=VALUE lines from naba-data/.env into os.environ (without overriding it)."""
    path = path or DATA_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def credentials(interactive: bool = True) -> tuple[str, str]:
    load_dotenv()
    user = os.environ.get("EARTHDATA_USERNAME")
    pw = os.environ.get("EARTHDATA_PASSWORD")
    if not (user and pw):
        if not interactive:
            raise SystemExit(
                "Earthdata credentials not found. Copy naba-data/.env.example to naba-data/.env "
                "and fill in EARTHDATA_USERNAME / EARTHDATA_PASSWORD "
                "(free account: https://urs.earthdata.nasa.gov)."
            )
        user = user or input("Earthdata username: ")
        pw = pw or getpass.getpass("Earthdata password: ")
    os.environ["EARTHDATA_USERNAME"], os.environ["EARTHDATA_PASSWORD"] = user, pw
    return user, pw


def login(interactive: bool = True):
    """Log in and build the two authenticated HTTPS sessions the reader uses.

    Returns (auth, fsspec_filesystem, requests_session) and caches them for the process.
    """
    if "auth" in _STATE:
        return _STATE["auth"], _STATE["fs"], _STATE["req"]
    import earthaccess

    credentials(interactive=interactive)
    auth = earthaccess.login(strategy="environment")
    if not (auth and auth.authenticated):
        raise SystemExit("Earthdata login failed. Check EARTHDATA_USERNAME / EARTHDATA_PASSWORD.")
    _STATE["auth"] = auth
    _STATE["fs"] = earthaccess.get_fsspec_https_session()   # streaming (HTTP range requests)
    _STATE["req"] = earthaccess.get_requests_https_session()  # small files and size checks
    log.info("Earthdata login OK (user %s)", os.environ.get("EARTHDATA_USERNAME"))
    return _STATE["auth"], _STATE["fs"], _STATE["req"]


def https_fs():
    """The fsspec filesystem for range reads; logs in on first use."""
    if "fs" not in _STATE:
        login()
    return _STATE["fs"]
