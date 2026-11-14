"""Convert the NABA web app's stories into one file + images the Quest app can load.

Input : frontend/public/data of the naba web app:
          changes.geojson                    the stories (every field shown in the panel)
          fires.geojson                      fire stories' slider: burned areas per radar pass
          wetlands.geojson                   flood / water stories' slider: water classes per month
          provenance-earthquake-panama.json  the earthquake's slider: passes, mainshock, aftershocks, motion
Output: <unity project>/Assets/Globe/Resources/Stories/stories.json
        <unity project>/Assets/Globe/Resources/Stories/basemaps/<story id>.png        detailed local map (make_detail_maps.py)
        <unity project>/Assets/Globe/Resources/Stories/highlights/<story id>/*.png    the story's area per time step (make_highlights.py)
Usage : python make_story_data.py [--data <web data folder>]

Every story field shown in the headset comes from changes.geojson: headline, region, subtitle, lat/lon, metric,
period, passes, area, series, confidence, summary, causes, why it matters, next step, explanation and the zone
geometry. Re-run it whenever changes.geojson changes.
"""
import argparse
import json
import shutil
from pathlib import Path

from paths import RESOURCES, WEB_DATA
import web_text

OUT = RESOURCES / "Stories"

# The web app colours stories by theme (frontend/src/lib.ts THEME_META), not by severity.
THEME = {
    "earthquake": ("Earthquake", "EARTHQUAKE", "#3DD68C"),
    "flood": ("Flooding (water rising)", "FLOODING", "#00CED1"),
    "water": ("Water shrinking", "WATER SHRINKING", "#4AA8FF"),
    "fire": ("Forest fire", "FOREST FIRE", "#F0484D"),
}


def theme_of(p):
    """frontend/src/lib.ts themeOf."""
    if p.get("change_type") == "earthquake":
        return "earthquake"
    if p.get("change_type") == "fire":
        return "fire"
    return "flood" if (p.get("metric") or {}).get("direction") == "upward" else "water"


def bbox_of(geom):
    """[minLon, minLat, maxLon, maxLat] of a (Multi)Polygon."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    xs = [pt[0] for poly in polys for ring in poly for pt in ring]
    ys = [pt[1] for poly in polys for ring in poly for pt in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def story_from(feature):
    p = feature["properties"]
    metric = p.get("metric") or {}
    period = p.get("period") or {}
    theme = theme_of(p)
    theme_label, theme_chip, theme_color = THEME[theme]
    return {
        "id": p["id"],
        "headline": p.get("headline", ""),
        "region": p.get("region", ""),
        "subtitle": p.get("subtitle", ""),
        "lat": float(p.get("lat", 0)),
        "lon": float(p.get("lon", 0)),
        "changeClass": p.get("change_class", ""),
        "changeType": p.get("change_type", ""),
        "category": "fire" if theme == "fire" else ("earthquake" if theme == "earthquake" else "water"),
        "kindLabel": theme_chip,
        "theme": theme,
        "themeLabel": theme_label,
        "themeColor": theme_color,
        "metricLabel": metric.get("label", ""),
        "metricValue": float(metric.get("value", 0) or 0),
        "metricUnit": metric.get("unit", ""),
        "metricDirection": metric.get("direction", ""),
        "periodStart": period.get("start", ""),
        "periodEnd": period.get("end", ""),
        "passes": int(p.get("passes", 0) or 0),
        "areaKm2": float(p.get("area_km2", 0) or 0),
        "confidence": p.get("confidence", ""),
        "confidenceNote": p.get("confidence_note", ""),
        "summary": p.get("summary", ""),
        "causes": list(p.get("causes", [])),
        "whyItMatters": p.get("why_it_matters", ""),
        "nextStep": p.get("next_step", ""),
        "explanation": p.get("explanation", ""),
        "aiGenerated": bool(p.get("explanation_ai_generated", False)),
        "eventDate": p.get("event_date", "") or "",
        "published": p.get("published", ""),
        "isSample": bool(p.get("is_sample", False)),
        "series": [{"date": s["date"], "value": float(s["value"])} for s in p.get("series", [])],
        # the web panel's text (frontend/src/lib.ts describeStory / metricLine)
        "paragraphs": web_text.describe_story(p),
        "metricLine": web_text.metric_line(p),
        "observedLabel": f"{web_text.format_date_short(period['start'])} – {web_text.format_date_short(period['end'])}" if period else "",
        "areaLabel": f"{web_text.js_num(p.get('area_km2', 0))} km²",
        "bbox": bbox_of(feature["geometry"]) if feature.get("geometry") else [],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(WEB_DATA), help="folder containing changes.geojson")
    args = ap.parse_args()
    changes = Path(args.data) / "changes.geojson"
    features = json.loads(changes.read_text(encoding="utf-8"))["features"]
    features = [f for f in features if not f["properties"].get("is_sample")]

    OUT.mkdir(parents=True, exist_ok=True)
    for old in ("frames", "highlights"):  # radar frames are no longer used; highlights are rebuilt
        if (OUT / old).exists():
            shutil.rmtree(OUT / old)
        meta = OUT / f"{old}.meta"
        if meta.exists():
            meta.unlink()

    stories = [story_from(f) for f in features]
    geometry = {f["properties"]["id"]: f["geometry"] for f in features}
    data = Path(args.data)

    def optional(name, key=None):
        path = data / name
        if not path.exists():
            print(f"(no {name}: that slider falls back to the story's series)")
            return None
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc[key] if key else doc

    fires = optional("fires.geojson", "features")
    wetlands = optional("wetlands.geojson", "features")
    quake = optional("provenance-earthquake-panama.json")

    from make_detail_maps import add_basemaps
    from make_highlights import add_highlights
    add_basemaps(stories)
    add_highlights(stories, geometry, fires, wetlands, quake)

    (OUT / "stories.json").write_text(json.dumps({"stories": stories}, ensure_ascii=False, indent=1), encoding="utf-8")
    for s in stories:
        h = s.get("highlights", {})
        print(f"{s['id']:32s} {s['theme']:10s} steps={len(h.get('frames', []))}")
    print("stories:", len(stories), "from", changes)


if __name__ == "__main__":
    main()
