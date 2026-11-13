"""Operation ledger: what each step moved and how long it took.

A port of the notebook's `log_op` / `timer` / `show_ledger` (Section 1). The point is the same:
nothing in this package moves bytes without saying how many.
"""
from __future__ import annotations

import datetime as dt
import logging
import time
from contextlib import contextmanager

OP_TYPES = {
    "METADATA": "1-METADATA", "PREVIEW": "2-PREVIEW", "REMOTE": "3-REMOTE",
    "PARTIAL": "4-PARTIAL", "DOWNLOAD": "5-DOWNLOAD", "LOCAL": "cache/local", "INFO": "info",
}

LEDGER: list[dict] = []
log = logging.getLogger("naba_data")


def log_op(kind: str, target: str, nbytes: int = 0, seconds: float = 0.0, note: str = "") -> dict:
    rec = dict(time=dt.datetime.now().strftime("%H:%M:%S"), type=OP_TYPES.get(kind, kind),
               target=str(target)[-95:], MB=round((nbytes or 0) / 1e6, 3),
               seconds=round(seconds, 2), note=note)
    LEDGER.append(rec)
    log.info("[%s] %.3f MB · %.1f s · %s  %s", rec["type"], rec["MB"], rec["seconds"],
             rec["target"], note)
    return rec


@contextmanager
def timer():
    t = {"start": time.time()}
    yield t
    t["seconds"] = time.time() - t["start"]


def totals() -> dict:
    """Megabytes and seconds per operation type, for provenance.json."""
    out: dict[str, dict[str, float]] = {}
    for rec in LEDGER:
        acc = out.setdefault(rec["type"], {"MB": 0.0, "seconds": 0.0, "operations": 0})
        acc["MB"] = round(acc["MB"] + rec["MB"], 3)
        acc["seconds"] = round(acc["seconds"] + rec["seconds"], 2)
        acc["operations"] += 1
    return out


def network_mb() -> float:
    """Total megabytes fetched over the network (everything except cache/local reads)."""
    return round(sum(r["MB"] for r in LEDGER if r["type"] not in ("cache/local", "info")), 3)
