"""Earthquake pipeline: phase -> metres, the story-shape contract, and that the two exporters
do not erase each other's stories."""
import json

import numpy as np
import pytest
import xarray as xr

from naba_data.config import EQ_PRESETS, WAVELENGTH_M
from naba_data.quakes import (build_quake_story, fringe_rgba, los_displacement, los_rgba,
                              merge_into_dataset, summarize_motion)

PRESET = EQ_PRESETS["panama"]


def _layers(phase, coh=0.8, cc=1):
    h, w = phase.shape
    lats = PRESET.bbox[3] - 0.0008 * (np.arange(h) + 0.5)
    lons = PRESET.bbox[0] + 0.0008 * (np.arange(w) + 0.5)
    mk = lambda a: xr.DataArray(np.broadcast_to(a, phase.shape).astype("float32").copy(),
                                coords={"lat": lats, "lon": lons}, dims=("lat", "lon"))
    return {"phase": mk(phase), "coherence": mk(coh), "components": mk(cc)}


def test_one_fringe_is_half_a_wavelength():
    layers = _layers(np.zeros((40, 40)))
    layers["phase"].values[:20] = 2 * np.pi        # one full cycle in the top half
    m = los_displacement(layers, PRESET)
    d = m["disp"]
    assert np.nanmax(d) - np.nanmin(d) == pytest.approx(WAVELENGTH_M / 2, rel=1e-3)


def test_low_coherence_and_unwrapped_zero_are_masked():
    layers = _layers(np.ones((10, 10)))
    layers["coherence"].values[:5] = 0.1
    layers["components"].values[:, :5] = 0
    m = los_displacement(layers, PRESET)
    assert m["valid"].sum() == 25
    assert np.isnan(m["disp"][~m["valid"]]).all()


def test_images_are_transparent_where_there_is_no_data():
    disp = np.array([[np.nan, 0.5], [-0.5, 0.0]])
    assert los_rgba(disp, 1.0)[0, 0, 3] == 0 and los_rgba(disp, 1.0)[0, 1, 3] > 0
    valid = np.isfinite(disp)
    assert fringe_rgba(np.nan_to_num(disp), valid)[0, 0, 3] == 0


def _story():
    layers = _layers(np.linspace(-30, 10, 2500).reshape(50, 50))
    m = los_displacement(layers, PRESET)
    stats = summarize_motion(m, PRESET)
    return build_quake_story(PRESET, stats, "2026-10-02", "2026-10-14", 1234.0, m["reference_note"])


def test_story_has_the_changestory_fields():
    s = _story()
    for key in ("id", "headline", "region", "subtitle", "lat", "lon", "change_class",
                "change_type", "metric", "period", "passes", "area_km2", "confidence",
                "confidence_note", "summary", "causes", "why_it_matters", "next_step", "series",
                "explanation", "explanation_ai_generated", "published", "is_sample"):
        assert key in s, key
    assert s["change_type"] == "earthquake" and s["is_sample"] is False
    assert s["passes"] == 2 and s["series"] == []
    assert s["metric"]["direction"] in ("upward", "downward", "steady")


def test_merge_keeps_other_stories_and_layers(tmp_path):
    (tmp_path / "changes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"id": "wet"}}]}), encoding="utf-8")
    (tmp_path / "layers.json").write_text(json.dumps({"layers": [{"id": "wetland-classes"}]}),
                                          encoding="utf-8")
    feat = {"type": "Feature", "geometry": None, "properties": _story()}
    for _ in range(2):                                   # idempotent: a re-run replaces, never duplicates
        merge_into_dataset(tmp_path, PRESET, feat, {"id": f"earthquake-{PRESET.key}"})
    ids = [f["properties"]["id"] for f in json.loads(
        (tmp_path / "changes.geojson").read_text(encoding="utf-8"))["features"]]
    assert sorted(ids) == sorted(["wet", PRESET.story_id])
    lids = [l["id"] for l in json.loads((tmp_path / "layers.json").read_text(encoding="utf-8"))["layers"]]
    assert sorted(lids) == ["earthquake-panama", "wetland-classes"]
