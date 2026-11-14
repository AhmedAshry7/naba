"""The story's area on the map, one image per time step of the panel's slider.

Data:
  changes.geojson                    the story zone (drawn like the web map: theme fill, theme casing, white outline)
  fires.geojson                      fire stories: likely / possibly burned areas per radar pass
  wetlands.geojson                   flood / water stories: open water and flooded vegetation per month
  provenance-earthquake-panama.json  the earthquake: reference pass, mainshock, aftershocks, second pass, measured motion

Steps (as the web app's TimeSlider / store.ts where it has one):
  fire       every pass in fires.geojson plus the story's series dates (the pre-fire baseline included); opens on the
             pass marked `headline`
  wetlands   every month of the wetland area the story lies in; opens on the latest month
  earthquake reference pass -> mainshock -> aftershocks -> second pass; opens on the second pass
  otherwise  the story's own series (fill strength follows the value)
A step where the event is not happening (before the fire / quake, outside the story period) shows the zone in the
web map's neutral grey (#93A3C0).

Images cover the same box as the story's detailed basemap (make_detail_maps.py). Output:
<unity project>/Assets/Globe/Resources/Stories/highlights/<id>/*.png and a "highlights" entry per story:
{bounds, zone, kind, title, defaultIndex, frames[{date, label, detail, resource, active}]}.
"""
import re

from PIL import Image, ImageDraw

from paths import RESOURCES
from web_text import format_date, format_date_short, js_num

STORIES = RESOURCES / "Stories"
SS = 2  # supersampling
THEME_COLORS = {"earthquake": "#3DD68C", "flood": "#00ced1", "water": "#4AA8FF", "fire": "#F0484D"}
NEUTRAL = "#93A3C0"  # the web map's fallback colour: the event is not happening at this step
# frontend/src/lib.ts WETLAND_META / FIRE_META
WETLAND = {"flooded_vegetation": ("Flooded vegetation", "#00ced1"), "open_water": ("Open water", "#1f4e9c")}
FIRE = {"likely": ("likely", "#d7301f", 0.8), "possible": ("possibly", "#fc8d59", 0.6)}
MONTHS = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def polygons(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def bbox_of(geoms):
    xs = [pt[0] for g in geoms for poly in polygons(g) for ring in poly for pt in ring]
    ys = [pt[1] for g in geoms for poly in polygons(g) for ring in poly for pt in ring]
    return min(xs), min(ys), max(xs), max(ys)


class Canvas:
    def __init__(self, bounds, w, h):
        self.lon0, self.lat1, self.lon1 = bounds[0], bounds[1], bounds[2]
        self.lat0 = bounds[5]
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))

    def px(self, pt):
        return ((pt[0] - self.lon0) / (self.lon1 - self.lon0) * self.w * SS,
                (self.lat1 - pt[1]) / (self.lat1 - self.lat0) * self.h * SS)

    def _paint(self, mask, colour, opacity):
        layer = Image.new("RGBA", self.img.size, hex_rgb(colour) + (0,))
        layer.putalpha(mask.point(lambda v: int(v * opacity)))
        self.img.alpha_composite(layer)

    def fill(self, geoms, colour, opacity):
        mask = Image.new("L", self.img.size, 0)
        d = ImageDraw.Draw(mask)
        for g in geoms:
            for poly in polygons(g):
                if len(poly[0]) > 2:
                    d.polygon([self.px(p) for p in poly[0]], fill=255)
                for hole in poly[1:]:
                    if len(hole) > 2:
                        d.polygon([self.px(p) for p in hole], fill=0)
        self._paint(mask, colour, opacity)

    def outline(self, geoms, colour, width, opacity):
        mask = Image.new("L", self.img.size, 0)
        d = ImageDraw.Draw(mask)
        for g in geoms:
            for poly in polygons(g):
                for ring in poly:
                    if len(ring) > 1:
                        d.line([self.px(p) for p in ring] + [self.px(ring[0])], fill=255,
                               width=max(1, int(round(width * SS))), joint="curve")
        self._paint(mask, colour, opacity)

    def save(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.img.resize((self.w, self.h), Image.LANCZOS).save(path, optimize=True)


def value_text(v, unit):
    """'2.42' + '% of area ...' -> '2.42% of area ...'; '39.3' + 'km² likely burned' -> '39.3 km² likely burned'."""
    num = js_num(round(v, 2))
    return f"{num}{unit}" if unit.startswith("%") else f"{num} {unit}".strip()


def km2(v):
    return f"{v:.1f} km²"


def aftershock_steps(texts, year):
    """'M6.6 on 9 October (20:25 UTC)' -> ('2026-10-09', 'M6.6 aftershock', '20:25 UTC')."""
    out = []
    for t in texts:
        m = re.match(r"M([\d.]+) on (\d+) (\w+)(?: \(([^)]*)\))?", t)
        if not m or m.group(3).lower() not in MONTHS:
            continue
        date = f"{year}-{MONTHS[m.group(3).lower()]:02d}-{int(m.group(2)):02d}"
        out.append((date, f"M{m.group(1)}", m.group(4) or ""))
    return sorted(out)


def add_highlights(stories, geometry, fires=None, wetlands=None, quake=None):
    """geometry: story id -> zone geometry (changes.geojson). fires / wetlands: feature lists; quake: provenance dict."""
    fires = fires or []
    wetlands = wetlands or []
    wet_boxes = {}
    for f in wetlands:
        wet_boxes.setdefault(f["properties"]["preset"], []).append(f["geometry"])
    wet_boxes = {k: bbox_of(v) for k, v in wet_boxes.items()}

    for s in stories:
        base = s.get("basemap")
        zone = geometry.get(s["id"])
        if not base or not zone:
            continue
        zone = [zone]
        bounds = base["bounds"]
        bw, bh = Image.open(STORIES / "basemaps" / f"{s['id']}.png").size
        colour = THEME_COLORS.get(s.get("theme"), "#4AA8FF")
        out_dir = STORIES / "highlights" / s["id"]
        start, end = s.get("periodStart", ""), s.get("periodEnd", "")

        def draw(name, active, measured=(), zone_fill=0.55):
            """Zone (theme colour or grey) + measured areas [(geoms, colour, opacity)] + outlines."""
            c = Canvas(bounds, bw, bh)
            zc = colour if active else NEUTRAL
            c.fill(zone, zc, zone_fill if active else 0.3)
            c.outline(zone, zc, 2.6, 0.75 if active else 0.55)
            for geoms, col, op in measured:
                c.fill(geoms, col, op)
                c.outline(geoms, col, 1.0, 0.95)
            c.outline(zone, "#ffffff", 0.9, 0.95 if active else 0.5)
            c.save(out_dir / f"{name}.png")
            return f"Stories/highlights/{s['id']}/{name}"

        hl = {"bounds": bounds, "zone": draw("zone", True), "frames": [], "kind": "pass", "title": "", "defaultIndex": 0}

        def step(date, label, detail, resource, active):
            hl["frames"].append({"date": date, "label": label, "detail": detail, "resource": resource, "active": active})

        mine_fire = [f["properties"] | {"_geom": f["geometry"]} for f in fires if f["properties"].get("story_id") == s["id"]]
        presets = [k for k, (x0, y0, x1, y1) in wet_boxes.items() if x0 <= s["lon"] <= x1 and y0 <= s["lat"] <= y1]

        if quake and quake.get("story") == s["id"]:
            # ---- earthquake timeline from provenance-earthquake-panama.json
            ev, st, g = quake.get("event", {}), quake.get("stats", {}), quake.get("granule", {})
            ref, sec = g.get("reference_date") or start, g.get("secondary_date") or end
            main_date = (ev.get("time_utc") or s.get("eventDate") or "")[:10]
            hl["title"] = "EARTHQUAKE TIMELINE"
            step(ref, format_date_short(ref), f"First radar pass · {format_date(ref)} · before the earthquake",
                 draw("before", False), False)
            if main_date:
                t = (ev.get("time_utc") or "")[11:16]
                step(main_date, format_date_short(main_date),
                     f"M{ev.get('magnitude')} mainshock{f' at {t} UTC' if t else ''} · {js_num(ev.get('depth_km', 0))} km deep · {ev.get('place', '')}",
                     draw("mainshock", True, zone_fill=0.45), True)
            for i, (d, mag, when) in enumerate(aftershock_steps(ev.get("aftershocks", []), (main_date or ref)[:4])):
                step(d, format_date_short(d), f"{mag} aftershock{f' at {when}' if when else ''}",
                     draw(f"aftershock_{i}", True, zone_fill=0.5 + 0.03 * i), True)
            step(sec, format_date_short(sec),
                 f"Second radar pass · up to {st.get('peak_los_m')} m of motion · {st.get('fringes')} fringes of {st.get('fringe_cm')} cm",
                 draw("after", True, zone_fill=0.65), True)
            hl["defaultIndex"] = len(hl["frames"]) - 1

        elif s.get("theme") == "fire" and mine_fire:
            # ---- burn scar per radar pass from fires.geojson (store.ts fireTimelinesOf)
            hl["title"] = "BURN SCAR · RADAR PASS"
            dates = sorted({p["date"] for p in mine_fire} | {p["date"] for p in s.get("series", [])})
            headline = next((p["date"] for p in mine_fire if p.get("headline")), None)
            for d in dates:
                measured, parts = [], []
                for tier in ("possible", "likely"):
                    feats = [p for p in mine_fire if p["date"] == d and p["tier"] == tier]
                    if feats:
                        word, col, op = FIRE[tier]
                        measured.append(([p["_geom"] for p in feats], col, op))
                        parts.append(f"{km2(sum(p['area_km2'] for p in feats))} {word}")
                active = bool(measured)
                detail = " · ".join(reversed(parts)) + " burned" if parts else "Before the fire · nothing burned yet"
                step(d, format_date_short(d), detail, draw(f"burn_{d}", active, measured, zone_fill=0.25), active)
            hl["defaultIndex"] = dates.index(headline) if headline in dates else len(dates) - 1

        elif presets and s.get("theme") != "fire":
            # ---- wetland classes per month from wetlands.geojson
            hl["title"] = "MONTH SHOWN ON THE MAP"
            feats = [f for f in wetlands if f["properties"]["preset"] in presets]
            months = sorted({(f["properties"]["month"], f["properties"]["month_label"]) for f in feats})
            for m, label in months:
                measured, parts = [], []
                for cls in ("open_water", "flooded_vegetation"):
                    sel = [f for f in feats if f["properties"]["month"] == m and f["properties"]["class"] == cls]
                    if sel:
                        name, col = WETLAND[cls]
                        measured.append(([f["geometry"] for f in sel], col, 0.8))
                        parts.append(f"{name} {km2(sum(f['properties']['area_km2'] for f in sel))}")
                active = start[:7] <= m <= end[:7]
                step(m, label, " · ".join(reversed(parts)) or "No water measured",
                     draw(f"wetland_{m}", active, measured, zone_fill=0.2), active)
            hl["defaultIndex"] = max(0, len(months) - 1)

        else:
            # ---- the story's own series (changes.geojson)
            series = s.get("series") or []
            hl["title"] = "RADAR PASS SHOWN ON THE MAP"
            values = [p["value"] for p in series] or [0]
            lo, hi = min(values), max(values)
            for i, p in enumerate(series):
                strength = (p["value"] - lo) / (hi - lo) if hi > lo else 1.0
                step(p["date"], format_date_short(p["date"]), value_text(p["value"], s.get("metricUnit", "")),
                     draw(f"step_{i:02d}", True, zone_fill=0.2 + 0.65 * strength), True)
            hl["defaultIndex"] = max(0, len(series) - 1)

        s["highlights"] = hl
        print(f"  {s['id']:32s} {hl['title']:28s} steps={len(hl['frames'])}")
    return stories
