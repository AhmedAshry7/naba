"""Frames for the Compare-dates swipe in the app.

Wetlands: monthly class maps as transparent PNGs. Fires: a dual-pol false-colour image and a
burn-tier mask for every pass.

The wetland frames are the same monthly composites the globe shows as vectors, kept as pixels so the
before/after view can show the full 20 m detail instead of simplified outlines. Colours are the
notebook's CLASS_COLORS; pixels with no data stay fully transparent.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from .config import (BURN_COLORS, BURN_LIKELY, BURN_POSSIBLE, CLASS_COLORS, FLOODED_VEG, NO_DATA,
                     OPEN_WATER, OTHER)

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


# ---------------------------------------------------------------- fire frames
BURN_ALPHA = {BURN_LIKELY: 225, BURN_POSSIBLE: 190}
RGB_QUALITY = 82          # WebP quality for the false-colour frames (speckle compresses badly as PNG)


def write_burn_png(cls: np.ndarray, path: Path) -> int:
    """Burn tiers as a transparent PNG: only likely/possible pixels are drawn."""
    from PIL import Image

    out = np.zeros((*cls.shape, 4), dtype="uint8")
    for value, colour in BURN_COLORS.items():
        sel = cls == value
        if sel.any():
            out[sel] = (*_rgb(colour), BURN_ALPHA[value])
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, mode="RGBA").save(path, format="PNG", optimize=True)
    size = path.stat().st_size
    log.info("  frame %s (%d x %d, %.0f kB)", path.name, cls.shape[1], cls.shape[0], size / 1e3)
    return size


def write_rgb_image(rgb: np.ndarray, valid: np.ndarray, path: Path) -> int:
    """False-colour frame (rgb in 0..1) as WebP with alpha; pixels without data are transparent."""
    from PIL import Image

    out = np.zeros((*valid.shape, 4), dtype="uint8")
    out[..., :3] = np.round(np.clip(rgb, 0, 1) * 255).astype("uint8")
    out[..., 3] = np.where(valid, 255, 0).astype("uint8")
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, mode="RGBA").save(path, format="WEBP", quality=RGB_QUALITY, method=6)
    size = path.stat().st_size
    log.info("  frame %s (%d x %d, %.0f kB)", path.name, valid.shape[1], valid.shape[0], size / 1e3)
    return size
