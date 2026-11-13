"""Monthly class maps as transparent PNGs, for the Compare-dates swipe in the app.

These are the same monthly composites the globe shows as vectors, kept as pixels so the
before/after view can show the full 20 m detail instead of simplified outlines. Colours are the
notebook's CLASS_COLORS; pixels with no data stay fully transparent.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from .config import CLASS_COLORS, FLOODED_VEG, NO_DATA, OPEN_WATER, OTHER

log = logging.getLogger("naba_data")

# Alpha per class: the two wetland classes are the subject, "other land" is faint context.
ALPHA = {NO_DATA: 0, OPEN_WATER: 215, FLOODED_VEG: 215, OTHER: 55}


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def class_rgba(cls: np.ndarray) -> np.ndarray:
    """uint8 class raster -> (h, w, 4) RGBA array."""
    out = np.zeros((*cls.shape, 4), dtype="uint8")
    for value, colour in CLASS_COLORS.items():
        if value == NO_DATA:
            continue
        sel = cls == value
        if not sel.any():
            continue
        r, g, b = _rgb(colour)
        out[sel] = (r, g, b, ALPHA[value])
    return out


def write_class_png(cls: np.ndarray, path: Path) -> int:
    """Write one monthly class map. Returns the file size in bytes."""
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(class_rgba(cls), mode="RGBA").save(path, format="PNG", optimize=True)
    size = path.stat().st_size
    log.info("  frame %s (%d x %d, %.0f kB)", path.name, cls.shape[1], cls.shape[0], size / 1e3)
    return size
