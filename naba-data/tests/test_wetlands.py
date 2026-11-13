"""The classification rules must keep matching the notebook's thresholds exactly."""
import numpy as np
import pytest

from naba_data.config import FLOODED_VEG, NO_DATA, OPEN_WATER, OTHER, WETLAND_THRESHOLDS
from naba_data.wetlands import class_percentages, db, wetland_classes


def test_db_is_power_to_decibels():
    assert db(np.array([1.0])) == pytest.approx([0.0])
    assert db(np.array([0.1])) == pytest.approx([-10.0])
    assert np.isnan(db(np.array([0.0]))[0])       # non-positive power has no dB value
    assert np.isnan(db(np.array([-0.5]))[0])


def test_open_water_needs_both_polarizations_dark():
    th = WETLAND_THRESHOLDS
    hh = np.array([[th["water_hh_max"] - 1, th["water_hh_max"] - 1]])
    hv = np.array([[th["water_hv_max"] - 1, th["water_hv_max"] + 1]])
    cls = wetland_classes(hh, hv)
    assert cls[0, 0] == OPEN_WATER          # dark in HH and HV
    assert cls[0, 1] == OTHER               # dark in HH only


def test_flooded_vegetation_needs_bright_hh_and_a_big_gap():
    th = WETLAND_THRESHOLDS
    bright = th["flooded_hh_min"] + 1
    hh = np.array([[bright, bright, th["flooded_hh_min"] - 1]])
    hv = np.array([[bright - th["flooded_ratio_min"] - 1,     # big HH-HV gap -> double bounce
                    bright - 1,                              # gap too small
                    bright - th["flooded_ratio_min"] - 1]])   # HH not bright enough
    cls = wetland_classes(hh, hv)
    assert list(cls[0]) == [FLOODED_VEG, OTHER, OTHER]


def test_non_finite_pixels_are_no_data():
    hh = np.array([[np.nan, -20.0]])
    hv = np.array([[-30.0, np.nan]])
    assert list(wetland_classes(hh, hv)[0]) == [NO_DATA, NO_DATA]


def test_flooded_vegetation_wins_over_open_water():
    # The notebook applies the flooded rule after the water rule, so it takes precedence.
    hh = np.array([[-1.0]])
    hv = np.array([[-30.0]])
    assert wetland_classes(hh, hv)[0, 0] == FLOODED_VEG


def test_percentages_use_only_pixels_with_data():
    cls = np.array([[NO_DATA, OPEN_WATER, FLOODED_VEG, OTHER]], dtype="uint8")
    pct = class_percentages(cls)
    assert pct["open_water_pct"] == pytest.approx(100 / 3)
    assert pct["flooded_veg_pct"] == pytest.approx(100 / 3)
    assert pct["coverage_pct"] == pytest.approx(75.0)
