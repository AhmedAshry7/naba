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

# ---------------------------------------------------------------- fire (burn scar) analysis
# A port of notebook Section 12: cross-pol (HV) backscatter drops when fire removes the canopy.
FIRE_SMOOTH_PX = 5           # boxcar on linear power before differencing, ~100 m at 20 m pixels
# EXPLORATORY dB thresholds on the HV change (after - before). The notebook flags < -3 dB;
# the band between -3 and -2 dB is kept as a second, weaker tier.
BURN_THRESHOLDS = dict(
    likely_db=-3.0,          # HV fell by more than 3 dB: likely burned
    possible_db=-2.0,        # HV fell by 2-3 dB: possibly burned
)
BURN_NO_DATA, UNBURNED, BURN_POSSIBLE, BURN_LIKELY = 0, 1, 2, 3
BURN_SLUGS = {BURN_LIKELY: "likely", BURN_POSSIBLE: "possible"}
# Same two values as FIRE_META in frontend/src/lib.ts.
BURN_COLORS = {BURN_LIKELY: "#d7301f", BURN_POSSIBLE: "#fc8d59"}
# Display ranges for the dual-pol false colour (notebook DB_RANGES): R = HH, G = HV, B = HH-HV.
DB_RANGES = {"HH": (-25.0, 0.0), "HV": (-32.0, -8.0), "RATIO": (0.0, 15.0)}


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
    theme: str = "wetlands"         # "wetlands" (monthly classes) or "fires" (before/after burn)
    event_start: str | None = None  # fires: the event window; acquisitions inside it are "during"
    event_end: str | None = None
    causes: tuple[str, ...] = ()    # fires: possible causes / drivers, phrased as possibilities
    # fires: the officially reported size, quoted next to the radar's number for context
    reported_area_km2: float | None = None
    reported_note: str = ""         # e.g. "29,862 acres on 8 September 2026"
    reported_source: str = ""       # URL
    # fires: pin one viewing geometry (track, "ASC"/"DSC", frame) when several tie
    geometry: tuple[int, str, int] | None = None
    # fires: wording for the story - what the radar sees burn, and a site-specific limitation
    fire_vegetation: str = "the leaves and branches of trees and shrubs"
    fire_caveat: str = ""
    causes_water: tuple[str, ...] = ()
    causes_flooded: tuple[str, ...] = ()
    why_it_matters: str = ""
    next_step: str = ""
    story_ids: dict[str, str] = field(default_factory=dict)
    # Sample stories this preset's real stories replace (same place, invented numbers).
    supersedes: tuple[str, ...] = ()


PRESETS: dict[str, Preset] = {
    # NISAR_demo_sites.md, Fires #1: Plaskett Fire, Big Sur, California (tested in the notebook:
    # 42 D frame 70, 16 Aug -> 3 Oct). Notebook Section 12 method.
    "plaskett": Preset(
        key="plaskett",
        name="Plaskett Fire, Big Sur, California",
        region="Big Sur",
        subtitle="Plaskett Fire · Los Padres National Forest",
        bbox=(-121.55, 35.78, -121.25, 36.02),
        search_start="2026-08-01",
        search_end="2026-10-15",
        theme="fires",
        event_start="2026-08-26",
        event_end="2026-09-30",
        causes=(
            "Fire burning through forest and chaparral canopy, removing leaves and branches",
            "Severe burns on steep slopes leaving bare soil and standing dead trunks",
            "Smaller drops can also come from drying vegetation or a change in soil moisture",
        ),
        why_it_matters=(
            "Burned slopes above Highway 1 are prone to debris flows and landslides once the winter "
            "rains arrive. Knowing where the canopy is gone helps decide which roads, creeks and "
            "communities need protection first."
        ),
        next_step=(
            "Compare with the official fire perimeter, Sentinel-2 burn-severity (dNBR) maps and "
            "NASA FIRMS hotspots before treating the outline as the burn scar."
        ),
        fire_vegetation="the leaves and branches of forest and chaparral",
        fire_caveat=("Steep slopes facing away from the satellite are poorly seen, and the fire may "
                     "have burned there too."),
        reported_area_km2=120.8,
        reported_note="29,862 acres on 8 September 2026, 47% contained",
        reported_source="https://bigsurkate.blog/2026/09/08/",
        story_ids={"burn_scar": "plaskett-burn-scar"},
    ),
    # NISAR_demo_sites.md, Fires #4: drought fires in Everglades National Park, August 2026. The
    # sources give no start date, only "this month" and "mostly under control" by 26 Aug, so the
    # event window is 1-24 Aug. Two geometries tie on a 36-day gap (the 27 Jul-10 Aug data gap);
    # 170 D frame 76 is pinned: one full-frame 40 MHz granule per date, like Plaskett.
    "everglades": Preset(
        key="everglades",
        name="Everglades drought fires, Florida",
        region="Everglades National Park",
        subtitle="Drought fires in the sawgrass marshes · Florida",
        bbox=(-80.95, 25.25, -80.55, 25.65),
        search_start="2026-07-01",
        search_end="2026-09-30",
        theme="fires",
        event_start="2026-08-01",
        event_end="2026-08-24",
        geometry=(170, "DSC", 76),
        causes=(
            "Fire burning through drought-dried sawgrass and marsh vegetation",
            "Ground fire in exposed peat soils, which can smoulder after the flames pass",
            "Smaller drops can also come from vegetation dying back in the drought, or from water "
            "returning to the marsh after rain",
        ),
        why_it_matters=(
            "Burned sawgrass usually regrows, but when drought lets fire reach the peat, it burns "
            "away soil that took centuries to build, releases stored carbon and changes how water "
            "flows through the River of Grass."
        ),
        next_step=(
            "Compare with the park's fire perimeters, Sentinel-2 burn-severity (dNBR) maps and "
            "NASA FIRMS hotspots, and check water levels, before treating the outline as the burn "
            "scar."
        ),
        fire_vegetation="the leaves and stems of sawgrass and other marsh plants",
        fire_caveat=("In a wetland, standing water returning after rain darkens the radar much as a "
                     "burn does, so drops in later passes may be water rather than fire."),
        reported_area_km2=97.1,
        reported_note="nearly 24,000 acres across four fires in the park, 26 August 2026",
        reported_source="https://www.wlrn.org/environment/2026-08-26/drought-fire-everglades-peat-national-park",
        story_ids={"burn_scar": "everglades-burn-scar"},
    ),
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
