"""Catalog search and granule selection  (notebook Sections 3 and 8, and cell 50).

Only JSON metadata moves here: kilobytes, no pixels. Searching CMR needs no Earthdata login.
"""
from __future__ import annotations

import logging
import re

import numpy as np
import pandas as pd

from .config import MATURITY, MAX_RESULTS, Preset
from .ledger import log_op, timer

log = logging.getLogger("naba_data")

L1_PRODUCTS = {"RSLC", "RIFG", "RUNW", "ROFF", "RRSD"}
L3_PRODUCTS = {"SME2"}
POL_CODES = {"DH": "HH+HV", "DV": "VV+VH", "QP": "HH+HV+VH+VV", "QD": "HH+HV+VH+VV",
             "SH": "HH", "SV": "VV", "CL": "compact (L)", "CR": "compact (R)", "NA": "none"}
_TS = re.compile(r"(\d{8}T\d{6})")


def nisar_short_name(product: str, maturity: str = MATURITY) -> str:
    level = "L1" if product in L1_PRODUCTS else ("L3" if product in L3_PRODUCTS else "L2")
    if product == "RRSD":
        level = "L0B"
    return f"NISAR_{level}_{product}_{maturity}_V1"


def parse_nisar_name(name: str) -> dict:
    """Best-effort parse of the NISAR file-name convention (track/frame/direction/mode/pol/dates)."""
    tok = name.split("_")
    info: dict = dict(level=tok[1] if len(tok) > 1 else None,
                      processing=tok[2] if len(tok) > 2 else None,
                      product=tok[3] if len(tok) > 3 else None)
    for i in range(4, len(tok) - 1):
        if tok[i] in ("A", "D") and tok[i - 1].isdigit() and tok[i + 1].isdigit():
            info["track"] = int(tok[i - 1])
            info["direction"] = "ASC" if tok[i] == "A" else "DSC"
            info["frame"] = int(tok[i + 1])
            if i + 3 < len(tok):
                info["mode"] = tok[i + 2]
                pole = tok[i + 3]
                info["pol_code"] = pole
                if len(pole) == 4:
                    info["pols_freqA"] = POL_CODES.get(pole[:2], pole[:2])
                    info["pols_freqB"] = POL_CODES.get(pole[2:], pole[2:])
            break
    times = _TS.findall(name)
    dates = sorted({t[:8] for t in times})
    info["first_date"] = pd.to_datetime(dates[0]) if dates else pd.NaT
    info["start_time"] = pd.to_datetime(times[0]) if times else pd.NaT
    crid = [i for i, t in enumerate(tok) if re.fullmatch(r"[A-Z]\d{5}", t)]
    info["crid"] = tok[crid[0]] if crid else None
    # after the CRID: ..._<processing>_<frame coverage F|P>_<...>_<product counter>, e.g. _N_F_J_001
    tail = tok[crid[0] + 1:] if crid else []
    info["frame_coverage"] = tail[1] if len(tail) > 1 and tail[1] in ("F", "P") else None
    info["product_version"] = int(tail[3]) if len(tail) > 3 and tail[3].isdigit() else None
    return info


def _naive_utc(t):
    return pd.to_datetime(t, utc=True).tz_convert(None) if t else pd.NaT


def granules_to_df(granules) -> pd.DataFrame:
    rows = []
    for g in granules:
        umm = g["umm"]
        name = umm.get("GranuleUR", "?")
        try:
            links = g.data_links(access="external")
        except Exception:
            links = []
        h5 = [l for l in links if l.lower().endswith((".h5", ".hdf5"))]
        try:
            size_mb = round(float(g.size()), 1)
        except Exception:
            size_mb = None
        rng = umm.get("TemporalExtent", {}).get("RangeDateTime", {})
        row = dict(name=name, begin=_naive_utc(rng.get("BeginningDateTime")),
                   end=_naive_utc(rng.get("EndingDateTime")), size_MB_catalog=size_mb,
                   h5_url=h5[0] if h5 else (links[0] if links else None))
        row.update(parse_nisar_name(name))
        rows.append(row)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["begin"] = pd.to_datetime(df["begin"])
        df["date"] = df["begin"].fillna(df["start_time"]).dt.normalize()
        df = df.sort_values("begin").reset_index(drop=True)
    return df


def search_nisar(product: str, bbox, start: str, end: str, maturity: str = MATURITY,
                 max_results: int = MAX_RESULTS) -> pd.DataFrame:
    """Search CMR for NISAR granules. Metadata only - no data files are touched."""
    import earthaccess

    short_name = nisar_short_name(product, maturity)
    with timer() as t:
        res = earthaccess.search_data(short_name=short_name, count=max_results,
                                      bounding_box=tuple(bbox), temporal=(start, end))
    df = granules_to_df(res)
    log_op("METADATA", f"CMR search {short_name}", 0, t["seconds"], f"{len(df)} granules")
    if df.empty:
        log.warning("No granules found. Check maturity (PROVISIONAL starts 17 Jun 2026), "
                    "dates and bbox.")
    return df


# ---------------------------------------------------------------- polarization helpers
def pol_vars(row) -> tuple[str, str | None]:
    """(co-pol, cross-pol) GCOV dataset names for this acquisition's mode.

    Cross-pol is None for single-pol acquisitions, which the wetland method cannot use.
    """
    code = str(row.get("pol_code") or "")[:2]
    if code == "DV":
        return "VVVV", "VHVH"
    if code == "SV":
        return "VVVV", None
    if code == "SH":
        return "HHHH", None
    return "HHHH", "HVHV"


def dual_pol_only(df: pd.DataFrame) -> pd.DataFrame:
    """Keep acquisitions that have both a co-pol and a cross-pol layer."""
    if df.empty:
        return df
    keep = df.apply(lambda r: pol_vars(r)[1] is not None, axis=1)
    if (~keep).any():
        log.info("Dropped %d single-pol acquisition(s) without a cross-pol layer: %s",
                 int((~keep).sum()),
                 sorted(df.loc[~keep, "date"].dt.date.astype(str).unique()))
    return df[keep]


def single_geometry(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only the most frequent track/direction/frame, so look angles match across dates."""
    if df.empty:
        return df
    keys = [k for k in ("track", "direction", "frame") if k in df and df[k].notna().any()]
    if not keys:
        return df
    top = df.groupby(keys).size().idxmax()
    top = top if isinstance(top, tuple) else (top,)
    out = df
    for k, v in zip(keys, top):
        out = out[out[k] == v]
    log.info("Using geometry %s -> %d acquisitions", dict(zip(keys, top)), len(out))
    return out


def spread_dates(df: pd.DataFrame, max_dates: int) -> pd.DataFrame:
    """Spread the chosen acquisitions evenly through the period (notebook cell 50)."""
    if max_dates and len(df) > max_dates:
        idx = np.linspace(0, len(df) - 1, max_dates).round().astype(int)
        return df.iloc[idx]
    return df


def select_acquisitions(preset: Preset, max_dates: int = 10, maturity: str = MATURITY,
                        lock_geometry: bool = True) -> pd.DataFrame:
    """The full selection chain of notebook cell 50: search -> dual-pol -> one geometry -> spread."""
    df = search_nisar(preset.product, preset.bbox, preset.search_start, preset.search_end, maturity)
    if df.empty:
        return df
    sel = dual_pol_only(df)
    if lock_geometry:
        sel = single_geometry(sel)
    return spread_dates(sel, max_dates)


def best_per_date(df: pd.DataFrame) -> pd.DataFrame:
    """One granule per acquisition date and geometry: a full frame beats a partial-frame duplicate,
    and the newest product version beats an older reprocessing of the same pass."""
    if df.empty:
        return df
    d = df.copy()
    d["_full"] = (d.get("frame_coverage") == "F").astype(int) if "frame_coverage" in d else 0
    d["_ver"] = d["product_version"].fillna(0) if "product_version" in d else 0
    keys = ["date"] + [k for k in ("track", "direction", "frame") if k in d]
    d = d.sort_values(keys + ["_full", "_ver"])
    dropped = len(d) - len(d.drop_duplicates(subset=keys, keep="last"))
    if dropped:
        log.info("Dropped %d duplicate granule(s) (partial frame or older product version)", dropped)
    return d.drop_duplicates(subset=keys, keep="last").drop(columns=["_full", "_ver"]) \
            .sort_values("date").reset_index(drop=True)


def summarize(df: pd.DataFrame) -> str:
    """Acquisitions per month and viewing geometry, as text (the notebook's crosstab)."""
    if df.empty:
        return "no acquisitions"
    d = df.copy()
    d["month"] = d["date"].dt.to_period("M").astype(str)
    d["geometry"] = d["track"].astype("Int64").astype(str) + "-" + d["direction"].fillna("?")
    return pd.crosstab(d["geometry"], d["month"], margins=True).to_string()
