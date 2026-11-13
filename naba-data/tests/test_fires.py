"""The fire method must keep matching notebook Section 12: same pair choice, same thresholds."""
import numpy as np
import pandas as pd
import pytest
import xarray as xr

from naba_data.config import (BURN_LIKELY, BURN_NO_DATA, BURN_POSSIBLE, BURN_THRESHOLDS, UNBURNED,
                              get_preset)
from naba_data.fires import (boxcar, burn_classes, burn_indicators, delta_db, dualpol_rgb,
                             event_role, pick_pre_post, same_geometry_as)

PLASKETT = get_preset("plaskett")


def _acq(rows):
    """rows: (date, track, direction, frame)."""
    df = pd.DataFrame([dict(date=pd.Timestamp(d), track=t, direction=dr, frame=f,
                            name=f"g_{d}_{t}") for d, t, dr, f in rows])
    return df.sort_values("date").reset_index(drop=True)


def test_pair_is_from_one_geometry_with_the_shortest_gap():
    df = _acq([("2026-08-16", 42, "DSC", 70), ("2026-08-22", 135, "ASC", 20),
               ("2026-08-28", 42, "DSC", 70),                      # during the event
               ("2026-10-03", 42, "DSC", 70), ("2026-10-09", 135, "ASC", 20)])
    pre, post = pick_pre_post(df, "2026-08-26", "2026-09-30")
    # 42 D: 16 Aug -> 3 Oct = 48 days; 135 A: 22 Aug -> 9 Oct = 48 days. Equal gaps keep the first.
    assert (pre["track"], post["track"]) in ((42, 42), (135, 135))
    assert pre["track"] == post["track"] and pre["frame"] == post["frame"]
    assert pre["date"] < pd.Timestamp("2026-08-26") < pd.Timestamp("2026-09-30") < post["date"]


def test_pair_prefers_the_geometry_with_the_shorter_gap():
    df = _acq([("2026-08-10", 135, "ASC", 20), ("2026-08-16", 42, "DSC", 70),
               ("2026-10-03", 42, "DSC", 70), ("2026-10-21", 135, "ASC", 20)])
    pre, post = pick_pre_post(df, "2026-08-26", "2026-09-30")
    assert (str(pre["date"].date()), str(post["date"].date())) == ("2026-08-16", "2026-10-03")


def test_no_pair_when_one_side_of_the_event_is_empty():
    df = _acq([("2026-10-03", 42, "DSC", 70), ("2026-10-15", 42, "DSC", 70)])
    assert pick_pre_post(df, "2026-08-26", "2026-09-30") == (None, None)


def test_mixed_geometries_fall_back_to_nearest_dates():
    df = _acq([("2026-08-16", 42, "DSC", 70), ("2026-10-09", 135, "ASC", 20)])
    pre, post = pick_pre_post(df, "2026-08-26", "2026-09-30")
    assert pre["track"] == 42 and post["track"] == 135


def test_same_geometry_filter():
    df = _acq([("2026-08-16", 42, "DSC", 70), ("2026-08-22", 135, "ASC", 20),
               ("2026-08-28", 42, "DSC", 70)])
    assert len(same_geometry_as(df, df.iloc[0])) == 2


def test_event_roles():
    assert event_role("2026-08-16", PLASKETT) == "before"
    assert event_role("2026-08-26", PLASKETT) == "during"
    assert event_role("2026-09-30", PLASKETT) == "during"
    assert event_role("2026-10-03", PLASKETT) == "after"


def test_boxcar_ignores_nan_and_keeps_nan_pixels_nan():
    a = np.ones((5, 5), dtype="float32")
    a[2, 2] = np.nan
    a[0, 0] = 3.0
    out = boxcar(a, 3)
    assert np.isnan(out[2, 2])
    assert np.isfinite(out[1, 1]) and out[1, 1] > 1.0     # sees the 3.0 corner, not the NaN
    assert out[4, 4] == pytest.approx(1.0)


def test_boxcar_size_one_is_identity():
    a = np.arange(9, dtype="float32").reshape(3, 3)
    assert np.array_equal(boxcar(a, 1), a)


def test_delta_db_is_after_minus_before():
    before = np.full((4, 4), 0.1, dtype="float32")        # -10 dB
    after = np.full((4, 4), 0.01, dtype="float32")        # -20 dB
    assert np.allclose(delta_db(before, after, smooth_px=1), -10.0)


def test_burn_tiers_match_the_thresholds_at_the_boundaries():
    assert BURN_THRESHOLDS == {"likely_db": -3.0, "possible_db": -2.0}
    d = np.array([[-6.0, -3.01, -3.0, -2.5, -2.01, -2.0, 0.0, 2.0, np.nan]])
    cls = burn_classes(d)[0]
    assert list(cls) == [BURN_LIKELY, BURN_LIKELY, BURN_POSSIBLE, BURN_POSSIBLE, BURN_POSSIBLE,
                         UNBURNED, UNBURNED, UNBURNED, BURN_NO_DATA]


def _da(values):
    h, w = values.shape
    lats = 36.0 - 0.0002 * (np.arange(h) + 0.5)
    lons = -121.5 + 0.0002 * (np.arange(w) + 0.5)
    return xr.DataArray(values.astype("float32"), coords={"lat": lats, "lon": lons},
                        dims=("lat", "lon"))


def test_burned_area_per_pass_grows_against_the_before_pass():
    shape = (60, 60)
    hv_pre = np.full(shape, 0.05)                          # about -13 dB canopy
    hv_mid = hv_pre.copy()
    hv_mid[10:30, 10:30] = 0.005                           # -10 dB drop over 20 x 20 pixels
    hv_post = hv_mid.copy()
    hv_post[10:50, 10:50] = 0.005                          # grows to 40 x 40
    co = _da(np.full(shape, 0.2))
    cx_by = {"2026-08-16": _da(hv_pre), "2026-08-28": _da(hv_mid), "2026-10-03": _da(hv_post)}
    co_by = {k: co for k in cx_by}
    ind, classes = burn_indicators(co_by, cx_by, "2026-08-16", PLASKETT, smooth_px=1)
    assert list(ind["role"]) == ["before", "during", "after"]
    assert ind["likely_km2"].iloc[0] == 0.0
    cell = ind["likely_km2"].iloc[2] / 1600
    assert ind["likely_km2"].iloc[1] == pytest.approx(400 * cell)
    assert cell == pytest.approx(0.0002 * 111.32 * np.cos(np.radians(36.0)) * 0.0002 * 110.57,
                                 rel=0.01)
    assert (classes["2026-10-03"] == BURN_LIKELY).sum() == 1600
    assert ind["coverage_pct"].iloc[2] == pytest.approx(100.0)


def test_false_colour_is_transparent_where_there_is_no_data():
    co = np.array([[0.1, np.nan]], dtype="float32")
    cx = np.array([[0.01, 0.01]], dtype="float32")
    rgb, valid = dualpol_rgb(co, cx)
    assert list(valid[0]) == [True, False]
    assert rgb.shape == (1, 2, 3) and np.all(rgb[0, 1] == 0)
    assert np.all((rgb >= 0) & (rgb <= 1))


# ---------------------------------------------------------------- duplicate granules
FULL = "NISAR_L2_PR_GCOV_026_047_A_014_2005_DHDH_M_20260723T104409_20260723T104440_P05023_N_F_J_001"
PARTIAL = "NISAR_L2_PR_GCOV_026_047_A_014_4005_DHDH_A_20260723T104431_20260723T104440_P05023_N_P_J_001"
V1 = "NISAR_L2_PR_GCOV_029_170_D_076_4005_DHDH_A_20260906T000513_20260906T000547_P05023_N_F_J_001"
V2 = "NISAR_L2_PR_GCOV_029_170_D_076_4005_DHDH_A_20260906T000513_20260906T000547_P05023_N_F_J_002"


def test_names_carry_frame_coverage_and_product_version():
    from naba_data.search import parse_nisar_name

    assert parse_nisar_name(FULL)["frame_coverage"] == "F"
    assert parse_nisar_name(PARTIAL)["frame_coverage"] == "P"
    assert parse_nisar_name(V2)["product_version"] == 2


def test_best_per_date_prefers_full_frames_and_newer_versions():
    from naba_data.search import best_per_date, parse_nisar_name

    rows = []
    for n in (PARTIAL, FULL, V2, V1):        # deliberately in the "wrong" order
        info = parse_nisar_name(n)
        rows.append(dict(name=n, date=info["first_date"], **{k: info[k] for k in (
            "track", "direction", "frame", "frame_coverage", "product_version")}))
    out = best_per_date(pd.DataFrame(rows))
    assert sorted(out["name"]) == sorted([FULL, V2])


def test_everglades_preset_pins_one_geometry_and_has_its_own_wording():
    from naba_data.stories import build_fire_story

    ev = get_preset("everglades")
    assert ev.theme == "fires" and ev.geometry == (170, "DSC", 76)
    ind = pd.DataFrame(dict(label=["2026-07-20", "2026-08-25"], date=pd.to_datetime(
        ["2026-07-20", "2026-08-25"]), role=["before", "after"], likely_km2=[0.0, 20.0],
        possible_km2=[0.0, 8.0], burned_km2=[0.0, 28.0], likely_pct=[0.0, 1.0],
        coverage_pct=[99.0, 99.0], HV_median=[-15.0, -16.0], dHV_median=[0.0, -0.5],
        dCO_median=[0.0, 0.0]))
    story = build_fire_story(ev, ind, "2026-07-20", "2026-08-25", 30.0, lat=25.45, lon=-80.75)
    assert "sawgrass" in story["summary"] and "chaparral" not in story["explanation"]
    assert "standing water" in story["explanation"]
    assert story["id"] == "everglades-burn-scar"
