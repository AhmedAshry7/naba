"""Wetland analysis: dB, pixel classes, per-date indicators and monthly composites.

A port of notebook Section 14 (cells 52-56) with the helpers it leans on from Sections 7 and 8.

Physics, in one paragraph (L-band):
  open water reflects energy away from the radar like a mirror, so it is dark in both HH and HV;
  water plus plant stems form a corner reflector (double bounce), so flooded vegetation is very
  bright in HH and much weaker in HV; dry vegetation scatters from its volume, giving moderate HH
  and relatively strong HV. So a rising HH with a large HH-HV gap suggests flooding under
  vegetation, and darkening in both suggests open water.
"""
from __future__ import annotations

import logging
import math

import numpy as np
import pandas as pd
import xarray as xr

from .config import (FLOODED_VEG, MIN_COVERAGE, NO_DATA, OPEN_WATER, OTHER, WETLAND_THRESHOLDS)
from .search import pol_vars

log = logging.getLogger("naba_data")


def db(a):
    """Linear gamma-0 power to decibels (non-positive values become NaN)."""
    a = np.asarray(a, dtype="float32")
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(a > 0, a, np.nan))


def valid_fraction(da) -> float:
    return float(np.isfinite(np.asarray(da.values if hasattr(da, "values") else da)).mean())


def pixel_area_km2(da) -> float:
    """Approximate area of one grid cell, for quick area sums (areas in the export use pyproj)."""
    res_lon = float(abs(da.lon[1] - da.lon[0]))
    res_lat = float(abs(da.lat[1] - da.lat[0]))
    lat = float(da.lat.mean())
    return res_lon * 111.32 * math.cos(math.radians(lat)) * res_lat * 110.57


def wetland_classes(hh_db, hv_db, th: dict | None = None) -> np.ndarray:
    """Exploratory per-pixel classes: 0 no data, 1 open water, 2 flooded vegetation, 3 other.

    These are threshold rules on backscatter, not a validated flood map: soil moisture, wind on
    the water surface and different look angles all move the same numbers.
    """
    th = th or WETLAND_THRESHOLDS
    hh = np.asarray(hh_db.values if hasattr(hh_db, "values") else hh_db)
    hv = np.asarray(hv_db.values if hasattr(hv_db, "values") else hv_db)
    cls = np.full(hh.shape, OTHER, dtype="uint8")
    cls[(hh < th["water_hh_max"]) & (hv < th["water_hv_max"])] = OPEN_WATER
    cls[(hh > th["flooded_hh_min"]) & ((hh - hv) > th["flooded_ratio_min"])] = FLOODED_VEG
    cls[~(np.isfinite(hh) & np.isfinite(hv))] = NO_DATA
    return cls


def class_percentages(cls: np.ndarray) -> dict:
    """Each class as a percentage of the pixels that have data (the notebook's `valid` mask)."""
    valid = cls > NO_DATA
    n = max(int(valid.sum()), 1)
    return dict(open_water_pct=100 * float((cls == OPEN_WATER).sum()) / n,
                flooded_veg_pct=100 * float((cls == FLOODED_VEG).sum()) / n,
                other_pct=100 * float((cls == OTHER).sum()) / n,
                coverage_pct=100 * float(valid.mean()))


def load_series(acquisitions: pd.DataFrame, bbox, res_deg: float, frequency: str = "A",
                offline: bool = False) -> tuple[dict, dict, list[dict]]:
    """Stream HH and HV for each acquisition (notebook cell 52).

    Returns ({label: HH dB}, {label: HV dB}, skipped) where a label is the acquisition date
    (plus the frame number when two frames land on the same day). A date is kept only when both
    polarizations load and the AOI is at least `MIN_COVERAGE` covered.
    """
    from .remote import read_aoi

    hh_by, hv_by, skipped = {}, {}, []
    for _, row in acquisitions.iterrows():
        co, cx = pol_vars(row)
        label = str(pd.Timestamp(row["date"]).date())
        if label in hh_by:                 # two frames on the same day: keep both, distinct labels
            label = f"{label}_f{row.get('frame')}"
        if cx is None:
            skipped.append(dict(date=label,
                                reason=f"single-pol ({row.get('pol_code')}): no cross-pol layer"))
            continue
        try:
            hh = xr.apply_ufunc(db, read_aoi(row, co, bbox, res_deg, frequency, offline=offline))
            hv = xr.apply_ufunc(db, read_aoi(row, cx, bbox, res_deg, frequency, offline=offline))
        except Exception as e:             # one unreadable granule must not lose the whole series
            reason = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            skipped.append(dict(date=label, reason=reason))
            log.warning("skipped %s: %s", label, reason)
            continue
        if min(valid_fraction(hh), valid_fraction(hv)) < MIN_COVERAGE:
            skipped.append(dict(date=label,
                                reason=f"AOI <{MIN_COVERAGE:.0%} covered by this frame"))
            continue
        hh_by[label], hv_by[label] = hh, hv
    log.info("Loaded %d dates with both polarizations (%d skipped)", len(hh_by), len(skipped))
    return hh_by, hv_by, skipped


def date_indicators(hh_by: dict, hv_by: dict, th: dict | None = None) -> pd.DataFrame:
    """The notebook's `wet_ts` table: one row per acquisition date."""
    rows = []
    for label in hh_by:
        cls = wetland_classes(hh_by[label], hv_by[label], th)
        pct = class_percentages(cls)
        rows.append(dict(label=label, date=pd.Timestamp(label[:10]),
                         HH_median=float(np.nanmedian(hh_by[label])),
                         HV_median=float(np.nanmedian(hv_by[label])), **pct))
    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True)


def monthly_composites(hh_by: dict, hv_by: dict, th: dict | None = None) -> dict:
    """Per-pixel median of each month's acquisitions, then classified (notebook cell 56).

    The median also reduces speckle. Returns {"2026-06": {hh, hv, classes, dates}} in month order.
    """
    months: dict[str, list[str]] = {}
    for label in hh_by:
        months.setdefault(label[:7], []).append(label)
    out = {}
    for month in sorted(months):
        labels = sorted(months[month])
        hh = xr.concat([hh_by[l] for l in labels], "t").median("t")
        hv = xr.concat([hv_by[l] for l in labels], "t").median("t")
        out[month] = dict(hh=hh, hv=hv, classes=wetland_classes(hh, hv, th),
                          dates=sorted({l[:10] for l in labels}))
    log.info("Monthly composites: %s", {m: len(v["dates"]) for m, v in out.items()})
    return out
