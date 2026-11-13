"""The exporter: NISAR in, the app's dataset out.

This module is the **single writer** of the files the frontend loads:

    frontend/public/data/changes.geojson    sample stories + the real wetland stories
    frontend/public/data/wetlands.geojson   monthly vector extents, drawn on the globe
    frontend/public/data/layers.json        the monthly class-map frames (Compare dates)
    frontend/public/data/frames/*.png       those frames
    frontend/public/data/provenance.json    every granule, threshold and byte count behind them

Nothing else writes them, so re-running this is always safe and `npm run sample-data` cannot
clobber real measurements.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from . import ledger
from .config import (CLASS_SLUGS, FLOODED_VEG, FREQUENCY, GCOV_RES_DEG, MAJORITY_FILTER, MATURITY,
                     MIN_AREA_KM2, OPEN_WATER, PAYLOAD_BUDGET_MB, PUBLIC_DATA, Preset,
                     SIMPLIFY_M, WETLAND_THRESHOLDS)

# numpy/rasterio/shapely are imported inside run_export, so composing the feed from existing
# files (`--samples-only`) needs nothing but the standard library.

log = logging.getLogger("naba_data")

SAMPLE_STORIES = "sample-stories.json"
MONTH_LABEL = "%b %Y"


# ---------------------------------------------------------------- small helpers
def _write_json(path: Path, obj, indent: int = 1) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    return path.stat().st_size


def _month_label(month: str) -> str:
    return dt.date.fromisoformat(f"{month}-01").strftime(MONTH_LABEL)


def load_sample_features(public_data: Path, superseded: set[str]) -> list[dict]:
    """The sample stories to keep, from sample-stories.json or (as a fallback) changes.geojson."""
    src = public_data / SAMPLE_STORIES
    if src.exists():
        features = json.loads(src.read_text(encoding="utf-8")).get("features", [])
    else:
        existing = public_data / "changes.geojson"
        if not existing.exists():
            return []
        features = [f for f in json.loads(existing.read_text(encoding="utf-8")).get("features", [])
                    if f.get("properties", {}).get("is_sample")]
        log.info("%s not found; taking sample stories from changes.geojson", SAMPLE_STORIES)
    kept = [f for f in features if f.get("properties", {}).get("id") not in superseded]
    dropped = len(features) - len(kept)
    if dropped:
        log.info("Dropped %d superseded sample story(ies): %s", dropped, sorted(superseded))
    return kept


def _real_features(public_data: Path) -> list[dict]:
    """Real (non-sample) stories already in changes.geojson - used by --samples-only."""
    path = public_data / "changes.geojson"
    if not path.exists():
        return []
    return [f for f in json.loads(path.read_text(encoding="utf-8")).get("features", [])
            if not f.get("properties", {}).get("is_sample", False)]


def _compose_changes(sample_features: list[dict], real_features: list[dict]) -> dict:
    """changes.geojson: real stories first (newest `published` wins in the UI anyway)."""
    return {"type": "FeatureCollection", "features": real_features + sample_features}


# ---------------------------------------------------------------- the pipeline
def run_export(preset: Preset, max_dates: int = 10, maturity: str = MATURITY,
               frequency: str = FREQUENCY, res_deg: float = GCOV_RES_DEG,
               min_area_km2: float = MIN_AREA_KM2, simplify_m: float = SIMPLIFY_M,
               majority: int = MAJORITY_FILTER, public_data: Path = PUBLIC_DATA,
               with_samples: bool = True, offline: bool = False,
               write_frames: bool = True) -> dict:
    """Search, stream, classify, vectorize and write the dataset. Returns a summary dict."""
    import pandas as pd

    from . import __version__
    from .frames import write_class_png
    from .remote import close_all
    from .search import select_acquisitions, summarize
    from .stories import build_story
    from .vectorize import (geodesic_area_km2, geometry_mapping, monthly_extents, union_all,
                            vertex_count)
    from .wetlands import date_indicators, load_series, monthly_composites, pixel_area_km2

    public_data.mkdir(parents=True, exist_ok=True)

    # 1 - catalog (metadata only)
    acq = select_acquisitions(preset, max_dates=max_dates, maturity=maturity)
    if acq.empty:
        raise SystemExit(f"No usable dual-pol acquisitions for preset {preset.key!r}.")
    log.info("Acquisitions per month and geometry:\n%s", summarize(acq))

    # 2 - stream HH/HV windows (cached as GeoTIFF, so a re-run moves nothing)
    hh_by, hv_by, skipped = load_series(acq, preset.bbox, res_deg, frequency, offline=offline)
    if not hh_by:
        raise SystemExit("No acquisition produced both polarizations over the AOI.")

    # 3 - indicators per date, then monthly composites
    ts = date_indicators(hh_by, hv_by)
    log.info("Per-date indicators:\n%s", ts.round(2).to_string(index=False))
    months = monthly_composites(hh_by, hv_by)

    # 4 - vector extents per class per month, plus the "ever this class" envelope
    vec_kw = dict(min_area_km2=min_area_km2, simplify_m=simplify_m, majority=majority)
    extents, envelopes = {}, {}
    for class_value in (OPEN_WATER, FLOODED_VEG):
        log.info("Vectorizing %s", CLASS_SLUGS[class_value])
        extents[class_value] = monthly_extents(months, class_value, preset.bbox, res_deg, **vec_kw)
        envelopes[class_value] = union_all(m["geometry"] for m in extents[class_value].values())

    wetland_features = []
    for class_value, by_month in extents.items():
        for month, item in by_month.items():
            geom = geometry_mapping(item["geometry"])
            if geom is None:
                continue
            wetland_features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"class": CLASS_SLUGS[class_value], "month": month,
                               "month_label": _month_label(month),
                               "area_km2": item["area_km2"], "dates": item["dates"]},
            })

    # 5 - the two stories
    story_features = []
    for class_value in (OPEN_WATER, FLOODED_VEG):
        envelope = envelopes[class_value]
        geom = geometry_mapping(envelope)
        if geom is None:
            log.warning("No %s found in any month; story skipped.", CLASS_SLUGS[class_value])
            continue
        point = envelope.representative_point()
        story = build_story(preset, class_value, ts, geodesic_area_km2(envelope),
                            lat=point.y, lon=point.x)
        story_features.append({"type": "Feature", "geometry": geom, "properties": story})

    # 6 - monthly frames for Compare dates
    frames_dir = public_data / "frames"
    frame_entries, frame_bytes = [], 0
    if write_frames:
        for stale in list(frames_dir.glob("change_*.png")) + list(frames_dir.glob("wetland_*.png")):
            stale.unlink()
        for month, comp in months.items():
            path = frames_dir / f"wetland_{month}.png"
            frame_bytes += write_class_png(comp["classes"], path)
            frame_entries.append({"date": f"{month}-01", "url": f"/data/frames/{path.name}"})

    west, south, east, north = preset.bbox
    layers = {"layers": [{
        "id": "wetland-classes",
        "label": f"Wetland classes · {preset.region}",
        "bounds": [[west, north], [east, north], [east, south], [west, south]],
        "frames": frame_entries,
    }]}

    # 7 - write everything
    samples = load_sample_features(public_data, set(preset.supersedes)) if with_samples else []
    sizes = {
        "changes.geojson": _write_json(public_data / "changes.geojson",
                                       _compose_changes(samples, story_features)),
        "wetlands.geojson": _write_json(public_data / "wetlands.geojson",
                                        {"type": "FeatureCollection", "features": wetland_features}),
        "layers.json": _write_json(public_data / "layers.json", layers),
    }
    if write_frames:
        sizes["frames/*.png"] = frame_bytes

    provenance = {
        "exported_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "exporter": f"naba_data {__version__}",
        "source": {"mission": "NASA-ISRO NISAR", "product": preset.product, "maturity": maturity,
                   "frequency": frequency, "collection_search": "NASA CMR via earthaccess"},
        "preset": {"key": preset.key, "name": preset.name, "bbox": list(preset.bbox),
                   "search_start": preset.search_start, "search_end": preset.search_end},
        "method": {"grid_res_deg": res_deg, "thresholds_db": WETLAND_THRESHOLDS,
                   "class_values": {"no_data": 0, "open_water": 1, "flooded_vegetation": 2,
                                    "other": 3},
                   "monthly_composite": "per-pixel median of that month's acquisitions, in dB",
                   "vectorize": {"min_area_km2": min_area_km2, "simplify_m": simplify_m,
                                 "majority_filter": majority},
                   "notebook_reference": "NABA_NISAR_Explorer.ipynb Section 14"},
        "granules": [{k: (str(v) if isinstance(v, pd.Timestamp) else v)
                      for k, v in row.items()
                      if k in ("name", "date", "track", "direction", "frame", "pol_code",
                               "h5_url", "size_MB_catalog")}
                     for row in acq.to_dict("records")],
        "dates_used": sorted({str(pd.Timestamp(d).date()) for d in ts["date"]}),
        "skipped": skipped,
        "indicators": json.loads(ts.assign(date=ts["date"].astype(str)).round(3).to_json(
            orient="records")),
        "months": {m: {"dates": comp["dates"],
                       "analysed_km2": round(float((comp["classes"] > 0).sum())
                                             * pixel_area_km2(comp["hh"]), 2),
                       "open_water_km2": extents[OPEN_WATER][m]["area_km2"],
                       "flooded_vegetation_km2": extents[FLOODED_VEG][m]["area_km2"]}
                   for m, comp in months.items()},
        "envelope_km2": {CLASS_SLUGS[c]: round(geodesic_area_km2(g), 2)
                         for c, g in envelopes.items()},
        "vertices": {CLASS_SLUGS[c]: vertex_count(g) for c, g in envelopes.items()},
        "network_MB": ledger.network_mb(),
        "ledger_totals": ledger.totals(),
        "output_bytes": sizes,
        "stories": [f["properties"]["id"] for f in story_features],
        "sample_stories_kept": len(samples),
    }
    sizes["provenance.json"] = _write_json(public_data / "provenance.json", provenance, indent=2)
    close_all()

    budget = PAYLOAD_BUDGET_MB * 1e6
    if sizes["wetlands.geojson"] > budget:
        log.warning("wetlands.geojson is %.2f MB, over the %.1f MB budget - raise --min-area-km2 "
                    "or --simplify-m", sizes["wetlands.geojson"] / 1e6, PAYLOAD_BUDGET_MB)
    return {"sizes": sizes, "provenance": provenance, "indicators": ts,
            "wetland_features": len(wetland_features), "stories": len(story_features),
            "months": list(months)}


def run_samples_only(preset: Preset, public_data: Path = PUBLIC_DATA) -> dict:
    """Rebuild changes.geojson from sample-stories.json plus the real stories already exported.

    No network, no credentials: for refreshing the sample half of the feed.
    """
    samples = load_sample_features(public_data, set(preset.supersedes))
    real = _real_features(public_data)
    size = _write_json(public_data / "changes.geojson", _compose_changes(samples, real))
    log.info("changes.geojson rewritten: %d real + %d sample stories (%.0f kB)",
             len(real), len(samples), size / 1e3)
    return {"real": len(real), "samples": len(samples), "bytes": size}
