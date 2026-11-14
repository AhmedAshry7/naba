"""Exports merge per preset: exporting one preset must never drop another preset's outputs."""
import json

from naba_data.config import get_preset
from naba_data.export import (_fresh_frames_dir, merge_changes, merge_features, merge_layers,
                              merge_provenance, run_samples_only)

MANZALA, PLASKETT = get_preset("manzala"), get_preset("plaskett")


def _story(story_id, sample=False):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]},
            "properties": {"id": story_id, "is_sample": sample}}


def _write(path, obj):
    path.write_text(json.dumps(obj), encoding="utf-8")


def _ids(fc):
    return [f["properties"]["id"] for f in fc["features"]]


def test_a_fire_export_keeps_the_wetland_stories(tmp_path):
    _write(tmp_path / "changes.geojson", {"type": "FeatureCollection", "features": [
        _story("manzala-flooded-vegetation"), _story("plaskett-burn-scar")]})
    out = merge_changes(tmp_path, PLASKETT, [_story("plaskett-burn-scar")], with_samples=False)
    assert sorted(_ids(out)) == ["manzala-flooded-vegetation", "plaskett-burn-scar"]


def test_a_wetland_export_replaces_only_its_own_stories(tmp_path):
    _write(tmp_path / "changes.geojson", {"type": "FeatureCollection", "features": [
        _story("manzala-open-water"), _story("manzala-flooded-vegetation"),
        _story("plaskett-burn-scar")]})
    out = merge_changes(tmp_path, MANZALA, [_story("manzala-flooded-vegetation")],
                        with_samples=False)
    # manzala-open-water was not produced this time, so it is gone; the fire story stays
    assert sorted(_ids(out)) == ["manzala-flooded-vegetation", "plaskett-burn-scar"]


def test_samples_are_added_only_when_asked_and_superseded_ones_stay_out(tmp_path):
    _write(tmp_path / "sample-stories.json", {"type": "FeatureCollection", "features": [
        _story("manzala-lagoon", sample=True), _story("somewhere-else", sample=True)]})
    _write(tmp_path / "changes.geojson", {"type": "FeatureCollection", "features": [
        _story("manzala-flooded-vegetation")]})
    # exporting the fire must still honour manzala's `supersedes`, because manzala's story is kept
    out = merge_changes(tmp_path, PLASKETT, [_story("plaskett-burn-scar")], with_samples=True)
    assert sorted(_ids(out)) == ["manzala-flooded-vegetation", "plaskett-burn-scar",
                                 "somewhere-else"]
    assert _ids(merge_changes(tmp_path, PLASKETT, [], with_samples=False)) == [
        "manzala-flooded-vegetation"]


def test_extent_features_are_replaced_per_preset_and_legacy_ones_count_as_manzala(tmp_path):
    path = tmp_path / "wetlands.geojson"
    _write(path, {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"class": "open_water"}},   # legacy
        {"type": "Feature", "geometry": None, "properties": {"preset": "okavango",
                                                             "class": "open_water"}}]})
    new = [{"type": "Feature", "geometry": None, "properties": {"preset": "manzala",
                                                                "class": "flooded_vegetation"}}]
    out = merge_features(path, "manzala", new)
    assert [f["properties"].get("preset") for f in out["features"]] == ["okavango", "manzala"]


def test_layers_are_replaced_per_preset(tmp_path):
    _write(tmp_path / "layers.json", {"layers": [
        {"id": "wetland-classes", "frames": []},                                       # legacy
        {"id": "plaskett-burn", "preset": "plaskett", "frames": []}]})
    out = merge_layers(tmp_path, "plaskett", [{"id": "plaskett-false-colour",
                                               "preset": "plaskett"}])
    assert [l["id"] for l in out["layers"]] == ["wetland-classes", "plaskett-false-colour"]


def test_provenance_keeps_one_block_per_preset_and_migrates_the_old_layout(tmp_path):
    _write(tmp_path / "provenance.json", {"exported_at": "x", "exporter": "y",
                                          "preset": {"key": "manzala"}, "stories": ["a"]})
    block = {"exported_at": "t", "exporter": "naba_data", "preset": {"key": "plaskett"}}
    out = merge_provenance(tmp_path, "plaskett", block)
    assert set(out["presets"]) == {"manzala", "plaskett"}
    assert out["presets"]["manzala"]["stories"] == ["a"]
    _write(tmp_path / "provenance.json", out)
    again = merge_provenance(tmp_path, "manzala", {**block, "preset": {"key": "manzala"}})
    assert set(again["presets"]) == {"manzala", "plaskett"}


def test_frames_are_cleared_only_for_the_exported_preset(tmp_path):
    frames = tmp_path / "frames"
    (frames / "plaskett").mkdir(parents=True)
    (frames / "plaskett" / "burn_2026-10-03.png").write_bytes(b"x")
    (frames / "wetland_2026-06.png").write_bytes(b"x")             # old flat layout (manzala)
    (frames / "manzala").mkdir()
    (frames / "manzala" / "wetland_2026-07.png").write_bytes(b"x")

    _fresh_frames_dir(tmp_path, PLASKETT)
    assert not any((frames / "plaskett").iterdir())
    assert (frames / "wetland_2026-06.png").exists()                # not plaskett's to delete
    assert (frames / "manzala" / "wetland_2026-07.png").exists()

    _fresh_frames_dir(tmp_path, MANZALA)
    assert not (frames / "wetland_2026-06.png").exists()
    assert not any((frames / "manzala").iterdir())


def test_samples_only_keeps_every_real_story(tmp_path):
    _write(tmp_path / "sample-stories.json", {"type": "FeatureCollection", "features": [
        _story("manzala-lagoon", sample=True), _story("elsewhere", sample=True)]})
    _write(tmp_path / "changes.geojson", {"type": "FeatureCollection", "features": [
        _story("manzala-flooded-vegetation"), _story("plaskett-burn-scar")]})
    res = run_samples_only(PLASKETT, tmp_path)
    assert res == {"real": 2, "samples": 1, "bytes": res["bytes"]}
