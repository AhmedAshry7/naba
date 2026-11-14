"""Fire analysis: before/after cross-pol (HV) change, burn tiers and per-pass burned area.

A port of notebook Section 12 (cells 37-41) with the helpers it leans on from Sections 7 and 8
(`pick_pre_post`, `boxcar`, `dualpol_rgb`).

Physics, in one paragraph (L-band):
  HV comes mostly from volume scattering in the canopy - leaves, twigs and branches. When fire
  removes that canopy, HV usually drops by several dB. HH changes less and can even rise where
  trunks are left standing or soils are wet. NISAR sees through smoke and cloud, so every 12-day
  pass over the fire is usable.

Method: compare every pass of one viewing geometry with the last pass before the fire, on
speckle-smoothed linear power; pixels whose HV fell by more than 3 dB are "likely burned", by
2-3 dB "possibly burned". These are exploratory thresholds, not a validated burn-severity map.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .config import (BURN_LIKELY, BURN_NO_DATA, BURN_POSSIBLE, BURN_THRESHOLDS, DB_RANGES,
                     FIRE_SMOOTH_PX, MATURITY, MIN_COVERAGE, UNBURNED, Preset)
from .search import best_per_date, dual_pol_only, pol_vars, search_nisar
from .wetlands import db, pixel_area_km2, valid_fraction

log = logging.getLogger("naba_data")

GEOMETRY_KEYS = ("track", "direction", "frame")


# ---------------------------------------------------------------- acquisition choice
def _geometry_keys(df: pd.DataFrame) -> list[str]:
    return [k for k in GEOMETRY_KEYS if k in df and df[k].notna().any()]


def pick_pre_post(df: pd.DataFrame, event_start: str, event_end: str, same_geometry: bool = True):
    """Latest acquisition before the event and earliest after it (notebook `pick_pre_post`).

    Prefers a pair from the identical track/direction/frame, choosing the geometry with the
    shortest before-after gap. Falls back to the nearest dates in any geometry only when no single
    geometry has both sides (and says so: different look angles make the difference unreliable).
    Returns (None, None) when one side of the event has no acquisition at all.
    """
    es, ee = pd.Timestamp(event_start), pd.Timestamp(event_end)
    df = df.sort_values("date")
    pre, post = df[df["date"] < es], df[df["date"] > ee]
    if pre.empty or post.empty:
        log.warning("Need acquisitions on both sides of the event: %d before, %d after.",
                    len(pre), len(post))
        return None, None
    best = None
    keys = _geometry_keys(df) if same_geometry else []
    if keys:
        for key, g in pre.groupby(keys):
            key = key if isinstance(key, tuple) else (key,)
            p2 = post
            for k, v in zip(keys, key):
                p2 = p2[p2[k] == v]
            if p2.empty:
                continue
            a, b = g.iloc[-1], p2.iloc[0]
            gap = (b["date"] - a["date"]).days
            if best is None or gap < best[0]:
                best = (gap, a, b)
    if best is None:
        log.warning("No single geometry has both a before and an after acquisition; using the "
                    "nearest dates (different look angles - interpret differences with care).")
        a, b = pre.iloc[-1], post.iloc[0]
    else:
        _, a, b = best
    log.info("BEFORE: %s  track %s %s frame %s", a["date"].date(), a.get("track"),
             a.get("direction"), a.get("frame"))
    log.info("AFTER : %s  track %s %s frame %s  (gap %d days)", b["date"].date(), b.get("track"),
             b.get("direction"), b.get("frame"), (b["date"] - a["date"]).days)
    return a, b


def same_geometry_as(df: pd.DataFrame, row) -> pd.DataFrame:
    """The acquisitions of `df` that share `row`'s track/direction/frame."""
    out = df
    for k in _geometry_keys(df):
        out = out[out[k] == row[k]]
    return out


def event_role(date, preset: Preset) -> str:
    """'before', 'during' or 'after' the preset's event window."""
    d = pd.Timestamp(date).normalize()
    if preset.event_start and d < pd.Timestamp(preset.event_start):
        return "before"
    if preset.event_end and d > pd.Timestamp(preset.event_end):
        return "after"
    return "during"


def select_fire_acquisitions(preset: Preset, maturity: str = MATURITY):
    """Search -> dual-pol -> before/after pair -> every pass of that geometry from `before` on.

    Returns (acquisitions, pre_row, post_row); acquisitions is empty when no pair exists.
    """
    if not (preset.event_start and preset.event_end):
        raise SystemExit(f"Preset {preset.key!r} has no event_start/event_end.")
    df = search_nisar(preset.product, preset.bbox, preset.search_start, preset.search_end,
                      maturity)
    if df.empty:
        return df, None, None
    df = dual_pol_only(df)
    if preset.geometry:
        track, direction, frame = preset.geometry
        pinned = df[(df["track"] == track) & (df["direction"] == direction) & (df["frame"] == frame)]
        log.info("Geometry pinned by the preset: track %s %s frame %s -> %d of %d granules",
                 track, direction, frame, len(pinned), len(df))
        df = pinned
    pre, post = pick_pre_post(df, preset.event_start, preset.event_end)
    if pre is None:
        return df.iloc[0:0], None, None
    acq = same_geometry_as(df, pre)
    acq = acq[acq["date"] >= pre["date"]].sort_values("date")
    # one granule per date: a partial-frame or older duplicate would otherwise count twice
    acq = best_per_date(acq)
    pre = acq[acq["date"] == pre["date"]].iloc[0]
    post = acq[acq["date"] == post["date"]].iloc[0]
    log.info("Fire series: %d passes of track %s %s frame %s, %s -> %s", len(acq),
             pre.get("track"), pre.get("direction"), pre.get("frame"),
             acq["date"].iloc[0].date(), acq["date"].iloc[-1].date())
    return acq, pre, post


def date_label(row) -> str:
    return str(pd.Timestamp(row["date"]).date())


# ---------------------------------------------------------------- reading
def load_linear_series(acquisitions: pd.DataFrame, bbox, res_deg: float, frequency: str = "A",
                       offline: bool = False) -> tuple[dict, dict, list[dict]]:
    """Stream co-pol and cross-pol linear power for each acquisition (notebook cell 38).

    Returns ({date: co-pol}, {date: cross-pol}, skipped). Unlike the wetland loader this keeps
    linear power, because the fire method smooths speckle on power before converting to dB.
    """
    from .remote import read_aoi

    co_by, cx_by, skipped = {}, {}, []
    for _, row in acquisitions.iterrows():
        label = date_label(row)
        co, cx = pol_vars(row)
        if cx is None:
            skipped.append(dict(date=label,
                                reason=f"single-pol ({row.get('pol_code')}): no cross-pol layer"))
            continue
        try:
            co_da = read_aoi(row, co, bbox, res_deg, frequency, offline=offline)
            cx_da = read_aoi(row, cx, bbox, res_deg, frequency, offline=offline)
        except Exception as e:             # one unreadable granule must not lose the whole series
            reason = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            skipped.append(dict(date=label, reason=reason))
            log.warning("skipped %s: %s", label, reason)
            continue
        if min(valid_fraction(co_da), valid_fraction(cx_da)) < MIN_COVERAGE:
            skipped.append(dict(date=label,
                                reason=f"AOI <{MIN_COVERAGE:.0%} covered by this frame"))
            continue
        co_by[label], cx_by[label] = co_da, cx_da
    log.info("Loaded %d dates with both polarizations (%d skipped)", len(co_by), len(skipped))
    return co_by, cx_by, skipped


# ---------------------------------------------------------------- analysis
def boxcar(da, size: int = FIRE_SMOOTH_PX):
    """NaN-aware moving average on linear power (notebook `boxcar`): less speckle, coarser detail."""
    from scipy.ndimage import uniform_filter

    if not size or size <= 1:
        return da
    a = np.asarray(da.values if hasattr(da, "values") else da, dtype="float64")
    valid = np.isfinite(a)
    num = uniform_filter(np.where(valid, a, 0), size=size, mode="nearest")
    den = uniform_filter(valid.astype("float64"), size=size, mode="nearest")
    out = np.where(valid & (den > 0), num / np.maximum(den, 1e-12), np.nan).astype("float32")
    return da.copy(data=out) if hasattr(da, "copy") and hasattr(da, "dims") else out


def delta_db(before, after, smooth_px: int = FIRE_SMOOTH_PX):
    """after - before in dB, each smoothed on linear power first (notebook cell 38)."""
    b = np.asarray(db(boxcar(before, smooth_px)))
    a = np.asarray(db(boxcar(after, smooth_px)))
    return a - b


def burn_classes(d_hv, th: dict | None = None) -> np.ndarray:
    """Per-pixel burn tiers from the HV change in dB.

    0 no data, 1 unburned, 2 possibly burned (HV fell by 2-3 dB), 3 likely burned (HV fell by
    more than 3 dB). Exploratory thresholds, not a burn-severity map.
    """
    th = th or BURN_THRESHOLDS
    d = np.asarray(d_hv, dtype="float32")
    cls = np.full(d.shape, UNBURNED, dtype="uint8")
    cls[d < th["possible_db"]] = BURN_POSSIBLE
    cls[d < th["likely_db"]] = BURN_LIKELY
    cls[~np.isfinite(d)] = BURN_NO_DATA
    return cls


def burn_indicators(co_by: dict, cx_by: dict, pre_label: str, preset: Preset,
                    smooth_px: int = FIRE_SMOOTH_PX,
                    th: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """One row per pass: burned km2 in each tier against the before pass (the chart's series).

    Areas here are pixel counts times the cell area, as in the notebook, so the headline numbers
    can be reproduced in Colab; the outline on the map is vectorized and measured geodesically.
    Returns (table, {date: burn class raster}).
    """
    if pre_label not in cx_by:
        raise SystemExit(f"The before pass ({pre_label}) did not load; nothing to compare with.")
    cell = pixel_area_km2(cx_by[pre_label])
    rows, classes = [], {}
    for label in sorted(cx_by):
        d_hv = delta_db(cx_by[pre_label], cx_by[label], smooth_px)
        d_co = delta_db(co_by[pre_label], co_by[label], smooth_px)
        cls = burn_classes(d_hv, th)
        classes[label] = cls
        valid = cls > BURN_NO_DATA
        likely, possible = int((cls == BURN_LIKELY).sum()), int((cls == BURN_POSSIBLE).sum())
        n = max(int(valid.sum()), 1)
        rows.append(dict(
            label=label, date=pd.Timestamp(label), role=event_role(label, preset),
            likely_km2=likely * cell, possible_km2=possible * cell,
            burned_km2=(likely + possible) * cell,
            likely_pct=100 * likely / n,
            coverage_pct=100 * float(valid.mean()),
            HV_median=float(np.nanmedian(db(cx_by[label]))),
            dHV_median=float(np.nanmedian(d_hv)) if valid.any() else float("nan"),
            dCO_median=float(np.nanmedian(d_co)) if np.isfinite(d_co).any() else float("nan"),
        ))
    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True), classes


# ---------------------------------------------------------------- display
def _stretch(a, lo, hi):
    return np.clip((np.asarray(a, dtype="float32") - lo) / (hi - lo), 0, 1)


def dualpol_rgb(co, cx, ranges: dict | None = None) -> tuple[np.ndarray, np.ndarray]:
    """False colour from linear power (notebook `dualpol_rgb`): R = HH, G = HV, B = HH - HV.

    Forest canopy is green (strong HV); burned or bare ground loses the green. Returns
    (rgb in 0..1 with shape (h, w, 3), valid mask).
    """
    r = ranges or DB_RANGES
    co_db, cx_db = np.asarray(db(co)), np.asarray(db(cx))
    rgb = np.dstack([_stretch(co_db, *r["HH"]), _stretch(cx_db, *r["HV"]),
                     _stretch(co_db - cx_db, *r["RATIO"])])
    valid = np.isfinite(co_db) & np.isfinite(cx_db)
    rgb[~valid] = 0
    return rgb, valid
