"""The exporter: NISAR in, the app's dataset out.

This module is the **single writer** of the files the frontend loads:

    frontend/public/data/changes.geojson    sample stories + the real stories of every preset
    frontend/public/data/wetlands.geojson   monthly wetland extents, drawn on the globe
    frontend/public/data/fires.geojson      burn-scar extents (likely / possible), drawn on the globe
    frontend/public/data/layers.json        the image layers for Compare dates, one or more per preset
    frontend/public/data/frames/<preset>/   those images
    frontend/public/data/provenance.json    every granule, threshold and byte count, per preset

Exports **merge per preset**: running `export --preset X` replaces only X's stories, extents, layers,
frames and provenance, and keeps every other preset's. So presets can be exported in any order, and
re-running one is always safe. Nothing else writes these files, so `npm run sample-data` cannot
clobber real measurements.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import shutil
from pathlib import Path

from . import ledger
from .config import (BURN_LIKELY, BURN_POSSIBLE, BURN_SLUGS, BURN_THRESHOLDS, CLASS_SLUGS,
                     FIRE_SMOOTH_PX, FLOODED_VEG, FREQUENCY, GCOV_RES_DEG, MAJORITY_FILTER,
                     MATURITY, MIN_AREA_KM2, OPEN_WATER, PAYLOAD_BUDGET_MB, PRESETS, PUBLIC_DATA,
                     Preset, SIMPLIFY_M, WETLAND_THRESHOLDS)

# numpy/rasterio/shapely are imported inside the runners, so composing the feed from existing
# files (`--samples-only`) needs nothing but the standard library.

log = logging.getLogger("naba_data")

SAMPLE_STORIES = "sample-stories.json"
MONTH_LABEL = "%b %Y"
# Files written before exports were merged per preset carry no `preset` field; they all came from
# the one shipped preset at the time.
LEGACY_PRESET = "manzala"


# ---------------------------------------------------------------- small helpers
def _write_json(path: Path, obj, indent: int | None = 1) -> int:
    """Pretty-printed JSON, or compact (no whitespace at all) with indent=None."""
    path.parent.mkdir(parents=True, exist_ok=True)
    seps = (",", ":") if indent is None else None
    path.write_text(json.dumps(obj, indent=indent, separators=seps, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    return path.stat().st_size


# Geometry-heavy files written without whitespace: indentation alone would more than double them.
COMPACT_FILES = {"fires.geojson"}


def _read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _month_label(month: str) -> str:
    return dt.date.fromisoformat(f"{month}-01").strftime(MONTH_LABEL)


def _preset_of(obj: dict) -> str:
    """Which preset wrote a feature (its properties) or a layer; legacy files predate the field."""
    return obj.get("preset") or LEGACY_PRESET


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
    """Real (non-sample) stories already in changes.geojson."""
    fc = _read_json(public_data / "changes.geojson", {})
    return [f for f in fc.get("features", [])
            if not f.get("properties", {}).get("is_sample", False)]


def _compose_changes(sample_features: list[dict], real_features: list[dict]) -> dict:
    """changes.geojson: real stories first (newest `published` wins in the UI anyway)."""
    return {"type": "FeatureCollection", "features": real_features + sample_features}


def _superseded_by(real_features: list[dict]) -> set[str]:
    """Sample ids replaced by real stories: every preset with a real story in the feed counts."""
    ids = {f.get("properties", {}).get("id") for f in real_features}
    out: set[str] = set()
    for p in PRESETS.values():
        if ids & set(p.story_ids.values()):
            out |= set(p.supersedes)
    return out


# ---------------------------------------------------------------- per-preset merges
def merge_changes(public_data: Path, preset: Preset, story_features: list[dict],
                  with_samples: bool) -> dict:
    """This preset's stories replace its old ones; every other preset's real stories stay."""
    own = set(preset.story_ids.values())
    others = [f for f in _real_features(public_data)
              if f.get("properties", {}).get("id") not in own]
    real = story_features + others
    samples = load_sample_features(public_data, _superseded_by(real)) if with_samples else []
    if others:
        log.info("Kept %d real story(ies) from other presets: %s", len(others),
                 [f["properties"]["id"] for f in others])
    return _compose_changes(samples, real)


def merge_features(path: Path, preset_key: str, new_features: list[dict]) -> dict:
    """A FeatureCollection where this preset's features are replaced and the rest kept."""
    old = _read_json(path, {}).get("features", [])
    kept = [f for f in old if _preset_of(f.get("properties", {})) != preset_key]
    return {"type": "FeatureCollection", "features": kept + new_features}


def merge_layers(public_data: Path, preset_key: str, new_layers: list[dict]) -> dict:
    old = _read_json(public_data / "layers.json", {}).get("layers", [])
    kept = [l for l in old if _preset_of(l) != preset_key]
    return {"layers": kept + new_layers}


def merge_provenance(public_data: Path, preset_key: str, block: dict) -> dict:
    """provenance.json holds one block per preset under "presets"."""
    old = _read_json(public_data / "provenance.json", {})
    if "presets" in old:
        presets = dict(old["presets"])
    elif "preset" in old:                        # the single-preset layout before merging
        presets = {old["preset"].get("key", LEGACY_PRESET): old}
    else:
        presets = {}
    presets[preset_key] = block
    return {"exported_at": block["exported_at"], "exporter": block["exporter"],
            "presets": dict(sorted(presets.items()))}


def _fresh_frames_dir(public_data: Path, preset: Preset) -> Path:
    """frames/<preset>/, emptied. Only this preset's images are touched.

    The folder itself is kept and only its files are removed: deleting and recreating the folder
    makes a running `vite` dev server lose track of it and serve index.html for the new images.
    """
    frames_dir = public_data / "frames" / preset.key
    frames_dir.mkdir(parents=True, exist_ok=True)
    for stale in frames_dir.iterdir():
        if stale.is_dir():
            shutil.rmtree(stale)
        else:
            stale.unlink()
    if preset.key == LEGACY_PRESET:              # images from the old flat layout were this preset's
        for stale in [*(public_data / "frames").glob("wetland_*.png"),
                      *(public_data / "frames").glob("change_*.png")]:
            stale.unlink()
    return frames_dir


def _bounds(preset: Preset) -> list[list[float]]:
    west, south, east, north = preset.bbox
    return [[west, north], [east, north], [east, south], [west, south]]


def _granule_records(acq) -> list[dict]:
    import pandas as pd

    return [{k: (str(v) if isinstance(v, pd.Timestamp) else v)
             for k, v in row.items()
             if k in ("name", "date", "track", "direction", "frame", "pol_code", "h5_url",
                      "size_MB_catalog")}
            for row in acq.to_dict("records")]


def _provenance_head(preset: Preset, maturity: str, frequency: str) -> dict:
    from . import __version__

    return {
        "exported_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "exporter": f"naba_data {__version__}",
        "source": {"mission": "NASA-ISRO NISAR", "product": preset.product, "maturity": maturity,
                   "frequency": frequency, "collection_search": "NASA CMR via earthaccess"},
        "preset": {"key": preset.key, "name": preset.name, "theme": preset.theme,
                   "bbox": list(preset.bbox), "search_start": preset.search_start,
                   "search_end": preset.search_end},
    }


def _write_all(public_data: Path, preset: Preset, story_features: list[dict], with_samples: bool,
               extents_file: str | None, extent_features: list[dict], layers: list[dict]):
    """Write changes.geojson, the theme's extents file and layers.json, merged per preset."""
    changes = merge_changes(public_data, preset, story_features, with_samples)
    sizes = {"changes.geojson": _write_json(public_data / "changes.geojson", changes)}
    if extents_file:
        sizes[extents_file] = _write_json(
            public_data / extents_file,
            merge_features(public_data / extents_file, preset.key, extent_features),
            indent=None if extents_file in COMPACT_FILES else 1)
    sizes["layers.json"] = _write_json(public_data / "layers.json",
                                       merge_layers(public_data, preset.key, layers))
    samples = sum(1 for f in changes["features"] if f.get("properties", {}).get("is_sample"))
    return sizes, samples


OUTLINE_CLOSE_M = 150.0  # fire story outline: bridge gaps up to ~300 m between burned patches
RGB_COARSEN = 2      # false-colour frames at 2 x the grid (~40 m): a quarter of the bytes, less speckle


def _coarsen(da, factor: int = RGB_COARSEN):
    """Block-average linear power for the false-colour frames (pixels, not the measurement)."""
    if factor <= 1:
        return da
    return da.coarsen(lat=factor, lon=factor, boundary="trim").mean()


def _check_budget(sizes: dict, name: str) -> None:
    budget = PAYLOAD_BUDGET_MB * 1e6
    if sizes.get(name, 0) > budget:
        log.warning("%s is %.2f MB, over the %.1f MB budget - raise --min-area-km2 or --simplify-m",
                    name, sizes[name] / 1e6, PAYLOAD_BUDGET_MB)


# ---------------------------------------------------------------- the pipeline
def run_export(preset: Preset, **kw) -> dict:
    """Search, stream, analyse, vectorize and write this preset's part of the dataset."""
    if preset.theme == "fires":
        return run_fire_export(preset, **kw)
    return run_wetland_export(preset, **kw)


def run_wetland_export(preset: Preset, max_dates: int = 10, maturity: str = MATURITY,
                       frequency: str = FREQUENCY, res_deg: float = GCOV_RES_DEG,
                       min_area_km2: float = MIN_AREA_KM2, simplify_m: float = SIMPLIFY_M,
                       majority: int = MAJORITY_FILTER, public_data: Path = PUBLIC_DATA,
                       with_samples: bool = True, offline: bool = False,
                       write_frames: bool = True) -> dict:
    """Wetlands: monthly HH/HV classes -> two stories, monthly extents and class-map frames."""
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
                "properties": {"preset": preset.key, "class": CLASS_SLUGS[class_value],
                               "month": month, "month_label": _month_label(month),
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
    story_ids = [f["properties"]["id"] for f in story_features]

    # 6 - monthly frames for Compare dates
    frame_entries, frame_bytes = [], 0
    if write_frames:
        frames_dir = _fresh_frames_dir(public_data, preset)
        for month, comp in months.items():
            path = frames_dir / f"wetland_{month}.png"
            frame_bytes += write_class_png(comp["classes"], path)
            frame_entries.append({"date": f"{month}-01",
                                  "url": f"/data/frames/{preset.key}/{path.name}"})
    layers = [{
        "id": f"{preset.key}-wetland-classes",
        "preset": preset.key,
        "story_ids": story_ids,
        "label": f"Wetland classes · {preset.region}",
        "short_label": "Wetland classes",
        "bounds": _bounds(preset),
        "frames": frame_entries,
    }] if frame_entries else []

    # 7 - write everything
    sizes, samples = _write_all(public_data, preset, story_features, with_samples,
                                "wetlands.geojson", wetland_features, layers)
    if write_frames:
        sizes[f"frames/{preset.key}/*"] = frame_bytes

    block = _provenance_head(preset, maturity, frequency)
    block.update({
        "method": {"grid_res_deg": res_deg, "thresholds_db": WETLAND_THRESHOLDS,
                   "class_values": {"no_data": 0, "open_water": 1, "flooded_vegetation": 2,
                                    "other": 3},
                   "monthly_composite": "per-pixel median of that month's acquisitions, in dB",
                   "vectorize": {"min_area_km2": min_area_km2, "simplify_m": simplify_m,
                                 "majority_filter": majority},
                   "notebook_reference": "NABA_NISAR_Explorer.ipynb Section 14"},
        "granules": _granule_records(acq),
        "dates_used": sorted({str(d.date()) for d in ts["date"]}),
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
        "output_bytes": dict(sizes),
        "stories": story_ids,
        "sample_stories_kept": samples,
    })
    sizes["provenance.json"] = _write_json(public_data / "provenance.json",
                                           merge_provenance(public_data, preset.key, block),
                                           indent=2)
    close_all()
    _check_budget(sizes, "wetlands.geojson")

    lines = [f"{len(story_features)} real stories and {len(wetland_features)} monthly extents over "
             f"{len(months)} months ({', '.join(months)})"]
    return {"sizes": sizes, "provenance": block, "indicators": ts, "lines": lines,
            "stories": len(story_features), "wetland_features": len(wetland_features),
            "months": list(months)}


def run_fire_export(preset: Preset, max_dates: int = 10, maturity: str = MATURITY,
                    frequency: str = FREQUENCY, res_deg: float = GCOV_RES_DEG,
                    min_area_km2: float = MIN_AREA_KM2, simplify_m: float = SIMPLIFY_M,
                    majority: int = MAJORITY_FILTER, public_data: Path = PUBLIC_DATA,
                    with_samples: bool = True, offline: bool = False,
                    write_frames: bool = True, smooth_px: int = FIRE_SMOOTH_PX) -> dict:
    """Fires: HV drop against the last pass before the event -> one story, burn extents, frames.

    `max_dates` is not used: a fire needs every pass between the before and after dates.
    """
    from .fires import (burn_indicators, date_label, dualpol_rgb, load_linear_series,
                        select_fire_acquisitions)
    from .frames import write_burn_png, write_rgb_image
    from .remote import close_all
    from .search import summarize
    from .stories import build_fire_story
    from .vectorize import (closed_outline, geodesic_area_km2, geometry_mapping,
                            mask_to_multipolygon, polygonal_parts, vertex_count)

    public_data.mkdir(parents=True, exist_ok=True)

    # 1 - catalog: the before/after pair and every pass of that geometry in between and after
    acq, pre, post = select_fire_acquisitions(preset, maturity=maturity)
    if acq.empty:
        raise SystemExit(f"No before/after pair of dual-pol acquisitions for preset {preset.key!r}.")
    log.info("Acquisitions per month and geometry:\n%s", summarize(acq))
    pre_label, post_label = date_label(pre), date_label(post)

    # 2 - stream HH/HV windows (linear power; cached as GeoTIFF, so a re-run moves nothing)
    co_by, cx_by, skipped = load_linear_series(acq, preset.bbox, res_deg, frequency,
                                               offline=offline)
    for need, label in (("before", pre_label), ("after", post_label)):
        if label not in cx_by:
            raise SystemExit(f"The {need} pass ({label}) did not load; cannot measure the fire.")

    # 3 - burned area per pass, each against the before pass
    ind, classes = burn_indicators(co_by, cx_by, pre_label, preset, smooth_px=smooth_px)
    log.info("Per-pass burn indicators (vs %s):\n%s", pre_label,
             ind.drop(columns=["date"]).round(2).to_string(index=False))

    # 4 - vector extents for every pass: likely, and possible = (likely or possible) - likely.
    #     The globe's burn slider steps through them; the after pass also gives the story outline.
    vec_kw = dict(min_area_km2=min_area_km2, simplify_m=simplify_m, majority=majority)

    def tiers(cls):
        burned = mask_to_multipolygon((cls == BURN_LIKELY) | (cls == BURN_POSSIBLE),
                                      preset.bbox, res_deg, **vec_kw)
        likely = mask_to_multipolygon(cls == BURN_LIKELY, preset.bbox, res_deg, **vec_kw)
        return burned, likely, polygonal_parts(burned.difference(likely), min_area_km2)

    story_id = preset.story_ids["burn_scar"]
    by_label = ind.set_index("label")
    fire_features, pass_extents = [], {}
    for label in sorted(classes):
        log.info("Vectorizing burn tiers for %s", label)
        burned, likely, possible = tiers(classes[label])
        row = by_label.loc[label]
        pass_extents[label] = {"likely_km2": round(geodesic_area_km2(likely), 2),
                               "possible_km2": round(geodesic_area_km2(possible), 2),
                               "vertices": vertex_count(burned)}
        if label == post_label:
            burned_geom, likely_geom, possible_geom = burned, likely, possible
        for tier, geom, pixel_km2 in ((BURN_LIKELY, likely, row["likely_km2"]),
                                      (BURN_POSSIBLE, possible, row["possible_km2"])):
            mapped = geometry_mapping(geom)
            if mapped is None:
                continue
            d = dt.date.fromisoformat(label)
            fire_features.append({
                "type": "Feature",
                "geometry": mapped,
                "properties": {
                    "preset": preset.key, "story_id": story_id, "tier": BURN_SLUGS[tier],
                    "date": label, "date_label": f"{d.day} {d:%b}", "role": row["role"],
                    "headline": label == post_label, "before": pre_label,
                    "area_km2": round(geodesic_area_km2(geom), 2),
                    "pixel_km2": round(float(pixel_km2), 2),
                    "threshold_db": (BURN_THRESHOLDS["likely_db"] if tier == BURN_LIKELY
                                     else BURN_THRESHOLDS["possible_db"]),
                },
            })
    if burned_geom.is_empty:
        raise SystemExit("No burned pixels survived vectorization at the after pass; nothing to "
                         "export.")

    # 5 - the story. Its area is the burned patches (both tiers); its outline on the map is a
    #     smooth envelope around them, so it frames the burn instead of hiding it.
    point = (likely_geom if not likely_geom.is_empty else burned_geom).representative_point()
    outline_km2 = geodesic_area_km2(burned_geom)
    envelope = closed_outline(burned_geom, OUTLINE_CLOSE_M, simplify_m)
    story = build_fire_story(preset, ind, pre_label, post_label, outline_km2,
                             lat=point.y, lon=point.x)
    story_features = [{"type": "Feature", "geometry": geometry_mapping(envelope),
                       "properties": story}]

    # 6 - frames for Compare dates: false colour and burn mask for every pass
    layers, frame_bytes = [], 0
    if write_frames:
        frames_dir = _fresh_frames_dir(public_data, preset)
        rgb_frames, burn_frames = [], []
        for label in sorted(cx_by):
            rgb, valid = dualpol_rgb(_coarsen(co_by[label]), _coarsen(cx_by[label]))
            p = frames_dir / f"rgb_{label}.webp"
            frame_bytes += write_rgb_image(rgb, valid, p)
            rgb_frames.append({"date": label, "url": f"/data/frames/{preset.key}/{p.name}"})
            p = frames_dir / f"burn_{label}.png"
            frame_bytes += write_burn_png(classes[label], p)
            burn_frames.append({"date": label, "url": f"/data/frames/{preset.key}/{p.name}"})
        common = {"preset": preset.key, "story_ids": [story_id], "bounds": _bounds(preset)}
        layers = [
            {"id": f"{preset.key}-false-colour", **common, "short_label": "False colour",
             "label": f"Radar false colour (R = HH, G = HV, B = HH−HV) · {preset.region}",
             "frames": rgb_frames},
            {"id": f"{preset.key}-burn", **common, "short_label": "Burn mask",
             "label": f"Burn mask: HV drop since {pre_label} · {preset.region}",
             "frames": burn_frames},
        ]

    # 7 - write everything
    sizes, samples = _write_all(public_data, preset, story_features, with_samples,
                                "fires.geojson", fire_features, layers)
    if write_frames:
        sizes[f"frames/{preset.key}/*"] = frame_bytes

    block = _provenance_head(preset, maturity, frequency)
    block["preset"].update(event_start=preset.event_start, event_end=preset.event_end)
    block.update({
        "reported": {"area_km2": preset.reported_area_km2, "note": preset.reported_note,
                     "source": preset.reported_source},
        "method": {"grid_res_deg": res_deg, "smooth_px": smooth_px,
                   "smoothing": "NaN-aware boxcar on linear power before converting to dB",
                   "thresholds_db": BURN_THRESHOLDS,
                   "change": "HV(pass) - HV(before), dB; every pass compared with the before pass",
                   "class_values": {"no_data": 0, "unburned": 1, "possible": 2, "likely": 3},
                   "before": pre_label, "after": post_label,
                   "geometry": {k: (int(pre[k]) if k != "direction" else pre[k])
                                for k in ("track", "direction", "frame") if k in pre},
                   "areas": "series and headline: pixel count x cell area (as in the notebook); "
                            "extents: vectorized and measured geodesically",
                   "vectorize": {"min_area_km2": min_area_km2, "simplify_m": simplify_m,
                                 "majority_filter": majority,
                                 "story_envelope_close_m": OUTLINE_CLOSE_M},
                   "notebook_reference": "NABA_NISAR_Explorer.ipynb Section 12"},
        "granules": _granule_records(acq),
        "dates_used": sorted(cx_by),
        "skipped": skipped,
        "indicators": json.loads(ind.drop(columns=["date"]).round(3).to_json(orient="records")),
        "extent_km2": {"likely": round(geodesic_area_km2(likely_geom), 2),
                       "possible": round(geodesic_area_km2(possible_geom), 2),
                       "burned_patches": round(outline_km2, 2),
                       "story_envelope": round(geodesic_area_km2(envelope), 2)},
        "vertices": {"burned_patches": vertex_count(burned_geom),
                     "story_envelope": vertex_count(envelope)},
        "passes": pass_extents,
        "network_MB": ledger.network_mb(),
        "ledger_totals": ledger.totals(),
        "output_bytes": dict(sizes),
        "stories": [story_id],
        "sample_stories_kept": samples,
    })
    sizes["provenance.json"] = _write_json(public_data / "provenance.json",
                                           merge_provenance(public_data, preset.key, block),
                                           indent=2)
    close_all()
    _check_budget(sizes, "fires.geojson")

    post_row = by_label.loc[post_label]
    lines = [f"1 real story: {story['headline']}",
             f"before {pre_label} -> after {post_label}: likely {post_row['likely_km2']:.1f} km², "
             f"likely+possible {post_row['burned_km2']:.1f} km² (pixel count); burned patches "
             f"{outline_km2:.1f} km² (vectorized), story envelope {geodesic_area_km2(envelope):.1f} km²",
             f"{len(cx_by)} passes: " + ", ".join(f"{r.label} {r.likely_km2:.1f}"
                                                  for r in ind.itertuples())]
    return {"sizes": sizes, "provenance": block, "indicators": ind, "lines": lines,
            "stories": len(story_features), "fire_features": len(fire_features)}


def run_samples_only(preset: Preset, public_data: Path = PUBLIC_DATA) -> dict:
    """Rebuild changes.geojson from sample-stories.json plus the real stories already exported.

    No network, no credentials: for refreshing the sample half of the feed.
    """
    real = _real_features(public_data)
    samples = load_sample_features(public_data, _superseded_by(real) | set(preset.supersedes))
    size = _write_json(public_data / "changes.geojson", _compose_changes(samples, real))
    log.info("changes.geojson rewritten: %d real + %d sample stories (%.0f kB)",
             len(real), len(samples), size / 1e3)
    return {"real": len(real), "samples": len(samples), "bytes": size}
