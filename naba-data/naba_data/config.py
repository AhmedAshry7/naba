"""Configuration for the Naba data exporter.

Every value here is a port of the matching setting in the exploration notebook
(`notebooks/NABA_NISAR_Explorer.ipynb`, Section 0 and Section 8), so a number produced by
this package can be reproduced cell-by-cell in Colab.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------- paths
PKG_DIR = Path(__file__).resolve().parent
DATA_DIR = PKG_DIR.parent                       # naba-data/
REPO_DIR = DATA_DIR.parent                      # naba/
PUBLIC_DATA = REPO_DIR / "frontend" / "public" / "data"
CACHE_DIR = DATA_DIR / "cache"                  # gitignored: GeoTIFF subsets + manifest

# ---------------------------------------------------------------- data selection
MATURITY = "PROVISIONAL"     # PROVISIONAL data starts 17 Jun 2026
FREQUENCY = "A"              # A = 10-20 m main band, B = 80 m auxiliary
MAX_RESULTS = 300            # cap on catalog results per search

# ---------------------------------------------------------------- reading & output grid
GCOV_RES_DEG = 0.0002        # output grid for GCOV, ~20 m
MAX_READ_MB = 400            # refuse any single window read larger than this (uncompressed estimate)
HTTP_BLOCK_MB = 8            # fsspec block size for HTTPS range requests
MIN_COVERAGE = 0.05          # skip an acquisition covering less than this fraction of the AOI

# ---------------------------------------------------------------- wetland classification
# EXPLORATORY dB thresholds, identical to the notebook's WETLAND_THRESHOLDS.
WETLAND_THRESHOLDS = dict(
    water_hh_max=-15.0,      # open water: specular reflection -> dark in HH ...
    water_hv_max=-22.0,      # ... and dark in HV
    flooded_hh_min=-5.0,     # flooded vegetation: double bounce -> very bright HH ...
    flooded_ratio_min=7.0,   # ... and HH much brighter than HV (HH-HV in dB)
)

NO_DATA, OPEN_WATER, FLOODED_VEG, OTHER = 0, 1, 2, 3
CLASS_NAMES = {NO_DATA: "no data", OPEN_WATER: "open water",
               FLOODED_VEG: "flooded vegetation", OTHER: "other land/vegetation"}
# Notebook's CLASS_COLORS; the frontend uses the same two values in WETLAND_META.
CLASS_COLORS = {NO_DATA: "#000000", OPEN_WATER: "#1f4e9c",
                FLOODED_VEG: "#e7298a", OTHER: "#a6d96a"}
# Slugs shared with the frontend (`WetlandClass` in src/types.ts).
CLASS_SLUGS = {OPEN_WATER: "open_water", FLOODED_VEG: "flooded_vegetation"}

# ---------------------------------------------------------------- vectorization defaults
MIN_AREA_KM2 = 0.02         # drop polygon parts smaller than this (speckle)
SIMPLIFY_M = 40.0           # Douglas-Peucker tolerance in metres
COORD_PRECISION = 5         # decimal places kept in exported GeoJSON coordinates
MAJORITY_FILTER = 3         # size of the majority filter applied before polygonizing (0 = off)
PAYLOAD_BUDGET_MB = 1.5     # wetlands.geojson size budget; the exporter warns above it


@dataclass(frozen=True)
class Preset:
    """One area of interest, with the dates to search and the copy the stories are written in."""

    key: str
    name: str                       # human label, as in the notebook presets
    region: str                     # ChangeStory.region
    subtitle: str                   # ChangeStory.subtitle
    bbox: tuple[float, float, float, float]      # [west, south, east, north]
    search_start: str
    search_end: str
    product: str = "GCOV"
    causes_water: tuple[str, ...] = ()
    causes_flooded: tuple[str, ...] = ()
    why_it_matters: str = ""
    next_step: str = ""
    story_ids: dict[str, str] = field(default_factory=dict)
    # Sample stories this preset's real stories replace (same place, invented numbers).
    supersedes: tuple[str, ...] = ()


PRESETS: dict[str, Preset] = {
    # Notebook preset "wetlands_alt": Lake Manzala wetlands, Nile Delta, Egypt.
    "manzala": Preset(
        key="manzala",
        name="Lake Manzala wetlands, Nile Delta, Egypt",
        region="Lake Manzala",
        subtitle="Coastal lagoon and reed beds",
        bbox=(31.95, 31.15, 32.20, 31.40),
        search_start="2026-06-17",
        search_end="2026-11-13",
        causes_water=(
            "Seasonal changes in lagoon water level",
            "Drainage and irrigation water entering the lagoon",
            "Reed beds cut back or cleared, exposing open water",
        ),
        causes_flooded=(
            "Water rising into standing reeds and marsh vegetation",
            "Seasonal flooding of fish farms and marsh margins",
            "Vegetation growing up through shallow standing water",
        ),
        why_it_matters=(
            "Lake Manzala is one of Egypt's largest coastal wetlands. How much of it is open water "
            "and how much is flooded marsh decides what fishing, farming and wildlife it can support."
        ),
        next_step=(
            "Compare with optical imagery and local water-level records before treating the change "
            "as confirmed."
        ),
        story_ids={"open_water": "manzala-open-water",
                   "flooded_vegetation": "manzala-flooded-vegetation"},
        supersedes=("manzala-lagoon",),
    ),
    # Notebook preset "wetlands": Okavango Delta, Botswana. Kept so the exporter is not
    # single-AOI by construction; not part of the shipped dataset.
    "okavango": Preset(
        key="okavango",
        name="Okavango Delta (central delta), Botswana",
        region="Okavango Delta",
        subtitle="Inland delta wetlands",
        bbox=(22.55, -19.55, 22.90, -19.20),
        search_start="2026-06-17",
        search_end="2026-11-13",
        causes_water=(
            "The annual flood pulse arriving from the Angolan highlands",
            "Seasonal evaporation drawing channels down",
        ),
        causes_flooded=(
            "Floodwater spreading into reed and papyrus beds",
            "Seasonal rise and fall of the delta's channels",
        ),
        why_it_matters=(
            "The Okavango's flood pulse decides where wildlife, cattle and people find water "
            "each year."
        ),
        next_step="Compare with river gauge records upstream before treating the change as confirmed.",
        story_ids={"open_water": "okavango-open-water",
                   "flooded_vegetation": "okavango-flooded-vegetation"},
    ),
}


def get_preset(key: str) -> Preset:
    try:
        return PRESETS[key]
    except KeyError:
        raise SystemExit(f"Unknown preset {key!r}. Available: {', '.join(PRESETS)}") from None
