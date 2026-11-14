"""run_fire_export end to end on synthetic passes: no network, every file written, nothing crashes."""
import json

import numpy as np
import pandas as pd
import xarray as xr

from naba_data import export, fires
from naba_data.config import get_preset

PLASKETT = get_preset("plaskett")
DATES = ["2026-08-16", "2026-08-28", "2026-10-03"]


def _da(values):
    west, south, east, north = PLASKETT.bbox
    h, w = values.shape
    lats = north - (north - south) / h * (np.arange(h) + 0.5)
    lons = west + (east - west) / w * (np.arange(w) + 0.5)
    return xr.DataArray(values.astype("float32"), coords={"lat": lats, "lon": lons},
                        dims=("lat", "lon"))


def test_fire_export_writes_every_pass_and_keeps_other_presets(tmp_path, monkeypatch):
    acq = pd.DataFrame(dict(date=pd.to_datetime(DATES), track=42, direction="DSC", frame=70,
                            name=[f"g{i}" for i in range(3)], pol_code="DHDH"))
    monkeypatch.setattr(fires, "select_fire_acquisitions",
                        lambda preset, maturity: (acq, acq.iloc[0], acq.iloc[2]))
    shape = (120, 150)
    hv = {d: np.full(shape, 0.05) for d in DATES}
    hv["2026-08-28"][20:50, 20:50] = 0.005                  # a burn that grows
    hv["2026-10-03"][20:90, 20:110] = 0.005
    monkeypatch.setattr(fires, "load_linear_series", lambda *a, **k: (
        {d: _da(np.full(shape, 0.2)) for d in DATES}, {d: _da(v) for d, v in hv.items()}, []))
    (tmp_path / "changes.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None,
         "properties": {"id": "manzala-flooded-vegetation", "is_sample": False}}]}))

    res = export.run_fire_export(PLASKETT, public_data=tmp_path, with_samples=False,
                                 res_deg=0.002, min_area_km2=0.0, majority=0)

    assert res["stories"] == 1 and res["lines"]
    ids = [f["properties"]["id"] for f in
           json.loads((tmp_path / "changes.geojson").read_text())["features"]]
    assert sorted(ids) == ["manzala-flooded-vegetation", "plaskett-burn-scar"]
    feats = json.loads((tmp_path / "fires.geojson").read_text())["features"]
    assert {f["properties"]["date"] for f in feats} == {"2026-08-28", "2026-10-03"}
    assert all(f["properties"]["headline"] == (f["properties"]["date"] == "2026-10-03")
               for f in feats)
    layers = json.loads((tmp_path / "layers.json").read_text())["layers"]
    assert [len(l["frames"]) for l in layers] == [3, 3]
    assert len(list((tmp_path / "frames" / "plaskett").iterdir())) == 6
    prov = json.loads((tmp_path / "provenance.json").read_text())["presets"]["plaskett"]
    assert set(prov["passes"]) == set(DATES)
