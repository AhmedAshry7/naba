"""Convert the NABA web app's data into one file + images the Quest app can load.

Input : frontend/public/data of the naba web app   (changes.geojson, sample-stories.json, fires.geojson,
        wetlands.geojson, layers.json, provenance*.json, frames/)
Output: <unity project>/Assets/Globe/Resources/Stories/stories.json
        <unity project>/Assets/Globe/Resources/Stories/frames/<preset>/<name>.png   (radar images, max 1024 px)
        <unity project>/Assets/Globe/Resources/Stories/basemaps/<story id>.png      (detailed local map, see make_detail_maps.py)
Usage : python make_story_data.py [--data <web data folder>] [--include-samples]

Only the real NISAR stories (changes.geojson) are exported; sample-stories.json holds illustrative examples
and is skipped unless --include-samples is given.

Re-run it whenever the web data changes.
"""
import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

from paths import RESOURCES, WEB_DATA

HERE = Path(__file__).resolve().parent
OUT = RESOURCES / "Stories"
MAX_FRAME = 1024

# Badge text for each kind of story (shown at the top of the panel).
KIND = {
    "fire": "FIRE \u00b7 BURN SCAR",
    "water": "WATER-RELATED STORY",
    "earthquake": "EARTHQUAKE",
    "subsidence": "GROUND MOVEMENT",
    "uplift": "GROUND MOVEMENT",
    "moisture": "SOIL MOISTURE",
    "vegetation": "VEGETATION CHANGE",
    "construction": "CONSTRUCTION",
}
CLASS_LABEL = {
    "significant": "Significant change",
    "moderate": "Moderate change",
    "stable": "No significant change",
    "water": "Water-related story",
}
WETLAND_CLASS = {"water": "open_water", "vegetation": "flooded_vegetation"}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fmt_date(d):
    """2026-08-25 -> 25 Aug 2026"""
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    try:
        y, m, dd = d.split("-")
        return f"{int(dd)} {months[int(m) - 1]} {y}"
    except Exception:
        return d


def copy_frame(data, url, preset):
    """'/data/frames/x/y.webp' -> Resources path 'Stories/frames/x/y' (converted to PNG, downscaled)."""
    src = data / url.replace("/data/", "", 1)
    if not src.exists():
        return None
    img = Image.open(src)
    img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
    img.thumbnail((MAX_FRAME, MAX_FRAME), Image.LANCZOS)
    (OUT / "frames" / preset).mkdir(parents=True, exist_ok=True)
    if img.mode == "RGB":
        # photo-like radar composites: JPEG keeps them small
        img.save(OUT / "frames" / preset / (src.stem + ".jpg"), quality=88)
    else:
        # masks and interferograms: 256-colour PNG with transparency (looks the same, a fraction of the size)
        out = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
        out.save(OUT / "frames" / preset / (src.stem + ".png"), optimize=True)
    return f"Stories/frames/{preset}/{src.stem}"


def bbox_corners(b):
    """[minLon, minLat, maxLon, maxLat] -> TL, TR, BR, BL as flat [lon, lat, ...]."""
    x0, y0, x1, y1 = b
    return [x0, y1, x1, y1, x1, y0, x0, y0]


def story_from(props, data, layers, fires, wetlands, prov, quake):
    sid = props["id"]
    ctype = props.get("change_type", "")
    cls = props.get("change_class", "")
    category = "fire" if ctype == "fire" else ("water" if cls == "water" else ctype)
    metric = props.get("metric") or {}
    period = props.get("period") or {}
    s = {
        "id": sid,
        "headline": props.get("headline", ""),
        "region": props.get("region", ""),
        "subtitle": props.get("subtitle", ""),
        "lat": float(props.get("lat", 0)),
        "lon": float(props.get("lon", 0)),
        "changeClass": cls,
        "changeClassLabel": CLASS_LABEL.get(cls, cls.title()),
        "changeType": ctype,
        "category": category,
        "kindLabel": KIND.get(category, ctype.upper()),
        "metricLabel": metric.get("label", ""),
        "metricValue": float(metric.get("value", 0) or 0),
        "metricUnit": metric.get("unit", ""),
        "metricDirection": metric.get("direction", ""),
        "periodStart": period.get("start", ""),
        "periodEnd": period.get("end", ""),
        "periodLabel": f"{fmt_date(period.get('start', ''))} \u2013 {fmt_date(period.get('end', ''))}" if period else "",
        "passes": int(props.get("passes", 0) or 0),
        "areaKm2": float(props.get("area_km2", 0) or 0),
        "confidence": props.get("confidence", ""),
        "confidenceNote": props.get("confidence_note", ""),
        "summary": props.get("summary", ""),
        "causes": list(props.get("causes", [])),
        "whyItMatters": props.get("why_it_matters", ""),
        "nextStep": props.get("next_step", ""),
        "explanation": props.get("explanation", ""),
        "aiGenerated": bool(props.get("explanation_ai_generated", False)),
        "eventDate": props.get("event_date", "") or "",
        "published": props.get("published", ""),
        "isSample": bool(props.get("is_sample", False)),
        "series": [{"date": p["date"], "value": float(p["value"])} for p in props.get("series", [])],
        "seriesLabel": f"{metric.get('label', 'Value')} over time".upper(),
        "measurements": [],
        "layers": [],
        "dataSource": [],
    }

    # Radar image layers for this story (burn mask, false colour, wetland classes).
    preset = None
    for layer in layers:
        if sid in layer.get("story_ids", []):
            preset = layer["preset"]
            frames = []
            for f in layer["frames"]:
                res = copy_frame(data, f["url"], layer["preset"])
                if res:
                    frames.append({"date": f["date"], "label": fmt_date(f["date"]), "resource": res})
            corners = [c for pt in layer["bounds"] for c in pt]
            s["layers"].append({"label": layer.get("label", ""), "shortLabel": layer.get("short_label", "Radar"),
                                "bounds": corners, "frames": frames})

    # Per-date / per-month areas.
    if category == "fire":
        rows = sorted((f["properties"] for f in fires if f["properties"].get("story_id") == sid),
                      key=lambda p: (p["date"], p["tier"]))
        for p in rows:
            s["measurements"].append({"label": f"{p.get('date_label', p['date'])} \u00b7 {p['tier']} burned",
                                      "value": f"{p['area_km2']:.1f} km\u00b2"})
    elif preset and ctype in WETLAND_CLASS:
        want = WETLAND_CLASS[ctype]
        for f in wetlands:
            p = f["properties"]
            if p["preset"] == preset and p["class"] == want:
                s["measurements"].append({"label": f"{p['month_label']} \u00b7 {want.replace('_', ' ')}",
                                          "value": f"{p['area_km2']:.1f} km\u00b2"})

    # Where the data came from.
    if preset and preset in prov:
        pv = prov[preset]
        src = pv.get("source", {})
        s["dataSource"].append(f"{src.get('mission', 'NISAR')} \u00b7 {src.get('product', '')} ({src.get('maturity', '').lower()}), "
                               f"{len(pv.get('granules', []))} radar granules")
        pr = pv.get("preset", {})
        if pr.get("name"):
            s["dataSource"].append(f"Study area: {pr['name']}")
        rep = pv.get("reported")
        if rep:
            s["dataSource"].append(f"Reported on the ground: {rep.get('area_km2', '?')} km\u00b2 ({rep.get('note', '')})")
        thr = pv.get("method", {}).get("thresholds_db")
        if thr:
            s["dataSource"].append("Thresholds: " + ", ".join(f"{k.replace('_', ' ')} {v} dB" for k, v in thr.items()))
        ref = pv.get("method", {}).get("notebook_reference")
        if ref:
            s["dataSource"].append(f"Method: {ref}")

    if quake and quake.get("story") == sid:
        ev, st = quake.get("event", {}), quake.get("stats", {})
        s["measurements"] += [
            {"label": "Magnitude", "value": f"M{ev.get('magnitude')}"},
            {"label": "Depth", "value": f"{ev.get('depth_km')} km"},
            {"label": "Peak line-of-sight motion", "value": f"{st.get('peak_los_m')} m"},
            {"label": "Fringes", "value": f"{st.get('fringes')} \u00d7 {st.get('fringe_cm')} cm"},
            {"label": "Mean coherence", "value": f"{st.get('mean_coherence')}"},
            {"label": "Valid area", "value": f"{st.get('valid_km2')} km\u00b2 ({st.get('valid_pct')}%)"},
        ]
        for a in ev.get("aftershocks", []):
            s["measurements"].append({"label": "Aftershock", "value": a})
        src = quake.get("source", {})
        s["dataSource"].append(f"{src.get('mission', 'NISAR')} \u00b7 {src.get('product', '')} ({src.get('maturity', '').lower()}), "
                               f"{src.get('polarization', '')} interferogram")
        g = quake.get("granule", {})
        s["dataSource"].append(f"Pair: {fmt_date(g.get('reference_date', ''))} and {fmt_date(g.get('secondary_date', ''))}")
        s["dataSource"].append(f"Earthquake details: {ev.get('source', 'USGS')}")
        corners = bbox_corners(quake["preset"]["bbox"])
        frames = []
        for name, label in (("quake_panama_fringes", "Fringes"), ("quake_panama_los", "Line-of-sight motion")):
            res = copy_frame(data, f"/data/frames/{name}.png", "panama")
            if res:
                frames.append({"date": g.get("secondary_date", ""), "label": label, "resource": res})
        s["layers"].append({"label": "Interferogram \u00b7 Azuero peninsula", "shortLabel": "Interferogram",
                            "bounds": corners, "frames": frames})
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(WEB_DATA))
    ap.add_argument("--include-samples", action="store_true", help="also export sample-stories.json")
    args = ap.parse_args()
    data = Path(args.data)

    if (OUT / "frames").exists():
        shutil.rmtree(OUT / "frames")
    OUT.mkdir(parents=True, exist_ok=True)

    layers = load(data / "layers.json")["layers"]
    fires = load(data / "fires.geojson")["features"]
    wetlands = load(data / "wetlands.geojson")["features"]
    prov = load(data / "provenance.json").get("presets", {})
    quake_path = data / "provenance-earthquake-panama.json"
    quake = load(quake_path) if quake_path.exists() else None

    stories = []
    sources = ["changes.geojson"] + (["sample-stories.json"] if args.include_samples else [])
    for name in sources:
        for f in load(data / name)["features"]:
            if f["properties"].get("is_sample") and not args.include_samples:
                continue
            stories.append(story_from(f["properties"], data, layers, fires, wetlands, prov, quake))

    from make_detail_maps import add_basemaps
    add_basemaps(stories)
    (OUT / "stories.json").write_text(json.dumps({"stories": stories}, ensure_ascii=False, indent=1), encoding="utf-8")
    for s in stories:
        print(f"{s['id']:32s} {s['category']:12s} {s['changeClass']:12s} layers={len(s['layers'])} "
              f"frames={sum(len(l['frames']) for l in s['layers'])} measurements={len(s['measurements'])}")
    print("stories:", len(stories))


if __name__ == "__main__":
    main()
