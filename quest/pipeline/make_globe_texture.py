"""Render the dark-style globe texture + country label points for the Unity app.

Outputs (equirectangular, lon -180..180 left->right, lat 90..-90 top->bottom):
  <unity project>/Assets/Globe/Resources/globe_dark.png
  <unity project>/Assets/Globe/Resources/country_labels.json

Data: Natural Earth (public domain), cached in pipeline/cache/.
Usage: python make_globe_texture.py [--width 8192] [--scale 50m|10m]
"""
import argparse
import json
import urllib.request
from pathlib import Path

import geopandas as gpd
import matplotlib

from paths import RESOURCES

matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
OUT = RESOURCES

OCEAN = "#0b2a5e"
LAND = "#070b15"
BORDER = "#3a4256"
COAST = "#2c4f86"
RIVER = "#1d4f9c"


def natural_earth(scale, kind, name):
    CACHE.mkdir(exist_ok=True)
    fname = f"ne_{scale}_{name}.zip"
    path = CACHE / fname
    if not path.exists():
        url = f"https://naciscdn.org/naturalearth/{scale}/{kind}/{fname}"
        print("downloading", url)
        req = urllib.request.Request(url, headers={"User-Agent": "nisar-globe/1.0"})
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
    return gpd.read_file(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=8192)
    ap.add_argument("--scale", default="50m", choices=["110m", "50m", "10m"])
    args = ap.parse_args()

    countries = natural_earth(args.scale, "cultural", "admin_0_countries")
    lakes = natural_earth(args.scale, "physical", "lakes")
    rivers = natural_earth(args.scale, "physical", "rivers_lake_centerlines")

    w, h = args.width, args.width // 2
    px = 72 / 100 * (w / 8192)  # one 8k-pixel expressed in points at dpi=100
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(-180, 180)
    ax.set_ylim(-90, 90)
    ax.set_axis_off()
    fig.patch.set_facecolor(OCEAN)
    ax.set_facecolor(OCEAN)

    countries.plot(ax=ax, color=LAND, edgecolor="none")
    countries.boundary.plot(ax=ax, color=COAST, linewidth=3.0 * px)  # soft coast halo
    countries.plot(ax=ax, color=LAND, edgecolor=BORDER, linewidth=1.6 * px)
    lakes.plot(ax=ax, color=OCEAN, edgecolor=COAST, linewidth=1.0 * px)
    rivers.plot(ax=ax, color=RIVER, linewidth=1.4 * px)

    OUT.mkdir(parents=True, exist_ok=True)
    tex = OUT / "globe_dark.png"
    fig.savefig(tex, dpi=100, facecolor=OCEAN)
    plt.close(fig)
    print("wrote", tex)

    labels = []
    for _, r in countries.iterrows():
        name = r.get("NAME_EN") or r.get("NAME")
        lon, lat = r.get("LABEL_X"), r.get("LABEL_Y")
        if lon is None or lat is None or name is None:
            c = r.geometry.representative_point()
            lon, lat = c.x, c.y
        labels.append({
            "name": str(name).upper(),
            "lat": round(float(lat), 3),
            "lon": round(float(lon), 3),
            "rank": int(r.get("LABELRANK", 5)),
        })
    labels.sort(key=lambda l: l["rank"])
    lj = OUT / "country_labels.json"
    lj.write_text(json.dumps({"labels": labels}, ensure_ascii=False), encoding="utf-8")
    print("wrote", lj, len(labels), "labels")


if __name__ == "__main__":
    main()
