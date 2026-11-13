"""A story must match the ChangeStory contract the frontend compiles against."""
import json
import re
from pathlib import Path

import pandas as pd
import pytest

from naba_data.config import FLOODED_VEG, OPEN_WATER, get_preset
from naba_data.stories import build_story, direction_of, trend_per_month

TYPES_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types.ts"


def _indicators(values, start="2026-06-19", step=12):
    dates = pd.to_datetime([pd.Timestamp(start) + pd.Timedelta(days=step * i)
                            for i in range(len(values))])
    return pd.DataFrame(dict(label=[str(d.date()) for d in dates], date=dates,
                             HH_median=[-12.0] * len(values), HV_median=[-20.0] * len(values),
                             open_water_pct=values, flooded_veg_pct=[v / 2 for v in values],
                             other_pct=[100 - v for v in values],
                             coverage_pct=[95.0] * len(values)))


def test_rising_series_reads_as_upward_and_quotes_the_last_value():
    ts = _indicators([10.0, 12.0, 14.0, 16.0, 18.0, 20.0])
    story = build_story(get_preset("manzala"), OPEN_WATER, ts, 42.0, lat=31.3, lon=32.05)
    assert story["metric"]["direction"] == "upward"
    assert story["metric"]["value"] == pytest.approx(20.0)
    assert story["series"][-1]["value"] == pytest.approx(20.0)
    assert story["passes"] == 6
    # 6 passes, 12 days apart, starting 19 Jun -> last is 18 Aug
    assert story["period"] == {"start": "2026-06-19", "end": "2026-08-18"}
    assert story["period"]["start"] == story["series"][0]["date"]
    assert story["period"]["end"] == story["series"][-1]["date"]
    assert "spreading" in story["headline"]


def test_flat_series_reads_as_steady():
    ts = _indicators([10.0, 10.1, 9.9, 10.0])
    story = build_story(get_preset("manzala"), OPEN_WATER, ts, 42.0, lat=31.3, lon=32.05)
    assert story["metric"]["direction"] == "steady"
    assert "holding steady" in story["headline"]


def test_real_stories_are_never_flagged_as_sample_or_ai_written():
    ts = _indicators([10.0, 12.0, 14.0, 16.0, 18.0, 20.0])
    for class_value in (OPEN_WATER, FLOODED_VEG):
        story = build_story(get_preset("manzala"), class_value, ts, 42.0, lat=31.3, lon=32.05)
        assert story["is_sample"] is False
        assert story["explanation_ai_generated"] is False
        assert story["confidence"] in ("low", "moderate")        # never "high": thresholds are exploratory
        assert "not a validated flood map" in story["confidence_note"]


def test_confidence_drops_when_there_are_few_passes_or_poor_coverage():
    few = _indicators([10.0, 12.0, 14.0])
    assert build_story(get_preset("manzala"), OPEN_WATER, few, 42.0, 31.3, 32.05)["confidence"] == "low"
    patchy = _indicators([10.0, 12.0, 14.0, 16.0, 18.0, 20.0])
    patchy["coverage_pct"] = 40.0
    assert build_story(get_preset("manzala"), OPEN_WATER, patchy, 42.0, 31.3,
                       32.05)["confidence"] == "low"


def test_story_has_exactly_the_fields_the_frontend_expects():
    """Parsed straight out of src/types.ts, so a UI field rename fails here."""
    src = TYPES_TS.read_text()
    block = re.search(r"export interface ChangeStory \{(.*?)\n\}", src, re.S).group(1)
    # optional fields (`name?:`) belong to some themes only, e.g. `event_date` on earthquakes
    expected = {m.group(1) for m in re.finditer(r"^\s{2}(\w+):", block, re.M)}
    expected.discard("geometry")        # the loader attaches it from the GeoJSON feature
    ts = _indicators([10.0, 12.0, 14.0, 16.0, 18.0, 20.0])
    story = build_story(get_preset("manzala"), OPEN_WATER, ts, 42.0, lat=31.3, lon=32.05)
    assert set(story) == expected
    json.dumps(story)                   # must be JSON-serializable as-is


def test_trend_is_percentage_points_per_month():
    ts = _indicators([0.0, 1.0, 2.0, 3.0], step=30)
    assert trend_per_month(ts["date"], ts["open_water_pct"]) == pytest.approx(1.0, abs=0.01)
    assert direction_of(0.0) == "steady"
    assert direction_of(-5.0) == "downward"
