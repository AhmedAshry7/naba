"""Detailed local basemaps for each story area, in the NABA web map's colours.

The globe texture is only ~5 km per pixel, so when the flat map zooms into a 25 km story area its coastlines are
kilometres off and pins can look like they sit in the sea. This renders an accurate map of each story area from
the same OpenStreetMap vector tiles the web app uses (CARTO / Protomaps schema, via the web app's style), with the
web app's tints: background #050C1C, water #0A2A5E.

Output: <unity project>/Assets/Globe/Resources/Stories/basemaps/<story id>.png  (equirectangular, feathered edges)
        and a "basemap" entry (resource + corner bounds) added to each story in stories.json.
Tiles are cached in pipeline/cache/tiles/. Attribution: (c) OpenStreetMap contributors, (c) CARTO.

Usage: python make_detail_maps.py      (also called at the end of make_story_data.py)
"""
import gzip
import json
import math
import time
import urllib.request
from pathlib import Path

import mapbox_vector_tile as mvt
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from paths import RESOURCES

HERE = Path(__file__).resolve().parent
STORIES = RESOURCES / "Stories"
CACHE = HERE / "cache" / "tiles"
STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
UA = {"User-Agent": "NABA-Quest/1.0 (NASA Space Apps; offline story basemaps)"}
FONT = "C:/Windows/Fonts/Montserrat-SemiBold.ttf"

# Must match GlobeView (radius, mapSize) and GlobeView.FitMapTo(fill) so the map covers the visible window.
GLOBE_RADIUS, MAP_W, MAP_H, FILL = 0.25, 0.8, 0.52, 0.7
MARGIN = 1.8          # cover this many times the visible window (room to pan / zoom out)
OUT_W = 2048
SS = 2                # supersampling

BACKGROUND = (5, 12, 28)
LANDUSE = (9, 18, 38)
WATER = (10, 42, 94)
WATER_EDGE = (34, 74, 140)
ROAD_MINOR = (36, 46, 70)
ROAD_MAJOR = (62, 76, 108)
ROAD_HIGHWAY = (86, 102, 138)
BORDER = (110, 120, 150)
LABEL = (200, 206, 218)
WATER_LABEL = (120, 160, 220)


def tile_url():
    style = json.loads(urllib.request.urlopen(urllib.request.Request(STYLE_URL, headers=UA), timeout=30).read())
    src = next(v for v in style["sources"].values() if v.get("type") == "vector")
    return src["tiles"][0], src.get("maxzoom", 15)


def fetch(url_tpl, z, x, y):
    path = CACHE / str(z) / str(x) / f"{y}.mvt"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(urllib.request.Request(url_tpl.format(z=z, x=x, y=y), headers=UA), timeout=60).read()
                break
            except OSError:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        path.write_bytes(data)
    data = path.read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return mvt.decode(data, default_options={"y_coord_down": True})


def story_box(s):
    """Same as StoryData.GetBounds in Unity."""
    if s.get("layers") and len(s["layers"][0].get("bounds", [])) >= 8:
        b = s["layers"][0]["bounds"]
        lons, lats = b[0::2], b[1::2]
        return min(lats), min(lons), max(lats), max(lons)
    km = max(30.0, math.sqrt(max(s.get("areaKm2", 1.0), 1.0)) * 3.0)
    d_lat = km / 111.0 * 0.5
    d_lon = d_lat / max(0.2, math.cos(math.radians(s["lat"])))
    return s["lat"] - d_lat, s["lon"] - d_lon, s["lat"] + d_lat, s["lon"] + d_lon


def region(s):
    """Lat/lon box covering the flat-map window when the story is framed (plus margin), map-window aspect."""
    min_lat, min_lon, max_lat, max_lon = story_box(s)
    c_lat, c_lon = (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
    cos = math.cos(math.radians(c_lat))
    d_lon = max(math.radians(max_lon - min_lon) * cos, 1e-5)
    d_lat = max(math.radians(max_lat - min_lat), 1e-5)
    zoom = min(MAP_W * FILL / (d_lon * GLOBE_RADIUS), MAP_H * FILL / (d_lat * GLOBE_RADIUS))
    half_w = math.degrees(MAP_W / (GLOBE_RADIUS * zoom)) / cos * 0.5 * MARGIN   # degrees of longitude
    half_h = math.degrees(MAP_H / (GLOBE_RADIUS * zoom)) * 0.5 * MARGIN         # degrees of latitude
    return c_lat - half_h, c_lon - half_w, c_lat + half_h, c_lon + half_w


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def render(s, url_tpl, max_zoom):
    lat0, lon0, lat1, lon1 = region(s)
    cos = math.cos(math.radians((lat0 + lat1) / 2))
    W = OUT_W
    H = int(round(W * (lat1 - lat0) / ((lon1 - lon0) * cos)))
    # tile zoom: about 4 tiles across the region
    z = int(max(5, min(max_zoom, round(math.log2(360 * 4 / (lon1 - lon0))))))
    xa, ya = tile_xy(lat1, lon0, z)
    xb, yb = tile_xy(lat0, lon1, z)
    tiles = [(x, y) for x in range(int(xa), int(xb) + 1) for y in range(int(ya), int(yb) + 1)]

    img = Image.new("RGB", (W * SS, H * SS), BACKGROUND)
    draw = ImageDraw.Draw(img)
    n = 2 ** z

    def to_px(tx, ty, ext):
        def f(pt):
            gx = (tx + pt[0] / ext) / n
            gy = (ty + pt[1] / ext) / n
            lon = gx * 360 - 180
            lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy))))
            return ((lon - lon0) / (lon1 - lon0) * W * SS, (lat1 - lat) / (lat1 - lat0) * H * SS)
        return f

    def polygons(geom):
        if geom["type"] == "Polygon":
            return [geom["coordinates"]]
        if geom["type"] == "MultiPolygon":
            return geom["coordinates"]
        return []

    def lines(geom):
        if geom["type"] == "LineString":
            return [geom["coordinates"]]
        if geom["type"] == "MultiLineString":
            return geom["coordinates"]
        return []

    decoded = [(tx, ty, fetch(url_tpl, z, tx, ty)) for tx, ty in tiles]

    # 1. land use (subtle), 2. water, 3. rivers, 4. roads, 5. borders
    for tx, ty, t in decoded:
        layer = t.get("landuse")
        if not layer:
            continue
        f = to_px(tx, ty, layer.get("extent", 4096))
        for feat in layer["features"]:
            for poly in polygons(feat["geometry"]):
                if len(poly[0]) > 2:
                    draw.polygon([f(p) for p in poly[0]], fill=LANDUSE)
    for tx, ty, t in decoded:
        layer = t.get("water")
        if not layer:
            continue
        f = to_px(tx, ty, layer.get("extent", 4096))
        for feat in layer["features"]:
            for poly in polygons(feat["geometry"]):
                if len(poly[0]) > 2:
                    draw.polygon([f(p) for p in poly[0]], fill=WATER)
                for hole in poly[1:]:
                    if len(hole) > 2:
                        draw.polygon([f(p) for p in hole], fill=BACKGROUND)
            for ln in lines(feat["geometry"]):
                draw.line([f(p) for p in ln], fill=WATER, width=3 * SS)
    for tx, ty, t in decoded:
        layer = t.get("roads")
        if not layer:
            continue
        f = to_px(tx, ty, layer.get("extent", 4096))
        for feat in sorted(layer["features"], key=lambda q: q["properties"].get("sort_rank", 0)):
            kind = feat["properties"].get("kind", "")
            if kind == "highway":
                col, w = ROAD_HIGHWAY, 3
            elif kind == "major_road":
                col, w = ROAD_MAJOR, 2
            elif kind in ("minor_road", "rail"):
                col, w = ROAD_MINOR, 1
            else:
                continue
            for ln in lines(feat["geometry"]):
                draw.line([f(p) for p in ln], fill=col, width=w * SS)
    for tx, ty, t in decoded:
        layer = t.get("boundaries")
        if not layer:
            continue
        f = to_px(tx, ty, layer.get("extent", 4096))
        for feat in layer["features"]:
            if feat["properties"].get("kind") == "country":
                for ln in lines(feat["geometry"]):
                    draw.line([f(p) for p in ln], fill=BORDER, width=2 * SS)

    img = img.resize((W, H), Image.LANCZOS).convert("RGBA")

    # 6. place and water labels, biggest places first, no overlaps
    draw = ImageDraw.Draw(img)
    big = ImageFont.truetype(FONT, 30)
    small = ImageFont.truetype(FONT, 24)
    placed = []
    labels = []
    for tx, ty, t in decoded:
        for lname, colour, fnt in (("places", LABEL, big), ("water", WATER_LABEL, small)):
            layer = t.get(lname)
            if not layer:
                continue
            f = to_px(tx, ty, layer.get("extent", 4096))
            for feat in layer["features"]:
                p = feat["properties"]
                name = p.get("name:en") or (p.get("name") if p.get("script", "Latin") == "Latin" else None)
                if not name or feat["geometry"]["type"] != "Point":
                    continue
                if lname == "water" and p.get("kind_detail") not in ("lake", "lagoon", "bay", "sea", "reservoir"):
                    continue
                x, y = f(feat["geometry"]["coordinates"])
                labels.append((p.get("population_rank", 0), name.upper(), x / SS, y / SS, colour, fnt))
    for rank, name, x, y, colour, fnt in sorted(labels, key=lambda l: -l[0]):
        w = draw.textlength(name, font=fnt)
        box = (x - w / 2 - 6, y - 20, x + w / 2 + 6, y + 20)
        if box[0] < 0 or box[2] > W or box[1] < 0 or box[3] > H:
            continue
        if any(not (box[2] < b[0] or box[0] > b[2] or box[3] < b[1] or box[1] > b[3]) for b in placed):
            continue
        placed.append(box)
        draw.text((x, y), name, font=fnt, fill=colour, anchor="mm", stroke_width=3, stroke_fill=BACKGROUND)

    # 7. feather the edges so it blends into the globe texture around it
    a = np.ones((H, W), np.float32)
    fx = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / (W * 0.06), 0, 1)
    fy = np.clip(np.minimum(np.arange(H), H - 1 - np.arange(H)) / (H * 0.06), 0, 1)
    a *= fy[:, None] * fx[None, :]
    img.putalpha(Image.fromarray((a * 255).astype(np.uint8)))

    out = STORIES / "basemaps" / f"{s['id']}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"{s['id']:32s} z{z} tiles={len(tiles):3d} {W}x{H} labels={len(placed)}")
    return {"resource": f"Stories/basemaps/{s['id']}",
            "bounds": [lon0, lat1, lon1, lat1, lon1, lat0, lon0, lat0]}


def add_basemaps(stories):
    url_tpl, max_zoom = tile_url()
    for s in stories:
        try:
            s["basemap"] = render(s, url_tpl, max_zoom)
        except Exception as e:  # keep going without a detail map for this story
            print(f"{s['id']}: no basemap ({e})")
    return stories


def main():
    path = STORIES / "stories.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    add_basemaps(data["stories"])
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
