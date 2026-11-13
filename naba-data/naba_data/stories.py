"""Measured indicators to Naba news stories.

Every sentence here is generated from a number this pipeline computed, or from the stated method.
No language model is involved, so `explanation_ai_generated` is false and the text is reproducible:
same input data, same words.

The output shape is the `ChangeStory` contract in `frontend/src/types.ts`.
"""
from __future__ import annotations

import datetime as dt
import logging

import numpy as np
import pandas as pd

from .config import (CLASS_SLUGS, FLOODED_VEG, OPEN_WATER, Preset, WETLAND_THRESHOLDS)

log = logging.getLogger("naba_data")

TREND_DEAD_BAND = 0.2          # percentage points per month treated as "steady"
CONFIDENCE_NOTE = ("Exploratory dB thresholds on L-band backscatter, not a validated flood map")

CLASS_FIELD = {OPEN_WATER: "open_water_pct", FLOODED_VEG: "flooded_veg_pct"}
CLASS_LABEL = {OPEN_WATER: "Open water", FLOODED_VEG: "Flooded vegetation"}
CLASS_UNIT = {OPEN_WATER: "% of area under open water",
              FLOODED_VEG: "% of area flooded vegetation"}
CHANGE_TYPE = {OPEN_WATER: "water", FLOODED_VEG: "vegetation"}


def _fmt_date(iso: str) -> str:
    d = dt.date.fromisoformat(str(iso)[:10])
    return f"{d.day} {d:%B %Y}"      # platform-independent (no %-d)


def trend_per_month(dates: pd.Series, values: pd.Series) -> float:
    """Least-squares slope in percentage points per 30 days."""
    if len(values) < 2:
        return 0.0
    days = (pd.to_datetime(dates) - pd.to_datetime(dates).iloc[0]).dt.days.to_numpy(dtype="float64")
    if np.ptp(days) == 0:
        return 0.0
    slope = float(np.polyfit(days, np.asarray(values, dtype="float64"), 1)[0])
    return slope * 30.0


def direction_of(slope: float) -> str:
    if abs(slope) < TREND_DEAD_BAND:
        return "steady"
    return "upward" if slope > 0 else "downward"


def _headline(preset: Preset, class_value: int, direction: str) -> str:
    region = preset.region
    if class_value == OPEN_WATER:
        return {"upward": f"Open water is spreading across {region}",
                "downward": f"Open water is shrinking across {region}",
                "steady": f"Open water is holding steady across {region}"}[direction]
    return {"upward": f"Flooding under marsh vegetation is spreading at {region}",
            "downward": f"Flooding under marsh vegetation is receding at {region}",
            "steady": f"Flooding under marsh vegetation is holding steady at {region}"}[direction]


def _physics_sentence(class_value: int) -> str:
    if class_value == OPEN_WATER:
        return ("Open water looks dark to radar: a smooth surface reflects the signal away from "
                "the satellite instead of back to it.")
    return ("Flooded vegetation looks very bright to radar: water and plant stems form a corner "
            "that bounces the signal straight back, while the cross-polarised signal stays weak.")


def _threshold_sentence(class_value: int) -> str:
    th = WETLAND_THRESHOLDS
    if class_value == OPEN_WATER:
        return (f"Pixels darker than {th['water_hh_max']:.0f} dB in HH and "
                f"{th['water_hv_max']:.0f} dB in HV are counted as open water.")
    return (f"Pixels brighter than {th['flooded_hh_min']:.0f} dB in HH whose HH is more than "
            f"{th['flooded_ratio_min']:.0f} dB above their HV are counted as flooded vegetation.")


def _summary(class_value: int, first, last, direction: str) -> str:
    noun = "open water" if class_value == OPEN_WATER else "flooded vegetation"
    if direction == "steady":
        tail = (f"close to the {first['value']:.1f}% measured on {_fmt_date(first['date'])}, so it "
                f"has not moved much over the period")
    else:
        more_or_less = "more" if direction == "upward" else "less"
        tail = (f"{more_or_less} than the {first['value']:.1f}% measured on "
                f"{_fmt_date(first['date'])}")
    return (f"Radar measured {last['value']:.1f}% of the analysed area as {noun} on "
            f"{_fmt_date(last['date'])}. That is {tail}. {_physics_sentence(class_value)}")


def _explanation(preset: Preset, class_value: int, ts: pd.DataFrame, field: str,
                 slope: float, direction: str, passes: int, area_km2: float,
                 geometry_label: str) -> str:
    noun = "open water" if class_value == OPEN_WATER else "flooded vegetation"
    first, last = ts.iloc[0], ts.iloc[-1]
    lo, hi = ts.loc[ts[field].idxmin()], ts.loc[ts[field].idxmax()]
    change = last[field] - first[field]
    move = {"upward": "grew", "downward": "shrank", "steady": "stayed level"}[direction]

    p1 = (f"NISAR passed over {preset.region} {passes} times between {_fmt_date(first['date'])} "
          f"and {_fmt_date(last['date'])}, all from the same track and look direction so the "
          f"measurements can be compared. Each pass records two polarisations, HH and HV. "
          f"{_physics_sentence(class_value)} {_threshold_sentence(class_value)}")

    p2 = (f"Across those passes the share of the analysed area classed as {noun} {move} from "
          f"{first[field]:.1f}% to {last[field]:.1f}%"
          + (f", a change of {change:+.1f} percentage points" if direction != "steady" else "")
          + f". The lowest reading was {lo[field]:.1f}% on {_fmt_date(lo['date'])} and the highest "
          f"{hi[field]:.1f}% on {_fmt_date(hi['date'])}"
          + (f", a trend of about {slope:+.1f} percentage points per month."
             if direction != "steady" else ". No clear trend stands out.")
          + f" {geometry_label} covers about {area_km2:.0f} km².")

    p3 = ("What this does not say: these are threshold rules on radar brightness, not a verified "
          "flood map. Wind roughening the water surface, wet soil after rain and a different look "
          "angle can all move the same numbers. Short, sharp changes between two passes are more "
          "likely to be weather or geometry than real change on the ground.")

    p4 = f"Why it matters: {preset.why_it_matters} {preset.next_step}"
    return "\n\n".join([p1, p2, p3, p4])


def build_story(preset: Preset, class_value: int, ts: pd.DataFrame, envelope_area_km2: float,
                lat: float, lon: float, published: str | None = None) -> dict:
    """One ChangeStory dict (without geometry, which the exporter attaches as the Feature)."""
    field = CLASS_FIELD[class_value]
    series = [dict(date=str(pd.Timestamp(r.date).date()), value=round(float(getattr(r, field)), 2))
              for r in ts.itertuples()]
    first, last = series[0], series[-1]
    slope = trend_per_month(ts["date"], ts[field])
    direction = direction_of(slope)
    passes = len(ts)
    coverage = float(ts["coverage_pct"].median())
    confidence = "moderate" if passes >= 6 and coverage >= 80 else "low"
    geometry_label = ("The outline on the map is every part of the area that was open water in at "
                      "least one month, and it" if class_value == OPEN_WATER else
                      "The outline on the map is every part of the area that was flooded "
                      "vegetation in at least one month, and it")

    return dict(
        id=preset.story_ids[CLASS_SLUGS[class_value]],
        headline=_headline(preset, class_value, direction),
        region=preset.region,
        subtitle=preset.subtitle,
        lat=round(float(lat), 4),
        lon=round(float(lon), 4),
        change_class="water",
        change_type=CHANGE_TYPE[class_value],
        metric=dict(label=CLASS_LABEL[class_value], value=round(float(last["value"]), 1),
                    unit=CLASS_UNIT[class_value], direction=direction),
        period=dict(start=first["date"], end=last["date"]),
        passes=passes,
        area_km2=round(float(envelope_area_km2), 1),
        confidence=confidence,
        confidence_note=CONFIDENCE_NOTE,
        summary=_summary(class_value, first, last, direction),
        causes=list(preset.causes_water if class_value == OPEN_WATER else preset.causes_flooded),
        why_it_matters=preset.why_it_matters,
        next_step=preset.next_step,
        series=series,
        explanation=_explanation(preset, class_value, ts, field, slope, direction, passes,
                                 envelope_area_km2, geometry_label),
        explanation_ai_generated=False,
        published=published or dt.date.today().isoformat(),
        is_sample=False,
    )


# ---------------------------------------------------------------- fire stories
FIRE_CONFIDENCE_NOTE = ("Exploratory thresholds on the drop in L-band cross-polarised radar, not a "
                        "validated burn map")


def _fire_physics_sentence(preset: Preset) -> str:
    return (f"Healthy vegetation returns a strong cross-polarised (HV) radar signal from "
            f"{preset.fire_vegetation}; when fire removes them, the signal drops by several "
            f"decibels.")


def _fire_threshold_sentence(th: dict) -> str:
    return (f"Pixels whose HV fell by more than {-th['likely_db']:.0f} dB are counted as likely "
            f"burned, and by {-th['possible_db']:.0f}–{-th['likely_db']:.0f} dB as possibly burned.")


def _km2(v: float) -> str:
    return f"{v:.0f} km²" if v >= 10 else f"{v:.1f} km²"


def _reported_sentence(preset: Preset, likely: float, burned: float) -> str:
    if not preset.reported_area_km2:
        return ""
    rep = preset.reported_area_km2
    note = f" ({preset.reported_note})" if preset.reported_note else ""
    src = f" Source: {preset.reported_source}." if preset.reported_source else ""
    return (f"Fire reports put the fire at about {_km2(rep)}{note}. The radar's likely-burned area "
            f"is {100 * likely / rep:.0f}% of that, and {100 * burned / rep:.0f}% with the possibly "
            f"burned pixels added. A reported fire area is the whole perimeter: it includes unburned "
            f"islands and ground fire under a canopy that survived, where the radar signal barely "
            f"changes, so the radar is expected to flag less than the reported area.{src}")


def build_fire_story(preset: Preset, ind: pd.DataFrame, pre_label: str, post_label: str,
                     outline_area_km2: float, lat: float, lon: float,
                     published: str | None = None, th: dict | None = None) -> dict:
    """One fire ChangeStory dict (without geometry, which the exporter attaches as the Feature).

    `ind` is `fires.burn_indicators`' table; `pre_label` the before pass every other pass is
    compared with; `post_label` the first pass after the event window, which gives the headline.
    """
    from .config import BURN_THRESHOLDS

    th = th or BURN_THRESHOLDS
    ind = ind.sort_values("date").reset_index(drop=True)
    by = ind.set_index("label")
    post, pre = by.loc[post_label], by.loc[pre_label]
    likely, possible = float(post["likely_km2"]), float(post["possible_km2"])
    burned = likely + possible
    series = [dict(date=r.label, value=round(float(r.likely_km2), 2)) for r in ind.itertuples()]
    passes = len(ind)
    confidence = "moderate" if passes >= 2 and float(post["coverage_pct"]) >= 80 else "low"
    pre_d, post_d = _fmt_date(pre_label), _fmt_date(post_label)

    summary = (f"Comparing NISAR's radar pass on {post_d} with {pre_d}, before the fire, about "
               f"{_km2(likely)} lost so much cross-polarised signal that it is likely burned, and "
               f"another {_km2(possible)} is possibly burned. {_fire_physics_sentence(preset)}")

    during = ind[ind["role"] == "during"]
    p1 = (f"NISAR passed over {preset.region} {passes} times between {pre_d} and "
          f"{_fmt_date(ind['label'].iloc[-1])}, all from the same track and look direction so the "
          f"passes can be compared. Each pass was compared with {pre_d}, the last pass before "
          f"the fire started. {_fire_physics_sentence(preset)} Before comparing, the radar brightness "
          f"was averaged over about 100 m to reduce speckle. {_fire_threshold_sentence(th)}")

    if len(during):
        parts = [f"{_km2(r.likely_km2)} on {_fmt_date(r.label)}" for r in during.itertuples()]
        steps = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
        p2 = (f"While the fire was burning, the likely-burned area read {steps}. On {post_d}, the "
              f"first pass after the fire period, it was {_km2(likely)}, with {_km2(possible)} more "
              f"possibly burned.")
    else:
        p2 = (f"On {post_d}, the first pass after the fire period, the likely-burned area was "
              f"{_km2(likely)}, with {_km2(possible)} more possibly burned.")
    later = ind[ind["date"] > pd.Timestamp(post_label)]
    if len(later):
        last = later.iloc[-1]
        later_km2 = float(last["likely_km2"])
        if later_km2 > 1.15 * likely:
            trend = ("so the area kept growing after the fire period. That can mean the fire was "
                     "still spreading at its edges, or that scorched vegetation kept drying out and "
                     "losing its leaves")
        elif later_km2 >= 0.7 * likely:
            trend = "so the drop persists after the fire"
        else:
            trend = ("so the drop partly fades after the fire, which can happen when rain wets the "
                     "ground or vegetation starts to recover")
        p2 += f" The last pass, on {_fmt_date(last['label'])}, read {_km2(later_km2)}, {trend}."
    p2 += (f" On the map, the burned patches are filled in two colours, likely and possibly burned; "
           f"together they cover about {outline_area_km2:.0f} km². The story outline is drawn around "
           f"them.")

    p3 = _reported_sentence(preset, likely, burned)

    p4 = ("What this does not say: these are threshold rules on radar brightness, not a verified "
          "burn-severity map. Drying vegetation, a change in soil moisture after rain and wind in "
          "the vegetation can also lower the signal."
          + (f" {preset.fire_caveat}" if preset.fire_caveat else "")
          + " Treat the outline as where to look first, not as the official burn scar.")

    p5 = f"Why it matters: {preset.why_it_matters} {preset.next_step}"

    return dict(
        id=preset.story_ids["burn_scar"],
        headline=f"Radar maps a burn scar of about {_km2(likely)} in {preset.region}",
        region=preset.region,
        subtitle=preset.subtitle,
        lat=round(float(lat), 4),
        lon=round(float(lon), 4),
        change_class="significant",
        change_type="fire",
        metric=dict(label="Likely burned area", value=round(likely, 1),
                    unit="km² likely burned", direction="upward"),
        period=dict(start=series[0]["date"], end=series[-1]["date"]),
        passes=passes,
        area_km2=round(float(outline_area_km2), 1),
        confidence=confidence,
        confidence_note=FIRE_CONFIDENCE_NOTE,
        summary=summary,
        causes=list(preset.causes),
        why_it_matters=preset.why_it_matters,
        next_step=preset.next_step,
        series=series,
        explanation="\n\n".join(p for p in (p1, p2, p3, p4, p5) if p),
        explanation_ai_generated=False,
        published=published or dt.date.today().isoformat(),
        is_sample=False,
    )
