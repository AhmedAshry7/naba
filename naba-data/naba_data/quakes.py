"""Earthquakes: one NISAR GUNW interferogram -> ground motion map + a Naba story.

The wetland pipeline reads backscatter (GCOV). An earthquake is read from an *interferogram*
(GUNW): the phase difference between two radar passes of the same track, here 12 days apart and
bracketing the shock. A change of one radar wavelength in the satellite-to-ground distance is one
colour cycle ("fringe"); at L-band that is about 12 cm of motion along the line of sight (LOS).

Same rules as `export.py`:
  - nothing is processed on the fly: the three GUNW layers over the AOI are downloaded once as
    GeoTIFF subsets (`cache/subsets`) and every later run reads those, moving 0 MB;
  - this module writes only its own story, layer and frames, and leaves the wetland files alone
    (and `export.py` leaves earthquake stories and layers alone in return).

Layers read (frequency A, HH): unwrappedPhase [rad], coherenceMagnitude [0-1],
connectedComponents [0 = not unwrapped].
"""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

import numpy as np

from . import ledger
from .config import (EQ_MIN_AREA_KM2, EQ_SIMPLIFY_M, GUNW_RES_DEG, MATURITY, MIN_COHERENCE,
                     PUBLIC_DATA, REFERENCE_MIN_KM, WAVELENGTH_M, EarthquakePreset)

log = logging.getLogger("naba_data")

PHASE_VAR = "unwrappedInterferogram/HH/unwrappedPhase"
COH_VAR = "unwrappedInterferogram/HH/coherenceMagnitude"
CC_VAR = "unwrappedInterferogram/HH/connectedComponents"
FRAME_LOS = "quake_{key}_los.png"
FRAME_FRINGES = "quake_{key}_fringes.png"


# ---------------------------------------------------------------- catalog + download
def find_pair(preset: EarthquakePreset, maturity: str = MATURITY):
    """The catalog row (name, date, h5_url, ...) of the chosen GUNW granule. Metadata only."""
    from .search import search_nisar

    df = search_nisar(preset.product, preset.bbox, preset.search_start, preset.search_end, maturity)
    if df.empty:
        raise SystemExit("No GUNW granules found over the AOI.")
    hit = df[df["name"] == preset.granule]
    if hit.empty:
        raise SystemExit(f"Granule {preset.granule} is not in the catalog for this AOI/date range. "
                         f"Run `python -m naba_data quake-search --preset {preset.key}`.")
    return hit.iloc[0]


def download_layers(row, preset: EarthquakePreset, res_deg: float = GUNW_RES_DEG,
                    frequency: str = "A", offline: bool = False) -> dict:
    """Download (or load from cache) the three GUNW layers over the AOI as lon/lat grids."""
    from .remote import read_aoi

    spec = {"phase": (PHASE_VAR, "average"), "coherence": (COH_VAR, "average"),
            "components": (CC_VAR, "nearest")}
    return {k: read_aoi(row, var, preset.bbox, res_deg, frequency, resampling=how, offline=offline)
            for k, (var, how) in spec.items()}


# ---------------------------------------------------------------- the science
def distance_km(lats: np.ndarray, lons: np.ndarray, lat0: float, lon0: float) -> np.ndarray:
    """Approximate distance of every grid cell from a point (fine at this scale), shape (h, w)."""
    dy = (lats[:, None] - lat0) * 110.57
    dx = (lons[None, :] - lon0) * 111.32 * np.cos(np.radians(lat0))
    return np.hypot(dy, dx)


def los_displacement(layers: dict, preset: EarthquakePreset) -> dict:
    """Unwrapped phase (rad) -> metres of LOS motion, referenced to the far field.

    motion = phase * wavelength / (4 pi): the radar path is there and back, so one 2 pi cycle is
    half a wavelength. An unwrapped phase has an arbitrary constant, so the median over pixels at
    least REFERENCE_MIN_KM from the epicentre is subtracted: "far from the quake means no motion".
    """
    phase = layers["phase"].values.astype("float64")
    coh = layers["coherence"].values
    cc = layers["components"].values
    lats, lons = layers["phase"].lat.values, layers["phase"].lon.values

    valid = np.isfinite(phase) & np.isfinite(coh) & (coh >= MIN_COHERENCE) & (cc > 0)
    disp = phase * WAVELENGTH_M / (4 * np.pi)
    dist = distance_km(lats, lons, preset.lat, preset.lon)
    far = valid & (dist >= REFERENCE_MIN_KM)
    if far.sum() >= 500:
        ref, ref_note = float(np.median(disp[far])), f"median of {int(far.sum())} far-field pixels"
    else:
        ref, ref_note = float(np.median(disp[valid])), "median of all valid pixels (no far field)"
    disp = np.where(valid, disp - ref, np.nan)
    return dict(disp=disp, valid=valid, dist=dist, phase=phase, reference_m=ref,
                reference_note=ref_note, coherence=coh)


def summarize_motion(m: dict, preset: EarthquakePreset) -> dict:
    """The numbers the story quotes. Percentiles, not min/max, so one bad pixel cannot win."""
    d, valid = m["disp"][m["valid"]], m["valid"]
    lo, hi = (float(v) for v in np.percentile(d, [1, 99]))
    peak = max(abs(lo), abs(hi))
    pixel_km2 = GUNW_RES_DEG * 111.32 * np.cos(np.radians(preset.lat)) * GUNW_RES_DEG * 110.57
    return dict(
        peak_los_m=round(peak, 2),
        p01_m=round(lo, 2), p99_m=round(hi, 2),
        fringes=round((hi - lo) / (WAVELENGTH_M / 2), 1),
        fringe_cm=round(WAVELENGTH_M / 2 * 100, 1),
        mean_coherence=round(float(np.mean(m["coherence"][valid])), 2),
        valid_pct=round(100 * float(valid.mean()), 1),
        valid_km2=round(float(valid.sum()) * pixel_km2, 0),
    )


# ---------------------------------------------------------------- frames (PNG)
def _lerp(stops, t):
    """Piecewise-linear colour ramp: stops = [(pos, (r, g, b)), ...], t in [0, 1]."""
    pos = np.array([s[0] for s in stops])
    return np.stack([np.interp(t, pos, [s[1][i] for s in stops]) for i in range(3)], axis=-1)


LOS_RAMP = [(0.0, (33, 102, 172)), (0.25, (103, 169, 207)), (0.5, (247, 247, 247)),
            (0.75, (239, 138, 98)), (1.0, (178, 24, 43))]


def los_rgba(disp: np.ndarray, vmax: float) -> np.ndarray:
    """Blue <-> white <-> red for motion in opposite directions; invalid pixels transparent."""
    out = np.zeros((*disp.shape, 4), dtype="uint8")
    ok = np.isfinite(disp)
    t = np.clip((np.where(ok, disp, 0) + vmax) / (2 * vmax), 0, 1)
    out[..., :3] = _lerp(LOS_RAMP, t).astype("uint8")
    out[..., 3] = np.where(ok, 215, 0)
    return out


def fringe_rgba(phase: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Wrapped phase as the classic rainbow of fringes: one full colour cycle = one fringe."""
    wrapped = np.mod(np.where(valid, phase, 0), 2 * np.pi) / (2 * np.pi)   # 0..1
    h6 = wrapped * 6.0
    i = np.floor(h6).astype(int) % 6
    f = h6 - np.floor(h6)
    q, t = 1 - f, f
    r = np.choose(i, [np.ones_like(f), q, np.zeros_like(f), np.zeros_like(f), t, np.ones_like(f)])
    g = np.choose(i, [t, np.ones_like(f), np.ones_like(f), q, np.zeros_like(f), np.zeros_like(f)])
    b = np.choose(i, [np.zeros_like(f), np.zeros_like(f), t, np.ones_like(f), np.ones_like(f), q])
    out = np.zeros((*phase.shape, 4), dtype="uint8")
    out[..., 0], out[..., 1], out[..., 2] = (r * 255), (g * 255), (b * 255)
    out[~valid, :3] = 0
    out[..., 3] = np.where(valid, 215, 0)
    return out


def _write_png(rgba: np.ndarray, path: Path) -> int:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)
    log.info("  frame %s (%d x %d, %.0f kB)", path.name, rgba.shape[1], rgba.shape[0],
             path.stat().st_size / 1e3)
    return path.stat().st_size


# ---------------------------------------------------------------- footprint polygon
def footprint(valid: np.ndarray, preset: EarthquakePreset, res_deg: float):
    """Where the interferogram has usable data, as a simplified MultiPolygon (the story outline)."""
    from scipy.ndimage import binary_closing

    from .vectorize import mask_to_multipolygon

    closed = binary_closing(valid, structure=np.ones((5, 5)), iterations=2)
    return mask_to_multipolygon(closed, preset.bbox, res_deg, min_area_km2=EQ_MIN_AREA_KM2,
                                simplify_m=EQ_SIMPLIFY_M, majority=5)


# ---------------------------------------------------------------- the story
def _fmt_date(iso: str) -> str:
    d = dt.date.fromisoformat(str(iso)[:10])
    return f"{d.day} {d:%B %Y}"


def build_quake_story(preset: EarthquakePreset, stats: dict, ref_date: str, sec_date: str,
                      footprint_km2: float, reference_note: str) -> dict:
    """One ChangeStory dict for the earthquake. Every sentence comes from a number or the method."""
    peak = stats["peak_los_m"]
    event_day = _fmt_date(preset.event_time_utc)
    after = ", ".join(preset.aftershocks)
    confidence = "moderate" if stats["mean_coherence"] >= 0.4 else "low"
    headline = (f"Magnitude {preset.magnitude} earthquake moved the ground by up to "
                f"{peak:.1f} m on Panama's Azuero peninsula")
    span = round(stats["p99_m"] - stats["p01_m"], 1)
    summary = (f"Two radar passes 12 days apart, on {_fmt_date(ref_date)} and {_fmt_date(sec_date)}, "
               f"bracket the {event_day} earthquake. Comparing them shows the ground moved by up "
               f"to {peak:.1f} m along the satellite's line of sight. Across the map the two "
               f"extremes differ by about {span:.1f} m, which is {stats['fringes']:.0f} colour "
               f"cycles ('fringes') of {stats['fringe_cm']:.0f} cm each. Blue and red on the map "
               f"are motion in opposite directions along that line.")
    explanation = (
        f"NASA-ISRO NISAR flew over the Azuero peninsula on {_fmt_date(ref_date)} and again on "
        f"{_fmt_date(sec_date)}, from the same track and look direction. The earthquake "
        f"(magnitude {preset.magnitude}, {event_day}, {preset.depth_km:.0f} km deep, per USGS) "
        f"happened in between, with aftershocks of {after}.\n\n"
        f"An interferogram compares the radar phase of the two passes. If the ground has not "
        f"moved, the phase matches. If it moved even a few centimetres towards or away from the "
        f"satellite, the phase shifts: one full colour cycle means the distance changed by half "
        f"the L-band wavelength, about {stats['fringe_cm']:.0f} cm. Counting cycles across the "
        f"map gives about {stats['fringes']:.0f} fringes: the 1st to 99th percentile of the map "
        f"runs from {stats['p01_m']:+.2f} m to {stats['p99_m']:+.2f} m, so the two extremes are "
        f"about {span:.1f} m apart and the largest motion in either direction is {peak:.1f} m.\n\n"
        f"The map is zeroed in the far field ({reference_note}), because an unwrapped phase only "
        f"gives relative motion. Pixels with coherence below {MIN_COHERENCE:.1f} are left out "
        f"(the average coherence of what is shown is {stats['mean_coherence']:.2f}), so the map "
        f"covers about {footprint_km2:,.0f} km2 rather than the whole frame.\n\n"
        f"What this does not say: radar sees motion along one slanted line, not up, east and "
        f"north separately, so 'up to {peak:.1f} m' is not the full 3D movement. Atmosphere, the "
        f"ionosphere and unwrapping errors where coherence is low can add or remove fringes. "
        f"The aftershocks fall inside the same 12 days, so this is the sum of all of them.\n\n"
        f"Why it matters: {preset.why_it_matters} {preset.next_step}"
    )
    return dict(
        id=preset.story_id,
        headline=headline,
        region=preset.region,
        subtitle=preset.subtitle,
        lat=round(preset.lat, 4),
        lon=round(preset.lon, 4),
        change_class="significant",
        change_type="earthquake",
        metric=dict(label="Ground motion along the satellite's line of sight", value=peak,
                    unit="metres, up to", direction="upward"),
        period=dict(start=ref_date, end=sec_date),
        passes=2,
        area_km2=round(float(footprint_km2), 1),
        confidence=confidence,
        confidence_note=("One interferogram from two passes. Motion is along the satellite's "
                         "line of sight only; atmosphere and unwrapping errors can affect it"),
        summary=summary,
        causes=list(preset.causes),
        why_it_matters=preset.why_it_matters,
        next_step=preset.next_step,
        series=[],
        explanation=explanation,
        explanation_ai_generated=False,
        event_date=preset.event_time_utc[:10],
        published=dt.date.today().isoformat(),
        is_sample=False,
    )


# ---------------------------------------------------------------- merge into the app's files
def _read_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _write_json(path: Path, obj, indent: int = 1) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    return path.stat().st_size


def merge_into_dataset(public_data: Path, preset: EarthquakePreset, feature: dict,
                       layer: dict | None) -> None:
    """Add or replace this earthquake's story and layer; every other story and layer is kept."""
    changes_path = public_data / "changes.geojson"
    changes = _read_json(changes_path, {"type": "FeatureCollection", "features": []})
    kept = [f for f in changes["features"] if f.get("properties", {}).get("id") != preset.story_id]
    changes["features"] = [feature] + kept
    _write_json(changes_path, changes)

    layers_path = public_data / "layers.json"
    layers = _read_json(layers_path, {"layers": []})
    layer_id = f"earthquake-{preset.key}"
    layers["layers"] = [l for l in layers.get("layers", []) if l.get("id") != layer_id]
    if layer:
        layers["layers"].append(layer)
    _write_json(layers_path, layers)


# ---------------------------------------------------------------- the pipeline
def run_quake_export(preset: EarthquakePreset, public_data: Path = PUBLIC_DATA,
                     res_deg: float = GUNW_RES_DEG, maturity: str = MATURITY,
                     offline: bool = False, write_frames: bool = True) -> dict:
    """Search, download, convert to LOS motion, draw, write. Returns a summary dict."""
    import pandas as pd

    from . import __version__
    from .remote import close_all
    from .vectorize import geodesic_area_km2, geometry_mapping

    # 1 - catalog (metadata only) and the pair's dates, from the granule name
    if offline:
        row = {"name": preset.granule, "h5_url": None, "date": pd.NaT}
    else:
        row = find_pair(preset, maturity)
    dates = sorted({t[:8] for t in preset.granule.split("_") if len(t) == 15 and t[8] == "T"})
    ref_date, sec_date = (f"{d[:4]}-{d[4:6]}-{d[6:8]}" for d in (dates[0], dates[-1]))
    if offline:                         # read_aoi needs name/date only when the cache has the file
        row["date"] = pd.Timestamp(ref_date)

    # 2 - download the three layers (cached as GeoTIFF; a re-run moves 0 MB)
    layers = download_layers(row, preset, res_deg, offline=offline)

    # 3 - phase -> metres, far-field reference, usable-pixel mask
    motion = los_displacement(layers, preset)
    if not motion["valid"].any():
        raise SystemExit("No pixel passes the coherence / unwrapping mask.")
    stats = summarize_motion(motion, preset)
    log.info("LOS motion: 1st-99th percentile %+.2f .. %+.2f m, ~%.1f fringes, coherence %.2f, "
             "%.0f%% of the AOI usable", stats["p01_m"], stats["p99_m"], stats["fringes"],
             stats["mean_coherence"], stats["valid_pct"])

    # 4 - outline of the usable area
    outline = footprint(motion["valid"], preset, res_deg)
    geom = geometry_mapping(outline)
    if geom is None:
        raise SystemExit("The footprint came out empty; lower --min-area or check the mask.")
    footprint_km2 = geodesic_area_km2(outline)

    # 5 - the story
    story = build_quake_story(preset, stats, ref_date, sec_date, footprint_km2,
                              motion["reference_note"])
    feature = {"type": "Feature", "geometry": geom, "properties": story}

    # 6 - frames: ground motion in metres, and the raw fringes
    frames_dir = public_data / "frames"
    layer, frame_bytes = None, 0
    if write_frames:
        vmax = max(stats["peak_los_m"], 0.1)
        los_path = frames_dir / FRAME_LOS.format(key=preset.key)
        fr_path = frames_dir / FRAME_FRINGES.format(key=preset.key)
        frame_bytes += _write_png(los_rgba(motion["disp"], vmax), los_path)
        frame_bytes += _write_png(fringe_rgba(motion["phase"], motion["valid"]), fr_path)
        west, south, east, north = preset.bbox
        layer = {
            "id": f"earthquake-{preset.key}",
            "kind": "views",
            "story_id": preset.story_id,
            "label": f"Ground motion · {preset.region}",
            "bounds": [[west, north], [east, north], [east, south], [west, south]],
            "legend": {"min": -round(vmax, 2), "max": round(vmax, 2), "unit": "m"},
            "frames": [
                {"date": sec_date, "label": f"Ground motion (blue to red, up to ±{vmax:.1f} m)",
                 "url": f"/data/frames/{los_path.name}"},
                {"date": sec_date,
                 "label": f"Radar fringes (one colour cycle = {stats['fringe_cm']:.0f} cm)",
                 "url": f"/data/frames/{fr_path.name}"},
            ],
        }

    merge_into_dataset(public_data, preset, feature, layer)

    # 7 - provenance (its own file: the wetland run owns provenance.json)
    provenance = {
        "exported_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "exporter": f"naba_data {__version__}",
        "source": {"mission": "NASA-ISRO NISAR", "product": preset.product, "maturity": maturity,
                   "frequency": "A", "polarization": "HH"},
        "event": {"magnitude": preset.magnitude, "time_utc": preset.event_time_utc,
                  "lat": preset.lat, "lon": preset.lon, "depth_km": preset.depth_km,
                  "place": preset.place, "aftershocks": list(preset.aftershocks),
                  "source": "USGS, as listed in the NISAR demo-sites file"},
        "granule": {"name": preset.granule, "reference_date": ref_date,
                    "secondary_date": sec_date, "h5_url": row.get("h5_url") if hasattr(row, "get")
                    else None},
        "alternates": list(preset.alt_granules),
        "preset": {"key": preset.key, "bbox": list(preset.bbox)},
        "method": {"grid_res_deg": res_deg, "wavelength_m": round(WAVELENGTH_M, 4),
                   "los_m": "unwrappedPhase * wavelength / (4 pi)",
                   "reference": motion["reference_note"],
                   "reference_min_km": REFERENCE_MIN_KM, "reference_m": round(
                       motion["reference_m"], 4),
                   "min_coherence": MIN_COHERENCE,
                   "mask": "coherenceMagnitude >= min_coherence and connectedComponents > 0",
                   "layers": [PHASE_VAR, COH_VAR, CC_VAR],
                   "cache": "naba-data/cache/subsets (GeoTIFF, gitignored)"},
        "stats": stats,
        "footprint_km2": round(footprint_km2, 1),
        "network_MB": ledger.network_mb(),
        "ledger_totals": ledger.totals(),
        "story": preset.story_id,
    }
    size = _write_json(public_data / f"provenance-earthquake-{preset.key}.json", provenance, 2)
    close_all()
    return {"story": story, "stats": stats, "footprint_km2": footprint_km2,
            "frame_bytes": frame_bytes, "provenance_bytes": size,
            "network_MB": provenance["network_MB"]}
